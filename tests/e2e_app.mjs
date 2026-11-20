// End-to-end test of every Short-Hop app module in headless Chrome.
//   node tests/e2e_app.mjs http://localhost:8000/app/  [screenshot-dir]
// Uses puppeteer-core (video/node_modules) and the locally installed Google Chrome.
import { createRequire } from "node:module";
const require = createRequire(new URL("../video/package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

const URL_ = process.argv[2] || "http://localhost:8000/app/";
const SHOTS = process.argv[3];
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const errors = [];
let n = 0;
const ok = (cond, msg) => { if (!cond) throw new Error("FAILED: " + msg); console.log(`ok ${++n} - ${msg}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  defaultViewport: { width: 400, height: 860, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
const page = await browser.newPage();
page.on("pageerror", e => errors.push(e.message));
page.on("response", r => r.status() >= 400 && !/tile\.openstreetmap|api-v3\.mbta|favicon/.test(r.url()) && errors.push(`HTTP ${r.status()} ${r.url()}`));
// Wednesday 8:00am: peak fares regardless of when the test runs
await page.evaluateOnNewDocument(() => {
  if (!sessionStorage.getItem("booted")) { localStorage.clear(); sessionStorage.setItem("booted", "1"); }
  const fixed = new Date("2026-11-18T08:00:00").getTime(), RD = Date, t0 = RD.now();
  // eslint-disable-next-line no-global-assign
  Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed + RD.now() - t0])); } static now() { return fixed + RD.now() - t0; } };
});

const text = async sel => (await page.$eval(sel, el => el.innerText)).replace(/\s+/g, " ").trim();
const click = async sel => {       // scroll to centre first so the fixed tab bar never covers the target
  const h = await page.waitForSelector(sel, { visible: true });
  await h.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await h.click();
};
const shot = async name => { if (SHOTS) { await sleep(350); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const TITLES = { home: null, plan: "Plan a trip", ticket: null, activity: "Activity", wallet: "Wallet" };
const tab = async name => {        // switch tab and wait for that screen to render
  await click(`[data-tab="${name}"]`);
  await page.waitForFunction(n => location.hash === `#/${n}`, {}, name);
  if (TITLES[name]) await page.waitForFunction(t => document.querySelector("main .top h1")?.textContent === t, {}, TITLES[name]);
  await sleep(120);
};
const sheetText = () => text(".sheet-wrap:last-child .sheet");
const pick = async query => {      // station picker: search and choose the first match
  await page.waitForSelector("#st-q", { visible: true });
  await page.type("#st-q", query);
  await click(".st-row:not([disabled])");
  await page.waitForFunction(() => !document.querySelector("#st-q"));
};
const closeSheets = async () => { for (let i = 0; i < 3 && await page.$(".sheet-wrap"); i++) { await page.keyboard.press("Escape"); await sleep(250); } };

await page.goto(URL_, { waitUntil: "networkidle0" });

// ---------------------------------------------------------------- onboarding
ok(await page.$(".splash"), "splash screen shows on first launch");
await shot("01-splash");
await page.waitForSelector(".onb [data-next]");
ok((await text(".onb")).toLowerCase().includes("pay by distance"), "onboarding slide 1");
await shot("02-onboarding");
await click("[data-next]"); await click("[data-next]");
ok((await text(".onb")).toLowerCase().includes("never more than today"), "onboarding slide 3");
await click("[data-next]");
await page.waitForSelector("#setup");
await click('#setup button[type="submit"]');
ok((await text("#setup-err")).includes("first name"), "profile form validates the name");
await page.type('input[name="name"]', "Alex");
await page.type('input[name="email"]', "not-an-email");
await click('#setup button[type="submit"]');
ok((await text("#setup-err")).includes("email"), "profile form validates the email");
await page.$eval('input[name="email"]', el => (el.value = ""));
await shot("03-profile");
await click('#setup button[type="submit"]');
await click(".welcome [data-go]");
await page.waitForSelector(".sh-card");
ok((await text(".top h1")) === "Alex", "home greets the rider by name");
ok((await text("[data-balance]")) === "$0.00", "no joining bonus: balance starts at $0.00");
await page.waitForFunction(() => !document.querySelector("#alerts .skeleton"), { timeout: 15000 }).catch(() => {});
await shot("04-home");

// ---------------------------------------------------------------- inbox
ok((await text('[data-go="inbox"]')).includes("1"), "notification badge shows 1 unread");
await click('[data-go="inbox"]');
ok((await sheetText()).includes("Welcome to Short-Hop"), "inbox shows the welcome notification");
await closeSheets();

// ---------------------------------------------------------------- plan
await tab("plan");
await click('[data-pick="from"]'); await pick("Copley");
await click('[data-pick="to"]'); await pick("Medford");
await page.waitForFunction(() => document.querySelector("[data-fare]")?.textContent === "$1.80");
ok(true, "Copley → Medford/Tufts quotes $1.80 (74% of the whole Green Line E)");
ok((await text(".quote")).includes("You save $0.60"), "shows saving vs today's $2.40");
await click('[data-pick="from"]'); await pick("Heath");
await page.waitForFunction(() => document.querySelector("[data-fare]")?.textContent === "$2.40");
ok(true, "end to end of the line (Heath Street → Medford/Tufts) costs $2.40");
await click('[data-pick="from"]'); await pick("Copley");
await click('[data-act="fav"]');
ok(await page.$('[data-act="fav"][aria-pressed="true"]'), "route saved as favourite");
await page.$eval("details.breakdown", d => (d.open = true));
ok((await text("details.breakdown")).includes("Whole line"), "fare breakdown shows the share of the whole line");
await page.waitForFunction(() => !document.querySelector("#deps .skeleton"), { timeout: 15000 }).catch(() => {});
await shot("05-plan");

// ---------------------------------------------------------------- add money (no balance yet)
await click('[data-act="tapin"]');                 // $0 balance -> must add money first
await page.waitForSelector("#addcard");             // no card yet -> add-card sheet first
ok(true, "tapping in with $0 asks the rider to add money");
await page.type('#addcard [name="number"]', "4111 1111 1111 1111");
await page.type('#addcard [name="exp"]', "1230");
await page.type('#addcard [name="cvc"]', "123");
await click('#addcard button[type="submit"]');
ok((await text("#card-err")).includes("test card"), "a real-looking card number is refused (test cards only)");
await click("[data-fill]");
await shot("08-add-card");
await click('#addcard button[type="submit"]');
await page.waitForSelector("[data-pay]");           // top-up continues after adding the card
ok(true, "after adding a card the top-up sheet opens");
await click('[data-amt="20"]');
await shot("09-top-up");
await click("[data-pay]");
await page.waitForFunction(() => !document.querySelector("[data-pay]"), { timeout: 5000 });
await page.waitForFunction(() => JSON.parse(localStorage.getItem("shorthop.v2")).balance === 20, { timeout: 5000 });
ok(true, "adding $20 makes the balance $20.00");

// ---------------------------------------------------------------- ride
await click('[data-act="tapin"]');
await page.waitForSelector("#qr svg");
ok(true, "tap in shows a QR ticket");
ok((await text(".ticket")).includes("Medford/Tufts"), "ticket shows the planned destination");
await shot("06-ticket");
await click('[data-act="out"]'); await pick("Arlington");   // got off early
await page.waitForSelector(".receipt");
ok((await sheetText()).includes("$0.80"), "tapping out early at Arlington charges $0.80");
await shot("07-receipt");
await closeSheets();
ok((await text("[data-balance]")) === "$19.20", "balance is $19.20 after the trip");
ok((await text(".fav-list")).includes("Medford/Tufts"), "saved route appears on Home");

// ---------------------------------------------------------------- wallet & cards
await tab("wallet");
await click('[data-act="topup"]');                  // card already saved -> straight to amounts
await page.waitForSelector("[data-pay]");
await click('[data-amt="10"]');
await click("[data-pay]");
await page.waitForFunction(() => !document.querySelector("[data-pay]"), { timeout: 5000 });
await new Promise(r => setTimeout(r, 400));
await page.waitForFunction(() => document.querySelector("[data-balance]")?.textContent === "$29.20", { timeout: 5000 });
ok(true, "a second top-up of $10 makes the balance $29.20");
ok((await text("main")).includes("Visa •••• 4242"), "saved card is listed");
await click('[data-act="ar"]');
await page.waitForSelector('[data-ar="threshold"]');
ok(true, "auto-reload turns on with threshold and amount settings");
await shot("10-wallet");

// ---------------------------------------------------------------- missed tap-out
await tab("ticket");
await click('[data-act="in"]');
await click('[data-act="missed"]');
await click("[data-yes]");
await page.waitForSelector(".receipt");
ok((await sheetText()).includes("Missed tap-out") && (await sheetText()).includes("$2.40"), "missed tap-out charges $2.40");
await closeSheets();

// ---------------------------------------------------------------- weekly fare cap
await page.evaluate(() => {           // pretend $21.50 was already spent this week
  const s = JSON.parse(localStorage.getItem("shorthop.v2"));
  s.trips.push({ id: "SEED", from: "place-alfcl", to: "place-brntn", at: Date.now() - 3600e3, endAt: Date.now() - 3000e3,
    period: "peak", riderType: "regular", compositeMi: 16, fare: 18.9, charged: 18.9, saving: 0, status: "completed" });
  localStorage.setItem("shorthop.v2", JSON.stringify(s));
});
await page.reload({ waitUntil: "networkidle0" });
await tab("plan");
await click('[data-act="tapin"]');
await click('[data-act="out"]'); await pick("Medford");
await page.waitForSelector(".receipt");
const capReceipt = await sheetText();
ok(capReceipt.includes("Weekly fare cap applied") && capReceipt.includes("$0.40"), "weekly cap: a $1.80 trip costs only the $0.40 left under $22.50");
await shot("11-cap-receipt");
await closeSheets();

// ---------------------------------------------------------------- activity
await tab("activity");
ok((await text(".stats3")).includes("trips"), "activity shows monthly totals");
ok(await page.$(".chart .bar"), "activity shows the 14-day chart");
await shot("12-activity");
await click('[data-f="capped"]');
ok((await text("main")).includes("capped"), "filter: capped trips");
await click('[data-f="all"]');
await click("[data-trip]");
ok((await sheetText()).includes("Report a problem"), "trip detail opens a receipt with Report a problem");
await click("[data-report]");
await click('#rp button[type="submit"]');
await closeSheets();

// ---------------------------------------------------------------- account
await click('[data-go="home"]').catch(() => click('[data-tab="home"]'));
await click('.top [data-go="account"]');
await shot("13-account");
await click('[data-sub="rider"]');
await click('input[value="student"]');
await page.waitForSelector("[data-verify]");
await click("[data-verify]");
ok((await text("main")).includes("Verified"), "student rider type and eligibility verification");
await tab("plan");
await click('[data-pick="from"]'); await pick("Copley");
await click('[data-pick="to"]'); await pick("Medford");
await page.waitForFunction(() => document.querySelector("[data-fare]")?.textContent === "$0.90");
ok(true, "student reduced fare Copley → Medford/Tufts is $0.90");
await tab("home");
await click('.top [data-go="account"]');
await click('[data-sub="appearance"]');
await click('[data-theme="dark"]');
ok(await page.$eval("html", h => h.dataset.theme === "dark"), "dark theme applies");
await shot("14-dark");
await click('[data-theme="system"]');
await sleep(150);
await click("[data-back]");
await page.waitForFunction(() => document.querySelector("main .top h1")?.textContent === "Account");
await click('[data-sub="help"]');
await page.waitForSelector(".faq details");
await page.$eval(".faq details", d => (d.open = true));
ok((await text(".faq")).includes("tap out"), "help & FAQ");
await click("[data-back]");
await page.waitForFunction(() => document.querySelector("main .top h1")?.textContent === "Account");
await click('[data-sub="fares"]');
await page.waitForFunction(() => document.querySelector("main .top h1")?.textContent === "How fares work");
ok((await text("main")).includes("whole line") && (await text("main")).includes("Washington"), "fare rules page explains the rule");
await click("[data-back]");
await page.waitForFunction(() => document.querySelector("main .top h1")?.textContent === "Account");
await click('[data-sub="privacy"]');
await page.waitForFunction(() => document.querySelector("main .top h1")?.textContent === "Privacy & data");
ok((await text("main")).includes("only in this browser"), "privacy page");
await click("[data-back]");
await page.waitForFunction(() => document.querySelector("main .top h1")?.textContent === "Account");
await click('[data-act="signout"]');
await click("[data-yes]");
await page.waitForSelector(".onb");
ok(true, "sign out resets the app to onboarding");

ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(`all ${n} app checks passed`);
