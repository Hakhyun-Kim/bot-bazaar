// The market's people: robots, persons (with a drone if they run an agent) and hooded undeclared
// traders. The bodies are modelled in Blender (art/characters.py -> public/models/characters.glb)
// as pivots the game swings, and painted here from the trader's address, so everyone keeps their
// own look: hair, hat, skin, clothes, bag, robot screen eyes. Faces are drawn here so they blink,
// talk and smile. Residents and visitors use the same figures (no marks: bot or not is the game).
import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Outlines, useGLTF } from "@react-three/drei";
import { Group, Mesh, Object3D, Vector3 } from "three";
import { GRAD, INK, hashOf, hue } from "./toon";

const MODEL = `${import.meta.env.BASE_URL}models/characters.glb`;
useGLTF.preload(MODEL);

const SKIN = ["#ffdcbf", "#f5c6a0", "#e0a97f", "#c08560", "#946042", "#ffe7d1"];
const HAIR = ["#3b2a20", "#5a3a2a", "#8a5a35", "#e7b85f", "#c4553a", "#2d2a3a", "#8c6cd1", "#f08fb0"];
const PANTS = ["#3f5a8a", "#4a4a5a", "#6b4a3a", "#2f6b5a", "#8a6b4a", "#5a4a7a"];
const SHOES = ["#ffffff", "#3a2e3f", "#ef476f", "#ffd166", "#4fa8ff"];
const SHELL = ["#eef1f7", "#eef1f7", "#fff1d6", "#dff3ff", "#ffe3ea"];
const HAIRS = ["hair_short", "hair_bob", "hair_spiky", "hair_bun"];
const HATS = [null, null, null, "hat_cap", "hat_beanie"];

export interface Look {
  paint: string;
  accent: string;
  /** colour of every paint slot named in the model (material names) */
  slots: Record<string, string>;
  hair: string | null;
  hat: string | null;
  bag: boolean;
  apron: boolean;
  /** robot screen eyes: 0 round, 1 tall, 2 wide visor */
  eyes: number;
}

export function lookFor(address: string, opts: { apron?: boolean; cloak?: string } = {}): Look {
  const a = address.toLowerCase();
  const h = hashOf(a);
  const pick = <T,>(list: readonly T[], salt: number) => list[Math.floor(h / salt) % list.length];
  const paint = hue(a);
  const accent = hue(a, 150, 80, 62);
  const hat = pick(HATS, 7);
  return {
    paint,
    accent,
    hair: hat ? null : pick(HAIRS, 13),
    hat,
    bag: !opts.apron && pick([true, false, false], 17),
    apron: !!opts.apron,
    eyes: pick([0, 0, 1, 2], 19),
    slots: {
      paint,
      accent,
      shirt: paint,
      skin: pick(SKIN, 23),
      hair: pick(HAIR, 29),
      hat: hue(a, 200, 70, 58),
      pants: pick(PANTS, 31),
      shoe: pick(SHOES, 37),
      bag: hue(a, 40, 55, 55),
      shell: pick(SHELL, 41),
      cloak: opts.cloak ?? "#8f84b3",
      trim: "#5b4a6e",
      apron: "#fff6e6",
      cream: "#fff6e6",
      metal: "#9aa3b5",
      dark: INK,
      screen: "#2c3550",
      void: "#2a2238",
    },
  };
}

/** What a figure is doing, asked every frame: an emote, talking (a speech bubble) or nothing. */
export type Mood = () => { emote?: string; talking?: boolean } | undefined;

type Rig = Partial<Record<"legL" | "legR" | "armL" | "armR" | "body" | "head" | "antenna" | "rotor", Object3D>> & {
  eyes?: Object3D;
  happy?: Object3D;
  mouth?: Object3D;
};

const RIG_KEYS = ["legL", "legR", "armL", "armR", "body", "head", "antenna", "rotor"] as const;
const SMALL = 0.06; // parts smaller than this get no outline (buttons, bolts): fewer draw calls

function shown(name: string, look: Look) {
  if (HAIRS.includes(name)) return name === look.hair;
  if ((HATS as string[]).includes(name)) return name === look.hat;
  if (name === "robot_apron") return look.apron;
  if (/^person_(bag|bagflap|strap)/.test(name)) return look.bag;
  return true;
}

