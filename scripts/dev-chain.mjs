// Local dev chain for the web client: anvil (chain 31337, port 8545), all five contracts, and a
// few sample projects, shops and designs. Writes deployments/31337.json (git-ignored) and keeps
// running until Ctrl+C. Import an anvil key into your wallet to click around:
//   0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d  (public dev key, no value)
import fs from "node:fs";
import path from "node:path";
import { parseEther } from "viem";
import { ROOT, compileAll } from "./lib/compile.mjs";
import { ANVIL_KEYS, ANVIL_MISSING, deployAll, startChain } from "./lib/localchain.mjs";

const node = await startChain({ port: 8545, chainId: 31337 });
if (!node) {
  console.log(ANVIL_MISSING);
  process.exit(1);
}
const artifacts = compileAll();
const [deployer, a, b] = ANVIL_KEYS.map((k) => node.wallet(k));
const contracts = await deployAll({ pub: node.pub, wallet: deployer, artifacts, log: console.log });
const send = async (w, name, functionName, args, value) => {
  const hash = await w.writeContract({ address: contracts[name].address, abi: artifacts[name].abi, functionName, args, value });
  await node.pub.waitForTransactionReceipt({ hash });
};
await send(a, "BazaarProjects", "register", ["Pixel Guild", ""]);
await send(b, "BazaarProjects", "register", ["Agent Tools Guild", ""]);
await send(a, "BazaarMarket", "openShop", ["Pixel goods", "", 1, 0, [
  { name: "Tile badge", price: parseEther("0.5") },
  { name: "Lantern skin", price: parseEther("1.2") },
]]);
await send(b, "BazaarMarket", "openShop", ["Contract review desk", "", 2, 1, [
  { name: "1-hour Solidity review", price: parseEther("20") },
  { name: "Deploy + verify on BOT Chain", price: parseEther("8") },
]]);
await send(a, "PixelWorkshop", "register", ["Tile", "0x55555555aaaaaaaaffffffff00000000", 0x0135, 0n]);
await send(b, "PixelWorkshop", "register", ["Robot", "0x0ff03c3c3ffc0ff00c300ff03c3c0000", 0x0189, 0n]);

const file = path.join(ROOT, "deployments", "31337.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ chainId: 31337, network: "local", contracts }, null, 2) + "\n");
console.log(`\nwrote ${path.relative(ROOT, file)} · RPC ${node.rpc} · Ctrl+C to stop`);
setInterval(() => {}, 1 << 30);
