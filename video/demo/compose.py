"""Compose the app walkthrough: phone recording + step captions on a 1080p canvas, voice
placed at each step's real start, QR end card.  Then join it after the explainer.

    ../../.venv/bin/python compose.py
Outputs: demo/short-hop-app-demo.mp4, ../short-hop-full.mp4 (explainer + demo) and
matching .srt caption files.
"""
from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import audio as A  # noqa: E402

W, H, FPS = 1920, 1080, 30
NAVY, NAVY2, YELLOW, GREEN, WHITE, MUTE = (11, 18, 32), (22, 36, 64), (255, 199, 44), (62, 207, 142), (238, 242, 248), (154, 166, 189)
F = "/System/Library/Fonts/HelveticaNeue.ttc"
font = lambda size, idx=0: ImageFont.truetype(F, size, index=idx)  # noqa: E731
BOLD = 1   # HelveticaNeue.ttc face index for Bold

steps = json.loads((HERE / "steps.json").read_text())["steps"]
timeline = json.loads((HERE / "timeline.json").read_text())
frames = json.loads((HERE / "frames.json").read_text())
END_HOLD = 2.2
total = max(timeline[s["key"]] for s in steps) + (steps[-1]["end"] - steps[-1]["start"]) + END_HOLD


def background() -> Image.Image:
    bg = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(bg)
    for y in range(H):                                   # vertical gradient
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY[i] * (1 - k) + NAVY2[i] * k) for i in range(3)))
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse((1150, -250, 1950, 550), fill=70)
    bg.paste(Image.new("RGB", (W, H), (60, 50, 10)), (0, 0), glow.filter(ImageFilter.GaussianBlur(160)))
    return bg


BG = background()
PHONE_H = 980
PHONE_W = int(PHONE_H * 390 / 844)
PX, PY = 1180, (H - PHONE_H) // 2


def phone_frame(screen: Image.Image) -> Image.Image:
    scr = screen.resize((PHONE_W, PHONE_H), Image.LANCZOS)
    mask = Image.new("L", (PHONE_W, PHONE_H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, PHONE_W, PHONE_H), radius=46, fill=255)
    out = Image.new("RGBA", (PHONE_W + 28, PHONE_H + 28), (0, 0, 0, 0))
    ImageDraw.Draw(out).rounded_rectangle((0, 0, PHONE_W + 27, PHONE_H + 27), radius=58, fill=(30, 36, 50, 255))
    out.paste(scr, (14, 14), mask)
    return out


def step_at(t: float) -> int:
    i = 0
    for j, s in enumerate(steps):
        if t >= timeline[s["key"]]:
            i = j
    return i


def caption_layer(i: int) -> Image.Image:
    s = steps[i]
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((140, 150), "SHORT-HOP · APP WALKTHROUGH", font=font(26, BOLD), fill=YELLOW)
    d.text((140, 400), f"{i + 1:02d}", font=font(30, BOLD), fill=GREEN)
    d.text((140, 440), s["title"], font=font(92, BOLD), fill=WHITE)
    d.text((140, 560), s["sub"], font=font(40), fill=MUTE)
    # progress
    n = len(steps)
    for j in range(n):
        x = 140 + j * 70
        d.rounded_rectangle((x, 880, x + 56, 888), radius=4, fill=YELLOW if j <= i else (60, 72, 96))
    d.text((140, 920), "Concept app · demo money only · not affiliated with the MBTA", font=font(24), fill=(110, 122, 148))
    return im


def end_card() -> Image.Image:
    im = BG.copy()
    d = ImageDraw.Draw(im)
    d.text((140, 200), "SHORT-HOP · A PROPOSAL FOR THE MBTA", font=font(30, BOLD), fill=YELLOW)
    d.text((140, 260), "A fair fare for Boston", font=font(110, BOLD), fill=WHITE)
    d.text((140, 440), "Whole line, end to end:", font=font(52), fill=MUTE)
    d.text((760, 440), "$2.40", font=font(52, BOLD), fill=YELLOW)
    d.text((140, 535), "One stop:", font=font(52), fill=MUTE)
    d.text((760, 535), "$0.80", font=font(52, BOLD), fill=GREEN)
    d.text((140, 630), "Every trip in between:", font=font(52), fill=MUTE)
    d.text((760, 630), "priced by distance", font=font(52, BOLD), fill=WHITE)
    d.text((140, 720), "Green Line street stops:", font=font(52), fill=MUTE)
    d.text((760, 720), "tap at every door, no gates in the road", font=font(52, BOLD), fill=WHITE)
    d.text((140, 830), "If the MBTA and the City of Boston adopted this, every short trip", font=font(40), fill=WHITE)
    d.text((140, 885), "would be fair, and far fewer people would have a reason to skip paying.", font=font(40), fill=WHITE)
    return im