/** The model's node tree as JSX: toon paint per slot, ink outlines, pivots handed to the rig. */
function Part({ o, look, rig }: { o: Object3D; look: Look; rig: Rig }) {
  if (!shown(o.name, look)) return null;
  const key = RIG_KEYS.find((k) => o.name.endsWith(`_${k}`));
  const kids = o.children.map((c) => <Part key={c.uuid} o={c} look={look} rig={rig} />);
  const ref = key ? (v: Object3D | null) => void (v && (rig[key] = v)) : undefined;
  if ((o as Mesh).isMesh) {
    const m = o as Mesh;
    const slot = (Array.isArray(m.material) ? m.material[0] : m.material).name;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    const small = m.geometry.boundingSphere!.radius * Math.max(m.scale.x, m.scale.y, m.scale.z) < SMALL;
    return (
      <mesh ref={ref} geometry={m.geometry} position={m.position} quaternion={m.quaternion} scale={m.scale}>
        {slot === "screen" || slot === "void" ? (
          <meshBasicMaterial color={look.slots[slot]} />
        ) : (
          <meshToonMaterial color={look.slots[slot] ?? "#ff00ff"} gradientMap={GRAD} />
        )}
        {small ? null : <Outlines thickness={2.2} color={INK} />}
        {kids}
      </mesh>
    );
  }
  return (
    <group ref={ref} position={o.position} quaternion={o.quaternion} scale={o.scale}>
      {kids}
      {key === "head" ? <Face kind={o.name.split("_")[0]} look={look} rig={rig} /> : null}
    </group>
  );
}

