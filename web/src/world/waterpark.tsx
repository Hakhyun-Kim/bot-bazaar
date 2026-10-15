// The water park around the market (harry, 2026-10-15, after his Roblox Waterpark and GIWA Village's
// sea): a sandy beach ring past the trees, a cartoon sea out to the horizon with foam and sparkles, a
// smiling sun, two slide towers (a blue spiral and a yellow wiggle) splashing into a lagoon of swim
// rings, palms, parasols, lifeguard chairs, a giant rubber duck, a buoy line, an island, a sailboat
// and a hot-air balloon. All of it is scenery: nothing here is clickable or read from the chain.
// How much is drawn follows scenery.ts (Light / Normal / Full); repeated things are instanced so a
// phone pays a few draw calls for them.
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import {
  BackSide, BufferGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DoubleSide, Euler, Group,
  InstancedMesh, Matrix4, Quaternion, Shape, ShaderMaterial, SphereGeometry, Vector3,
} from "three";
import { GRAD, INK } from "./toon";
import { scenery, sceneryVersion, subscribeScenery, type Level } from "./scenery";

/** Where the beach starts and the sea begins (the market itself ends at WORLD_R = 28). */
export const BEACH_IN = 37.5;
export const SHORE = 49.5;
const SAND = "#ffe3a6";

export function useLevel(): Level {
  useSyncExternalStore(subscribeScenery, sceneryVersion);
  return scenery.level;
}

type V3 = [number, number, number];
/** A background part: toon paint, an ink outline only at Full, and optionally no fog (far away). */
function B({ children, color, position, rotation, scale, line = 0.03, fog = true, lv }: {
  children: ReactNode; color: string; position?: V3; rotation?: V3; scale?: V3 | number; line?: number; fog?: boolean; lv: Level;
}) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      {children}
      <meshToonMaterial color={color} gradientMap={GRAD} fog={fog} />
      {lv === 2 && line ? <Outlines thickness={line * 70} color={INK} /> : null}
    </mesh>
  );
}

/** One instanced mesh from a list of matrices (and colours). */
function Many({ geo, mats, color, colors, fog = true }: { geo: BufferGeometry; mats: Matrix4[]; color?: string; colors?: string[]; fog?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new Color();
    mats.forEach((mt, i) => {
      m.setMatrixAt(i, mt);
      if (colors) m.setColorAt(i, c.set(colors[i % colors.length]));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [mats, colors]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, mats.length]} key={mats.length}>
      <meshToonMaterial color={colors ? "#ffffff" : color} gradientMap={GRAD} fog={fog} />
    </instancedMesh>
  );
}

const M = (p: V3, r: V3 = [0, 0, 0], s: V3 | number = 1) =>
  new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...r)), typeof s === "number" ? new Vector3(s, s, s) : new Vector3(...s));

// ---------- sky and sea ----------
const SKY = new ShaderMaterial({
  side: BackSide, depthWrite: false, fog: false,
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `varying vec3 vP;
    void main(){
      float h = clamp(vP.y, 0.0, 1.0);
      vec3 c = mix(vec3(0.86,0.96,1.0), vec3(0.47,0.78,0.99), smoothstep(0.0, 0.45, h));
      gl_FragColor = vec4(c, 1.0);
    }`,
});

