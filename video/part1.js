// リール「パート 1：0 日目」（縦 1080×1920・27 秒）。window.renderFrame(t) で t 秒のコマを描く。
// tools/render_video.js --page video/part1.html --name part1_day0 で書き出す。
// 中身は本番の 0 日目（data/world.json をそのまま読む。書きかえない）。村人は 0 人、名前は出さない。
// 順番：空から島（朝焼け）→ 広場の予定地・チェストの場所・木・岩 → 「ここに町を作ります」→ 参加の仕方と最初の道具 4 つ → 「住みたい」の呼びかけ＋明日の小さな予告（夕焼け。1 日目の A・B・C の中身はまだ出さない）
import * as THREE from 'three';
import { makeSky } from '../js/daynight.js';
import { makeTerrain, BLOCK } from '../js/terrain_gen.js';
import { makeTerrainView } from '../js/terrain.js';
import { makeChunkObjects, makeDebris, makeChest } from '../js/blocks.js';
import { makeBush } from '../js/world3d.js';
import { decodeWorld } from '../js/tilemap.js';

const W = 1080, H = 1920, FPS = 30, DURATION = 27;
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
const TOOLS = (config.startTools.options || []).filter((o) => !o.needsEnemies).slice(0, 4);

// ---------- 時間割 ----------
const T = { sky: 0, site: 6.5, town: 12.5, join: 16, next: 22.5 };
function hourAt(t) {
  if (t < T.site) return lerp(6.2, 7.6, t / T.site);           // 朝焼け
  if (t < T.join) return lerp(9.5, 12, (t - T.site) / (T.join - T.site));
  if (t < T.next) return lerp(15.6, 17.2, (t - T.join) / (T.next - T.join));
  return lerp(17.4, 18.5, (t - T.next) / (DURATION - T.next)); // 夕焼け
}

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl'; document.body.appendChild(renderer.domElement);
const out = document.getElementById('out'); const ctx = out.getContext('2d');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd9ea, 150, 380);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.3, 900);
const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.9); scene.add(sun.target); scene.add(sun);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
sun.shadow.bias = -0.0005;

// どこまでも続く地形（丘・山・川・湖・海）。町の中は平ら
const TC = config.terrain || {};
const gen = makeTerrain({ seed: TC.seed || 'town', seaZ: world.seaZ, zone: { x0: -112, x1: 112, z0: -112, z1: world.seaZ + 2 }, keepOut: [], keepR: TC.clearBlocks ?? 4 });
const terrain = makeTerrainView(scene, gen, { radius: 10, lod: [3, 6], perFrame: 400, treeNear: 4, rockNear: 4, shadow: true });
// 町の木・岩（本番の 0 日目の配置）・茂み・まん中の草と小石
const trees = (world.trees || []).filter((t) => !t.gone), rocks = (world.rocks || []).filter((r) => r.hp > 0);
scene.add(makeChunkObjects(trees.concat(rocks), { shadow: true }));
for (const b of world.bushes || []) scene.add(makeBush(b));
scene.add(makeDebris(world.debris || []));

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
// チェストの場所：すけたチェストと、足もとの四角
const ghost = makeChest(); ghost.position.set(CHEST.x, 0, CHEST.z); ghost.rotation.y = Math.atan2(-CHEST.x, -(CHEST.z + 1)); ghost.scale.setScalar(1.3);
ghost.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.55; c.depthWrite = false; return c; }); if (o.material.length === 1) o.material = o.material[0]; } });
scene.add(ghost);
const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.0, depthWrite: false }));
pad.rotation.x = -Math.PI / 2; pad.position.set(CHEST.x, 0.07, CHEST.z); scene.add(pad);

const sky = makeSky(scene, { hemi, sun, sunDist: 60, radius: 420, maxLights: 1, dome: true, camera });