/** Eyes (open, and ^ ^ when happy) and a mouth, in the head's own space. */
function Face({ kind, look, rig }: { kind: string; look: Look; rig: Rig }) {
  const set = (k: "eyes" | "happy" | "mouth") => (v: Object3D | null) => void (v && (rig[k] = v));
  if (kind === "robot") {
    // on the dark screen: glowing eyes in the trader's accent colour
    const glow = "#8ff0ff";
    const [w, hgt] = look.eyes === 1 ? [0.06, 0.1] : look.eyes === 2 ? [0.13, 0.045] : [0.07, 0.07];
    return (
      <group position={[0, 0.4, 0.338]}>
        <group ref={set("eyes")}>
          {[-0.14, 0.14].map((x) => (
            <mesh key={x} position={[x, 0.03, 0]} scale={[w, hgt, 1]}>
              <circleGeometry args={[1, 20]} />
              <meshBasicMaterial color={glow} />
            </mesh>
          ))}
        </group>
        <group ref={set("happy")} visible={false}>
          {[-0.14, 0.14].map((x) => (
            <mesh key={x} position={[x, 0.01, 0]}>
              <ringGeometry args={[0.05, 0.075, 16, 1, 0, Math.PI]} />
              <meshBasicMaterial color={glow} />
            </mesh>
          ))}
        </group>
        <mesh ref={set("mouth")} position={[0, -0.1, 0]}>
          <planeGeometry args={[0.16, 0.035]} />
          <meshBasicMaterial color={glow} />
        </mesh>
        {[-0.24, 0.24].map((x) => (
          <mesh key={x} position={[x, -0.07, 0]}>
            <circleGeometry args={[0.035, 14]} />
            <meshBasicMaterial color="#ff8fb0" transparent opacity={0.55} />
          </mesh>
        ))}
      </group>
    );
  }
  if (kind === "hooded") {
    // only two bright eyes in the dark of the hood
    return (
      <group position={[0, 0.33, 0.33]}>
        <group ref={set("eyes")}>
          {[-0.1, 0.1].map((x) => (
            <mesh key={x} position={[x, 0, 0]} scale={[0.06, 0.075, 1]}>
              <circleGeometry args={[1, 18]} />
              <meshBasicMaterial color="#fff7d6" />
            </mesh>
          ))}
        </group>
        <group ref={set("happy")} visible={false}>
          {[-0.1, 0.1].map((x) => (
            <mesh key={x} position={[x, -0.02, 0]}>
              <ringGeometry args={[0.04, 0.065, 14, 1, 0, Math.PI]} />
              <meshBasicMaterial color="#fff7d6" />
            </mesh>
          ))}
        </group>
      </group>
    );
  }
  // a person: dark eyes with a shine, a smile, blush, brows in the hair colour
  return (
    <group position={[0, 0.4, 0]}>
      <group ref={set("eyes")}>
        {[-0.13, 0.13].map((x) => (
          <group key={x} position={[x, 0.01, 0.355]} rotation={[0, x * 1.6, 0]}>
            <mesh scale={[0.05, 0.068, 0.03]}>
              <sphereGeometry args={[1, 14, 10]} />
              <meshBasicMaterial color={INK} />
            </mesh>
            <mesh position={[0.016, 0.025, 0.03]}>
              <circleGeometry args={[0.016, 10]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={set("happy")} visible={false}>
        {[-0.13, 0.13].map((x) => (
          <mesh key={x} position={[x, 0.0, 0.372]} rotation={[0, x * 1.6, 0]}>
            <ringGeometry args={[0.035, 0.055, 14, 1, 0, Math.PI]} />
            <meshBasicMaterial color={INK} />
          </mesh>
        ))}
      </group>
      {look.hat === null &&
        [-0.13, 0.13].map((x) => (
          <mesh key={x} position={[x, 0.12, 0.36]} rotation={[-0.25, x * 1.5, x > 0 ? -0.15 : 0.15]}>
            <boxGeometry args={[0.1, 0.022, 0.02]} />
            <meshBasicMaterial color={look.slots.hair} />
          </mesh>
        ))}
      <mesh ref={set("mouth")} position={[0, -0.11, 0.366]} rotation={[-0.3, 0, 0]}>
        <circleGeometry args={[0.045, 14, Math.PI, Math.PI]} />
        <meshBasicMaterial color="#b33a4a" />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, -0.06, 0.31]} rotation={[0, x * 2.4, 0]}>
          <circleGeometry args={[0.05, 14]} />
          <meshBasicMaterial color="#ff8fa3" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

const tmp = new Vector3();

/** One figure from the model, alive: walks when it moves, idles, blinks, talks and acts out emotes. */
function Figure({ kind, look, mood }: { kind: "robot" | "person" | "hooded"; look: Look; mood?: Mood }) {
  const { nodes } = useGLTF(MODEL);
  const rig = useMemo<Rig>(() => ({}), []);
  const root = useRef<Group>(null);
  const st = useRef({ last: null as Vector3 | null, speed: 0, phase: 0, walk: 0, blinkAt: 1 + Math.random() * 3, seed: Math.random() * 10 });
  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.1);
    const t = clock.elapsedTime + st.current.seed;
    const s = st.current;
    if (!root.current) return;
    root.current.getWorldPosition(tmp);
    if (s.last && dt > 0) {
      const v = Math.hypot(tmp.x - s.last.x, tmp.z - s.last.z) / dt;
      s.speed += (v - s.speed) * Math.min(1, dt * 10);
    }
    s.last = (s.last ?? new Vector3()).copy(tmp);
    const walking = s.speed > 0.25;
    s.walk += ((walking ? 1 : 0) - s.walk) * Math.min(1, dt * 8);
    s.phase += dt * (walking ? Math.min(14, 4 + s.speed * 1.6) : 6);
    const w = s.walk;
    const sw = Math.sin(s.phase);
    const m = mood?.();
    const emote = m?.emote;

    // legs and arms swing opposite each other; the body bobs twice a stride
    if (rig.legL) rig.legL.rotation.x = sw * 0.75 * w;
    if (rig.legR) rig.legR.rotation.x = -sw * 0.75 * w;
    if (rig.body) {
      rig.body.position.y = (kind === "robot" ? 0.36 : kind === "person" ? 0.36 : 0.2) + Math.abs(Math.cos(s.phase)) * 0.06 * w + Math.sin(t * 2) * 0.008 * (1 - w);
      rig.body.rotation.z = Math.sin(s.phase) * 0.05 * w;
      rig.body.rotation.x = 0.08 * w;
    }
    let aL = { x: sw * 0.7 * w, z: -0.08 - Math.sin(t * 1.7) * 0.03 * (1 - w) };
    let aR = { x: -sw * 0.7 * w, z: 0.08 + Math.sin(t * 1.7) * 0.03 * (1 - w) };
    if (emote === "👋") aR = { x: -0.2, z: 2.5 + Math.sin(t * 12) * 0.4 };
    else if (emote === "👏") {
      const c = Math.sin(t * 16) > 0 ? 0.32 : 0.12;
      aL = { x: -1.25, z: c };
      aR = { x: -1.25, z: -c };
    } else if (emote === "💃") {
      aL = { x: -0.2, z: -2.4 - Math.sin(t * 9) * 0.5 };
      aR = { x: -0.2, z: 2.4 - Math.sin(t * 9) * 0.5 };
    } else if (emote === "🥤") aR = { x: -2.5, z: 0.2 + Math.sin(t * 8) * 0.1 };
    else if (emote === "🙇") (aL = { x: 0.25, z: -0.05 }), (aR = { x: 0.25, z: 0.05 });
    if (rig.armL) (rig.armL.rotation.x = aL.x), (rig.armL.rotation.z = aL.z);
    if (rig.armR) (rig.armR.rotation.x = aR.x), (rig.armR.rotation.z = aR.z);
    if (rig.head) {
      rig.head.rotation.y = Math.sin(t * 0.37) * 0.25 * (1 - w);
      rig.head.rotation.z = m?.talking ? Math.sin(t * 3) * 0.08 : Math.sin(t * 0.5) * 0.04;
    }
    if (rig.antenna) rig.antenna.rotation.z = Math.sin(t * 3 + s.phase) * (0.12 + 0.2 * w);

    // faces: blink now and then, smile while emoting, mouth moves while talking
    const happy = !!emote;
    if (t > s.blinkAt + 0.13) s.blinkAt = t + 2 + Math.random() * 3.5;
    const blink = t > s.blinkAt;
    if (rig.eyes) (rig.eyes.visible = !happy), (rig.eyes.scale.y = blink ? 0.12 : 1);
    if (rig.happy) rig.happy.visible = happy;
    if (rig.mouth) rig.mouth.scale.y = m?.talking ? 0.6 + Math.abs(Math.sin(t * 13)) * 1.6 : happy ? 1.6 : 1;
  });
  const node = nodes[kind];
  return (
    <group ref={root}>
      {node.children.map((c) => <Part key={c.uuid} o={c} look={look} rig={rig} />)}
    </group>
  );
}

/** The helper drone that follows a person who runs an agent. */
function Drone({ look }: { look: Look }) {
  const { nodes } = useGLTF(MODEL);
  const g = useRef<Group>(null);
  const rig = useMemo<Rig>(() => ({}), []);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (g.current) {
      g.current.position.set(0.65 + Math.sin(t) * 0.12, 1.85 + Math.sin(t * 2.3) * 0.09, Math.cos(t) * 0.12);
      g.current.rotation.set(Math.sin(t * 1.3) * 0.12, Math.sin(t * 0.7) * 0.5, Math.cos(t * 1.1) * 0.12);
    }
    if (rig.rotor) rig.rotor.rotation.y += dt * 22;
  });
  return (
    <group ref={g}>
      {nodes.drone.children.map((c) => <Part key={c.uuid} o={c} look={look} rig={rig} />)}
      <group position={[0, 0.01, 0.16]}>
        {[-0.045, 0.045].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <circleGeometry args={[0.022, 12]} />
            <meshBasicMaterial color="#8ff0ff" />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A trader as they declared themselves (0 undeclared, 1 human, 2 bot, 3 human with an agent);
 *  undeclared ones keep their hood up. */
export function Trader({ kind, address, you, cloak, apron, mood }: {
  kind: number; address: string; you?: boolean; cloak?: string; apron?: boolean; mood?: Mood;
}) {
  const look = useMemo(() => lookFor(address, { apron, cloak: you ? "#4cc3d9" : cloak }), [address, apron, cloak, you]);
  return (
    <Suspense fallback={null}>
      {kind === 2 ? (
        <Figure kind="robot" look={look} mood={mood} />
      ) : kind === 1 || kind === 3 ? (
        <>
          <Figure kind="person" look={look} mood={mood} />
          {kind === 3 ? <Drone look={look} /> : null}
        </>
      ) : (
        <Figure kind="hooded" look={look} mood={mood} />
      )}
    </Suspense>
  );
}
