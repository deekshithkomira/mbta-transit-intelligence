# Short-Hop explainer video

A narrated 3D animation, about 90 seconds long, that explains the Short-Hop distance fare:

1. **Today:** Heath Street → Medford/Tufts (the whole Green Line E, about seven miles) costs $2.40, a fair price. Copley → Arlington (one stop, under half a mile) costs the same $2.40.
2. **The worst deal:** any rider going one stop pays the full fare, and some riders jump the gate or slip in behind someone who paid.
3. **The fix:** tap in and tap out, and Copley → Arlington costs $0.80.
4. **The rule:** the whole line costs $2.40, one stop costs $0.80, and every trip in between is priced by the miles you ride.
5. **Safeguards:**
   * **Two-gate check: sneaking in is no longer enough. You'd have to sneak out too.** Exit gates open only for a card or phone that tapped in.
   * A missing tap-out costs $2.40, today's fare.
   * Washington Metrorail already charges by distance, measured the same way (composite miles).
   * **Green Line street stops have no gates, so every door is a checkpoint:** tap at the door to board and to get down, and inspectors go where passenger counts and taps don't match.

Stations sit at their real coordinates (MBTA V3 API), distances come from the MBTA Rapid Transit Stop Distances dataset, and fares come from `mbta_ti.analysis.short_hop` (`route.json`).

## Sound

`audio.py` builds the soundtrack:

* **Narration:** ElevenLabs text-to-speech (US-English narrator "Brian", Turbo v2 model). "Copley" is passed as phonemes (K AA1 P L IY0) so it is always pronounced KOP-lee. The API key is read from `video/.env`, which is git-ignored (template: `.env.example`). Generated lines are cached, so re-renders use no extra credits. Offline fallback: `--tts say`.
* **Clean mix:** voice only while speaking, with no music or effects underneath; pauses are digital silence (optional music bed: `--music 0.2`).
* **Cues:** a soft gate beep, a price chime and the fare-ladder plucks, placed only in pauses.

It also writes `timing.json`, which stretches any scene whose narration needs more time and speeds up (down to 70%) any scene with less, so the picture and voice stay in sync and there are no long silences.

## Rebuild

```bash
cd video
npm install
../.venv/bin/python audio.py --tts elevenlabs      # narration + cues -> audio.wav, timing.json
node render.mjs --out short-hop-explainer.mp4     # 1920x1080 @ 30 fps, audio muxed in
node render.mjs --preview 12,30,52                # still frames at chosen seconds
```

Requirements: an ElevenLabs API key with Text to Speech access (or macOS `say`), Node 18+, Google Chrome and ffmpeg.
