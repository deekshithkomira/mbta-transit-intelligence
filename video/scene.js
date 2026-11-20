// Short-Hop explainer — deterministic Three.js scene.  window.renderAt(t) draws the frame
// at t seconds, so the renderer can step frame by frame and the output is reproducible.
import * as THREE from "three";

const route = await (await fetch("route.json")).json();
const timing = await (await fetch("timing.json")).json().catch(() => null);
const KNOTS = timing ? timing.knots : [[0, 0], [58, 58]];   // [realT, sceneT]
export const DURATION = KNOTS.at(-1)[0];
function sceneTime(T) {
  for (let i = 1; i < KNOTS.length; i++) {
    const [ta, sa] = KNOTS[i - 1], [tb, sb] = KNOTS[i];
    if (T <= tb) return sa + (sb - sa) * (T - ta) / (tb - ta);
  }
  return KNOTS.at(-1)[1];
}

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const seg = (t, a, b) => clamp((t - a) / (b - a));
const fade = (t, a, b, f = 0.6) => Math.min(ease(seg(t, a, a + f)), 1 - ease(seg(t, b - f, b)));

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a10);
scene.fog = new THREE.Fog(0x070a10, 70, 190);
const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 0.1, 500);

scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0b0e14, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
scene.add(sun);

// ---------------------------------------------------------------- geography
// Real station coordinates (MBTA V3 API) projected to a local plane.
const lat0 = route.stations[0].lat, lon0 = route.stations[0].lon, K = 1100;
const proj = s => new THREE.Vector3((s.lon - lon0) * Math.cos(lat0 * Math.PI / 180) * K, 0,
  -(s.lat - lat0) * K);
const pts = route.stations.map(proj);
// centre the route
const centre = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
pts.forEach(p => p.sub(centre));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x0c111b, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(400, 100, 0x1a2234, 0x111827);
grid.position.y = 0.01;
scene.add(grid);

const GREEN = 0x00a651;
const curve = new THREE.CatmullRomCurve3(pts.map(p => p.clone().setY(0.6)), false, "centripetal");
const track = new THREE.Mesh(new THREE.TubeGeometry(curve, 600, 0.32, 12, false),
  new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 0.35, roughness: .4 }));
track.castShadow = true;
scene.add(track);

// station parameter along the curve (closest sample)
const samples = curve.getSpacedPoints(4000);
const stationU = pts.map(p => {
  let best = 0, bd = Infinity;
  samples.forEach((s, i) => { const d = s.distanceToSquared(p.clone().setY(0.6)); if (d < bd) { bd = d; best = i; } });
  return best / (samples.length - 1);
});

function label(text, { size = 46, color = "#eef2f8", bg = "rgba(10,14,22,.82)", pad = 18, bold = 700 } = {}) {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  g.font = `${bold} ${size}px Helvetica Neue, Arial`;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = size + pad * 2;
  c.width = w; c.height = h;
  g.font = `${bold} ${size}px Helvetica Neue, Arial`;
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, h / 3); g.fill(); }
  g.fillStyle = color; g.textBaseline = "middle"; g.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.userData.aspect = w / h;
  sp.scale.set(w / h, 1, 1);
  return sp;
}

const stationGroup = new THREE.Group();
scene.add(stationGroup);
const stationLabels = [];
pts.forEach((p, i) => {
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 32),
    new THREE.MeshStandardMaterial({ color: 0xe8ecf3, roughness: .5 }));
  plat.position.copy(p).setY(0.25);
  plat.castShadow = plat.receiveShadow = true;
  stationGroup.add(plat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 12, 48),
    new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: .6 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.copy(p).setY(0.55);
  stationGroup.add(ring);
  const lb = label(route.stations[i].name, { size: 40 });
  lb.position.copy(p).add(new THREE.Vector3(0, 3.2, 0));
  lb.scale.multiplyScalar(1.25);
  stationGroup.add(lb);
  stationLabels.push(lb);
});

