# Short-Hop explainer video

A narrated 3D animation, about 70 seconds long, that explains the Short-Hop distance fare:

1. **Today:** Copley → Arlington (1 stop, 0.35 track miles) and Copley → Medford/Tufts (13 stops, 6.0 track miles) both cost $2.40.
2. **The loophole:** a student facing $2.40 for one stop jumps the gate behind a paying rider.
3. **The fix:** tap in and tap out with the Short-Hop app, and Copley → Arlington costs $0.80.
4. **The rule:** riding a line end to end costs $2.40, and shorter trips pay in proportion. Copley → Medford/Tufts is 74% of the Green Line E, so it costs $1.80. Short hops pay the $0.80 minimum.
5. **Safeguards:**
   * The exit tap sets the price.
   * A missing tap-out costs $2.40.
   * Washington Metrorail already charges by distance, measured the same way (composite miles).

Stations sit at their real coordinates (MBTA V3 API), distances come from the MBTA Rapid Transit Stop Distances dataset, and fares come from `mbta_ti.analysis.short_hop` (`route.json`).

## Sound

`audio.py` builds the soundtrack:

* **Narration:** ElevenLabs text-to-speech (US-English narrator "Brian", Turbo v2 model). "Copley" is passed as phonemes (K AA1 P L IY0) so it is always pronounced KOP-lee. The API key is read from `video/.env`, which is git-ignored (template: `.env.example`). Generated lines are cached, so re-renders use no extra credits. Offline fallback: `--tts say`.
* **Clean mix:** voice only while speaking, with no music or effects underneath; pauses are digital silence (optional music bed: `--music 0.2`).
* **Cues:** a soft gate beep, a price chime and the fare-ladder plucks, placed only in pauses.

It also writes `timing.json`, which stretches any scene whose narration needs more time, so the picture and voice stay in sync.

## Rebuild

```bash
cd video
npm install
../.venv/bin/python audio.py --tts elevenlabs      # narration + cues -> audio.wav, timing.json
node render.mjs --out short-hop-explainer.mp4     # 1920x1080 @ 30 fps, audio muxed in
node render.mjs --preview 12,30,52                # still frames at chosen seconds
```

Requirements: an ElevenLabs API key with Text to Speech access (or macOS `say`), Node 18+, Google Chrome and ffmpeg.
