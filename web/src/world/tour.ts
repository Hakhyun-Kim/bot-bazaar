// First-visit tour and market quests. The tour is quest one: a dotted path from wherever you stand
// to the 🎨 easel, and the Pixel Workshop opens when you get there (harry, 2026-10-15). The quests
// after it walk a newcomer through everything that needs no gas, one step at a time, each with a
// "Show me" that draws the same dotted path (harry, 2026-10-18). Progress stays in this browser.
// Plain TypeScript with no imports, so main.ts can ask without loading the 3D code and `npm test`
// can load it in Node.
const TOUR_KEY = "bazaar-tour-done";
const KEY = "bazaar-quests";

export const QUESTS = [
  { id: "draw", title: "Draw pixel art at the 🎨 easel", hint: "Follow the yellow dots to the easel on the west path. Drawing is free." },
  { id: "hello", title: "Say hi to Bolt", hint: "Bolt stands by the entrance and knows the market. Walk up and tap them." },
  { id: "gallery", title: "Look at a frame in the gallery", hint: "Every frame holds a design someone put on BOT Chain. Walk up to one." },
  { id: "together", title: "Dance with the locals", hint: "Stand next to Kip and Dot by the board and tap 💃. Everyone close joins in." },
  { id: "theatre", title: "Guess Bot or Not", hint: "At the theatre a hooded trader says one line. Bot or human?" },
  { id: "shop", title: "Look inside a shop", hint: "Walk up to a stall and see what it sells. Looking is free.", needs: "shops" },
  { id: "publish", title: "Put a design on BOT Chain", hint: "Publish from the Pixel Workshop. It stays on chain for good.", bonus: true },
] as const;
export type QuestId = (typeof QUESTS)[number]["id"];
export type Quest = (typeof QUESTS)[number];

export interface QuestState {
  done: QuestId[];
  /** The tracker shows as a small pill. */
  folded: boolean;
  /** Finished and waved off, or stopped: the tracker is gone for good. */
  over: boolean;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

/** Saved progress. A browser that finished the old tour comes back with quest one done and the
 *  tracker folded, so a returning player is not greeted like a newcomer. */
export function loadQuests(store = local()): QuestState {
  let raw: string | null = null;
  let toured = false;
  try {
    raw = store?.getItem(KEY) ?? null;
    toured = store?.getItem(TOUR_KEY) === "1";
  } catch {
    /* private mode: start fresh */
  }
  if (raw) {
    try {
      const s = JSON.parse(raw) as Partial<QuestState>;
      const ids = QUESTS.map((q) => q.id as string);
      return { done: (Array.isArray(s.done) ? s.done : []).filter((d): d is QuestId => ids.includes(d)), folded: !!s.folded, over: !!s.over };
    } catch {
      /* a bad value: start over */
    }
  }
  return toured ? { done: ["draw"], folded: true, over: false } : { done: [], folded: false, over: false };
}

/** A quest the network can't do yet (shops where only the workshop is deployed): shown locked. */
export const isLocked = (q: Quest, soon: boolean) => soon && "needs" in q && q.needs === "shops";
const required = (soon: boolean) => QUESTS.filter((q) => !("bonus" in q) && !isLocked(q, soon));

/** The step to point at: the first one not done, required steps before the bonus. */
export function currentQuest(s: QuestState, soon: boolean): Quest | null {
  const open = QUESTS.filter((q) => !s.done.includes(q.id) && !isLocked(q, soon));
  return open.find((q) => !("bonus" in q)) ?? open[0] ?? null;
}
export const questsComplete = (s: QuestState, soon: boolean) => required(soon).every((q) => s.done.includes(q.id));
export const questCount = (s: QuestState, soon: boolean) => ({ done: required(soon).filter((q) => s.done.includes(q.id)).length, of: required(soon).length });

/** Marks a quest done. Returns the new state, or null when nothing changed. */
export function markQuest(s: QuestState, id: QuestId, soon: boolean): QuestState | null {
  const q = QUESTS.find((x) => x.id === id);
  if (!q || s.over || s.done.includes(id) || isLocked(q, soon)) return null;
  return { ...s, done: [...s.done, id] };
}

// ---------- live state, shared by main.ts and the 3D world ----------
let state = loadQuests();
const save = () => {
  try {
    local()?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: progress lasts for this visit */
  }
};
let toured = (() => {
  try {
    return local()?.getItem(TOUR_KEY) === "1";
  } catch {
    return false;
  }
})();

/** tour.active: the welcome card and the dots to the easel. guide: dots to the current quest after
 *  "Show me". soon: this network only has the workshop (set by the 3D world from its data). */
export const tour = { active: !toured && !state.done.includes("draw"), walking: false, guide: false, soon: false, version: 0 };
export const quests = () => state;
const subs = new Set<() => void>();
const doneSubs = new Set<(q: Quest) => void>();
export const subscribeTour = (f: () => void) => (subs.add(f), () => void subs.delete(f));
/** Called once for every quest finished in this visit. */
export const onQuestDone = (f: (q: Quest) => void) => (doneSubs.add(f), () => void doneSubs.delete(f));
const emit = () => {
  tour.version++;
  subs.forEach((f) => f());
};

function endTourCard() {
  tour.active = false;
  tour.walking = false;
  toured = true;
  try {
    local()?.setItem(TOUR_KEY, "1");
  } catch {
    /* private mode: the tour just ends for this visit */
  }
}

/** Something counted toward a quest. Quietly does nothing when it was already done. */
export function completeQuest(id: QuestId) {
  const next = markQuest(state, id, tour.soon);
  if (!next) return;
  const wasCurrent = currentQuest(state, tour.soon)?.id === id;
  state = { ...next, folded: id === "draw" ? false : next.folded };
  if (wasCurrent) (tour.guide = false), (tour.walking = false);
  if (id === "draw") endTourCard();
  save();
  const q = QUESTS.find((x) => x.id === id)!;
  doneSubs.forEach((f) => f(q));
  emit();
}

/** The Pixel Workshop opened: quest one is done and the welcome card goes. */
export function finishTour() {
  completeQuest("draw");
  if (tour.active) endTourCard(), emit();
}

/** "Skip" on the welcome card: no card, no dots. Quest one waits in the tracker. */
export function skipTour() {
  endTourCard();
  emit();
}

export function walkTour() {
  tour.walking = true;
  emit();
}

/** "Show me": dots to the current quest, and walk there. */
export function guideQuest() {
  tour.guide = true;
  tour.walking = true;
  emit();
}

export function stopGuide() {
  if (!tour.guide && !tour.walking) return;
  tour.guide = false;
  tour.walking = false;
  emit();
}

export function foldQuests(folded: boolean) {
  state = { ...state, folded };
  if (folded) (tour.guide = false), (tour.walking = false);
  save();
  emit();
}

/** "Done" on the last card, or "Stop quests": the tracker goes for good in this browser. */
export function endQuests() {
  state = { ...state, over: true };
  tour.guide = false;
  tour.walking = false;
  if (tour.active) endTourCard();
  save();
  emit();
}

export function setQuestSoon(soon: boolean) {
  if (tour.soon === soon) return;
  tour.soon = soon;
  emit();
}