const SEA = new ShaderMaterial({
  fog: false,
  uniforms: { uTime: { value: 0 }, uShore: { value: SHORE } },
  vertexShader: "varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }",
  fragmentShader: `uniform float uTime; uniform float uShore; varying vec2 vW;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      float d = length(vW);
      float a = atan(vW.y, vW.x);
      float t = uTime;
      vec3 c = mix(vec3(0.42,0.90,0.88), vec3(0.24,0.72,0.95), smoothstep(uShore, uShore + 22.0, d));
      c = mix(c, vec3(0.16,0.55,0.90), smoothstep(uShore + 20.0, 230.0, d));
      // cartoon wave dashes that roll toward the beach
      float w = sin(d * 0.85 + t * 1.3 + sin(a * 23.0 + d * 0.05) * 2.2);
      float dash = step(0.94, w) * step(0.15, sin(a * 61.0 + d * 0.3)) * (1.0 - smoothstep(70.0, 170.0, d));
      c = mix(c, vec3(1.0), dash * 0.55);
      // sparkles that blink
      vec2 cell = floor(vW * 0.45);
      float h = hash(cell);
      vec2 f = fract(vW * 0.45) - 0.5;
      float spark = step(0.965, h) * step(length(f), 0.13) * step(0.55, sin(t * 2.6 + h * 60.0)) * (1.0 - smoothstep(55.0, 110.0, d));
      c = mix(c, vec3(1.0), spark);
      // foam where the sea meets the sand
      float edge = uShore + 0.9 + 0.45 * sin(t * 1.4 + a * 9.0) + 0.25 * sin(a * 37.0);
      c = mix(c, vec3(1.0), 1.0 - smoothstep(edge - 0.25, edge + 0.25, d));
      // haze into the sky at the horizon
      c = mix(c, vec3(0.86,0.96,1.0), smoothstep(260.0, 640.0, d));
      gl_FragColor = vec4(c, 1.0);
    }`,
});

