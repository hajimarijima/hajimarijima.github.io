// ブロックでできた岩と木、掘る・切る時の見た目（ひび・かけら・落ちる物・光・置き場の山）。
// トップの地図と動画で共通。テクスチャは 16px のドット絵をここで描く（外の画像は使わない）。
import * as THREE from 'three';

export const B = 0.75;      // 岩のブロック 1 つの大きさ
export const LOG = 0.55;    // 木の幹のブロック
export const LOGS = 4;      // 幹のブロックの数（下から 1 つずつ切る）
export const HITS = 5;      // 1 ブロックを壊すのにたたく回数
export const STAGES = 10;   // ひびの段階（0〜9）

function h32(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = h32(seed); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 16px のテクスチャ ----------
const TEX = {};
function canvasTex(key, draw, size = 16) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, rng('tex:' + key), size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[key] = t);
}
const px = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
export { canvasTex as pixelTex, px, rng as pixelRng };
const pick = (R, a) => a[Math.floor(R() * a.length)];
// 上と左を明るく、下と右を暗く（ブロック 1 つずつが立体に見えるように）
function bevel(g, light, dark) {
  for (let i = 0; i < 16; i++) { px(g, i, 0, light); px(g, 0, i, light); px(g, i, 15, dark); px(g, 15, i, dark); }
}
function stoneBase(g, R) {
  const pal = ['#7d8084', '#888b8f', '#8f9296', '#979a9e', '#a2a5a9', '#74777b'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, pal));
  // 小さな出っぱり：左上が明るく右下に影
  for (let k = 0; k < 5; k++) {
    const x = 1 + Math.floor(R() * 12), y = 1 + Math.floor(R() * 12);
    px(g, x, y, '#b4b7ba'); px(g, x + 1, y, '#a6a9ac'); px(g, x + 1, y + 1, '#65686c'); px(g, x + 2, y + 1, '#5c5f63');
  }
  bevel(g, '#a9acb0', '#5f6266');
}
const ORE_COL = {
  c: ['#2c2c2f', '#505055', '#141416'],
  i: ['#d49d74', '#f2cba8', '#9c6745'],
  g: ['#f0cb36', '#fff4a6', '#b08414'],
  d: ['#45dcd6', '#cffffb', '#17938f'],
};
const SPECK = [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]], [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], [[0, 0], [1, 1], [2, 1], [1, 2]]];
function oreTex(k) {
  return canvasTex('ore' + k, (g, R) => {
    stoneBase(g, R);
    const [m, l, d] = ORE_COL[k];
    const spots = k === 'c' ? [[2, 2], [9, 3], [4, 9], [11, 10]] : [[3, 3], [10, 4], [5, 10], [11, 11]];
    for (const [sx, sy] of spots) {
      const sh = pick(R, SPECK);
      for (const [dx, dy] of sh) px(g, sx + dx, sy + dy, m);
      px(g, sx + sh[0][0], sy + sh[0][1], l); // 光の当たる角
      const e = sh[sh.length - 1]; px(g, sx + e[0], sy + e[1], d); // 影
      px(g, Math.min(15, sx + e[0] + 1), Math.min(15, sy + e[1] + 1), '#55585c');
    }
  });
}
export const stoneTex = () => canvasTex('stone', (g, R) => stoneBase(g, R));
const cobbleTex = () => canvasTex('cobble', (g, R) => {
  const pal = ['#8a8d91', '#9a9da1', '#7c7f83', '#a6a9ad'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, pal));
  // 石と石のすき間（暗い線）と、石の上の明るい縁
  const cells = [[0, 0, 7, 5], [7, 0, 9, 4], [0, 5, 5, 6], [5, 4, 6, 6], [11, 4, 5, 7], [0, 11, 8, 5], [8, 10, 8, 6]];
  for (const [x0, y0, w, h] of cells) {
    for (let i = 0; i < w; i++) { px(g, x0 + i, y0 + h - 1, '#4f5256'); px(g, x0 + i, y0, '#b9bcbf'); }
    for (let j = 0; j < h; j++) { px(g, x0 + w - 1, y0 + j, '#55585c'); px(g, x0, y0 + j, '#b0b3b6'); }
  }
});
const logSideTex = () => canvasTex('logside', (g, R) => {
  for (let x = 0; x < 16; x++) { const c = pick(R, ['#6b4a2b', '#5c3e22', '#77532f', '#634427']); for (let y = 0; y < 16; y++) px(g, x, y, R() < 0.2 ? '#4a321c' : c); }
  for (let k = 0; k < 6; k++) { const x = Math.floor(R() * 15), y = Math.floor(R() * 13); px(g, x, y, '#8a643b'); px(g, x, y + 1, '#3d2916'); px(g, x, y + 2, '#3d2916'); }
});
const logTopTex = () => canvasTex('logtop', (g) => {
  const ring = ['#5c3e22', '#c9a36a', '#b8915a', '#d2ae76', '#a8824d', '#c9a36a', '#b8915a', '#9a7444'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); px(g, x, y, ring[Math.min(7, Math.floor(7.5 - r))] || ring[0]); }
});
const LEAF = [['#4f8f3a', '#3a6f2a', '#6fb04a', '#2d5a22'], ['#3f7f45', '#2f6236', '#5a9c5e', '#244d2a'], ['#6a9a3a', '#557d2c', '#88b850', '#43651f']];
const leafTex = (k) => canvasTex('leaf' + k, (g, R) => {
  const [m, d, l, h] = LEAF[k];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = R(); px(g, x, y, v < 0.12 ? h : v < 0.4 ? d : v < 0.85 ? m : l); }
  bevel(g, LEAF[k][2], LEAF[k][3]);
});
const dirtTex = () => canvasTex('dirt', (g, R) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, ['#7a5636', '#6c4b2e', '#86603d', '#5e4127', '#7f5a38']));
  for (let k = 0; k < 6; k++) px(g, Math.floor(R() * 16), Math.floor(R() * 16), '#9a9a92'); // 小石
});
const grassSideTex = () => canvasTex('grassside', (g, R) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, ['#7a5636', '#6c4b2e', '#86603d', '#5e4127']));
  for (let x = 0; x < 16; x++) { const d = 3 + Math.floor(R() * 2); for (let y = 0; y < d; y++) px(g, x, y, pick(R, ['#6aa64a', '#5b9640', '#78b454'])); }
});
const grassTopTex = () => canvasTex('grasstop', (g, R) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, ['#6aa64a', '#5b9640', '#78b454', '#64a046'])); });
// ひび：中心近くから枝分かれして伸びる線。段階 k は線の先頭から (k+1)/10 だけ描く
let CRACK_PATH = null;
function crackPath() {
  if (CRACK_PATH) return CRACK_PATH;
  const R = rng('crack'), seen = new Set(), pts = [];
  const tips = [[7, 7], [8, 8]];
  const add = (x, y) => { const k = x + ',' + y; if (x < 0 || y < 0 || x > 15 || y > 15 || seen.has(k)) return false; seen.add(k); pts.push([x, y]); return true; };
  add(7, 7); add(8, 8);
  let guard = 0;
  while (pts.length < 72 && guard++ < 900) {
    const i = Math.floor(R() * tips.length), [x, y] = tips[i];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const [dx, dy] = dirs[Math.floor(R() * 8)];
    if (add(x + dx, y + dy)) { tips[i] = [x + dx, y + dy]; if (R() < 0.12 && tips.length < 7) tips.push([x + dx, y + dy]); }
  }
  return (CRACK_PATH = pts);
}
const crackTex = (k) => canvasTex('crack' + k, (g) => {
  g.clearRect(0, 0, 16, 16);
  const pts = crackPath(), n = Math.ceil(((k + 1) / STAGES) * pts.length);
  for (let i = 0; i < n; i++) { const [x, y] = pts[i]; px(g, x, y, 'rgba(24,22,20,0.92)'); if (i % 3 === 0 && x < 15) px(g, x + 1, y, 'rgba(230,230,225,0.35)'); }
});