// 名札を付ける木と岩（広場にいちばん近いもの）
const near = (list, f = () => true) => list.filter(f).sort((a, b) => Math.hypot(a.x - SQ.x, a.z - SQ.z) - Math.hypot(b.x - SQ.x, b.z - SQ.z))[0];

// ---------- カメラ ----------
const look = (c) => { camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); return c; };
const lerpCam = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
// 見る点は広場より少し奥（off）。広場が画面の下のほうに来て、手前の木で隠れにくい
const orbit = (a, r, h, ty = 0.5, off = 7) => [SQ.x + Math.sin(a) * r, h, SQ.z + Math.cos(a) * r, SQ.x - Math.sin(a) * off, ty, SQ.z - Math.cos(a) * off];
const CAM = {
  s0: [-30, 80, 230, 10, 6, 40],        // 海の上の低めの所から、島の山と川のほうへ
  s1: [40, 70, 120, 0, 0, -30],
  s2: orbit(0.5, 40, 58, 0),
  site0: orbit(0.42, 26, 44, 0),
  site1: orbit(0.1, 21, 37, 0),
  town1: orbit(-0.3, 30, 46, 0),
  join1: orbit(-0.7, 42, 58, 0),
  next1: [SQ.x + 70, 46, SQ.z + 60, SQ.x - 90, 6, SQ.z - 50], // 東から西の夕日のほうを見る
};
function cameraAt(t) {
  if (t < T.site) { const k = t / T.site; return k < 0.55 ? look(lerpCam(CAM.s0, CAM.s1, ease(k / 0.55))) : look(lerpCam(CAM.s1, CAM.s2, ease((k - 0.55) / 0.45))); }
  if (t < T.town) { const k = (t - T.site) / (T.town - T.site); return k < 0.25 ? look(lerpCam(CAM.s2, CAM.site0, ease(k / 0.25))) : look(lerpCam(CAM.site0, CAM.site1, ease((k - 0.25) / 0.75))); }
  if (t < T.join) return look(lerpCam(CAM.site1, CAM.town1, ease((t - T.town) / (T.join - T.town))));
  if (t < T.next) return look(lerpCam(CAM.town1, CAM.join1, ease((t - T.join) / (T.next - T.join))));
  return look(lerpCam(CAM.join1, CAM.next1, ease((t - T.next) / (DURATION - T.next))));
}

// 名札を付ける木と岩：名札が出る時のカメラで、画面のまん中あたり（上の札や字幕にかからない所）に見えるもの
const onScreen = (p, y, t) => { cameraAt(t); camera.updateMatrixWorld(true); const v = new THREE.Vector3(p.x, y, p.z).project(camera); const x = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H; return v.z < 1 && x > 180 && x < W - 180 && sy > 620 && sy < 1250; };
const pickNear = (list, y, t, used) => list.filter((o) => Math.hypot(o.x - SQ.x, o.z - SQ.z) > SQ.r + 1.5 && onScreen(o, y, t) && (!used || Math.hypot(o.x - used.x, o.z - used.z) > 6)).sort((a, b) => Math.hypot(a.x - SQ.x, a.z - SQ.z) - Math.hypot(b.x - SQ.x, b.z - SQ.z))[0];
const TREE = pickNear(trees.filter((t) => (t.state || 'tree') === 'tree'), 7.5, T.site + 3.6) || { x: SQ.x - 10, z: SQ.z - 4 };
const ROCK = pickNear(rocks, 1.6, T.site + 4.4, TREE) || { x: SQ.x + 10, z: SQ.z - 4 };

