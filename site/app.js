/* MBTA Transit Intelligence — dashboard. All data comes from ./data/*.json, produced by the pipeline. */
const C = { red: "#DA291C", orange: "#ED8B00", blue: "#2f6fe0", green: "#00843D", silver: "#9aa4b2",
  cr: "#a0479a", bus: "#ffc72c", ferry: "#00a6c8", ink: "#e8ecf3", mute: "#8b95a9", line: "#232b3d",
  good: "#3ecf8e", bad: "#ff5d5d", accent: "#ffc72c" };
const LINE_COLOR = { "Red Line": C.red, "Orange Line": C.orange, "Blue Line": C.blue, "Green Line": C.green,
  "Silver Line": C.silver, "Bus": C.bus, "Commuter Rail": C.cr, "Ferry": C.ferry,
  Red: C.red, Orange: C.orange, Blue: C.blue };
const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x, d = 1) => x == null ? "—" : (x * 100).toFixed(d) + "%";
const charts = [];

function chart(id, option) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = echarts.init(el, null, { renderer: "canvas" });
  c.setOption(Object.assign({
    backgroundColor: "transparent",
    textStyle: { fontFamily: "Inter", color: C.mute },
    grid: { left: 56, right: 18, top: 30, bottom: 34, containLabel: false },
    tooltip: { trigger: "axis", backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  }, option));
  charts.push(c);
  return c;
}
const axis = (extra = {}) => Object.assign({ axisLine: { lineStyle: { color: C.line } },
  splitLine: { lineStyle: { color: "#1a2131" } }, axisLabel: { color: C.mute } }, extra);
window.addEventListener("resize", () => charts.forEach(c => c.resize()));

async function load(name) { const r = await fetch(`data/${name}.json`); return r.json(); }

function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0; const out = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

