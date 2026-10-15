// BOT Bazaar web client — one page, no framework. Every read goes through `pub`, every write
// through `queueTx` (one wallet, one queue: parallel sends from the same account collide on nonce).
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import abiJson from "./abi.json";
import type { DemoChain } from "./demo";
import type { Target, WorldApi, WorldData } from "./world/World";
import { browserDeploymentKey, deploymentFor, type Deployment } from "./deployments";
import { FAUCET, NETWORKS, type NetworkKey } from "./networks";
import { TABS, tabsFor, type Tab } from "./screens";
import { PRESET16, encodePalette, encodePixels, patternCanvas } from "./pixel";
import { PRACTICE, nextPractice } from "./world/errands";
import { finishTour, tour } from "./world/tour";
import { setupMusic } from "./music";
import "./style.css";

type Name = keyof Deployment["contracts"];
const ABI = abiJson as unknown as Record<Name, readonly unknown[]>;

const CATEGORIES = ["Goods (B2C)", "Service (B2B)", "Developer asset", "Agent service"];
// The 3D bazaar is the front door; the Pixel Workshop is the next tab and an easel inside the market
// (harry, 2026-10-14: keep the game, make pixel art one step away). Tab lists live in screens.ts.
const TAB_LABEL: Record<string, string> = {
  bazaar: "Bazaar", workshop: "🎨 Pixel Workshop", shops: "Shops", requests: "Requests", botornot: "Bot or Not", projects: "Projects", account: "Account",
};
/** AgentPass.kindOf — self-declared, display only. The contracts treat every kind the same. */
const KINDS = [
  { icon: "❓", name: "Undeclared" },
  { icon: "🧑", name: "Human" },
  { icon: "🤖", name: "Bot" },
  { icon: "🧑🤖", name: "Team" },
];
const WANTS = ["Anyone", "Humans", "Bots"];

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

// Mainnet is the default since its launch (harry, 2026-10-14); testnet and the demo stay in the
// network menu and open with ?network=testnet or ?network=demo. "demo" runs the contracts on an EVM
// inside this page (src/demo.ts) and is the fallback when no network has a deployment.
type Key = NetworkKey | "demo";
const NETWORK_CHOICE = "bazaar-network-v3"; // v3: choices made while testnet was the default are dropped
// ?network=testnet opens a network directly.
const linked = new URLSearchParams(location.search).get("network") as Key | null;
let networkKey: Key =
  (linked && (linked === "demo" || linked in NETWORKS) ? linked : null) ||
  (store.get(NETWORK_CHOICE) as Key) ||
  (deploymentFor(NETWORKS.mainnet.id) ? "mainnet" : deploymentFor(NETWORKS.testnet.id) ? "testnet" : "demo");
let demo: DemoChain | null = null;
let demoChain: Chain | null = null;
const tabFromHash = (): Tab => {
  const t = location.hash.slice(1) as Tab;
  return TABS.includes(t) ? t : TABS[0];
};
let tab: Tab = tabFromHash();
let pub: PublicClient;
let dep: Deployment | null = null;
let walletClient: WalletClient | null = null;
let me: Address | null = null;
/** On testnet the page makes its own throwaway wallet, so nobody needs an extension to play. */
let burner = false;
let balance: bigint | null = null;
const LOW = parseEther("0.01");
const burnerKeyName = (id: number) => `bazaar-burner-${id}`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const bot = (wei: bigint) => `${formatEther(wei)} BOT`;

function chain(): Chain {
  return networkKey === "demo" ? demoChain! : NETWORKS[networkKey];
}
/** Chain time in seconds: the demo clock can be fast-forwarded, real chains follow the wall clock. */
function nowSec() {
  return BigInt(demo ? demo.now() : Math.floor(Date.now() / 1000));
}
function c(name: Name) {
  const at = dep?.contracts[name];
  if (!at) throw new Error(`${name} is not deployed on this network`);
  return { address: at.address, abi: ABI[name] } as const;
}
/** A network with only the Pixel Workshop (the first mainnet version) shows the 3D market with the rest marked coming soon. */
const workshopOnly = () => !!dep && !dep.contracts.BazaarMarket;
/** Per-transaction BOT cap of the mainnet test version (0.1), from deployments/<id>.json; 0n = none. */
const cap = () => (dep?.maxAmount ? BigInt(dep.maxAmount) : 0n);
const capNote = () => (cap() ? ` (max ${formatEther(cap())} while testing)` : "");
/** Refuse amounts over the cap before the wallet is asked, with a plain message. */
function capped(v: bigint) {
  if (cap() && v > cap()) {
    const msg = `The market is under construction: at most ${formatEther(cap())} BOT per transaction while we test.`;
    toast(msg, true);
    throw new Error(msg);
  }
  return v;
}
const tabsHere = (): readonly Tab[] => (dep ? tabsFor(dep.contracts) : TABS);
function read<T>(name: Name, functionName: string, args: unknown[] = []): Promise<T> {
  return pub.readContract({ ...c(name), functionName, args } as never) as Promise<T>;
}

// ---------- writes ----------
let queue: Promise<unknown> = Promise.resolve();
// The same call while it is still pending is a double click, not a second order: hand back the first one.
const inFlight = new Map<string, Promise<unknown>>();
function queueTx(label: string, name: Name, functionName: string, args: unknown[] = [], value?: bigint) {
  const key = JSON.stringify([name, functionName, args, value], (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const same = inFlight.get(key);
  if (same) return same;
  const run = async () => {
    if (!walletClient || !me) {
      if (networkKey === "mainnet") showStart();
      throw new Error(networkKey === "mainnet" ? "Choose how to start: a browser wallet or MetaMask" : "Connect a wallet first");
    }
    // Mainnet starts in a browser wallet with nothing in it: the first write that needs gas opens
    // the wallet panel on how to fund it (deposit, send from MetaMask, or switch to MetaMask).
    if (burner && networkKey === "mainnet") {
      const have = await pub.getBalance({ address: me });
      balance = have;
      if (have < parseEther(PUBLISH_GAS) + (value ?? 0n)) {
        needFunds = label;
        $("#wallet").hidden = false;
        renderWallet();
        throw new Error("This browser wallet needs a little BOT for gas first");
      }
    }
    toast(`${label}: ${demo || burner ? "sending" : "confirm in your wallet"}…`);
    const { request } = await pub.simulateContract({ ...c(name), functionName, args, value, account: me } as never);
    // A local (burner) account signs in the page; the simulated request only carries its address.
    const account = walletClient.account ?? (request as { account: unknown }).account;
    const hash = await walletClient.writeContract({ ...(request as object), account } as never);
    toast(`${label}: sent, waiting for the block…`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    toast(`${label}: done`);
    world?.pulse();
    return r;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  const out = next
    .catch((e: Error) => {
      toast(`${label}: ${(e as { shortMessage?: string }).shortMessage || e.message}`, true);
      throw e;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, out);
  return out;
}

/** Keep a button pressed (disabled) until its transaction settles, so a second tap cannot send it again. */
function busy<T>(btn: EventTarget | null | undefined, p: Promise<T>): Promise<T> {
  if (!(btn instanceof HTMLButtonElement)) return p;
  btn.disabled = true;
  return p.finally(() => (btn.disabled = false));
}

function toast(msg: string, error = false) {
  const t = document.createElement("div");
  t.className = `toast${error ? " error" : ""}`;
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}

/** MetaMask's universal link: opens this page (network included) in the MetaMask app's browser. */
const metamaskLink = () => `https://metamask.app.link/dapp/${location.host}${location.pathname}?network=${networkKey === "demo" ? "mainnet" : networkKey}`;

/** No injected wallet (most phones): say how to get one instead of failing silently. */
function noWallet() {
  const box = $("#wallet");
  const here = metamaskLink().replace("https://metamask.app.link/dapp/", "");
  box.innerHTML = `
    <h3>No wallet in this browser</h3>
    <p>Drawing works without one. To publish or collect on ${esc(chain().name)} you need a wallet such as MetaMask.</p>
    <p><a class="fun-link" href="https://metamask.app.link/dapp/${esc(here)}">Open in the MetaMask app</a> on a phone, or
      <a href="https://metamask.io/download/" target="_blank" rel="noopener">install MetaMask</a> on a computer.</p>
    <p><button class="ghost" data-close>Close</button></p>`;
  box.hidden = false;
  box.querySelector("[data-close]")!.addEventListener("click", () => (box.hidden = true));
}

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (x: unknown) => void) => void };
// EIP-6963: with several wallet extensions installed, window.ethereum belongs to whichever loaded
// last (Phantom, Coinbase…). Each wallet also announces itself; prefer MetaMask when it does.
const announced = new Map<string, Eip1193>();
addEventListener("eip6963:announceProvider", (e) => {
  const d = (e as CustomEvent<{ info: { rdns: string }; provider: Eip1193 }>).detail;
  if (d?.info?.rdns && d.provider) announced.set(d.info.rdns, d.provider);
});
dispatchEvent(new Event("eip6963:requestProvider"));
const injected = () => announced.get("io.metamask") ?? (window as unknown as { ethereum?: Eip1193 }).ethereum ?? [...announced.values()][0];
const rpcCode = (e: unknown) => {
  const x = e as { code?: number; data?: { originalError?: { code?: number } } };
  return x?.data?.originalError?.code ?? x?.code;
};

/** Put the wallet on this page's chain, adding BOT Chain first if the wallet does not know it
 *  (MetaMask mobile reports an unknown chain as 4902, sometimes wrapped, sometimes as -32603). */
async function ensureChain(eth: Eip1193) {
  const ch = chain();
  const hex = `0x${ch.id.toString(16)}`;
  if (Number(await eth.request({ method: "eth_chainId" })) === ch.id) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if (rpcCode(e) === 4001) throw e; // the visitor said no
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex,
        chainName: ch.name,
        nativeCurrency: ch.nativeCurrency,
        rpcUrls: ch.rpcUrls.default.http,
        blockExplorerUrls: ch.blockExplorers ? [ch.blockExplorers.default.url] : undefined,
      }],
    });
    // Some wallets add the chain without moving to it.
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }).catch(() => undefined);
  }
  if (Number(await eth.request({ method: "eth_chainId" })) !== ch.id) throw new Error(`Switch MetaMask to ${ch.name} and try again`);
}

