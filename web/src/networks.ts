// Same values as scripts/lib/networks.mjs — npm test checks they agree.
import { defineChain, type Chain } from "viem";

export type NetworkKey = "mainnet" | "testnet" | "local";

const def = (id: number, name: string, rpc: string, explorer?: string): Chain =>
  defineChain({
    id,
    name,
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: explorer ? { default: { name: "BOTScan", url: explorer } } : undefined,
  });

export const NETWORKS: Record<NetworkKey, Chain> = {
  mainnet: def(677, "BOT Chain", "https://rpc.botchain.ai", "https://scan.botchain.ai"),
  testnet: def(968, "BOT Chain Testnet", "https://rpc.bohr.life", "https://scan.bohr.life"),
  local: def(31337, "Local dev chain", "http://127.0.0.1:8545"),
};

export const FAUCET = "https://faucet.botchain.ai";
