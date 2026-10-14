// The bazaar as a place: a sunny cartoon market where every open shop is a striped-awning stall
// with its owner behind the counter (a robot, a person, a person with a drone, or a hooded
// undeclared trader), parcels wait in the escrow lockers in the middle, and the request board,
// Bot or Not puppet theatre, pixel easel and project gate stand on the paths. Walk with WASD /
// arrows or tap the ground; click anything to trade. Everything shown is read from the chain by
// main.ts and handed in as data. Gallery frames show the on-chain pixel designs; residents walk
// about and chat, and emotes and a daily errand (after GIWA Village) need no contract at all.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Outlines } from "@react-three/drei";
import { Color, DataTexture, Group, InstancedMesh, Mesh, MeshBasicMaterial, NearestFilter, Object3D, RedFormat, Vector3 } from "three";
import { PRESET16, decodePixels } from "../pixel";
import { completeErrand, errandFor, loadErrand, type ErrandId, type ErrandState } from "./errands";

export type Tab = "requests" | "botornot" | "workshop" | "projects" | "account";
export type Target = { kind: "shop"; owner: string } | { kind: "tab"; tab: Tab };

export interface WorldShop {
  owner: string;
  title: string;
  category: number;
  kind: number;
  label: string;
  items: { name: string; price: string }[];
}
export interface WorldData {
  me: string | null;
  myKind: number;
  myShop: boolean;
  shops: WorldShop[];
  requests: { title: string; reward: string; wants: number }[];
  rounds: { trader: string; bot: number; human: number }[];
  designs: { id: number; name: string; pixels: string; palette: number; creator: string; createdAt: number }[];
  /** Real on-chain numbers for the billboard (see designFeed in main.ts). */
  stats: { total: number; day: string; artists: string; now: number };
  projects: string[];
  purchases: number;
  /** Only the Pixel Workshop is deployed here (mainnet v1): the rest of the market shows as coming soon. */
  soon: boolean;
}
export interface WorldApi {
  update(d: WorldData): void;
  pulse(): void;
  /** Designs that went on chain while the market was open: a banner, and the residents notice. */
  announce(designs: WorldData["designs"]): void;
  /** Something outside the 3D scene (the Pixel Workshop button) counts toward today's errand. */
  errand(id: ErrandId): void;
  destroy(): void;
}

const EMPTY: WorldData = {
  me: null, myKind: 0, myShop: false, shops: [], requests: [], rounds: [], designs: [], stats: { total: 0, day: "0", artists: "0", now: 0 }, projects: [], purchases: 0, soon: false,
};
const ago = (sec: number) =>
  sec < 90 ? "just now" : sec < 3600 ? `${Math.round(sec / 60)} min ago` : sec < 86400 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} d ago`;
/** Awning colours by category: goods, services, developer assets, agent services */
const CAT = ["#ff8a5c", "#4fa8ff", "#5ccf7a", "#b98cff"];
const CAT_NAME = ["Goods", "Service", "Dev asset", "Agent service"];
const INK = "#3a2e3f";
const WOOD = "#c98b52";
const WOOD_DARK = "#8a5a35";
const CREAM = "#fff6e6";
const GOODS = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#ff9f1c"];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hue = (a: string) => {
  let h = 0;
  for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 75%, 64%)`;
};

/** Three flat bands of light: the cartoon look comes from this plus ink outlines. */
const GRAD = (() => {
  const t = new DataTexture(new Uint8Array([90, 175, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
})();

type V3 = [number, number, number];
/** One cartoon part: geometry as the child, toon paint and an ink outline. */
function P({ children, color, position, rotation, scale, line = 0.03 }: {
  children: ReactNode; color: string; position?: V3; rotation?: V3; scale?: V3 | number; line?: number;
}) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      {children}
      <meshToonMaterial color={color} gradientMap={GRAD} />
      {line ? <Outlines thickness={line} color={INK} /> : null}
    </mesh>
  );
}

// ---------- layout: one table for drawing, clicking, colliding and "press F" ----------
const LANDMARK = {
  core: { x: 0, z: 0, r: 2.3 },
  board: { x: 0, z: -18, r: 2.4 },
  stage: { x: 18, z: 0, r: 2.8 },
  wall: { x: -18, z: 0, r: 2 },
  gate: { x: 0, z: -27, r: 0 },
};
const WORLD_R = 28;
/** Stall slots on two rings, leaving the four paths to the landmarks clear. */
const SLOTS: { x: number; z: number; rot: number }[] = (() => {
  const out: { x: number; z: number; rot: number }[] = [];
  const add = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    out.push({ x, z, rot: Math.atan2(-x, -z) });
  };
  for (const d of [36, 324, 60, 300, 108, 252, 132, 228, 156, 204]) add(d, 10.5);
  for (const d of [33, 327, 57, 303, 123, 237, 147, 213]) add(d, 15.5);
  return out;
})();
/** Trees around the edge, placed by a fixed rule so they never move between visits. */
const TREES = Array.from({ length: 26 }, (_, i) => {
  const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.07;
  const r = 21.5 + ((i * 7) % 5);
  return { x: Math.sin(a) * r, z: -Math.cos(a) * r, s: 0.9 + ((i * 13) % 7) / 10, kind: i % 3 };
}).filter((t) => Math.abs(t.x) > 3 && Math.abs(t.z) > 3); // keep the paths open

// ---------- data store shared with main.ts ----------
let data: WorldData = EMPTY;
let pulses = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f));
const useData = () => useSyncExternalStore(subscribe, () => data);
const usePulses = () => useSyncExternalStore(subscribe, () => pulses);

/** Where the player is, for the camera, collisions and the nearest-thing hint. */
const player = { x: 0, z: 9, target: null as null | { x: number; z: number } };
interface Spot {
  x: number;
  z: number;
  r: number;
  name: string;
  target: Target | null;
  /** Done in the scene instead of opening a panel (talking to a resident). */
  act?: () => void;
}

