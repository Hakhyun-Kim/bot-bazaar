// Sponsored free play: the relayer in front of contracts/GasTank.sol.
// A new player's browser wallet is empty, so it cannot pay for its own first transaction. The page
// signs one plain message with that wallet and posts it here; the relayer checks it and asks the
// tank to drip a little BOT to the wallet. The relayer key only pays the drip's gas; the money sits
// in the tank, whose on-chain limits (one drip per address, a daily cap) bound any abuse.
//
// One fetch handler, so the same file runs as a Cloudflare Worker (export default) and under Node
// (sponsor/serve.mjs). Settings come from the environment:
//   SPONSOR_KEY       relayer key (the tank's `relayer`), holds a little BOT for gas only
//   RPC_URL           chain RPC
//   TANK              GasTank address
//   ALLOW_ORIGIN      the page's origin, e.g. https://play.metah.dev (default *)
//   TURNSTILE_SECRET  optional: require a Cloudflare Turnstile token with each request
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const TANK_ABI = parseAbi([
  "function drip(address to)",
  "function refusal(address to) view returns (string)",
  "function dripAmount() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function day() view returns (uint256)",
  "function dripCount() view returns (uint256)",
  "function totalDripped() view returns (uint256)",
  "function relayer() view returns (address)",
]);

/** The one message a player's wallet signs. Shared with the page (web/src/sponsor.ts). */
export const claimMessage = (chainId, address) => `BOT Bazaar free gas\nChain: ${chainId}\nAddress: ${getAddress(address)}`;

const REFUSAL = {
  already: "This wallet already got its free gas.",
  contract: "Free gas goes to player wallets only.",
  "has-gas": "This wallet already has enough BOT for gas.",
  "daily-cap": "Today's free gas is used up. Try again tomorrow.",
  empty: "The free gas tank is empty right now.",
};

// One drip at a time per relayer process, so two requests do not race for the same nonce.
let line = Promise.resolve();
const oneAtATime = (fn) => {
  const next = line.then(fn, fn);
  line = next.catch(() => undefined);
  return next;
};

let cached;
async function clients(env) {
  if (cached?.env === env) return cached;
  const transport = http(env.RPC_URL);
  const probe = createPublicClient({ transport });
  const id = await probe.getChainId();
  const chain = defineChain({ id, name: `chain ${id}`, nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 }, rpcUrls: { default: { http: [env.RPC_URL] } } });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account: privateKeyToAccount(env.SPONSOR_KEY), chain, transport });
  cached = { env, chain, pub, wallet, tank: { address: getAddress(env.TANK), abi: TANK_ABI } };
  return cached;
}

async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return (await r.json()).success === true;
}

export async function handle(request, env) {
  const cors = {
    "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { pub, wallet, tank, chain } = await clients(env);
    const read = (functionName, args = []) => pub.readContract({ ...tank, functionName, args });
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (request.method === "GET" && (path === "" || path === "/status")) {
      const [dripAmount, dailyCap, spentToday, day, dripCount, totalDripped, balance] = await Promise.all([
        read("dripAmount"), read("dailyCap"), read("spentToday"), read("day"), read("dripCount"), read("totalDripped"), pub.getBalance({ address: tank.address }),
      ]);
      const spent = day === BigInt(Math.floor(Date.now() / 86400000)) ? spentToday : 0n;
      return json({
        chainId: chain.id, tank: tank.address, dripAmount: String(dripAmount), dailyCap: String(dailyCap), spentToday: String(spent),
        dripCount: Number(dripCount), totalDripped: String(totalDripped), balance: String(balance),
        open: balance >= dripAmount && spent + dripAmount <= dailyCap, turnstile: !!env.TURNSTILE_SECRET,
      });
    }
    if (request.method !== "POST" || path !== "/drip") return json({ error: "Not found" }, 404);
    const body = await request.json().catch(() => ({}));
    const { address, signature, turnstile } = body;
    if (typeof address !== "string" || !isAddress(address) || typeof signature !== "string") return json({ error: "Send an address and its signature." }, 400);
    const to = getAddress(address);
    if (!(await verifyMessage({ address: to, message: claimMessage(chain.id, to), signature }))) return json({ error: "The signature does not match this wallet." }, 400);
    if (!(await turnstileOk(env, turnstile, request.headers.get("CF-Connecting-IP")))) return json({ error: "Please complete the check first." }, 403);
    const why = await read("refusal", [to]);
    if (why) return json({ error: REFUSAL[why] ?? why, reason: why }, 409);
    const { hash, r } = await oneAtATime(async () => {
      const hash = await wallet.writeContract({ ...tank, functionName: "drip", args: [to] });
      return { hash, r: await pub.waitForTransactionReceipt({ hash }) };
    });
    if (r.status !== "success") return json({ error: "The drip transaction failed.", hash }, 502);
    return json({ hash, amount: String(await read("dripAmount")) });
  } catch (e) {
    return json({ error: e.shortMessage || e.message }, 500);
  }
}

export default { fetch: handle };
