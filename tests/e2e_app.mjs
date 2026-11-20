// End-to-end check of the Short-Hop rider app in headless Chrome.
//   node tests/e2e_app.mjs http://localhost:8000/app/  [screenshot-dir]
// Uses puppeteer-core from video/node_modules and the locally installed Google Chrome.
import { createRequire } from "node:module";
const require = createRequire(new URL("../video/package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

const URL_ = process.argv[2] || "http://localhost:8000/app/";
const SHOTS = process.argv[3];
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const errors = [];
const check = (cond, msg) => { if (!cond) throw new Error("FAILED: " + msg); console.log("ok -", msg); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  defaultViewport: { width: 400, height: 860, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const page = await browser.newPage();
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => m.type() === "error" && !/tile\.openstreetmap|favicon/.test(m.text()) && errors.push(m.text()));
// Wednesday 8:00am so the peak fare applies regardless of when the test runs
await page.evaluateOnNewDocument(() => {
  const fixed = new Date("2026-11-18T08:00:00").getTime(), RealDate = Date, start = RealDate.now();
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed + RealDate.now() - start])); }
    static now() { return fixed + RealDate.now() - start; } };
  localStorage.clear();
});
await page.goto(URL_, { waitUntil: "networkidle0" });
const text = sel => page.$eval(sel, el => el.textContent.replace(/\s+/g, " ").trim());
const shot = async name => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

check((await text("#balance-chip")) === "$20.00", "starts with $20.00 demo balance");
check((await text(".quote .big")) === "$0.80", "Copley → Arlington quotes $0.80");
await page.select("#to", "place-mdftf");
await page.waitForFunction(() => document.querySelector(".quote .big")?.textContent === "$1.20");
check(true, "Copley → Medford/Tufts quotes $1.20 (Washington model)");
check((await text(".quote")).includes("You save $1.20"), "shows saving vs $2.40");
check((await text(".rows")).includes("5.24 mi"), "shows 5.24 composite miles");
await shot("1-trip");

await page.click('[data-period="offpeak"]');
await page.waitForFunction(() => document.querySelector(".quote .big")?.textContent === "$0.90");
check(true, "night & weekend fare is $0.90");
await page.click('[data-period="auto"]');

await page.click("#tapin");
await page.waitForSelector("#qr svg");
check(true, "tap in shows a QR ticket");
check((await text(".ticket")).includes("Copley"), "ticket shows origin Copley");
await shot("2-ride");

await page.select("#exit", "place-armnl");          // got off early at Arlington
await page.click("#tapout");
await page.waitForSelector("#sheet:not([hidden])");
check((await text("#sheet")).includes("$0.80"), "tap out at Arlington charges $0.80");
await shot("3-receipt");
await page.click("#sheet [data-close]");
check((await text("#balance-chip")) === "$19.20", "balance is $19.20 after the trip");

await page.click('.tabs [data-go="history"]');
check((await text(".stats")).includes("$1.60"), "history shows $1.60 saved");
await shot("4-history");

await page.click('.tabs [data-go="wallet"]');
await page.click('input[value="student"]');
await page.click('.tabs [data-go="trip"]');
await page.waitForFunction(() => document.querySelector(".quote .big")?.textContent === "$0.60");
check(true, "student reduced fare Copley → Medford/Tufts is $0.60");

await page.click("#tapin");
await page.waitForSelector("#missed");
await page.click("#missed");
await page.waitForSelector("#sheet:not([hidden])");
check((await text("#sheet")).includes("$1.20"), "missed tap-out charges today's (reduced) fare $1.20");
await page.click("#sheet [data-close]");

await page.click('.tabs [data-go="fares"]');
check((await text("#view")).includes("Washington"), "fares tab explains the Washington model");
await shot("5-fares");
check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log("all app checks passed");