// ---------------------------------------------------------------- train
const train = new THREE.Group();
const carMat = new THREE.MeshStandardMaterial({ color: 0x00843d, roughness: .35, metalness: .3 });
const winMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0x8fc9ff, emissiveIntensity: .6 });
for (let c = 0; c < 2; c++) {
  const car = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 1.25), carMat);
  car.position.set(-c * 3.45, 1.3, 0);
  car.castShadow = true;
  train.add(car);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.38, 1.28), winMat);
  win.position.set(-c * 3.45, 1.55, 0);
  train.add(win);
}
scene.add(train);
function placeTrain(u) {
  u = clamp(u, 0, 0.9999);
  const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
  train.position.copy(p).setY(0);
  train.rotation.y = Math.atan2(-tan.z, tan.x);
}

// price tag that rides above the train
const tagFlat = label("$2.40", { size: 64, color: "#111", bg: "#ff5d5d", bold: 900 });
const tagHop = label("$0.80", { size: 64, color: "#0b1f14", bg: "#3ecf8e", bold: 900 });
[tagFlat, tagHop].forEach(t => { t.scale.multiplyScalar(2.3); scene.add(t); });

// ---------------------------------------------------------------- fare gate + rider
const gate = new THREE.Group();
const cabMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: .6, roughness: .35 });
const cabs = [-1.6, 0, 1.6].map(x => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 2.6), cabMat);
  m.position.set(x, 0.8, 0); m.castShadow = true; gate.add(m); return m;
});
const lightMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 1.2 });
cabs.forEach(c => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.5), lightMat); l.position.set(c.position.x, 1.66, 0.7); gate.add(l); });
const paddleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .75 });
const paddles = [-0.8, 0.8].map(x => {
  const pv = new THREE.Group();
  const pd = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.6), paddleMat);
  pd.position.set(0, 0, x > 0 ? -0.3 : 0.3);
  pv.add(pd);
  pv.position.set(x > 0 ? 1.35 : -1.35, 1.0, 0);
  pv.userData.side = Math.sign(x);
  gate.add(pv); return pv;
});
// gate sits beside Copley, on a concourse slab
const gateBase = pts[0].clone().add(new THREE.Vector3(-9, 0, 6));
gate.position.copy(gateBase);
gate.rotation.y = Math.PI / 2;
scene.add(gate);
const slab = new THREE.Mesh(new THREE.BoxGeometry(14, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x1a2233 }));
slab.position.copy(gateBase).setY(0.1);
slab.receiveShadow = true;
scene.add(slab);

function person(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: .6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 16), m);
  body.position.y = 1.0; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf1c9a5 }));
  head.position.y = 1.95; head.castShadow = true; g.add(head);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: 0x334155 }));
  bag.position.set(-0.32, 1.15, 0); g.add(bag);
  scene.add(g);
  return g;
}
const student = person(0x2f6fe0);
const payer = person(0xb45309);
const thought = label("$2.40 for ONE stop?!", { size: 52, color: "#111", bg: "#ffc72c", bold: 900 });
thought.scale.multiplyScalar(1.6);
scene.add(thought);
const tapIn = label("TAP IN ✓", { size: 52, color: "#0b1f14", bg: "#3ecf8e", bold: 900 });
tapIn.scale.multiplyScalar(1.4);
scene.add(tapIn);

// gate local axis: riders walk along world -x .. +x through gate (gate rotated 90°)
const gatePoint = (along, side = 0) => gateBase.clone().add(new THREE.Vector3(along, 0, side));

// ---------------------------------------------------------------- fare ladder bars
const bars = pts.map((p, i) => {
  if (i === 0) return null;
  const f = route.stations[i].fare;
  const capped = f <= route.floor;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({
    color: capped ? 0x3ecf8e : 0xffc72c, emissive: capped ? 0x0d3b26 : 0x6b4e00, emissiveIntensity: .5,
    roughness: .4, transparent: true, opacity: 1 }));
  m.position.copy(p).add(new THREE.Vector3(2.2, 0, 0));
  m.castShadow = true;
  scene.add(m);
  const lb = label("$" + f.toFixed(2), { size: 46, color: "#111", bg: capped ? "#3ecf8e" : "#ffc72c", bold: 900 });
  lb.scale.multiplyScalar(1.5);
  scene.add(lb);
  return { m, lb, f, p };
}).filter(Boolean);
const BAR_K = 4.2; // world units per dollar

