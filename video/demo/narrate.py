"""Narration for the Short-Hop app walkthrough (ElevenLabs, same voice as the explainer).

Writes demo/steps.json (one entry per step: caption, narration, start/end seconds) and
demo/voice.wav.  The recorder holds each step for exactly its narration, so voice and
screen stay in sync.   Run:  ../../.venv/bin/python narrate.py
"""
from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import audio as A  # noqa: E402  (explainer's TTS helpers: ElevenLabs, phonemes, cache)

STEPS = [
    ("intro", "Short-Hop", "Pay by distance on the MBTA",
     "This is Short-Hop, the transit app that charges by distance."),
    ("setup", "Set up in seconds", "Name · fare type · starts at $0",
     "Setup takes seconds. Add your name and pick your fare type. There's no sign-up bonus. You start at zero."),
    ("home", "Home", "Balance · weekly fare cap · live alerts",
     "Home shows your balance, your weekly fare cap, and live MBTA service alerts."),
    ("wallet", "Add money", "Saved card · auto-reload",
     "Add a card, top up your balance, and turn on auto-reload so you're never stuck at the gate."),
    ("plan", "Plan a trip", "Copley to Arlington = $0.80",
     "Plan a trip. Copley to Arlington is one stop, about three percent of the line, so it's eighty cents, "
     "not two forty. Ride the whole line, and it's two forty, never more."),
    ("tapin", "Tap in", "Your phone is the ticket",
     "Tap in, and your phone becomes the ticket. The QR code refreshes every thirty seconds."),
    ("tapout", "Tap out", "Copley to Arlington = $0.80",
     "Tap out at Arlington, and you pay eighty cents. The fare follows the distance."),
    ("activity", "Activity", "What you saved vs the flat fare",
     "Every trip shows what you saved compared with the flat fare."),
    ("outro", "A fair fare for Boston", "A proposal for the MBTA",
     "If the MBTA and the City of Boston adopted this, every short trip would finally be fair."),
]
GAP = 0.55     # pause after each line
LEAD = 0.35


def main() -> None:
    A.load_env()
    voice_id = A.os.environ.get("ELEVENLABS_VOICE_ID", A.DEFAULT_ELEVEN_VOICE)
    texts = [s[3] for s in STEPS]
    clips = [A.tts_eleven(t, voice_id, texts[i - 1] if i else "", texts[i + 1] if i + 1 < len(texts) else "")
             for i, t in enumerate(texts)]
    t, out, steps = LEAD, [], []
    for (key, title, sub, text), c in zip(STEPS, clips, strict=True):
        dur = len(c) / A.SR
        steps.append({"key": key, "title": title, "sub": sub, "text": text,
                      "start": round(t - LEAD if not steps else t, 3), "voice_at": round(t, 3),
                      "end": round(t + dur + GAP, 3)})
        t += dur + GAP
    total = t + 0.4
    track = np.zeros(int(total * A.SR))
    for s, c in zip(steps, clips, strict=True):
        A.place(track, c, s["voice_at"])
    track = A.highpass(track, 90)
    track /= max(1e-9, np.abs(track).max()) / 0.89
    st = np.stack([track, track], 1)
    with wave.open(str(HERE / "voice.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(A.SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())
    (HERE / "steps.json").write_text(json.dumps({"total": round(total, 3), "steps": steps}, indent=1))
    print(f"{len(steps)} steps, {total:.1f}s")
    for s in steps:
        print(f"  {s['key']:9} {s['start']:6.2f} -> {s['end']:6.2f}  {s['title']}")


if __name__ == "__main__":
    main()