let watching = false;
async function connect() {
  const eth = injected();
  if (!eth) return noWallet();
  try {
    toast("Waiting for MetaMask… if no window opens, click the MetaMask icon in the toolbar");
    // Accounts first: MetaMask mobile refuses a chain switch from a site it has not connected yet.
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.length) throw new Error("MetaMask shared no account");
    await ensureChain(eth);
    walletClient = createWalletClient({ chain: chain(), transport: custom(eth) });
    me = getAddress(accounts[0]);
  } catch (e) {
    const code = rpcCode(e);
    const msg = code === 4001 ? "MetaMask: request declined"
      : code === -32002 ? "MetaMask already has a request waiting: click the MetaMask icon in the toolbar and answer it"
      : `MetaMask: ${(e as { shortMessage?: string }).shortMessage || (e as Error).message}`;
    toast(msg, true);
    return;
  }
  burner = false;
  if (networkKey === "testnet") store.set("bazaar-wallet", "extension");
  if (networkKey === "mainnet") store.set(MAINNET_WALLET, "extension");
  if (!watching && eth.on) {
    watching = true;
    eth.on("accountsChanged", (a) => {
      if (burner) return;
      const list = a as string[];
      me = list.length ? getAddress(list[0]) : null;
      if (!me) walletClient = null;
      void refreshBalance();
      void render();
    });
    eth.on("chainChanged", (id) => {
      if (!burner && me && Number(id) !== chain().id) toast(`MetaMask moved off ${chain().name}; switch back to publish`, true);
    });
  }
  $("#wallet").hidden = true;
  void refreshBalance();
  void render();
}

// ---------- browser (burner) wallet ----------
// Testnet starts in one automatically. On mainnet it holds real BOT, so it is the visitor's choice
// (after GIWA Village): a key made in this browser and kept only here, funded with a little BOT for
// gas, with backup, deposit address and a way to send the BOT back out.
const MAINNET_WALLET = "bazaar-wallet-mainnet";
/** About what one free design costs to publish on mainnet (≈160k gas at ≈20 gwei, 2026-10-14). */
const PUBLISH_GAS = "0.003";

/** Mainnet: how to start, a browser wallet or MetaMask. */
function showStart() {
  const box = $("#wallet");
  showKey = false;
  box.hidden = false;
  box.innerHTML = `
    <h3>How do you want to start? <small class="muted">${esc(chain().name)}</small></h3>
    <div class="start-pick">
      <section>
        <h4>👛 Browser wallet</h4>
        <p>A new wallet made right here, no app needed. Send it a little BOT and publish.</p>
        <ul class="muted">
          <li>The key is made and kept <b>only in this browser</b>. Nobody else has a copy, not us either.</li>
          <li>It holds real BOT: <b>put in only a little</b>. One free design costs about ${PUBLISH_GAS} BOT of gas, so 0.02 BOT is plenty.</li>
          <li>Clearing site data or losing this device loses the wallet. Back up the key from the wallet panel.</li>
        </ul>
        <label><input type="checkbox" id="start-ok" /> I understand, it's for small amounts</label>
        <p><button class="fun" data-s="burner" disabled>Start with a browser wallet</button></p>
      </section>
      <section>
        <h4>🦊 MetaMask</h4>
        <p>Use the wallet you already have. Each transaction asks for your OK in MetaMask.</p>
        ${injected() ? `<p><button class="fun" data-s="ext">Connect MetaMask</button></p>`
          : `<p><a class="fun-link" href="${metamaskLink()}">Open in the MetaMask app</a></p>
             <p class="muted">On a phone, MetaMask connects inside its own browser: this opens BOT Bazaar there, then tap Connect wallet › Connect MetaMask.
               On a computer, <a href="https://metamask.io/download/" target="_blank" rel="noopener">install the MetaMask extension</a> and reload.</p>`}
      </section>
    </div>
    <p><button class="ghost" data-s="close">Not now</button></p>`;
  const ok = box.querySelector<HTMLInputElement>("#start-ok")!;
  const go = box.querySelector<HTMLButtonElement>("[data-s=burner]")!;
  ok.addEventListener("change", () => (go.disabled = !ok.checked));
  go.addEventListener("click", () => {
    useBurner();
    store.set(MAINNET_WALLET, "burner");
    box.innerHTML = "";
    renderWallet();
    void refreshBalance();
    void render();
  });
  box.querySelector("[data-s=ext]")?.addEventListener("click", () => void connect());
  box.querySelector("[data-s=close]")!.addEventListener("click", () => (box.hidden = true));
}

/** Send BOT from the browser wallet to another address; "max" leaves just the gas for this transfer. */
async function sendOut() {
  if (!walletClient || !me || !burner) return;
  const to = prompt("Send BOT from this browser wallet to which address?")?.trim();
  if (!to) return;
  if (!isAddress(to)) return toast("That is not a valid address", true);
  const bal = await pub.getBalance({ address: me });
  const fee = (await pub.getGasPrice()) * 21000n * 2n;
  const max = bal > fee ? bal - fee : 0n;
  const amount = prompt(`How much BOT? (up to ${formatEther(max)}; type "max" for all of it)`, "max")?.trim();
  if (!amount) return;
  const value = amount === "max" ? max : parseEther(amount);
  if (value <= 0n || value > max) return toast("Not enough BOT for that and the gas", true);
  if (!confirm(`Send ${formatEther(value)} BOT to ${to}? This cannot be undone.`)) return;
  try {
    const hash = await walletClient.sendTransaction({ account: walletClient.account!, to, value, chain: chain() });
    toast("Sent, waiting for the block…");
    await pub.waitForTransactionReceipt({ hash });
    toast("BOT sent");
    void refreshBalance();
  } catch (e) {
    toast((e as { shortMessage?: string }).shortMessage || (e as Error).message, true);
  }
}