// ---------- residents, emotes and today's errand: no chain needed ----------
export const EMOTES = [
  { icon: "👋", name: "Wave" },
  { icon: "🙇", name: "Bow" },
  { icon: "👏", name: "Clap" },
  { icon: "💃", name: "Dance" },
  { icon: "🥤", name: "Cheers" },
] as const;
interface Resident {
  id: string;
  name: string;
  kind: number;
  address: string;
  /** Where they walk: a ring around the lockers (r 0 stands still at home). */
  home: [number, number];
  ring: number;
  speed: number;
  /** Who or what they look at while standing still (when the player is not close). */
  face?: [number, number];
  lines: string[];
  /** Said now and then without being asked, so the market sounds busy. NPCs only, never posing as visitors. */
  idle?: string[];
}
const RESIDENTS: Resident[] = [
  {
    id: "bolt", name: "Bolt", kind: 2, address: "0xb0170000000000000000000000000000000000b0", home: [2.2, 8.0], ring: 0, speed: 0,
    lines: [
      "Welcome to BOT Bazaar! Walk with WASD or the arrows, or tap the ground.",
      "The easel on the west path is the Pixel Workshop. Publishing a design is free, you only pay gas.",
      "Every frame in the gallery is a design someone put on BOT Chain. Yours could hang here too.",
      "The shops and parcel lockers open here later. For now we draw, chat and wave!",
      "Try an emote while I'm close. Two of us at once counts as together!",
      "Check the request board up north for today's errand. It gives you a stamp.",
    ],
  },
  {
    id: "pip", name: "Pip", kind: 3, address: "0x9109000000000000000000000000000000000a11", home: [0, 0], ring: 6.0, speed: 0.07,
    lines: [
      "My drone carries my pencils. It drops them a lot.",
      "Eight by eight sounds tiny, but you can fit a whole cat in there.",
      "Have you seen the theatre on the east path? I always guess wrong.",
      "I like the frames by the north path best. The light is nice there.",
    ],
  },
  {
    id: "mo", name: "Mo", kind: 0, address: "0x3030000000000000000000000000000000000303", home: [0, 0], ring: 6.6, speed: -0.05,
    lines: [
      "Am I a bot or a human? That is for the theatre to guess.",
      "I keep my hood up. It is more fun that way.",
      "Psst. Do a little dance. Everyone joins in if they are close.",
      "I walked around this market a thousand times. Or maybe twice.",
    ],
  },
  {
    id: "juno", name: "Juno", kind: 1, address: "0x7070000000000000000000000000000000000909", home: [0, 0], ring: 5.4, speed: 0.045,
    lines: [
      "I'm saving up ideas for when the shops open.",
      "Did you collect today's stamp yet? I've got a little stack of them.",
      "A design on chain stays there. That's why I draw slowly.",
      "Hello! Nice day for the market, isn't it?",
    ],
  },
  {
    id: "ari", name: "Ari", kind: 2, address: "0xa1a1000000000000000000000000000000000a1a", home: [-15.0, 2.6], ring: 0, speed: 0, face: [-18, 0],
    lines: [
      "I'm copying the easel, square by square. Don't look yet!",
      "Tip: pick your four colours first. Then the drawing gets easy.",
      "Every design gets its own frame in the market. I check them every morning.",
    ],
    idle: ["Hmm, one more blue square…", "Almost done!", "Oops. That pixel was meant to be pink."],
  },
  {
    id: "kip", name: "Kip", kind: 1, address: "0x4b1b000000000000000000000000000000000b1b", home: [-3.0, -13.6], ring: 0, speed: 0, face: [-1.6, -14.4],
    lines: ["We're arguing about which frame is the best one.", "Dot thinks robots draw better. I'm not so sure."],
    idle: ["Dot, did you see the new frame?", "I'd hang mine right next to the board.", "Ha! Good one, Dot."],
  },
  {
    id: "dot", name: "Dot", kind: 2, address: "0xd07d000000000000000000000000000000000d07", home: [-1.6, -14.4], ring: 0, speed: 0, face: [-3.0, -13.6],
    lines: ["Beep. I mean: hello!", "I counted the frames twice. Then I counted them again."],
    idle: ["Kip, the theatre is open for practice!", "Robots draw straighter lines. Fact.", "Beep boop. Just kidding."],
  },
];
/** Where each resident stands right now, written by their frame loop, read by the player's. */
const residentAt = new Map<string, { x: number; z: number }>();
/** Speech bubbles and emotes: who shows what, until when. "me" is the player. */
const bubbles = new Map<string, { text: string; emote?: string; until: number }>();
let errand: ErrandState = loadErrand();
let chatVersion = 0;
const chatEmit = () => (chatVersion++, emit());
const useChat = () => useSyncExternalStore(subscribe, () => chatVersion);
const lineIndex = new Map<string, number>();
/** The bubble someone shows now; re-renders once more when it runs out. */
function useBubble(id: string) {
  useChat();
  const [, tick] = useState(0);
  const b = bubbles.get(id);
  const live = b && b.until > performance.now() ? b : null;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => tick((v) => v + 1), live.until - performance.now() + 30);
    return () => clearTimeout(t);
  }, [live]);
  return live;
}

function finishErrand(id: ErrandId) {
  if (errand.day !== loadErrand().day) errand = loadErrand(); // the page stayed open past midnight
  const next = completeErrand(id, errand);
  if (!next) return;
  errand = next;
  bubbles.set("me", { text: `📮 Errand done! Stamp #${next.stamps}`, until: performance.now() + 3200 });
  chatEmit();
}

function talk(r: Resident) {
  const i = lineIndex.get(r.id) ?? 0;
  lineIndex.set(r.id, i + 1);
  bubbles.set(r.id, { text: r.lines[i % r.lines.length], until: performance.now() + 5200 });
  chatEmit();
  finishErrand("talk");
}

/** A line said unasked. Bolt reads the real numbers off the billboard. */
function idleLine(r: Resident): string {
  const st = data.stats;
  if (r.id === "bolt" && st.total) return Math.random() < 0.5 ? `${st.total} designs on BOT Chain so far. ${st.day} in the last day!` : "Hi there! Tap me if you need a tip.";
  const pool = r.idle ?? r.lines;
  return pool[Math.floor(Math.random() * pool.length)];
}
function chatter() {
  const now = performance.now();
  const near = RESIDENTS.filter((r) => {
    const at = residentAt.get(r.id);
    const b = bubbles.get(r.id);
    return at && Math.hypot(at.x - player.x, at.z - player.z) < 16 && !(b && b.until > now);
  });
  if (!near.length) return;
  const r = near[Math.floor(Math.random() * near.length)];
  bubbles.set(r.id, { text: idleLine(r), until: now + 3800 });
  chatEmit();
}

/** Designs that went on chain while the market is open: a banner, and the residents close by react. */
let news: { text: string; until: number } | null = null;
function announce(list: WorldData["designs"]) {
  if (!list.length) return;
  const d = list[0];
  const now = performance.now();
  news = { text: `🆕 “${d.name}” just went on BOT Chain · by ${short(d.creator)}${list.length > 1 ? ` · +${list.length - 1} more` : ""}`, until: now + 7000 };
  for (const r of RESIDENTS) {
    const at = residentAt.get(r.id);
    if (at && Math.hypot(at.x - player.x, at.z - player.z) < 16) bubbles.set(r.id, { text: `Ooh, a new frame: “${d.name}”!`, emote: "👏", until: now + 3000 });
  }
  chatEmit();
}

/** The player emotes; residents close by join in a beat later (GIWA Village's "together"). */
function doEmote(icon: string) {
  const now = performance.now();
  const p = { x: player.x, z: player.z };
  const near = RESIDENTS.filter((r) => {
    const at = residentAt.get(r.id);
    return at && Math.hypot(at.x - p.x, at.z - p.z) < 6;
  });
  bubbles.set("me", { text: near.length ? `${icon} together ×${near.length + 1}` : icon, emote: icon, until: now + 2200 });
  chatEmit();
  if (!near.length) return;
  setTimeout(() => {
    const t = performance.now();
    for (const r of near) bubbles.set(r.id, { text: `${icon} together!`, emote: icon, until: t + 2200 });
    chatEmit();
    finishErrand("together");
  }, 450);
}

// ---------- figures (chibi: big heads, small bodies) ----------
function Eyes({ z, y = 0, gap = 0.1, size = 0.045 }: { z: number; y?: number; gap?: number; size?: number }) {
  return (
    <>
      {[-gap, gap].map((x) => (
        <mesh key={x} position={[x, y, z]}>
          <sphereGeometry args={[size, 10, 10]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      ))}
    </>
  );
}

function useBob(speed = 1.6, height = 0.05) {
  const ref = useRef<Group>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = Math.abs(Math.sin(clock.elapsedTime * speed + seed)) * height;
  });
  return ref;
}

