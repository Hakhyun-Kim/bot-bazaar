// Sponsored free play, end to end on BOT Chain testnet (968):
// deploy a GasTank, fill it, run the relayer (sponsor/relayer.mjs) inside this process, then a brand
// new empty wallet asks for free gas, gets it, and publishes a pixel design with it. The rest of the
// tank goes back to the deployer. Testnet only: spending real BOT on free play is harry's call.
//
//   DEPLOYER_KEY=0x... node scripts/sponsor-run.mjs           # dry run: balance and budget
//   DEPLOYER_KEY=0x... node scripts/sponsor-run.mjs --yes     # broadcast, writes docs/free-play-testnet-run.md
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ROOT, SPONSOR, compileAll } from "./lib/compile.mjs";
import { NETWORKS, chainOf } from "./lib/networks.mjs";
import { claimMessage } from "../sponsor/relayer.mjs";
import { serve } from "../sponsor/serve.mjs";

const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
// --network local runs the same steps on `npm run chain`. Mainnet is refused on purpose.
const network = argv.includes("--network") ? argv[argv.indexOf("--network") + 1] : "testnet";
if (!["testnet", "local"].includes(network)) throw new Error("free play runs on testnet (or local) only");
const net = NETWORKS[network];
const chain = chainOf(network);
const raw = (process.env.DEPLOYER_KEY || "").trim();
const key = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Set DEPLOYER_KEY (testnet wallet) in the environment");
const transport = http();
const pub = createPublicClient({ chain, transport });
const owner = createWalletClient({ account: privateKeyToAccount(key), chain, transport });
if ((await pub.getChainId()) !== net.id) throw new Error(`RPC is not ${net.name}`);
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${net.id}.json`), "utf8"));
const workshop = dep.contracts.PixelWorkshop.address;

const DRIP = parseEther("0.01");
const FILL = parseEther("0.05");
const bal = await pub.getBalance({ address: owner.account.address });
console.log(`deployer ${owner.account.address} · ${formatEther(bal)} test BOT`);
console.log(`plan: GasTank (drip ${formatEther(DRIP)}, daily cap ${formatEther(DRIP * 10n)}), fill ${formatEther(FILL)}, one new wallet claims and publishes, rest withdrawn`);
if (bal < FILL + parseEther("0.02")) throw new Error("not enough test BOT: get some from the faucet first");
if (!yes) {
  console.log("dry run: add --yes to broadcast");
  process.exit(0);
}

const rows = [];
const link = (h) => (net.explorer ? `[${h.slice(0, 10)}…](${net.explorer}/tx/${h})` : `\`${h.slice(0, 10)}…\``);
async function sent(step, hash) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${step} reverted (${hash})`);
  rows.push(`| ${rows.length + 1} | ${step} | ${link(hash)} | ${r.gasUsed} |`);
  console.log(`ok  ${step}  ${hash}`);
  return r;
}

const art = compileAll(SPONSOR).GasTank;
const tankR = await sent("Deploy GasTank (owner and relayer: deploy wallet)", await owner.deployContract({
  abi: art.abi, bytecode: art.bytecode, args: [owner.account.address, owner.account.address, DRIP, DRIP * 10n],
}));
const tank = { address: tankR.contractAddress, abi: art.abi };
await sent(`Fill the tank with ${formatEther(FILL)} BOT`, await owner.sendTransaction({ to: tank.address, value: FILL }));

const server = await serve({ SPONSOR_KEY: key, RPC_URL: net.rpc, TANK: tank.address }, 8788);
const player = privateKeyToAccount(generatePrivateKey()); // a fresh, empty browser wallet; its key is never written down
const signature = await player.signMessage({ message: claimMessage(chain.id, player.address) });
const claim = async () => {
  const r = await fetch("http://127.0.0.1:8788/drip", { method: "POST", body: JSON.stringify({ address: player.address, signature }) });
  return { status: r.status, body: await r.json() };
};
const first = await claim();
if (first.status !== 200) throw new Error(`drip refused: ${JSON.stringify(first.body)}`);
await sent(`Relayer drips ${formatEther(DRIP)} BOT to new wallet ${player.address.slice(0, 8)}…`, first.body.hash);
const playerWallet = createWalletClient({ account: player, chain, transport });
const pubR = await sent("New wallet publishes a design with the free gas", await playerWallet.writeContract({
  address: workshop, abi: compileAll(["PixelWorkshop"]).PixelWorkshop.abi, functionName: "register",
  args: ["Free gas robot", "0x0ff03c3c3ffc0ff00c300ff03c3c0000", 0x0189, 0n],
}));
const second = await claim();
const status = await (await fetch("http://127.0.0.1:8788/status")).json();
server.close();
const left = await pub.getBalance({ address: tank.address });
await sent(`Owner withdraws the rest (${formatEther(left)} BOT)`, await owner.writeContract({ ...tank, functionName: "withdraw", args: [left] }));
const playerLeft = await pub.getBalance({ address: player.address });

const md = `# Sponsored free play: testnet run

${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · ${net.name} (${net.id}) · \`node scripts/sponsor-run.mjs --yes\` (GitHub Actions)

A brand new browser wallet with 0 BOT asked the relayer for free gas, got ${formatEther(DRIP)} BOT from the
GasTank, and published a pixel design paying its own gas. Design and tank on BOTScan:
GasTank [${tank.address}](${net.explorer}/address/${tank.address}),
new wallet [${player.address}](${net.explorer}/address/${player.address}).

| # | Step | Transaction | Gas used |
|---|------|-------------|----------|
${rows.join("\n")}

- Publishing used ${pubR.gasUsed} gas; the new wallet still holds ${formatEther(playerLeft)} BOT for more designs.
- A second claim by the same wallet was refused: HTTP ${second.status}, "${second.body.error}".
- Relayer status before the withdrawal: ${status.dripCount} drip, ${formatEther(BigInt(status.spentToday))} BOT spent today of ${formatEther(BigInt(status.dailyCap))}.
`;
if (network === "testnet") {
  fs.writeFileSync(path.join(ROOT, "docs", "free-play-testnet-run.md"), md);
  console.log("\nwrote docs/free-play-testnet-run.md");
} else console.log(`\n${md}`);
