"""Render "Market Day", the BOT Bazaar market theme: an original composition played with FluidR3_GM samples
(https://github.com/gleitz/midi-js-soundfonts, FluidR3_GM/<instrument>-mp3/<note>.mp3, CC BY 3.0).

Usage: python3 -I scripts/music/render-theme.py <sample_dir> <out.wav>
then: ffmpeg -i out.wav -c:a libmp3lame -q:a 4 web/src/assets/market-theme.mp3
"""
import subprocess, sys, random
import numpy as np

SR = 44100
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
SWING = 0.57  # off-beat eighths land a little late: a light, bouncy shuffle
random.seed(7)
rng = np.random.default_rng(7)

SAMPLES, OUT = sys.argv[1], sys.argv[2]
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
ALIAS = {"C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb"}


def midi(n):
    name, octv = n[:-1], int(n[-1])
    name = ALIAS.get(name, name)
    return 12 * (octv + 1) + NAMES.index(name)


_cache = {}


def sample(inst, m):
    key = (inst, m)
    if key not in _cache:
        path = f"{SAMPLES}/{inst}/{NAMES[m % 12]}{m // 12 - 1}.mp3"
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                             capture_output=True, check=True).stdout
        x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
        # trim the mp3 encoder's leading silence so notes land on the beat
        env = np.abs(x).max(axis=1)
        on = int(np.argmax(env > env.max() * 0.02))
        _cache[key] = x[max(0, on - 30):]
    return _cache[key]


def swing(beat):
    """Map a straight beat position to a swung one (eighth-note shuffle)."""
    whole = np.floor(beat)
    frac = beat - whole
    if abs(frac - 0.5) < 1e-6:
        frac = SWING
    elif abs(frac - 0.25) < 1e-6:
        frac = SWING / 2
    elif abs(frac - 0.75) < 1e-6:
        frac = SWING + (1 - SWING) / 2
    return whole + frac


class Track:
    def __init__(self, length, pan=0.0, gain=1.0, verb=0.2):
        self.buf = np.zeros((int(length * SR) + SR * 4, 2))
        self.pan, self.gain, self.verb = pan, gain, verb

    def add(self, x, t):
        i = int(t * SR)
        n = min(len(x), len(self.buf) - i)
        if i >= 0 and n > 0:
            self.buf[i:i + n] += x[:n]


def note(tr, inst, n, beat, dur, vel=0.8, ring=0.5, jitter=0.006, offset=0.0):
    """Place one sampled note. dur in beats; ring = extra seconds before a short fade (natural decay)."""
    x = sample(inst, midi(n)).copy()
    keep = int((dur * BEAT + ring) * SR)
    fade = int(0.08 * SR)
    x = x[:keep + fade]
    if len(x) > keep:
        x[keep:] *= np.linspace(1, 0, len(x) - keep)[:, None]
    v = vel * (1 + rng.normal(0, 0.06))
    tr.add(x * v, swing(beat) * BEAT + offset + rng.normal(0, jitter))


# --- simple synthesized percussion (soft and round, nothing harsh) ---
def kick():
    t = np.arange(int(0.35 * SR)) / SR
    f = 52 + 70 * np.exp(-t * 30)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    x += 0.15 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 300)
    return np.stack([x, x], 1)


def clap():
    t = np.arange(int(0.25 * SR)) / SR
    n = rng.normal(0, 1, len(t))
    env = np.exp(-t * 28)
    for d in (0.0, 0.011, 0.022):  # three quick hands make a clap
        env += 0.6 * np.exp(-np.maximum(t - d, 0) * 160) * (t >= d)
    # band-pass-ish: difference of two smoothings
    a = np.convolve(n, np.ones(3) / 3, "same") - np.convolve(n, np.ones(14) / 14, "same")
    x = a * env * 0.6
    return np.stack([x * 0.9, x], 1)


def shaker(accent):
    t = np.arange(int(0.09 * SR)) / SR
    n = rng.normal(0, 1, len(t))
    n = n - np.convolve(n, np.ones(4) / 4, "same")
    n = np.convolve(n, np.ones(2) / 2, "same")  # take the fizz off the very top
    env = (1 - np.exp(-t * 400)) * np.exp(-t * 55)
    x = n * env * (0.22 if accent else 0.12)
    return np.stack([x * 0.7, x], 1)


