// BOT Bazaar web client — one page, no framework. Every read goes through `pub`, every write
// through `queueTx` (one wallet, one queue: parallel sends from the same account collide on nonce).
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  parseEther,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import abiJson from "./abi.json";
import { deploymentFor, type Deployment } from "./deployments";
import { FAUCET, NETWORKS, type NetworkKey } from "./networks";
import { PRESET16, encodePalette, encodePixels, patternCanvas } from "./pixel";
import "./style.css";

type Name = keyof Deployment["contracts"];
const ABI = abiJson as unknown as Record<Name, readonly unknown[]>;

const CATEGORIES = ["Goods (B2C)", "Service (B2B)", "Developer asset", "Agent service"];
const TABS = ["shops", "projects", "workshop", "account"] as const;
type Tab = (typeof TABS)[number];

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

let networkKey = (store.get("bazaar-network") as NetworkKey) || "testnet";
let tab: Tab = (location.hash.slice(1) as Tab) || "shops";
if (!TABS.includes(tab)) tab = "shops";
let pub: PublicClient;
let dep: Deployment | null = null;
let walletClient: WalletClient | null = null;
let me: Address | null = null;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const bot = (wei: bigint) => `${formatEther(wei)} BOT`;

function chain() {
  return NETWORKS[networkKey];
}
function c(name: Name) {
  if (!dep) throw new Error("not deployed on this network");
  return { address: dep.contracts[name].address, abi: ABI[name] } as const;
}
function read<T>(name: Name, functionName: string, args: unknown[] = []): Promise<T> {
  return pub.readContract({ ...c(name), functionName, args } as never) as Promise<T>;
}

