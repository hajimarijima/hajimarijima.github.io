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

// ---------- 岩（最初に見せた動画の形）：灰色の箱 3 つを重ねた岩。鉱石のある岩は小さな色の粒が見える ----------
// たたいている間は形を変えない。掘り切るとくだけて消える
const lamC = (c) => lam('c' + c, () => new THREE.MeshLambertMaterial({ color: c }));
const RK = 1.4; // 最初の版より大きく（村人の背 3.8 に合わせる）
const ROCK_PARTS = [
  { s: [2.4, 1.6, 2.0], p: [0, 0.8, 0], c: 0 },
  { s: [1.4, 1.1, 1.4], p: [0.9, 1.6, -0.2], c: 1 },
  { s: [1.2, 0.8, 1.2], p: [-0.9, 0.4, 0.8], c: 2 },
].map((P) => ({ ...P, s: P.s.map((v) => v * RK), p: P.p.map((v) => v * RK) }));
const ROCK_COL = [0x9a9ea3, 0x8b8f95, 0xa7aaae];
const ORE_HEX = { c: 0x2c2c2f, i: 0xd49d74, g: 0xf0cb36, d: 0x45dcd6 };
const rockOre = (r) => { const m = String(r.blocks || '').match(/[gdic]/g) || []; return ['d', 'g', 'i', 'c'].find((k) => m.includes(k)) || (r.kind === 1 ? 'g' : null); };
const ORE_SPOTS = [[0.6, 1.2, 1.0], [1.15, 0.5, 1.02], [-0.3, 0.95, 1.02]].map((p) => p.map((v) => v * RK));
export const rockScale = (hp) => (hp <= 0 ? 0 : 1); // 削れて小さくなる段階はない
export function makeRock(r) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  for (const P of ROCK_PARTS) cube(body, lamC(ROCK_COL[P.c]), ...P.s, ...P.p);
  const ore = rockOre(r);
  if (ore) ORE_SPOTS.forEach((p, i) => cube(body, lamC(ORE_HEX[ore]), 0.4 * RK * (i ? 0.7 : 1), 0.3 * RK * (i ? 0.7 : 1), 0.4 * RK * (i ? 0.7 : 1), ...p));
  g.userData.rock = { body, max: r.max || 14 };
  g.rotation.y = (h32(r.id) % 628) / 100;
  g.position.set(r.x, 0, r.z);
  setRock(g, r.hp);
  return g;
}
export function setRock(g, hp) { const R = g.userData.rock; if (R) R.body.visible = hp > 0; }

