// リール「パート 1：0 日目」（縦 1080×1920・27 秒）。window.renderFrame(t) で t 秒のコマを描く。
// tools/render_video.js --page video/part1.html --name part1_day0 で書き出す。
// 中身は本番の 0 日目（data/world.json をそのまま読む。書きかえない）。村人は 0 人、名前は出さない。
// 順番：海の上から島（朝焼け・海岸・山）→ 海の見える角度で広場の予定地・チェスト・木・岩・池 → 「ここに町を作ります」
//   → 参加の仕方（道具で仕事が決まる：ピッケル＝採掘・斧＝木こり・釣りざお＝釣り・くわ＝畑）→ 「フォローして『住みたい』で、すぐ島に住める」の呼びかけ＋始まる日はお知らせ（夕焼け）
// 決まり：コメントした人はすぐ（15 分ほどで）町に住む。1 日目が始まる日は持ち主が知らせる（「明日 1 日目」とは言わない）
// 文字の札は、前の札が消えきってから次を出す（重ならない）。
import * as THREE from 'three';
import { makeSky } from '../js/daynight.js';
import { makeTerrain } from '../js/terrain_gen.js';
import { makeTerrainView } from '../js/terrain.js';
import { makeChunkObjects, makeDebris, makeChest } from '../js/blocks.js';
import { makeBush } from '../js/world3d.js';
import { makePond, animatePond, makeAnimal } from '../js/farm3d.js';
import { decodeWorld } from '../js/tilemap.js';

const W = 1080, H = 1920, FPS = 30, DURATION = 31.4;
const SAFE_TOP = H * 0.12, SAFE_BOTTOM = H * 0.85;
const FONT = '"BIZ UDPGothic", "Yu Gothic", "Meiryo", sans-serif';
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const backOut = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

const [world0, config, state] = await Promise.all(['../data/world.json', '../data/config.json', '../data/state.json'].map((u) => fetch(u, { cache: 'no-store' }).then((r) => r.json())));
const world = decodeWorld(world0);
const SQ = world.square || { x: 0, z: -1, r: 8 };
const CHEST = world.chest || { x: SQ.x + 6, z: SQ.z + 1.6 };
const POND = world.pond || null;
// 道具と仕事（選んだ道具で仕事が決まる）。絵は icons/ の木の道具
const TOOLS = [
  { id: 'pickaxe', item: 'wood_pickaxe', label: 'ピッケル', role: '採掘', color: '#7a5a2a' },
  { id: 'axe', item: 'wood_axe', label: '斧', role: '木こり', color: '#3d7a3a' },
  { id: 'rod', item: 'wood_fishing_rod', label: '釣りざお', role: '釣り', color: '#2f6f9e' },
  { id: 'hoe', item: 'wood_hoe', label: 'くわ', role: '畑', color: '#9a6a1a' },
];

// ---------- 時間割 ----------
// tease：予告（フォロワーが増えると何かが起きるかも）・danger：予告（何日目かの夜、島が危なくなるかも。night.js の敵の夜。日にちは決めない）
const T = { sky: 0, site: 6.5, town: 12.5, join: 16, tease: 22.5, danger: 24.7, next: 26.9 };
function hourAt(t) {
  // つなぎ目で空の色が飛ばないよう、時刻は切れ目なく進める（予告の夜と、その後の朝だけは場面を切りかえる）
  if (t < T.site) return lerp(6.4, 8.6, t / T.site);           // 朝焼け
  if (t < T.join) return lerp(8.6, 12, (t - T.site) / (T.join - T.site));
  if (t < T.tease) return lerp(12, 16.9, (t - T.join) / (T.tease - T.join));
  if (t < T.danger) return lerp(16.9, 18.2, (t - T.tease) / (T.danger - T.tease)); // 夕焼け
  if (t < T.next) return lerp(21.5, 22.5, (t - T.danger) / (T.next - T.danger));   // 夜
  return lerp(6.2, 7.2, (t - T.next) / (DURATION - T.next)); // 夜が明けた朝焼け
}

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl'; document.body.appendChild(renderer.domElement);
const out = document.getElementById('out'); const ctx = out.getContext('2d');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd9ea, 200, 650);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.3, 1200);
const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.9); scene.add(sun.target); scene.add(sun);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 220 });
sun.shadow.bias = -0.0005;