// ---------- 材料 ----------
const MAT = {};
const lam = (key, mk) => MAT[key] || (MAT[key] = mk());
export function blockMat(k) {
  if (k === 's' || !ORE_COL[k]) return lam('b:s', () => new THREE.MeshLambertMaterial({ map: stoneTex() }));
  return lam('b:' + k, () => new THREE.MeshLambertMaterial({ map: oreTex(k) }));
}
const logMats = () => lam('log', () => { const s = new THREE.MeshLambertMaterial({ map: logSideTex() }), t = new THREE.MeshLambertMaterial({ map: logTopTex() }); return [s, s, t, t, s, s]; });
const leafMat = (k) => lam('leaf' + k, () => new THREE.MeshLambertMaterial({ map: leafTex(k) }));
const dirtMat = () => lam('dirt', () => new THREE.MeshLambertMaterial({ map: dirtTex() }));
const grassMats = () => lam('grass', () => { const s = new THREE.MeshLambertMaterial({ map: grassSideTex() }), t = new THREE.MeshLambertMaterial({ map: grassTopTex() }), d = dirtMat(); return [s, s, t, d, s, s]; });
const crackMat = (k) => lam('crack' + k, () => new THREE.MeshBasicMaterial({ map: crackTex(k), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
const GEO = {};
const geo = (w, h = w, d = w) => { const k = w + ',' + h + ',' + d; return GEO[k] || (GEO[k] = new THREE.BoxGeometry(w, h, d)); };
function cube(g, m, w, h, d, x, y, z, shadow = true) {
  const o = new THREE.Mesh(geo(w, h, d), m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; if (g) g.add(o); return o;
}

// ひびを重ねる（stage < 0 で消す）。ブロックの子にするので一緒に動く
export function setCrack(mesh, stage) {
  let c = mesh.userData.crack;
  if (stage < 0) { if (c) c.visible = false; return; }
  if (!c) {
    const p = mesh.geometry.parameters;
    c = new THREE.Mesh(geo(p.width * 1.01, p.height * 1.01, p.depth * 1.01), crackMat(0));
    c.renderOrder = 2; mesh.add(c); mesh.userData.crack = c;
  }
  c.visible = true; c.material = crackMat(Math.max(0, Math.min(STAGES - 1, stage)));
}

// ---------- 岩 ----------
// 下 3×3、中 2×2、上 1。少ない岩は下の角から減らす。掘る順（0 番目）は上から
function rockSlots(max) {
  const base = [], mid = [], top = [{ x: 0, y: 2.5 * B, z: 0, layer: 2 }];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) base.push({ x: i * B, y: 0.5 * B, z: j * B, layer: 0, ring: Math.abs(i) + Math.abs(j) });
  for (const i of [-0.5, 0.5]) for (const j of [-0.5, 0.5]) mid.push({ x: i * B, y: 1.5 * B, z: j * B, layer: 1 });
  const center = base.filter((p) => p.ring === 0), edge = base.filter((p) => p.ring === 1), corner = base.filter((p) => p.ring === 2);
  const keep = [...center, ...edge, ...mid, ...top, ...corner].slice(0, Math.max(1, Math.min(14, max)));
  const rank = (p) => (p.layer === 2 ? 0 : p.layer === 1 ? 1 : p.ring === 2 ? 2 : p.ring === 1 ? 3 : 4);
  return keep.sort((a, b) => rank(a) - rank(b));
}
export function makeRockBlocks(r) {
  const g = new THREE.Group();
  const max = Math.min(14, r.max);
  const slots = rockSlots(max);
  const kinds = (r.blocks || '').padEnd(max, 's');
  const meshes = slots.map((p, i) => cube(g, blockMat(kinds[i]), B, B, B, p.x, p.y, p.z));
  // 掘った跡：土が見えるへこみ（下の段のブロックがなくなった所）
  const dents = slots.map((p) => { if (p.layer) return null; const d = cube(g, dirtMat(), B * 0.98, 0.05, B * 0.98, p.x, 0.025, p.z, false); d.visible = false; return d; });
  const rim = new THREE.Group();
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== 2 || (Math.abs(i) === 2 && Math.abs(j) === 2)) continue;
    cube(rim, grassMats(), B, 0.3, B, i * B, 0.15, j * B);
  }
  cube(rim, dirtMat(), 3 * B, 0.04, 3 * B, 0, 0.02, 0, false);
  rim.visible = false; g.add(rim);
  g.userData.rock = { meshes, slots, kinds, max, dents, rim };
  g.rotation.y = (h32(r.id) % 628) / 100;
  g.position.set(r.x, 0, r.z);
  setRockHp(g, Math.min(max, r.hp));
  return g;
}
// hp：残りのブロック数。上から順に消える
export function setRockHp(g, hp) {
  const R = g.userData.rock; if (!R) return;
  const gone = R.max - Math.max(0, Math.min(R.max, hp));
  R.meshes.forEach((m, i) => { m.visible = i >= gone; m.scale.setScalar(1); setCrack(m, -1); });
  R.dents.forEach((d, i) => { if (d) d.visible = i < gone; });
  R.rim.visible = gone >= R.max;
}

// ---------- 木 ----------
export function makeTreeBlocks(t) {
  const g = new THREE.Group();
  const k = t.kind || 0;
  const stump = cube(g, logMats(), LOG, 0.3, LOG, 0, 0.15, 0);
  const trunk = new THREE.Group(); g.add(trunk);
  const logs = [];
  for (let i = 0; i < LOGS; i++) logs.push(cube(trunk, logMats(), LOG, LOG, LOG, 0, 0.3 + LOG / 2 + i * LOG, 0));
  const canopy = new THREE.Group(); trunk.add(canopy);
  const top = 0.3 + LOGS * LOG;
  cube(canopy, leafMat(k), 2.4, 1.2, 2.4, 0, top + 0.3, 0);
  cube(canopy, leafMat(k), 1.8, 1.0, 1.8, 0, top + 1.4, 0);
  cube(canopy, leafMat(k), 1.0, 0.7, 1.0, 0.1, top + 2.2, -0.1);
  cube(canopy, leafMat(k), 0.6, 0.6, 0.6, -1.15, top - 0.1, 0.6);
  g.userData.tree = { logs, canopy, trunk, stump, size: t.size || 1, leafCol: LEAF[k][0] };
  g.scale.setScalar(t.size || 1);
  g.position.set(t.x, 0, t.z);
  setTreeCut(g, t.state === 'tree' ? 0 : LOGS);
  return g;
}
// cut：下から切った幹の数（小数で、上の幹が落ちていく途中も表せる）
export function setTreeCut(g, cut, fall = 0) {
  const T = g.userData.tree; if (!T) return;
  const n = Math.floor(cut);
  T.logs.forEach((m, i) => { m.visible = i >= n; m.scale.setScalar(1); setCrack(m, -1); });
  T.trunk.position.y = -(n - fall) * LOG; // 切った分だけ上が落ちる（fall: 0..1 で落ちる途中）
  T.canopy.visible = n < LOGS;
}
export function makeSapling(t) {
  const g = new THREE.Group();
  cube(g, logMats(), 0.15, 0.7, 0.15, 0, 0.35, 0);
  cube(g, leafMat(t.kind || 0), 0.6, 0.5, 0.6, 0, 0.9, 0);
  g.position.set(t.x, 0, t.z);
  return g;
}

// ---------- 遠くの木と、手つかずの岩はまとめて描く（instancing。スマホでも重くならないように） ----------
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const TREE_PARTS = (() => {
  const top = 0.3 + LOGS * LOG, parts = [{ m: 'log', s: [LOG, 0.3, LOG], p: [0, 0.15, 0] }];
  for (let i = 0; i < LOGS; i++) parts.push({ m: 'log', s: [LOG, LOG, LOG], p: [0, 0.3 + LOG / 2 + i * LOG, 0] });
  parts.push({ m: 'leaf', s: [2.4, 1.2, 2.4], p: [0, top + 0.3, 0] }, { m: 'leaf', s: [1.8, 1.0, 1.8], p: [0, top + 1.4, 0] }, { m: 'leaf', s: [1.0, 0.7, 1.0], p: [0.1, top + 2.2, -0.1] }, { m: 'leaf', s: [0.6, 0.6, 0.6], p: [-1.15, top - 0.1, 0.6] });
  return parts;
})();
export function makeForest(trees) {
  const g = new THREE.Group();
  const nLog = trees.length * (LOGS + 1), byKind = [0, 1, 2].map((k) => trees.filter((t) => (t.kind || 0) === k));
  const logs = new THREE.InstancedMesh(UNIT, logMats(), Math.max(1, nLog));
  const leaves = byKind.map((list, k) => new THREE.InstancedMesh(UNIT, leafMat(k), Math.max(1, list.length * 4)));
  const o = new THREE.Object3D();
  let li = 0; const lc = [0, 0, 0];
  for (const t of trees) {
    const s = t.size || 1, k = t.kind || 0;
    for (const P of TREE_PARTS) {
      o.position.set(t.x + P.p[0] * s, P.p[1] * s, t.z + P.p[2] * s); o.scale.set(P.s[0] * s, P.s[1] * s, P.s[2] * s); o.updateMatrix();
      if (P.m === 'log') logs.setMatrixAt(li++, o.matrix); else leaves[k].setMatrixAt(lc[k]++, o.matrix);
    }
  }
  logs.count = li; leaves.forEach((m, k) => { m.count = lc[k]; });
  for (const m of [logs, ...leaves]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); g.add(m); }
  return g;
}
export function makeRockField(rocks) {
  const g = new THREE.Group(), lists = {};
  const o = new THREE.Object3D(), q = new THREE.Object3D();
  for (const r of rocks) {
    const max = Math.min(14, r.max), slots = rockSlots(max), kinds = (r.blocks || '').padEnd(max, 's');
    const gone = max - Math.max(0, Math.min(max, r.hp));
    q.position.set(r.x, 0, r.z); q.rotation.set(0, (h32(r.id) % 628) / 100, 0); q.updateMatrix();
    slots.forEach((p, i) => {
      if (i < gone) return;
      const k = ORE_COL[kinds[i]] ? kinds[i] : 's';
      o.position.set(p.x, p.y, p.z); o.scale.set(B, B, B); o.updateMatrix();
      (lists[k] = lists[k] || []).push(new THREE.Matrix4().multiplyMatrices(q.matrix, o.matrix));
    });
  }
  for (const k in lists) {
    const m = new THREE.InstancedMesh(UNIT, blockMat(k), lists[k].length);
    lists[k].forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); g.add(m);
  }
  return g;
}