# --- the tune -----------------------------------------------------------------
CH = {
    "C": ["C3", "G3", "C4", "E4", "G4"], "Am": ["A2", "E3", "A3", "C4", "E4"], "F": ["F2", "C3", "F3", "A3", "C4"],
    "G": ["G2", "D3", "G3", "B3", "D4"], "Dm": ["D3", "A3", "D4", "F4", "A4"], "Em": ["E3", "B3", "E4", "G4", "B4"],
    "G7": ["G2", "D3", "F3", "B3", "D4"],
}
ROOT = {"C": ("C2", "G2", "B1"), "Am": ("A1", "E2", "G#1"), "F": ("F1", "C2", "E2"), "G": ("G1", "D2", "F#1"),
        "Dm": ("D2", "A1", "C#2"), "Em": ("E2", "B1", "D#2"), "G7": ("G1", "D2", "B1")}


def mel(s):
    out = []
    for tok in s.split():
        p, d = tok.split(":")
        out.append((p, float(d)))
    return out


MEL_A = mel("""G4:.5 C5:.5 E5:1 D5:.5 C5:.5 D5:1  E5:1 C5:.5 A4:.5 C5:1.5 r:.5
              A4:.5 C5:.5 F5:1 E5:.5 D5:.5 C5:1  D5:1.5 B4:.5 G4:1 r:1
              G4:.5 C5:.5 E5:1 G5:.5 E5:.5 C5:1  A5:1 G5:.5 E5:.5 C5:1.5 r:.5
              F5:.5 E5:.5 D5:1 B4:.5 C5:.5 D5:1  C5:2 r:2""")
MEL_B = mel("""A5:.5 G5:.5 F5:.5 C5:.5 F5:.5 G5:.5 A5:1  D5:.5 G5:.5 B5:1 A5:.5 G5:.5 D5:1
              E5:.5 G5:.5 B5:1 G5:.5 E5:.5 B4:1  C5:.5 E5:.5 A5:1.5 r:.5 G5:.5 E5:.5
              F5:.5 A5:.5 D6:1 C6:.5 A5:.5 F5:1  G5:.5 B5:.5 D6:1 B5:.5 G5:.5 D5:1
              E5:.5 G5:.5 C6:1.5 B5:.5 A5:.5 G5:.5  F5:.5 E5:.5 D5:.5 B4:.5 G4:1 r:1""")
assert sum(d for _, d in MEL_A) == 32 and sum(d for _, d in MEL_B) == 32
PROG_A = ["C", "Am", "F", "G", "C", "Am", ("Dm", "G"), "C"]
PROG_B = ["F", "G", "Em", "Am", "Dm", "G", "C", "G7"]
RIFF = ["C5", "G4", "E5", "G4", "D5", "G4", "E5", "G5"]  # marimba ostinato, eighths

# sections: (name, bars, progression)
FORM = [("intro", 4, ["C", "C", "F", "G"]), ("A", 8, PROG_A), ("A2", 8, PROG_A), ("B", 8, PROG_B),
        ("break", 4, ["F", "G", "Em", "G7"]), ("A3", 8, PROG_A)]
TOTAL_BARS = sum(b for _, b, _ in FORM)
LENGTH = TOTAL_BARS * BAR

T = {k: Track(LENGTH, **v) for k, v in {
    "flute": dict(pan=0.0, gain=0.55, verb=0.28), "marimba": dict(pan=0.25, gain=0.75, verb=0.2),
    "steel": dict(pan=-0.3, gain=0.35, verb=0.25), "guitar": dict(pan=-0.35, gain=0.5, verb=0.15),
    "pizz": dict(pan=0.4, gain=0.42, verb=0.22), "bass": dict(pan=0.0, gain=0.9, verb=0.03),
    "glock": dict(pan=-0.2, gain=0.28, verb=0.35), "wood": dict(pan=0.45, gain=0.3, verb=0.15),
    "kick": dict(pan=0.0, gain=0.75, verb=0.0), "clap": dict(pan=0.05, gain=0.32, verb=0.25),
    "shaker": dict(pan=0.3, gain=0.8, verb=0.1),
}.items()}


def bar_chords(prog):
    for c in prog:
        yield (c, c) if isinstance(c, str) else c


def play_melody(tr, inst, m, start, vel=0.8, octave=0, ring=0.4):
    b = start
    for p, d in m:
        if p != "r":
            if octave:
                p = p[:-1] + str(int(p[-1]) + octave)
            note(tr, inst, p, b, d * 0.92, vel, ring)
        b += d