def main() -> None:
    caps = [caption_layer(i) for i in range(len(steps))]
    fr_t = np.array([f["t"] for f in frames])
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                           "-pix_fmt", "yuv420p", str(HERE / "video_only.mp4")], stdin=subprocess.PIPE)
    end = end_card()
    rec_end = fr_t[-1]
    cache_name, cache_phone = None, None
    for k in range(int(total * FPS)):
        t = k / FPS
        if t > rec_end + 0.2 or step_at(t) == len(steps) - 1:
            # fade into the end card over 0.6 s
            t_out = timeline[steps[-1]["key"]]
            a = min(1.0, max(0.0, (t - t_out) / 0.6))
            base = None
            if a < 1:
                name = frames[int(np.abs(fr_t - min(t, rec_end)).argmin())]["name"]
                base = BG.copy(); base.paste(phone_frame(Image.open(HERE / "frames" / name).convert("RGB")), (PX - 14, PY - 14), phone_frame(Image.open(HERE / "frames" / name).convert("RGB")))
                base.paste(caps[-1], (0, 0), caps[-1])
                img = Image.blend(base, end, a)
            else:
                img = end
        else:
            name = frames[int(np.abs(fr_t - t).argmin())]["name"]
            if name != cache_name:
                ph = phone_frame(Image.open(HERE / "frames" / name).convert("RGB"))
                cache_name, cache_phone = name, ph
            img = BG.copy()
            img.paste(cache_phone, (PX - 14, PY - 14), cache_phone)
            c = caps[step_at(t)]
            img.paste(c, (0, 0), c)
        ff.stdin.write(img.tobytes())
    ff.stdin.close(); ff.wait()

    # ---------------------------------------------------------------- voice at real step times
    A.load_env()
    voice_id = A.os.environ.get("ELEVENLABS_VOICE_ID", A.DEFAULT_ELEVEN_VOICE)
    texts = [s["text"] for s in steps]
    track = np.zeros(int((total + 0.5) * A.SR))
    srt, LEAD = [], 0.35
    for i, s in enumerate(steps):
        clip = A.tts_eleven(s["text"], voice_id, texts[i - 1] if i else "", texts[i + 1] if i + 1 < len(texts) else "")
        at = timeline[s["key"]] + LEAD
        A.place(track, clip, at)
        srt.append((at, at + len(clip) / A.SR, s["text"]))
    track = A.highpass(track, 90)
    track /= max(1e-9, np.abs(track).max()) / 0.89
    st = np.stack([track, track], 1)
    with wave.open(str(HERE / "demo_voice.wav"), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(A.SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(HERE / "video_only.mp4"), "-i", str(HERE / "demo_voice.wav"),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest",
                    "-movflags", "+faststart", str(HERE / "short-hop-app-demo.mp4")], check=True)
    write_srt(HERE / "short-hop-app-demo.srt", srt)

    # ---------------------------------------------------------------- explainer + demo
    exp = HERE.parent / "short-hop-explainer.mp4"
    exp_dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(exp)],
                                   capture_output=True, text=True).stdout)
    full = HERE.parent / "short-hop-full.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(exp), "-i", str(HERE / "short-hop-app-demo.mp4"),
                    "-filter_complex", "[0:v]fps=30,format=yuv420p[v0];[1:v]fps=30,format=yuv420p[v1];"
                    "[0:a]aresample=48000[a0];[1:a]aresample=48000[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(full)], check=True)
    exp_srt = parse_srt(HERE.parent.parent / "linkedin" / "short-hop-explainer.srt")
    write_srt(HERE.parent / "short-hop-full.srt", exp_srt + [(a + exp_dur, b + exp_dur, t) for a, b, t in srt])
    print(f"demo {total:.1f}s, explainer {exp_dur:.1f}s -> {full.name}")


def ts(x: float) -> str:
    h, rem = divmod(x, 3600); m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)) % 1000:03d}"


def write_srt(path: Path, cues) -> None:
    path.write_text("\n".join(f"{i}\n{ts(a)} --> {ts(b)}\n{t}\n" for i, (a, b, t) in enumerate(cues, 1)))


def parse_srt(path: Path):
    out = []
    for block in path.read_text().strip().split("\n\n"):
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        a, b = lines[1].split(" --> ")
        sec = lambda s: int(s[:2]) * 3600 + int(s[3:5]) * 60 + float(s[6:].replace(",", "."))  # noqa: E731
        out.append((sec(a), sec(b), " ".join(lines[2:])))
    return out


if __name__ == "__main__":
    main()
