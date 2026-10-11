// Compile and write ABIs for the web client (web/src/abi.json) and sizes to the console.
import fs from "node:fs";
import path from "node:path";
import { ROOT, compileAll } from "./lib/compile.mjs";

const artifacts = compileAll();
const abi = {};
for (const [name, a] of Object.entries(artifacts)) {
  abi[name] = a.abi;
  const kb = (a.size / 1024).toFixed(1);
  console.log(`${name.padEnd(15)} ${kb.padStart(5)} KB${a.size > 24576 ? "  OVER 24 KB LIMIT" : ""}`);
  if (a.size > 24576) process.exitCode = 1;
}
const file = path.join(ROOT, "web", "src", "abi.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(abi, null, 1) + "\n");
console.log(`wrote ${path.relative(ROOT, file)}`);
