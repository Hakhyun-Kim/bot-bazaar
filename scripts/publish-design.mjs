// Publish one free design to the deployed Pixel Workshop, signed by DEPLOYER_KEY.
// The launch's core-function transaction, recorded for BOT Chain's onboarding.
//
//   DEPLOYER_KEY=0x... node scripts/publish-design.mjs --network mainnet --name "Hello" --yes
//
// --pixels (16 bytes hex) and --palette (4 preset indices as 0xABCD) default to a robot face.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT, compileAll } from "./lib/compile.mjs";
import { chainOf } from "./lib/networks.mjs";

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const network = opt("--network") || "testnet";
const name = (opt("--name") || "BOT Bazaar robot").trim();
const pixels = opt("--pixels") || "0x0ff03c3c3ffc0ff00c300ff03c3c0000";
const palette = Number(opt("--palette") || 0x0189);
if (name.length < 1 || Buffer.byteLength(name) > 36) throw new Error("--name must be 1 to 36 bytes");
if (!/^0x[0-9a-fA-F]{32}$/.test(pixels)) throw new Error("--pixels must be 16 bytes of hex");

const raw = (process.env.DEPLOYER_KEY || "").trim();
const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set DEPLOYER_KEY=0x<64 hex> in the environment.");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const chain = chainOf(network, opt("--rpc"));
const transport = http(chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
if ((await pub.getChainId()) !== chain.id) {
  console.error(`RPC is not ${chain.name} (${chain.id}). Stopping.`);
  process.exit(1);
}
const file = path.join(ROOT, "deployments", `${chain.id}.json`);
const address = JSON.parse(fs.readFileSync(file, "utf8")).contracts.PixelWorkshop?.address;
if (!address) throw new Error(`no PixelWorkshop in ${path.relative(ROOT, file)}`);
const { abi } = compileAll().PixelWorkshop;
const args = [name, pixels, palette, 0n];

const { request } = await pub.simulateContract({ address, abi, functionName: "register", args, account });
const gas = await pub.estimateContractGas({ address, abi, functionName: "register", args, account });
const bal = await pub.getBalance({ address: account.address });
console.log(`${chain.name} · PixelWorkshop ${address} · from ${account.address} · ${formatEther(bal)} BOT`);
console.log(`register "${name}" · ~${gas} gas`);
if (!argv.includes("--yes")) {
  console.log("\nDry run. Add --yes to publish.");
  process.exit(0);
}
const wallet = createWalletClient({ chain, transport, account });
const hash = await wallet.writeContract(request);
const r = await pub.waitForTransactionReceipt({ hash });
console.log(`${r.status} · gas used ${r.gasUsed} · fee ${formatEther(r.gasUsed * r.effectiveGasPrice)} BOT`);
if (chain.blockExplorers) console.log(`explorer: ${chain.blockExplorers.default.url}/tx/${hash}`);
console.log(`designs now: ${await pub.readContract({ address, abi, functionName: "designCount" })}`);
if (r.status !== "success") process.exit(1);