// ---------- 木（最初に見せた動画の形）：茶色の幹に、緑の箱を 3 段＋横の小さな塊。色は平らな 3 色 ----------
// 大きさだけ村人（2 ブロック = 3.8）に合わせて、最初の版の 2.6 倍・幹を少し長く
export const BL = 1.9; // 1 ブロック（村人の背 3.8 の半分）
const TK = 2.6, LIFT = 0.9;
const GREENS = [[0x4f8f3a, 0x5fa344, 0x3f7a30], [0x3f7f45, 0x4e9452, 0x336b39], [0x6a9a3a, 0x7cad46, 0x58852f]];
const TRUNK = 0x7a5230;
const TREE_PARTS = [
  { c: -1, s: [0.5 * TK, 2.2 * TK + LIFT, 0.5 * TK], p: [0, (2.2 * TK + LIFT) / 2, 0] },
  { c: 0, s: [2.4 * TK, 1.2 * TK, 2.4 * TK], p: [0, 2.6 * TK + LIFT, 0] },
  { c: 1, s: [1.8 * TK, 1.0 * TK, 1.8 * TK], p: [0, 3.6 * TK + LIFT, 0] },
  { c: 2, s: [1.0 * TK, 0.7 * TK, 1.0 * TK], p: [0.1 * TK, 4.4 * TK + LIFT, -0.1 * TK] },
  { c: 1, s: [0.5 * TK, 0.5 * TK, 0.5 * TK], p: [-1.1 * TK, 2.2 * TK + LIFT, 0.6 * TK] },
];
export const TREE_LEN = 4.75 * TK + LIFT; // 倒れた時の長さ（てっぺんまで）
export const TREE_LEAF_Y = 2.0 * TK + LIFT; // 葉の下の高さ
const partCol = (P, k) => (P.c < 0 ? TRUNK : (GREENS[k] || GREENS[0])[P.c]);
// ---------- りんごの木：葉の箱の外側に、半分顔を出した赤い実（＋明るい光の角・茶色のへた）。葉の下にぶら下がる実も ----------
//   [x, y, z, 外向き nx, ny, nz]（木の大きさ 1 の時の位置。葉の面から少し外に出す）。実って（appleWait がない）いる時だけ描く
const APPLE = 0xc8262e, APPLE_HI = 0xf2725e, APPLE_DK = 0x8e1a20, APPLE_STEM = 0x4a3218;
const A_FACE = 1.2 * TK + 0.12, A_FACE2 = 0.9 * TK + 0.12, A_Y0 = 2.6 * TK + LIFT, A_Y1 = 3.6 * TK + LIFT, A_BOT = 2.0 * TK + LIFT;
const APPLE_SPOTS = [
  [A_FACE, A_Y0 - 0.5, 1.0, 1, 0, 0], [A_FACE, A_Y0 + 0.7, -1.6, 1, 0, 0], [-A_FACE, A_Y0 + 0.1, -0.8, -1, 0, 0],
  [-0.6, A_Y0 - 0.6, A_FACE, 0, 0, 1], [1.9, A_Y0 + 0.8, A_FACE, 0, 0, 1], [0.9, A_Y0 - 0.2, -A_FACE, 0, 0, -1], [-2.0, A_Y0 + 0.5, -A_FACE, 0, 0, -1],
  [A_FACE2, A_Y1 - 0.2, 0.4, 1, 0, 0], [-0.8, A_Y1 + 0.3, A_FACE2, 0, 0, 1],
  [1.6, A_BOT - 0.43, 0.9, 0, -1, 0], [-1.2, A_BOT - 0.43, -1.5, 0, -1, 0],
];
const A_FACE_L = 1.15 * TK + 0.16, A_YL = 3.1 * TK + LIFT;
const APPLE_SPOTS_LITE = [[A_FACE_L, A_YL - 1.2, 0.8, 1, 0, 0], [-A_FACE_L, A_YL + 0.4, -1, -1, 0, 0], [0.5, A_YL - 0.6, A_FACE_L, 0, 0, 1], [-1.2, A_YL + 0.9, -A_FACE_L, 0, 0, -1]];
// 実 1 つの箱：[色, 大きさ, 中心]。外向きの面の上の角を明るく、下を少し暗く（立体に見えるように）
function appleParts(sp, a) {
  const [x, y, z, nx, ny, nz] = sp, out = [];
  out.push({ c: APPLE, s: [a, a, a], p: [x, y, z] });
  out.push({ c: APPLE_DK, s: [a * 0.7, a * 0.18, a * 0.7], p: [x + nx * 0.04, y - a * 0.5, z + nz * 0.04] });
  const hx = nx ? x + nx * a * 0.42 : x - a * 0.18, hz = nz ? z + nz * a * 0.42 : z - a * 0.18;
  if (!ny) out.push({ c: APPLE_HI, s: [nx ? a * 0.2 : a * 0.28, a * 0.28, nz ? a * 0.2 : a * 0.28], p: [hx, y + a * 0.2, hz] });
  else out.push({ c: APPLE_HI, s: [a * 0.28, a * 0.28, a * 0.2], p: [x - a * 0.18, y + a * 0.15, z + a * 0.42] });
  out.push({ c: APPLE_STEM, s: [a * 0.16, a * 0.36, a * 0.16], p: [x, y + a * 0.6, z] });
  return out;
}
export const hasApples = (t) => t && t.fruit === 'apple' && !t.appleWait;
const appleBoxes = (lite) => (lite ? APPLE_SPOTS_LITE : APPLE_SPOTS).flatMap((sp) => appleParts(sp, lite ? 0.85 : 0.62));
export function makeTree(t) {
  const g = new THREE.Group();
  const s = t.size || 1, k = t.kind || 0;
  const body = new THREE.Group(); g.add(body); // 根元（切り株の上）を軸に倒れる
  let trunk = null;
  for (const P of TREE_PARTS) {
    const m = cube(body, lamC(partCol(P, k)), ...P.s, ...P.p);
    if (P.c < 0) trunk = m;
  }
  let apples = null;
  if (t.fruit === 'apple') { // 倒れる時は実も一緒に（body の子）
    apples = new THREE.Group(); body.add(apples);
    for (const P of appleBoxes(false)) cube(apples, lamC(P.c), ...P.s, ...P.p);
    apples.visible = hasApples(t);
  }
  body.scale.setScalar(s);
  // 切り株：最初の版の切り株（茶色の低い箱・明るい切り口・横に出た根）を幹の太さに合わせる
  const stump = new THREE.Group(); g.add(stump);
  const SW = 0.55 * TK * s, SH = 0.35 * TK * 0.7 * s;
  cube(stump, lamC(TRUNK), SW, SH, SW, 0, SH / 2, 0);
  cube(stump, lamC(0xd8b98a), SW * 0.82, 0.05, SW * 0.82, 0, SH + 0.02, 0, false);
  const root = cube(stump, lamC(0x6b4628), 0.2 * TK * s, 0.12 * TK * s, 0.6 * TK * s, 0.45 * TK * s, 0.06 * TK * s, 0.2 * TK * s); root.rotation.y = 0.5;
  const sapling = new THREE.Group(); g.add(sapling);
  cube(sapling, lamC(TRUNK), 0.15 * 2.2, 0.7 * 2.2, 0.15 * 2.2, 0, 0.35 * 2.2, 0);
  cube(sapling, lamC(GREENS[k][1]), 0.6 * 2.2, 0.5 * 2.2, 0.6 * 2.2, 0, 0.9 * 2.2, 0);
  g.userData.tree = { body, trunk, stump, sapling, apples, size: s, stumpH: SH, leafCol: '#' + GREENS[k][0].toString(16).padStart(6, '0') };
  g.position.set(t.x, 0, t.z);
  setTreeState(g, t.state);
  return g;
}
export function setTreeState(g, state) {
  const T = g.userData.tree; if (!T) return;
  T.body.visible = state === 'tree'; T.stump.visible = state === 'stump'; T.sapling.visible = state === 'sapling';
  T.body.quaternion.identity(); T.body.position.set(0, 0, 0);
}
// 倒れる：u は倒れ始めてからの時間 ÷ 倒れる時間（0..1 で倒れる、1..1.45 で地面で弾む）。
// 根元を軸に一方へ、ゆっくり傾き始めて、だんだん速く倒れる。gone が 0.5 を越えたら消える（切り株は残る）
const _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
export function fallAngle(u) {
  const R = Math.PI / 2 * 0.985;
  if (u <= 0) return 0;
  if (u < 1) return R * Math.pow(u, 2.6);
  const b = (u - 1) / 0.45; // 弾む：1 回目は大きく、2 回目は小さく
  if (b < 1) return R - 0.09 * Math.abs(Math.sin(b * Math.PI * 2)) * (b < 0.5 ? 1 : 0.35);
  return R;
}
export const FALL_END = 1.45; // 弾み終わり（u の値）
export function setTreeFall(g, u, dir, gone = 0) {
  const T = g.userData.tree; if (!T) return;
  T.body.visible = gone < 0.5; T.stump.visible = u > 0; T.sapling.visible = false;
  _d.set(dir.x, 0, dir.z).normalize(); _ax.crossVectors(_up, _d).normalize();
  T.body.quaternion.setFromAxisAngle(_ax, fallAngle(u));
  T.body.position.set(0, T.stumpH * 0.6, 0);
}
export const setTreeCrack = () => {}; // ひびは描かない

