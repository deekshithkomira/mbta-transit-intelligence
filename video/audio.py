"""Build the explainer's soundtrack and timing.

1. Synthesise the narration for each scene with ElevenLabs (natural US voice; key read from
   video/.env, never committed) or, offline, with macOS `say`.
2. Stretch any scene whose narration needs more time (timing.json: knots that map real
   time -> authored scene time; scene.js reads it, so picture and voice stay in sync).
3. Synthesise a soft music bed and sound effects at the moments they happen on screen.
4. Mix (music ducks under the voice) and write audio.wav.

Run with the project venv:
    ../.venv/bin/python audio.py --tts elevenlabs          # needs ELEVENLABS_API_KEY in video/.env
    ../.venv/bin/python audio.py --tts say --voice Samantha
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
import requests

SR = 48_000
HERE = Path(__file__).parent

# Authored scene boundaries (seconds on the 58 s design timeline).
BOUNDS = [0, 6, 14, 22, 30, 41.2, 49, 52, 54.4, 58]
LINES = [
    "In Boston, one subway stop or twenty four stops costs exactly the same. "
    "Two dollars and forty cents.",
    "Heath Street to Medford Tufts is the whole Green Line E, about seven miles. "
    "Two forty is a fair price for that.",
    "But Copley to Arlington is just one stop, less than half a mile, and it costs the same two forty. "
    "That doesn't make sense.",
    "Anyone riding just one stop pays the full two forty. It's the worst deal on the system. "
    "And every day, some riders jump the gate, or slip through behind someone who paid.",
    "Short-Hop fixes the price, not just the gate. Tap in at Copley, tap out at Arlington, "
    "and pay eighty cents.",
    "Here's the rule. The fare follows the distance. Ride the whole line, and you pay two forty. "
    "Ride one stop, and you pay eighty cents. Every trip in between is priced by the miles you ride.",
    "Add exit gates, and sneaking in is no longer enough. With no tap-in, the exit gate won't open, "
    "so you'd have to sneak out too. Skip the tap-out, and you pay the full two forty. "
    "Washington's Metro already works this way.",
    "But most Green Line street stops have no gates, and gates in the road would only back up traffic. "
    "So every door becomes the checkpoint. Tap at the door to board, and tap again to get down. "
    "Passenger counters show where riders skip paying, and inspectors go there. "
    "And at eighty cents, it takes a third as many checks to make skipping a bad bet.",
    "Pay by distance. Never more than today.",
]
# Words the synthesiser mispronounces, given as Apple phonemes: Copley = KOP-lee.
PRONOUNCE = {"Copley": "[[inpt PHON]]k1AApliy[[inpt TEXT]]"}
# ElevenLabs premade voice "Brian": deep, clear US-English narrator.
DEFAULT_ELEVEN_VOICE = "nPczCjzI2devNBz1zQrb"
LEAD = 0.3      # silence before each line inside its scene
TAIL = 0.45     # breathing room after each line
MIN_SCALE = 0.7  # a scene with less narration than animation plays faster, down to 70%, so no long silences


def _to_samples(src: Path) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        wav_path = Path(d) / "v.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", str(SR),
                        str(wav_path)], check=True)
        with wave.open(str(wav_path)) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    return x / 32768.0


def tts_say(text: str, voice: str, rate: int) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        aiff = Path(d) / "v.aiff"
        for word, phon in PRONOUNCE.items():
            text = text.replace(word, phon)
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text], check=True)
        return _to_samples(aiff)


def load_env() -> None:
    env_file = HERE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# Turbo v2 supports SSML <phoneme> tags, so names are pronounced exactly as written below.
ELEVEN_MODEL = "eleven_turbo_v2"
ELEVEN_PHONEMES = {"Copley": '<phoneme alphabet="cmu-arpabet" ph="K AA1 P L IY0">Copley</phoneme>'}
CACHE = HERE / ".tts_cache"          # avoids paying twice for unchanged lines (git-ignored)


def tts_eleven(text: str, voice_id: str, previous: str, following: str) -> np.ndarray:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY missing: put it in video/.env (see video/.env.example)")
    spoken = text
    for word, tag in ELEVEN_PHONEMES.items():
        spoken = spoken.replace(word, tag)
    body = {"text": spoken, "model_id": ELEVEN_MODEL,
            "previous_text": previous, "next_text": following,   # consistent prosody across lines
            "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15,
                               "use_speaker_boost": True}}
    digest = hashlib.sha256(json.dumps([voice_id, body], sort_keys=True).encode()).hexdigest()[:20]
    CACHE.mkdir(exist_ok=True)
    mp3 = CACHE / f"{digest}.mp3"
    if not mp3.exists():
        r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                          params={"output_format": "mp3_44100_128"},
                          headers={"xi-api-key": key, "accept": "audio/mpeg"}, json=body, timeout=120)
        if r.status_code != 200:
            raise SystemExit(f"ElevenLabs error {r.status_code}: {r.text[:300]}")
        mp3.write_bytes(r.content)
    x = _to_samples(mp3)
    # trim leading/trailing silence so timing stays tight
    idx = np.where(np.abs(x) > 0.01)[0]
    return x[max(0, idx[0] - 800): idx[-1] + 2400] if len(idx) else x


def build_timing(durs: list[float]) -> tuple[list[list[float]], list[float]]:
    knots, starts, real = [[0.0, 0.0]], [], 0.0
    for i in range(len(BOUNDS) - 1):
        authored = BOUNDS[i + 1] - BOUNDS[i]
        need = durs[i] + LEAD + TAIL
        starts.append(real + LEAD)
        real += max(authored * MIN_SCALE, need)
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


def highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lowpass(x, cutoff)


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
    ap.add_argument("--tts", choices=["elevenlabs", "say"], default="elevenlabs")
    ap.add_argument("--voice", default=None,
                    help="ElevenLabs voice_id (default: ELEVENLABS_VOICE_ID or a US narrator) "
                         "or a macOS say voice name")
    ap.add_argument("--rate", type=int, default=176)
    ap.add_argument("--music", type=float, default=0.0, help="music bed level in pauses (0 = none)")
    args = ap.parse_args()

    load_env()
    if args.tts == "elevenlabs":
        voice = args.voice or os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_ELEVEN_VOICE)
        clips = [tts_eleven(line, voice, LINES[i - 1] if i else "",
                            LINES[i + 1] if i + 1 < len(LINES) else "")
                 for i, line in enumerate(LINES)]
        args.voice = f"elevenlabs:{voice}"
    else:
        args.voice = args.voice or "Samantha"
        clips = [tts_say(line, args.voice, args.rate) for line in LINES]
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
    # Clean mix: only short tonal cues (no noise-based effects), and only in pauses.
    place(sfx, beep_ok(), R(24.8), 0.35)                      # paying rider taps
    place(sfx, ding(), R(31.2), 0.30)                         # app shows the fare
    place(sfx, beep_ok(), R(33.4), 0.40)                      # tap in accepted
    route = json.loads((HERE / "route.json").read_text())
    after = route["stations"][1:]                             # fare-ladder bars rising (from Heath Street)
    for i, st in enumerate(after):
        place(sfx, pluck(440 * (1 + st["fare"] / 2.4)), R(42 + i * 0.2), 0.25)

    # Voice activity (smoothed); cues and music are silenced while anyone is speaking.
    win = int(.12 * SR)
    act = np.convolve(np.abs(voice), np.ones(win) / win, mode="same")
    speaking = np.clip(act / (act.max() * 0.04 + 1e-9), 0, 1)
    gap = 1 - np.convolve(speaking, np.ones(int(.4 * SR)) / int(.4 * SR), mode="same").clip(0, 1)
    sfx *= gap
    bed = music(total + 0.5)[:n] * gap * args.music if args.music > 0 else np.zeros(n)

    voice = highpass(voice, 90)                               # strip low rumble
    fade = np.ones(n)
    fade[:int(0.3 * SR)] = np.linspace(0, 1, int(0.3 * SR))
    fade[-int(1.5 * SR):] = np.linspace(1, 0, int(1.5 * SR))
    mix = (voice + bed + sfx) * fade
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
