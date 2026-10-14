// Other people in the market right now. Browsers on the same network find each other through public
// Nostr relays (only to swap WebRTC offers) and then talk directly, so the static site needs no
// server, account or gas. Only a walk position, a look, a name and emotes are shared; nothing here
// touches a wallet. Peers that cannot connect (a strict NAT with no TURN server) simply stay alone.
import { joinRoom, type Room } from "trystero/nostr";

/** [x, z, facing, kind, hue seed, name] */
type Pose = [number, number, number, number, string, string];
export interface Peer {
  x: number;
  z: number;
  ry: number;
  kind: number;
  seed: string;
  name: string;
  at: number;
}

const APP_ID = "bot-bazaar.metah.dev";
const SEND_MS = 120;
const HEARTBEAT_MS = 3000;
const STALE_MS = 12000;

export const peers = new Map<string, Peer>();
let room: Room | null = null;
let roomKey = "";
let sendPose: ((p: Pose, o?: { target?: string }) => Promise<void>) | null = null;
let sendEmote: ((icon: string) => Promise<void>) | null = null;
let last: Pose | null = null;
let lastAt = 0;
let version = 0;
const subs = new Set<() => void>();
const changed = () => (version++, subs.forEach((f) => f()));
export const subscribePeers = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const peersVersion = () => version;

const NAME_KEY = "bazaar-name";
const NAMES = ["Tomo", "Rin", "Kai", "Nori", "Suri", "Dami", "Yuna", "Ollie", "Fern", "Miro", "Haru", "Bea", "Toto", "Lumi", "Sol", "Jae"];
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
/** The name others see over your head. Picked once at random, renamed from the 🏷️ button. */
export function myName(): string {
  let n = store.get(NAME_KEY);
  if (!n) store.set(NAME_KEY, (n = NAMES[Math.floor(Math.random() * NAMES.length)]));
  return n;
}
export function setMyName(n: string) {
  const clean = n.replace(/\s+/g, " ").trim().slice(0, 16);
  if (!clean) return;
  store.set(NAME_KEY, clean);
  last = null; // goes out with the next pose
}
/** Colour seed for your figure: random per browser, so no wallet address is shared. */
function mySeed(): string {
  let s = store.get("bazaar-seed");
  if (!s) store.set("bazaar-seed", (s = `0x${Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("")}`));
  return s;
}

let onEmote: (peerId: string, icon: string) => void = () => {};
export function onPeerEmote(f: typeof onEmote) {
  onEmote = f;
}

/** Join the room for this network (mainnet, testnet and demo players meet only their own). */
export function joinMarket(network: string) {
  if (network === roomKey) return;
  void leaveMarket();
  if (new URLSearchParams(location.search).has("solo") || typeof RTCPeerConnection === "undefined") return;
  roomKey = network;
  // ?relay=ws://localhost:7777 points at a local relay (two-browser tests); public relays otherwise.
  const relay = new URLSearchParams(location.search).get("relay");
  try {
    room = joinRoom({ appId: APP_ID, ...(relay ? { relayConfig: { urls: [relay] } } : {}) }, `market-${network}`);
  } catch {
    room = null;
    return;
  }
  const pose = room.makeAction<Pose>("pose");
  const emote = room.makeAction<string>("emote");
  sendPose = pose.send;
  sendEmote = emote.send;
  pose.onMessage = (p, { peerId }) => {
    if (!Array.isArray(p) || p.length < 6) return;
    const [x, z, ry, kind, seed, name] = p;
    if (![x, z, ry, kind].every(Number.isFinite)) return;
    const had = peers.get(peerId);
    peers.set(peerId, { x, z, ry, kind: kind | 0, seed: String(seed).slice(0, 42), name: String(name).slice(0, 16), at: performance.now() });
    if (!had || had.name !== name || had.kind !== kind) changed();
  };
  emote.onMessage = (icon, { peerId }) => {
    if (typeof icon === "string" && icon.length <= 8 && peers.has(peerId)) onEmote(peerId, icon);
  };
  room.onPeerJoin = (id) => last && void sendPose?.(last, { target: id });
  room.onPeerLeave = (id) => peers.delete(id) && changed();
}

export async function leaveMarket() {
  const r = room;
  room = null;
  roomKey = "";
  sendPose = sendEmote = null;
  if (peers.size) peers.clear(), changed();
  await r?.leave().catch(() => undefined);
}

/** Called every frame with where you are; sends only when you moved, plus a heartbeat. */
export function tellPose(x: number, z: number, ry: number, kind: number) {
  const now = performance.now();
  if (!sendPose || document.hidden) return;
  const p: Pose = [Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(ry * 100) / 100, kind, mySeed(), myName()];
  const moved = !last || p.some((v, i) => v !== last![i]);
  if (now - lastAt < (moved ? SEND_MS : HEARTBEAT_MS)) return;
  last = p;
  lastAt = now;
  void sendPose(p).catch(() => undefined);
  for (const [id, peer] of peers) if (now - peer.at > STALE_MS) peers.delete(id), changed();
}

export function tellEmote(icon: string) {
  void sendEmote?.(icon).catch(() => undefined);
}
