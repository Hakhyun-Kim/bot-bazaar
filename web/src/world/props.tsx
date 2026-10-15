// Market props from Blender (art/props.py -> public/models/props.glb): crates, barrels, lamp posts,
// flower bushes and pot plants. Each part of a prop is one instanced mesh, so a hundred props cost a
// few draw calls, which keeps phones smooth.
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { Outlines, useGLTF } from "@react-three/drei";
import { CanvasTexture, Color, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { GRAD, INK } from "./toon";

const MODEL = `${import.meta.env.BASE_URL}models/props.glb`;
useGLTF.preload(MODEL);

export type PropKind = "crate" | "barrel" | "lamp" | "bush" | "pot";
export interface PropAt {
  kind: PropKind;
  x: number;
  z: number;
  rot?: number;
  s?: number;
  /** colour for the part painted "flower" (bush blossoms) */
  tint?: string;
}

const PAINT: Record<string, string> = {
  wood: "#c98b52",
  woodDark: "#8a5a35",
  metal: "#7d8597",
  glow: "#ffe08a",
  roof: "#3a2e3f",
  leaf: "#6cc46a",
  flower: "#ff8fb0",
  pot: "#e07a4f",
  goods: "#ef476f",
  goods2: "#ffd166",
  lid: "#d99a5e",
};
const GLOWS = new Set(["glow"]);

function PartSet({ mesh, local, list }: { mesh: Mesh; local: Matrix4; list: PropAt[] }) {
  const ref = useRef<InstancedMesh>(null);
  const slot = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const place = new Matrix4();
    const q = new Quaternion();
    const c = new Color();
    list.forEach((p, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), p.rot ?? 0);
      place.compose(new Vector3(p.x, 0, p.z), q, new Vector3().setScalar(p.s ?? 1)).multiply(local);
      m.setMatrixAt(i, place);
      if (slot === "flower") m.setColorAt(i, c.set(p.tint ?? PAINT.flower));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list, local, slot]);
  const small = slot === "flower" || slot.startsWith("goods");
  return (
    <instancedMesh ref={ref} args={[mesh.geometry, undefined, list.length]} frustumCulled={false}>
      {GLOWS.has(slot) ? (
        <meshBasicMaterial color={PAINT[slot]} />
      ) : (
        <meshToonMaterial color={slot === "flower" ? "#ffffff" : PAINT[slot] ?? "#ff00ff"} gradientMap={GRAD} />
      )}
      {small ? null : <Outlines thickness={2} color={INK} />}
    </instancedMesh>
  );
}

function PropSet({ kind, list }: { kind: PropKind; list: PropAt[] }) {
  const { nodes } = useGLTF(MODEL);
  const parts = useMemo(() => {
    const root = nodes[kind] as Object3D;
    root.updateWorldMatrix(true, true);
    const inv = root.matrixWorld.clone().invert();
    const out: { mesh: Mesh; local: Matrix4 }[] = [];
    root.traverse((o) => {
      if ((o as Mesh).isMesh) out.push({ mesh: o as Mesh, local: inv.clone().multiply(o.matrixWorld) });
    });
    return out;
  }, [nodes, kind]);
  return <>{parts.map((p) => <PartSet key={p.mesh.uuid} mesh={p.mesh} local={p.local} list={list} />)}</>;
}

export function Props({ list }: { list: PropAt[] }) {
  const by = useMemo(() => {
    const m = new Map<PropKind, PropAt[]>();
    for (const p of list) m.set(p.kind, [...(m.get(p.kind) ?? []), p]);
    return [...m];
  }, [list]);
  return (
    <Suspense fallback={null}>
      {by.map(([kind, l]) => <PropSet key={kind} kind={kind} list={l} />)}
    </Suspense>
  );
}

/** A soft round shadow on the ground: cheap, and it makes things stand on the ground. */
export const SHADOW = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  r.addColorStop(0, "rgba(58,46,63,0.42)");
  r.addColorStop(0.6, "rgba(58,46,63,0.22)");
  r.addColorStop(1, "rgba(58,46,63,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
})();

export function BlobShadow({ r = 0.55, y = 0.035 }: { r?: number; y?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} renderOrder={-1}>
      <planeGeometry args={[r * 2, r * 2]} />
      <meshBasicMaterial map={SHADOW} transparent depthWrite={false} />
    </mesh>
  );
}