// ---------- 遠くの木と、手つかずの岩はまとめて描く（instancing。スマホでも重くならないように） ----------
const UNIT = new THREE.BoxGeometry(1, 1, 1);
// 遠くの木（LOD）：幹と、葉をまとめた 1 つの塊だけ
const TREE_PARTS_LITE = [TREE_PARTS[0], { c: 0, s: [2.3 * TK, 2.2 * TK, 2.3 * TK], p: [0, 3.1 * TK + LIFT, 0] }];
// lite：遠くの木を簡単な形に。shadow：影を落とすか（遠くは落とさない）。t.y があればその高さ（丘の上）に立てる
export function makeForest(trees, { lite = false, shadow = true } = {}) {
  const g = new THREE.Group();
  const o = new THREE.Object3D();
  const groups = {}; // 色 → 行列
  const PARTS = lite ? TREE_PARTS_LITE : TREE_PARTS;
  for (const t of trees) {
    const s = t.size || 1, k = t.kind || 0, y0 = t.y || 0;
    for (const P of PARTS) {
      const c = partCol(P, k);
      o.position.set(t.x + P.p[0] * s, y0 + P.p[1] * s, t.z + P.p[2] * s); o.scale.set(P.s[0] * s, P.s[1] * s, P.s[2] * s); o.updateMatrix();
      (groups[c] = groups[c] || []).push(o.matrix.clone());
    }
  }
  for (const c in groups) {
    const m = new THREE.InstancedMesh(UNIT, lamC(+c), groups[c].length);
    groups[c].forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = shadow; m.receiveShadow = true; m.computeBoundingSphere(); g.add(m);
  }
  return g;
}
export function makeRockField(rocks, { shadow = true } = {}) {
  const g = new THREE.Group(), lists = {};
  const o = new THREE.Object3D(), q = new THREE.Object3D();
  for (const r of rocks) {
    if (!rockScale(r.hp)) continue;
    q.position.set(r.x, r.y || 0, r.z); q.rotation.set(0, (h32(r.id) % 628) / 100, 0); q.updateMatrix();
    const parts = ROCK_PARTS.map((P) => ({ c: ROCK_COL[P.c], s: P.s, p: P.p }));
    const ore = rockOre(r);
    if (ore) ORE_SPOTS.forEach((p, i) => { const k = i ? 0.7 : 1; parts.push({ c: ORE_HEX[ore], s: [0.4 * RK * k, 0.3 * RK * k, 0.4 * RK * k], p }); });
    for (const P of parts) {
      o.position.set(...P.p); o.scale.set(...P.s); o.updateMatrix();
      (lists[P.c] = lists[P.c] || []).push(new THREE.Matrix4().multiplyMatrices(q.matrix, o.matrix));
    }
  }
  for (const c in lists) {
    const m = new THREE.InstancedMesh(UNIT, lamC(+c), lists[c].length);
    lists[c].forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = shadow; m.receiveShadow = true; m.computeBoundingSphere(); g.add(m);
  }
  return g;
}

