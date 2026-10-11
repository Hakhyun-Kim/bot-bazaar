// End-to-end on a local anvil (chain id 677, paris hardfork): deploy all five contracts and walk
// every path a buyer, seller, project owner, agent and creator can take. Gas-free, a few seconds.
import { parseEther, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileAll } from "./lib/compile.mjs";
import { ANVIL_KEYS, ANVIL_MISSING, deployAll, startChain } from "./lib/localchain.mjs";

const node = await startChain();
if (!node) {
  console.log(ANVIL_MISSING);
  process.exit(0);
}
const artifacts = compileAll();
const [deployer, seller, buyer, other] = ANVIL_KEYS.map((k) => node.wallet(k));
const addr = (w) => w.account.address;
const d = await deployAll({ pub: node.pub, wallet: deployer, artifacts });
const at = (name) => ({ address: d[name].address, abi: artifacts[name].abi });

let passed = 0;
const failures = [];
async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${label}`);
  } catch (e) {
    failures.push(label);
    console.log(`  FAIL ${label}\n       ${e.shortMessage || e.message}`);
  }
}
const eq = (a, b, what = "") => {
  if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`);
};
const read = (name, functionName, args = []) => node.pub.readContract({ ...at(name), functionName, args });
async function write(w, name, functionName, args = [], value) {
  const { request } = await node.pub.simulateContract({ ...at(name), functionName, args, value, account: w.account });
  const hash = await w.writeContract(request);
  const r = await node.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
async function reverts(w, name, functionName, args = [], value, reason) {
  try {
    await node.pub.simulateContract({ ...at(name), functionName, args, value, account: w.account });
  } catch (e) {
    if (reason && !String(e.message).includes(reason)) throw new Error(`reverted, but not with "${reason}": ${e.shortMessage}`);
    return;
  }
  throw new Error(`${functionName} should revert`);
}
const balance = (w) => node.pub.getBalance({ address: addr(w) });
const DAY = 86400;

console.log("\nprojects");
await check("anyone registers a project; ids start at 1", async () => {
  await write(seller, "BazaarProjects", "register", ["Pixel Guild", "https://example.org/pixel-guild.json"]);
  eq(await read("BazaarProjects", "projectCount"), 1n);
  eq((await read("BazaarProjects", "projectOf", [1n])).owner, addr(seller));
});
await check("only the owner updates or curates", async () => {
  await reverts(other, "BazaarProjects", "update", [1n, "x", ""], undefined, "owner");
  await reverts(other, "BazaarProjects", "setFeatured", [1n, addr(other), true], undefined, "owner");
  await write(seller, "BazaarProjects", "setFeatured", [1n, addr(seller), true]);
  await write(seller, "BazaarProjects", "setFeatured", [1n, addr(other), true]);
  await write(seller, "BazaarProjects", "setFeatured", [1n, addr(seller), false]);
  const f = await read("BazaarProjects", "featuredOf", [1n]);
  eq(f.length, 1);
  eq(f[0], addr(other));
});

console.log("\nshops");
const items = [
  { name: "Pixel frame", price: parseEther("0.01") },
  { name: "API key (30 days)", price: parseEther("0.05") },
];
await check("open a shop in a project with a category and items", async () => {
  await write(seller, "BazaarMarket", "openShop", ["Pixel goods", "ipfs://shop", 1, 0, items]);
  const [owners, shops, total] = await read("BazaarMarket", "openShops", [0n, 10n]);
  eq(total, 1n);
  eq(owners[0], addr(seller));
  eq(shops[0].projectId, 1);
  eq(shops[0].items.length, 2);
});
await check("rejects bad category, 9 items, zero price", async () => {
  await reverts(other, "BazaarMarket", "openShop", ["t", "", 0, 4, items], undefined, "category");
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `i${i}`, price: 1n }));
  await reverts(other, "BazaarMarket", "openShop", ["t", "", 0, 0, nine], undefined, "items");
  await reverts(other, "BazaarMarket", "openShop", ["t", "", 0, 0, [{ name: "a", price: 0n }]], undefined, "price");
});
await check("wrong price is refused", async () => {
  await reverts(buyer, "BazaarMarket", "buyItem", [addr(seller), 0], parseEther("0.009"), "WrongPrice");
});

