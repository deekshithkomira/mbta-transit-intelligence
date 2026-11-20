// Record the Short-Hop app walkthrough on a phone-sized screen.
//   node record.mjs [appUrl]
// Writes frames/NNNNN.jpg (with timestamps in frames.json) and timeline.json (actual start of
// each step).  Each step lasts at least as long as its narration line (steps.json).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

const URL_ = process.argv[2] || "http://localhost:8790/app/";
const HERE = new URL(".", import.meta.url).pathname;
const steps = JSON.parse(readFileSync(HERE + "steps.json")).steps;
const need = Object.fromEntries(steps.map(s => [s.key, s.end - s.start]));
rmSync(HERE + "frames", { recursive: true, force: true }); mkdirSync(HERE + "frames");

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new", defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  if (!sessionStorage.getItem("rec")) { localStorage.clear(); sessionStorage.setItem("rec", "1"); }
  const fixed = new Date("2026-11-18T08:00:00").getTime(), RD = Date, t0 = RD.now();
  // eslint-disable-next-line no-global-assign
  Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed + RD.now() - t0])); } static now() { return fixed + RD.now() - t0; } };
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ capture loop (~16 fps)
const frames = []; let recording = true, t0 = 0;
async function capture() {
  while (recording) {
    const t = (Date.now() - t0) / 1000;
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 88 });
      const name = String(frames.length).padStart(5, "0") + ".jpg";
      writeFileSync(`${HERE}frames/${name}`, buf); frames.push({ t, name });
    } catch { /* page navigating */ }
    await sleep(40);
  }
}

// ------------------------------------------------------------ helpers
async function ripple(x, y) {
  await page.evaluate((x, y) => {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;` +
      "background:rgba(255,199,44,.55);border:3px solid rgba(19,32,58,.55);z-index:99999;pointer-events:none;" +
      "transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.5);opacity:1";
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = "scale(1.5)"; d.style.opacity = "0"; });
    setTimeout(() => d.remove(), 600);
  }, x, y);
}
async function tap(sel, pause = 450) {
  const h = await page.waitForSelector(sel, { visible: true, timeout: 15000 });
  await h.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(120);
  const b = await h.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await ripple(x, y); await sleep(160);
  await h.evaluate(el => { el.focus?.(); el.click(); }); await sleep(pause);
}
async function typeIn(sel, text) { await tap(sel, 150); await page.keyboard.type(text, { delay: 70 }); }
async function scrollBy(dy, ms = 700) {
  const n = 14;
  for (let i = 0; i < n; i++) { await page.evaluate(d => window.scrollBy(0, d), dy / n); await sleep(ms / n); }
}
async function pick(q, after = 600) {
  await page.waitForSelector("#st-q", { visible: true });
  await sleep(200); await page.keyboard.type(q, { delay: 55 }); await sleep(350);
  await tap(".st-row:not([disabled])", after);
}

const timeline = {};
async function step(key, fn) {
  const start = (Date.now() - t0) / 1000;
  timeline[key] = start;
  await fn();
  const elapsed = (Date.now() - t0) / 1000 - start;
  if (elapsed < need[key]) await sleep((need[key] - elapsed) * 1000);
  console.log(`${key.padEnd(9)} ${start.toFixed(2)}s  (${Math.max(elapsed, need[key]).toFixed(2)}s)`);
}

// ------------------------------------------------------------ the walkthrough
await page.goto(URL_, { waitUntil: "networkidle0" });
await page.waitForSelector(".onb [data-next]", { timeout: 15000 });
t0 = Date.now(); const cap = capture();

await step("intro", async () => { await sleep(1200); await tap("[data-next]", 700); await tap("[data-next]", 700); });
await step("setup", async () => {
  await tap("[data-next]", 500);
  await typeIn('input[name="name"]', "Alex");
  await tap('input[value="regular"]', 300);
  await tap('#setup button[type="submit"]', 900);
  await tap(".welcome [data-go]", 600);
});
await step("home", async () => {
  await page.waitForFunction(() => !document.querySelector("#alerts .skeleton"), { timeout: 8000 }).catch(() => {});
  await sleep(1200); await scrollBy(420, 900); await sleep(900); await scrollBy(-420, 700);
});
await step("wallet", async () => {
  await tap('[data-tab="wallet"]', 450);
  await tap('[data-act="topup"]', 450);          // no card yet: add-card sheet first
  await tap("[data-fill]", 300);
  await tap('#addcard button[type="submit"]', 550);
  await tap('[data-amt="20"]', 300);
  await tap("[data-pay]", 900);
  await tap('[data-act="ar"]', 500);
});
await step("plan", async () => {
  await tap('[data-tab="plan"]', 600);            // a new rider's default trip: Copley -> Arlington
  await page.waitForFunction(() => document.querySelector("[data-fare]")?.textContent === "$0.80");
  await sleep(1500);
  await page.$eval("details.breakdown", d => (d.open = true));
  await scrollBy(330, 900); await sleep(1600); await scrollBy(-330, 600);
});
await step("tapin", async () => { await tap('[data-act="tapin"]', 1800); });
await step("tapout", async () => {
  await tap('[data-act="out"]', 400); await pick("Arlington");
  await page.waitForSelector(".receipt"); await sleep(1000);
  await tap(".sheet [data-close]", 500);
});
await step("activity", async () => { await tap('[data-tab="activity"]', 600); await sleep(800); await scrollBy(300, 800); });
await step("outro", async () => { await tap('[data-tab="home"]', 400); await sleep(400); });

recording = false; await cap;
writeFileSync(HERE + "frames.json", JSON.stringify(frames));
writeFileSync(HERE + "timeline.json", JSON.stringify(timeline, null, 1));
console.log(`${frames.length} frames, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
