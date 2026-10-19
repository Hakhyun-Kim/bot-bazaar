// Invariant fuzzing on a local anvil: thousands of random actions by four wallets across the three
// contracts that hold BOT (market escrow, offers, requests), with random time jumps, checking after
// every step that no BOT is created or lost and that each contract holds exactly what it owes.
//
//   node scripts/fuzz-local.mjs [steps=1500] [seed=1]
//
// Invariants, after every action (a reverted action changes nothing and is skipped):
//   1. Conservation: wallets + contracts + gas paid = the starting total.
//   2. BazaarMarket balance = sum of unsettled purchase amounts.
//   3. BazaarOffers balance = sum of active offer amounts.
//   4. BazaarRequests balance = sum of rewards of requests not yet paid or returned.
//   5. A settled purchase, a closed offer, a paid or returned request never reopens.
import { parseEther } from "viem";
import { compileAll } from "./lib/compile.mjs";
import { ANVIL_KEYS, ANVIL_MISSING, deployAll, startChain } from "./lib/localchain.mjs";

const STEPS = Number(process.argv[2] || 1500);
let seed = Number(process.argv[3] || 1);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (n) => Math.floor(rand() * n);

const node = await startChain({ port: 8547 });
if (!node) {
  console.log(ANVIL_MISSING);
  process.exit(0);
}
const artifacts = compileAll();
const wallets = ANVIL_KEYS.map((k) => node.wallet(k));
const d = await deployAll({ pub: node.pub, wallet: wallets[0], artifacts });
const at = (n) => ({ address: d[n].address, abi: artifacts[n].abi });
const read = (n, fn, args = []) => node.pub.readContract({ ...at(n), functionName: fn, args });
const bal = (a) => node.pub.getBalance({ address: a });
const HOLDERS = ["BazaarMarket", "BazaarOffers", "BazaarRequests"];
const everyone = [...wallets.map((w) => w.account.address), ...HOLDERS.map((n) => d[n].address)];
const total = async () => (await Promise.all(everyone.map(bal))).reduce((a, b) => a + b, 0n);

let gas = 0n;
async function send(w, n, fn, args = [], value) {
  try {
    const { request } = await node.pub.simulateContract({ ...at(n), functionName: fn, args, value, account: w.account });
    const r = await node.pub.waitForTransactionReceipt({ hash: await w.writeContract(request) });
    gas += r.gasUsed * r.effectiveGasPrice;
    return r.status === "success";
  } catch {
    return false; // reverted in simulation: nothing sent
  }
}

// Every wallet lists the same item at a few prices, so anyone can buy from anyone.
const PRICES = [parseEther("0.001"), parseEther("0.01"), parseEther("0.3")];
for (const w of wallets) for (const [i, p] of PRICES.entries()) await send(w, "BazaarMarket", "list", [`item${i}`, p]);
const start = (await total()) + gas;

const now = async () => (await node.pub.getBlock()).timestamp;
// Most calls come from the party who may make them (so deep paths are reached); one in five comes
// from a random wallet, which the contracts must turn away without moving BOT.
const byAddr = (a) => wallets.find((w) => w.account.address.toLowerCase() === a.toLowerCase());
const who = (party) => (rand() < 0.2 ? pick(wallets) : byAddr(party));
// Mostly an item still in play (deep paths), sometimes any id or one past the end (edge cases).
const target = (count, done) => {
  const live = [...Array(count).keys()].filter((i) => !done.has(i));
  return live.length && rand() < 0.8 ? pick(live) : int(count + 1);
};
const purchase = async () => {
  const id = target(n.p, closed.p);
  if (id >= n.p) return { id, buyer: pick(wallets).account.address, seller: pick(wallets).account.address };
  const [buyer, seller] = await read("BazaarMarket", "purchaseOf", [BigInt(id)]);
  return { id, buyer, seller };
};
const offer = async () => {
  const id = target(n.o, closed.o);
  return id >= n.o ? { id, buyer: pick(wallets).account.address, seller: pick(wallets).account.address } : { id, ...(await read("BazaarOffers", "offerAt", [BigInt(id)])) };
};
const request = async () => {
  const id = target(n.r, closed.r);
  return id >= n.r ? { id, poster: pick(wallets).account.address, worker: pick(wallets).account.address } : { id, ...(await read("BazaarRequests", "requestAt", [BigInt(id)])) };
};
const ZERO = "0x0000000000000000000000000000000000000000";
const ACTIONS = [
  async (w, o) => { const i = int(3); return send(w, "BazaarMarket", "buy", [o.account.address, `item${i}`], rand() < 0.9 ? PRICES[i] : pick(PRICES)); },
  async () => { const p = await purchase(); return send(who(p.buyer), "BazaarMarket", "confirm", [BigInt(p.id)]); },
  async (w) => { const p = await purchase(); return send(w, "BazaarMarket", "release", [BigInt(p.id)]); },
  async () => { const p = await purchase(); return send(who(p.buyer), "BazaarMarket", "dispute", [BigInt(p.id)]); },
  async () => { const p = await purchase(); return send(who(p.seller), "BazaarMarket", "refund", [BigInt(p.id)]); },
  async (w) => send(w, "BazaarMarket", "releaseMany", [[BigInt(int(n.p + 1)), BigInt(int(n.p + 1))]]),
  async (w, o) => send(w, "BazaarOffers", "makeOffer", [o.account.address, "item0"], BigInt(1 + int(10)) * 10n ** 15n),
  async () => { const x = await offer(); return send(who(x.buyer), "BazaarOffers", "cancelOffer", [BigInt(x.id)]); },
  async () => { const x = await offer(); return send(who(x.seller), "BazaarOffers", "acceptOffer", [BigInt(x.id)]); },
  async (w) => send(w, "BazaarRequests", "post", ["job", "", rand() < 0.8 ? 0 : int(3), (await now()) + BigInt(1 + int(5)) * 86400n], BigInt(1 + int(20)) * 10n ** 15n),
  async () => {
    const r = await request();
    const worker = pick(wallets.filter((x) => x.account.address.toLowerCase() !== r.poster.toLowerCase()));
    return send(who(r.poster), "BazaarRequests", "assign", [BigInt(r.id), worker.account.address]);
  },
  async () => { const r = await request(); return send(who(r.poster), "BazaarRequests", "cancel", [BigInt(r.id)]); },
  async () => { const r = await request(); return send(who(r.worker === ZERO ? r.poster : r.worker), "BazaarRequests", "submit", [BigInt(r.id), "ipfs://x"]); },
  async () => { const r = await request(); return send(who(r.poster), "BazaarRequests", "accept", [BigInt(r.id)]); },
  async () => { const r = await request(); return send(who(r.poster), "BazaarRequests", "dispute", [BigInt(r.id)]); },
  async () => { const r = await request(); return send(who(r.worker === ZERO ? r.poster : r.worker), "BazaarRequests", "handBack", [BigInt(r.id)]); },
  async (w) => { const r = await request(); return send(w, "BazaarRequests", "release", [BigInt(r.id)]); },
  async () => { const r = await request(); return send(who(r.poster), "BazaarRequests", "reclaim", [BigInt(r.id)]); },
  async () => (await node.increaseTime(pick([600, 3600, 3600, 86400, 86400, 3 * 86400, 8 * 86400, 11 * 86400])), true),
];
const n = { p: 0, o: 0, r: 0 };
const closed = { p: new Set(), o: new Set(), r: new Set() };