function SkyAndSea({ lv }: { lv: Level }) {
  useFrame((st) => {
    if (lv > 0) SEA.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <>
      <mesh material={SKY} renderOrder={-10}>
        <sphereGeometry args={[900, 24, 12]} />
      </mesh>
      <mesh material={SEA} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <circleGeometry args={[700, 96]} />
      </mesh>
    </>
  );
}

// ---------- the sun: big, round and smiling ----------
const SUN_AT: V3 = [58, 30, -380];
function Sun({ lv }: { lv: Level }) {
  const g = useRef<Group>(null);
  const rays = useRef<Group>(null);
  useFrame((st, dt) => {
    if (g.current) g.current.lookAt(st.camera.position);
    if (rays.current && lv > 0) rays.current.rotation.z += dt * 0.12;
  });
  const flat = { fog: false, toneMapped: false } as const;
  return (
    <group ref={g} position={SUN_AT}>
      <mesh position={[0, 0, -1]}>
        <circleGeometry args={[30, 48]} />
        <meshBasicMaterial color="#fff6c8" transparent opacity={0.55} {...flat} />
      </mesh>
      <group ref={rays}>
        {Array.from({ length: 12 }, (_, i) => (
          <group key={i} rotation={[0, 0, (i / 12) * Math.PI * 2]} position={[0, 0, -0.5]}>
            <mesh position={[0, 24, 0]} rotation={[0, 0, Math.PI / 2]}>
              <circleGeometry args={[4.2, 3]} />
              <meshBasicMaterial color={i % 2 ? "#ffc43d" : "#ffd75e"} {...flat} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh>
        <circleGeometry args={[18, 48]} />
        <meshBasicMaterial color="#ffd23f" {...flat} />
      </mesh>
      <mesh position={[0, 0, -0.2]}>
        <circleGeometry args={[19.2, 48]} />
        <meshBasicMaterial color="#f2a531" {...flat} />
      </mesh>
      {/* a sleepy happy face */}
      {[-6, 6].map((x) => (
        <mesh key={x} position={[x, 3, 0.2]}>
          <ringGeometry args={[1.6, 2.6, 16, 1, 0, Math.PI]} />
          <meshBasicMaterial color={INK} {...flat} />
        </mesh>
      ))}
      <mesh position={[0, -2.5, 0.2]} rotation={[0, 0, Math.PI]}>
        <ringGeometry args={[3.6, 4.8, 20, 1, 0, Math.PI]} />
        <meshBasicMaterial color={INK} {...flat} />
      </mesh>
      {[-10, 10].map((x) => (
        <mesh key={x} position={[x, -2, 0.1]} scale={[1.3, 0.8, 1]}>
          <circleGeometry args={[2.4, 20]} />
          <meshBasicMaterial color="#ff9d8a" {...flat} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- beach ----------
function Beach({ onWalk }: { onWalk: (x: number, z: number) => void }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}
        onClick={(e) => (e.stopPropagation(), onWalk(e.point.x, e.point.z))}>
        <ringGeometry args={[BEACH_IN, SHORE - 1.6, 96]} />
        <meshToonMaterial color={SAND} gradientMap={GRAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[SHORE - 1.7, SHORE + 0.4, 96]} />
        <meshToonMaterial color="#efc985" gradientMap={GRAD} />
      </mesh>
    </group>
  );
}

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * r, z: -Math.cos(a) * r };
};
/** Palms and parasols keep clear of the slides, pools and lifeguard chairs on the north beach. */
const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;
const busy = (x: number, z: number) =>
  near(x, z, BLUE_AT, 6) || near(x, z, YELLOW_AT, 6) || near(x, z, BLUE_POOL, 4) || near(x, z, YELLOW_POOL, 4) ||
  (Math.abs(x) < 9 && z < -36) || CHAIRS.some((c) => near(x, z, c, 2.6));

/** Palms round the beach by a fixed rule; Light draws fewer. */
function Palms({ lv }: { lv: Level }) {
  const { trunks, leaves, nuts } = useMemo(() => {
    const trunks: Matrix4[] = [];
    const leaves: Matrix4[] = [];
    const nuts: Matrix4[] = [];
    const n = lv === 0 ? 22 : 40;
    for (let i = 0; i < n; i++) {
      const deg = (i / n) * 360 + (i % 3) * 3;
      const r = BEACH_IN + 1.5 + ((i * 7) % 5) * 1.6;
      const { x, z } = polar(deg, r);
      if (busy(x, z)) continue;
      const s = 0.9 + ((i * 13) % 5) / 10;
      const lean = 0.18 + ((i * 5) % 3) * 0.06;
      const yaw = i * 2.1;
      const base = new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromEuler(new Euler(0, yaw, 0)), new Vector3(s, s, s));
      const tilt = new Matrix4().makeRotationZ(lean);
      trunks.push(base.clone().multiply(tilt).multiply(M([0, 2.3, 0])));
      const top = base.clone().multiply(tilt).multiply(M([0, 4.6, 0]));
      for (let k = 0; k < 6; k++) leaves.push(top.clone().multiply(M([0, 0, 0], [0, (k / 6) * Math.PI * 2 + i, 0])).multiply(M([0, -0.25, 1.25], [0.45, 0, 0], [0.42, 0.1, 1.5])));
      for (let k = 0; k < 3; k++) nuts.push(top.clone().multiply(M([Math.cos(k * 2.1) * 0.28, -0.3, Math.sin(k * 2.1) * 0.28], [0, 0, 0], 0.22)));
    }
    return { trunks, leaves, nuts };
  }, [lv]);
  const trunkGeo = useMemo(() => new CylinderGeometry(0.16, 0.26, 4.6, 7), []);
  const leafGeo = useMemo(() => new SphereGeometry(1, 10, 6), []);
  const nutGeo = useMemo(() => new SphereGeometry(1, 8, 6), []);
  return (
    <>
      <Many geo={trunkGeo} mats={trunks} color="#b9824f" />
      <Many geo={leafGeo} mats={leaves} colors={["#4fbf62", "#62d070", "#3fae58"]} />
      <Many geo={nutGeo} mats={nuts} color="#7a5233" />
    </>
  );
}

/** Striped parasols with a towel under each; Light keeps half. */
function Parasols({ lv }: { lv: Level }) {
  const COLS = ["#ff6b8a", "#4fa8ff", "#ffd166", "#5ccf7a", "#b98cff", "#ff9f1c"];
  const { tops, poles, towels, cols, tcols } = useMemo(() => {
    const tops: Matrix4[] = [], poles: Matrix4[] = [], towels: Matrix4[] = [];
    const cols: string[] = [], tcols: string[] = [];
    const n = lv === 0 ? 9 : 18;
    for (let i = 0; i < n; i++) {
      const deg = (i / n) * 360 + 11;
      const { x, z } = polar(deg, 43.5 + (i % 2) * 1.8);
      if (busy(x, z)) continue;
      const yaw = -((deg * Math.PI) / 180);
      tops.push(M([x, 2.2, z], [0.12, yaw, 0.1], [1.5, 0.55, 1.5]));
      poles.push(M([x, 1.1, z], [0, 0, 0], [1, 1, 1]));
      const t = polar(deg, 43.5 + (i % 2) * 1.8 - 1.4);
      towels.push(M([t.x, 0.03, t.z], [0, yaw, 0], [0.9, 0.05, 1.7]));
      cols.push(COLS[i % COLS.length]);
      tcols.push(COLS[(i + 2) % COLS.length]);
    }
    return { tops, poles, towels, cols, tcols };
  }, [lv]);
  const coneGeo = useMemo(() => new ConeGeometry(1, 1, 8), []);
  const poleGeo = useMemo(() => new CylinderGeometry(0.05, 0.05, 2.2, 5), []);
  const boxGeo = useMemo(() => new CylinderGeometry(1, 1, 1, 4), []);
  return (
    <>
      <Many geo={coneGeo} mats={tops} colors={cols} />
      <Many geo={poleGeo} mats={poles} color="#fff6e6" />
      <Many geo={boxGeo} mats={towels} colors={tcols} />
    </>
  );
}

function LifeguardChair({ x, z, lv }: { x: number; z: number; lv: Level }) {
  const yaw = Math.atan2(-x, -z) + Math.PI;
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const).map(([a, b], i) => (
        <B key={i} lv={lv} color="#fff6e6" position={[a, 1.1, b]} rotation={[b * 0.2, 0, -a * 0.2]}><cylinderGeometry args={[0.07, 0.09, 2.3, 6]} /></B>
      ))}
      <B lv={lv} color="#ef476f" position={[0, 2.3, 0]}><boxGeometry args={[1.3, 0.25, 1.1]} /></B>
      <B lv={lv} color="#ef476f" position={[0, 2.9, -0.5]}><boxGeometry args={[1.3, 1, 0.15]} /></B>
      <B lv={lv} color="#ffffff" position={[0, 2.9, -0.42]} line={0}><boxGeometry args={[1.32, 0.25, 0.15]} /></B>
      <B lv={lv} color="#ffd166" position={[0, 4.3, 0]} scale={[1.3, 0.45, 1.3]}><coneGeometry args={[1, 1, 8]} /></B>
      <B lv={lv} color="#fff6e6" position={[0, 3.5, -0.1]} line={0}><cylinderGeometry args={[0.04, 0.04, 1.6, 5]} /></B>
      <B lv={lv} color="#ff8a5c" position={[0.9, 0.35, 0.6]} rotation={[Math.PI / 2, 0, 0.3]}><torusGeometry args={[0.32, 0.12, 8, 16]} /></B>
    </group>
  );
}

// ---------- slides ----------
// The two towers frame the market gate from the north beach; each splashes into its own pool, and
// the lagoon of swim rings sits between them behind the gate.
const BLUE_AT = { x: -21, z: -41.5 };
const YELLOW_AT = { x: 21.5, z: -41.5 };
const BLUE_POOL = { x: BLUE_AT.x + 5, z: BLUE_AT.z + 3.4 };
const YELLOW_POOL = { x: YELLOW_AT.x - 5, z: YELLOW_AT.z + 3.4 };
const LAGOON = { x: 0, z: -43.5, rx: 5.2, rz: 2.8 };
const CHAIRS = [{ x: -10.5, z: -40 }, { x: 10.5, z: -40 }];

const blueCurve = (() => {
  const pts: Vector3[] = [];
  const turns = 3.1;
  for (let i = 0; i <= 64; i++) {
    const u = i / 64;
    const a = u * turns * Math.PI * 2 + Math.PI;
    pts.push(new Vector3(BLUE_AT.x + Math.cos(a) * 2.7, 12.4 - u * 11.0, BLUE_AT.z + Math.sin(a) * 2.7));
  }
  const end = pts[pts.length - 1];
  pts.push(new Vector3((end.x + BLUE_POOL.x) / 2, 0.75, (end.z + BLUE_POOL.z) / 2 - 0.4), new Vector3(BLUE_POOL.x - 0.8, 0.25, BLUE_POOL.z - 0.3));
  return new CatmullRomCurve3(pts);
})();
const yellowCurve = new CatmullRomCurve3(
  ([
    [0, 9.6, 1.3],
    [2.8, 8.5, 2.2],
    [3.6, 7.2, -0.8],
    [1.4, 6.0, -3.0],
    [-2.0, 4.9, -2.6],
    [-3.6, 3.7, -0.2],
    [-1.8, 2.5, 1.4],
    [-3.0, 1.2, 2.6],
    [-4.2, 0.25, 3.2],
  ] as const).map(([dx, y, dz]) => new Vector3(YELLOW_AT.x + dx, y, YELLOW_AT.z + dz)),
);

function Supports({ curve, every, color }: { curve: CatmullRomCurve3; every: number; color: string }) {
  const mats = useMemo(() => {
    const out: Matrix4[] = [];
    for (let u = every; u < 0.97; u += every) {
      const p = curve.getPointAt(u);
      if (p.y < 0.9) continue;
      out.push(M([p.x, p.y / 2 - 0.2, p.z], [0, 0, 0], [1, p.y - 0.4, 1]));
    }
    return out;
  }, [curve, every]);
  const geo = useMemo(() => new CylinderGeometry(0.07, 0.07, 1, 5), []);
  return <Many geo={geo} mats={mats} color={color} />;
}

function BlueTornado({ lv }: { lv: Level }) {
  const { x, z } = BLUE_AT;
  return (
    <group>
      <B lv={lv} color="#f4f8ff" position={[x, 6.4, z]}><cylinderGeometry args={[0.8, 1, 12.8, 14]} /></B>
      {[2.5, 5.5, 8.5, 11.5].map((y) => (
        <B key={y} lv={lv} color="#7cc6f2" position={[x, y, z]} line={0}><cylinderGeometry args={[0.86, 0.86, 0.35, 14]} /></B>
      ))}
      <B lv={lv} color="#fff6e6" position={[x, 12.9, z]}><cylinderGeometry args={[2.1, 2.1, 0.35, 16]} /></B>
      {[0, 1, 2, 3].map((i) => (
        <B key={i} lv={lv} color="#f4f8ff" position={[x + Math.cos(i * 1.57 + 0.78) * 1.8, 13.8, z + Math.sin(i * 1.57 + 0.78) * 1.8]} line={0}>
          <cylinderGeometry args={[0.07, 0.07, 1.6, 5]} />
        </B>
      ))}
      <B lv={lv} color="#4fa8ff" position={[x, 15.2, z]}><coneGeometry args={[2.6, 1.6, 16]} /></B>
      <B lv={lv} color="#ffd166" position={[x, 16.25, z]}><sphereGeometry args={[0.32, 10, 8]} /></B>
      <B lv={lv} color="#3d8bff" line={0.02}><tubeGeometry args={[blueCurve, 220, 0.55, 10, false]} /></B>
      <Supports curve={blueCurve} every={0.06} color="#f4f8ff" />
    </group>
  );
}

function YellowWiggle({ lv }: { lv: Level }) {
  const { x, z } = YELLOW_AT;
  const legs: [number, number][] = [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]];
  return (
    <group>
      {legs.map(([a, b], i) => (
        <B key={i} lv={lv} color="#ff6b8a" position={[x + a, 4.8, z + b]}><cylinderGeometry args={[0.12, 0.14, 9.6, 6]} /></B>
      ))}
      {[2.4, 4.8, 7.2].map((y) => (
        <B key={y} lv={lv} color="#ffffff" position={[x, y, z]} line={0}><boxGeometry args={[2.3, 0.12, 2.3]} /></B>
      ))}
      <B lv={lv} color="#fff6e6" position={[x, 9.7, z]}><boxGeometry args={[2.8, 0.3, 2.8]} /></B>
      <B lv={lv} color="#ff6b8a" position={[x, 11.4, z]} scale={[1, 0.55, 1]}><sphereGeometry args={[1.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></B>
      {legs.map(([a, b], i) => (
        <B key={i} lv={lv} color="#ffffff" position={[x + a * 0.9, 10.6, z + b * 0.9]} line={0}><cylinderGeometry args={[0.06, 0.06, 1.6, 5]} /></B>
      ))}
      <B lv={lv} color="#ffc93d" line={0.02}><tubeGeometry args={[yellowCurve, 200, 0.5, 10, false]} /></B>
      <Supports curve={yellowCurve} every={0.09} color="#ff6b8a" />
    </group>
  );
}

/** A round splash pool at the foot of a slide. */
function SplashPool({ at }: { at: { x: number; z: number } }) {
  return (
    <group position={[at.x, 0, at.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <circleGeometry args={[2.9, 32]} />
        <meshToonMaterial color="#ffffff" gradientMap={GRAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[2.4, 32]} />
        <meshBasicMaterial color="#5fe0e6" />
      </mesh>
    </group>
  );
}

/** The lagoon between the towers, with swim rings that bob and (at Full) three fountain arcs. */
const RINGS = [
  { x: -1.8, z: -0.6, c: "#ff6b8a" }, { x: 1.2, z: 0.9, c: "#ffd166" }, { x: 2.9, z: -0.9, c: "#5ccf7a" },
  { x: -3.4, z: 0.8, c: "#4fa8ff" }, { x: 0.2, z: -1.4, c: "#b98cff" },
];
function Lagoon({ lv }: { lv: Level }) {
  const rings = useRef<Group>(null);
  const jets = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Matrix4(), []);
  const DROPS = 54;
  useFrame((st) => {
    if (lv === 0) return;
    const t = st.clock.elapsedTime;
    rings.current?.children.forEach((c, i) => {
      c.position.y = 0.2 + Math.sin(t * 1.6 + i * 1.3) * 0.07;
      c.rotation.z = Math.sin(t * 1.1 + i) * 0.08;
    });
    const j = jets.current;
    if (!j) return;
    // three fountain arcs over the lagoon, drops running along each parabola
    for (let i = 0; i < DROPS; i++) {
      const arc = i % 3;
      const u = ((t * 0.55 + i / DROPS) % 1);
      const sx = [-3.8, 0, 3.8][arc];
      const dx = [3, 0.01, -3][arc];
      const x = LAGOON.x + sx + dx * u;
      const y = 0.3 + (arc === 1 ? 6.5 : 3.6) * 4 * u * (1 - u);
      const z = LAGOON.z - 2.3 + (arc === 1 ? Math.sin(i) * 0.4 * u : 1.6 * u);
      dummy.makeTranslation(x, y, z).scale(new Vector3(1, 1, 1).setScalar(0.13 + 0.06 * Math.sin(i)));
      j.setMatrixAt(i, dummy);
    }
    j.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[LAGOON.x, 0.03, LAGOON.z]} scale={[LAGOON.rx + 0.5, LAGOON.rz + 0.5, 1]}>
        <circleGeometry args={[1, 40]} />
        <meshToonMaterial color="#ffffff" gradientMap={GRAD} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[LAGOON.x, 0.05, LAGOON.z]} scale={[LAGOON.rx, LAGOON.rz, 1]}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color="#5fe0e6" />
      </mesh>
      <group ref={rings}>
        {RINGS.map((r, i) => (
          <group key={i} position={[LAGOON.x + r.x, 0.2, LAGOON.z + r.z]}>
            <B lv={lv} color={r.c} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.55, 0.22, 8, 18]} /></B>
          </group>
        ))}
      </group>
      {lv === 2 && (
        <instancedMesh ref={jets} args={[undefined, undefined, DROPS]} frustumCulled={false}>
          <sphereGeometry args={[1, 6, 5]} />
          <meshBasicMaterial color="#e8fbff" />
        </instancedMesh>
      )}
    </group>
  );
}