function baseMap(id, net) {
  const m = L.map(id, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    .setView([42.355, -71.08], 12);
  // No basemap tiles: the network itself (MBTA V3 API shapes) is the map. This keeps the
  // site dependency-free and avoids third-party tile keys.
  m.attributionControl.addAttribution("Network geometry: MBTA V3 API");
  net.routes.forEach(r => {
    const longest = r.polylines.map(decodePolyline).sort((a, b) => b.length - a.length).slice(0, 2);
    longest.forEach(pts => L.polyline(pts, { color: r.color, weight: 3, opacity: .45 }).addTo(m));
  });
  return m;
}

function findings(meta) {
  document.querySelectorAll(".findings").forEach(el => {
    el.innerHTML = (meta.findings[el.dataset.f] || []).map(f => `<div class="f">${f}</div>`).join("");
  });
  document.getElementById("sources").innerHTML = meta.sources
    .map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></li>`).join("");
  document.getElementById("gen").textContent = `Data refreshed ${meta.generated_at.slice(0, 10)} (UTC).`;
}

function kpis(rd, sz, ex, fi) {
  const red = rd.trailing_recovery.find(d => d.line === "Red Line");
  const y = Object.fromEntries(sz.delay_yearly.map(d => [d.year, d.rider_hours]));
  const peak = sz.system_daily.reduce((a, b) => (b.miles > a.miles ? b : a));
  const eq = ex.fare_equity.systemwide;
  const items = [
    [pct(red.recovery, 0), "Red Line weekday ridership vs. 2019 (last 12 months)", C.red],
    [fmt(peak.miles, 1) + " mi", `slow-zone peak (${peak.calendar_date}) → near zero today`, C.orange],
    [fmt((y[2023] - y[2025]) / 1e6, 1) + "M", "rider-hours of delay eliminated, 2023 → 2025", C.good],
    [pct(eq.low_income, 0), `of riders are low-income, but only ${pct(eq.any_reduced_fare, 0)} use a reduced fare`, C.accent],
    ["$" + fmt(fi.revenue_scenarios[0].revenue_at_risk_usd / 1e6, 0) + "–" + fmt(fi.revenue_scenarios.at(-1).revenue_at_risk_usd / 1e6, 0) + "M",
      "annual subway fare at risk under published evasion-rate scenarios", C.bad],
  ];
  document.getElementById("kpis").innerHTML = items
    .map(([v, l, c]) => `<div class="kpi" style="--c:${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
}

function ridership(rd, st, net) {
  const lines = ["Red Line", "Orange Line", "Blue Line", "Green Line", "Bus", "Commuter Rail", "Silver Line"];
  chart("c-recovery", {
    legend: { textStyle: { color: C.mute }, top: 0, type: "scroll" },
    xAxis: axis({ type: "time" }),
    yAxis: axis({ type: "value", axisLabel: { color: C.mute, formatter: v => (v * 100) + "%" }, max: 1.3 }),
    series: lines.map(l => ({ name: l, type: "line", showSymbol: false, lineStyle: { width: 1.8 },
      color: LINE_COLOR[l], data: rd.lines.filter(d => d.line === l && d.month >= "2019-01-01" && d.recovery_vs_2019 != null)
        .map(d => [d.month, d.recovery_vs_2019]) })),
    tooltip: { trigger: "axis", valueFormatter: v => pct(v) , backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const hist = rd.system.filter(d => d.month >= "2021-01-01");
  chart("c-forecast", {
    xAxis: axis({ type: "time" }),
    yAxis: axis({ type: "value", axisLabel: { color: C.mute, formatter: v => (v / 1e6).toFixed(1) + "M" }, scale: true }),
    series: [
      { name: "Actual", type: "line", showSymbol: false, color: C.ink, data: hist.map(d => [d.month, d.riders]) },
      { name: "lo", type: "line", stack: "band", showSymbol: false, lineStyle: { opacity: 0 }, data: rd.forecast.map(d => [d.month, d.lo80]) },
      { name: "80% interval", type: "line", stack: "band", showSymbol: false, lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(255,199,44,.18)" }, data: rd.forecast.map(d => [d.month, d.hi80 - d.lo80]) },
      { name: "Forecast", type: "line", showSymbol: false, color: C.accent, lineStyle: { type: "dashed", width: 2 },
        data: rd.forecast.map(d => [d.month, d.forecast]) },
    ],
    tooltip: { trigger: "axis", formatter: ps => ps.filter(p => p.seriesName !== "lo" && p.seriesName !== "80% interval")
      .map(p => `${p.seriesName}: ${fmt(p.value[1])}`).join("<br>"), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  document.getElementById("bt-note").textContent = "Rolling-origin backtest (12 origins × 1–6 month horizons), MAPE: " +
    rd.backtest_scores.map(s => `${s.model.replace("_", " ")} ${pct(s.mape)}`).join(" · ") + `. Published model: ${rd.forecast_model.replace("_", " ")}.`;

  const m = baseMap("m-stations", net);
  const col = r => r < .55 ? C.bad : r < .7 ? C.orange : r < .85 ? C.accent : C.good;
  st.recovery.filter(s => s.lat && !s.fare_collection_changed).forEach(s => {
    L.circleMarker([s.lat, s.lon], { radius: 3 + Math.sqrt(s.recent) / 9, color: col(s.recovery), weight: 1,
      fillOpacity: .55 }).bindPopup(`<b>${s.station}</b><br>${s.lines}<br>${fmt(s.recent)} weekday taps<br>${pct(s.recovery)} of 2019`).addTo(m);
  });
}

function slowZones(sz, net) {
  const m = baseMap("m-slow", net);
  const layer = L.layerGroup().addTo(m);
  // Snap each restriction to the real track: find the route shape on its line whose
  // vertices lie closest to both endpoint stations, and draw that sub-path.
  const prefix = { "Red Line": "Red", "Orange Line": "Orange", "Blue Line": "Blue", "Green Line": "Green", "Mattapan Line": "Mattapan" };
  const shapes = {};
  net.routes.forEach(r => r.polylines.forEach(p => {
    const key = Object.values(prefix).find(k => r.id.startsWith(k));
    (shapes[key] = shapes[key] || []).push(decodePolyline(p));
  }));
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * 0.74) ** 2;
  const nearest = (pts, q) => pts.reduce((best, p, i) => { const d = d2(p, q); return d < best[1] ? [i, d] : best; }, [0, Infinity]);
  const seg = z => {
    const ids = (z.stop_ids || "").split("|").map(s => s.trim()).filter(Boolean);
    const stops = ids.map(i => net.stops[i]).filter(Boolean).map(s => [s.lat, s.lon]);
    if (!stops.length) return null;
    if (stops.length === 1) return [stops[0]];
    let best = null;
    for (const pts of shapes[prefix[z.line]] || []) {
      const [i, di] = nearest(pts, stops[0]), [j, dj] = nearest(pts, stops.at(-1));
      if (!best || di + dj < best.cost) best = { cost: di + dj, path: pts.slice(Math.min(i, j), Math.max(i, j) + 1) };
    }
    // ~300 m tolerance; otherwise fall back to the station markers only
    return best && best.cost < 2e-5 && best.path.length > 1 ? best.path : [stops[0]];
  };
  const zones = sz.zones.map(z => ({ ...z, pts: seg(z) })).filter(z => z.pts);
  const days = sz.system_daily.map(d => d.calendar_date);
  const slider = document.getElementById("sz-date");
  slider.max = days.length - 1;
  const lineCol = { "Red Line": C.red, "Orange Line": C.orange, "Blue Line": C.blue, "Green Line": C.green };
  function draw(i) {
    const d = days[i], s = sz.system_daily[i];
    layer.clearLayers();
    zones.filter(z => z.first_day <= d && z.last_day >= d).forEach(z => {
      if (z.pts.length === 1) L.circleMarker(z.pts[0], { radius: 7, color: lineCol[z.line], weight: 3, fillOpacity: .2 }).addTo(layer);
      else L.polyline(z.pts, { color: lineCol[z.line], weight: 9, opacity: .9 }).addTo(layer);
    });
    document.getElementById("sz-label").textContent = `${d} · ${s.zones} restrictions · ${s.miles.toFixed(2)} mi`;
  }
  slider.addEventListener("input", () => draw(+slider.value));
  let timer = null;
  document.getElementById("sz-play").onclick = e => {
    if (timer) { clearInterval(timer); timer = null; e.target.textContent = "▶ Play"; return; }
    e.target.textContent = "❚❚ Pause";
    if (+slider.value >= days.length - 1) slider.value = 0;
    timer = setInterval(() => { slider.value = +slider.value + 4; draw(+slider.value);
      if (+slider.value >= days.length - 1) { clearInterval(timer); timer = null; e.target.textContent = "▶ Play"; } }, 40);
  };
  const peakIdx = sz.system_daily.reduce((bi, d, i, a) => d.miles > a[bi].miles ? i : bi, 0);
  slider.value = peakIdx; draw(peakIdx);

  const byLine = ["Red Line", "Orange Line", "Green Line", "Blue Line"];
  chart("c-sz", {
    legend: { textStyle: { color: C.mute }, top: 0 },
    xAxis: axis({ type: "time" }), yAxis: axis({ type: "value", name: "miles", nameTextStyle: { color: C.mute } }),
    series: byLine.map(l => ({ name: l, type: "line", stack: "t", showSymbol: false, areaStyle: { opacity: .8 },
      lineStyle: { width: 0 }, color: lineCol[l],
      data: sz.by_line_daily.filter(d => d.line === l).map(d => [d.calendar_date, d.restricted_miles]) })),
    tooltip: { trigger: "axis", valueFormatter: v => fmt(v, 2) + " mi", backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  chart("c-delay", {
    legend: { textStyle: { color: C.mute }, top: 0 },
    xAxis: axis({ type: "time" }),
    yAxis: axis({ type: "value", axisLabel: { color: C.mute, formatter: v => (v / 1e3) + "k" } }),
    series: ["Red", "Orange", "Blue"].map(l => ({ name: l + " Line", type: "bar", stack: "d", color: LINE_COLOR[l],
      data: sz.delay_monthly.filter(d => d.line === l).map(d => [d.month, Math.max(0, d.excess_rider_hours)]) })),
    tooltip: { trigger: "axis", valueFormatter: v => fmt(v) + " rider-hrs", backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  chart("c-km", {
    legend: { textStyle: { color: C.mute }, top: 0 },
    xAxis: axis({ type: "value", name: "days since reported", nameLocation: "middle", nameGap: 24, max: 365 }),
    yAxis: axis({ type: "value", max: 1, axisLabel: { color: C.mute, formatter: v => v * 100 + "%" } }),
    series: sz.survival.map(s => ({ name: s.line, type: "line", step: "end", showSymbol: false, color: lineCol[s.line],
      data: s.points.map(p => [p.days, p.survival]) })),
    tooltip: { trigger: "axis", valueFormatter: v => pct(v), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const r = sz.regression;
  chart("c-reg", {
    xAxis: axis({ type: "value", name: "% of line track restricted", nameLocation: "middle", nameGap: 24 }),
    yAxis: axis({ type: "value", name: "excess min / trip", nameTextStyle: { color: C.mute } }),
    series: ["Red", "Orange", "Blue"].map(l => ({ name: l, type: "scatter", symbolSize: 7, color: LINE_COLOR[l],
      data: sz.regression_panel.filter(d => d.line === l).map(d => [d.restricted_pct, d.excess_min_per_rider, d.month]) })),
    tooltip: { trigger: "item", formatter: p => `${p.seriesName} ${p.value[2].slice(0, 7)}<br>${p.value[0].toFixed(1)}% restricted · ${p.value[1].toFixed(2)} min`,
      backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  document.getElementById("reg-note").textContent = `OLS with line fixed effects, HC1 errors: +${r.coef_min_per_pct.toFixed(3)} min per trip per 1% restricted ` +
    `(95% CI ${r.ci_lo.toFixed(3)}–${r.ci_hi.toFixed(3)}, R² ${r.r2.toFixed(2)}, n=${r.n_obs}). Association, not a causal estimate.`;
}

function reliability(rel) {
  const worst = rel.bus_routes_ranked.slice(0, 20).reverse();
  chart("c-routes", {
    grid: { left: 54, right: 24, top: 10, bottom: 30 },
    xAxis: axis({ type: "value", min: .35, max: .8, axisLabel: { color: C.mute, formatter: v => Math.round(v * 100) + "%" } }),
    yAxis: axis({ type: "category", data: worst.map(d => "Rt " + d.route_id) }),
    series: [
      { type: "custom", renderItem: (p, api) => { const y = api.coord([0, api.value(0)])[1];
          const x0 = api.coord([api.value(1), 0])[0], x1 = api.coord([api.value(2), 0])[0];
          return { type: "line", shape: { x1: x0, y1: y, x2: x1, y2: y }, style: { stroke: C.mute, lineWidth: 3 } }; },
        data: worst.map((d, i) => [i, d.ci_lo, d.ci_hi]) },
      { type: "scatter", symbolSize: 10, color: C.bus, data: worst.map((d, i) => [d.eb_otp, i]) },
      { type: "scatter", symbol: "diamond", symbolSize: 7, color: C.mute, data: worst.map((d, i) => [d.raw_otp, i]) },
    ],
    tooltip: { trigger: "item", formatter: p => { const d = worst[p.dataIndex];
      return `Route ${d.route_id} (${d.route_class})<br>EB on-time ${pct(d.eb_otp)} · raw ${pct(d.raw_otp)}<br>${fmt(d.observed)} timepoint observations`; },
      backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  chart("c-otp", {
    legend: { textStyle: { color: C.mute }, top: 0 },
    xAxis: axis({ type: "time" }),
    yAxis: axis({ type: "value", min: .5, max: 1, axisLabel: { color: C.mute, formatter: v => v * 100 + "%" } }),
    series: [
      { name: "Bus", type: "line", showSymbol: false, color: C.bus, data: rel.bus_trend.map(d => [d.month, d.otp]),
        markArea: { itemStyle: { color: "rgba(255,255,255,.05)" }, data: [[{ xAxis: "2025-08-01" }, { xAxis: rel.bus_trend.at(-1).month }]] } },
      { name: "Commuter Rail", type: "line", showSymbol: false, color: C.cr, data: rel.cr_trend.map(d => [d.month, d.otp]) },
    ],
    tooltip: { trigger: "axis", valueFormatter: v => pct(v), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const cr = rel.cr_lines.filter(d => !d.line.includes("CapeFLYER"));
  chart("c-cr", {
    grid: { left: 150, right: 30, top: 6, bottom: 24 },
    xAxis: axis({ type: "value", min: .8, max: 1, axisLabel: { color: C.mute, formatter: v => Math.round(v * 100) + "%" } }),
    yAxis: axis({ type: "category", data: cr.map(d => d.line.replace(" Line", "")), axisLabel: { color: C.mute, fontSize: 11 } }),
    series: [{ type: "bar", color: C.cr, data: cr.map(d => d.otp), barWidth: 9 }],
    tooltip: { trigger: "axis", valueFormatter: v => pct(v), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
}

function experience(ex) {
  const acc = ex.accessibility.by_station.slice(0, 15).reverse();
  chart("c-access", {
    grid: { left: 170, right: 20, top: 10, bottom: 26 },
    xAxis: axis({ type: "value", axisLabel: { color: C.mute, formatter: v => v >= 1000 ? v / 1000 + "k h" : v + " h" }, splitNumber: 3 }),
    yAxis: axis({ type: "category", data: acc.map(d => `${d.station} (${d.asset[0]})`), axisLabel: { color: C.mute, fontSize: 11 } }),
    series: [{ type: "bar", data: acc.map(d => ({ value: d.hours, itemStyle: { color: d.asset === "Elevator" ? C.accent : C.ferry } })), barWidth: 10 }],
    tooltip: { trigger: "axis", formatter: p => { const d = acc[p[0].dataIndex]; return `${d.station} ${d.asset}<br>${fmt(d.hours)} hrs out · ${d.outages} alerts`; },
      backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const modes = ex.fare_equity.by_mode;
  const lab = m => m.replace("Rapid Transit or Bus Rapid Transit", "Subway / BRT");
  chart("c-equity", {
    legend: { textStyle: { color: C.mute }, top: 0 },
    grid: { left: 100, right: 20, top: 34, bottom: 30 },
    xAxis: axis({ type: "value", max: 1, axisLabel: { color: C.mute, formatter: v => v * 100 + "%" } }),
    yAxis: axis({ type: "category", data: modes.map(m => lab(m.mode)) }),
    series: [
      { name: "Low-income (Title VI)", type: "bar", color: C.accent, data: modes.map(m => m.low_income) },
      { name: "Pay full fare", type: "bar", color: C.bad, data: modes.map(m => m.full_fare) },
    ],
    tooltip: { trigger: "axis", valueFormatter: v => pct(v), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const py = ex.predictions.yearly;
  chart("c-pred", {
    legend: { textStyle: { color: C.mute }, top: 0 }, grid: { left: 50, right: 14, top: 30, bottom: 24 },
    xAxis: axis({ type: "category", data: [...new Set(py.map(d => d.year))] }),
    yAxis: axis({ type: "value", min: .7, max: .9, axisLabel: { color: C.mute, formatter: v => Math.round(v * 100) + "%" } }),
    series: ["bus", "subway"].map(m => ({ name: m === "bus" ? "Bus predictions" : "Subway predictions", type: "line",
      color: m === "bus" ? C.bus : C.blue, data: py.filter(d => d.mode === m).map(d => d.accuracy) })),
    tooltip: { trigger: "axis", valueFormatter: v => pct(v), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const q = "How would you rate the mbta overall?";
  chart("c-sat", {
    grid: { left: 50, right: 14, top: 24, bottom: 24 },
    title: { text: "Satisfied with MBTA overall (monthly panel, n≈500)", textStyle: { color: C.mute, fontSize: 12, fontWeight: 500 } },
    xAxis: axis({ type: "time" }),
    yAxis: axis({ type: "value", min: .3, max: 1, axisLabel: { color: C.mute, formatter: v => Math.round(v * 100) + "%" } }),
    series: [{ type: "line", showSymbol: false, color: C.good, smooth: true,
      data: ex.satisfaction.series.filter(d => d.question === q).map(d => [d.survey_date, d.satisfied_share]) }],
    tooltip: { trigger: "axis", valueFormatter: v => pct(v, 0), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
}

/* ---- Fare inspection optimiser (mirrors mbta_ti.analysis.fare_integrity) ---- */
function optimal(e, H, k) {
  if (H >= e.length) return e.map(() => 1);
  const cov = lam => e.map(v => Math.min(1, Math.max(0, Math.log(k * v * 0.1 / lam) / k)));
  let lo = 1e-12, hi = k * Math.max(...e) * 0.1;
  for (let i = 0; i < 200; i++) { const mid = Math.sqrt(lo * hi); cov(mid).reduce((a, b) => a + b, 0) > H ? lo = mid : hi = mid; }
  return cov(hi);
}
const deter = (e, x, k) => e.reduce((s, v, i) => s + v * 0.1 * (1 - Math.exp(-k * x[i])), 0);
function busiest(e, H) {
  const x = e.map(() => 0); const ord = e.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  let left = H; for (const [, i] of ord) { if (left <= 0) break; x[i] = Math.min(1, left); left -= x[i]; } return x;
}
function fares(fi) {
  const cells = fi.cells, e = cells.map(c => c.avg_entries);
  const stationsTop = [...new Set(fi.coverage_by_station.slice(0, 14).map(d => d.station))];
  const heat = chart("c-heat", {
    grid: { left: 120, right: 14, top: 10, bottom: 40 },
    xAxis: axis({ type: "category", data: [...Array(24).keys()].map(h => h + ":00"), axisLabel: { color: C.mute, fontSize: 10 } }),
    yAxis: axis({ type: "category", data: stationsTop.slice().reverse(), axisLabel: { color: C.mute, fontSize: 11 } }),
    visualMap: { min: 0, max: 1, show: false, inRange: { color: ["#121722", "#4a3b10", C.accent] } },
    series: [{ type: "heatmap", data: [] }],
    tooltip: { trigger: "item", formatter: p => `${p.value[1] !== undefined ? stationsTop.slice().reverse()[p.value[1]] : ""} ${p.value[0]}:00<br>coverage ${pct(p.value[2], 0)}`,
      backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  const rev = stationsTop.slice().reverse();
  function update() {
    const H = +document.getElementById("s-h").value, k = +document.getElementById("s-k").value;
    document.getElementById("v-h").textContent = H; document.getElementById("v-k").textContent = k;
    const x = optimal(e, H, k), u = e.map(() => H / e.length), b = busiest(e, H);
    const dO = deter(e, x, k), dU = deter(e, u, k), dB = deter(e, b, k);
    document.getElementById("sim").innerHTML =
      `<div><div class="v up">+${pct(dO / dU - 1, 0)}</div><div class="l">deterrence vs. even spread</div></div>` +
      `<div><div class="v up">+${pct(dO / dB - 1, 0)}</div><div class="l">vs. busiest-station-first</div></div>` +
      `<div><div class="v">${x.filter(v => v > .01).length}</div><div class="l">station-hours in the randomised roster</div></div>`;
    heat.setOption({ series: [{ data: cells.map((c, i) => [c.hour, rev.indexOf(c.station), x[i]]).filter(d => d[1] >= 0) }] });
  }
  ["s-h", "s-k"].forEach(id => document.getElementById(id).addEventListener("input", update));
  update();
  chart("c-be", {
    grid: { left: 50, right: 14, top: 14, bottom: 30 },
    xAxis: axis({ type: "category", data: fi.break_even.map(d => "$" + d.fine) }),
    yAxis: axis({ type: "value", axisLabel: { color: C.mute, formatter: v => Math.round(v * 100) + "%" } }),
    series: [{ type: "bar", color: C.accent, barWidth: 22, data: fi.break_even.map(d => d.break_even_inspection_rate),
      label: { show: true, position: "top", color: C.ink, formatter: p => pct(p.value) } }],
    tooltip: { trigger: "axis", valueFormatter: v => pct(v) + " of trips inspected", backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
  chart("c-risk", {
    grid: { left: 50, right: 14, top: 18, bottom: 42 },
    xAxis: axis({ type: "category", data: fi.revenue_scenarios.map(d => pct(d.evasion_rate, 1) + "\n" + d.short),
      axisLabel: { color: C.mute, fontSize: 11, lineHeight: 15 } }),
    yAxis: axis({ type: "value", axisLabel: { color: C.mute, formatter: v => "$" + v / 1e6 + "M" } }),
    series: [{ type: "bar", color: C.bad, barWidth: 30, data: fi.revenue_scenarios.map(d => d.revenue_at_risk_usd),
      label: { show: true, position: "top", color: C.ink, formatter: p => "$" + (p.value / 1e6).toFixed(1) + "M" } }],
    tooltip: { trigger: "axis", valueFormatter: v => "$" + fmt(v), backgroundColor: "#171d2b", borderColor: C.line, textStyle: { color: C.ink } },
  });
}

/* ---- Short-Hop: rules and examples (the interactive planner is the rider app in site/app/) ---- */
function shortHop(sh) {
  const r = sh.rules, $ = id => document.getElementById(id), m = x => "$" + x.toFixed(2);
  $("sh-rules").innerHTML = "<tr><th>Rule</th><th>Short-Hop</th></tr>" +
    [["Whole line, first stop to last", m(r.max)], ["Shorter trips", "in proportion to distance"], ["Minimum fare", m(r.min)],
     ["Reduced fare", "50%"], ["Missed tap-out", m(r.missed_tap_out)], ["Today (any trip)", m(sh.flat_fare)]]
      .map(([k, v]) => `<tr><td>${k}</td><td class="n g">${v}</td></tr>`).join("");
  $("sh-table").innerHTML = "<tr><th>Trip</th><th>of line</th><th>Today</th><th>Short-Hop</th><th>Break-even</th></tr>" +
    sh.examples.map(e => `<tr><td>${e.from} → ${e.to}</td><td class="n">${Math.min(100, Math.round(e.composite_mi / e.line_mi * 100))}%</td><td class="n">${m(sh.flat_fare)}</td>` +
      `<td class="n g">${m(e.fare)}</td><td class="n">${e.fare >= sh.flat_fare ? "—" : "+" + Math.round(e.breakeven_growth * 100) + "%"}</td></tr>`).join("");
}

function solutions(sol) {
  const el = document.getElementById("solutions-body");
  if (!sol) { el.innerHTML = ""; return; }
  el.innerHTML = `<p class="lede" style="margin-bottom:20px">${sol.intro}</p><div class="sol">` + sol.items.map(s => `
    <div class="card"><span class="tag">${s.problem}</span><h4>${s.title}</h4><p>${s.summary}</p>
      <ul>${s.actions.map(a => `<li>${a}</li>`).join("")}</ul>
      <div class="ev"><b>Evidence:</b> ${s.evidence}</div></div>`).join("") + "</div>";
}

(async function main() {
  const [meta, rd, rel, sz, st, ex, fi, net, sh] = await Promise.all(
    ["meta", "ridership", "reliability", "slow_zones", "stations", "experience", "fare_integrity", "network", "short_hop"].map(load));
  const sol = await load("solutions").catch(() => null);
  findings(meta); kpis(rd, sz, ex, fi); ridership(rd, st, net); slowZones(sz, net);
  reliability(rel); experience(ex); fares(fi); shortHop(sh); solutions(sol);
})();