// ---------------------------------------------------------------- camera keys
// [time, position, lookAt]
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P0 = pts[0], P1 = pts[1], PN = pts[pts.length - 1];
const mid = pts[Math.floor(pts.length / 2)];
const camKeys = [
  [0, V(mid.x + 40, 95, mid.z + 75), mid],
  [5, V(mid.x + 20, 70, mid.z + 55), mid],
  [6.5, V(P0.x + 14, 14, P0.z + 18), P0.clone().lerp(P1, .5)],
  [12.5, V(P1.x + 10, 12, P1.z + 16), P0.clone().lerp(P1, .6)],
  [14.5, V(mid.x + 34, 62, mid.z + 52), mid],
  [21, V(mid.x + 26, 55, mid.z + 44), mid],
  [22.5, gatePoint(4, 11).setY(6.5), gatePoint(0, 0).setY(1.2)],
  [29, gatePoint(2.5, 9).setY(5), gatePoint(0, 0).setY(1.2)],
  [30.5, gatePoint(5, 10).setY(6), gatePoint(0, 0).setY(1.2)],
  [35, gatePoint(3, 8).setY(5), gatePoint(0, 0).setY(1.2)],
  [36.5, V(P0.x + 12, 13, P0.z + 16), P0.clone().lerp(P1, .5)],
  [40, V(P1.x + 10, 12, P1.z + 15), P0.clone().lerp(P1, .7)],
  [41.5, V(mid.x + 62, 26, mid.z + 14), mid.clone().add(V(0, 4, -2))],
  [45.5, V(mid.x + 56, 23, mid.z + 10), mid.clone().add(V(0, 4, -2))],
  [48.5, V(mid.x + 50, 34, mid.z + 18), mid.clone().add(V(0, 4, -2))],
  [49.5, V(mid.x + 40, 85, mid.z + 70), mid],
  [58, V(mid.x + 10, 110, mid.z + 60), mid],
];
function cameraAt(t) {
  let i = 0;
  while (i < camKeys.length - 2 && t > camKeys[i + 1][0]) i++;
  const [ta, pa, la] = camKeys[i], [tb, pb, lb] = camKeys[i + 1];
  const k = easeInOut(seg(t, ta, tb));
  camera.position.copy(pa).lerp(pb, k);
  camera.lookAt(la.clone().lerp(lb, k));
}

// ---------------------------------------------------------------- overlay
const $ = id => document.getElementById(id);
function overlay(t) {
  $("scrim").style.opacity = Math.max(fade(t, 0, 5.8, .1), fade(t, 49, 54.6), fade(t, 54.4, 59, .8));
  $("chip").style.opacity = fade(t, 5.5, 41.2);
  $("t-intro").style.opacity = fade(t, 0.2, 5.6, .8);
  $("c1").style.opacity = fade(t, 6.5, 13.6);
  $("c2").style.opacity = fade(t, 14, 21.6);
  $("c3").style.opacity = fade(t, 22.5, 29.6);
  $("c4").style.opacity = fade(t, 30.5, 40.6);
  $("c5").style.opacity = fade(t, 41.5, 48.6);
  const ph = fade(t, 30.8, 38.5);
  $("phone").style.opacity = ph;
  $("phone").style.transform = `translateY(${(1 - ph) * 40}px)`;
  $("btn").textContent = t > 33.4 ? "✓ Tapped in at Copley" : "Tap in to ride";
  $("btn").style.background = t > 33.4 ? "#3ecf8e" : "#ffc72c";
  [...document.querySelectorAll(".card")].forEach((c, i) => {
    const o = fade(t, 49.2 + i * 0.5, 54.2);
    c.style.opacity = o; c.style.transform = `translateY(${(1 - o) * 30}px)`;
  });
  $("cards").style.display = t > 48.8 && t < 54.6 ? "grid" : "none";
  $("t-end").style.opacity = fade(t, 54.4, 58.2, .8);
}