function Robot({ color }: { color: string }) {
  const bob = useBob(2.2, 0.06);
  return (
    <group ref={bob}>
      {[-0.14, 0.14].map((x) => (
        <P key={x} color="#8d95a8" position={[x, 0.16, 0]}><cylinderGeometry args={[0.08, 0.1, 0.32, 10]} /></P>
      ))}
      <P color={color} position={[0, 0.58, 0]}><boxGeometry args={[0.6, 0.55, 0.45]} /></P>
      {[-0.38, 0.38].map((x) => (
        <P key={x} color="#8d95a8" position={[x, 0.6, 0]} rotation={[0, 0, x > 0 ? -0.5 : 0.5]}><cylinderGeometry args={[0.05, 0.05, 0.36, 8]} /></P>
      ))}
      <P color="#eef1f7" position={[0, 1.18, 0]}><boxGeometry args={[0.78, 0.62, 0.6]} /></P>
      <mesh position={[0, 1.18, 0.305]}>
        <planeGeometry args={[0.58, 0.4]} />
        <meshBasicMaterial color="#2c3550" />
      </mesh>
      {[-0.13, 0.13].map((x) => (
        <mesh key={x} position={[x, 1.21, 0.31]}>
          <circleGeometry args={[0.07, 16]} />
          <meshBasicMaterial color="#8ff0ff" />
        </mesh>
      ))}
      <mesh position={[0, 1.08, 0.31]}>
        <planeGeometry args={[0.16, 0.035]} />
        <meshBasicMaterial color="#8ff0ff" />
      </mesh>
      <P color="#8d95a8" position={[0, 1.6, 0]}><cylinderGeometry args={[0.025, 0.025, 0.24, 6]} /></P>
      <P color={color} position={[0, 1.75, 0]}><sphereGeometry args={[0.08, 12, 12]} /></P>
    </group>
  );
}

function Human({ color }: { color: string }) {
  const bob = useBob();
  return (
    <group ref={bob}>
      <P color={color} position={[0, 0.42, 0]}><cylinderGeometry args={[0.2, 0.32, 0.72, 16]} /></P>
      <P color="#ffd7b5" position={[0, 1.12, 0]}><sphereGeometry args={[0.36, 20, 20]} /></P>
      <P color="#5a3a2a" position={[0, 1.22, -0.03]} scale={[1.06, 0.82, 1.06]}>
        <sphereGeometry args={[0.36, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </P>
      <Eyes z={0.33} y={1.1} gap={0.12} size={0.05} />
      <mesh position={[0, 1.0, 0.33]}>
        <circleGeometry args={[0.05, 12, Math.PI, Math.PI]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 1.03, 0.3]}>
          <circleGeometry args={[0.05, 12]} />
          <meshBasicMaterial color="#ff9fae" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Drone({ color }: { color: string }) {
  const g = useRef<Group>(null);
  const blade = useRef<Mesh>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (g.current) g.current.position.set(0.6 + Math.sin(t) * 0.1, 1.75 + Math.sin(t * 2.3) * 0.08, Math.cos(t) * 0.1);
    if (blade.current) blade.current.rotation.y += dt * 20;
  });
  return (
    <group ref={g}>
      <P color={color}><sphereGeometry args={[0.15, 14, 14]} /></P>
      <Eyes z={0.13} gap={0.05} size={0.025} />
      <P color="#eef1f7" position={[0, 0.17, 0]}><cylinderGeometry args={[0.015, 0.015, 0.1, 6]} /></P>
      <mesh ref={blade} position={[0, 0.22, 0]}>
        <boxGeometry args={[0.42, 0.015, 0.05]} />
        <meshBasicMaterial color={INK} />
      </mesh>
    </group>
  );
}

function Hooded({ cloak = "#8f84b3" }: { cloak?: string }) {
  const bob = useBob(1.2, 0.04);
  return (
    <group ref={bob}>
      <P color={cloak} position={[0, 0.5, 0]}><coneGeometry args={[0.42, 1.0, 16]} /></P>
      <P color={cloak} position={[0, 1.12, 0]}><sphereGeometry args={[0.38, 18, 18]} /></P>
      <mesh position={[0, 1.08, 0.24]} scale={[1, 0.9, 0.5]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color="#2f2840" />
      </mesh>
      {[-0.09, 0.09].map((x) => (
        <mesh key={x} position={[x, 1.1, 0.375]}>
          <circleGeometry args={[0.055, 14]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

/** A trader as they declared themselves; undeclared ones keep their hood up. */
export function Trader({ kind, address, you }: { kind: number; address: string; you?: boolean }) {
  const color = hue(address.toLowerCase());
  if (kind === 2) return <Robot color={color} />;
  if (kind === 1) return <Human color={color} />;
  if (kind === 3) return (<group><Human color={color} /><Drone color={color} /></group>);
  return <Hooded cloak={you ? "#4cc3d9" : undefined} />;
}

// ---------- places ----------
function hover(on: boolean) {
  document.body.style.cursor = on ? "pointer" : "auto";
}
function clickable(open: () => void) {
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => (e.stopPropagation(), open()),
    onPointerOver: (e: ThreeEvent<PointerEvent>) => (e.stopPropagation(), hover(true)),
    onPointerOut: () => hover(false),
  };
}

/** Striped awning — the shape every stall shares. */
function Awning({ color, width = 3 }: { color: string; width?: number }) {
  const n = 6;
  const w = width / n;
  return (
    <group position={[0, 2.35, 0.1]} rotation={[0.35, 0, 0]}>
      {Array.from({ length: n }, (_, i) => (
        <P key={i} color={i % 2 ? CREAM : color} position={[-width / 2 + w / 2 + i * w, 0, 0]} line={0.02}>
          <boxGeometry args={[w, 0.08, 1.9]} />
        </P>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <P key={`s${i}`} color={i % 2 ? CREAM : color} position={[-width / 2 + w / 2 + i * w, -0.04, 0.95]} rotation={[0, 0, Math.PI]} line={0.02}>
          <cylinderGeometry args={[w / 2, w / 2, 0.08, 12, 1, false, Math.PI / 2, Math.PI]} />
        </P>
      ))}
    </group>
  );
}

function Stall({ shop, slot, open }: { shop: WorldShop; slot: (typeof SLOTS)[number]; open: (t: Target) => void }) {
  const color = CAT[shop.category] ?? CAT[0];
  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.rot, 0]} {...clickable(() => open({ kind: "shop", owner: shop.owner }))}>
      {[-1.35, 1.35].map((x) => (
        <P key={x} color={WOOD_DARK} position={[x, 1.2, -0.7]}><cylinderGeometry args={[0.08, 0.09, 2.4, 10]} /></P>
      ))}
      {[-1.35, 1.35].map((x) => (
        <P key={`f${x}`} color={WOOD_DARK} position={[x, 1.1, 0.95]}><cylinderGeometry args={[0.07, 0.08, 2.2, 10]} /></P>
      ))}
      <Awning color={color} />
      <P color={WOOD} position={[0, 0.48, 0.7]}><boxGeometry args={[2.8, 0.96, 0.6]} /></P>
      <P color={color} position={[0, 0.55, 1.01]} line={0.015}><boxGeometry args={[1.6, 0.4, 0.02]} /></P>
      {shop.items.slice(0, 3).map((_, i) => (
        <group key={i} position={[-0.85 + i * 0.85, 1.07, 0.7]}>
          <P color="#e9b872" line={0.02}><cylinderGeometry args={[0.24, 0.18, 0.14, 14]} /></P>
          {[0, 1, 2].map((k) => (
            <P key={k} color={GOODS[(i * 3 + k) % GOODS.length]} position={[(k - 1) * 0.1, 0.12 + (k === 1 ? 0.08 : 0), (k % 2) * 0.05]} line={0.015}>
              <sphereGeometry args={[0.09, 12, 12]} />
            </P>
          ))}
        </group>
      ))}
      <group position={[0, 0, -0.2]}>
        <Trader kind={shop.kind} address={shop.owner} />
      </group>
      <Html position={[0, 3.25, 0.6]} center distanceFactor={13} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign" style={{ borderTopColor: color }}>
          <b>{shop.title}</b>
          <span>
            {["❓", "🧑", "🤖", "🧑🤖"][shop.kind] ?? "❓"} {shop.kind ? shop.label || short(shop.owner) : "bot or not?"} · {CAT_NAME[shop.category]}
          </span>
        </div>
      </Html>
    </group>
  );
}

function EmptyStall({ slot, open }: { slot: (typeof SLOTS)[number]; open: (t: Target) => void }) {
  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.rot, 0]} {...clickable(() => open({ kind: "tab", tab: "account" }))}>
      {[-1.35, 1.35].map((x) => (
        <P key={x} color={WOOD_DARK} position={[x, 1.2, -0.7]}><cylinderGeometry args={[0.08, 0.09, 2.4, 10]} /></P>
      ))}
      <Awning color="#d9d2c3" />
      <P color={WOOD} position={[0, 0.48, 0.7]}><boxGeometry args={[2.8, 0.96, 0.6]} /></P>
      <P color={CREAM} position={[0, 1.4, -0.68]} line={0.02}><boxGeometry args={[1.4, 0.7, 0.05]} /></P>
      <Html position={[0, 3.1, 0.6]} center distanceFactor={13} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign free">
          <b>Free stall</b>
          <span>open your shop here</span>
        </div>
      </Html>
    </group>
  );
}

/** A shuttered stall for a network where shops are not open yet. */
function SoonStall({ slot, open }: { slot: (typeof SLOTS)[number]; open: (t: Target) => void }) {
  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.rot, 0]} {...clickable(() => open({ kind: "tab", tab: "account" }))}>
      {[-1.35, 1.35].map((x) => (
        <P key={x} color={WOOD_DARK} position={[x, 1.2, -0.7]}><cylinderGeometry args={[0.08, 0.09, 2.4, 10]} /></P>
      ))}
      <Awning color="#d9d2c3" />
      <P color={WOOD} position={[0, 0.48, 0.7]}><boxGeometry args={[2.8, 0.96, 0.6]} /></P>
      <P color="#e9b872" position={[0, 1.55, 0.95]} line={0.02}><boxGeometry args={[2.7, 1.1, 0.06]} /></P>
      <Html position={[0, 3.1, 0.6]} center distanceFactor={13} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign free">
          <b>Shop</b>
          <span>coming soon</span>
        </div>
      </Html>
    </group>
  );
}

