// solc compile with one fixed setting, shared by tests, deploy and explorer verification.
// evmVersion "paris": no PUSH0 / MCOPY / transient storage, so the bytecode does not depend on
// which post-merge upgrades an L1 has enabled. Optimizer on: BazaarMarket is close to 24 KB.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOLC_VERSION = "0.8.28";
export const CONTRACTS = [
  "BazaarMarket",
  "BazaarOffers",
  "BazaarRequests",
  "BazaarProjects",
  "AgentPass",
  "BotOrNot",
  "PixelWorkshop",
];
/** The sponsor's gas tank is not one of the shared contracts: compiled on its own, so the seven
 *  keep their verified standard input byte for byte. */
export const SPONSOR = ["GasTank"];
/** Version 1.0 (testnet first): the four contracts with the Low findings fixed live in
 *  contracts-v1/, so the deployed and verified 0.1 sources in contracts/ never change. The other
 *  three are unchanged and come from contracts/. */
export const V1 = ["BazaarMarket", "BazaarOffers", "BazaarRequests", "AgentPass"];
export const V1_DIR = "contracts-v1";

export const SETTINGS = {
  evmVersion: "paris",
  optimizer: { enabled: true, runs: 200 },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
};

export function standardInput(names = CONTRACTS, dir = "contracts") {
  const sources = {};
  for (const n of names) {
    sources[`${dir}/${n}.sol`] = {
      content: fs.readFileSync(path.join(ROOT, dir, `${n}.sol`), "utf8"),
    };
  }
  return { language: "Solidity", sources, settings: SETTINGS };
}

export function compileAll(names = CONTRACTS, dir = "contracts") {
  const solc = require("solc");
  if (!solc.version().startsWith(SOLC_VERSION)) {
    throw new Error(`solc ${solc.version()} found, ${SOLC_VERSION} expected (npm ci)`);
  }
  const input = standardInput(names, dir);
  // Immutable positions too, so verify-explorer.mjs can compare on-chain code byte for byte.
  input.settings = { ...input.settings, outputSelection: { "*": { "*": [...SETTINGS.outputSelection["*"]["*"], "evm.deployedBytecode.immutableReferences"] } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const artifacts = {};
  for (const n of names) {
    const c = out.contracts[`${dir}/${n}.sol`][n];
    artifacts[n] = {
      abi: c.abi,
      bytecode: `0x${c.evm.bytecode.object}`,
      size: c.evm.deployedBytecode.object.length / 2,
      deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
      immutableReferences: c.evm.deployedBytecode.immutableReferences || {},
    };
  }
  return artifacts;
}

/** All seven as version 1.0 deploys them: the fixed four from contracts-v1/, the rest unchanged. */
export function compileV1() {
  return { ...compileAll(CONTRACTS.filter((n) => !V1.includes(n))), ...compileAll(V1, V1_DIR) };
}
