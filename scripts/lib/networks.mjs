// Network table — the one place chain ids, RPCs and explorers live.
// Values from the BOT Chain developer quick guide (https://dev-docs.botchain.ai/docs/Developers/quick-guide/).
import { defineChain } from "viem";

export const NETWORKS = {
  mainnet: {
    id: 677,
    name: "BOT Chain",
    rpc: "https://rpc.botchain.ai",
    explorer: "https://scan.botchain.ai",
  },
  testnet: {
    id: 968,
    name: "BOT Chain Testnet",
    rpc: "https://rpc.bohr.life",
    explorer: "https://scan.bohr.life",
    faucet: "https://faucet.botchain.ai",
  },
  local: {
    id: 31337,
    name: "Local anvil",
    rpc: "http://127.0.0.1:8545",
  },
};

export function chainOf(key, rpcOverride) {
  const n = NETWORKS[key];
  if (!n) throw new Error(`unknown network "${key}" (mainnet | testnet | local)`);
  const rpc = rpcOverride || n.rpc;
  return defineChain({
    id: n.id,
    name: n.name,
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: n.explorer ? { default: { name: "BOTScan", url: n.explorer } } : undefined,
  });
}