/** A gallery stand: an on-chain design hung in a big frame where a shop would be. An empty frame
 *  invites the visitor to draw the next one. */
const FRAME = ["#ffd166", "#7cc6f2", "#ff8fa3", "#5ccf7a", "#b98cff", "#ff9f1c"];
function GalleryStand({ slot, design, n, open }: { slot: (typeof SLOTS)[number]; design: Design | null; n: number; open: (t: Target) => void }) {
  const color = FRAME[n % FRAME.length];
  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.rot, 0]} {...clickable(() => open({ kind: "tab", tab: "workshop" }))}>
      {[-1.35, 1.35].map((x) => (
        <P key={x} color={WOOD_DARK} position={[x, 1.2, -0.7]}><cylinderGeometry args={[0.08, 0.09, 2.4, 10]} /></P>
      ))}
      <Awning color={color} />
      <P color={WOOD} position={[0, 0.3, 0.7]}><boxGeometry args={[2.8, 0.6, 0.6]} /></P>
      {[0, 1, 2].map((k) => (
        <P key={k} color={GOODS[(n + k) % GOODS.length]} position={[-0.9 + k * 0.9, 0.7, 0.75]} line={0.015}><cylinderGeometry args={[0.16, 0.13, 0.22, 12]} /></P>
      ))}
      <P color={color} position={[0, 1.75, -0.6]}><boxGeometry args={[2.25, 2.25, 0.14]} /></P>
      <P color={CREAM} position={[0, 1.75, -0.52]} line={0}><boxGeometry args={[2.0, 2.0, 0.04]} /></P>
      <PixelArt design={design} cell={0.24} position={[0, 1.75, -0.47]} />
      <Html position={[0, 3.25, 0.6]} center distanceFactor={13} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className={`w-sign gallery${design ? "" : " free"}`} style={{ borderTopColor: color }}>
          <b>{design ? `🖼️ “${design.name}”` : "🖼️ Empty frame"}</b>
          <span>{design ? `by ${short(design.creator)} · ${ago(data.stats.now - design.createdAt)}` : "publish a design to hang here"}</span>
        </div>
      </Html>
    </group>
  );
}

/** A resident walking the market. Tap them (or press F close by) and they say something. */
function ResidentFigure({ r, open }: { r: Resident; open: () => void }) {
  const bubble = useBubble(r.id);
  const g = useRef<Group>(null);
  const body = useRef<Group>(null);
  const t = useRef(Math.random() * 100);
  const angle = useRef((RESIDENTS.indexOf(r) / RESIDENTS.length) * Math.PI * 2 + 0.6);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1);
    t.current += dt;
    if (!g.current) return;
    const b = bubbles.get(r.id);
    const busy = !!b && b.until > performance.now();
    const close = Math.hypot(g.current.position.x - player.x, g.current.position.z - player.z) < 2.6;
    let x = r.home[0];
    let z = r.home[1];
    if (r.ring) {
      // stroll, with a pause every so often; stop to chat when the player is close
      const stroll = Math.sin(t.current * 0.35) > -0.4;
      if (stroll && !busy && !close) angle.current += r.speed * dt * 3;
      x = Math.sin(angle.current) * r.ring;
      z = -Math.cos(angle.current) * r.ring;
    }
    const moving = Math.hypot(x - g.current.position.x, z - g.current.position.z) > 0.0005;
    if (moving) g.current.rotation.y = Math.atan2(x - g.current.position.x, z - g.current.position.z);
    else if (close) g.current.rotation.y = Math.atan2(player.x - x, player.z - z);
    else if (r.face) g.current.rotation.y = Math.atan2(r.face[0] - x, r.face[1] - z);
    g.current.position.set(x, 0, z);
    residentAt.set(r.id, { x, z });
    if (body.current) emoteMotion(body.current, b, t.current);
  });
  return (
    <group ref={g} {...clickable(open)}>
      <group ref={body}>
        <Trader kind={r.kind} address={r.address} />
      </group>
      <Html position={[0, 2.25, 0]} center distanceFactor={12} zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
        {bubble ? <div className="w-say"><small>{r.name} <i>NPC</i></small>{bubble.text}</div> : <div className="w-name">{r.name} <i>NPC</i></div>}
      </Html>
    </group>
  );
}

