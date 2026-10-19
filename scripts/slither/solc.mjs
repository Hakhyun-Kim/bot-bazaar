// Minimal solc CLI over the npm solc: only `--version` and `--standard-json`, which is all
// crytic-compile uses with `--solc-standard-json`. Compiler settings come from compile.mjs.
import fs from "node:fs";
import { createRequire } from "node:module";
import { ROOT, SETTINGS } from "../lib/compile.mjs";

const solc = createRequire(`${ROOT}/package.json`)("solc");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(`solc, the solidity compiler commandline interface\nVersion: ${solc.version()}`);
  process.exit(0);
}
if (!args.includes("--standard-json")) {
  console.error("scripts/slither/solc: only --version and --standard-json are supported");
  process.exit(1);
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const j = JSON.parse(input);
  j.settings = { ...j.settings, evmVersion: SETTINGS.evmVersion, optimizer: SETTINGS.optimizer };
  const read = (p) => {
    try {
      return { contents: fs.readFileSync(p, "utf8") };
    } catch {
      return { error: `not found: ${p}` };
    }
  };
  process.stdout.write(solc.compile(JSON.stringify(j), { import: read }));
});