// ---------------------------------------------------------------- timeline
function renderAt(T) {
  const t = sceneTime(T);
  cameraAt(t);

  // ---- train
  let u = stationU[0];
  let tagVisible = null;
  if (t < 6.5) u = stationU[0];
  else if (t < 13) { u = stationU[0] + (stationU[1] - stationU[0]) * easeInOut(seg(t, 7.5, 12)); tagVisible = tagFlat; }
  else if (t < 14) u = stationU[0];
  else if (t < 21.5) { u = stationU[0] + (stationU.at(-1) - stationU[0]) * easeInOut(seg(t, 14.6, 20.6)); tagVisible = tagFlat; }
  else if (t < 36.5) u = stationU[0];
  else if (t < 41) { u = stationU[0] + (stationU[1] - stationU[0]) * easeInOut(seg(t, 37, 40)); tagVisible = tagHop; }
  else u = stationU[1];
  placeTrain(u);
  [tagFlat, tagHop].forEach(tg => {
    tg.visible = tg === tagVisible;
    tg.position.copy(train.position).add(new THREE.Vector3(-1.7, 5.2, 0));
  });
  tagFlat.material.opacity = 1;

  // ---- station labels hide during gate close-ups
  stationLabels.forEach(l => { l.material.opacity = t > 22 && t < 36 ? 0 : 1; });

  // ---- gate scene
  const inGate = t > 21.8 && t < 36.2;
  [gate, slab, student, payer].forEach(o => { o.visible = inGate; });
  thought.visible = inGate && t > 23.2 && t < 26.4;
  tapIn.visible = inGate && t > 33.4 && t < 35.6;
  let open = 0;
  if (inGate && t < 30) {
    // paying rider taps, gate opens; student tailgates/jumps
    const pw = seg(t, 22.4, 26.8);
    payer.position.copy(gatePoint(-4 + 8 * pw, 0.4));
    payer.rotation.y = 0;
    open = ease(seg(t, 24.8, 25.3)) * (1 - ease(seg(t, 26.4, 26.9)));
    const sw = seg(t, 22.4, 25.8);
    const jump = seg(t, 25.8, 26.8);
    const sx = t < 25.8 ? -5.5 + 4.2 * ease(sw) : -1.3 + 4.6 * ease(jump);
    student.position.copy(gatePoint(sx, -0.9));
    student.position.y = Math.sin(Math.PI * jump) * 1.9;
    student.rotation.z = -Math.sin(Math.PI * jump) * 0.5;
    student.rotation.y = 0;
    lightMat.color.set(0xff3b3b); lightMat.emissive.set(0xff3b3b);
  } else if (inGate) {
    // Short-Hop: student books, taps in, gate opens for them
    payer.visible = false;
    const sw = seg(t, 30.6, 33.4), walk = seg(t, 33.6, 35.6);
    student.position.copy(gatePoint(t < 33.4 ? -5 + 3.6 * ease(sw) : -1.4 + 6 * ease(walk), 0));
    student.position.y = 0; student.rotation.z = 0;
    open = ease(seg(t, 33.4, 33.9));
    const ok = t > 33.4;
    lightMat.color.set(ok ? 0x3ecf8e : 0xff3b3b); lightMat.emissive.set(ok ? 0x3ecf8e : 0xff3b3b);
  }
  student.position.y += inGate ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;
  paddles.forEach(p => { p.rotation.y = p.userData.side * open * 1.35; });
  thought.position.copy(student.position).setY(3.4);
  tapIn.position.copy(gatePoint(0, 0)).add(new THREE.Vector3(0, 3.3, 0));

  // ---- fare ladder
  bars.forEach((b, i) => {
    const g = ease(seg(t, 42 + i * 0.35, 42.8 + i * 0.35));
    const show = t > 41.5 && t < 49.4;
    const h = Math.max(0.001, b.f * BAR_K * g);
    b.m.visible = b.lb.visible = show;
    b.m.scale.y = h;
    b.m.position.y = h / 2;
    b.lb.position.copy(b.m.position).setY(h + 1.4);
    b.lb.material.opacity = g;
  });

  overlay(t);
  renderer.render(scene, camera);
}
window.renderAt = renderAt;
window.DURATION = DURATION;
renderAt(0);
window.sceneReady = true;
