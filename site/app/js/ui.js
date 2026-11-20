// Shared UI: icons, formatting, sheets, toasts, confirm dialogs, station picker.
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const money = x => (x < 0 ? "−$" : "$") + Math.abs(Math.round(x * 100) / 100).toFixed(2);
export const LINE_COLOR = { Red: "#da291c", Orange: "#ed8b00", Blue: "#003da5", Green: "#00843d", Mattapan: "#da291c" };
export const routeLine = r => r.startsWith("Green") ? "Green" : r;

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}
export const fmtDate = t => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
export const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

const P = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plan: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  ticket: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h3v3H8zM13 8h3M13 11h3M8 15h8"/>',
  activity: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 2 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  swap: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  cap: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="13.5" r=".8"/><circle cx="15" cy="13.5" r=".8"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
};
export const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;

export const logo = (size = 40) => `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#13203a"/>
  <path d="M9 27c4-10 9-13 13-13" stroke="#ffc72c" stroke-width="3.4" fill="none" stroke-linecap="round"/>
  <circle cx="9" cy="27" r="3.6" fill="#3ecf8e"/><circle cx="29" cy="14" r="3.6" fill="#ffc72c"/></svg>`;

export const lineDots = lines => `<span class="dots">${(lines || []).map(l => `<i style="background:${LINE_COLOR[l]}" title="${l} Line"></i>`).join("")}</span>`;

// ------------------------------------------------------------------ toast
export function toast(msg, kind = "") {
  const t = $("#toast");
  t.className = `toast show ${kind}`; t.textContent = msg;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = "toast"), 2600);
}

// ------------------------------------------------------------------ sheets
let sheetStack = [];
export function openSheet(html, { onClose, wide = false, label = "Panel" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet-backdrop"></div><section class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <div class="grab"></div><button class="icon-btn sheet-x" data-close aria-label="Close">${icon("close")}</button>${html}</section>`;
  document.body.appendChild(wrap);
  const prevFocus = document.activeElement;
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.classList.add("closing");
    setTimeout(() => wrap.remove(), 180);
    sheetStack = sheetStack.filter(s => s !== close);
    onClose && onClose();
    prevFocus?.focus?.();
  };
  wrap.querySelector(".sheet-backdrop").onclick = close;
  wrap.querySelectorAll("[data-close]").forEach(b => (b.onclick = close));
  sheetStack.push(close);
  setTimeout(() => (wrap.querySelector("input, select, button:not(.sheet-x)") || wrap.querySelector(".sheet")).focus(), 60);
  return { el: wrap.querySelector(".sheet"), close };
}
export const closeTopSheet = () => sheetStack.at(-1)?.();
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTopSheet(); });

export function confirmSheet({ title, body, ok = "Confirm", danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const { el, close } = openSheet(`<h2 class="sheet-title">${esc(title)}</h2><p class="muted">${body}</p>
      <div class="btn-row"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? "danger" : ""}" data-yes>${esc(ok)}</button></div>`,
      { onClose: () => !done && resolve(false), label: title });
    el.querySelector("[data-no]").onclick = () => { done = true; close(); resolve(false); };
    el.querySelector("[data-yes]").onclick = () => { done = true; close(); resolve(true); };
  });
}

// ------------------------------------------------------------------ station picker
export function pickStation({ net, title = "Choose a station", recent = [], exclude = null }) {
  const ST = net.graph.stations;
  const ids = Object.keys(ST).sort((a, b) => ST[a].name.localeCompare(ST[b].name));
  return new Promise(resolve => {
    let chosen = null;
    const { el, close } = openSheet(`<h2 class="sheet-title">${esc(title)}</h2>
      <label class="search">${icon("search")}<input id="st-q" type="search" placeholder="Search 125 stations" autocomplete="off" aria-label="Search stations"></label>
      <button class="row-btn" id="st-near">${icon("locate")}<span><b>Use my location</b><small>Find the nearest station</small></span></button>
      <div class="st-list" id="st-list" role="listbox"></div>`, { onClose: () => resolve(chosen), label: title });
    const list = el.querySelector("#st-list");
    const row = id => `<button class="st-row" role="option" data-id="${id}" ${id === exclude ? "disabled" : ""}>
      ${lineDots(ST[id].lines)}<span>${esc(ST[id].name)}</span><small>${ST[id].lines.join(" · ")}</small></button>`;
    const render = q => {
      const ql = q.trim().toLowerCase();
      const match = ids.filter(id => !ql || ST[id].name.toLowerCase().includes(ql) || ST[id].lines.some(l => l.toLowerCase().startsWith(ql)));
      const rec = !ql ? recent.filter(id => ST[id]) : [];
      list.innerHTML = (rec.length ? `<div class="st-head">Recent</div>${rec.map(row).join("")}<div class="st-head">All stations</div>` : "") +
        (match.length ? match.map(row).join("") : `<div class="empty small">No station matches “${esc(q)}”.</div>`);
    };
    render("");
    el.querySelector("#st-q").addEventListener("input", e => render(e.target.value));
    list.addEventListener("click", e => { const b = e.target.closest(".st-row"); if (b && !b.disabled) { chosen = b.dataset.id; close(); } });
    el.querySelector("#st-near").onclick = () => {
      if (!navigator.geolocation) return toast("Location isn't available in this browser");
      toast("Finding the nearest station…");
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: la, longitude: lo } = pos.coords;
        const d = id => (ST[id].lat - la) ** 2 + ((ST[id].lon - lo) * 0.74) ** 2;
        chosen = ids.filter(id => id !== exclude).sort((a, b) => d(a) - d(b))[0];
        close();
      }, () => toast("Location permission was declined"), { timeout: 8000 });
    };
  });
}

// ------------------------------------------------------------------ download helper
export function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
