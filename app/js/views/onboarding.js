import * as S from "../store.js";
import { esc, icon, logo, money } from "../ui.js";

const SLIDES = [
  { k: "Pay by distance", h: "One stop shouldn't cost the same as thirteen.",
    s: "Ride a line from one end to the other and you pay $2.40. Ride less, pay less — by the distance you actually travel.",
    art: `<svg viewBox="0 0 260 150"><path d="M20 110 C80 110 90 40 150 40 S 220 40 240 30" stroke="#00843d" stroke-width="10" fill="none" stroke-linecap="round"/>
      <circle cx="20" cy="110" r="13" fill="#fff" stroke="#13203a" stroke-width="5"/><circle cx="75" cy="96" r="9" fill="#fff" stroke="#13203a" stroke-width="4"/>
      <circle cx="240" cy="30" r="13" fill="#fff" stroke="#13203a" stroke-width="5"/>
      <rect x="44" y="122" width="62" height="24" rx="12" fill="#13a36f"/><text x="75" y="139" fill="#fff" font-size="14" font-weight="800" text-anchor="middle" font-family="Inter">$0.80</text>
      <rect x="196" y="48" width="62" height="24" rx="12" fill="#ffc72c"/><text x="227" y="65" fill="#13203a" font-size="14" font-weight="800" text-anchor="middle" font-family="Inter">$2.40</text></svg>` },
  { k: "Tap in, tap out", h: "Your phone is your ticket.",
    s: "Tap in at the gate, ride, and tap out where you get off. The fare is set by the distance you actually travel.",
    art: `<svg viewBox="0 0 260 150"><rect x="95" y="10" width="70" height="130" rx="14" fill="#13203a"/><rect x="104" y="26" width="52" height="52" rx="6" fill="#fff"/>
      <path d="M110 32h12v12h-12zM138 32h12v12h-12zM110 60h12v12h-12zM128 50h6v6h-6zM140 58h10v6h-10zM128 66h6v6h-6z" fill="#13203a"/>
      <rect x="110" y="92" width="40" height="8" rx="4" fill="#3ecf8e"/><path d="M40 75h40M180 75h40" stroke="#13a36f" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 12"/>
      <circle cx="30" cy="75" r="12" fill="#3ecf8e"/><circle cx="230" cy="75" r="12" fill="#ffc72c"/></svg>` },
  { k: "Never more than today", h: "End to end is $2.40. Never more.",
    s: "Long trips cost what they do now. Short hops cost less. And once you've spent a 7-day pass worth in a week, the rest of the week is free.",
    art: `<svg viewBox="0 0 260 150"><g font-family="Inter" font-weight="800">${[0.8, 1.2, 1.6, 2.0, 2.4, 2.4].map((f, i) =>
      `<rect x="${28 + i * 36}" y="${130 - f * 45}" width="26" height="${f * 45}" rx="6" fill="${f >= 2.4 ? "#13203a" : "#ffc72c"}"/>`).join("")}
      <path d="M18 22h226" stroke="#da291c" stroke-width="3" stroke-dasharray="7 6"/><text x="244" y="16" font-size="13" text-anchor="end" fill="#da291c">$2.40 cap</text></g></svg>` },
];

export function splash(root) {
  root.innerHTML = `<div class="splash">${logo(84)}<h1>Short-Hop</h1><p>Pay by distance</p></div>`;
}

export function onboarding(root, ctx) {
  let i = 0;
  const draw = () => {
    const s = SLIDES[i];
    root.innerHTML = `<div class="onb">
      <button class="link skip" data-skip>${i < SLIDES.length - 1 ? "Skip" : ""}</button>
      <div class="onb-art">${s.art}</div>
      <div class="eyebrow">${s.k}</div><h1>${s.h}</h1><p class="muted">${s.s}</p>
      <div class="pager">${SLIDES.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>
      <button class="btn big" data-next>${i < SLIDES.length - 1 ? "Next" : "Get started"}</button>
      <p class="fine">Concept app · demo money only · not affiliated with the MBTA</p></div>`;
    root.querySelector("[data-next]").onclick = () => (i < SLIDES.length - 1 ? (i++, draw()) : setup(root, ctx));
    root.querySelector("[data-skip]").onclick = () => setup(root, ctx);
  };
  draw();
}

function setup(root, ctx) {
  const p = S.get().profile;
  root.innerHTML = `<div class="onb setup">
    <h1>Create your profile</h1><p class="muted">Stored only on this device. No account or password needed.</p>
    <form id="setup" novalidate>
      <label class="field"><span>First name</span><input name="name" autocomplete="given-name" maxlength="30" value="${esc(p.name)}" placeholder="e.g. Alex" required></label>
      <label class="field"><span>Email for receipts <em>(optional)</em></span><input name="email" type="email" autocomplete="email" maxlength="60" value="${esc(p.email)}" placeholder="you@example.com"></label>
      <div class="field"><span>Rider type</span>
        <div class="choice-grid">${Object.entries(S.RIDER_TYPES).map(([k, r]) => `
          <label class="choice"><input type="radio" name="type" value="${k}" ${p.riderType === k ? "checked" : ""}><span><b>${r.label}</b><small>${r.note}</small></span></label>`).join("")}
        </div></div>
      <p class="err" id="setup-err" role="alert"></p>
      <button class="btn big" type="submit">Continue</button>
    </form></div>`;
  root.querySelector("#setup").onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get("name") || "").trim();
    const email = String(f.get("email") || "").trim();
    if (!name) return (root.querySelector("#setup-err").textContent = "Please enter your first name.");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return (root.querySelector("#setup-err").textContent = "That email doesn't look right.");
    S.update(s => { s.profile.name = name; s.profile.email = email; s.profile.riderType = f.get("type"); });
    welcome(root, ctx);
  };
}

function welcome(root, ctx) {
  root.innerHTML = `<div class="onb welcome">
    <div class="tick">${icon("check")}</div>
    <h1>You're all set, ${esc(S.get().profile.name)}!</h1>
    <p class="muted">We've added <b>${money(S.WELCOME_CREDIT)}</b> of demo credit so you can try a trip right away.</p>
    <div class="card mini-card">${icon("shield")}<span>Everything here is simulated. No real money is ever charged, and your data never leaves this browser.</span></div>
    <button class="btn big" data-go>Start riding</button></div>`;
  root.querySelector("[data-go]").onclick = () => {
    S.update(s => {
      s.onboarded = true;
      s.balance = S.WELCOME_CREDIT;
      s.ledger.unshift({ id: S.uid("T"), type: "credit", amount: S.WELCOME_CREDIT, at: Date.now(), meta: { note: "Welcome credit" } });
    });
    S.notify("Welcome to Short-Hop", `We added ${money(S.WELCOME_CREDIT)} of demo credit. Plan a trip to see your distance fare.`, "info");
    ctx.go("home");
  };
}