// どこまでも続く地形（丘・山・川・湖・海）。町の中は平ら
const TC = config.terrain || {};
const gen = makeTerrain({ seed: TC.seed || 'town', seaZ: world.seaZ, zone: { x0: -112, x1: 112, z0: -112, z1: world.seaZ + 2 }, keepOut: [], keepR: TC.clearBlocks ?? 4 });
const terrain = makeTerrainView(scene, gen, { radius: 12, lod: [3, 7], perFrame: 600, treeNear: 4, rockNear: 4, shadow: true });
// 町の木・岩（本番の 0 日目の配置）・茂み・まん中の草と小石・池・動物
const trees = (world.trees || []).filter((t) => !t.gone), rocks = (world.rocks || []).filter((r) => r.hp > 0);
scene.add(makeChunkObjects(trees.concat(rocks), { shadow: true }));
for (const b of world.bushes || []) scene.add(makeBush(b));
scene.add(makeDebris(world.debris || []));
const pondObj = POND ? makePond(POND) : null;
if (pondObj) scene.add(pondObj);
for (const a of world.animals || []) {
  try { const g = makeAnimal(a.kind); g.position.set(a.x, 0, a.z); g.rotation.y = (a.x * 7.1 + a.z * 3.3) % 6.28; scene.add(g); } catch { /* 形のない動物は出さない */ }
}

// 広場の予定地：うすい円と、まわりの杭
const siteG = new THREE.Group(); siteG.position.set(SQ.x, 0, SQ.z); scene.add(siteG);
const disc = new THREE.Mesh(new THREE.CircleGeometry(SQ.r, 48), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.0, depthWrite: false }));
disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06; siteG.add(disc);
const stakes = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xf4f0e2 : 0xd8553a }));
  s.position.set(Math.cos(a) * SQ.r, 0.55, Math.sin(a) * SQ.r); s.castShadow = true; siteG.add(s); stakes.push(s);
}
// チェストの場所：空っぽのチェスト（すけた形）と、足もとの四角
const ghost = makeChest(); ghost.position.set(CHEST.x, 0, CHEST.z); ghost.rotation.y = Math.atan2(-CHEST.x, -(CHEST.z + 1)); ghost.scale.setScalar(1.3);
ghost.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.6; c.depthWrite = false; return c; }); if (o.material.length === 1) o.material = o.material[0]; } });
scene.add(ghost);
const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.0, depthWrite: false }));
pad.rotation.x = -Math.PI / 2; pad.position.set(CHEST.x, 0.07, CHEST.z); scene.add(pad);

const sky = makeSky(scene, { hemi, sun, sunDist: 60, radius: 900, maxLights: 1, dome: true, camera });

