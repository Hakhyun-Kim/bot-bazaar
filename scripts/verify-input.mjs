// Write the solc standard-JSON input used for every deployment, for explorer source verification
// (upload it as "Standard JSON input" with compiler v0.8.28). Same settings as deploy.mjs.
import fs from "node:fs";
import path from "node:path";
import { ROOT, standardInput } from "./lib/compile.mjs";

const file = path.join(ROOT, "deployments", "standard-input.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(standardInput(), null, 1) + "\n");
console.log(`wrote ${path.relative(ROOT, file)}`);
