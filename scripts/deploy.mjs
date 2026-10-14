// Deploy the seven contracts to BOT Chain.
//
//   DEPLOYER_KEY=0x... node scripts/deploy.mjs --network testnet          # dry run: checks only
//   DEPLOYER_KEY=0x... node scripts/deploy.mjs --network testnet --yes    # broadcast
//   DEPLOYER_KEY=0x... node scripts/deploy.mjs --network mainnet --only PixelWorkshop --yes
//
// --only PixelWorkshop deploys the workshop alone (the first mainnet version: free designs and the
// gallery, no market or escrow). The workshop has no constructor arguments and no links to the others.
//
// The key is read from the environment only — never from a file in the repo, never printed.
// Writes deployments/<chainId>.json (addresses, tx hashes, blocks, compiler settings), which
// the web client imports. Refuses to run if the RPC reports a different chain id.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT, SETTINGS, SOLC_VERSION, compileAll } from "./lib/compile.mjs";
import { deployAll, deployOne } from "./lib/localchain.mjs";
import { NETWORKS, chainOf } from "./lib/networks.mjs";

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const network = opt("--network") || "testnet";
const yes = argv.includes("--yes");
const only = opt("--only");
if (only && only !== "PixelWorkshop") {
  console.error(`--only supports PixelWorkshop (the others are wired to each other). Got "${only}".`);
  process.exit(1);
}
const chain = chainOf(network, opt("--rpc"));
// Pasted keys often carry whitespace or come without 0x (MetaMask exports bare hex): accept both.
const raw = (process.env.DEPLOYER_KEY || "").trim();
const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  // Shape only, never the value: enough to tell a missing secret from a mangled one.
  const shape = raw ? `${raw.length} characters, ${raw.startsWith("0x") ? "starts with 0x" : "no 0x prefix"}` : "empty";
  console.error(`Set DEPLOYER_KEY=0x<64 hex> in the environment (the key is not stored anywhere). Got: ${shape}.`);
  process.exit(1);
}
const account = privateKeyToAccount(key);
// The testnet deployer's key sits in a browser and a GitHub secret, so it never holds real BOT.
// --reuse-testnet-key overrides this when the owner accepts that risk.
if (network === "mainnet" && !argv.includes("--reuse-testnet-key")) {
  for (const f of fs.readdirSync(path.join(ROOT, "deployments")).filter((n) => /^\d+\.json$/.test(n))) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", f), "utf8"));
    if (d.network !== "mainnet" && d.deployer?.toLowerCase() === account.address.toLowerCase()) {
      console.error(`${account.address} deployed ${f} (${d.network}). Use a fresh mainnet-only wallet, or pass --reuse-testnet-key to accept that risk. Stopping.`);
      process.exit(1);
    }
  }
}
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
const all = compileAll();
const artifacts = only ? { [only]: all[only] } : all;
const bal = await pub.getBalance({ address: account.address });
console.log(`${chain.name} (${chain.id}) · deployer ${account.address} · ${formatEther(bal)} BOT`);
for (const [n, a] of Object.entries(artifacts)) console.log(`  ${n.padEnd(15)} ${(a.size / 1024).toFixed(1)} KB`);
if (bal === 0n) {
  console.error(`No BOT for gas.${NETWORKS[network].faucet ? ` Faucet: ${NETWORKS[network].faucet}` : ""}`);
  process.exit(1);
}
if (!yes) {
  console.log(`\nDry run. Add --yes to broadcast ${only ? `the ${only} deployment` : "seven deployments"}.`);
  process.exit(0);
}
const log = (l) => console.log(`  ${l}`);
// Mainnet's workshop is free-only: designs cannot carry a price (commerce is not in the first version).
const freeOnly = network === "mainnet";
const contracts = only
  ? await deployOne({ pub, wallet, artifacts, name: only, args: [freeOnly], log })
  : await deployAll({ pub, wallet, artifacts, freeOnly, log });
const record = {
  chainId: chain.id,
  network,
  freeOnly,
  deployer: account.address,
  deployedAt: new Date().toISOString(),
  compiler: { solc: SOLC_VERSION, evmVersion: SETTINGS.evmVersion, optimizer: SETTINGS.optimizer },
  contracts,
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
console.log(`\nwrote ${path.relative(ROOT, file)} — commit it so the web client picks it up.`);
if (chain.blockExplorers) {
  console.log(`explorer: ${chain.blockExplorers.default.url}/address/${Object.values(contracts)[0].address}`);
}