// ---------- カメラ ----------
// 地図：海は南（z > seaZ）、雪山は北東（x 200〜350, z -150〜-330）、川と湖は北西、湾は東と西
// cam = [x, y, z, 見る x, 見る y, 見る z, 画角]
const look = (c) => { camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); if (camera.fov !== c[6]) { camera.fov = c[6]; camera.updateProjectionMatrix(); } return c; };
const lerpCam = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const path = (keys, k) => { // keys: [[k0, cam], ...] を順に、なめらかにつなぐ
  for (let i = 0; i < keys.length - 1; i++) { const [a, ca] = keys[i], [b, cb] = keys[i + 1]; if (k <= b) return lerpCam(ca, cb, ease((k - a) / (b - a))); }
  return keys[keys.length - 1][1];
};
const CAM = {
  // 空：南の海の上から、海岸と町の森、奥の山へ。だんだん海岸へ寄る
  s0: [-60, 95, 230, 60, 0, -120, 50],
  s1: [-20, 70, 140, 20, 0, -40, 52],
  s2: [-12, 68, 54, -2, 0, -1, 58],
  // 予定地：海の上（南）から高めに見下ろす。下に砂浜と海、まん中に広場と池、上に森と丘
  site0: [-20, 62, 40, -1, 0, 0, 58],
  site1: [-26, 56, 34, -1, 0, -1, 58],
  // 町：東の海岸の上から西を見下ろす。左に海、まん中に広場
  town1: [50, 58, 46, -8, 0, -2, 56],
  // 参加の仕方：北東の雪山のほうへ向きを変える（札の上に地平線と山）
  join0: [30, 50, 30, 170, -35, -170, 50],
  join1: [10, 60, 30, 210, -35, -230, 50],
  // しめ：海の上から、西の夕日と海岸を見る
  // 予告：夕方の島を東の海の上から（広場を下に、森を上に）
  tease0: [44, 52, 48, -4, 0, -4, 56],
  tease1: [38, 46, 42, -3, 0, -3, 56],
  next0: [70, 34, 80, -120, 0, 20, 50],
  next1: [50, 40, 70, -160, 4, 10, 50],
};
function cameraAt(t) {
  if (t < T.site) return look(path([[0, CAM.s0], [0.5, CAM.s1], [1, CAM.s2]], t / T.site));
  if (t < T.town) return look(path([[0, CAM.s2], [0.2, CAM.site0], [1, CAM.site1]], (t - T.site) / (T.town - T.site)));
  if (t < T.join) return look(lerpCam(CAM.site1, CAM.town1, ease((t - T.town) / (T.join - T.town))));
  if (t < T.tease) return look(path([[0, CAM.town1], [0.25, CAM.join0], [1, CAM.join1]], (t - T.join) / (T.tease - T.join)));
  if (t < T.danger) return look(path([[0, CAM.join1], [0.3, CAM.tease0], [1, CAM.tease1]], (t - T.tease) / (T.danger - T.tease)));
  if (t < T.next) {
    // 予告の夜：村のまん中から低く森を見て、ゆっくり寄る。地ひびきのように少しゆれる
    const k = (t - T.danger) / (T.next - T.danger), c = DG.cam.slice(), sh = 0.05 * clamp01(k * 2) * (Math.sin(t * 47) + 0.6 * Math.sin(t * 29));
    c[0] += DG.d.x * k * 2.0; c[2] += DG.d.z * k * 2.0; c[1] += sh; c[4] += sh;
    return look(c);
  }
  return look(lerpCam(CAM.next0, CAM.next1, ease((t - T.next) / (DURATION - T.next))));
}
// ---------- 予告：夜の森の目（イメージ）。光る目は木の手前の暗がりに ----------
const DG = (() => {
  let best = null;
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2, d = { x: Math.sin(a), z: Math.cos(a) };
    const cp = { x: SQ.x + d.x * 5, z: SQ.z + d.z * 5 };
    if (d.z > -0.35) continue; // 海（南）の側は見ない。森の奥（北）へ向く
    let n = 0, bad = 0;
    for (const t of trees) {
      const dx = t.x - cp.x, dz = t.z - cp.z, along = dx * d.x + dz * d.z, side = Math.abs(dx * d.z - dz * d.x);
      if (along > 14 && along < 34 && side < along * 0.28) n++;
      if (along > -2 && along < 14 && side < 4 + along * 0.3) bad++;
    }
    for (const r of rocks) { const dx = r.x - cp.x, dz = r.z - cp.z, along = dx * d.x + dz * d.z; if (along > 0 && along < 14 && Math.abs(dx * d.z - dz * d.x) < 4) bad++; }
    if (POND) { const dx = POND.x - cp.x, dz = POND.z - cp.z, along = dx * d.x + dz * d.z; if (along > 0 && along < 16 && Math.abs(dx * d.z - dz * d.x) < (POND.r || 4) + 2) bad += 3; }
    const cost = -n + bad * 4;
    if (!best || cost < best.cost) best = { cost, d, cp };
  }
  const { d, cp } = best;
  const cam = [cp.x, 3.2, cp.z, cp.x + d.x * 30, 2.4, cp.z + d.z * 30, 50];
  const near = trees.map((t) => { const dx = t.x - cp.x, dz = t.z - cp.z; return { t, along: dx * d.x + dz * d.z, side: dx * d.z - dz * d.x }; })
    .filter((o) => o.along > 12 && o.along < 26 && Math.abs(o.side) < o.along * 0.2).sort((p, q) => p.along - q.along);
  const eyes = [];
  for (const o of near) {
    if (eyes.length >= 3) break;
    const s = o.t.size || 1, l = Math.hypot(cp.x - o.t.x, cp.z - o.t.z) || 1, u = { x: (cp.x - o.t.x) / l, z: (cp.z - o.t.z) / l }, sd = { x: -u.z, z: u.x }, sg = o.side > 0 ? -1 : 1;
    const p = { x: o.t.x + u.x * (1.4 * s) + sd.x * sg * (1.3 * s), z: o.t.z + u.z * (1.4 * s) + sd.z * sg * (1.3 * s) };
    if (trees.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.0 * (q.size || 1))) continue; // 幹にめりこまない
    if (rocks.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.0)) continue;
    if (eyes.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 5)) continue;
    const L = Math.hypot(p.x - cp.x, p.z - cp.z), v = { x: (p.x - cp.x) / L, z: (p.z - cp.z) / L };
    if (trees.some((q) => { const dx = q.x - cp.x, dz = q.z - cp.z, al = dx * v.x + dz * v.z; return al > 0 && al < L - 0.5 && Math.abs(dx * v.z - dz * v.x) < 0.9 * (q.size || 1); })) continue;
    eyes.push({ ...p, y: 1.3 + eyes.length * 0.25 });
  }
  return { cam, cp, d, eyes };
})();
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, fog: false });
const eyeGlowMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, fog: false, transparent: true, opacity: 0.2, depthWrite: false });
const eyeObjs = DG.eyes.map((e) => {
  const g = new THREE.Group();
  for (const sx of [-0.3, 0.3]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.05), eyeMat); m.position.set(sx, 0, 0); g.add(m);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.38, 0.02), eyeGlowMat); gl.position.set(sx, 0, -0.04); g.add(gl);
  }
  g.position.set(e.x, e.y, e.z); g.lookAt(DG.cp.x, e.y, DG.cp.z); g.visible = false; scene.add(g);
  return g;
});