async function check(step) {
  const fail = (m) => {
    throw new Error(`step ${step} (seed ${process.argv[3] || 1}): ${m}`);
  };
  if ((await total()) + gas !== start) fail("conservation: BOT created or lost");
  let owed = 0n;
  for (let i = 0; i < n.p; i++) {
    const [, , amount, , settled] = await read("BazaarMarket", "purchaseOf", [BigInt(i)]);
    if (settled) closed.p.add(i);
    else if (closed.p.has(i)) fail(`purchase ${i} reopened`);
    else owed += amount;
  }
  if ((await bal(d.BazaarMarket.address)) !== owed) fail(`market holds ${await bal(d.BazaarMarket.address)}, owes ${owed}`);
  owed = 0n;
  for (let i = 0; i < n.o; i++) {
    const o = await read("BazaarOffers", "offerAt", [BigInt(i)]);
    if (!o.active) closed.o.add(i);
    else if (closed.o.has(i)) fail(`offer ${i} reopened`);
    else owed += o.amount;
  }
  if ((await bal(d.BazaarOffers.address)) !== owed) fail(`offers hold ${await bal(d.BazaarOffers.address)}, owe ${owed}`);
  owed = 0n;
  for (let i = 0; i < n.r; i++) {
    const r = await read("BazaarRequests", "requestAt", [BigInt(i)]);
    if (r.state >= 3) closed.r.add(i);
    else if (closed.r.has(i)) fail(`request ${i} reopened`);
    else owed += r.reward;
  }
  if ((await bal(d.BazaarRequests.address)) !== owed) fail(`requests hold ${await bal(d.BazaarRequests.address)}, owe ${owed}`);
}

const done = new Map();
const t0 = Date.now();
try {
  for (let step = 1; step <= STEPS; step++) {
    let a = int(ACTIONS.length);
    if (a === ACTIONS.length - 1 && rand() < 0.5) a = int(ACTIONS.length - 1); // time moves, but not every few steps
    const ok = await ACTIONS[a](pick(wallets), pick(wallets));
    if (ok) done.set(a, (done.get(a) || 0) + 1);
    n.p = Number(await read("BazaarMarket", "purchaseCount"));
    n.o = Number(await read("BazaarOffers", "offerCount"));
    n.r = Number(await read("BazaarRequests", "requestCount"));
    await check(step);
  }
} catch (e) {
  node.stop();
  console.log(`FAIL ${e.message}`);
  process.exit(1);
}
node.stop();
const names = ["buy", "confirm", "release", "dispute", "refund", "releaseMany", "makeOffer", "cancelOffer", "acceptOffer",
  "post", "assign", "cancel", "submit", "accept", "dispute(req)", "handBack", "release(req)", "reclaim", "time jump"];
console.log(`${STEPS} steps, all invariants held (${((Date.now() - t0) / 1000).toFixed(0)} s). ${n.p} purchases, ${n.o} offers, ${n.r} requests.`);
console.log("succeeded:", names.map((x, i) => `${x} ${done.get(i) || 0}`).join(", "));