// ---------- たたく時間の計算（動画で毎回同じになるよう、時刻だけで決める） ----------
// rate: 1 秒にたたく回数、phase: 振り下ろす位置（character.js の animate と合わせる）
export const DIG = { rate: 1.3, phase: 0.65 }, CHOP = { rate: 1.6, phase: 0.75 };
export function strikeAt(t, { rate, phase }, hits = HITS) {
  const n = t < 0 ? 0 : Math.max(0, Math.floor(t * rate - phase) + 1);
  const last = n > 0 ? (n - 1 + phase) / rate : -1;
  const since = n > 0 ? t - last : 1e9;
  const inBlk = n % hits;
  const broken = Math.floor(n / hits);
  // ひび：1 回たたくたびに 2 段ずつ伸び、最後の 1 回で 9（壊れる）
  const stage = inBlk ? Math.min(STAGES - 2, Math.floor((inBlk - 1 + Math.min(1, since * 6)) * (STAGES - 2) / (hits - 1))) : -1;
  return { n, since, broken, inBlk, stage, last };
}
export const breakTime = (i, { rate, phase }, hits = HITS) => ((i + 1) * hits - 1 + phase) / rate;
export const SHRINK = 0.16; // 壊れる瞬間に少し縮んでから消える

// 落ちた物：はねて落ち、ゆっくり回る。age は壊れてからの秒
export function dropPos(o, seed, age, toward) {
  const R = rng('drop:' + seed);
  const a = R() * Math.PI * 2, sp = 0.9 + R() * 0.6;
  let vx = Math.cos(a) * sp, vz = Math.sin(a) * sp;
  if (toward) { vx = vx * 0.4 + toward.x * 1.1; vz = vz * 0.4 + toward.z * 1.1; }
  const vy = 3.2, gr = 9.8, floor = 0.24;
  const tl = (vy + Math.sqrt(vy * vy + 2 * gr * Math.max(0, o.y - floor))) / gr;
  const tt = Math.min(age, tl);
  const y = age < tl ? o.y + vy * tt - 0.5 * gr * tt * tt : floor + Math.abs(Math.sin((age - tl) * 3)) * 0.06 * Math.exp(-(age - tl) * 2) + 0.05 * Math.sin(age * 2.4) + 0.05;
  return { x: o.x + vx * tt, y, z: o.z + vz * tt, rot: age * 1.6 + R() * 6, landed: age >= tl };
}
// かけら：たたいた面から飛ぶ。dir は打った人の向き（岩から人へ）
export function chipList(o, dir, seed, age, n = 7) {
  if (age < 0 || age > 0.6) return [];
  const R = rng('chip:' + seed), out = [];
  for (let i = 0; i < n; i++) {
    const vx = dir.x * (1.6 + R() * 1.4) + (R() - 0.5) * 2.2, vz = dir.z * (1.6 + R() * 1.4) + (R() - 0.5) * 2.2, vy = 1.6 + R() * 2.4;
    const y = o.y + vy * age - 4.9 * age * age;
    if (y < 0.03) continue;
    out.push({ x: o.x + vx * age, y, z: o.z + vz * age, s: (1 - age / 0.6) * (0.07 + R() * 0.06), r: R() * 6 + age * 9 });
  }
  return out;
}