// ---------- 文字 ----------
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function caption(lines, y, size, alpha = 1, opts = {}) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lh = size * 1.3, wmax = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.fillStyle = opts.bg || 'rgba(24, 36, 28, 0.66)';
  roundRect(W / 2 - wmax / 2 - 44, y - lh / 2 - 22, wmax + 88, lh * lines.length + 44, 34); ctx.fill();
  lines.forEach((l, i) => {
    const yy = y + i * lh;
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(l, W / 2, yy);
    ctx.fillStyle = (opts.colors && opts.colors[i]) || opts.color || '#fffdf4'; ctx.fillText(l, W / 2, yy);
  });
  ctx.restore();
}
const fadeIO = (t, a, b, f = 0.3) => Math.min(clamp01((t - a) / f), clamp01((b - t) / f));
// 左上：島の名前とパート 1・0 日目
function badges() {
  ctx.save(); ctx.textBaseline = 'middle';
  ctx.font = `700 46px ${FONT}`;
  const p = 'はじまり島　パート 1', pw = ctx.measureText(p).width;
  ctx.fillStyle = 'rgba(255, 224, 138, 0.96)'; roundRect(56, SAFE_TOP, pw + 56, 76, 38); ctx.fill();
  ctx.fillStyle = '#2f2a1a'; ctx.fillText(p, 84, SAFE_TOP + 39);
  ctx.font = `700 84px ${FONT}`;
  const d = '0日目', dw = ctx.measureText(d).width;
  ctx.fillStyle = 'rgba(47, 74, 55, 0.92)'; roundRect(56, SAFE_TOP + 92, dw + 72, 124, 62); ctx.fill();
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
  if (alpha <= 0) return;
  _v.set(p.x, y, p.z).project(camera);
  if (_v.z > 1) return;
  const x = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H, s = backOut(clamp01(alpha * 1.4)) || 0.01;
  ctx.save(); ctx.globalAlpha = clamp01(alpha * 2);
  ctx.strokeStyle = 'rgba(255,253,244,0.95)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x, sy - lift * s); ctx.stroke();
  ctx.fillStyle = '#fffdf4'; ctx.beginPath(); ctx.arc(x, sy, 10, 0, Math.PI * 2); ctx.fill();
  ctx.translate(x, sy - lift * s); ctx.scale(s, s);
  ctx.font = `700 54px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,253,244,0.96)'; roundRect(-w / 2 - 34, -86, w + 68, 92, 46); ctx.fill();
  ctx.fillStyle = color; ctx.fillText(text, 0, -40);
  ctx.restore();
}
// 道具の絵（アイコンの 16×16 をそのまま大きく）
const ICON = {};
for (const o of TOOLS) { const im = new Image(); im.src = '../icons/' + o.item + '.png'; ICON[o.id] = im; }
function joinCard(t) {
  const a = fadeIO(t, T.join + 0.05, T.next - 0.1, 0.35);
  if (a <= 0) return;
  const x = 70, w = W - 140, y = 760, h = 820;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(x + 4, y + 8, w, h, 44); ctx.fill();
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 44); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7a6a4a'; ctx.font = `700 46px ${FONT}`; ctx.fillText('参加の仕方', W / 2, y + 70);
  const step = (t0) => clamp01((t - t0) / 0.3);
  // 1：コメントに『住みたい』
  let k = step(T.join + 0.4);
  if (k > 0) {
    ctx.globalAlpha = a * k;
    ctx.fillStyle = '#2f4a37'; ctx.font = `700 64px ${FONT}`; ctx.fillText('コメントに', W / 2, y + 160);
    ctx.fillStyle = '#c0392b'; ctx.font = `700 84px ${FONT}`; ctx.fillText('『住みたい』', W / 2, y + 255);
  }
  // 2：道具を書くと、その道具で始まる
  k = step(T.join + 1.6);
  if (k > 0) {
    ctx.globalAlpha = a * k;
    ctx.fillStyle = '#2f4a37'; ctx.font = `700 50px ${FONT}`; ctx.fillText('道具を書くと、その道具で始まる', W / 2, y + 370);
    ctx.fillStyle = '#efe7d3'; roundRect(x + 90, y + 410, w - 180, 84, 42); ctx.fill();
    ctx.fillStyle = '#5a4a2a'; ctx.font = `700 46px ${FONT}`; ctx.fillText('例：住みたい ピッケル', W / 2, y + 452);
  }
  // 3：最初の道具 4 つ
  const n = TOOLS.length, cw = 190, gx = (w - cw * n) / (n + 1);
  TOOLS.forEach((o, i) => {
    const kk = clamp01((t - (T.join + 2.8 + i * 0.3)) / 0.35);
    if (kk <= 0) return;
    const s = backOut(kk), cx = x + gx + i * (cw + gx) + cw / 2, cy = y + 640;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.fillStyle = '#8b8b8b'; roundRect(-cw / 2, -cw / 2 - 20, cw, cw, 18); ctx.fill();
    ctx.fillStyle = '#6f6f6f'; roundRect(-cw / 2 + 8, -cw / 2 - 12, cw - 16, cw - 16, 12); ctx.fill();
    ctx.imageSmoothingEnabled = false;
    if (ICON[o.id].complete && ICON[o.id].naturalWidth) ctx.drawImage(ICON[o.id], -72, -92, 144, 144);
    ctx.fillStyle = '#2f4a37'; ctx.font = `700 40px ${FONT}`; ctx.fillText(o.label, 0, cw / 2 + 30);
    ctx.restore();
  });
  ctx.restore();
}
function nextCard(t) {
  // しめ：「住みたい」の呼びかけを大きく。下に小さく明日の予告（選ぶ中身は出さない）
  const a = clamp01((t - T.next - 0.4) / 0.4);
  if (a <= 0) return;
  ctx.fillStyle = `rgba(12, 16, 24, ${0.32 * a})`; ctx.fillRect(0, 0, W, H);
  const s = backOut(a) || 0.01, x = 60, w = W - 120, y = 640, h = 620;
  ctx.save(); ctx.globalAlpha = clamp01(a * 1.5);
  ctx.translate(W / 2, y + h / 2); ctx.scale(s, s); ctx.translate(-W / 2, -(y + h / 2));
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; roundRect(x + 4, y + 10, w, h, 48); ctx.fill();
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 48); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2f4a37'; ctx.font = `700 76px ${FONT}`; ctx.fillText('コメントに', W / 2, y + 120);
  ctx.fillStyle = '#c0392b'; ctx.font = `700 120px ${FONT}`; ctx.fillText('『住みたい』', W / 2, y + 270);
  ctx.fillStyle = '#2f4a37'; ctx.font = `700 76px ${FONT}`; ctx.fillText('で、はじまり島の村人に', W / 2, y + 430);
  // 押したくなる小さな矢印（コメント欄の方＝下）
  const bob = Math.sin(t * 6) * 8;
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(W / 2 - 34, y + 520 + bob); ctx.lineTo(W / 2 + 34, y + 520 + bob); ctx.lineTo(W / 2, y + 566 + bob); ctx.closePath(); ctx.fill();
  ctx.restore();
  const b = clamp01((t - T.next - 1.6) / 0.4);
  caption(['明日 1 日目、みんなで A・B・C から選ぶ'], y + h + 130, 46, b, { color: '#ffe08a' });
}

// ---------- 1 コマ ----------
const CAPS = [
  [0.3, 5.9, ['はじまり島'], { y: H / 2 + 90, size: 150, color: '#ffe08a' }],
  [0.9, 5.9, ['まだ、だれもいない島'], { y: H / 2 + 300, size: 76 }],
  [T.site + 0.3, T.town - 0.1, ['ここが、村のまん中になる所'], {}],
  [T.town + 0.2, T.join - 0.1, ['ここに町を作ります', '村人は 0 人'], { y: SAFE_BOTTOM - 260, size: 74, colors: ['#fffdf4', '#ffe08a'] }],
];
window.renderFrame = (t) => {
  cameraAt(t);
  const tgt = new THREE.Vector3(); camera.getWorldDirection(tgt);
  // 地形のチャンクは、カメラの見ている先を中心に（コマごとに全部作り終えてから描く）
  const k = Math.max(0, -camera.position.y / (tgt.y || -1));
  const cx = camera.position.x + tgt.x * Math.min(k, 220), cz = camera.position.z + tgt.z * Math.min(k, 220);
  for (let i = 0; i < 60; i++) { terrain.update({ x: cx, z: cz }); if (!terrain.pending) break; }
  // 空からの所は霧を遠くに
  const air = clamp01((camera.position.y - 40) / 110);
  scene.fog.near = lerp(150, 200, air); scene.fog.far = lerp(380, 460, air);
  sky.set(hourAt(t), { x: SQ.x, z: SQ.z });
  sky.follow(camera);
  sun.target.position.set(SQ.x, 0, SQ.z); sun.position.set(SQ.x + sky.sunDir.x * 60, Math.max(8, sky.sunDir.y * 60), SQ.z + sky.sunDir.z * 60);
  // 予定地と、チェストの場所の印
  const siteA = clamp01((t - (T.site + 0.7)) / 0.5);
  disc.material.opacity = 0.32 * siteA;
  stakes.forEach((s, i) => { const kk = clamp01((t - (T.site + 0.6 + i * 0.04)) / 0.3); s.visible = kk > 0; s.scale.set(1, Math.max(0.01, backOut(kk)), 1); });
  const chA = clamp01((t - (T.site + 1.9)) / 0.4);
  ghost.visible = chA > 0; ghost.scale.setScalar(1.3 * Math.max(0.01, backOut(chA)));
  pad.material.opacity = 0.45 * chA * (0.75 + 0.25 * Math.sin(t * 5));
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);

  // 名札（予定地・チェスト・木・岩）
  const lab = (a) => fadeIO(t, a, T.town + 0.4, 0.3);
  callout('広場の予定地', SQ, 1.2, lab(T.site + 0.8), '#b0472c', 220);
  callout('チェストの場所', CHEST, 1.6, lab(T.site + 2.0), '#8a6420', 140);
  callout('木', TREE, 7.5, lab(T.site + 3.0), '#3d7a3a', 90);
  callout('岩', ROCK, 1.6, lab(T.site + 3.8), '#5a5f66', 120);
  CAPS.forEach(([a, b, lines, o]) => caption(lines, o.y || SAFE_BOTTOM - 180, o.size || 64, fadeIO(t, a, b), o));
  joinCard(t);
  nextCard(t);
  badges();
  counter(t);
  // 始めは白からふわっと
  if (t < 0.5) { ctx.fillStyle = `rgba(255,255,255,${1 - t / 0.5})`; ctx.fillRect(0, 0, W, H); }
};

// 効果音：始めの風・名札がぽん・道具がぽん・予告のチャイム
const SFX = [{ t: 0.1, type: 'whoosh', gain: 1 }, { t: T.site, type: 'whoosh', gain: 0.6 }];
[T.site + 0.8, T.site + 2.0, T.site + 3.0, T.site + 3.8].forEach((t) => SFX.push({ t, type: 'pop', gain: 1 }));
SFX.push({ t: T.town + 1.2, type: 'chime', gain: 0.8 });
[T.join + 0.4, T.join + 1.6].forEach((t) => SFX.push({ t, type: 'pop', gain: 0.8 }));
TOOLS.forEach((_, i) => SFX.push({ t: T.join + 2.8 + i * 0.3, type: 'pop', gain: 1 }));
SFX.push({ t: T.next + 0.4, type: 'chime', gain: 1 });
SFX.push({ t: T.next + 1.6, type: 'pop', gain: 0.8 });
window.SFX = SFX;

for (let i = 0; i < 200; i++) { if (Object.values(ICON).every((im) => im.complete)) break; await new Promise((r) => setTimeout(r, 50)); }
window.REEL = { W, H, FPS, DURATION, ready: true, T, day: state.day };
window.renderFrame(0);