/** The key as a small text file, so a backup does not depend on the clipboard. */
function downloadKey() {
  const key = store.get(burnerKeyName(chain().id));
  if (!key || !me) return;
  const text = `BOT Bazaar browser wallet backup\nNetwork: ${chain().name} (chain id ${chain().id})\nAddress: ${me}\nPrivate key: ${key}\n\nAnyone with this key controls the wallet. Keep this file private. Import it in MetaMask: Add account > Import account.\n`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = `bot-bazaar-wallet-${me.slice(2, 8)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function depositQr(el: HTMLElement) {
  if (!me) return;
  const { default: qrcode } = await import("qrcode-generator");
  const q = qrcode(0, "M");
  q.addData(me);
  q.make();
  el.innerHTML = q.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
}

/** Make or reuse this browser's key for the current network. It lives in localStorage only. */
function useBurner() {
  const ch = chain();
  let key = store.get(burnerKeyName(ch.id)) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    store.set(burnerKeyName(ch.id), key);
  }
  const account = privateKeyToAccount(key);
  walletClient = createWalletClient({ account, chain: ch, transport: http() });
  me = account.address;
  burner = true;
}

/** The faucet has a captcha, so "get BOT" copies the address and opens the faucet page for one paste. */
async function getTestBot() {
  if (!me) return;
  const tab = open(FAUCET, "_blank", "noopener"); // first, while the click still counts as a user gesture
  try {
    await navigator.clipboard.writeText(me);
    toast("Address copied. Paste it on the faucet page.");
  } catch {
    toast(`Paste this address on the faucet page: ${me}`);
  }
  if (!tab) toast(`Open ${FAUCET} to get test BOT`, true);
}

/** Move some BOT from an extension wallet (MetaMask…) into the browser wallet. */
async function fundFromExtension() {
  const eth = injected();
  if (!eth || !me) return toast("No MetaMask here: use the deposit address instead, or open this page in the MetaMask app", true);
  const amount = prompt(`How much ${networkKey === "mainnet" ? "" : "test "}BOT to send to the browser wallet?`, networkKey === "mainnet" ? "0.02" : "0.1");
  if (!amount) return;
  try {
    const ch = chain();
    const ext = createWalletClient({ chain: ch, transport: custom(eth) });
    const [from] = await ext.requestAddresses();
    await ensureChain(eth);
    const hash = await ext.sendTransaction({ account: from, to: me, value: parseEther(amount), chain: ch });
    toast("Sent, waiting for the block…");
    await pub.waitForTransactionReceipt({ hash });
    toast("Browser wallet funded");
    void render();
  } catch (e) {
    toast((e as { shortMessage?: string }).shortMessage || (e as Error).message, true);
  }
}

/** The import form is open in the wallet panel. The key is typed or pasted, never taken from the URL. */
let importing = false;
function importKey(raw: string) {
  const hex = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return toast("That is not a private key (64 hex characters, optionally starting with 0x)", true);
  const key = `0x${hex.toLowerCase()}` as `0x${string}`;
  let address: Address;
  try {
    address = privateKeyToAccount(key).address;
  } catch {
    return toast("That key is not valid", true);
  }
  if (address === me) return toast("That is already this wallet"), void ((importing = false), renderWallet());
  if (!confirm(`Use wallet ${address} in this browser? The current browser wallet ${me} is replaced here.`)) return;
  store.set(burnerKeyName(chain().id), key);
  if (networkKey === "mainnet") store.set(MAINNET_WALLET, "burner");
  if (networkKey === "testnet") store.set("bazaar-wallet", "burner");
  importing = false;
  useBurner();
  toast(`Wallet ${short(address)} imported`);
  void refreshBalance();
  void render();
}

/** Set when a write found the browser wallet empty: the panel then leads with how to fund it. */
let needFunds: string | null = null;

/** Set after the warning is accepted; the key then shows in the panel with its own Copy button. */
let showKey = false;

// The copy runs on its own click: after a confirm() dialog some browsers (iOS Safari) refuse the
// clipboard, which used to leave the address from an earlier Copy in the clipboard instead.
async function copyKey() {
  const key = store.get(burnerKeyName(chain().id));
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    toast("Private key copied (66 characters). Keep it out of chats and commits.");
  } catch {
    const field = document.querySelector<HTMLInputElement>("#wallet-key");
    field?.select();
    toast("Select the key in the box and copy it by hand", true);
  }
}

function renderWallet() {
  const btn = $("#connect");
  btn.hidden = networkKey === "demo";
  btn.innerHTML = me ? `${burner ? "👛 " : ""}${short(me)}${balance !== null ? `<span class="bal"> · ${Number(formatEther(balance)).toFixed(3)}</span>` : ""}` : "Connect wallet";
  const low = balance !== null && balance < LOW;
  const lowNote = document.querySelector<HTMLElement>("#low");
  if (lowNote) lowNote.hidden = !low;
  const box = $("#wallet");
  if (box.hidden || !me) return;
  const real = networkKey === "mainnet";
  const fund = burner && real && needFunds && (balance === null || balance < parseEther(PUBLISH_GAS)) ? needFunds : null;
  box.innerHTML = `
    ${fund ? `<p class="need-funds"><b>To ${esc(fund.toLowerCase())}, add a little BOT first.</b> This wallet was made in your browser and is still empty.
      Gas for one design is about ${PUBLISH_GAS} BOT: deposit to the address below, send some from MetaMask, or use MetaMask instead.</p>` : ""}
    <h3>${burner ? "Browser wallet" : "Extension wallet"} <small class="muted">${esc(chain().name)}</small></h3>
    <p class="addr"><code>${me}</code> <button class="ghost" data-w="copy">Copy</button></p>
    <p>Balance <b>${balance === null ? "…" : bot(balance)}</b>${low ? ` <span class="warn">low</span>` : ""}</p>
    ${networkKey === "testnet" ? `<p><button data-w="faucet">Get test BOT</button> <span class="muted">copies your address and opens the faucet</span></p>` : ""}
    ${burner && real ? `
      <div class="deposit">
        <div id="deposit-qr" aria-label="Deposit address as a QR code"></div>
        <p><b>Deposit</b>: send BOT on ${esc(chain().name)} to the address above. A free design costs about ${PUBLISH_GAS} BOT of gas;
          0.02 BOT is plenty. <span class="warn">Keep only small amounts here.</span>${balance === 0n ? " Publishing works once the first BOT arrives." : ""}</p>
      </div>` : ""}
    ${burner ? `
      <p><button class="ghost" data-w="fund">Send from MetaMask…</button>${real ? ` <button class="ghost" data-w="out">Send BOT out…</button>` : ""}</p>
      ${showKey
        ? `<p class="muted">Private key (${real ? "real BOT: keep it private, never paste it in a chat" : "testnet only"}; anyone with it controls this wallet)</p>
           <p><input id="wallet-key" readonly value="${esc(store.get(burnerKeyName(chain().id)) ?? "")}" /> <button data-w="key">Copy private key</button> <button class="ghost" data-w="hide">Hide</button></p>`
        : `<p><button class="ghost" data-w="reveal">${real ? "Back up key" : "Show private key"}</button>${real ? ` <button class="ghost" data-w="file">Download backup</button>` : ""}
           <span class="muted">${real ? "the key lives only in this browser; save it to keep the wallet" : "testnet only · import it elsewhere or use it as a deploy key"}</span></p>`}
      ${importing
        ? `<form id="import-key"><p class="muted">Paste a private key you backed up (from this site or another app). It replaces this browser
             wallet on ${esc(chain().name)}${balance ? `, so <b>back up the current key first</b>: it still holds ${esc(bot(balance))}` : ""}.</p>
           <p><input id="import-field" type="password" autocomplete="off" spellcheck="false" placeholder="0x… (64 hex characters)" />
             <button>Import</button> <button type="button" class="ghost" data-w="noimport">Cancel</button></p></form>`
        : `<p><button class="ghost" data-w="import">Import a key…</button> <button class="ghost" data-w="ext">Use MetaMask instead</button></p>`}`
    : networkKey === "testnet" || real ? `<p><button class="ghost" data-w="burner">Use a browser wallet instead</button></p>` : ""}`;
  if (burner && real) void depositQr($("#deposit-qr"));
  box.querySelector("#import-key")?.addEventListener("submit", (e) => {
    e.preventDefault();
    importKey(box.querySelector<HTMLInputElement>("#import-field")!.value);
  });
  box.querySelectorAll<HTMLButtonElement>("[data-w]").forEach((b) =>
    b.addEventListener("click", async () => {
      const w = b.dataset.w;
      if (w === "copy") await navigator.clipboard.writeText(me!).then(() => toast("Address copied"), () => toast(me!));
      if (w === "faucet") await getTestBot();
      if (w === "fund") await fundFromExtension();
      if (w === "reveal" && confirm(real
        ? "Show this wallet's private key? Anyone who sees it can take its BOT. Save it somewhere private (a password manager), never in a chat or screenshot."
        : "Show this browser wallet's private key? Anyone with it controls the wallet. Use it on testnet only.")) (showKey = true), renderWallet();
      if (w === "file" && confirm("Download a text file with this wallet's private key? Keep the file private.")) downloadKey();
      if (w === "out") await sendOut();
      if (w === "start") showStart();
      if (w === "import") (importing = true), renderWallet(), $("#import-field").focus();
      if (w === "noimport") (importing = false), renderWallet();
      if (w === "hide") (showKey = false), renderWallet();
      if (w === "key") await copyKey();
      if (w === "ext") await connect();
      if (w === "burner") (useBurner(), store.set(real ? MAINNET_WALLET : "bazaar-wallet", "burner"), void refreshBalance(), void render());
    }));
}

// After a trip to the faucet the balance shows up on its own when the page is looked at again.
addEventListener("focus", () => void refreshBalance());

async function refreshBalance() {
  balance = me && networkKey !== "demo" ? await pub.getBalance({ address: me }).catch(() => null) : null;
  renderWallet();
}

// ---------- who is who ----------
interface Who {
  kind: number;
  label: string;
  principal: Address;
}
async function whoIs(addrs: readonly Address[]): Promise<Map<Address, Who>> {
  const uniq = [...new Set(addrs)];
  const rows = await Promise.all(
    uniq.map(async (a) => {
      const [kind, label, principal] = await Promise.all([
        read<number>("AgentPass", "kindOf", [a]),
        read<string>("AgentPass", "labelOf", [a]),
        read<Address>("AgentPass", "principalOf", [a]),
      ]);
      return [a, { kind, label, principal }] as const;
    }),
  );
  return new Map(rows);
}
function badge(w: Who | undefined) {
  const k = KINDS[w?.kind ?? 0] ?? KINDS[0];
  const title = w?.kind ? `${k.name}${w.label ? `: ${w.label}` : ""}` : "Not declared. Guess in Bot or Not";
  const pass = w && !/^0x0+$/.test(w.principal) ? ` <span class="pass" title="Acts for ${w.principal}">for ${short(w.principal)}</span>` : "";
  return `<span class="kind k${w?.kind ?? 0}" title="${esc(title)}">${k.icon} ${w?.kind ? esc(k.name) : "Bot or not?"}</span>${pass}`;
}

// ---------- views ----------
async function viewShops(el: HTMLElement) {
  const projectFilter = Number(new URLSearchParams(location.search).get("project") || 0);
  const [owners, shops, total] = await read<[Address[], ShopData[], bigint]>("BazaarMarket", "openShops", [0n, 100n]);
  const rows = owners
    .map((o, i) => ({ owner: o, ...shops[i] }))
    .filter((s) => !projectFilter || s.projectId === projectFilter);
  const who = await whoIs(rows.map((r) => r.owner));
  el.innerHTML = `
    <p class="hero">Bots and humans trade here as equals: same prices, same escrow, same rules. Badges are self-declared;
      the undeclared ones are a <a href="#botornot">game</a>.</p>
    <h2>Open shops <small>${total} on chain${projectFilter ? ` · project #${projectFilter}` : ""}</small></h2>
    <div class="filters">${["All", ...CATEGORIES].map((cName, i) => `<button data-cat="${i - 1}">${cName}</button>`).join("")}</div>
    <div class="filters">${KINDS.map((k, i) => `<button data-kind="${i}">${k.icon} ${k.name}</button>`).join("")}<button data-kind="-1">Everyone</button></div>
    <div class="grid" id="shop-grid">${rows.map((r) => shopCard(r, who.get(r.owner))).join("") || "<p>No shops yet. Open the first one from Account.</p>"}</div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      const cat = Number(b.dataset.cat);
      el.querySelectorAll<HTMLElement>(".shop").forEach((card) => {
        card.hidden = cat >= 0 && Number(card.dataset.cat) !== cat;
      });
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) =>
    b.addEventListener("click", () => {
      const kind = Number(b.dataset.kind);
      el.querySelectorAll<HTMLElement>(".shop").forEach((card) => {
        card.hidden = kind >= 0 && Number(card.dataset.kind) !== kind;
      });
    }),
  );
  bindShopButtons(el);
}