/** Small body motions for emotes: a hop, a bow, a spin. */
function emoteMotion(o: Group, b: { emote?: string; until: number } | undefined, t: number) {
  const on = !!b?.emote && b.until > performance.now();
  o.rotation.set(0, 0, 0);
  o.position.y = 0;
  if (!on) return;
  if (b!.emote === "🙇") o.rotation.x = 0.45;
  else if (b!.emote === "💃") (o.rotation.y = t * 9), (o.position.y = Math.abs(Math.sin(t * 9)) * 0.15);
  else o.position.y = Math.abs(Math.sin(t * 10)) * 0.25;
}

/** Escrow as a parcel locker: paid goods wait in a box until the buyer says OK. */
function EscrowLockers() {
  const d = useData();
  const parcel = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (parcel.current) {
      parcel.current.position.y = 3.35 + Math.sin(t * 2) * 0.12;
      parcel.current.rotation.y = Math.sin(t * 0.8) * 0.4;
    }
  });
  const doors: V3[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) doors.push([-0.85 + c * 0.85, 0.75 + r * 0.8, 1.06]);
  return (
    <group>
      <P color="#e8d6b0" position={[0, 0.1, 0]}><cylinderGeometry args={[2.3, 2.4, 0.2, 24]} /></P>
      <P color="#7cc6f2" position={[0, 1.15, 0]}><boxGeometry args={[3, 2, 2]} /></P>
      <P color="#ff8fa3" position={[0, 2.55, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[2.35, 0.9, 4]} /></P>
      {doors.map((p, i) => (
        <group key={i} position={p}>
          <P color={i === 1 || i === 3 ? "#ffe08a" : CREAM} line={0.02}><boxGeometry args={[0.7, 0.64, 0.08]} /></P>
          <P color="#ff8fa3" position={[0.22, 0, 0.06]} line={0}><sphereGeometry args={[0.05, 8, 8]} /></P>
        </group>
      ))}
      <group ref={parcel} position={[0, 3.35, 0]}>
        <P color="#d9a066"><boxGeometry args={[0.7, 0.55, 0.7]} /></P>
        <P color="#ef476f" line={0}><boxGeometry args={[0.72, 0.57, 0.14]} /></P>
        <P color="#ef476f" line={0}><boxGeometry args={[0.14, 0.57, 0.72]} /></P>
        <P color="#ef476f" position={[-0.12, 0.33, 0]} rotation={[0, 0, 0.6]} line={0.015}><torusGeometry args={[0.1, 0.04, 8, 16]} /></P>
        <P color="#ef476f" position={[0.12, 0.33, 0]} rotation={[0, 0, -0.6]} line={0.015}><torusGeometry args={[0.1, 0.04, 8, 16]} /></P>
      </group>
      <Pulses />
      <Html position={[0, 4.4, 0]} center distanceFactor={15} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign core">
          <b>📦 Escrow lockers</b>
          <span>{d.soon ? "coming soon" : <>{d.purchases} order{d.purchases === 1 ? "" : "s"} · paid out when the buyer is happy</>}</span>
        </div>
      </Html>
    </group>
  );
}

