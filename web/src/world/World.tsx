// The bazaar as a place: a night market on BOT Chain where every open shop is a container stall
// with its owner behind the counter (a robot, a person, a person with a drone, or a hooded
// undeclared trader), escrow glows in the middle, and the request board, Bot or Not stage, pixel
// wall and project gate stand at the four streets. Walk with WASD / arrows or tap the ground; click
// anything to trade. Everything shown here is read from the chain by main.ts and handed in as data.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Stars } from "@react-three/drei";
import { Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { PRESET16, decodePixels } from "../pixel";

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
  designs: { name: string; pixels: string; palette: number }[];
  projects: string[];
  purchases: number;
}
export interface WorldApi {
  update(d: WorldData): void;
  pulse(): void;
  destroy(): void;
}

const EMPTY: WorldData = {
  me: null, myKind: 0, myShop: false, shops: [], requests: [], rounds: [], designs: [], projects: [], purchases: 0,
};
/** Category colours: goods, services, developer assets, agent services */
const CAT = ["#ff9f43", "#4dabff", "#4ee39b", "#c084fc"];
const CAT_NAME = ["Goods", "Service", "Dev asset", "Agent service"];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hue = (a: string) => {
  let h = 0;
  for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 58%)`;
};

// ---------- layout: one table for drawing, clicking, colliding and "press F" ----------
const LANDMARK = {
  core: { x: 0, z: 0, r: 2.4 },
  board: { x: 0, z: -18, r: 2.4 },
  stage: { x: 18, z: 0, r: 3.4 },
  wall: { x: -18, z: 0, r: 2.6 },
  gate: { x: 0, z: -27, r: 0 },
};
const WORLD_R = 28;
/** Stall slots on two rings, leaving the four streets to the landmarks clear. */
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
  target: Target;
}

// ---------- figures ----------
function Robot({ color }: { color: string }) {
  const head = useRef<Group>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    if (head.current) head.current.rotation.y = Math.sin(clock.elapsedTime * 0.8 + seed) * 0.4;
  });
  return (
    <group>
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]}>
          <boxGeometry args={[0.16, 0.44, 0.18]} />
          <meshStandardMaterial color="#3a3f52" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[0.62, 0.66, 0.42]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.82, 0.215]}>
        <boxGeometry args={[0.3, 0.14, 0.02]} />
        <meshStandardMaterial color="#111" emissive={color} emissiveIntensity={0.9} />
      </mesh>
      <group ref={head} position={[0, 1.36, 0]}>
        <mesh>
          <boxGeometry args={[0.52, 0.42, 0.44]} />
          <meshStandardMaterial color="#1c2030" metalness={0.4} roughness={0.3} />
        </mesh>
        {[-0.11, 0.11].map((x) => (
          <mesh key={x} position={[x, 0.03, 0.225]}>
            <boxGeometry args={[0.1, 0.07, 0.01]} />
            <meshBasicMaterial color="#7ff5ff" />
          </mesh>
        ))}
        <mesh position={[0, 0.34, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.26, 6]} />
          <meshStandardMaterial color="#888" />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <sphereGeometry args={[0.06, 10, 10]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  );
}

function Human({ color }: { color: string }) {
  const body = useRef<Group>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    if (body.current) body.current.position.y = Math.abs(Math.sin(clock.elapsedTime * 1.6 + seed)) * 0.04;
  });
  return (
    <group ref={body}>
      <mesh position={[0, 0.72, 0]}>
        <capsuleGeometry args={[0.26, 0.6, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.4, 0]}>
        <sphereGeometry args={[0.23, 16, 16]} />
        <meshStandardMaterial color="#e9c39f" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.47, -0.02]} scale={[1.05, 0.75, 1.05]}>
        <sphereGeometry args={[0.23, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#2b2118" roughness={1} />
      </mesh>
    </group>
  );
}

function Drone({ color }: { color: string }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g.current) g.current.position.set(0.55 + Math.sin(t) * 0.1, 1.75 + Math.sin(t * 2.3) * 0.08, Math.cos(t) * 0.1);
  });
  return (
    <group ref={g}>
      <mesh>
        <sphereGeometry args={[0.13, 12, 12]} />
        <meshStandardMaterial color="#1c2030" metalness={0.6} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.025, 6, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function Hooded({ cloak = "#262938" }: { cloak?: string }) {
  return (
    <group>
      <mesh position={[0, 0.7, 0]}>
        <coneGeometry args={[0.42, 1.4, 14]} />
        <meshStandardMaterial color={cloak} roughness={1} />
      </mesh>
      <mesh position={[0, 1.38, 0]}>
        <sphereGeometry args={[0.27, 14, 14]} />
        <meshStandardMaterial color={cloak} roughness={1} />
      </mesh>
      <mesh position={[0, 1.36, 0.2]}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial color="#05060a" />
      </mesh>
      {[-0.06, 0.06].map((x) => (
        <mesh key={x} position={[x, 1.38, 0.33]}>
          <sphereGeometry args={[0.025, 6, 6]} />
          <meshBasicMaterial color="#ffd66b" />
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
  return <Hooded cloak={you ? "#2f7d99" : undefined} />;
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

function Stall({ shop, slot, open }: { shop: WorldShop; slot: (typeof SLOTS)[number]; open: (t: Target) => void }) {
  const neon = CAT[shop.category] ?? CAT[0];
  return (
    <group position={[slot.x, 0, slot.z]} rotation={[0, slot.rot, 0]} {...clickable(() => open({ kind: "shop", owner: shop.owner }))}>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[3, 0.1, 2.2]} />
        <meshStandardMaterial color="#232736" />
      </mesh>
      <mesh position={[0, 1.2, -1]}>
        <boxGeometry args={[3, 2.4, 0.1]} />
        <meshStandardMaterial color="#2c3245" metalness={0.3} roughness={0.6} />
      </mesh>
      {[-1.45, 1.45].map((x) => (
        <mesh key={x} position={[x, 1.2, -0.05]}>
          <boxGeometry args={[0.1, 2.4, 2]} />
          <meshStandardMaterial color="#2c3245" metalness={0.3} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.45, -0.05]}>
        <boxGeometry args={[3.1, 0.14, 2.2]} />
        <meshStandardMaterial color="#1b1f2c" />
      </mesh>
      <mesh position={[0, 2.36, 1.06]}>
        <boxGeometry args={[3.1, 0.06, 0.06]} />
        <meshBasicMaterial color={neon} />
      </mesh>
      <mesh position={[0, 0.5, 0.75]}>
        <boxGeometry args={[2.7, 0.9, 0.45]} />
        <meshStandardMaterial color="#3a4157" />
      </mesh>
      <mesh position={[0, 0.94, 0.98]}>
        <boxGeometry args={[2.7, 0.04, 0.02]} />
        <meshBasicMaterial color={neon} />
      </mesh>
      {shop.items.slice(0, 3).map((it, i) => (
        <mesh key={i} position={[-0.8 + i * 0.8, 1.08, 0.75]} rotation={[0, i, 0]}>
          <boxGeometry args={[0.26, 0.26, 0.26]} />
          <meshStandardMaterial color={neon} emissive={neon} emissiveIntensity={0.5} />
        </mesh>
      ))}
      <group position={[0, 0.05, -0.35]}>
        <Trader kind={shop.kind} address={shop.owner} />
      </group>
      <Html position={[0, 3.05, 0.6]} center distanceFactor={13} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign" style={{ borderColor: neon }}>
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
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[3, 0.1, 2.2]} />
        <meshStandardMaterial color="#232736" />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[3, 2.4, 2.2]} />
        <meshStandardMaterial color="#7ff5ff" transparent opacity={0.08} />
      </mesh>
      <mesh position={[0, 0.12, 1.06]}>
        <boxGeometry args={[3, 0.04, 0.04]} />
        <meshBasicMaterial color="#7ff5ff" />
      </mesh>
      <Html position={[0, 2.2, 0.6]} center distanceFactor={13} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign free">
          <b>Free stall</b>
          <span>open your shop here</span>
        </div>
      </Html>
    </group>
  );
}

function EscrowCore() {
  const d = useData();
  const gem = useRef<Mesh>(null);
  const ring = useRef<Group>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (gem.current) {
      gem.current.rotation.y += dt * 0.6;
      gem.current.position.y = 2.6 + Math.sin(t * 1.3) * 0.15;
    }
    if (ring.current) ring.current.rotation.y -= dt * 0.9;
  });
  return (
    <group>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[2.2, 2.5, 0.8, 8]} />
        <meshStandardMaterial color="#20253a" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.81, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 1.75, 8]} />
        <meshBasicMaterial color="#ffd66b" />
      </mesh>
      <mesh ref={gem} position={[0, 2.6, 0]}>
        <octahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color="#ffc94a" emissive="#ffb000" emissiveIntensity={1.1} metalness={0.6} roughness={0.2} />
      </mesh>
      <group ref={ring} position={[0, 2.6, 0]}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 1.7, Math.sin(a * 2) * 0.25, Math.sin(a) * 1.7]} rotation={[Math.PI / 2, 0, a]}>
              <cylinderGeometry args={[0.17, 0.17, 0.05, 16]} />
              <meshStandardMaterial color="#ffd66b" emissive="#ffb000" emissiveIntensity={0.6} metalness={0.8} roughness={0.2} />
            </mesh>
          );
        })}
      </group>
      <pointLight position={[0, 3, 0]} color="#ffb84a" intensity={30} distance={16} />
      <Pulses />
      <Html position={[0, 4.4, 0]} center distanceFactor={15} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign core">
          <b>Escrow core</b>
          <span>{d.purchases} purchase{d.purchases === 1 ? "" : "s"} held until the buyer is happy</span>
        </div>
      </Html>
    </group>
  );
}

/** A ring of light from the core for every confirmed transaction. */
function Pulses() {
  const n = usePulses();
  const [rings, setRings] = useState<number[]>([]);
  useEffect(() => {
    if (!n) return;
    setRings((r) => [...r.slice(-3), n]);
    const id = setTimeout(() => setRings((r) => r.filter((x) => x !== n)), 1600);
    return () => clearTimeout(id);
  }, [n]);
  return <>{rings.map((id) => <PulseRing key={id} />)}</>;
}
function PulseRing() {
  const m = useRef<Mesh>(null);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!m.current) return;
    t0.current ??= clock.elapsedTime;
    const t = (clock.elapsedTime - t0.current) / 1.5;
    m.current.scale.setScalar(1 + t * 14);
    (m.current.material as MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - t));
  });
  return (
    <mesh ref={m} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.4, 1.6, 48]} />
      <meshBasicMaterial color="#ffd66b" transparent opacity={0.8} />
    </mesh>
  );
}

function RequestBoard({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.board;
  return (
    <group position={[x, 0, z]} {...clickable(() => open({ kind: "tab", tab: "requests" }))}>
      {[-2.2, 2.2].map((px) => (
        <mesh key={px} position={[px, 2, 0]}>
          <boxGeometry args={[0.2, 4, 0.2]} />
          <meshStandardMaterial color="#2c3245" metalness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 2.6, 0]}>
        <boxGeometry args={[4.4, 2.8, 0.08]} />
        <meshStandardMaterial color="#0d2a3a" emissive="#0a3550" emissiveIntensity={0.8} transparent opacity={0.85} />
      </mesh>
      <Html position={[0, 2.6, 0.1]} center transform distanceFactor={4} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-board">
          <h4>📋 Request board</h4>
          {d.requests.slice(0, 4).map((r, i) => (
            <p key={i}>
              <span>{["Anyone", "Humans", "Bots"][r.wants]}</span> {r.title} <b>{r.reward}</b>
            </p>
          ))}
          {!d.requests.length && <p>No open requests. Post the first.</p>}
        </div>
      </Html>
    </group>
  );
}

function BotOrNotStage({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.stage;
  const live = d.rounds[0];
  const spin = useRef<Group>(null);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.5;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]} {...clickable(() => open({ kind: "tab", tab: "botornot" }))}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[3, 3.2, 0.6, 32]} />
        <meshStandardMaterial color="#3a1f45" />
      </mesh>
      <mesh position={[0, 0.61, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.7, 2.85, 48]} />
        <meshBasicMaterial color="#ff5fd2" />
      </mesh>
      <mesh position={[0, 3.6, 0]}>
        <coneGeometry args={[1.6, 6, 24, 1, true]} />
        <meshBasicMaterial color="#fff2c4" transparent opacity={0.08} depthWrite={false} />
      </mesh>
      <group ref={spin} position={[0, 0.6, 0]}>
        {live ? <Hooded /> : null}
      </group>
      <Html position={[0, 3.2, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign stage">
          <b>🎭 Bot or Not</b>
          <span>
            {live ? `${short(live.trader)} · 🤖 ${live.bot} · 🧑 ${live.human}` : "Stage is free. Enter a round."}
            {d.rounds.length > 1 ? ` · +${d.rounds.length - 1} more` : ""}
          </span>
        </div>
      </Html>
    </group>
  );
}

function PixelWall({ open }: { open: (t: Target) => void }) {
  const d = useData();
  const { x, z } = LANDMARK.wall;
  const mesh = useRef<InstancedMesh>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (d.designs.length < 2) return;
    const id = setInterval(() => setI((v) => v + 1), 3500);
    return () => clearInterval(id);
  }, [d.designs.length]);
  const design = d.designs.length ? d.designs[i % d.designs.length] : null;
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    const c = new Color();
    const cells = design ? decodePixels(design.pixels) : new Array<number>(64).fill(0);
    cells.forEach((v, k) => {
      o.position.set(((k % 8) - 3.5) * 0.42, (3.5 - Math.floor(k / 8)) * 0.42, 0);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
      const hex = design ? PRESET16[(design.palette >> (12 - 4 * v)) & 15] : "#00000000";
      c.set(hex === "#00000000" ? "#151826" : hex.slice(0, 7));
      m.setColorAt(k, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [design]);
  return (
    <group position={[x, 0, z]} rotation={[0, Math.PI / 2, 0]} {...clickable(() => open({ kind: "tab", tab: "workshop" }))}>
      <mesh position={[0, 2.7, -0.15]}>
        <boxGeometry args={[3.8, 3.8, 0.2]} />
        <meshStandardMaterial color="#1b1f2c" />
      </mesh>
      {[-1.7, 1.7].map((px) => (
        <mesh key={px} position={[px, 0.8, -0.15]}>
          <boxGeometry args={[0.2, 1.6, 0.2]} />
          <meshStandardMaterial color="#2c3245" />
        </mesh>
      ))}
      <instancedMesh ref={mesh} args={[undefined, undefined, 64]} position={[0, 2.7, 0]}>
        <boxGeometry args={[0.38, 0.38, 0.12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <Html position={[0, 5.1, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-sign">
          <b>🎨 Pixel workshop</b>
          <span>{design ? `“${design.name}” · ${d.designs.length} on chain` : "Draw the first design"}</span>
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
        <mesh key={px} position={[px, 3.6, 0]}>
          <boxGeometry args={[0.6, 7.2, 0.6]} />
          <meshStandardMaterial color="#2c3245" metalness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 7.4, 0]}>
        <boxGeometry args={[9, 1, 0.7]} />
        <meshStandardMaterial color="#1b1f2c" />
      </mesh>
      <mesh position={[0, 6.86, 0.36]}>
        <boxGeometry args={[8.6, 0.08, 0.02]} />
        <meshBasicMaterial color="#7ff5ff" />
      </mesh>
      <Html position={[0, 7.4, 0.4]} center distanceFactor={26} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-gate">
          <b>BOT BAZAAR</b>
          <span>{d.projects.length ? `districts: ${d.projects.slice(0, 3).join(" · ")}` : "no fee · no token · escrow on chain"}</span>
        </div>
      </Html>
    </group>
  );
}

/** Strings of market lights between the rings. */
function Lights() {
  const mesh = useRef<InstancedMesh>(null);
  const N = 120;
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    const c = new Color();
    const colors = ["#ffd66b", "#ff5fd2", "#7ff5ff", "#4ee39b"];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const seg = (i % 10) / 10;
      o.position.set(Math.sin(a) * 13, 5.4 - Math.sin(seg * Math.PI) * 0.7, -Math.cos(a) * 13);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(colors[i % colors.length]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 13, 2.7, -Math.cos(a) * 13]}>
            <cylinderGeometry args={[0.04, 0.06, 5.4, 6]} />
            <meshStandardMaterial color="#2c3245" />
          </mesh>
        );
      })}
    </>
  );
}

function Ground() {
  const streets = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          player.target = { x: e.point.x, z: e.point.z };
        }}>
        <circleGeometry args={[WORLD_R + 20, 64]} />
        <meshStandardMaterial color="#141725" />
      </mesh>
      <gridHelper args={[56, 56, "#23304f", "#1b2238"]} position={[0, 0.01, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[12.6, 13.4, 96]} />
        <meshBasicMaterial color="#1f6f8b" transparent opacity={0.5} />
      </mesh>
      {streets.map((a, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, a]} position={[Math.sin(a) * 11, 0.02, -Math.cos(a) * 11]}>
          <planeGeometry args={[0.12, 14]} />
          <meshBasicMaterial color="#7ff5ff" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- the player ----------
function Player({ spots, setNear, open }: { spots: Spot[]; setNear: (s: Spot | null) => void; open: (t: Target) => void }) {
  const d = useData();
  const g = useRef<Group>(null);
  const keys = useRef(new Set<string>());
  const camera = useThree((s) => s.camera);
  const look = useRef(new Vector3(0, 1, 0));
  const nearRef = useRef<Spot | null>(null);
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
      if ((e.code === "KeyF" || e.code === "Enter") && nearRef.current) open(nearRef.current.target);
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
      // push out of stalls and landmarks
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
    for (const s of spots) {
      const dd = Math.hypot(s.x - player.x, s.z - player.z) - s.r;
      if (dd < 2.2 && dd < bestD) (best = s), (bestD = dd);
    }
    if (best?.name !== nearRef.current?.name) {
      nearRef.current = best;
      setNear(best);
    }
  });

  return (
    <group ref={g}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial color="#7ff5ff" />
      </mesh>
      <Trader kind={d.myKind} address={d.me ?? "0x0"} you />
      <pointLight position={[0, 2.6, 1]} color="#bfefff" intensity={8} distance={7} />
      <Html position={[0, 2.1, 0]} center distanceFactor={12} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className="w-me">You</div>
      </Html>
    </group>
  );
}

// ---------- the whole scene ----------
function Scene({ open, setNear }: { open: (t: Target) => void; setNear: (s: Spot | null) => void }) {
  const d = useData();
  const placed = d.shops.slice(0, SLOTS.length).map((shop, i) => ({ shop, slot: SLOTS[i] }));
  const free = !d.myShop && d.me && placed.length < SLOTS.length ? SLOTS[placed.length] : null;
  const spots = useMemo<Spot[]>(() => {
    const out: Spot[] = placed.map(({ shop, slot }) => ({ x: slot.x, z: slot.z, r: 1.7, name: shop.title, target: { kind: "shop", owner: shop.owner } }));
    if (free) out.push({ x: free.x, z: free.z, r: 1.7, name: "Free stall: open your shop", target: { kind: "tab", tab: "account" } });
    out.push(
      { ...LANDMARK.core, name: "Escrow core: your purchases", target: { kind: "tab", tab: "account" } },
      { ...LANDMARK.board, name: "Request board", target: { kind: "tab", tab: "requests" } },
      { ...LANDMARK.stage, name: "Bot or Not stage", target: { kind: "tab", tab: "botornot" } },
      { ...LANDMARK.wall, name: "Pixel workshop", target: { kind: "tab", tab: "workshop" } },
      { ...LANDMARK.gate, r: 0.6, name: "Projects gate", target: { kind: "tab", tab: "projects" } },
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  return (
    <>
      <color attach="background" args={["#0b0d18"]} />
      <fog attach="fog" args={["#0b0d18", 28, 70]} />
      <Stars radius={90} depth={40} count={2500} factor={3} fade speed={0.6} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#6d7cff", "#1a1020", 0.8]} />
      <directionalLight position={[10, 18, 8]} intensity={0.9} color="#b9c6ff" />
      <Ground />
      <Lights />
      <group {...clickable(() => open({ kind: "tab", tab: "account" }))}>
        <EscrowCore />
      </group>
      <RequestBoard open={open} />
      <BotOrNotStage open={open} />
      <PixelWall open={open} />
      <ProjectGate open={open} />
      {placed.map(({ shop, slot }) => <Stall key={shop.owner} shop={shop} slot={slot} open={open} />)}
      {free && <EmptyStall slot={free} open={open} />}
      <Player spots={spots} setNear={setNear} open={open} />
    </>
  );
}

function Root({ open }: { open: (t: Target) => void }) {
  const [near, setNear] = useState<Spot | null>(null);
  return (
    <>
      <Canvas camera={{ position: [0, 7, 18.5], fov: 50 }} dpr={[1, 1.75]}>
        <Scene open={open} setNear={setNear} />
      </Canvas>
      <div className="w-hud">
        {near ? (
          <button className="w-open" onClick={() => open(near.target)}>
            Open {near.name} <kbd>F</kbd>
          </button>
        ) : (
          <span>{matchMedia("(pointer: coarse)").matches ? "Tap the ground to walk, tap a stall to trade" : "WASD / arrows or click the ground to walk · click a stall to trade"}</span>
        )}
      </div>
    </>
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
    destroy() {
      root.unmount();
    },
  };
}
