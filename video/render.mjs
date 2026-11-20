// Render scene.html frame-by-frame with headless Chrome and encode an MP4 with ffmpeg.
//   node render.mjs [--fps 30] [--out short-hop.mp4] [--preview 12,24,33]
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) =>
  v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a, []));
const FPS = Number(args.fps || 30);
const OUT = resolve(args.out || "short-hop.mp4");
const ROOT = resolve(".");
const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json" };
const server = createServer((req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" });
  createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on("pageerror", e => console.error("page error:", e.message));
page.on("console", m => m.type() === "error" && console.error("console:", m.text()));
await page.goto(`http://localhost:${port}/scene.html`, { waitUntil: "networkidle0" });
await page.waitForFunction("window.sceneReady === true", { timeout: 30000 });
const duration = await page.evaluate("window.DURATION");

if (args.preview) {
  for (const t of args.preview.split(",").map(Number)) {
    await page.evaluate(x => window.renderAt(x), t);
    await page.screenshot({ path: `preview-${t}.jpg`, type: "jpeg", quality: 85 });
  }
} else {
  // audio.wav (narration + music + effects) comes from `python audio.py`; muxed if present
  const audio = existsSync(join(ROOT, "audio.wav"))
    ? ["-i", join(ROOT, "audio.wav"), "-c:a", "aac", "-b:a", "192k", "-shortest"] : [];
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS),
    "-i", "-", ...audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
    "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(duration * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(x => window.renderAt(x), f / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
    if (f % 150 === 0) console.log(`frame ${f}/${frames}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on("close", r));
  console.log("wrote", OUT);
}
await browser.close();
server.close();
