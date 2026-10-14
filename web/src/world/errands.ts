// Things to do in the market that need no contract, so they work on every network (mainnet v1
// included): one small errand a day with a stamp for it (after GIWA Village's daily request), and
// a Bot or Not practice round. Stamps live in this browser only: a keepsake, not an asset.
// Plain TypeScript with no imports, so `npm test` can load it in Node.

export const ERRANDS = [
  { id: "talk", text: "Say hi to a resident" },
  { id: "together", text: "Do an emote together with a resident" },
  { id: "gallery", text: "Visit a frame in the gallery" },
  { id: "draw", text: "Open the Pixel Workshop" },
] as const;
export type ErrandId = (typeof ERRANDS)[number]["id"];

/** Local calendar day, so the errand changes at the visitor's midnight. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** The same errand for everyone on the same day, picked by a fixed rule. */
export function errandFor(day: string): (typeof ERRANDS)[number] {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ERRANDS[h % ERRANDS.length];
}

export interface ErrandState {
  day: string;
  done: boolean;
  stamps: number;
}
const KEY = "bazaar-errand";

export function loadErrand(day = dayKey()): ErrandState {
  let saved: Partial<ErrandState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    /* private mode or a bad value: start over */
  }
  const stamps = Number(saved.stamps) || 0;
  return saved.day === day ? { day, done: !!saved.done, stamps } : { day, done: false, stamps };
}

/** Marks today's errand done if `id` is today's errand. Returns the new state, or null when nothing changed. */
export function completeErrand(id: ErrandId, s: ErrandState): ErrandState | null {
  if (s.done || errandFor(s.day).id !== id) return null;
  const next = { day: s.day, done: true, stamps: s.stamps + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the stamp lasts for this visit */
  }
  return next;
}

/** Bot or Not practice: who said it, and whether they are a bot. Nothing is written on chain. */
export const PRACTICE = [
  { line: "I restock my paint pots at 06:00:00 sharp. Every day. Never late.", who: "Gearbox", bot: true },
  { line: "Sorry, I was going to draw a cat but it turned into a potato.", who: "Mina", bot: false },
  { line: "Your design uses 4 of 16 colours. Shall I suggest 12 more?", who: "Palette-9", bot: true },
  { line: "I came for the dumplings stall. Is it open yet?", who: "Joon", bot: false },
  { line: "I have read every design on chain. Number 3 is my favourite.", who: "Index", bot: true },
  { line: "My little brother drew the robot one. Don't tell him I said it was good.", who: "Sora", bot: false },
  { line: "Haggling detected. Opening offer: exactly 70% of list price.", who: "Haggle-Bot", bot: true },
  { line: "Can you help me? I clicked publish and now I'm nervous.", who: "Dami", bot: false },
  { line: "I never sleep, so I keep the lanterns lit for everyone.", who: "Lumen", bot: true },
  { line: "Pixel art is hard on a phone. My thumb is bigger than the squares!", who: "Hana", bot: false },
] as const;

/** A practice order that differs from visit to visit but never repeats a round back to back. */
export function nextPractice(prev: number, rnd = Math.random()): number {
  const n = PRACTICE.length;
  return (prev + 1 + Math.floor(rnd * (n - 1))) % n;
}
