// Background music: "Market Day", an original loop (scripts/music/render-theme.py) played with
// Fluid R3 GM samples (CC BY 3.0, credited in the footer and README).
// Browsers block sound until the visitor interacts, so it starts on the first tap or key press,
// fades in, pauses while the tab is hidden, and the header button turns it off (remembered).
import themeUrl from "./assets/market-theme.mp3";

const PREF = "bazaar-music"; // "off" once the visitor turns it off
const VOLUME = 0.32;
const LOOP_SECONDS = (40 * 4 * 60) / 112; // 40 bars at 112 bpm; skips any mp3 end padding

const pref = {
  get: () => {
    try {
      return localStorage.getItem(PREF);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(PREF, v);
    } catch {
      /* private mode */
    }
  },
};

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let started = false;
let on = pref.get() !== "off";

function fade(to: number, seconds: number) {
  if (!ctx || !gain) return;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(to, t + seconds);
}

/** Must run inside a user gesture: that is what lets the AudioContext make sound (iOS included). */
function start() {
  if (started) return;
  started = true;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  void ctx.resume();
  void fetch(themeUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => ctx!.decodeAudioData(b))
    .then((buf) => {
      const src = ctx!.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopEnd = Math.min(LOOP_SECONDS, buf.duration);
      src.connect(gain!);
      src.start();
      if (on && !document.hidden) fade(VOLUME, 2.5);
    })
    .catch(() => {
      started = false; // try again on the next interaction
    });
}

function paint(btn: HTMLButtonElement) {
  btn.textContent = on ? "🎵" : "🔇";
  btn.setAttribute("aria-pressed", String(on));
  btn.title = on ? "Music on (tap to turn off)" : "Music off (tap to turn on)";
  btn.setAttribute("aria-label", on ? "Turn music off" : "Turn music on");
}

export function setupMusic(btn: HTMLButtonElement) {
  paint(btn);
  const first = (e: Event) => {
    if (btn.contains(e.target as Node)) return; // the button handles its own tap
    if (on) start();
  };
  addEventListener("pointerdown", first, { capture: true });
  addEventListener("keydown", first, { capture: true });
  btn.addEventListener("click", () => {
    on = !on;
    pref.set(on ? "on" : "off");
    paint(btn);
    if (on) {
      start();
      void ctx?.resume();
      fade(VOLUME, 1);
    } else fade(0, 0.4);
  });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else if (on) void ctx.resume();
  });
}