/** A coloured ring from the lockers for every confirmed transaction. */
function Pulses() {
  const n = usePulses();
  const [rings, setRings] = useState<number[]>([]);
  useEffect(() => {
    if (!n) return;
    setRings((r) => [...r.slice(-3), n]);
    const id = setTimeout(() => setRings((r) => r.filter((x) => x !== n)), 1600);
    return () => clearTimeout(id);
  }, [n]);
  return <>{rings.map((id) => <PulseRing key={id} color={GOODS[id % GOODS.length]} />)}</>;
}
function PulseRing({ color }: { color: string }) {
  const m = useRef<Mesh>(null);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!m.current) return;
    t0.current ??= clock.elapsedTime;
    const t = (clock.elapsedTime - t0.current) / 1.5;
    m.current.scale.setScalar(1 + t * 10);
    (m.current.material as MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - t));
  });
  return (
    <mesh ref={m} position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[2.3, 2.6, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

function RequestBoard({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.board;
  return (
    <group position={[x, 0, z]} {...clickable(() => open({ kind: "tab", tab: "requests" }))}>
      {[-2.1, 2.1].map((px) => (
        <P key={px} color={WOOD_DARK} position={[px, 1.9, 0]}><boxGeometry args={[0.24, 3.8, 0.24]} /></P>
      ))}
      <P color={WOOD} position={[0, 2.55, -0.04]}><boxGeometry args={[4.4, 2.9, 0.14]} /></P>
      <P color="#e6b980" position={[0, 2.55, 0.04]} line={0}><boxGeometry args={[4.0, 2.5, 0.04]} /></P>
      <P color="#ff8fa3" position={[0, 4.2, 0]}><boxGeometry args={[4.8, 0.3, 0.5]} /></P>
      <Html position={[0, 2.55, 0.1]} center transform distanceFactor={4} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-board">
          <h4>📋 Request board</h4>
          {d.requests.slice(0, 4).map((r, i) => (
            <p key={i} style={{ transform: `rotate(${((i * 37) % 5) - 2}deg)` }}>
              <span>{["Anyone", "Humans", "Bots"][r.wants]}</span> {r.title} <b>{r.reward}</b>
            </p>
          ))}
          {!d.requests.length && !d.soon && <p>No open requests. Post the first!</p>}
          {d.soon && <ErrandNotes />}
        </div>
      </Html>
    </group>
  );
}

/** On a network without BazaarRequests the board pins today's errand instead. */
function ErrandNotes() {
  useChat();
  const e = errandFor(errand.day);
  return (
    <>
      <p style={{ transform: "rotate(-1deg)" }}><span style={{ background: "#ef476f" }}>Today</span> {e.text} <b>{errand.done ? "✅" : "📮"}</b></p>
      <p style={{ transform: "rotate(1deg)" }}><span style={{ background: "#5ccf7a" }}>Stamps</span> collected in this browser <b>{errand.stamps}</b></p>
      <p style={{ transform: "rotate(-2deg)" }}><span>Soon</span> Requests with BOT rewards</p>
    </>
  );
}

/** Bot or Not as a puppet theatre: the hooded trader on stage, the crowd guesses. */
function BotOrNotStage({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.stage;
  const live = d.rounds[0];
  const q = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (q.current) q.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.5;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]} {...clickable(() => open({ kind: "tab", tab: "botornot" }))}>
      <P color="#ffd166" position={[0, 0.45, 0]}><boxGeometry args={[4, 0.9, 2.4]} /></P>
      <P color="#b5651d" position={[0, 0.92, 0]} line={0.02}><boxGeometry args={[3.8, 0.06, 2.2]} /></P>
      {[-1.85, 1.85].map((px) => (
        <P key={px} color="#ef476f" position={[px, 2.0, -0.6]}><boxGeometry args={[0.3, 2.2, 1.1]} /></P>
      ))}
      {[-1.4, 1.4].map((px) => (
        <P key={`c${px}`} color="#d63a5c" position={[px, 2.0, -0.2]} scale={[1, 1, 0.4]}><cylinderGeometry args={[0.35, 0.5, 2.2, 12]} /></P>
      ))}
      <P color="#ef476f" position={[0, 3.25, -0.6]}><boxGeometry args={[4.2, 0.6, 1.2]} /></P>
      <P color="#6c4f9c" position={[0, 2.0, -1.1]} line={0.02}><boxGeometry args={[3.5, 2.2, 0.1]} /></P>
      <group position={[0, 0.95, -0.2]}>{live || d.soon ? <Hooded /> : null}</group>
      <group ref={q} position={[0, 4.3, -0.6]}>
        <P color="#ffd166" position={[0, 0.2, 0]} rotation={[0, 0, -0.6]}><torusGeometry args={[0.28, 0.1, 10, 20, Math.PI * 1.4]} /></P>
        <P color="#ffd166" position={[0, -0.45, 0]}><sphereGeometry args={[0.1, 10, 10]} /></P>
      </group>
      <Html position={[0, 5.3, -0.6]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign stage">
          <b>🎭 Bot or Not</b>
          <span>
            {live ? `${short(live.trader)} · 🤖 ${live.bot} · 🧑 ${live.human}` : d.soon ? "practice round · bot or human?" : "Stage is free. Enter a round!"}
            {d.rounds.length > 1 ? ` · +${d.rounds.length - 1} more` : ""}
          </span>
        </div>
      </Html>
    </group>
  );
}

type Design = WorldData["designs"][number];
/** An 8×8 on-chain design as 64 little tiles (a blank canvas when there is none). */
function PixelArt({ design, cell, position }: { design: Design | null; cell: number; position: V3 }) {
  const mesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    const c = new Color();
    const cells = design ? decodePixels(design.pixels) : new Array<number>(64).fill(0);
    cells.forEach((v, k) => {
      o.position.set(((k % 8) - 3.5) * cell, (3.5 - Math.floor(k / 8)) * cell, 0);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      const hex = design ? PRESET16[(design.palette >> (12 - 4 * v)) & 15] : "#00000000";
      c.set(hex === "#00000000" ? "#fffdf6" : hex.slice(0, 7));
      m.setColorAt(k, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [design, cell]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 64]} position={position}>
      <boxGeometry args={[cell - 0.01, cell - 0.01, 0.04]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** A painter's easel showing the on-chain designs one after another. */
function PixelEasel({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.wall;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (d.designs.length < 2) return;
    const id = setInterval(() => setI((v) => v + 1), 3500);
    return () => clearInterval(id);
  }, [d.designs.length]);
  const design = d.designs.length ? d.designs[i % d.designs.length] : null;
  return (
    <group position={[x, 0, z]} rotation={[0, Math.PI / 2, 0]} {...clickable(() => open({ kind: "tab", tab: "workshop" }))}>
      {[-0.9, 0.9].map((px) => (
        <P key={px} color={WOOD_DARK} position={[px, 1.7, -0.1]} rotation={[0, 0, px > 0 ? -0.12 : 0.12]}><cylinderGeometry args={[0.07, 0.08, 3.6, 8]} /></P>
      ))}
      <P color={WOOD_DARK} position={[0, 1.5, -0.7]} rotation={[0.35, 0, 0]}><cylinderGeometry args={[0.06, 0.07, 3.2, 8]} /></P>
      <P color={WOOD} position={[0, 1.0, 0.1]}><boxGeometry args={[2.4, 0.14, 0.3]} /></P>
      <P color={CREAM} position={[0, 2.45, 0]}><boxGeometry args={[3.0, 3.0, 0.12]} /></P>
      <PixelArt design={design} cell={0.34} position={[0, 2.45, 0.08]} />
      <group position={[1.5, 0.2, 0.9]}>
        <P color="#f2f2f2"><cylinderGeometry args={[0.4, 0.4, 0.06, 18]} /></P>
        {GOODS.slice(0, 4).map((c, k) => (
          <P key={k} color={c} position={[Math.cos(k * 1.5) * 0.22, 0.05, Math.sin(k * 1.5) * 0.22]} line={0}><sphereGeometry args={[0.07, 8, 8]} /></P>
        ))}
      </group>
      <Html position={[0, 4.5, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign easel">
          <b>🎨 Pixel workshop</b>
          <span>{design ? `“${design.name}” · ${d.stats.total} on chain · click to draw` : "Draw the first design"}</span>
        </div>
      </Html>
    </group>
  );
}

function ProjectGate({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.gate;
  return (
    <group position={[x, 0, z]} {...clickable(() => open({ kind: "tab", tab: "projects" }))}>
      {[-4, 4].map((px) => (
        <P key={px} color={WOOD_DARK} position={[px, 3.4, 0]}><cylinderGeometry args={[0.32, 0.38, 6.8, 12]} /></P>
      ))}
      <P color="#ffd166" position={[0, 6.6, 0]}><boxGeometry args={[9.4, 1.3, 0.5]} /></P>
      <P color="#ef476f" position={[0, 7.45, 0]}><boxGeometry args={[10, 0.35, 0.8]} /></P>
      <Html position={[0, 6.6, 0.3]} center distanceFactor={26} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-gate">
          <b>BOT BAZAAR</b>
          <span>{d.projects.length ? `districts: ${d.projects.slice(0, 3).join(" · ")}` : d.stats.total ? `🎨 ${d.stats.total} designs on BOT Chain · ${d.stats.artists} artists` : "no fee · no token · escrow on chain"}</span>
        </div>
      </Html>
    </group>
  );
}

/** Bunting: strings of little flags around the market. Pieces close to the camera step aside so
 *  the follow camera never looks through a giant flag or pole. */
const FLAG_N = 96;
const FLAGS = Array.from({ length: FLAG_N }, (_, i) => {
  // poles sit between the paths (15° off each axis), the flags sag between poles
  const a = ((i + 4) / FLAG_N) * Math.PI * 2;
  const seg = (i % 8) / 8;
  return { a, x: Math.sin(a) * 13, y: 6.2 - Math.sin(seg * Math.PI) * 0.7, z: -Math.cos(a) * 13 };
});
const POLES = Array.from({ length: 12 }, (_, i) => {
  const a = ((i + 0.5) / 12) * Math.PI * 2;
  return { x: Math.sin(a) * 13, z: -Math.cos(a) * 13 };
});
const NEAR_CAMERA = 7;
function Bunting() {
  const mesh = useRef<InstancedMesh>(null);
  const poles = useRef<(Group | null)[]>([]);
  const camera = useThree((s) => s.camera);
  const o = useMemo(() => new Object3D(), []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    FLAGS.forEach((_, i) => m.setColorAt(i, c.set(GOODS[i % GOODS.length])));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const cx = camera.position.x;
    const cz = camera.position.z;
    FLAGS.forEach((f, i) => {
      const hide = Math.hypot(f.x - cx, f.z - cz) < NEAR_CAMERA;
      o.position.set(f.x, f.y, f.z);
      o.rotation.set(Math.PI, -f.a, 0);
      o.scale.set(hide ? 0 : 1, hide ? 0 : 1, hide ? 0 : 0.15);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    POLES.forEach((p, i) => {
      const g = poles.current[i];
      if (g) g.visible = Math.hypot(p.x - cx, p.z - cz) >= NEAR_CAMERA;
    });
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, FLAG_N]}>
        <coneGeometry args={[0.2, 0.42, 3]} />
        <meshToonMaterial gradientMap={GRAD} />
      </instancedMesh>
      {POLES.map((p, i) => (
        <group key={i} ref={(g) => { poles.current[i] = g; }} position={[p.x, 3.2, p.z]}>
          <P color={WOOD_DARK}><cylinderGeometry args={[0.06, 0.08, 6.4, 8]} /></P>
        </group>
      ))}
    </>
  );
}

function Tree({ x, z, s, kind }: { x: number; z: number; s: number; kind: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <P color={WOOD_DARK} position={[0, 0.7, 0]}><cylinderGeometry args={[0.18, 0.24, 1.4, 8]} /></P>
      {kind === 1 ? (
        <>
          <P color="#4fb36b" position={[0, 1.9, 0]}><coneGeometry args={[1.1, 1.7, 12]} /></P>
          <P color="#5cc77a" position={[0, 2.8, 0]}><coneGeometry args={[0.8, 1.3, 12]} /></P>
        </>
      ) : (
        <>
          <P color={kind ? "#7fd36e" : "#ffb3c7"} position={[0, 2.1, 0]}><sphereGeometry args={[1.05, 16, 16]} /></P>
          <P color={kind ? "#8fdd7d" : "#ffc4d3"} position={[0.55, 1.75, 0.35]}><sphereGeometry args={[0.6, 14, 14]} /></P>
        </>
      )}
    </group>
  );
}

function Cloud({ x, y, z, s }: { x: number; y: number; z: number; s: number }) {
  const g = useRef<Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    g.current.position.x += dt * 0.4;
    if (g.current.position.x > 60) g.current.position.x = -60;
  });
  return (
    <group ref={g} position={[x, y, z]} scale={s}>
      {([[0, 0, 0, 1.6], [1.6, -0.2, 0.2, 1.2], [-1.5, -0.3, 0, 1.1], [0.6, 0.7, -0.2, 1.1]] as const).map(([cx, cy, cz, r], i) => (
        <P key={i} color="#ffffff" position={[cx, cy, cz]} line={0.05}><sphereGeometry args={[r, 16, 16]} /></P>
      ))}
    </group>
  );
}

function Ground() {
  const paths = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          player.target = { x: e.point.x, z: e.point.z };
        }}>
        <circleGeometry args={[WORLD_R + 40, 64]} />
        <meshToonMaterial color="#9ed97a" gradientMap={GRAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[17.5, 64]} />
        <meshToonMaterial color="#f6e3b8" gradientMap={GRAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[17.3, 17.7, 96]} />
        <meshBasicMaterial color="#d9b77c" />
      </mesh>
      {paths.map((a, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, a]} position={[Math.sin(a) * 21, 0.02, -Math.cos(a) * 21]}>
          <planeGeometry args={[3.2, 10]} />
          <meshToonMaterial color="#f6e3b8" gradientMap={GRAD} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- the player ----------
const residentSpots = (): Spot[] =>
  RESIDENTS.flatMap((r) => {
    const at = residentAt.get(r.id);
    return at ? [{ x: at.x, z: at.z, r: 0.5, name: `Talk to ${r.name}`, target: null, act: () => talk(r) }] : [];
  });

function Player({ spots, setNear, open }: { spots: Spot[]; setNear: (s: Spot | null) => void; open: (t: Target) => void }) {
  const d = useData();
  const g = useRef<Group>(null);
  const keys = useRef(new Set<string>());
  const camera = useThree((s) => s.camera);
  const look = useRef(new Vector3(0, 1, 0));
  const nearRef = useRef<Spot | null>(null);
  const body = useRef<Group>(null);
  const bubble = useBubble("me");
  const narrow = useThree((s) => s.size.width < 640);

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    };
    const down = (e: KeyboardEvent) => {
      if (typing()) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        keys.current.add(e.code);
        player.target = null;
        e.preventDefault();
      }
      const s = nearRef.current;
      if ((e.code === "KeyF" || e.code === "Enter") && s) s.act ? s.act() : s.target && open(s.target);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", blur);
    };
  }, [open]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1);
    const k = keys.current;
    let dx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let dz = (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0);
    if (player.target && !dx && !dz) {
      const tx = player.target.x - player.x;
      const tz = player.target.z - player.z;
      const dist = Math.hypot(tx, tz);
      if (dist < 0.3) player.target = null;
      else (dx = tx / dist), (dz = tz / dist);
    }
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      const sp = 7 * dt;
      let nx = player.x + (dx / len) * sp;
      let nz = player.z + (dz / len) * sp;
      // push out of stalls, landmarks and trees
      for (const s of spots) {
        if (!s.r) continue;
        const ox = nx - s.x;
        const oz = nz - s.z;
        const dd = Math.hypot(ox, oz);
        const min = s.r + 0.4;
        if (dd < min && dd > 0.0001) (nx = s.x + (ox / dd) * min), (nz = s.z + (oz / dd) * min);
      }
      const r = Math.hypot(nx, nz);
      if (r > WORLD_R) (nx = (nx / r) * WORLD_R), (nz = (nz / r) * WORLD_R);
      if (Math.hypot(nx - player.x, nz - player.z) < sp * 0.05) player.target = null; // stuck against something
      player.x = nx;
      player.z = nz;
      if (g.current) g.current.rotation.y = Math.atan2(dx, dz);
    }
    if (g.current) g.current.position.set(player.x, 0, player.z);
    const off = narrow ? new Vector3(0, 10.5, 12) : new Vector3(0, 7, 9.5);
    camera.position.lerp(new Vector3(player.x + off.x, off.y, player.z + off.z), 1 - Math.pow(0.002, dt));
    look.current.lerp(new Vector3(player.x, 1, player.z - 2), 1 - Math.pow(0.002, dt));
    camera.lookAt(look.current);

    let best: Spot | null = null;
    let bestD = Infinity;
    for (const s of [...spots, ...residentSpots()]) {
      if (!s.target && !s.act) continue;
      const dd = Math.hypot(s.x - player.x, s.z - player.z) - s.r;
      if (dd < 2.2 && dd < bestD) (best = s), (bestD = dd);
    }
    if (best && best.name.endsWith("(gallery)")) finishErrand("gallery");
    if (body.current) emoteMotion(body.current, bubbles.get("me"), performance.now() / 1000);
    if (best?.name !== nearRef.current?.name) {
      nearRef.current = best;
      setNear(best);
    }
  });

  return (
    <group ref={g}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <circleGeometry args={[0.55, 32]} />
        <meshBasicMaterial color={INK} transparent opacity={0.18} />
      </mesh>
      <group ref={body}>
        <Trader kind={d.myKind} address={d.me ?? "0x0"} you />
      </group>
      <Html position={[0, 2.2, 0]} center distanceFactor={12} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        {bubble ? <div className="w-say me">{bubble.text}</div> : <div className="w-me">You</div>}
      </Html>
    </group>
  );
}