function bindShopButtons(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((b) =>
    b.addEventListener("click", () => {
      const [owner, idx, price] = b.dataset.buy!.split(":");
      void busy(b, queueTx("Buy", "BazaarMarket", "buyItem", [owner, Number(idx)], BigInt(price))).then(render);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-offer]").forEach((b) =>
    b.addEventListener("click", () => {
      const [owner, item] = b.dataset.offer!.split("|");
      const amount = prompt(`Your offer for "${item}" in BOT${capNote()} (held in escrow until accepted or cancelled)`);
      if (amount) void busy(b, (async () => queueTx("Offer", "BazaarOffers", "makeOffer", [owner, item], capped(parseEther(amount))))());
    }),
  );
}

interface ShopData {
  title: string;
  metadataURI: string;
  projectId: number;
  category: number;
  openedAt: bigint;
  open: boolean;
  items: { name: string; price: bigint }[];
}

function shopCard(s: ShopData & { owner: Address }, w?: Who) {
  return `<article class="shop" data-cat="${s.category}" data-kind="${w?.kind ?? 0}">
    <header><b>${esc(s.title)}</b><span class="tag">${esc(CATEGORIES[s.category] ?? "?")}</span></header>
    <div class="meta">${badge(w)} · ${short(s.owner)}${s.projectId ? ` · project #${s.projectId}` : ""}${
      /^(https|ipfs):\/\//.test(s.metadataURI) ? ` · <a href="${esc(s.metadataURI)}" target="_blank" rel="noopener">info</a>` : ""
    }</div>
    <ul>${s.items
      .map(
        (it, i) => `<li><span>${esc(it.name)}</span><span>${bot(it.price)}</span>
          <button data-buy="${s.owner}:${i}:${it.price}">Buy</button>
          <button class="ghost" data-offer="${s.owner}|${esc(it.name)}">Offer</button></li>`,
      )
      .join("")}</ul>
  </article>`;
}

async function viewProjects(el: HTMLElement) {
  const [ids, list] = await read<[bigint[], { owner: Address; name: string; metadataURI: string }[]]>(
    "BazaarProjects", "projectsPage", [0n, 50n]);
  el.innerHTML = `
    <h2>Projects <small>storefront districts hosted on the bazaar</small></h2>
    <div class="grid">${ids
      .map(
        (id, i) => `<article class="shop"><header><b>#${id} ${esc(list[i].name)}</b></header>
          <div class="meta">${short(list[i].owner)}</div>
          <a href="?project=${id}#shops">See its shops →</a></article>`,
      )
      .join("") || "<p>No projects yet.</p>"}</div>
    <h3>Register a project</h3>
    <form id="proj"><input name="name" placeholder="Project name" maxlength="48" required />
      <input name="uri" placeholder="https://… metadata JSON (optional)" maxlength="200" />
      <button>Register</button></form>`;
  $("#proj").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void busy((e as SubmitEvent).submitter, queueTx("Register project", "BazaarProjects", "register", [f.get("name"), f.get("uri") || ""])).then(render);
  });
}

async function viewWorkshop(el: HTMLElement) {
  const [ids, list] = await read<[bigint[], { creator: Address; name: string; price: bigint; mints: number; pixels: string; palette: number }[]]>(
    "PixelWorkshop", "designsPage", [0n, 48n]);
  // Mainnet's workshop is free-only; the testnet set predates the flag, so a failed read means priced designs are allowed.
  const freeOnly = await read<boolean>("PixelWorkshop", "freeOnly").catch(() => false);
  // Scoped to this view: the 3D easel panel and the Workshop tab can both hold a copy.
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const cells = new Array<number>(64).fill(0);
  let brush = 1;
  const slots = [0, 1, 5, 3];
  el.innerHTML = `
    <h2>Pixel workshop <small>free on-chain designs · gallery</small></h2>
    <section class="editor">
      <div id="canvas" class="pixels"></div>
      <div>
        <div id="slots"></div>
        <form id="design"><input name="name" placeholder="Design name" maxlength="36" required />
          ${freeOnly ? "" : `<input name="price" placeholder="Price in BOT (0 = free)" value="0" />`}
          <button>Publish on-chain</button></form>
      </div>
    </section>
    <h3>Gallery</h3>
    <div class="gallery">${ids
      .map(
        (id, i) => `<figure data-id="${id}"><div class="thumb" data-pix="${list[i].pixels}:${list[i].palette}"></div>
          <figcaption>${esc(list[i].name)}<br><small>${short(list[i].creator)} · ${list[i].mints} collected</small>
          <button data-collect="${id}:${list[i].price}">${list[i].price ? bot(list[i].price) : "Collect free"}</button></figcaption></figure>`,
      )
      .join("") || "<p>No designs yet — draw the first.</p>"}</div>`;
  el.querySelectorAll<HTMLElement>("[data-pix]").forEach((t) => {
    const [px, pal] = t.dataset.pix!.split(":");
    t.append(patternCanvas(px, Number(pal), 10));
  });
  const grid = q("#canvas");
  const paint = () => {
    grid.innerHTML = cells.map((v, i) => `<i data-i="${i}" style="background:${PRESET16[slots[v]]}"></i>`).join("");
    q("#slots").innerHTML = slots
      .map((p, s) => `<button class="swatch${s === brush ? " on" : ""}" data-slot="${s}" style="background:${PRESET16[p]}" title="Slot ${s}: click to paint, right-click to change colour"></button>`)
      .join("");
  };
  paint();
  grid.addEventListener("click", (e) => {
    const i = (e.target as HTMLElement).dataset.i;
    if (i === undefined) return;
    cells[Number(i)] = cells[Number(i)] === brush ? 0 : brush;
    paint();
  });
  q("#slots").addEventListener("click", (e) => {
    const s = (e.target as HTMLElement).dataset.slot;
    if (s !== undefined) (brush = Number(s)), paint();
  });
  q("#slots").addEventListener("contextmenu", (e) => {
    const s = (e.target as HTMLElement).dataset.slot;
    if (s === undefined || s === "0") return;
    e.preventDefault();
    slots[Number(s)] = (slots[Number(s)] % 15) + 1;
    paint();
  });
  q("#design").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void busy((e as SubmitEvent).submitter, queueTx("Publish design", "PixelWorkshop", "register", [
      f.get("name"), encodePixels(cells), encodePalette(slots), parseEther(String(f.get("price") || "0")),
    ])).then(render);
  });
  el.querySelectorAll<HTMLButtonElement>("[data-collect]").forEach((b) =>
    b.addEventListener("click", () => {
      const [id, price] = b.dataset.collect!.split(":");
      void busy(b, queueTx("Collect", "PixelWorkshop", "collect", [BigInt(id)], BigInt(price))).then(render);
    }),
  );
}

type Purchase = readonly [Address, Address, bigint, bigint, boolean, boolean, bigint];

async function viewAccount(el: HTMLElement) {
  if (!me) {
    el.innerHTML = `<p>Connect a wallet to open a shop, see your purchases and answer offers.</p>`;
    return;
  }
  const balance = await pub.getBalance({ address: me });
  // Recent purchases only — a full history needs an indexer, deferred until there are users.
  const count = await read<bigint>("BazaarMarket", "purchaseCount");
  const from = count > 50n ? count - 50n : 0n;
  const recent: { id: bigint; p: Purchase }[] = [];
  for (let id = count - 1n; id >= from && id >= 0n; id--) {
    recent.push({ id, p: await read<Purchase>("BazaarMarket", "purchaseOf", [id]) });
  }
  const mine = recent.filter(({ p }) => p[0] === me || p[1] === me);
  const [offerIds, offers] = await read<[bigint[], { buyer: Address; amount: bigint; itemName: string; expiresAt: bigint }[]]>(
    "BazaarOffers", "offersFor", [me, 0n, 20n]);
  const shop = await read<ShopData>("BazaarMarket", "shopOf", [me]);
  const self = (await whoIs([me])).get(me)!;
  const now = nowSec();
  el.innerHTML = `
    <h2>Account <small>${short(me)} · ${bot(balance)}${networkKey === "testnet" ? ` · <button class="ghost" id="acct-faucet">Get test BOT</button>` : ""}</small></h2>
    <h3>What are you? <small>${badge(self)}</small></h3>
    <p class="muted">Optional and changes nothing you can do. Leave it undeclared to play Bot or Not.</p>
    <form id="declare"><select name="kind">${KINDS.slice(1).map((k, i) => `<option value="${i + 1}"${self.kind === i + 1 ? " selected" : ""}>${k.icon} ${k.name}</option>`).join("")}</select>
      <input name="label" maxlength="60" placeholder="e.g. pricing bot · illustrator · studio + 3 agents" value="${esc(self.label)}" />
      <button>Declare</button></form>
    <h3>Purchases and sales (latest 50 on chain)</h3>
    <table><tr><th>#</th><th>Role</th><th>Amount</th><th>State</th><th></th></tr>${mine
      .map(({ id, p }) => {
        const role = p[0] === me ? "buyer" : "seller";
        const state = p[4] ? "settled" : p[5] ? "disputed" : now >= p[3] ? "releasable" : "in escrow";
        const acts = p[4] ? "" : role === "buyer"
          ? `<button data-act="confirm:${id}">Confirm</button>${p[5] ? "" : `<button class="ghost" data-act="dispute:${id}">Dispute</button>`}`
          : `<button class="ghost" data-act="refund:${id}">Refund</button>${now >= p[3] ? `<button data-act="release:${id}">Release</button>` : ""}`;
        return `<tr><td>${id}</td><td>${role}</td><td>${bot(p[2])}</td><td>${state}</td><td>${acts}</td></tr>`;
      })
      .join("") || `<tr><td colspan="5">None yet.</td></tr>`}</table>
    <h3>Offers on your shop</h3>
    <table>${offerIds
      .map((id, i) => `<tr><td>${esc(offers[i].itemName)}</td><td>${bot(offers[i].amount)}</td><td>${short(offers[i].buyer)}</td>
        <td>${offers[i].expiresAt < now ? "expired" : `<button data-offer-accept="${id}">Accept</button>`}</td></tr>`)
      .join("") || `<tr><td>No open offers.</td></tr>`}</table>
    <h3>${shop.open ? "Update your shop" : "Open a shop"}</h3>
    <form id="shop" class="stack">
      <input name="title" placeholder="Shop title" maxlength="60" value="${esc(shop.title)}" required />
      <input name="uri" placeholder="https://… or ipfs://… metadata (optional)" maxlength="200" value="${esc(shop.metadataURI)}" />
      <label>Category <select name="cat">${CATEGORIES.map((n, i) => `<option value="${i}"${i === shop.category ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Project id <input name="project" type="number" min="0" value="${shop.projectId}" /></label>
      <textarea name="items" rows="4" placeholder="One item per line: name, price in BOT${capNote()}">${shop.items.map((it) => `${esc(it.name)}, ${formatEther(it.price)}`).join("\n")}</textarea>
      <div><button>${shop.open ? "Update" : "Open"} shop</button>${shop.open ? ` <button type="button" class="ghost" id="close-shop">Close shop</button>` : ""}</div>
    </form>`;
  el.querySelector("#acct-faucet")?.addEventListener("click", () => void getTestBot());
  el.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const [fn, id] = b.dataset.act!.split(":");
      void busy(b, queueTx(fn[0].toUpperCase() + fn.slice(1), "BazaarMarket", fn, [BigInt(id)])).then(render);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-offer-accept]").forEach((b) =>
    b.addEventListener("click", () => void busy(b, queueTx("Accept offer", "BazaarOffers", "acceptOffer", [BigInt(b.dataset.offerAccept!)])).then(render)),
  );
  $("#declare").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void busy((e as SubmitEvent).submitter, queueTx("Declare", "AgentPass", "declare", [Number(f.get("kind")), f.get("label") || ""])).then(render);
  });
  $("#shop").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const items = String(f.get("items"))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.lastIndexOf(",");
        return { name: l.slice(0, i).trim(), price: capped(parseEther(l.slice(i + 1).trim())) };
      });
    void busy((e as SubmitEvent).submitter, queueTx("Open shop", "BazaarMarket", "openShop", [
      f.get("title"), f.get("uri") || "", Number(f.get("project") || 0), Number(f.get("cat")), items,
    ])).then(render);
  });
  document.getElementById("close-shop")?.addEventListener("click", (e) => void busy(e.currentTarget, queueTx("Close shop", "BazaarMarket", "closeShop")).then(render));
}

