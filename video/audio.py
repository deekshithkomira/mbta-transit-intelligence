"""Build the explainer's soundtrack and timing.

1. Synthesise the narration for each scene with macOS `say`.
2. Stretch any scene whose narration needs more time (timing.json: knots that map real
   time -> authored scene time; scene.js reads it, so picture and voice stay in sync).
3. Synthesise a soft music bed and sound effects at the moments they happen on screen.
4. Mix (music ducks under the voice) and write audio.wav.

Run with the project venv:  ../.venv/bin/python audio.py [--voice "Samantha"]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 48_000
HERE = Path(__file__).parent

# Authored scene boundaries (seconds on the 58 s design timeline).
BOUNDS = [0, 6, 14, 22, 30, 41.2, 49, 54.4, 58]
LINES = [
    "In Boston, one subway stop or thirteen stops costs exactly the same. "
    "Two dollars and forty cents.",
    "Copley to Arlington is one stop, about half a kilometer. You pay the full two forty.",
    "Copley to Medford Tufts is thirteen stops, almost ten kilometers. The same two forty.",
    "So for a short hop, the fare is the worst deal on the system. That's where students "
    "jump the gate, or slip through behind someone who paid.",
    "Short-Hop fixes the price, not just the gate. Book in the MBTA app, tap in at Copley, "
    "tap out at Arlington. Point six kilometers. Eighty cents.",
    "The fare follows real track distance. Ride the whole line, first stop to last, and you "
    "pay two forty. Copley to Medford Tufts drops to one sixty-eight. Ride less, pay less.",
    "Forget to tap out, and you're charged the full two forty, so cheating never pays. "
    "Hyderabad and Washington already price by distance.",
    "Pay by distance. Never more than today.",
]
LEAD = 0.5      # silence before each line inside its scene
TAIL = 0.9      # breathing room after each line


def tts(text: str, voice: str, rate: int) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        aiff, wav_path = Path(d) / "v.aiff", Path(d) / "v.wav"
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(aiff), "-ac", "1", "-ar", str(SR),
                        str(wav_path)], check=True)
        with wave.open(str(wav_path)) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    return x / 32768.0


def build_timing(durs: list[float]) -> tuple[list[list[float]], list[float]]:
    knots, starts, real = [[0.0, 0.0]], [], 0.0
    for i in range(len(BOUNDS) - 1):
        authored = BOUNDS[i + 1] - BOUNDS[i]
        need = durs[i] + LEAD + TAIL
        starts.append(real + LEAD)
        real += max(authored, need)
        knots.append([round(real, 3), BOUNDS[i + 1]])
    return knots, starts


def to_real(knots, t: float) -> float:
    for (ra, sa), (rb, sb) in zip(knots, knots[1:], strict=False):
        if t <= sb:
            return ra + (rb - ra) * (t - sa) / (sb - sa)
    return knots[-1][0]


# ------------------------------------------------------------------ synthesis
def env(n: int, a: float, r: float) -> np.ndarray:
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def tone(freq: float, dur: float, kind: str = "sine") -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    ph = 2 * np.pi * freq * t
    if kind == "square":
        return np.sign(np.sin(ph)) * 0.5
    if kind == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    return np.sin(ph)


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):            # one-pole IIR; fine for a few minutes of audio
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def music(total: float) -> np.ndarray:
    """Slow pad progression (Am - F - C - G) with a soft plucked arpeggio."""
    n = int(total * SR)
    out = np.zeros(n)
    chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63],
              [130.81, 196.0, 261.63], [196.0, 246.94, 293.66]]
    bar = 4.0
    k = 0
    while k * bar < total:
        ch = chords[k % 4]
        start, dur = int(k * bar * SR), bar + 1.0
        seg = np.zeros(int(dur * SR))
        for f in ch:
            for det in (0.997, 1.003):
                seg += tone(f * det, dur, "tri") * 0.12
            seg += tone(f / 2, dur) * 0.08
        seg *= env(len(seg), 1.2, 1.6)
        end = min(n, start + len(seg))
        out[start:end] += seg[:end - start]
        for j in range(8):                       # gentle arpeggio, eighth notes at 120 bpm
            f = ch[j % 3] * (2 if j % 4 == 3 else 1)
            p = tone(f * 2, 0.45) * np.exp(-np.arange(int(.45 * SR)) / SR * 7) * 0.05
            s0 = start + int(j * 0.5 * SR)
            e0 = min(n, s0 + len(p))
            if s0 < n:
                out[s0:e0] += p[:e0 - s0]
        k += 1
    return lowpass(out, 2400)


def whoosh(dur: float) -> np.ndarray:
    rng = np.random.default_rng(7)
    noise = lowpass(rng.standard_normal(int(dur * SR)), 900)
    t = np.linspace(0, 1, len(noise))
    shape = np.sin(np.pi * t) ** 1.5
    rumble = tone(55, dur) * 0.6 + tone(82, dur) * 0.3
    return (noise * 0.9 + rumble * 0.5) * shape


def beep_ok() -> np.ndarray:
    a = tone(1320, 0.11) * env(int(.11 * SR), .005, .03)
    b = tone(1760, 0.16) * env(int(.16 * SR), .005, .08)
    return np.concatenate([a, np.zeros(int(.03 * SR)), b]) * 0.5


def buzz() -> np.ndarray:
    d = 0.7
    x = tone(196, d, "square") * (0.6 + 0.4 * tone(9, d))
    return lowpass(x, 1800) * env(len(x), .01, .15) * 0.7


def ding() -> np.ndarray:
    d = 1.4
    t = np.arange(int(d * SR)) / SR
    return (np.sin(2 * np.pi * 988 * t) + .5 * np.sin(2 * np.pi * 2470 * t)) * np.exp(-t * 4) * 0.45


def pluck(f: float) -> np.ndarray:
    d = 0.5
    t = np.arange(int(d * SR)) / SR
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 9) * 0.35


def swell(dur: float) -> np.ndarray:
    x = sum(tone(f, dur, "tri") for f in (220, 277.18, 329.63, 440)) * 0.12
    return x * np.linspace(0, 1, len(x)) ** 2 * env(len(x), 0, .8)


def place(track: np.ndarray, clip: np.ndarray, at: float, gain: float = 1.0) -> None:
    s = int(at * SR)
    if s >= len(track):
        return
    e = min(len(track), s + len(clip))
    track[s:e] += clip[:e - s] * gain


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="Aman (English (India))")
    ap.add_argument("--rate", type=int, default=172)
    args = ap.parse_args()

    clips = [tts(line, args.voice, args.rate) for line in LINES]
    durs = [len(c) / SR for c in clips]
    knots, starts = build_timing(durs)
    total = knots[-1][0]
    (HERE / "timing.json").write_text(json.dumps({"knots": knots, "narration_starts": starts,
                                                  "voice": args.voice}, indent=1))
    n = int((total + 0.5) * SR)
    voice, sfx = np.zeros(n), np.zeros(n)
    for c, s in zip(clips, starts, strict=True):
        place(voice, c, s)

    R = lambda t: to_real(knots, t)  # noqa: E731
    place(sfx, whoosh(R(12) - R(7.5)), R(7.5), 0.35)          # Copley -> Arlington
    place(sfx, whoosh(R(20.6) - R(14.6)), R(14.6), 0.35)      # Copley -> Medford/Tufts
    place(sfx, beep_ok(), R(24.8), 0.6)                       # paying rider taps
    place(sfx, buzz(), R(26.0), 0.45)                         # student jumps the gate
    place(sfx, ding(), R(31.2), 0.5)                          # app shows $0.80
    place(sfx, beep_ok(), R(33.4), 0.7)                       # tap in accepted
    place(sfx, whoosh(R(40) - R(37)), R(37), 0.3)             # one-stop ride
    route = json.loads((HERE / "route.json").read_text())
    for i, st in enumerate(route["stations"][1:]):            # fare-ladder bars rising
        place(sfx, pluck(440 * (1 + st["fare"] / 2.4)), R(42 + i * 0.35), 0.5)
    place(sfx, swell(R(54.4) - R(52.4)), R(52.4), 0.6)        # end card

    bed = music(total + 0.5)
    # duck the music under the voice
    act = np.convolve(np.abs(voice), np.ones(int(.25 * SR)) / int(.25 * SR), mode="same")
    duck = 1 - 0.6 * np.clip(act / (act.max() * 0.15 + 1e-9), 0, 1)
    bed = bed[:n] * duck * 0.55
    fade = np.ones(n)
    fade[:int(1.5 * SR)] = np.linspace(0, 1, int(1.5 * SR))
    fade[-int(2.5 * SR):] = np.linspace(1, 0, int(2.5 * SR))
    mix = (voice * 1.0 + bed + sfx) * fade
    mix /= max(1e-9, np.abs(mix).max()) / 0.89                # peak ~ -1 dBFS
    stereo = np.stack([mix, mix], axis=1)
    with wave.open(str(HERE / "audio.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((stereo * 32767).astype(np.int16).tobytes())
    print(f"narration {sum(durs):.1f}s, video {total:.1f}s, wrote audio.wav + timing.json")


if __name__ == "__main__":
    main()
