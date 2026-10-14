// Verify every contract in deployments/<chainId>.json on the network's explorer (BOTScan).
//
//   node scripts/verify-explorer.mjs --network mainnet            # check bytecode + explorer status only
//   node scripts/verify-explorer.mjs --network mainnet --submit   # also submit unverified contracts
//
// First compares each address's on-chain code with this checkout's compile, so a source mismatch is
// caught here rather than as an explorer error. Then submits the standard-JSON input (one file per
// contract, compiler v0.8.28) with ABI-encoded constructor arguments rebuilt from the deployment
// record. Talks to the Blockscout v2 API and falls back to the Etherscan-style /api. No key needed.
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, encodeAbiParameters, http } from "viem";
import { ROOT, compileAll, standardInput } from "./lib/compile.mjs";
import { NETWORKS, chainOf } from "./lib/networks.mjs";

const argv = process.argv.slice(2);
const network = argv[argv.indexOf("--network") + 1] || "mainnet";
const submit = argv.includes("--submit");
const chain = chainOf(network);
const explorer = NETWORKS[network].explorer;
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${chain.id}.json`), "utf8"));
const pub = createPublicClient({ chain, transport: http() });
const artifacts = compileAll();

// Full solc version string the explorers expect, from the npm solc build used for every deploy.
const LONG_VERSION = `v${(await import("solc")).default.version().replace(".Emscripten.clang", "")}`;
const cap = BigInt(dep.maxAmount || 0);
const a = (n) => dep.contracts[n]?.address;
const ARGS = {
  BazaarMarket: () => encodeAbiParameters([{ type: "address" }, { type: "uint128" }], [a("BazaarOffers"), cap]),
  BazaarOffers: () => encodeAbiParameters([{ type: "address" }, { type: "uint128" }], [a("BazaarMarket"), cap]),
  BazaarRequests: () => encodeAbiParameters([{ type: "uint128" }], [cap]),
  BazaarProjects: () => "0x",
  AgentPass: () => "0x",
  BotOrNot: () => encodeAbiParameters([{ type: "address" }], [a("AgentPass")]),
  PixelWorkshop: () => encodeAbiParameters([{ type: "bool" }], [!!dep.freeOnly]),
};

async function api(p, init) {
  const r = await fetch(`${explorer}${p}`, init);
  const text = await r.text();
  try {
    return { status: r.status, body: JSON.parse(text) };
  } catch {
    return { status: r.status, body: text.slice(0, 300) };
  }
}

async function isVerified(addr) {
  const v2 = await api(`/api/v2/smart-contracts/${addr}`);
  if (v2.status === 200 && typeof v2.body === "object") return !!v2.body.is_verified;
  const v1 = await api(`/api?module=contract&action=getsourcecode&address=${addr}`);
  return !!v1.body?.result?.[0]?.SourceCode;
}

async function submitOne(name, addr, args) {
  const input = JSON.stringify(standardInput([name]));
  const form = new FormData();
  form.append("compiler_version", LONG_VERSION);
  form.append("contract_name", `contracts/${name}.sol:${name}`);
  form.append("license_type", "mit");
  form.append("autodetect_constructor_args", "false");
  form.append("constructor_args", args.replace(/^0x/, ""));
  form.append("files[0]", new Blob([input], { type: "application/json" }), "standard-input.json");
  const v2 = await api(`/api/v2/smart-contracts/${addr}/verification/via/standard-input`, { method: "POST", body: form });
  if (v2.status < 400) return `blockscout v2: ${JSON.stringify(v2.body)}`;
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: addr,
    sourceCode: input,
    codeformat: "solidity-standard-json-input",
    contractname: `contracts/${name}.sol:${name}`,
    compilerversion: LONG_VERSION,
    constructorArguements: args.replace(/^0x/, ""),
    licenseType: "3",
  });
  const v1 = await api(`/api`, { method: "POST", body });
  return `v2 ${v2.status} ${JSON.stringify(v2.body)} · etherscan-style ${v1.status} ${JSON.stringify(v1.body)}`;
}

console.log(`${chain.name} (${chain.id}) · explorer ${explorer} · compiler ${LONG_VERSION}`);
let problems = 0;
for (const [name, { address }] of Object.entries(dep.contracts)) {
  const onchain = (await pub.getCode({ address })) || "0x";
  const built = artifacts[name].deployedBytecode;
  // Immutables are filled in at deploy time, so compare with those slots masked out.
  const mask = (hex) => {
    const b = hex.toLowerCase().replace(/^0x/, "").split("");
    for (const refs of Object.values(artifacts[name].immutableReferences))
      for (const { start, length } of refs) for (let i = start * 2; i < (start + length) * 2; i++) b[i] = "0";
    return b.join("");
  };
  const same = mask(onchain) === mask(built);
  const verified = await isVerified(address).catch((e) => `? (${e.message})`);
  console.log(`${name.padEnd(15)} ${address} · code ${same ? "matches this build" : "DIFFERS from this build"} · verified: ${verified}`);
  if (!same) problems++;
  if (submit && verified !== true && same) {
    console.log(`  submit: ${await submitOne(name, address, ARGS[name]())}`);
  }
}
if (submit) {
  console.log("\nwaiting 60 s, then re-checking…");
  await new Promise((r) => setTimeout(r, 60_000));
  for (const [name, { address }] of Object.entries(dep.contracts)) {
    console.log(`${name.padEnd(15)} ${explorer}/address/${address} · verified: ${await isVerified(address).catch((e) => e.message)}`);
  }
}
if (problems) process.exit(1);
