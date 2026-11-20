# Short-Hop explainer video

A narrated 3D animation, about 70 seconds long, that explains the Short-Hop distance fare:

1. **Today:** Copley → Arlington (1 stop, 0.6 km) and Copley → Medford/Tufts (13 stops, 9.7 km) both cost $2.40.
2. **The loophole:** a student facing $2.40 for one stop jumps the gate behind a paying rider.
3. **The fix:** book in the app, tap in and tap out, and Copley → Arlington costs $0.80.
4. **Distance fare:** riding the whole Green Line E (13.8 km) costs $2.40. Copley → Medford/Tufts costs $1.68. Short hops pay the $0.80 minimum.
5. **Safeguards:**
   * The exit tap sets the price.
   * A missing tap-out costs $2.40.
   * Hyderabad Metro (₹11–₹69, 10 zones) and Washington Metrorail ($2.25–$6.75) already charge by distance.

Stations sit at their real coordinates (MBTA V3 API), distances come from the MBTA Rapid Transit Stop Distances dataset, and fares come from `mbta_ti.analysis.short_hop` (`route.json`).

## Sound

`audio.py` builds the soundtrack:

* **Narration:** generated with macOS `say` (voice "Aman", English (India); switch with `--voice "Samantha"`).
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