// ---------- 木・切り株・苗木・岩を、チャンクごとに 1 つのメッシュにまとめる ----------
// 箱を 1 つの形（頂点の色つき）に足していく。下の面（地面に付く面）は作らない。チャンクの一辺は 16 ブロック
const CHUNK_W = 16 * BL;
const BOX_FACES = [ // [法線, 4 つの角（-0.5〜0.5）, 明るさ]
  [[1, 0, 0], [[1, 1, 1], [1, -1, 1], [1, -1, -1], [1, 1, -1]], 0.82], [[-1, 0, 0], [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]], 0.82],
  [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], 1],
  [[0, 0, 1], [[-1, 1, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1]], 0.9], [[0, 0, -1], [[1, 1, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1]], 0.9],
];
function boxesToGeometry(boxes) {
  const pos = new Float32Array(boxes.length * 5 * 6 * 3), nor = new Float32Array(pos.length), col = new Float32Array(pos.length);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
  let k = 0;
  for (const b of boxes) {
    nm.getNormalMatrix(b.m); c.setHex(b.c);
    for (const [N, Q] of BOX_FACES) {
      n.set(...N).applyMatrix3(nm).normalize();
      for (const qi of [0, 1, 2, 0, 2, 3]) {
        v.set(Q[qi][0] * 0.5, Q[qi][1] * 0.5, Q[qi][2] * 0.5).applyMatrix4(b.m);
        pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z; nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; k += 3;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
const STUMP_PARTS = (s) => [
  { c: TRUNK, s: [0.55 * TK * s, 0.35 * TK * 0.7 * s, 0.55 * TK * s], p: [0, 0.35 * TK * 0.7 * s / 2, 0] },
  { c: 0xd8b98a, s: [0.55 * TK * s * 0.82, 0.05, 0.55 * TK * s * 0.82], p: [0, 0.35 * TK * 0.7 * s + 0.02, 0] },
];
const SAPLING_PARTS = (k) => [{ c: TRUNK, s: [0.33, 1.54, 0.33], p: [0, 0.77, 0] }, { c: GREENS[k][1], s: [1.32, 1.1, 1.32], p: [0, 1.98, 0] }];
// 1 つの物の箱（ワールド座標の行列と色）
function objectBoxes(o, lite, out) {
  const M = new THREE.Matrix4(), S = new THREE.Matrix4(), Q = new THREE.Matrix4();
  const push = (P, base) => { S.makeScale(...P.s); M.makeTranslation(...P.p).multiply(S); out.push({ m: new THREE.Matrix4().multiplyMatrices(base, M), c: P.c }); };
  const y0 = o.y || 0;
  if (o.hp !== undefined) { // 岩
    if (!rockScale(o.hp)) return;
    Q.makeRotationY((h32(o.id) % 628) / 100).setPosition(o.x, y0, o.z);
    for (const P of ROCK_PARTS) push({ c: ROCK_COL[P.c], s: P.s, p: P.p }, Q);
    const ore = rockOre(o);
    if (ore) ORE_SPOTS.forEach((p, i) => { const k = i ? 0.7 : 1; push({ c: ORE_HEX[ore], s: [0.4 * RK * k, 0.3 * RK * k, 0.4 * RK * k], p }, Q); });
    return;
  }
  const s = o.size || 1, k = o.kind || 0;
  Q.makeTranslation(o.x, y0, o.z);
  if (o.state === 'stump') { for (const P of STUMP_PARTS(s)) push(P, Q); return; }
  if (o.state === 'sapling') { for (const P of SAPLING_PARTS(k)) push(P, Q); return; }
  if (o.state && o.state !== 'tree') return;
  for (const P of lite ? TREE_PARTS_LITE : TREE_PARTS) push({ c: partCol(P, k), s: P.s.map((v) => v * s), p: P.p.map((v) => v * s) }, Q);
  if (hasApples(o)) for (const P of appleBoxes(lite)) push({ c: P.c, s: P.s.map((v) => v * s), p: P.p.map((v) => v * s) }, Q);
}
const vcMat = () => lam('vcolor', () => new THREE.MeshLambertMaterial({ vertexColors: true }));
// 物の一覧 → チャンクごとの Mesh を入れた Group。lite：遠くの木を簡単な形に。shadow：影を落とすか
export function makeChunkObjects(list, { lite = false, shadow = true } = {}) {
  const g = new THREE.Group(), by = new Map();
  for (const o of list) { const k = Math.floor(o.x / CHUNK_W) + ',' + Math.floor(o.z / CHUNK_W); let a = by.get(k); if (!a) by.set(k, (a = [])); objectBoxes(o, lite, a); }
  for (const boxes of by.values()) {
    if (!boxes.length) continue;
    const m = new THREE.Mesh(boxesToGeometry(boxes), vcMat());
    m.castShadow = shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; g.add(m);
  }
  g.userData.dispose = () => g.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
  return g;
}

// ---------- 整地する前の草と小石 ----------
export function makeDebris(list) {
  const g = new THREE.Group();
  const items = list.map((d) => {
    const o = new THREE.Group();
    if (d.k === 'grass') {
      for (let i = 0; i < 4; i++) cube(o, lamC(i % 2 ? 0x5e9a3c : 0x4f8a32), 0.12, 0.5 + (i % 3) * 0.18, 0.12, (i % 2 - 0.5) * 0.3, 0.3, (Math.floor(i / 2) - 0.5) * 0.3);
      cube(o, lamC(0x6aa648), 0.7, 0.14, 0.7, 0, 0.07, 0);
    } else {
      cube(o, lamC(0x8d9196), 0.55, 0.32, 0.45, 0, 0.16, 0); cube(o, lamC(0xa3a7ab), 0.3, 0.22, 0.3, 0.3, 0.11, 0.25);
    }
    o.scale.setScalar(d.s || 1); o.position.set(d.x, 0, d.z); o.rotation.y = (h32(d.x + ',' + d.z) % 628) / 100; g.add(o);
    return o;
  });
  g.userData.items = items;
  return g;
}

// ---------- チェスト：茶色の木箱に黒い縁と、前の錠（ふたは後ろのちょうつがいで開く） ----------
// 面の絵：板の横すじ・左上が明るく右下が暗い・まわりに黒い縁
const chestSideTex = (k) => canvasTex('chestside' + k, (g, R) => {
  const pal = k === 2 ? ['#a96f33', '#b67a3a', '#9c652e'] : ['#9a612b', '#a86c32', '#8d5826'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pal[Math.floor(R() * 3)]);
  for (const y of k === 2 ? [5, 10] : [4, 9]) for (let x = 1; x < 15; x++) { px(g, x, y, '#6a3f17'); px(g, x, y + 1, '#c08443'); } // 板の継ぎ目と、下の板の明るい縁
  for (let i = 0; i < 6; i++) { const y = 2 + Math.floor(R() * 12), x0 = 2 + Math.floor(R() * 8); for (let x = x0; x < x0 + 3 + R() * 4; x++) px(g, x, y, '#7b4a1d'); } // 木目
  for (let i = 1; i < 15; i++) { px(g, i, 1, '#c98d4a'); px(g, 1, i, '#c08443'); px(g, i, 14, '#5e3612'); px(g, 14, i, '#5e3612'); } // 左上は明るく、右下は暗く
  for (let i = 0; i < 16; i++) { px(g, i, 0, '#1c120a'); px(g, i, 15, '#1c120a'); px(g, 0, i, '#1c120a'); px(g, 15, i, '#1c120a'); } // 黒い縁
});
const chestMats = (k) => lam('chestM' + k, () => new THREE.MeshLambertMaterial({ map: chestSideTex(k) }));
export function makeChest() {
  const g = new THREE.Group();
  const W = 1.3, D = 1.0, HB = 0.62, HL = 0.26, T = 0.07; // 箱の高さ・ふたの高さ・板の厚み
  const side = chestMats(1), top = chestMats(2), inner = lamC(0x3b2410), black = lamC(0x1c120a);
  const metal = lamC(0xc9cdd3), metalD = lamC(0x6f747c), metalL = lamC(0xf2f4f6);
  // 箱：前・後ろ・左右の面は 1 枚の絵（黒い縁つき）。底と中の暗がり
  const bm = [side, side, inner, side, side, side];
  const bb = new THREE.Mesh(geo(W, HB, D), bm); bb.position.y = HB / 2; bb.castShadow = true; bb.receiveShadow = true; g.add(bb);
  cube(g, inner, W - 2 * T, 0.02, D - 2 * T, 0, HB + 0.005, 0, false); // 上から見た中（暗い）
  for (const s of [1, -1]) { cube(g, side, W, 0.012, T, 0, HB + 0.006, s * (D / 2 - T / 2), false); cube(g, side, T, 0.012, D, s * (W / 2 - T / 2), HB + 0.006, 0, false); } // 壁の上の厚み
  // ふた：後ろのちょうつがいを軸に開く
  const lid = new THREE.Group(); lid.position.set(0, HB, -D / 2); g.add(lid);
  const lm = [side, side, top, inner, side, side];
  const lb = new THREE.Mesh(geo(W, HL, D), lm); lb.position.set(0, HL / 2 + 0.012, D / 2); lb.castShadow = true; lb.receiveShadow = true; lid.add(lb);
  // 錠：ふたの前に付いた金具が、箱の縁にかかる
  cube(lid, metalD, 0.24, 0.3, 0.07, 0, 0.0, D + 0.035);
  cube(lid, metal, 0.18, 0.24, 0.07, 0, 0.0, D + 0.05);
  cube(lid, metalL, 0.18, 0.04, 0.07, 0, 0.1, D + 0.052, false); // 上の光
  cube(lid, black, 0.05, 0.08, 0.02, 0, -0.04, D + 0.09, false); // 鍵穴
  // 中身（開けた時に見える。原木・丸石・木の実）
  const inside = new THREE.Group(); g.add(inside);
  cube(inside, lamC(0x8a5a30), 0.36, 0.2, 0.2, -0.3, HB - 0.12, -0.15); cube(inside, lamC(0x8a8e93), 0.24, 0.22, 0.24, 0.12, HB - 0.1, 0.1);
  cube(inside, lamC(0xb8323a), 0.12, 0.1, 0.12, 0.38, HB - 0.06, -0.18);
  g.userData.lid = lid; g.userData.inside = inside;
  return g;
}
export const setChestOpen = (g, a) => { g.userData.lid.rotation.x = -a * 1.75; };

// ---------- 「どこに建てる？」の印（A/B/C の旗） ----------
const markTex = (L, col) => canvasTex('mark' + L + col, (g, R, n) => {
  g.fillStyle = col; g.fillRect(0, 0, n, n);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, n - 10, n, 10);
  g.fillStyle = '#fff'; g.font = `900 ${n * 0.72}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(L, n / 2, n / 2 + 4);
}, 128);
export const MARK_COL = { A: '#d0603e', B: '#3f78b8', C: '#4b9a5e' };
export function makeMarker(L) {
  const g = new THREE.Group();
  cube(g, lamC(0x8a5a33), 0.18, 4.2, 0.18, 0, 2.1, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: markTex(L, MARK_COL[L]), side: THREE.DoubleSide }));
  flag.position.set(0, 4.6, 0); g.add(flag);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.5, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(MARK_COL[L]), transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  g.userData.flag = flag; g.userData.ring = ring;
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
export const SHRINK = 0; // 縮んで消える演出はなし（砕ける粒だけ）

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
  } else if (kind === 'fish' || kind.startsWith('fish_')) {
    // 魚：背は暗い青緑、腹は明るい銀。尾びれと目
    cube(g, lamC(0x5f8fa0), 0.36, 0.08, 0.14, 0, 0.04, 0); cube(g, lamC(0xd8e2e6), 0.34, 0.07, 0.13, 0, -0.03, 0);
    cube(g, lamC(0x48707e), 0.1, 0.14, 0.04, -0.22, 0.01, 0); cube(g, lamC(0x48707e), 0.1, 0.05, 0.03, 0.02, 0.1, 0);
    cube(g, lamC(0x16181c), 0.03, 0.03, 0.15, 0.13, 0.03, 0);
  } else if (kind === 'egg') {
    cube(g, lamC(0xf2e6cc), 0.16, 0.2, 0.16, 0, 0, 0); cube(g, lamC(0xfff8e8), 0.06, 0.06, 0.04, -0.03, 0.05, 0.07);
  } else if (kind === 'milk') {
    cube(g, lamC(0x8a6a48), 0.18, 0.24, 0.18, 0, 0, 0); cube(g, lamC(0xf6f6f2), 0.14, 0.03, 0.14, 0, 0.12, 0);
  } else if (kind === 'wool') {
    cube(g, lamC(0xf1eee6), 0.26, 0.2, 0.26, 0, 0, 0); cube(g, lamC(0xfbfaf6), 0.16, 0.08, 0.16, -0.03, 0.12, -0.03);
  } else if (kind === 'carrot') {
    cube(g, lamC(0xe8742a), 0.08, 0.26, 0.08, 0, 0, 0); cube(g, lamC(0x5aa83c), 0.12, 0.08, 0.04, 0, 0.16, 0);
  } else if (kind === 'potato') {
    cube(g, lamC(0xb8935a), 0.2, 0.15, 0.17, 0, 0, 0); cube(g, lamC(0x8a6a3a), 0.03, 0.03, 0.03, 0.06, 0.07, 0.05);
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
    const FONT = (px) => '900 ' + px + 'px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif';
    g.font = FONT(64); const w0 = g.measureText(text).width; // 長い字は枠に入るまで小さくする
    if (w0 > 236) g.font = FONT(Math.max(28, Math.floor(64 * 236 / w0)));
    g.textAlign = 'center'; g.textBaseline = 'middle';
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
    item(kind, x, y, z, rot = 0, s = 1, rz = 0) { // rz：先に z 軸で傾ける（魚を頭を上にしてぶら下げる時など）
      const m = take('item' + kind, () => itemMesh(kind));
      m.position.set(x, y, z); m.rotation.set(0, rot, rz); m.scale.setScalar(s);
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