// 名札を付ける木と岩：名札が出る時のカメラで、画面のまん中あたり（上の札や字幕にかからない所）に見えるもの
const onScreen = (p, y, t) => { cameraAt(t); camera.updateMatrixWorld(true); const v = new THREE.Vector3(p.x, y, p.z).project(camera); const x = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H; return v.z < 1 && x > 200 && x < W - 200 && sy > 560 && sy < 1300; };
const far = (o, list) => list.every((u) => !u || Math.hypot(o.x - u.x, o.z - u.z) > 7);
const pickNear = (list, y, t, used) => list.filter((o) => Math.hypot(o.x - SQ.x, o.z - SQ.z) > SQ.r + 1.5 && onScreen(o, y, t) && far(o, used)).sort((a, b) => Math.hypot(a.x - SQ.x, a.z - SQ.z) - Math.hypot(b.x - SQ.x, b.z - SQ.z))[0];
const TREE = pickNear(trees.filter((t) => (t.state || 'tree') === 'tree'), 7.5, T.site + 3.6, [POND]) || { x: SQ.x - 10, z: SQ.z - 4 };
const ROCK = pickNear(rocks, 1.6, T.site + 4.4, [TREE, POND]) || { x: SQ.x + 10, z: SQ.z - 4 };

// ---------- 文字 ----------
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function caption(lines, y, size, alpha = 1, opts = {}) {
  if (alpha <= 0.002) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const pad = opts.pad ?? 44;
  ctx.font = `700 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // 1 行に収まらない時だけ、画面幅（左右 12px あけ）に合わせて字を少し小さくする
  const w0 = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (w0 + pad * 2 > W - 24) { size = Math.floor(size * (W - 24 - pad * 2) / w0); ctx.font = `700 ${size}px ${FONT}`; }
  const lh = size * 1.3, wmax = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = opts.bg || 'rgba(24, 36, 28, 0.7)';
  roundRect(W / 2 - wmax / 2 - pad, y - lh / 2 - 22, wmax + pad * 2, lh * lines.length + 44, 34); ctx.fill();
  lines.forEach((l, i) => {
    const yy = y + i * lh;
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(l, W / 2, yy);
    ctx.fillStyle = (opts.colors && opts.colors[i]) || opts.color || '#fffdf4'; ctx.fillText(l, W / 2, yy);
  });
  ctx.restore();
}
// a で出はじめ、b で消えきる（b のあとは 0）
const fadeIO = (t, a, b, f = 0.3) => Math.min(clamp01((t - a) / f), clamp01((b - t) / f));
// 左上：島の名前とパート 1・0 日目
function badges(night = false) {
  ctx.save(); ctx.textBaseline = 'middle';
  ctx.font = `700 46px ${FONT}`;
  const p = 'はじまり島　パート 1', pw = ctx.measureText(p).width;
  ctx.fillStyle = 'rgba(255, 224, 138, 0.96)'; roundRect(56, SAFE_TOP, pw + 56, 76, 38); ctx.fill();
  ctx.fillStyle = '#2f2a1a'; ctx.fillText(p, 84, SAFE_TOP + 39);
  ctx.font = `700 84px ${FONT}`;
  const d = night ? '？日目の夜' : '0日目', dw = ctx.measureText(d).width;
  ctx.fillStyle = night ? 'rgba(92, 22, 30, 0.92)' : 'rgba(47, 74, 55, 0.92)'; roundRect(56, SAFE_TOP + 92, dw + 72, 124, 62); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(d, 92, SAFE_TOP + 156);
  ctx.restore();
}
// 右上：村人 0 人（「ここに町を作ります」の所で少しはねる）
function counter(t) {
  const pulse = t > T.town + 1.2 && t < T.town + 1.9 ? 1 + Math.sin(((t - T.town - 1.2) / 0.7) * Math.PI) * 0.12 : 1;
  ctx.save(); ctx.translate(W - 56, SAFE_TOP + 50); ctx.scale(pulse, pulse);
  ctx.font = `700 60px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  const txt = '村人 0 人', w = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(255, 253, 244, 0.94)'; roundRect(-w - 60, -50, w + 60, 100, 50); ctx.fill();
  ctx.fillStyle = '#2f4a37'; ctx.fillText(txt, -30, 0);
  ctx.restore();
}
// 3D の点から立ち上がる名札
const _v = new THREE.Vector3();
function callout(text, p, y, alpha, color = '#2f4a37', lift = 150) {
  if (alpha <= 0.002) return;
  _v.set(p.x, y, p.z).project(camera);
  if (_v.z > 1) return;
  const x = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H, s = Math.max(0.01, backOut(clamp01(alpha * 1.4)));
  ctx.save(); ctx.globalAlpha = clamp01(alpha * 2) * (alpha < 1 ? alpha : 1);
  ctx.strokeStyle = 'rgba(255,253,244,0.95)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x, sy - lift * s); ctx.stroke();
  ctx.fillStyle = '#fffdf4'; ctx.beginPath(); ctx.arc(x, sy, 10, 0, Math.PI * 2); ctx.fill();
  ctx.translate(x, sy - lift * s); ctx.scale(s, s);
  ctx.font = `700 56px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,253,244,0.97)'; roundRect(-w / 2 - 34, -88, w + 68, 94, 47); ctx.fill();
  ctx.fillStyle = color; ctx.fillText(text, 0, -41);
  ctx.restore();
}
// 道具の絵（アイコンの 16×16 をそのまま大きく）
const ICON = {};
for (const o of TOOLS) { const im = new Image(); im.src = '../icons/' + o.item + '.png'; ICON[o.id] = im; }
const JOIN_END = T.tease - 0.15; // 参加の札はここで消えきる
function joinCard(t) {
  const a = fadeIO(t, T.join + 0.1, JOIN_END, 0.3);
  if (a <= 0.002) return;
  const x = 50, w = W - 100, y = 560, h = 1060;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(x + 4, y + 8, w, h, 44); ctx.fill();
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 44); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7a6a4a'; ctx.font = `700 50px ${FONT}`; ctx.fillText('参加の仕方', W / 2, y + 66);
  const step = (t0) => clamp01((t - t0) / 0.3);
  // 1：コメントに『住みたい』＋道具
  let k = step(T.join + 0.4);
  if (k > 0) {
    ctx.globalAlpha = a * k;
    ctx.fillStyle = '#2f4a37'; ctx.font = `700 62px ${FONT}`; ctx.fillText('フォローして、コメントに', W / 2, y + 150);
    ctx.fillStyle = '#c0392b'; ctx.font = `700 90px ${FONT}`; ctx.fillText('『住みたい ピッケル』', W / 2, y + 250);
  }
  // 2：選んだ道具で、仕事が決まる
  k = step(T.join + 1.4);
  if (k > 0) {
    ctx.globalAlpha = a * k;
    ctx.fillStyle = '#efe7d3'; roundRect(x + 50, y + 320, w - 100, 96, 48); ctx.fill();
    ctx.fillStyle = '#2f4a37'; ctx.font = `700 60px ${FONT}`; ctx.fillText('選んだ道具で、仕事が決まる', W / 2, y + 369);
  }
  // 3：道具 4 つと仕事（2 列 × 2 段）
  const gap = 28, tw = (w - 60 - gap) / 2, th = 250, gx0 = x + 30, gy0 = y + 460;
  TOOLS.forEach((o, i) => {
    const kk = clamp01((t - (T.join + 2.2 + i * 0.35)) / 0.35);
    if (kk <= 0) return;
    const s = Math.max(0.01, backOut(kk)), col = i % 2, row = (i / 2) | 0;
    const tx = gx0 + col * (tw + gap), ty = gy0 + row * (th + gap);
    ctx.save(); ctx.globalAlpha = a * clamp01(kk * 2);
    ctx.translate(tx + tw / 2, ty + th / 2); ctx.scale(s, s); ctx.translate(-tw / 2, -th / 2);
    ctx.fillStyle = '#f4eddb'; roundRect(0, 0, tw, th, 30); ctx.fill();
    if (i === 0) { ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 8; roundRect(4, 4, tw - 8, th - 8, 26); ctx.stroke(); }
    // 道具の絵（灰色のマスに）
    const box = 196, bx = 22, by = (th - box) / 2;
    ctx.fillStyle = '#8b8b8b'; roundRect(bx, by, box, box, 18); ctx.fill();
    ctx.fillStyle = '#6f6f6f'; roundRect(bx + 8, by + 8, box - 16, box - 16, 12); ctx.fill();
    ctx.imageSmoothingEnabled = false;
    if (ICON[o.id].complete && ICON[o.id].naturalWidth) ctx.drawImage(ICON[o.id], bx + 18, by + 18, box - 36, box - 36);
    // 道具の名前と仕事
    const cx = bx + box + (tw - bx - box) / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5a4a2a'; ctx.font = `700 50px ${FONT}`; ctx.fillText(o.label, cx, th / 2 - 52);
    ctx.font = `700 ${o.role.length > 2 ? 60 : 70}px ${FONT}`; const rw = ctx.measureText(o.role).width;
    ctx.fillStyle = o.color; roundRect(cx - rw / 2 - 18, th / 2 + 4, rw + 36, 96, 26); ctx.fill();
    ctx.fillStyle = '#fffdf4'; ctx.fillText(o.role, cx, th / 2 + 54);
    ctx.restore();
  });
  ctx.restore();
}
const NEXT_IN = T.next + 0.25; // しめの札はここから（参加の札が消えきってから）
function nextCard(t) {
  // しめ：「住みたい」の呼びかけを大きく。下に DM のお知らせと明日の予告（選ぶ中身は出さない）
  const a = clamp01((t - NEXT_IN) / 0.35);
  if (a <= 0) return;
  ctx.fillStyle = `rgba(12, 16, 24, ${0.3 * a})`; ctx.fillRect(0, 0, W, H);
  const s = lerp(0.88, 1, backOut(a)), x = 60, w = W - 120, y = 600, h = 620;
  ctx.save(); ctx.globalAlpha = clamp01(a * 2.5);
  ctx.translate(W / 2, y + h / 2); ctx.scale(s, s); ctx.translate(-W / 2, -(y + h / 2));
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; roundRect(x + 4, y + 10, w, h, 48); ctx.fill();
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 48); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2f4a37'; ctx.font = `700 76px ${FONT}`; ctx.fillText('フォローして、コメントに', W / 2, y + 120);
  ctx.fillStyle = '#c0392b'; ctx.font = `700 120px ${FONT}`; ctx.fillText('『住みたい』', W / 2, y + 270);
  ctx.fillStyle = '#2f4a37'; ctx.font = `700 76px ${FONT}`; ctx.fillText('で、すぐ島に住める', W / 2, y + 430);
  const bob = Math.sin(t * 6) * 8;
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(W / 2 - 34, y + 520 + bob); ctx.lineTo(W / 2 + 34, y + 520 + bob); ctx.lineTo(W / 2, y + 566 + bob); ctx.closePath(); ctx.fill();
  ctx.restore();
  caption(['住んだかは、リンク先で自分の名前を探せる'], y + h + 120, 56, clamp01((t - NEXT_IN - 1.0) / 0.35), { color: '#fffdf4', pad: 26 });
  caption(['始まる日は、このアカウントでお知らせ'], y + h + 270, 56, clamp01((t - NEXT_IN - 1.8) / 0.35), { color: '#ffe08a', pad: 26 });
}

// ---------- 1 コマ ----------
// 字幕：[出はじめ, 消えきる, 行, 形]。どれも前の札が消えきってから出る
const CAPS = [
  [0.3, 5.9, ['はじまり島'], { y: H / 2 + 90, size: 150, color: '#ffe08a' }],
  [0.9, 5.9, ['まだ、だれもいない島'], { y: H / 2 + 300, size: 76 }],
  [1.6, 5.9, ['フォロワーといっしょに作る', '島づくり'], { y: H / 2 + 450, size: 62, color: '#ffe08a' }],
  [T.site + 0.4, T.town - 0.1, ['ここが、村のまん中になる所'], { size: 66 }],
  [T.town + 0.2, T.join - 0.1, ['ここに町を作ります', '村人は 0 人'], { y: SAFE_BOTTOM - 260, size: 76, colors: ['#fffdf4', '#ffe08a'] }],
  [T.tease + 0.25, T.danger - 0.1, ['フォロワーが増えると、', '島に何かが起きるかも…'], { size: 70, color: '#ffe08a' }],
  [T.danger + 0.35, T.next - 0.1, ['何日目かの夜、', '島が危なくなるかも…'], { size: 70, color: '#ffb4a6', bg: 'rgba(28, 6, 10, 0.82)' }],
];
// ---------- 予告の画面効果 ----------
function sparkle(x, y, r, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y);
  ctx.fillStyle = '#fff3b0'; ctx.shadowColor = '#ffd23a'; ctx.shadowBlur = r * 0.8;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4, rr = i % 2 ? r * 0.22 : r; ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
// フォロワーが増えると…：広場の予定地の上に「？」と、きらきら
function teaseFx(t) {
  if (t < T.tease || t >= T.danger) return;
  const u = t - T.tease, out = clamp01((T.danger - t) / 0.2);
  _v.set(SQ.x, 4, SQ.z).project(camera);
  const x = (_v.x + 1) / 2 * W, y = Math.min(980, (1 - _v.y) / 2 * H) + Math.sin(t * 4) * 10;
  const s = Math.max(0.01, backOut(clamp01((u - 0.4) / 0.35))) * out;
  if (u > 0.4) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(4, 8, 74, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(0, 0, 74, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fffdf4'; ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#7a4a10'; ctx.font = `700 100px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('？', 2, 6);
    ctx.restore();
  }
  for (let i = 0; i < 7; i++) {
    const ang = i * 0.9 + 0.4, rr = 150 + (i % 3) * 60, ph = (u * 1.4 + i * 0.29) % 1;
    sparkle(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.7, 18 + (i % 2) * 12, Math.sin(ph * Math.PI) * clamp01((u - 0.5) / 0.3) * out);
  }
}
// 何日目かの夜…：まわりを暗く、少し赤く
function dangerFx(t) {
  if (t < T.danger || t >= T.next) return;
  const k = clamp01((t - T.danger) / 0.4);
  ctx.save();
  ctx.fillStyle = `rgba(30, 6, 24, ${0.16 * k})`; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.18, W / 2, H * 0.45, H * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(40, 0, 8, ${0.72 * k})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
const LAB_END = T.town - 0.1; // 名札も「ここに町を作ります」の前に消えきる
window.renderFrame = (t) => {
  cameraAt(t);
  const tgt = new THREE.Vector3(); camera.getWorldDirection(tgt);
  // 地形のチャンクは、カメラの見ている先を中心に（コマごとに全部作り終えてから描く）
  const kk = Math.max(0, -camera.position.y / (tgt.y || -1));
  const cx = camera.position.x + tgt.x * Math.min(kk, 200), cz = camera.position.z + tgt.z * Math.min(kk, 200);
  for (let i = 0; i < 80; i++) { terrain.update({ x: cx, z: cz }); if (!terrain.pending) break; }
  const air = clamp01((camera.position.y - 40) / 60);
  scene.fog.near = lerp(220, 320, air); scene.fog.far = lerp(620, 820, air);
  sky.set(hourAt(t), { x: SQ.x, z: SQ.z });
  sky.follow(camera);
  sun.target.position.set(SQ.x, 0, SQ.z); sun.position.set(SQ.x + sky.sunDir.x * 60, Math.max(8, sky.sunDir.y * 60), SQ.z + sky.sunDir.z * 60);
  if (pondObj) animatePond(pondObj, t);
  // 予定地と、チェストの場所の印
  const siteA = clamp01((t - (T.site + 0.7)) / 0.5);
  disc.material.opacity = 0.5 * siteA;
  stakes.forEach((s, i) => { const k2 = clamp01((t - (T.site + 0.6 + i * 0.04)) / 0.3); s.visible = k2 > 0; s.scale.set(1, Math.max(0.01, backOut(k2)), 1); });
  const chA = clamp01((t - (T.site + 1.9)) / 0.4);
  ghost.visible = chA > 0; ghost.scale.setScalar(1.3 * Math.max(0.01, backOut(chA)));
  pad.material.opacity = 0.45 * chA * (0.75 + 0.25 * Math.sin(t * 5));
  // 予告の夜：森の暗がりに光る目（順に開いて、ときどきまばたき）
  const night = t >= T.danger && t < T.next;
  eyeObjs.forEach((g, i) => {
    const a = t - T.danger - 0.5 - i * 0.3;
    g.visible = night && a > 0;
    if (!g.visible) return;
    const open = Math.min(1, a / 0.18), blink = ((t * 1.3 + i * 0.37) % 1.6) < 0.12 ? 0.12 : 1;
    g.scale.set(1, Math.max(0.05, open * blink), 1);
  });
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  teaseFx(t);
  dangerFx(t);

  // 名札（予定地・チェスト・木・岩・池）
  const lab = (a) => fadeIO(t, a, LAB_END, 0.3);
  callout('広場の予定地', SQ, 1.2, lab(T.site + 0.8), '#b0472c', 60);
  callout('空のチェスト', CHEST, 1.6, lab(T.site + 2.0), '#8a6420', 230);
  callout('木', TREE, 7.5, lab(T.site + 2.9), '#3d7a3a', 90);
  callout('岩', ROCK, 1.6, lab(T.site + 3.5), '#5a5f66', 220);
  if (POND) callout('池', POND, 0.3, lab(T.site + 4.1), '#2f6f9e', 200);
  CAPS.forEach(([a, b, lines, o]) => caption(lines, o.y || SAFE_BOTTOM - 180, o.size || 64, fadeIO(t, a, b), o));
  joinCard(t);
  nextCard(t);
  badges(night);
  counter(t);
  // 始めは白からふわっと
  if (t < 0.5) { ctx.fillStyle = `rgba(255,255,255,${1 - t / 0.5})`; ctx.fillRect(0, 0, W, H); }
};

// 効果音：始めの風・名札がぽん・道具がぽん・しめのチャイム
const SFX = [{ t: 0.1, type: 'whoosh', gain: 1 }, { t: T.site, type: 'whoosh', gain: 0.6 }];
[T.site + 0.8, T.site + 2.0, T.site + 2.9, T.site + 3.5].forEach((t) => SFX.push({ t, type: 'pop', gain: 1 }));
if (POND) SFX.push({ t: T.site + 4.1, type: 'pop', gain: 1 });
SFX.push({ t: T.town + 1.2, type: 'chime', gain: 0.8 });
[T.join + 0.4, T.join + 1.4].forEach((t) => SFX.push({ t, type: 'pop', gain: 0.8 }));
TOOLS.forEach((_, i) => SFX.push({ t: T.join + 2.2 + i * 0.35, type: 'pop', gain: 1 }));
SFX.push({ t: T.tease + 0.4, type: 'chime', gain: 0.7 }); // 予告：きらん
SFX.push({ t: T.danger, type: 'whoosh', gain: 1.0 });      // 予告の夜：森の風
SFX.push({ t: NEXT_IN, type: 'chime', gain: 1 });
SFX.push({ t: NEXT_IN + 1.0, type: 'pop', gain: 0.8 });
SFX.push({ t: NEXT_IN + 1.8, type: 'pop', gain: 0.7 });
window.SFX = SFX;

for (let i = 0; i < 200; i++) { if (Object.values(ICON).every((im) => im.complete)) break; await new Promise((r) => setTimeout(r, 50)); }
window.REEL = { W, H, FPS, DURATION, ready: true, T, day: state.day };
window.renderFrame(0);
