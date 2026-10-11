// Local chain harness — start anvil, deploy the five contracts, jump time.
// The real value of a local chain is not "free gas" but controlling time: 24 h escrow,
// 7-day disputes and offer expiry are checked in seconds instead of days.
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, defineChain, getContractAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT } from "./compile.mjs";

const require = createRequire(import.meta.url);

/** anvil's well-known dev accounts (published by Foundry — no real funds) */
export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];

export function findAnvil() {
  try {
    const pkg = require.resolve("@foundry-rs/anvil/package.json", { paths: [ROOT] });
    return { cmd: process.execPath, args: [path.join(path.dirname(pkg), "bin.mjs")], shell: false };
  } catch {
    /* fall back to PATH */
  }
  const r = spawnSync("anvil", ["--version"], { encoding: "utf8", shell: true });
  return r.status === 0 ? { cmd: "anvil", args: [], shell: true } : null;
}

export const ANVIL_MISSING = [
  "Skipping local chain tests — anvil not found. Install one of:",
  "  npm i @foundry-rs/anvil --ignore-scripts --no-save",
  "  https://getfoundry.sh",
].join("\n");

/** Start anvil with BOT Chain's mainnet id so chain guards behave exactly as in production. */
export async function startChain({ port = 8546, chainId = 677 } = {}) {
  const bin = findAnvil();
  if (!bin) return null;
  const rpc = `http://127.0.0.1:${port}`;
  const proc = spawn(
    bin.cmd,
    [...bin.args, "--chain-id", String(chainId), "--port", String(port), "--hardfork", "paris", "--silent"],
    { stdio: "ignore", shell: bin.shell },
  );
  const chain = defineChain({
    id: chainId,
    name: "BOT Chain (local)",
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const stop = () => {
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  };
  process.on("exit", stop);
  for (let i = 0; i < 50; i++) {
    try {
      if ((await pub.getChainId()) === chainId) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
    if (i === 49) {
      stop();
      throw new Error("anvil did not start");
    }
  }
  const rpcCall = async (method, params = []) => {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
  return {
    rpc,
    chain,
    pub,
    stop,
    wallet: (key) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(rpc) }),
    increaseTime: async (s) => {
      await rpcCall("evm_increaseTime", [s]);
      await rpcCall("anvil_mine", ["0x1"]);
    },
  };
}

/**
 * Deploy all five in the fixed order used by scripts/deploy.mjs.
 * BazaarMarket takes the offers address in its constructor, so it is predicted from the next nonce.
 */
export async function deployAll({ pub, wallet, artifacts, log = () => {} }) {
  const from = wallet.account.address;
  const out = {};
  const deploy = async (name, args = []) => {
    const a = artifacts[name];
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${name} deploy failed`);
    out[name] = { address: r.contractAddress, tx: hash, block: Number(r.blockNumber) };
    log(`${name.padEnd(15)} ${r.contractAddress}`);
    return r.contractAddress;
  };
  const nonce = await pub.getTransactionCount({ address: from, blockTag: "pending" });
  const predictedOffers = getContractAddress({ from, nonce: BigInt(nonce + 1) });
  await deploy("BazaarMarket", [predictedOffers]);
  const offers = await deploy("BazaarOffers", [out.BazaarMarket.address]);
  if (offers.toLowerCase() !== predictedOffers.toLowerCase()) {
    throw new Error(`offers landed at ${offers}, market expects ${predictedOffers} — redeploy both`);
  }
  await deploy("BazaarProjects");
  await deploy("AgentPass");
  await deploy("PixelWorkshop");
  return out;
}