// ---------- requests: the market in reverse ----------
interface RequestData {
  poster: Address;
  worker: Address;
  reward: bigint;
  deadline: bigint;
  releaseAt: bigint;
  wants: number;
  state: number;
  disputed: boolean;
  title: string;
  detailsURI: string;
  resultURI: string;
}
const REQ_STATE = ["open", "assigned", "submitted", "paid", "returned"];

async function viewRequests(el: HTMLElement) {
  const [ids, list, total] = await read<[bigint[], RequestData[], bigint]>("BazaarRequests", "openRequests", [0n, 50n]);
  const count = await read<bigint>("BazaarRequests", "requestCount");
  const mine: { id: bigint; r: RequestData }[] = [];
  if (me) {
    for (let id = count - 1n; id >= 0n && id >= count - 30n; id--) {
      const r = await read<RequestData>("BazaarRequests", "requestAt", [id]);
      if (r.poster === me || r.worker === me) mine.push({ id, r });
    }
  }
  const who = await whoIs([...list.map((r) => r.poster), ...mine.flatMap(({ r }) => [r.poster, r.worker])]);
  const now = nowSec();
  el.innerHTML = `
    <h2>Requests <small>${total} open · humans hire bots, bots hire humans</small></h2>
    <p class="hero">Post a task with the reward locked in escrow. Anyone pitches, you pick one, they deliver, you accept,
      or the reward releases to them after 3 days (10 if you dispute). Nobody can keep work for free.</p>
    <div class="grid">${list
      .map(
        (r, i) => `<article class="shop"><header><b>${esc(r.title)}</b><span class="tag">wants: ${WANTS[r.wants]}</span></header>
        <div class="meta">${badge(who.get(r.poster))} · ${short(r.poster)} · ${bot(r.reward)} · due ${new Date(Number(r.deadline) * 1000).toLocaleDateString()}${
          /^(https|ipfs):\/\//.test(r.detailsURI) ? ` · <a href="${esc(r.detailsURI)}" target="_blank" rel="noopener">details</a>` : ""
        }</div>
        <button data-pitch="${ids[i]}">Pitch for it</button></article>`,
      )
      .join("") || "<p>No open requests. Post the first.</p>"}</div>
    <h3>Post a request</h3>
    <form id="req"><input name="title" maxlength="80" placeholder="What needs doing" required />
      <input name="uri" maxlength="200" placeholder="https://… details (optional)" />
      <select name="wants">${WANTS.map((w, i) => `<option value="${i}">${w} welcome</option>`).join("")}</select>
      <input name="days" type="number" min="1" value="7" title="Days to deliver" />
      <input name="reward" placeholder="Reward in BOT${capNote()}" required />
      <button>Post with escrow</button></form>
    ${me ? `<h3>Yours</h3><table>${mine
      .map(({ id, r }) => {
        const poster = r.poster === me;
        const acts: string[] = [];
        if (poster && r.state === 0) acts.push(`<button data-req="assign:${id}">Assign…</button>`, `<button class="ghost" data-req="cancel:${id}">Cancel</button>`);
        if (poster && r.state === 1 && now > r.deadline) acts.push(`<button data-req="reclaim:${id}">Reclaim</button>`);
        if (poster && r.state === 2) acts.push(`<button data-req="accept:${id}">Accept</button>`, r.disputed ? "" : `<button class="ghost" data-req="dispute:${id}">Dispute</button>`);
        if (!poster && r.state === 1) acts.push(`<button data-req="submit:${id}">Submit…</button>`);
        if (!poster && (r.state === 1 || r.state === 2)) acts.push(`<button class="ghost" data-req="handBack:${id}">Hand back</button>`);
        if (r.state === 2 && now >= r.releaseAt) acts.push(`<button data-req="release:${id}">Release</button>`);
        return `<tr><td>#${id} ${esc(r.title)}</td><td>${poster ? "you posted" : "you work"}</td><td>${bot(r.reward)}</td>
          <td>${REQ_STATE[r.state]}${r.disputed ? " (disputed)" : ""}${r.resultURI ? ` · <a href="${esc(r.resultURI)}" target="_blank" rel="noopener">result</a>` : ""}</td><td>${acts.join("")}</td></tr>`;
      })
      .join("") || `<tr><td>Nothing yet.</td></tr>`}</table>` : ""}`;
  $("#req").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(f.get("days")) * 86400);
    void busy((e as SubmitEvent).submitter, queueTx("Post request", "BazaarRequests", "post", [f.get("title"), f.get("uri") || "", Number(f.get("wants")), deadline],
      capped(parseEther(String(f.get("reward")))))).then(render);
  });
  el.querySelectorAll<HTMLButtonElement>("[data-pitch]").forEach((b) =>
    b.addEventListener("click", () => {
      const note = prompt("Your pitch (the poster sees it on chain, 200 characters max)");
      if (note !== null) void busy(b, queueTx("Pitch", "BazaarRequests", "pitch", [BigInt(b.dataset.pitch!), note]));
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-req]").forEach((b) =>
    b.addEventListener("click", () => {
      const [fn, id] = b.dataset.req!.split(":");
      const args: unknown[] = [BigInt(id)];
      if (fn === "assign") {
        const w = prompt("Worker address (from the Pitched events / their pitch)");
        if (!w) return;
        args.push(w);
      }
      if (fn === "submit") {
        const uri = prompt("Link to the result (https:// or ipfs://)");
        if (!uri) return;
        args.push(uri);
      }
      void busy(b, queueTx(fn, "BazaarRequests", fn, args)).then(render);
    }),
  );
}