// ---------- the whole scene ----------
function Scene({ open, setNear }: { open: (t: Target) => void; setNear: (s: Spot | null) => void }) {
  const d = useData();
  const placed = d.shops.slice(0, SLOTS.length).map((shop, i) => ({ shop, slot: SLOTS[i] }));
  const free = !d.soon && !d.myShop && d.me && placed.length < SLOTS.length ? SLOTS[placed.length] : null;
  // Slots no shop uses hang the on-chain designs (empty frames invite a drawing). Where shops are not
  // open yet, two shuttered stalls stay as "coming soon".
  const used = placed.length + (free ? 1 : 0);
  const gallery = SLOTS.slice(used, used + (d.soon ? 6 : Math.min(4, d.designs.length))).map((slot, i) => ({ slot, design: d.designs[i] ?? null }));
  const shut = d.soon ? SLOTS.slice(used + gallery.length, used + gallery.length + 2) : [];
  const spots = useMemo<Spot[]>(() => {
    const out: Spot[] = placed.map(({ shop, slot }) => ({ x: slot.x, z: slot.z, r: 1.7, name: shop.title, target: { kind: "shop", owner: shop.owner } }));
    if (free) out.push({ x: free.x, z: free.z, r: 1.7, name: "Free stall: open your shop", target: { kind: "tab", tab: "account" } });
    for (const { slot, design } of gallery)
      out.push({ x: slot.x, z: slot.z, r: 1.7, name: design ? `“${design.name}” (gallery)` : "Empty frame: draw one", target: { kind: "tab", tab: "workshop" } });
    for (const slot of shut) out.push({ x: slot.x, z: slot.z, r: 1.7, name: "Shop (coming soon)", target: { kind: "tab", tab: "account" } });
    out.push(
      { ...LANDMARK.core, name: "Escrow lockers: your orders", target: { kind: "tab", tab: "account" } },
      { ...LANDMARK.board, name: "Request board", target: { kind: "tab", tab: "requests" } },
      { ...LANDMARK.stage, name: "Bot or Not theatre", target: { kind: "tab", tab: "botornot" } },
      { ...LANDMARK.wall, name: "Pixel workshop", target: { kind: "tab", tab: "workshop" } },
      { ...LANDMARK.gate, r: 0.6, name: "Projects gate", target: { kind: "tab", tab: "projects" } },
    );
    for (const t of TREES) out.push({ x: t.x, z: t.z, r: 0.45 * t.s, name: "", target: null });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  return (
    <>
      <color attach="background" args={["#bfe9ff"]} />
      <fog attach="fog" args={["#bfe9ff", 45, 95]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#ffffff", "#9ed97a", 0.7]} />
      <directionalLight position={[12, 20, 10]} intensity={1.6} color="#fff2d6" />
      <Ground />
      <Bunting />
      {TREES.map((t, i) => <Tree key={i} {...t} />)}
      <Cloud x={-20} y={16} z={-40} s={1.6} />
      <Cloud x={14} y={19} z={-48} s={2} />
      <Cloud x={34} y={14} z={-30} s={1.3} />
      <group {...clickable(() => open({ kind: "tab", tab: "account" }))}>
        <EscrowLockers />
      </group>
      <RequestBoard open={open} />
      <BotOrNotStage open={open} />
      <PixelEasel open={open} />
      <ProjectGate open={open} />
      {placed.map(({ shop, slot }) => <Stall key={shop.owner} shop={shop} slot={slot} open={open} />)}
      {free && <EmptyStall slot={free} open={open} />}
      {gallery.map(({ slot, design }, i) => <GalleryStand key={`g${i}`} slot={slot} design={design} n={i} open={open} />)}
      {shut.map((slot, i) => <SoonStall key={i} slot={slot} open={open} />)}
      {RESIDENTS.map((r) => <ResidentFigure key={r.id} r={r} open={() => talk(r)} />)}
      <Player spots={spots} setNear={setNear} open={open} />
    </>
  );
}

function Root({ open }: { open: (t: Target) => void }) {
  const [near, setNear] = useState<Spot | null>(null);
  const d = useData();
  useEffect(() => {
    const id = setInterval(() => document.hidden || chatter(), 5200);
    return () => clearInterval(id);
  }, []);
  const touch = matchMedia("(pointer: coarse)").matches;
  return (
    <>
      <Canvas camera={{ position: [0, 7, 18.5], fov: 50 }} dpr={[1, 1.75]}>
        <Scene open={open} setNear={setNear} />
      </Canvas>
      <ErrandChip />
      <Billboard />
      <div className="w-emotes" role="toolbar" aria-label="Emotes">
        {EMOTES.map((e) => (
          <button key={e.icon} type="button" title={e.name} aria-label={e.name} onClick={() => doEmote(e.icon)}>{e.icon}</button>
        ))}
      </div>
      <div className="w-hud">
        {near?.act || near?.target ? (
          <button className="w-open" onClick={() => (near.act ? near.act() : open(near.target!))}>
            {near.act ? near.name : `Open ${near.name}`} <kbd>F</kbd>
          </button>
        ) : (
          <span>
            {touch ? "Tap the ground to walk" : "WASD / arrows or click the ground to walk"}
            {d.soon ? " · tap a resident to chat" : touch ? ", tap a stall to trade" : " · click a stall to trade"}
          </span>
        )}
      </div>
    </>
  );
}

/** The market's LED billboard: real on-chain numbers only, and news when a design arrives. */
function Billboard() {
  const d = useData();
  useChat();
  const [, tick] = useState(0);
  const live = news && news.until > performance.now() ? news : null;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => tick((v) => v + 1), live.until - performance.now() + 30);
    return () => clearTimeout(t);
  }, [live]);
  const st = d.stats;
  const newest = d.designs[0];
  if (!st.total && !live) return null;
  const text = live
    ? live.text
    : [
        `🎨 ${st.total} design${st.total === 1 ? "" : "s"} on BOT Chain`,
        `⏱️ ${st.day} in the last 24 h`,
        `🧑‍🎨 ${st.artists} artist${st.artists === "1" ? "" : "s"}`,
        newest ? `🖼️ newest “${newest.name}” by ${short(newest.creator)}, ${ago(st.now - newest.createdAt)}` : "",
      ].filter(Boolean).join("   ·   ");
  return (
    <div className={`w-ticker${live ? " news" : ""}`} aria-live="polite">
      <span key={text}>{text}</span>
    </div>
  );
}

/** Today's errand, under the Pixel Workshop button. */
function ErrandChip() {
  useChat();
  const e = errandFor(errand.day);
  return (
    <div className={`w-errand${errand.done ? " done" : ""}`} title="One small errand a day. Stamps stay in this browser.">
      <span>{errand.done ? "✅" : "📮"} Today: {e.text}</span>
      <b>🏅 {errand.stamps}</b>
    </div>
  );
}

export function mountWorld(el: HTMLElement, open: (t: Target) => void): WorldApi {
  const root = createRoot(el);
  root.render(<Root open={open} />);
  return {
    update(d) {
      data = d;
      emit();
    },
    pulse() {
      pulses++;
      emit();
    },
    errand(id) {
      finishErrand(id);
    },
    announce(list) {
      announce(list);
    },
    destroy() {
      root.unmount();
    },
  };
}
