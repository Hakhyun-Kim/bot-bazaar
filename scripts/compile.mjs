// Compile and write ABIs for the web client (web/src/abi.json), creation bytecode for the
// in-browser demo chain (web/src/bytecode.json) and sizes to the console.
import fs from "node:fs";
import path from "node:path";
import { ROOT, compileAll } from "./lib/compile.mjs";

const artifacts = compileAll();
const abi = {};
const bytecode = {};
for (const [name, a] of Object.entries(artifacts)) {
  abi[name] = a.abi;
  bytecode[name] = a.bytecode;
  const kb = (a.size / 1024).toFixed(1);
  console.log(`${name.padEnd(15)} ${kb.padStart(5)} KB${a.size > 24576 ? "  OVER 24 KB LIMIT" : ""}`);
  if (a.size > 24576) process.exitCode = 1;
}
const dir = path.join(ROOT, "web", "src");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "abi.json"), JSON.stringify(abi, null, 1) + "\n");
fs.writeFileSync(path.join(dir, "bytecode.json"), JSON.stringify(bytecode, null, 1) + "\n");
console.log("wrote web/src/abi.json, web/src/bytecode.json");