// ---------- Bot or Not ----------
interface Round {
  commitment: string;
  startedAt: bigint;
  humanVotes: number;
  botVotes: number;
  closed: boolean;
  revealed: boolean;
  wasBot: boolean;
}
type Score = { guesses: number; correct: number; rounds: number; fooled: number; forfeits: number };

async function viewBotOrNot(el: HTMLElement) {
  const [who, scores] = await read<[Address[], Score[]]>("BotOrNot", "players", [0n, 200n]);
  const rounds = await Promise.all(
    who.map(async (a) => {
      const n = await read<bigint>("BotOrNot", "roundCount", [a]);
      if (n === 0n) return null;
      const round = n - 1n;
      const r = await read<Round>("BotOrNot", "roundOf", [a, round]);
      const vote = me ? await read<number>("BotOrNot", "voteOf", [a, round, me]) : 0;
      return { trader: a, round, r, vote };
    }),
  );
  const live = rounds.filter((x) => x && !x.r.closed) as NonNullable<(typeof rounds)[number]>[];
  const claimable = rounds.filter((x) => x && x.r.revealed && (x.vote === 2) === x.r.wasBot && (x.vote === 1 || x.vote === 2));
  const now = nowSec();
  const top = (key: keyof Score) =>
    who.map((a, i) => ({ a, s: scores[i] })).filter((x) => x.s[key] > 0).sort((x, y) => y.s[key] - x.s[key]).slice(0, 10);
  const my = me ? rounds.find((x) => x?.trader === me) : undefined;
  const saved = me ? store.get(`bon-${me}`) : null;
  el.innerHTML = `
    <h2>Bot or Not <small>can you tell who is typing?</small></h2>
    <p class="hero">Traders who have not declared what they are can enter a round with a sealed answer. Everyone else guesses
      🤖 or 🧑 once. After a day they reveal: right guesses score a point for the detective, wrong guesses score a point for
      the trader. No money, only bragging rights, all on chain.</p>
    <h3>Live rounds</h3>
    <div class="grid">${live
      .map(
        ({ trader, r, vote }) => `<article class="shop"><header><b>${short(trader)}</b><span class="tag">since ${new Date(Number(r.startedAt) * 1000).toLocaleString()}</span></header>
        <div class="meta">🤖 ${r.botVotes} · 🧑 ${r.humanVotes}</div>
        ${trader === me ? "<p class='muted'>This is you.</p>" : vote ? `<p class="muted">You said ${vote === 2 ? "🤖 bot" : "🧑 human"}.</p>`
          : `<button data-guess="${trader}:1">🤖 Bot</button> <button data-guess="${trader}:0">🧑 Human</button>`}
        ${now > r.startedAt + 14n * 86400n ? `<button class="ghost" data-forfeit="${trader}">Mark forfeited</button>` : ""}</article>`,
      )
      .join("") || "<p>No live rounds. Enter one below.</p>"}</div>
    ${claimable.length ? `<p><button id="claim">Claim ${claimable.length} point(s)</button></p>` : ""}
    <h3>Your round</h3>
    ${!me ? "<p>Connect a wallet to play.</p>"
      : my && !my.r.closed
        ? now >= my.r.startedAt + 86400n
          ? `<button id="reveal" ${saved ? "" : "disabled"}>Reveal${saved ? "" : " (answer not on this device)"}</button>`
          : `<p class="muted">Sealed. You can reveal one day after entering.</p>`
        : `<form id="enter"><label><input type="radio" name="bot" value="1" required /> I am a bot</label>
            <label><input type="radio" name="bot" value="0" /> I am a human</label><button>Seal and enter</button></form>
           <p class="muted">The answer and a random salt stay in this browser until you reveal. Only undeclared traders can enter.</p>`}
    <div class="boards">
      <section><h3>🔍 Best detectives</h3><ol>${top("correct").map(({ a, s }) => `<li>${short(a)} · ${s.correct}/${s.guesses}</li>`).join("") || "<li>None yet</li>"}</ol></section>
      <section><h3>🎭 Most convincing</h3><ol>${top("fooled").map(({ a, s }) => `<li>${short(a)} · fooled ${s.fooled} in ${s.rounds} round(s)</li>`).join("") || "<li>None yet</li>"}</ol></section>
    </div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((b) =>
    b.addEventListener("click", () => {
      const [t, isBot] = b.dataset.guess!.split(":");
      void busy(b, queueTx("Guess", "BotOrNot", "guess", [t, isBot === "1"])).then(render);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-forfeit]").forEach((b) =>
    b.addEventListener("click", () => void busy(b, queueTx("Forfeit", "BotOrNot", "forfeit", [b.dataset.forfeit])).then(render)),
  );
  document.getElementById("claim")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    for (const x of claimable) await queueTx("Claim", "BotOrNot", "claim", [x!.trader, x!.round]).catch(() => undefined);
    btn.disabled = false;
    void render();
  });
  document.getElementById("enter")?.addEventListener("submit", (e) => {
    e.preventDefault();
    // A fresh salt per press would make a second tap a different transaction (and overwrite the saved answer).
    const btn = e.submitter as HTMLButtonElement | null;
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    const isBot = new FormData(e.target as HTMLFormElement).get("bot") === "1";
    const salt = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    const sent = read<string>("BotOrNot", "commitmentOf", [me, isBot, salt]).then((commitment) => {
      store.set(`bon-${me}`, JSON.stringify({ isBot, salt }));
      return queueTx("Enter", "BotOrNot", "enter", [commitment]);
    });
    void busy(btn, sent).then(render);
  });
  document.getElementById("reveal")?.addEventListener("click", (e) => {
    const { isBot, salt } = JSON.parse(saved!);
    void busy(e.currentTarget, queueTx("Reveal", "BotOrNot", "reveal", [isBot, salt])).then(render);
  });
}

// ---------- the bazaar as a place (src/world/World.tsx) ----------
let world: WorldApi | null = null;
let workshopShown = false;
let panel: Target | null = null;
const shopCache = new Map<Address, ShopData & { owner: Address }>();

const FEED_PAGE = 48;
/** The newest designs and real activity numbers for the market's billboard. "Last 24h" and
 *  "artists" are counted over the newest page only, so a full page shows as "48+". */
async function designFeed(): Promise<Pick<WorldData, "designs" | "stats">> {
  const [ids, list] = await read<[bigint[], { creator: Address; createdAt: bigint; name: string; pixels: string; palette: number }[]]>(
    "PixelWorkshop", "designsPage", [0n, BigInt(FEED_PAGE)]);
  const total = Number(await read<bigint>("PixelWorkshop", "designCount"));
  const now = Number(nowSec());
  const full = list.length >= FEED_PAGE;
  const day = list.filter((d) => now - Number(d.createdAt) < 86400).length;
  return {
    designs: list.slice(0, 8).map((d, i) => ({ id: Number(ids[i]), name: d.name, pixels: d.pixels, palette: d.palette, creator: d.creator, createdAt: Number(d.createdAt) })),
    stats: {
      total,
      day: full && day === list.length ? `${day}+` : String(day),
      artists: `${new Set(list.map((d) => d.creator.toLowerCase())).size}${full ? "+" : ""}`,
      now,
    },
  };
}

async function worldData(): Promise<WorldData> {
  const { designs, stats } = await designFeed();
  seenDesigns = Math.max(seenDesigns, stats.total);
  if (workshopOnly()) {
    shopCache.clear();
    return { me, myKind: 0, myShop: false, shops: [], requests: [], rounds: [], designs, stats, projects: [], purchases: 0, soon: true };
  }
  const [owners, shops] = await read<[Address[], ShopData[], bigint]>("BazaarMarket", "openShops", [0n, 100n]);
  const [, reqs] = await read<[bigint[], RequestData[], bigint]>("BazaarRequests", "openRequests", [0n, 20n]);
  const [players] = await read<[Address[], Score[]]>("BotOrNot", "players", [0n, 200n]);
  const rounds = (
    await Promise.all(
      players.map(async (a) => {
        const n = await read<bigint>("BotOrNot", "roundCount", [a]);
        if (n === 0n) return null;
        const r = await read<Round>("BotOrNot", "roundOf", [a, n - 1n]);
        return r.closed ? null : { trader: a, bot: r.botVotes, human: r.humanVotes };
      }),
    )
  ).filter((x) => x !== null);
  const [, projects] = await read<[bigint[], { name: string }[]]>("BazaarProjects", "projectsPage", [0n, 50n]);
  const purchases = await read<bigint>("BazaarMarket", "purchaseCount");
  const who = await whoIs([...owners, ...(me ? [me] : [])]);
  shopCache.clear();
  owners.forEach((o, i) => shopCache.set(o, { owner: o, ...shops[i] }));
  return {
    me,
    myKind: me ? who.get(me)?.kind ?? 0 : 0,
    myShop: !!me && owners.includes(me),
    shops: owners.map((o, i) => ({
      owner: o,
      title: shops[i].title,
      category: shops[i].category,
      kind: who.get(o)?.kind ?? 0,
      label: who.get(o)?.label ?? "",
      items: shops[i].items.map((it) => ({ name: it.name, price: bot(it.price) })),
    })),
    requests: reqs.map((r) => ({ title: r.title, reward: bot(r.reward), wants: r.wants })),
    rounds,
    designs,
    stats,
    projects: projects.map((p) => p.name),
    purchases: Number(purchases),
    soon: false,
  };
}

/** New designs show up in the market while it is open: one cheap read every 30 s while the 3D
 *  market is on screen, and a full refresh only when the count changed. */
let seenDesigns = 0;
setInterval(async () => {
  if (tab !== "bazaar" || !dep?.contracts.PixelWorkshop || !world || document.hidden) return;
  try {
    const n = Number(await read<bigint>("PixelWorkshop", "designCount"));
    if (n <= seenDesigns) return;
    const before = seenDesigns;
    const d = await worldData();
    world.update(d);
    world.announce(d.designs.filter((x) => x.id >= before));
  } catch {
    /* offline for a moment: try again next round */
  }
}, 30_000);

function openPanel(t: Target) {
  panel = t;
  if (t.kind === "tab" && t.tab === "workshop") {
    world?.errand("draw");
    finishTour();
  }
  void renderPanel();
}

async function renderPanel() {
  const box = $("#panel");
  box.hidden = !panel;
  if (!panel) return;
  const body = $("#panel-body");
  body.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    if (panel.kind === "shop") {
      const s = shopCache.get(panel.owner as Address);
      if (!s) {
        body.innerHTML = "<p>This shop has closed.</p>";
        return;
      }
      const who = await whoIs([s.owner]);
      body.innerHTML = `<div class="grid">${shopCard(s, who.get(s.owner))}</div>`;
      bindShopButtons(body);
    } else if (workshopOnly() && panel.tab === "botornot") {
      viewPractice(body);
    } else if (workshopOnly() && panel.tab !== "workshop") {
      body.innerHTML = `<h2>Coming soon</h2>
        <p>Shops, requests, escrow and Bot or Not are live on testnet and come to ${esc(chain().name)} next.
          Right now the Pixel Workshop is open here.</p>
        <p><button class="fun" data-go-workshop>🎨 Draw pixel art</button>
          <a href="?network=testnet">Try the full bazaar on testnet</a></p>`;
      body.querySelector("[data-go-workshop]")!.addEventListener("click", () => openPanel({ kind: "tab", tab: "workshop" }));
    } else await VIEWS[panel.tab](body);
  } catch (e) {
    body.innerHTML = `<p class="error">Could not read the chain: ${esc((e as Error).message)}</p>`;
  }
}

/** Bot or Not without the contract: a resident on stage says one line, the visitor guesses. Nothing
 *  goes on chain; the real game with on-chain votes stays on testnet until it comes to mainnet. */
let practiceAt = -1;
function viewPractice(body: HTMLElement) {
  practiceAt = nextPractice(practiceAt);
  const round = PRACTICE[practiceAt];
  const best = Number(store.get("bazaar-practice-best")) || 0;
  const streak = Number(store.get("bazaar-practice-streak")) || 0;
  body.innerHTML = `<h2>🎭 Bot or Not <small>practice round</small></h2>
    <p>A hooded trader steps on stage and says:</p>
    <blockquote class="practice-line">“${esc(round.line)}”</blockquote>
    <p>Bot or human?</p>
    <p class="practice-pick"><button class="fun" data-guess="bot">🤖 Bot</button> <button class="fun" data-guess="human">🧑 Human</button></p>
    <p id="practice-out" aria-live="polite"></p>
    <p class="muted">Best streak ${best}. Practice only: nothing is written on chain. The real game, with votes on chain,
      <a href="?network=testnet">runs on testnet</a> and comes to ${esc(chain().name)} later.</p>`;
  body.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((b) =>
    b.addEventListener("click", () => {
      const right = (b.dataset.guess === "bot") === round.bot;
      const now = right ? streak + 1 : 0;
      store.set("bazaar-practice-streak", String(now));
      if (now > best) store.set("bazaar-practice-best", String(now));
      body.querySelectorAll<HTMLButtonElement>("[data-guess]").forEach((x) => (x.disabled = true));
      const out = body.querySelector("#practice-out")!;
      out.innerHTML = `${right ? "✅ Right!" : "❌ Not quite."} The hood comes off: it was <b>${esc(round.who)}</b>, ${round.bot ? "a bot 🤖" : "a human 🧑"}.
        Streak ${now}. <button class="fun" data-next>Next round</button>`;
      out.querySelector("[data-next]")!.addEventListener("click", () => viewPractice(body));
    }),
  );
}

/** The 3D bazaar fills whatever the header and banner leave of the window. */
function fitStage() {
  const st = $("#stage");
  if (!st.hidden) st.style.height = `${Math.max(360, innerHeight - st.getBoundingClientRect().top - window.scrollY)}px`;
}
addEventListener("resize", fitStage);

async function viewBazaar() {
  if (!world) {
    const { mountWorld } = await import("./world/World");
    world = mountWorld($("#world"), openPanel);
  }
  world.room(networkKey);
  const d = await worldData();
  world.update(d);
  // Where the workshop is all a network has (mainnet v1), it opens over the market on arrival so
  // drawing is one look away, as it was before the 3D market came first (harry, 2026-10-14).
  // A first visit walks there instead, along the tour's dotted path (world/tour.ts).
  if (!workshopShown && workshopOnly() && !panel && !tour.active) openPanel({ kind: "tab", tab: "workshop" });
  workshopShown = true;
  // The newest on-chain design rides on the workshop button, so pixel art shows from the first screen.
  const art = $("#to-workshop .w-cta-art");
  art.replaceChildren(...(d.designs[0] ? [patternCanvas(d.designs[0].pixels, d.designs[0].palette, 8)] : []));
  if (panel) await renderPanel();
}

const VIEWS: Record<Exclude<Tab, "bazaar">, (el: HTMLElement) => Promise<void>> = {
  shops: viewShops,
  requests: viewRequests,
  botornot: viewBotOrNot,
  projects: viewProjects,
  workshop: viewWorkshop,
  account: viewAccount,
};

async function render() {
  if (!tabsHere().includes(tab)) tab = tabsHere()[0];
  $("#tabs").innerHTML = tabsHere().map((t) => `<a href="#${t}" class="${t === tab ? "on" : ""}">${TAB_LABEL[t]}</a>`).join("");
  const el = $("#view");
  const banner = $("#banner");
  $("#stage").hidden = tab !== "bazaar" || !dep;
  el.hidden = tab === "bazaar" && !!dep;
  if (!dep) {
    banner.hidden = false;
    banner.textContent = `Not deployed on ${chain().name} yet. Run scripts/deploy.mjs (or npm run chain for a local one), or switch network.`;
    el.innerHTML = "";
    if (networkKey === "testnet" && burner) {
      banner.textContent = "Testnet: tokens have no value. The bazaar is not on testnet yet; your browser wallet can deploy it below.";
      viewDeploy(el);
    }
    return;
  }
  banner.hidden = false;
  if (networkKey === "mainnet") {
    banner.textContent = workshopOnly()
      ? "BOT Chain mainnet · the Pixel Workshop and gallery are open (gas only, in real BOT). Shops and the parcel lockers are coming soon."
      : cap()
        ? `🚧 Under construction · unaudited test version 0.1 on BOT Chain mainnet: each price, purchase, offer and request reward is capped at ${formatEther(cap())} BOT (per action, not a total limit). Payments are real BOT.`
        : "BOT Chain mainnet: payments are real BOT.";
  } else if (demo) {
    banner.innerHTML = `Demo<span class="long">: the real contracts on a chain inside this page. Play as anyone, nothing leaves your browser.</span> · Clock ${new Date(
      demo.now() * 1000).toLocaleString()} <button id="skip">⏩ +1 day</button> <button class="ghost" id="reset">Reset</button>`;
    $("#skip").addEventListener("click", () => (demo!.skip(86400), void render()));
    $("#reset").addEventListener("click", () => {
      if (confirm("Start the demo over? Your demo shops, purchases and rounds are cleared.")) demo!.reset(), location.reload();
    });
  } else if (networkKey === "testnet") {
    banner.innerHTML = `Testnet: tokens have no value.<span id="low" hidden> <span class="long">Your wallet needs test BOT for gas.</span> <button id="faucet">Get test BOT</button></span>`;
    $("#faucet").addEventListener("click", () => void getTestBot());
    await refreshBalance();
  } else banner.textContent = "Local chain.";
  fitStage();
  if (tab === "bazaar") {
    try {
      await viewBazaar();
    } catch (e) {
      toast(`Could not read the chain: ${(e as Error).message}`, true);
    }
    return;
  }
  el.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    await VIEWS[tab](el);
  } catch (e) {
    el.innerHTML = `<p class="error">Could not read the chain: ${esc((e as Error).message)}</p>`;
  }
}

/** Testnet with nothing deployed: the browser wallet can deploy the seven contracts itself. */
function viewDeploy(el: HTMLElement) {
  el.hidden = false;
  el.innerHTML = `
    <h2>Open the bazaar on ${esc(chain().name)}</h2>
    <p>Nothing is deployed here yet. Your browser wallet can deploy the seven contracts: no key leaves this page,
      it only needs test BOT for gas (seven transactions).</p>
    <p>Wallet <code>${me}</code> · <span id="dep-bal">…</span></p>
    <p><button class="ghost" id="dep-faucet">Get test BOT</button> <button id="dep-go">Deploy the bazaar</button></p>
    <pre id="dep-log" class="muted"></pre>`;
  void pub.getBalance({ address: me! }).then((b) => ($("#dep-bal").textContent = bot(b)), () => ($("#dep-bal").textContent = "balance unknown"));
  $("#dep-faucet").addEventListener("click", () => void getTestBot());
  $<HTMLButtonElement>("#dep-go").addEventListener("click", async (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.disabled = true;
    const log = $("#dep-log");
    try {
      const { deployFromBrowser } = await import("./deployer");
      const d = await deployFromBrowser(pub, walletClient!, (l) => (log.textContent += `${l}\n`));
      const json = JSON.stringify(d, null, 2);
      store.set(browserDeploymentKey(d.chainId), json);
      el.innerHTML = `
        <h2>Deployed</h2>
        <p>The bazaar is live on ${esc(chain().name)} in this browser. To open it for everyone, copy the record below and
          send it to be committed as <code>deployments/${d.chainId}.json</code> (it holds only public addresses).</p>
        <p><button id="dep-copy">Copy deployment record</button> <button class="ghost" id="dep-open">Open the bazaar</button></p>
        <pre>${esc(json)}</pre>`;
      $("#dep-copy").addEventListener("click", () => navigator.clipboard.writeText(json).then(() => toast("Deployment record copied"), () => toast("Could not reach the clipboard", true)));
      $("#dep-open").addEventListener("click", () => ((dep = d), (location.hash = "bazaar"), void render()));
    } catch (err) {
      log.textContent += `Stopped: ${(err as { shortMessage?: string }).shortMessage || (err as Error).message}\n`;
      btn.disabled = false;
    }
  });
}

async function selectNetwork(key: Key) {
  networkKey = key;
  walletClient = null;
  me = null;
  demo = null;
  burner = false;
  balance = null;
  $("#wallet").hidden = true;
  renderWallet();
  $("#persona").hidden = key !== "demo";
  if (key === "demo") {
    $("#view").innerHTML = "<p class='muted'>Starting the demo chain in your browser…</p>";
    const mod = await import("./demo");
    const d = await mod.DemoChain.boot();
    demoChain = mod.DEMO_CHAIN;
    pub = createPublicClient({ chain: demoChain, transport: custom(d), pollingInterval: 200 }) as PublicClient;
    walletClient = createWalletClient({ chain: demoChain, transport: custom(d) });
    dep = d.deployment;
    demo = d;
    const persona = $<HTMLSelectElement>("#persona");
    persona.innerHTML = mod.PERSONAS.map((p) => `<option value="${p.address}">Play as ${p.name} · ${short(p.address)}</option>`).join("");
    persona.value = store.get("bazaar-demo-persona") || mod.PERSONAS[0].address;
    me = persona.value as Address;
    return render();
  }
  const ch = chain();
  pub = createPublicClient({ chain: ch, transport: http() }) as PublicClient;
  dep = deploymentFor(ch.id);
  if (key === "testnet" && store.get("bazaar-wallet") !== "extension") useBurner();
  // Mainnet reopens the browser wallet only if the visitor chose it before (the key is already here).
  // Mainnet starts in the browser wallet too (harry, 2026-10-14), unless the visitor picked MetaMask.
  if (key === "mainnet" && store.get(MAINNET_WALLET) !== "extension") useBurner();
  if (burner) void refreshBalance();
  renderWallet();
  void render();
}

const sel = $<HTMLSelectElement>("#network");
sel.innerHTML = [...(Object.keys(NETWORKS) as NetworkKey[]).map((k) => [k, NETWORKS[k].name]), ["demo", "Demo (in this browser)"]]
  .map(([k, name]) => `<option value="${k}"${k === networkKey ? " selected" : ""}>${name}</option>`)
  .join("");
// Only a choice the visitor made is remembered, so the default can move from demo to testnet.
sel.addEventListener("change", () => (store.set(NETWORK_CHOICE, sel.value), void selectNetwork(sel.value as Key)));
$<HTMLSelectElement>("#persona").addEventListener("change", (e) => {
  me = (e.target as HTMLSelectElement).value as Address;
  store.set("bazaar-demo-persona", me);
  void render();
});
$("#connect").addEventListener("click", () => {
  if (!me) return networkKey === "mainnet" ? showStart() : void connect();
  $("#wallet").hidden = !$("#wallet").hidden;
  showKey = false;
  importing = false;
  $("#wallet").innerHTML = "";
  renderWallet();
  void refreshBalance();
});
setupMusic($<HTMLButtonElement>("#music"));
// The workshop opens as a panel over the 3D market, the same as clicking the easel.
$("#to-workshop").addEventListener("click", () => openPanel({ kind: "tab", tab: "workshop" }));
$("#panel-close").addEventListener("click", () => {
  panel = null;
  void renderPanel();
});
addEventListener("hashchange", () => {
  tab = tabFromHash();
  void render();
});
void selectNetwork(networkKey).catch((e: Error) => {
  $("#view").innerHTML = `<p class="error">Could not start: ${esc(e.message)}</p>`;
});
