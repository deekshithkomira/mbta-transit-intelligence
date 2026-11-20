// Short-Hop rider app — shell, router and boot sequence.
import * as S from "./store.js";
import { $, $$, icon } from "./ui.js";
import * as account from "./views/account.js";
import * as activity from "./views/activity.js";
import * as home from "./views/home.js";
import { onboarding, splash } from "./views/onboarding.js";
import * as plan from "./views/plan.js";
import * as ticket from "./views/ticket.js";
import * as wallet from "./views/wallet.js";

const TABS = [["home", "home", "Home"], ["plan", "plan", "Plan"], ["ticket", "ticket", "Ticket"], ["activity", "activity", "Activity"], ["wallet", "wallet", "Wallet"]];
const VIEWS = { home, plan, ticket, activity, wallet, account };
const view = $("#view"), tabs = $("#tabs");

const ctx = {
  plan: { from: null, to: null, period: "auto" },
  go(path) { if (location.hash !== `#/${path}`) location.hash = `#/${path}`; else route(); },
  refresh: () => route(),
  openTopUp: () => wallet.openTopUp(ctx),
  openCapInfo: () => wallet.openCapInfo(),
  openTrip(id) { const t = S.get().trips.find(x => x.id === id); if (t) ticket.openReceipt(t); },
  applySettings,
};

function applySettings() {
  const s = S.get().settings, root = document.documentElement;
  root.dataset.theme = s.theme === "system" ? "" : s.theme;
  if (s.theme === "system") delete root.dataset.theme;
  root.classList.toggle("large-text", !!s.largeText);
  root.classList.toggle("reduce-motion", !!s.reduceMotion);
  const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $('meta[name="theme-color"]').content = dark ? "#0b1220" : "#f3f5f9";
}

tabs.innerHTML = TABS.map(([r, ic, label]) => `<button data-tab="${r}" ${r === "ticket" ? 'class="center"' : ""}><span class="t-icon">${icon(ic)}</span><span>${label}</span></button>`).join("");
tabs.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) ctx.go(b.dataset.tab); });
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (!g || g.closest("#tabs")) return;
  e.preventDefault();
  if (g.dataset.go === "inbox") return account.openInbox(ctx);
  ctx.go(g.dataset.go);
});

let last = "";
function route() {
  const st = S.get();
  document.body.classList.toggle("onboarding", !st.onboarded);
  if (!st.onboarded) { tabs.hidden = true; return onboarding(view, ctx); }
  tabs.hidden = false;
  const [name, sub] = (location.hash.replace(/^#\//, "") || "home").split("/");
  const v = VIEWS[name] || home;
  const key = `${name}/${sub || ""}`;
  v.render(view, ctx, sub);
  $$("[data-tab]", tabs).forEach(b => {
    b.setAttribute("aria-current", b.dataset.tab === name ? "page" : "false");
    if (b.dataset.tab === "ticket") b.classList.toggle("riding", !!st.active);
  });
  if (key !== last) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); last = key; }
}
window.addEventListener("hashchange", route);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
setInterval(() => {   // keep "in progress" banners fresh without re-rendering everything
  const el = document.querySelector("[data-elapsed]");
  if (el) { const m = Math.floor((Date.now() - +el.dataset.elapsed) / 60000); el.textContent = `${m} min · tap to show your ticket`; }
}, 15000);

// boot: splash (skipped for returning riders and reduced motion), then route
applySettings();
const firstRun = !S.get().onboarded;
if (firstRun && !S.get().settings.reduceMotion && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  tabs.hidden = true; splash(view); setTimeout(route, 1300);
} else route();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
