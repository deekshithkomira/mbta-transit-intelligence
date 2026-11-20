# Short-Hop explainer video

A narrated 3D animation, about 70 seconds long, that explains the Short-Hop distance fare (Washington Metrorail model):

1. **Today:** Copley → Arlington (1 stop, 0.35 track miles) and Copley → Medford/Tufts (13 stops, 6.0 track miles) both cost $2.40.
2. **The loophole:** a student facing $2.40 for one stop jumps the gate behind a paying rider.
3. **The fix:** tap in and tap out with the Short-Hop app, and Copley → Arlington costs $0.80.
4. **Washington model:** $0.80 covers the first 3 composite miles, +$0.16 a mile, maximum $2.40 (today's fare). Copley → Medford/Tufts costs $1.20.
5. **Safeguards:**
   * The exit tap sets the price.
   * A missing tap-out costs $2.40.
   * Washington Metrorail already charges this way ($2.25 base, $0.45 a mile, $6.75 maximum).

Stations sit at their real coordinates (MBTA V3 API), distances come from the MBTA Rapid Transit Stop Distances dataset, and fares come from `mbta_ti.analysis.short_hop` (`route.json`).

## Sound

`audio.py` builds the soundtrack:

* **Narration:** generated with macOS `say` in US English (voice "Samantha"; change with `--voice`). "Copley" is given as phonemes so it is pronounced KOP-lee.
* **Music:** a synthesised background bed that ducks under the voice.
* **Sound effects:** the train passing, a gate beep, a fare-evasion alarm, a price chime, and the fare-ladder bars rising.

It also writes `timing.json`, which stretches any scene whose narration needs more time, so the picture and voice stay in sync.

## Rebuild

```bash
cd video
npm install
../.venv/bin/python audio.py                      # narration + music + effects -> audio.wav, timing.json
node render.mjs --out short-hop-explainer.mp4     # 1920x1080 @ 30 fps, audio muxed in
node render.mjs --preview 12,30,52                # still frames at chosen seconds
```

Requirements: macOS (for `say`), Node 18+, Google Chrome and ffmpeg.
