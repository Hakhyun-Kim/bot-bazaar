// First-visit tour: a dotted path from wherever you stand to the 🎨 easel, and the Pixel Workshop
// opens when you get there (harry, 2026-10-15). Shown once per browser; "Skip" or opening the
// workshop any other way ends it. Plain TypeScript so main.ts can ask without loading the 3D code.
const KEY = "bazaar-tour-done";

const saved = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

export const tour = { active: !saved, walking: false };
const subs = new Set<() => void>();
export const subscribeTour = (f: () => void) => (subs.add(f), () => subs.delete(f));
const emit = () => subs.forEach((f) => f());

/** End the tour for good in this browser. */
export function finishTour() {
  if (!tour.active) return;
  tour.active = false;
  tour.walking = false;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: the tour just ends for this visit */
  }
  emit();
}

export function walkTour() {
  tour.walking = true;
  emit();
}
