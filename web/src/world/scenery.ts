// How much of the water park background to draw (harry, 2026-10-15: "show it in a way that suits the
// device"). Three levels: 0 Light (sea, beach, sun, the slide towers, nothing moving but the water),
// 1 Normal (the sea moves, floats bob, balloon and boat drift), 2 Full (ink outlines, fountains,
// gulls, finer pixels). "Auto" starts phones and small machines on Light and the rest on Normal, then
// follows the measured frame rate (drei PerformanceMonitor in World.tsx). The choice is kept in this
// browser. Plain TypeScript: no three.js here.
export type Level = 0 | 1 | 2;
export type Choice = "auto" | Level;
export const LEVEL_NAME = ["Light", "Normal", "Full"] as const;
const KEY = "bazaar-scenery";

const small = (() => {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return (
      matchMedia("(pointer: coarse)").matches ||
      Math.min(screen.width, screen.height) < 700 ||
      (nav.deviceMemory ?? 8) <= 4 ||
      (nav.hardwareConcurrency ?? 8) <= 4
    );
  } catch {
    return true;
  }
})();
/** Auto never climbs above this by itself: phones stop at Normal, Full is a manual pick there. */
const AUTO_TOP: Level = small ? 1 : 2;

const saved = ((): Choice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "0" || v === "1" || v === "2" ? (+v as Level) : "auto";
  } catch {
    return "auto";
  }
})();

export const scenery = { choice: saved, auto: (small ? 0 : 1) as Level, level: 0 as Level };
scenery.level = saved === "auto" ? scenery.auto : saved;

const subs = new Set<() => void>();
export const subscribeScenery = (f: () => void) => (subs.add(f), () => subs.delete(f));
let version = 0;
export const sceneryVersion = () => version;
function emit() {
  scenery.level = scenery.choice === "auto" ? scenery.auto : scenery.choice;
  version++;
  subs.forEach((f) => f());
}

export function chooseScenery(c: Choice) {
  scenery.choice = c;
  try {
    localStorage.setItem(KEY, c === "auto" ? "auto" : String(c));
  } catch {
    /* private mode: the pick lasts for this visit */
  }
  emit();
}

/** The frame-rate monitor's verdict: step Auto up or down one level (Fallback drops to Light for the visit). */
export function autoStep(dir: 1 | -1 | "floor") {
  const next = dir === "floor" ? 0 : Math.max(0, Math.min(AUTO_TOP, scenery.auto + dir));
  if (next === scenery.auto) return;
  scenery.auto = next as Level;
  if (scenery.choice === "auto") emit();
}

/** Device pixels per CSS pixel for each level: the cheapest win on a phone. */
export const DPR: Record<Level, [number, number]> = { 0: [1, 1.5], 1: [1, 1.75], 2: [1, 2] };
