// Deploy the seven contracts to BOT Chain.
//
//   DEPLOYER_KEY=0x... node scripts/deploy.mjs --network testnet          # dry run: checks only
//   DEPLOYER_KEY=0x... node scripts/deploy.mjs --network testnet --yes    # broadcast
//
// The key is read from the environment only — never from a file in the repo, never printed.
// Writes deployments/<chainId>.json (addresses, tx hashes, blocks, compiler settings), which
// the web client imports. Refuses to run if the RPC reports a different chain id.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT, SETTINGS, SOLC_VERSION, compileAll } from "./lib/compile.mjs";
import { deployAll } from "./lib/localchain.mjs";
import { NETWORKS, chainOf } from "./lib/networks.mjs";

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const network = opt("--network") || "testnet";
const yes = argv.includes("--yes");
const chain = chainOf(network, opt("--rpc"));
const key = process.env.DEPLOYER_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set DEPLOYER_KEY=0x<64 hex> in the environment (the key is not stored anywhere).");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const transport = http(chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport, account });

const rpcId = await pub.getChainId();
if (rpcId !== chain.id) {
  console.error(`RPC reports chain ${rpcId}, expected ${chain.id} (${chain.name}). Stopping.`);
  process.exit(1);
}
const file = path.join(ROOT, "deployments", `${chain.id}.json`);
if (fs.existsSync(file) && !argv.includes("--force")) {
  console.error(`${path.relative(ROOT, file)} exists. Pass --force to deploy a fresh set.`);
  process.exit(1);
}
const artifacts = compileAll();
const bal = await pub.getBalance({ address: account.address });
console.log(`${chain.name} (${chain.id}) · deployer ${account.address} · ${formatEther(bal)} BOT`);
for (const [n, a] of Object.entries(artifacts)) console.log(`  ${n.padEnd(15)} ${(a.size / 1024).toFixed(1)} KB`);
if (bal === 0n) {
  console.error(`No BOT for gas.${NETWORKS[network].faucet ? ` Faucet: ${NETWORKS[network].faucet}` : ""}`);
  process.exit(1);
}
if (!yes) {
  console.log("\nDry run. Add --yes to broadcast seven deployments.");
  process.exit(0);
}
const contracts = await deployAll({ pub, wallet, artifacts, log: (l) => console.log(`  ${l}`) });
const record = {
  chainId: chain.id,
  network,
  deployer: account.address,
  deployedAt: new Date().toISOString(),
  compiler: { solc: SOLC_VERSION, evmVersion: SETTINGS.evmVersion, optimizer: SETTINGS.optimizer },
  contracts,
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
console.log(`\nwrote ${path.relative(ROOT, file)} — commit it so the web client picks it up.`);
if (chain.blockExplorers) {
  console.log(`explorer: ${chain.blockExplorers.default.url}/address/${contracts.BazaarMarket.address}`);
}
