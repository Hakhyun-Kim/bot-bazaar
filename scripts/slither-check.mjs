// Static analysis gate: runs Slither over every contract in contracts/ (the seven plus GasTank and
// anything added later) and contracts-v1/ (version 1.0), and fails on any High or Medium result that is not a reviewed false
// positive below. Low and Informational results are printed as a count; their triage is in
// docs/audit/static-analysis.md.
//
//   pip install slither-analyzer   (or SLITHER=/path/to/slither)
//   npm run slither
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./lib/compile.mjs";

// Each entry is one reviewed result: detector + the first element Slither names. Keep the reason.
const REVIEWED = [
  ["uninitialized-state", "_featuredList", "mapping(uint256 => uint256[]) needs no initialisation; written by push in setFeatured"],
  ["uninitialized-state", "_rounds", "mapping(address => Round[]) needs no initialisation; written by push in enter"],
  ["incorrect-equality", "refusal", "block.timestamp / 1 days == day compares day numbers, not balances; no one can force it"],
];

const env = { ...process.env, PATH: `${path.join(ROOT, "scripts", "slither")}${path.delimiter}${process.env.PATH}` };
function analyse(target) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slither-")), "out.json");
  const run = spawnSync(process.env.SLITHER || "slither", [target, "--solc-standard-json", "--json", out], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (run.error || !fs.existsSync(out)) {
    console.error(run.error?.message || run.stderr || "slither produced no output");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  if (!report.success) {
    console.error(report.error || run.stderr);
    process.exit(1);
  }
  return report.results?.detectors || [];
}
const open = [];
for (const target of ["contracts/", "contracts-v1/"]) {
  const results = analyse(target);
  const counts = {};
  for (const r of results) {
    counts[r.impact] = (counts[r.impact] || 0) + 1;
    if (r.impact !== "High" && r.impact !== "Medium") continue;
    const name = r.elements?.[0]?.name;
    if (!REVIEWED.some(([check, el]) => check === r.check && el === name)) open.push(r);
  }
  console.log(`slither ${target}: ${results.length} results`, counts);
}
for (const r of open) console.log(`\nNEW ${r.impact} ${r.check}\n${r.description.trim()}`);
if (open.length) {
  console.log(`\n${open.length} High/Medium result(s) not reviewed. Fix them, or triage in docs/audit/static-analysis.md and add to REVIEWED.`);
  process.exit(1);
}
console.log("No unreviewed High or Medium results.");