// ---------- writes ----------
let queue: Promise<unknown> = Promise.resolve();
function queueTx(label: string, name: Name, functionName: string, args: unknown[] = [], value?: bigint) {
  const run = async () => {
    if (!walletClient || !me) throw new Error("Connect a wallet first");
    toast(`${label}: confirm in your wallet…`);
    const { request } = await pub.simulateContract({ ...c(name), functionName, args, value, account: me } as never);
    const hash = await walletClient.writeContract(request as never);
    toast(`${label}: sent, waiting for the block…`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted`);
    toast(`${label}: done`);
    return r;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next.catch((e: Error) => {
    toast(`${label}: ${(e as { shortMessage?: string }).shortMessage || e.message}`, true);
    throw e;
  });
}

function toast(msg: string, error = false) {
  const t = document.createElement("div");
  t.className = `toast${error ? " error" : ""}`;
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}

async function connect() {
  const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
  if (!eth) return toast("No browser wallet found (MetaMask, Rabby, OKX…)", true);
  const ch = chain();
  const hex = `0x${ch.id.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
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
  }
  walletClient = createWalletClient({ chain: ch, transport: custom(eth) });
  [me] = await walletClient.requestAddresses();
  $("#connect").textContent = short(me);
  render();
}

// ---------- views ----------
async function viewShops(el: HTMLElement) {
  const projectFilter = Number(new URLSearchParams(location.search).get("project") || 0);
  const [owners, shops, total] = await read<[Address[], ShopData[], bigint]>("BazaarMarket", "openShops", [0n, 100n]);
  const rows = owners
    .map((o, i) => ({ owner: o, ...shops[i] }))
    .filter((s) => !projectFilter || s.projectId === projectFilter);
  el.innerHTML = `
    <h2>Open shops <small>${total} on chain${projectFilter ? ` · project #${projectFilter}` : ""}</small></h2>
    <div class="filters">${["All", ...CATEGORIES].map((cName, i) => `<button data-cat="${i - 1}">${cName}</button>`).join("")}</div>
    <div class="grid" id="shop-grid">${rows.map(shopCard).join("") || "<p>No shops yet. Open the first one from Account.</p>"}</div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) =>
    b.addEventListener("click", () => {
      const cat = Number(b.dataset.cat);
      el.querySelectorAll<HTMLElement>(".shop").forEach((card) => {
        card.hidden = cat >= 0 && Number(card.dataset.cat) !== cat;
      });
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((b) =>
    b.addEventListener("click", () => {
      const [owner, idx, price] = b.dataset.buy!.split(":");
      void queueTx("Buy", "BazaarMarket", "buyItem", [owner, Number(idx)], BigInt(price)).then(render);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-offer]").forEach((b) =>
    b.addEventListener("click", () => {
      const [owner, item] = b.dataset.offer!.split("|");
      const amount = prompt(`Your offer for "${item}" in BOT (held in escrow until accepted or cancelled)`);
      if (amount) void queueTx("Offer", "BazaarOffers", "makeOffer", [owner, item], parseEther(amount));
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

function shopCard(s: ShopData & { owner: Address }) {
  return `<article class="shop" data-cat="${s.category}">
    <header><b>${esc(s.title)}</b><span class="tag">${esc(CATEGORIES[s.category] ?? "?")}</span></header>
    <div class="meta">${short(s.owner)}${s.projectId ? ` · project #${s.projectId}` : ""}${
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
    void queueTx("Register project", "BazaarProjects", "register", [f.get("name"), f.get("uri") || ""]).then(render);
  });
}

async function viewWorkshop(el: HTMLElement) {
  const [ids, list] = await read<[bigint[], { creator: Address; name: string; price: bigint; mints: number; pixels: string; palette: number }[]]>(
    "PixelWorkshop", "designsPage", [0n, 48n]);
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
          <input name="price" placeholder="Price in BOT (0 = free)" value="0" />
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
  const grid = $("#canvas");
  const paint = () => {
    grid.innerHTML = cells.map((v, i) => `<i data-i="${i}" style="background:${PRESET16[slots[v]]}"></i>`).join("");
    $("#slots").innerHTML = slots
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
  $("#slots").addEventListener("click", (e) => {
    const s = (e.target as HTMLElement).dataset.slot;
    if (s !== undefined) (brush = Number(s)), paint();
  });
  $("#slots").addEventListener("contextmenu", (e) => {
    const s = (e.target as HTMLElement).dataset.slot;
    if (s === undefined || s === "0") return;
    e.preventDefault();
    slots[Number(s)] = (slots[Number(s)] % 15) + 1;
    paint();
  });
  $("#design").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    void queueTx("Publish design", "PixelWorkshop", "register", [
      f.get("name"), encodePixels(cells), encodePalette(slots), parseEther(String(f.get("price") || "0")),
    ]).then(render);
  });
  el.querySelectorAll<HTMLButtonElement>("[data-collect]").forEach((b) =>
    b.addEventListener("click", () => {
      const [id, price] = b.dataset.collect!.split(":");
      void queueTx("Collect", "PixelWorkshop", "collect", [BigInt(id)], BigInt(price)).then(render);
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
  const now = BigInt(Math.floor(Date.now() / 1000));
  el.innerHTML = `
    <h2>Account <small>${short(me)} · ${bot(balance)}${networkKey === "testnet" ? ` · <a href="${FAUCET}" target="_blank" rel="noopener">faucet</a>` : ""}</small></h2>
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
      <textarea name="items" rows="4" placeholder="One item per line: name, price in BOT">${shop.items.map((it) => `${esc(it.name)}, ${formatEther(it.price)}`).join("\n")}</textarea>
      <div><button>${shop.open ? "Update" : "Open"} shop</button>${shop.open ? ` <button type="button" class="ghost" id="close-shop">Close shop</button>` : ""}</div>
    </form>`;
  el.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const [fn, id] = b.dataset.act!.split(":");
      void queueTx(fn[0].toUpperCase() + fn.slice(1), "BazaarMarket", fn, [BigInt(id)]).then(render);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>("[data-offer-accept]").forEach((b) =>
    b.addEventListener("click", () => void queueTx("Accept offer", "BazaarOffers", "acceptOffer", [BigInt(b.dataset.offerAccept!)]).then(render)),
  );
  $("#shop").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const items = String(f.get("items"))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.lastIndexOf(",");
        return { name: l.slice(0, i).trim(), price: parseEther(l.slice(i + 1).trim()) };
      });
    void queueTx("Open shop", "BazaarMarket", "openShop", [
      f.get("title"), f.get("uri") || "", Number(f.get("project") || 0), Number(f.get("cat")), items,
    ]).then(render);
  });
  document.getElementById("close-shop")?.addEventListener("click", () => void queueTx("Close shop", "BazaarMarket", "closeShop").then(render));
}

const VIEWS: Record<Tab, (el: HTMLElement) => Promise<void>> = {
  shops: viewShops,
  projects: viewProjects,
  workshop: viewWorkshop,
  account: viewAccount,
};

async function render() {
  $("#tabs").innerHTML = TABS.map((t) => `<a href="#${t}" class="${t === tab ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</a>`).join("");
  const el = $("#view");
  const banner = $("#banner");
  if (!dep) {
    banner.hidden = false;
    banner.textContent = `Not deployed on ${chain().name} yet. Run scripts/deploy.mjs (or npm run chain for a local one), or switch network.`;
    el.innerHTML = "";
    return;
  }
  banner.hidden = networkKey !== "mainnet" ? false : true;
  banner.textContent = networkKey === "testnet" ? "Testnet: tokens have no value." : "Local chain.";
  el.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    await VIEWS[tab](el);
  } catch (e) {
    el.innerHTML = `<p class="error">Could not read the chain: ${esc((e as Error).message)}</p>`;
  }
}

function selectNetwork(key: NetworkKey) {
  networkKey = key;
  store.set("bazaar-network", key);
  const ch = chain();
  pub = createPublicClient({ chain: ch, transport: http() }) as PublicClient;
  dep = deploymentFor(ch.id);
  walletClient = null;
  me = null;
  $("#connect").textContent = "Connect wallet";
  void render();
}

const sel = $<HTMLSelectElement>("#network");
sel.innerHTML = (Object.keys(NETWORKS) as NetworkKey[])
  .map((k) => `<option value="${k}"${k === networkKey ? " selected" : ""}>${NETWORKS[k].name}</option>`)
  .join("");
sel.addEventListener("change", () => selectNetwork(sel.value as NetworkKey));
$("#connect").addEventListener("click", () => void connect());
addEventListener("hashchange", () => {
  tab = (location.hash.slice(1) as Tab) || "shops";
  void render();
});
selectNetwork(networkKey);