// ---------- out at sea and up in the sky ----------
function Duck({ lv }: { lv: Level }) {
  const g = useRef<Group>(null);
  useFrame((st) => {
    if (!g.current || lv === 0) return;
    const t = st.clock.elapsedTime;
    g.current.position.y = Math.sin(t * 1.2) * 0.25;
    g.current.rotation.z = Math.sin(t * 0.9) * 0.06;
    g.current.rotation.y = 0.5 + Math.sin(t * 0.2) * 0.3;
  });
  return (
    <group position={[-10, 0, -72]}>
      <group ref={g} rotation={[0, 0.5, 0]} scale={3.2}>
        <B lv={lv} color="#ffd23f" position={[0, 0.5, 0]} scale={[1.25, 0.8, 1]}><sphereGeometry args={[1, 18, 14]} /></B>
        <B lv={lv} color="#ffd23f" position={[0.75, 0.85, 0]} scale={[0.55, 0.7, 0.6]} rotation={[0, 0, 0.6]}><sphereGeometry args={[1, 14, 10]} /></B>
        <B lv={lv} color="#ffd23f" position={[-0.85, 1.55, 0]}><sphereGeometry args={[0.62, 16, 12]} /></B>
        <B lv={lv} color="#ff8a3d" position={[-1.45, 1.45, 0]} scale={[1, 0.45, 0.8]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.32, 0.6, 12]} /></B>
        {[-0.28, 0.28].map((s) => (
          <mesh key={s} position={[-1.22, 1.75, s]}>
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshBasicMaterial color={INK} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Buoys({ lv }: { lv: Level }) {
  const ref = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    for (let d = -70; d <= 70; d += 3.2) out.push(polar(d, SHORE + 12));
    return out;
  }, []);
  const m = useMemo(() => new Matrix4(), []);
  useLayoutEffect(() => {
    const r = ref.current;
    if (!r) return;
    const c = new Color();
    spots.forEach((p, i) => {
      r.setMatrixAt(i, m.makeTranslation(p.x, 0.15, p.z));
      r.setColorAt(i, c.set(i % 2 ? "#ffffff" : "#ef476f"));
    });
    r.instanceMatrix.needsUpdate = true;
    if (r.instanceColor) r.instanceColor.needsUpdate = true;
  }, [spots, m]);
  useFrame((st) => {
    const r = ref.current;
    if (!r || lv === 0) return;
    const t = st.clock.elapsedTime;
    spots.forEach((p, i) => r.setMatrixAt(i, m.makeTranslation(p.x, 0.15 + Math.sin(t * 1.8 + i * 0.7) * 0.12, p.z)));
    r.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} frustumCulled={false}>
      <sphereGeometry args={[0.45, 10, 8]} />
      <meshToonMaterial color="#ffffff" gradientMap={GRAD} />
    </instancedMesh>
  );
}

function Island({ lv }: { lv: Level }) {
  return (
    <group position={[-62, 0, -135]} scale={2.4}>
      <B lv={lv} color={SAND} position={[0, -0.6, 0]} scale={[4.5, 1, 3.2]} fog={false}><sphereGeometry args={[1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></B>
      <B lv={lv} color="#b9824f" position={[0.4, 1.4, 0]} rotation={[0, 0, -0.25]} fog={false}><cylinderGeometry args={[0.12, 0.2, 3, 6]} /></B>
      {Array.from({ length: 5 }, (_, k) => (
        <B key={k} lv={lv} color="#4fbf62" fog={false} position={[0.8 + Math.cos(k * 1.26) * 0.8, 2.8, Math.sin(k * 1.26) * 0.8]}
          rotation={[0, -k * 1.26, -0.5]} scale={[1.1, 0.12, 0.35]}><sphereGeometry args={[1, 10, 6]} /></B>
      ))}
      <B lv={lv} color="#ef476f" position={[-1.6, 0.9, 0.6]} fog={false} scale={[1, 0.6, 1]}><coneGeometry args={[1, 1.2, 6]} /></B>
      <B lv={lv} color="#fff6e6" position={[-1.6, 0.35, 0.6]} fog={false}><cylinderGeometry args={[0.7, 0.7, 0.7, 6]} /></B>
    </group>
  );
}

const sailShape = (() => {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0, 3.4);
  s.lineTo(2.2, 0.2);
  s.closePath();
  return s;
})();
function Sailboat({ lv }: { lv: Level }) {
  const g = useRef<Group>(null);
  useFrame((st, dt) => {
    const b = g.current;
    if (!b || lv === 0) return;
    b.position.x += dt * 1.2;
    if (b.position.x > 140) b.position.x = -140;
    b.rotation.z = Math.sin(st.clock.elapsedTime * 1.1) * 0.06;
  });
  return (
    <group ref={g} position={[40, 0, -150]} scale={2.6} rotation={[0, -0.1, 0]}>
      <B lv={lv} color="#ffffff" position={[0, 0.3, 0]} scale={[2.2, 0.55, 0.8]} fog={false}><sphereGeometry args={[1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /></B>
      <B lv={lv} color="#4fa8ff" position={[0, 0.32, 0]} scale={[2.25, 0.12, 0.82]} fog={false} line={0}><cylinderGeometry args={[1, 1, 1, 16]} /></B>
      <B lv={lv} color="#8a5a35" position={[0, 2.1, 0]} fog={false} line={0}><cylinderGeometry args={[0.05, 0.05, 3.6, 5]} /></B>
      <mesh position={[0.06, 0.55, 0]}>
        <shapeGeometry args={[sailShape]} />
        <meshBasicMaterial color="#fff6e6" side={DoubleSide} fog={false} />
      </mesh>
      <mesh position={[-0.06, 0.6, 0]} scale={[-0.8, 0.85, 1]}>
        <shapeGeometry args={[sailShape]} />
        <meshBasicMaterial color="#ff6b8a" side={DoubleSide} fog={false} />
      </mesh>
    </group>
  );
}

function Balloon({ lv }: { lv: Level }) {
  const g = useRef<Group>(null);
  useFrame((st, dt) => {
    const b = g.current;
    if (!b) return;
    b.position.x += dt * 0.6;
    if (b.position.x > 120) b.position.x = -120;
    b.position.y = 26 + Math.sin(st.clock.elapsedTime * 0.4) * 1.2;
  });
  const stripes = ["#ef476f", "#ffd166", "#4fa8ff", "#ffd166"];
  return (
    <group ref={g} position={[-36, 26, -105]} scale={2.2}>
      <B lv={lv} color="#ffffff" fog={false} scale={[1, 1.15, 1]}><sphereGeometry args={[2, 20, 14]} /></B>
      {stripes.map((c, i) => (
        <B key={i} lv={lv} color={c} fog={false} line={0} rotation={[0, (i * Math.PI) / 4, 0]} scale={[0.36, 1.16, 1.01]}>
          <sphereGeometry args={[2, 16, 14]} />
        </B>
      ))}
      <B lv={lv} color="#c98b52" fog={false} position={[0, -3.4, 0]}><boxGeometry args={[0.9, 0.7, 0.9]} /></B>
      {[-0.35, 0.35].map((s) => (
        <B key={s} lv={lv} color="#8a5a35" fog={false} line={0} position={[s, -2.6, 0]}><cylinderGeometry args={[0.03, 0.03, 1.2, 4]} /></B>
      ))}
    </group>
  );
}

function Gulls() {
  const g = useRef<Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    g.current?.children.forEach((b, i) => {
      const a = t * 0.25 + i * 2.1;
      b.position.set(Math.cos(a) * (18 + i * 6), 14 + i * 2 + Math.sin(t + i) * 0.6, -70 + Math.sin(a) * 12);
      b.rotation.y = -a;
      const flap = Math.sin(t * 7 + i) * 0.45;
      (b.children[0] as Group).rotation.z = 0.25 + flap;
      (b.children[1] as Group).rotation.z = -0.25 - flap;
    });
  });
  return (
    <group ref={g}>
      {[0, 1, 2].map((i) => (
        <group key={i}>
          {[1, -1].map((side) => (
            <group key={side}>
              <mesh position={[side * 0.75, 0, 0]}><boxGeometry args={[1.5, 0.07, 0.32]} /><meshBasicMaterial color="#ffffff" fog={false} /></mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Everything outside the market. `onWalk` makes the sand walk-to-able like the grass. */
export function WaterPark({ onWalk }: { onWalk: (x: number, z: number) => void }) {
  const lv = useLevel();
  return (
    <group>
      <SkyAndSea lv={lv} />
      <Sun lv={lv} />
      <Beach onWalk={onWalk} />
      <Palms lv={lv} />
      <Parasols lv={lv} />
      {CHAIRS.map((c, i) => <LifeguardChair key={i} x={c.x} z={c.z} lv={lv} />)}
      <BlueTornado lv={lv} />
      <YellowWiggle lv={lv} />
      <SplashPool at={BLUE_POOL} />
      <SplashPool at={YELLOW_POOL} />
      <Lagoon lv={lv} />
      <Duck lv={lv} />
      <Buoys lv={lv} />
      <Island lv={lv} />
      <Sailboat lv={lv} />
      {lv > 0 && <Balloon lv={lv} />}
      {lv === 2 && <Gulls />}
    </group>
  );
}