def strum(c, beat, vel, short=True):
    tones = CH[c][1:]
    for i, p in enumerate(tones):
        note(T["guitar"], "acoustic_guitar_nylon", p, beat, 0.22 if short else 1.6, vel * (0.85 + 0.05 * i),
             ring=0.05 if short else 0.6, jitter=0.002, offset=0.012 * i)  # strings ripple a few ms apart


bar0 = 0
for name, bars, prog in FORM:
    halves = list(bar_chords(prog))
    for i, (c1, c2) in enumerate(halves):
        b = (bar0 + i) * 4
        last = i == bars - 1
        full = name in ("A", "A2", "B", "A3")
        # drums
        if name != "break":
            if name != "intro" or i >= 2:
                note_k = kick()
                for kb in ([0, 2] if name == "intro" else [0, 1.5, 2] if i % 2 else [0, 2]):
                    T["kick"].add(note_k * (0.9 if kb == 0 else 0.7), swing(b + kb) * BEAT)
            if full:
                for cb in (1, 3):
                    T["clap"].add(clap(), swing(b + cb) * BEAT + rng.normal(0, 0.004))
            for s in range(16):
                if name == "intro" and i < 1 and s < 8:
                    continue
                T["shaker"].add(shaker(s % 4 == 2), swing(b + s / 4) * BEAT + rng.normal(0, 0.003))
            if full and i % 2 == 1:
                note(T["wood"], "woodblock", "C5", b + 3.5, 0.2, 0.7, 0.1)
                note(T["wood"], "woodblock", "G5", b + 3.75, 0.2, 0.5, 0.1)
        else:
            for s in range(0, 16, 2):
                T["shaker"].add(shaker(False) * 0.7, swing(b + s / 4) * BEAT)
        # bass: root, bounce to the fifth, walk into the next chord
        if name != "intro" or i >= 2:
            r1, f1, ap = ROOT[c1]
            r2, f2, _ = ROOT[c2]
            if name == "break":
                note(T["bass"], "acoustic_bass", r1, b, 1.8, 0.75, 0.2)
                note(T["bass"], "acoustic_bass", f1, b + 2, 1.8, 0.65, 0.2)
            else:
                note(T["bass"], "acoustic_bass", r1, b, 0.9, 0.85, 0.15)
                note(T["bass"], "acoustic_bass", f1, b + 1.5, 0.45, 0.6, 0.1)
                note(T["bass"], "acoustic_bass", r2, b + 2, 0.9, 0.8, 0.15)
                nxt = halves[i + 1][0] if i + 1 < len(halves) else "C"
                note(T["bass"], "acoustic_bass", ROOT[nxt][2], b + 3.5, 0.45, 0.6, 0.1)
        # guitar: off-beat "chk" on swung eighths, a long strum at section starts
        if name in ("A", "A2", "B", "A3"):
            if i == 0:
                strum(c1, b, 0.55, short=False)
            for ob in (0.5, 1.5, 2.5, 3.5):
                strum(c1 if ob < 2 else c2, b + ob, 0.42)
        if name == "break":
            strum(c1, b, 0.4, short=False)
            strum(c2, b + 2, 0.35, short=False)
        # marimba riff in intro / break, transposed to the chord
        if name in ("intro", "break") or (name == "A" and i % 4 == 3):
            shift = {"C": 0, "F": 5, "G": 7, "Em": 4, "G7": 7, "Am": 9, "Dm": 2}[c1]
            for k, p in enumerate(RIFF):
                m = midi(p) + (shift if shift < 6 else shift - 12)
                if name == "A" and k < 4:
                    continue
                note(T["marimba"], "marimba", NAMES[m % 12] + str(m // 12 - 1), b + k / 2, 0.45,
                     0.72 if k % 2 == 0 else 0.55, 0.3)
        # pizzicato arpeggios under the second A and the last A
        if name in ("A2", "A3", "break"):
            tones = CH[c1][2:] + CH[c2][2:][::-1]
            for k in range(8 if name != "break" else 4):
                note(T["pizz"], "pizzicato_strings", tones[k % len(tones)], b + k / 2 * (2 if name == "break" else 1),
                     0.4, 0.55 if k % 2 == 0 else 0.42, 0.3)
        # glockenspiel sparkle on chord changes
        if name in ("A2", "B", "A3") and i % 2 == 0:
            top = CH[c1][-1]
            m = midi(top) + 12
            note(T["glock"], "glockenspiel", NAMES[m % 12] + str(m // 12 - 1), b, 1, 0.6, 1.2)
            note(T["glock"], "glockenspiel", NAMES[(m + 7) % 12] + str((m + 7) // 12 - 1), b + 0.5, 1, 0.4, 1.2)
        # long sustained guitar on the last bar of the loop leads back into the intro
        if name == "A3" and last:
            strum("C", b + 2, 0.5, short=False)
    # melodies
    s = bar0 * 4
    if name == "A":
        play_melody(T["flute"], "flute", MEL_A, s, 0.75, ring=0.1)
    elif name == "A2":
        play_melody(T["marimba"], "marimba", MEL_A, s, 0.85, ring=0.4)
        play_melody(T["flute"], "flute", MEL_A, s, 0.45, ring=0.1)
    elif name == "B":
        play_melody(T["marimba"], "marimba", MEL_B, s, 0.85, ring=0.4)
        play_melody(T["steel"], "steel_drums", MEL_B, s, 0.7, octave=-1, ring=0.4)
    elif name == "A3":
        play_melody(T["flute"], "flute", MEL_A, s, 0.8, ring=0.1)
        play_melody(T["steel"], "steel_drums", MEL_A, s, 0.55, ring=0.4)
        play_melody(T["glock"], "glockenspiel", MEL_A, s, 0.25, octave=0, ring=0.6)
    bar0 += bars

TARGET = {"flute": -18, "marimba": -19, "steel": -27, "guitar": -24, "pizz": -26, "bass": -18, "glock": -29,
          "wood": -27, "kick": -21, "clap": -28, "shaker": -35}


def active_rms(x):
    """RMS in dB over the 50 ms frames where the track is actually playing."""
    m = x.mean(axis=1)
    fr = m[: len(m) // 2205 * 2205].reshape(-1, 2205)
    e = (fr ** 2).mean(axis=1)
    on = e > e.max() * 1e-4
    return 10 * np.log10(e[on].mean() + 1e-12)


for k, tr in T.items():
    tr.gain = 10 ** ((TARGET[k] - active_rms(tr.buf)) / 20)

# --- mix ----------------------------------------------------------------------
n = len(next(iter(T.values())).buf)
dry = np.zeros((n, 2))
send = np.zeros((n, 2))
for tr in T.values():
    l = np.cos((tr.pan + 1) * np.pi / 4) * np.sqrt(2)
    r = np.sin((tr.pan + 1) * np.pi / 4) * np.sqrt(2)
    x = tr.buf * tr.gain * np.array([l, r])
    dry += x
    send += x * tr.verb

# a short, bright plate-ish reverb: decaying stereo noise impulse response
ir_len = int(1.4 * SR)
t = np.arange(ir_len) / SR
ir = rng.normal(0, 1, (ir_len, 2)) * np.exp(-t * 4.2)[:, None]
for ch in range(2):  # soften the top so the tail stays warm
    ir[:, ch] = np.convolve(ir[:, ch], np.ones(6) / 6, "same")
ir[: int(0.012 * SR)] = 0  # predelay
ir /= np.sqrt((ir ** 2).sum(axis=0))
wet = np.stack([np.fft.irfft(np.fft.rfft(send[:, c], 2 * n) * np.fft.rfft(ir[:, c], 2 * n))[:n] for c in range(2)], 1)
mix = dry + wet * 0.9

# seamless loop: fold everything past the loop point back onto the start
L = int(LENGTH * SR)
tail = mix[L:]
mix = mix[:L].copy()
mix[: len(tail)] += tail

# gentle bus compression + soft clip, then level to about -1 dBFS peak
lvl = np.sqrt(np.convolve((mix ** 2).mean(axis=1), np.ones(2205) / 2205, "same"))
thr = np.percentile(lvl, 70)
g = np.where(lvl > thr, (thr / np.maximum(lvl, 1e-9)) ** 0.35, 1.0)
mix *= g[:, None]
mix /= np.abs(mix).max()
mix = np.tanh(mix * 1.3) / np.tanh(1.3) * 0.89

import wave
pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"{TOTAL_BARS} bars, {LENGTH:.2f}s -> {OUT}")

if __name__ == "__main__" and len(sys.argv) > 3:
    for k, tr in T.items():
        x = tr.buf[:L].mean(axis=1) * tr.gain
        S = np.abs(np.fft.rfft(x)) ** 2
        f = np.fft.rfftfreq(len(x), 1 / SR)
        tot = S.sum() + 1e-12
        print(f"{k:8s} gain {20*np.log10(tr.gain):5.1f} rms {10*np.log10((x**2).mean()+1e-12):6.1f} dB  >6k {100*S[f>6000].sum()/tot:5.1f}%")