console.log("\nescrow");
await check("buy → escrow → buyer confirms → seller paid, receipt minted", async () => {
  const before = await balance(seller);
  await write(buyer, "BazaarMarket", "buyItem", [addr(seller), 0], parseEther("0.01"));
  const tid = await read("BazaarMarket", "tokenIdOf", [addr(seller), "Pixel frame"]);
  eq(await read("BazaarMarket", "balanceOf", [addr(buyer), tid]), 0n, "receipt before settle");
  await write(buyer, "BazaarMarket", "confirm", [0n]);
  eq(await read("BazaarMarket", "balanceOf", [addr(buyer), tid]), 1n, "receipt after settle");
  eq((await balance(seller)) - before, parseEther("0.01"), "seller received");
  const uri = await read("BazaarMarket", "uri", [tid]);
  JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)));
});
await check("dispute holds 7 days; release before fails, after succeeds", async () => {
  await write(buyer, "BazaarMarket", "buyItem", [addr(seller), 1], parseEther("0.05"));
  await write(buyer, "BazaarMarket", "dispute", [1n]);
  await node.increaseTime(2 * DAY);
  await reverts(other, "BazaarMarket", "release", [1n], undefined, "early");
  await node.increaseTime(6 * DAY);
  await write(other, "BazaarMarket", "release", [1n]);
  eq((await read("BazaarMarket", "purchaseOf", [1n]))[4], true, "settled");
});
await check("seller refund returns money and mints no receipt", async () => {
  await write(buyer, "BazaarMarket", "buyItem", [addr(seller), 0], parseEther("0.01"));
  const tid = await read("BazaarMarket", "tokenIdOf", [addr(seller), "Pixel frame"]);
  const held = await read("BazaarMarket", "balanceOf", [addr(buyer), tid]);
  await reverts(buyer, "BazaarMarket", "refund", [2n], undefined, "seller");
  await write(seller, "BazaarMarket", "refund", [2n]);
  eq(await read("BazaarMarket", "balanceOf", [addr(buyer), tid]), held, "no new receipt");
  await reverts(buyer, "BazaarMarket", "confirm", [2n], undefined, "settled");
});
await check("listings: listed price enforced, unlisted refused", async () => {
  await write(seller, "BazaarMarket", "list", ["Integration call", parseEther("0.2")]);
  await reverts(buyer, "BazaarMarket", "buy", [addr(seller), "Something else"], 1n, "NotListed");
  await write(buyer, "BazaarMarket", "buy", [addr(seller), "Integration call"], parseEther("0.2"));
});
await check("releaseMany settles only matured purchases", async () => {
  await node.increaseTime(DAY + 1);
  await write(other, "BazaarMarket", "releaseMany", [[0n, 1n, 2n, 3n]]);
  eq((await read("BazaarMarket", "purchaseOf", [3n]))[4], true);
});
await check("only the offers contract may call purchaseFor", async () => {
  await reverts(buyer, "BazaarMarket", "purchaseFor", [addr(buyer), addr(seller), "x"], 1n, "offers");
});
await check("redeem burns a receipt", async () => {
  const tid = await read("BazaarMarket", "tokenIdOf", [addr(seller), "Pixel frame"]);
  await write(buyer, "BazaarMarket", "redeem", [tid, 1n]);
  eq(await read("BazaarMarket", "balanceOf", [addr(buyer), tid]), 0n);
});

