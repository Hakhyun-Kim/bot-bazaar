// Run each core flow of the market modules once on a deployed set and record the transactions.
// BOT Chain asked for core-flow transaction links of the mainnet test version 0.1 (2026-10-15).
//
//   DEPLOYER_KEY=0x... node scripts/core-flows.mjs --network mainnet          # dry run: plan + budget
//   DEPLOYER_KEY=0x... node scripts/core-flows.mjs --network mainnet --yes    # broadcast
//
// Two parties are needed (a seller cannot buy from itself), so the deployer works with a helper
// wallet whose key is derived from DEPLOYER_KEY (keccak256 of key + label). Nothing new to store,
// and a later run reaches the same helper if anything is left in it. The helper gets just enough BOT
// for its amounts and gas, and sends what is left back to the deployer at the end. Keys are never
// printed. Amounts stay at or under the cap (0.001 BOT).
//
// Flows: project register · open shop · buy shop item → buyer confirms (seller paid, receipt) ·
// offer → seller accepts → buyer confirms · offer → buyer cancels (refund) · request post → assign →
// submit → accept (worker paid) · request post → cancel (refund) · Bot or Not enter · AgentPass
// declare · close shop. Writes docs/audit/mainnet-core-flows.md on mainnet (or --out).
import fs from "node:fs";
import path from "node:path";
import { concat, createPublicClient, createWalletClient, formatEther, http, keccak256, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT, compileAll } from "./lib/compile.mjs";
import { chainOf } from "./lib/networks.mjs";

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const network = opt("--network") || "testnet";
const yes = argv.includes("--yes");
const raw = (process.env.DEPLOYER_KEY || "").trim();
const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set DEPLOYER_KEY=0x<64 hex> in the environment.");
  process.exit(1);
}
const chain = chainOf(network, opt("--rpc"));
const transport = http(chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
if ((await pub.getChainId()) !== chain.id) {
  console.error(`RPC is not ${chain.name} (${chain.id}). Stopping.`);
  process.exit(1);
}
const depFile = opt("--deployment") || path.join(ROOT, "deployments", `${chain.id}.json`);
const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
for (const n of ["BazaarMarket", "BazaarOffers", "BazaarRequests", "BazaarProjects", "AgentPass", "BotOrNot"]) {
  if (!dep.contracts[n]) throw new Error(`no ${n} in ${depFile}`);
}
const artifacts = compileAll();
const at = (name) => ({ address: dep.contracts[name].address, abi: artifacts[name].abi });

const seller = createWalletClient({ chain, transport, account: privateKeyToAccount(key) });
const helperKey = keccak256(concat([key, toHex("bot-bazaar core flows helper v1")]));
const buyer = createWalletClient({ chain, transport, account: privateKeyToAccount(helperKey) });
const S = seller.account.address;
const B = buyer.account.address;

const cap = BigInt(dep.maxAmount || 0);
const price = cap && cap < parseEther("0.001") ? cap : parseEther("0.001");
const half = price / 2n;
const ITEM = "Pixel frame (core-flow test)";
const gasPrice = await pub.getGasPrice();
// Helper: 9 transactions; amounts locked at most price + half at once, all of it comes back or
// goes to the seller (the deployer). Gas budget is generous; the rest is swept back.
const helperBudget = price + 2n * half + 9n * 300_000n * gasPrice;

console.log(`${chain.name} (${chain.id}) · gas price ${formatEther(gasPrice * 1_000_000_000n)} gwei`);
console.log(`seller (deployer) ${S} · ${formatEther(await pub.getBalance({ address: S }))} BOT`);
console.log(`buyer (helper)    ${B} · ${formatEther(await pub.getBalance({ address: B }))} BOT`);
console.log(`cap ${formatEther(cap)} BOT · item price ${formatEther(price)} · offers ${formatEther(half)} · helper funding ${formatEther(helperBudget)} BOT`);
if (!yes) {
  await pub.simulateContract({ ...at("BazaarProjects"), functionName: "register", args: ["BOT Bazaar", ""], account: S });
  console.log("\nDry run (first step simulates fine). Add --yes to broadcast.");
  process.exit(0);
}

const steps = [];
let fees = 0n;
async function send(label, who, w, name, functionName, args = [], value) {
  const { request, result } = await pub.simulateContract({ ...at(name), functionName, args, value, account: w.account });
  const hash = await w.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  fees += r.gasUsed * r.effectiveGasPrice;
  if (r.status !== "success") throw new Error(`${label}: reverted (${hash})`);
  steps.push({ label, who, contract: name, functionName, value: value || 0n, hash });
  console.log(`  ok  ${label} · ${hash}`);
  return result;
}
async function transfer(label, who, w, to, value) {
  const hash = await w.sendTransaction({ to, value });
  const r = await pub.waitForTransactionReceipt({ hash });
  fees += r.gasUsed * r.effectiveGasPrice;
  steps.push({ label, who, contract: "", functionName: "transfer", value, hash });
  console.log(`  ok  ${label} · ${hash}`);
}

const day = 86400n;
let failed = null;
try {
  const have = await pub.getBalance({ address: B });
  if (have < helperBudget) await transfer("Fund the buyer wallet for this test", "seller", seller, B, helperBudget - have);

  const projectId = await send("Register a project", "seller", seller, "BazaarProjects", "register", ["BOT Bazaar", "https://metah.dev/games/bot-bazaar/"]);
  await send("Open a shop in that project, one item at the cap", "seller", seller, "BazaarMarket", "openShop", [
    "BOT Bazaar core-flow test", "", Number(projectId), 0, [{ name: ITEM, price }],
  ]);
  const p1 = await send("Buy the shop item (BOT held in escrow)", "buyer", buyer, "BazaarMarket", "buyItem", [S, 0], price);
  await send("Buyer confirms: seller paid, receipt to buyer", "buyer", buyer, "BazaarMarket", "confirm", [p1]);

  const o1 = await send("Make an offer below the price (BOT locked)", "buyer", buyer, "BazaarOffers", "makeOffer", [S, ITEM], half);
  const p2 = await send("Seller accepts the offer (becomes an escrowed purchase)", "seller", seller, "BazaarOffers", "acceptOffer", [o1]);
  await send("Buyer confirms the offer purchase", "buyer", buyer, "BazaarMarket", "confirm", [p2]);
  const o2 = await send("Make another offer", "buyer", buyer, "BazaarOffers", "makeOffer", [S, ITEM], half);
  await send("Buyer cancels it (locked BOT returned)", "buyer", buyer, "BazaarOffers", "cancelOffer", [o2]);

  const now = (await pub.getBlock()).timestamp;
  const r1 = await send("Post a request with a reward (BOT held)", "seller", seller, "BazaarRequests", "post", [
    "Core-flow test: reply with a link", "", 0, now + 3n * day,
  ], price);
  await send("Poster assigns a worker", "seller", seller, "BazaarRequests", "assign", [r1, B]);
  await send("Worker submits the result", "buyer", buyer, "BazaarRequests", "submit", [r1, "https://play.metah.dev/"]);
  await send("Poster accepts: worker paid", "seller", seller, "BazaarRequests", "accept", [r1]);
  const r2 = await send("Post another request", "seller", seller, "BazaarRequests", "post", [
    "Core-flow test: cancelled request", "", 0, now + 3n * day,
  ], price);
  await send("Poster cancels it (reward returned)", "seller", seller, "BazaarRequests", "cancel", [r2]);

  const salt = keccak256(concat([helperKey, toHex("bot-or-not salt")]));
  const commitment = await pub.readContract({ ...at("BotOrNot"), functionName: "commitmentOf", args: [B, false, salt] });
  await send("Enter Bot or Not (sealed answer)", "buyer", buyer, "BotOrNot", "enter", [commitment]);
  await send("Declare a kind in AgentPass", "seller", seller, "AgentPass", "declare", [3, "MetaH, BOT Bazaar team"]);
  await send("Close the test shop", "seller", seller, "BazaarMarket", "closeShop");
} catch (e) {
  failed = e;
  console.error(`\nstopped: ${e.shortMessage || e.message}`);
} finally {
  // Sweep the helper back to the deployer (legacy gas price so the fee is exact).
  const bal = await pub.getBalance({ address: B });
  const gp = await pub.getGasPrice();
  const fee = 21_000n * gp;
  if (bal > fee * 2n) {
    try {
      const hash = await buyer.sendTransaction({ to: S, value: bal - fee, gas: 21_000n, gasPrice: gp });
      const r = await pub.waitForTransactionReceipt({ hash });
      fees += r.gasUsed * r.effectiveGasPrice;
      steps.push({ label: "Return the buyer wallet's remaining BOT", who: "buyer", contract: "", functionName: "transfer", value: bal - fee, hash });
      console.log(`  ok  returned ${formatEther(bal - fee)} BOT to the deployer · ${hash}`);
    } catch (e) {
      console.error(`sweep failed (${e.shortMessage || e.message}); rerun reaches the same helper wallet`);
    }
  }
}

console.log(`\n${steps.length} transactions · total gas fees ${formatEther(fees)} BOT`);
console.log(`seller now ${formatEther(await pub.getBalance({ address: S }))} BOT · buyer ${formatEther(await pub.getBalance({ address: B }))} BOT`);

const out = opt("--out") || (network === "mainnet" ? path.join(ROOT, "docs", "audit", "mainnet-core-flows.md") : null);
if (out) {
  const scan = chain.blockExplorers?.default.url;
  const link = (h) => (scan ? `[${h.slice(0, 10)}…${h.slice(-6)}](${scan}/tx/${h})` : h);
  const addr = (a) => (scan ? `[\`${a}\`](${scan}/address/${a})` : `\`${a}\``);
  const rows = steps.map(
    (s, i) => `| ${i + 1} | ${s.label} | ${s.who} | ${s.contract ? `${s.contract}.${s.functionName}` : "BOT transfer"} | ${s.value ? formatEther(s.value) : ""} | ${link(s.hash)} |`,
  );
  fs.writeFileSync(
    out,
    [
      `# Core flows on ${chain.name} (${chain.id})`,
      "",
      `One run of every core flow of the market modules (test version 0.1, cap ${formatEther(cap)} BOT per action),`,
      `made with \`scripts/core-flows.mjs\` on ${new Date().toISOString().slice(0, 10)}.`,
      "",
      `- seller: the deployer ${addr(S)}`,
      `- buyer / worker: a helper wallet ${addr(B)}, funded for this run and emptied back to the deployer`,
      "",
      "| # | Flow | From | Call | BOT | Transaction |",
      "|---:|---|---|---|---:|---|",
      ...rows,
      "",
      failed ? `Stopped early: ${failed.shortMessage || failed.message}` : `All ${steps.length} transactions succeeded. Total gas fees ${formatEther(fees)} BOT.`,
      "",
    ].join("\n"),
  );
  console.log(`wrote ${path.relative(ROOT, out)}`);
}
if (failed) process.exit(1);