// ---------- 落ちる物・かけら・光・+1 をまとめて出す（毎フレーム begin → 置く → end） ----------
const ITEM_SIZE = 0.3;
function itemMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'log') cube(g, logMats(), ITEM_SIZE, ITEM_SIZE, ITEM_SIZE, 0, 0, 0);
  else if (kind === 'apple') {
    cube(g, lam('apple', () => new THREE.MeshLambertMaterial({ color: 0xd2343c })), 0.24, 0.22, 0.24, 0, 0, 0);
    cube(g, lam('applehi', () => new THREE.MeshLambertMaterial({ color: 0xf07a72 })), 0.08, 0.06, 0.06, -0.06, 0.07, 0.1);
    cube(g, lam('stem', () => new THREE.MeshLambertMaterial({ color: 0x5a3a1e })), 0.04, 0.1, 0.04, 0, 0.15, 0);
    cube(g, leafMat(0), 0.1, 0.04, 0.07, 0.06, 0.17, 0);
  } else if (kind === 'sapling') {
    cube(g, logMats(), 0.06, 0.24, 0.06, 0, -0.02, 0);
    cube(g, leafMat(0), 0.22, 0.14, 0.22, 0, 0.14, 0);
  } else {
    const m = kind === 'cobble' ? lam('cobble', () => new THREE.MeshLambertMaterial({ map: cobbleTex() })) : blockMat({ coal: 'c', iron: 'i', gold: 'g', diamond: 'd' }[kind] || 's');
    cube(g, m, ITEM_SIZE, ITEM_SIZE, ITEM_SIZE, 0, 0, 0);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function glowTex(col) {
  return canvasTex('glow' + col, (g, R, n) => {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(255,255,255,0.95)'); r.addColorStop(0.25, col); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  }, 64);
}
const sparkTex = () => canvasTex('spark', (g) => { g.clearRect(0, 0, 16, 16); for (let i = 3; i < 13; i++) { px(g, i, 7, '#fff'); px(g, i, 8, '#fff'); px(g, 7, i, '#fff'); px(g, 8, i, '#fff'); } for (const [x, y] of [[6, 6], [9, 6], [6, 9], [9, 9]]) px(g, x, y, '#fffbd0'); });
export const GLOW_COL = { iron: 'rgba(255,196,150,0.75)', gold: 'rgba(255,226,90,0.8)', diamond: 'rgba(110,255,245,0.8)', coal: 'rgba(200,200,200,0.4)', apple: 'rgba(255,150,140,0.6)', sapling: 'rgba(170,255,140,0.6)' };

export function makeFx(scene) {
  const pools = {}, used = {};
  const take = (key, mk) => {
    const p = pools[key] || (pools[key] = []); const u = used[key] || 0;
    if (u >= p.length) { const o = mk(); scene.add(o); p.push(o); }
    used[key] = u + 1; const o = p[u]; o.visible = true; return o;
  };
  const chipMat = (c) => lam('chip' + c, () => new THREE.MeshLambertMaterial({ color: c }));
  const plusCache = {};
  function plusTex(text, col) {
    const k = text + col; if (plusCache[k]) return plusCache[k];
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.font = '900 64px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = 'rgba(20,24,30,0.9)'; g.strokeText(text, 128, 50);
    g.fillStyle = col; g.fillText(text, 128, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (plusCache[k] = t);
  }
  return {
    begin() { for (const k in used) used[k] = 0; },
    end() { for (const k in pools) for (let i = used[k] || 0; i < pools[k].length; i++) pools[k][i].visible = false; },
    chip(c, x, y, z, s, r) {
      const m = take('chip' + c, () => { const o = new THREE.Mesh(geo(1), chipMat(c)); o.castShadow = false; return o; });
      m.position.set(x, y, z); m.scale.setScalar(Math.max(0.001, s)); m.rotation.set(r, r * 0.7, 0);
    },
    chips(list, c) { for (const q of list) this.chip(c, q.x, q.y, q.z, q.s, q.r); },
    item(kind, x, y, z, rot = 0, s = 1) {
      const m = take('item' + kind, () => itemMesh(kind));
      m.position.set(x, y, z); m.rotation.set(0, rot, 0); m.scale.setScalar(s);
    },
    glow(kind, x, y, z, a, time = 0, size = 1) {
      const col = GLOW_COL[kind] || GLOW_COL.iron;
      const s = take('glow' + kind, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(col), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
      s.position.set(x, y, z); s.material.opacity = a; s.scale.setScalar(size * (1.5 + 0.15 * Math.sin(time * 5)));
      for (let i = 0; i < 4; i++) { // きらきら
        const sp = take('spark', () => new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
        const an = time * 1.7 + i * Math.PI / 2, rr = 0.42 * size;
        const tw = 0.5 + 0.5 * Math.sin(time * 7 + i * 2.1);
        sp.position.set(x + Math.cos(an) * rr, y + 0.1 + Math.sin(time * 3 + i) * 0.18 * size, z + Math.sin(an) * rr);
        sp.material.opacity = a * tw; sp.scale.setScalar(0.22 * size * (0.6 + tw * 0.6));
      }
    },
    plus(text, x, y, z, a, col = '#fff6c8', size = 1) {
      const s = take('plus:' + text + col, () => { const o = new THREE.Sprite(new THREE.SpriteMaterial({ map: plusTex(text, col), transparent: true, depthWrite: false, depthTest: false })); o.renderOrder = 10; return o; });
      s.position.set(x, y, z); s.material.opacity = a; s.scale.set(1.6 * size, 0.6 * size, 1);
    },
  };
}

// ---------- 倉庫の前の山：置くたびに高くなる ----------
export function makePile(kind) {
  const g = new THREE.Group();
  const cells = [];
  const S = 0.42;
  for (let l = 0; l < 4; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (l === 3 && (i !== 1 || j !== 1)) continue;
    const m = itemMesh(kind); m.scale.setScalar(S / ITEM_SIZE);
    m.position.set((i - 1) * S * (l === 2 ? 0.75 : 1), S / 2 + l * S, (j - 1) * S * (l === 2 ? 0.75 : 1));
    m.visible = false; g.add(m); cells.push(m);
  }
  g.userData.pile = cells;
  return g;
}
export function setPile(g, n) { g.userData.pile.forEach((m, i) => { m.visible = i < n; }); }
export const PILE_MAX = 28;
