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

export const SETTINGS = {
  evmVersion: "paris",
  optimizer: { enabled: true, runs: 200 },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
};

export function standardInput(names = CONTRACTS) {
  const sources = {};
  for (const n of names) {
    sources[`contracts/${n}.sol`] = {
      content: fs.readFileSync(path.join(ROOT, "contracts", `${n}.sol`), "utf8"),
    };
  }
  return { language: "Solidity", sources, settings: SETTINGS };
}

export function compileAll(names = CONTRACTS) {
  const solc = require("solc");
  if (!solc.version().startsWith(SOLC_VERSION)) {
    throw new Error(`solc ${solc.version()} found, ${SOLC_VERSION} expected (npm ci)`);
  }
  const out = JSON.parse(solc.compile(JSON.stringify(standardInput(names))));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const artifacts = {};
  for (const n of names) {
    const c = out.contracts[`contracts/${n}.sol`][n];
    artifacts[n] = {
      abi: c.abi,
      bytecode: `0x${c.evm.bytecode.object}`,
      size: c.evm.deployedBytecode.object.length / 2,
    };
  }
  return artifacts;
}