console.log("\noffers");
await check("offer below list price → seller accepts → escrowed purchase", async () => {
  await write(buyer, "BazaarOffers", "makeOffer", [addr(seller), "Pixel frame"], parseEther("0.007"));
  const [ids] = await read("BazaarOffers", "offersFor", [addr(seller), 0n, 10n]);
  eq(ids.length, 1);
  const n = await read("BazaarMarket", "purchaseCount");
  await write(seller, "BazaarOffers", "acceptOffer", [0n]);
  const p = await read("BazaarMarket", "purchaseOf", [n]);
  eq(p[0], addr(buyer));
  eq(p[2], parseEther("0.007"));
  eq(p[4], false, "still in escrow");
});
await check("buyer cancels; strangers only after 7-day expiry", async () => {
  await write(buyer, "BazaarOffers", "makeOffer", [addr(seller), "Pixel frame"], parseEther("0.001"));
  await write(buyer, "BazaarOffers", "makeOffer", [addr(seller), "Pixel frame"], parseEther("0.002"));
  await write(buyer, "BazaarOffers", "cancelOffer", [1n]);
  await reverts(other, "BazaarOffers", "cancelOffer", [2n], undefined, "buyer");
  await node.increaseTime(7 * DAY + 1);
  await reverts(seller, "BazaarOffers", "acceptOffer", [2n], undefined, "expired");
  const before = await balance(buyer);
  await write(other, "BazaarOffers", "cancelOffer", [2n]);
  eq((await balance(buyer)) - before, parseEther("0.002"), "refund to buyer");
});

console.log("\nagent pass");
const principal = privateKeyToAccount(ANVIL_KEYS[0]);
const agent = other;
async function signLink(nonce, deadline) {
  return principal.signTypedData({
    domain: { name: "BotBazaarAgentPass", version: "1", chainId: 677, verifyingContract: d.AgentPass.address },
    types: { Link: [{ name: "agent", type: "address" }, { name: "principal", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Link",
    message: { agent: addr(agent), principal: principal.address, nonce, deadline },
  });
}
const split = (sig) => [Number(`0x${sig.slice(130, 132)}`), `0x${sig.slice(2, 66)}`, `0x${sig.slice(66, 130)}`];
await check("principal signs, agent links; identityOf shows the principal", async () => {
  const deadline = BigInt((await node.pub.getBlock()).timestamp) + 3600n;
  const sig = split(await signLink(0n, deadline));
  await write(agent, "AgentPass", "link", [principal.address, deadline, ...sig]);
  eq(await read("AgentPass", "identityOf", [addr(agent)]), principal.address);
  await reverts(agent, "AgentPass", "link", [principal.address, deadline, ...sig], undefined, "bad sig");
});
await check("principal revokes", async () => {
  await reverts(buyer, "AgentPass", "revoke", [addr(agent)], undefined, "not yours");
  await write(deployer, "AgentPass", "revoke", [addr(agent)]);
  eq(await read("AgentPass", "principalOf", [addr(agent)]), zeroAddress);
});

console.log("\npixel workshop");
const pixels = "0x0123456789abcdef0123456789abcdef";
await check("free design: register, collect, show on profile", async () => {
  await write(seller, "PixelWorkshop", "register", ["Tile", pixels, 0x1234, 0n]);
  await write(buyer, "PixelWorkshop", "collect", [0n]);
  await reverts(buyer, "PixelWorkshop", "collect", [0n], undefined, "owned");
  await write(buyer, "PixelWorkshop", "setProfileDesign", [1n]);
  const p = await read("PixelWorkshop", "profileDesignOf", [addr(buyer)]);
  eq(p[0], true);
  eq(p[2], pixels);
});
await check("paid design pays the creator directly", async () => {
  await write(seller, "PixelWorkshop", "register", ["Lantern", pixels, 0x4321, parseEther("0.003")]);
  const before = await balance(seller);
  await reverts(buyer, "PixelWorkshop", "collect", [1n], 0n, "WrongPrice");
  await write(buyer, "PixelWorkshop", "collect", [1n], parseEther("0.003"));
  eq((await balance(seller)) - before, parseEther("0.003"));
  const [ids] = await read("PixelWorkshop", "designsPage", [0n, 10n]);
  eq(ids[0], 1n, "newest first");
});
await check("cannot show a design you do not own", async () => {
  await reverts(other, "PixelWorkshop", "setProfileDesign", [1n], undefined, "not-owned");
});

console.log("\nshop close");
await check("closing removes the shop from the open index", async () => {
  await write(seller, "BazaarMarket", "closeShop");
  eq((await read("BazaarMarket", "openShops", [0n, 10n]))[2], 0n);
});

node.stop();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
