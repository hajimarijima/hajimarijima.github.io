#!/usr/bin/env node
'use strict';
// 防具（かんむり・よろい・すねあて・くつ × 革・鎖・鉄・金・ダイヤ）とストーン（5 色・ユニーク）・かけらのアイコン（16x16 のドット絵）。
// 平面的にしない：材料ごとに縁からの距離で「ふくらみ」を作り、左上からの光で陰をつける。宝石は面（ファセット）ごとに明るさを変える。
// 頭はかんむり（兜で顔をかくさない）。使い方: node tools/gen_gear_icons.js  → icons/armor_*.png・stone_*.png（GEAR_SHEET=パス で 8 倍の見本も）
const fs = require('fs');
const path = require('path');
const { writePNG } = require('./png');
const { hashStr } = require('./rand');

const OUT = path.join(__dirname, '..', 'icons');
const S = 16;
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function tone(c, f) {
  if (f >= 1) { const k = f - 1; return [c[0] * f + k * 50, c[1] * f + k * 34, c[2] * f + k * 6]; }
  const k = 1 - f; return [c[0] * f - k * 8, c[1] * f - k * 4, c[2] * f + k * 30];
}
const noise = (seed, x, y) => ((hashStr(seed + ':' + x + ',' + y) % 1000) / 1000) * 2 - 1;
const canvas = () => new Uint8Array(S * S * 4);
function put(px, x, y, c, a = 255) { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = clamp(c[0]); px[i + 1] = clamp(c[1]); px[i + 2] = clamp(c[2]); px[i + 3] = a; }
const grid = (rows) => { const g = Array(S * S).fill(null); rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') g[y * S + x] = ch; })); return g; };

// 材料ごとのふくらみ＋左上の光（tools/gen_icons.js の puffy と同じ考え）
function puffy(px, g, mats, seed) {
  const idx = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : g[y * S + x]);
  const d = new Array(S * S).fill(0);
  for (let i = 0; i < S * S; i++) if (g[i]) d[i] = 99;
  for (let pass = 0; pass < 6; pass++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; if (!g[i]) continue;
    let m = 99;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = idx(x + dx, y + dy); const dn = n === g[i] ? d[(y + dy) * S + x + dx] : 0; m = Math.min(m, dn + 1); }
    d[i] = Math.min(d[i], m);
  }
  const z = (x, y) => { const n = idx(x, y); if (!n) return 0; const M = mats[n]; return Math.sqrt(Math.min(d[y * S + x], M.flat ? 1.5 : 3) / 3) + (M.lift || 0); };
  const Lx = -0.55, Ly = -0.65, Lz = 0.52;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = idx(x, y); if (!k) continue;
    const M = mats[k];
    const nx = -(z(x + 1, y) - z(x - 1, y)) * 1.3, ny = -(z(x, y + 1) - z(x, y - 1)) * 1.3, nz = 0.6;
    const lam = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / Math.hypot(nx, ny, nz));
    let f = 0.62 + 0.62 * lam;
    if (!idx(x, y - 1) || !idx(x - 1, y)) f *= 1.12;
    if (!idx(x, y + 1) || !idx(x + 1, y)) f *= 0.62;
    if (M.tex) f *= M.tex(x, y, d[y * S + x]);
    let col = tone(M.c, f * (1 + noise(seed, x, y) * (M.grain || 0.04)));
    if (M.shine && lam > 0.84 && d[y * S + x] >= 2) col = col.map((v) => v + (255 - v) * M.shine);
    const outer = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !idx(x + dx, y + dy));
    if (outer && (!idx(x + 1, y) || !idx(x, y + 1))) col = tone(M.c, 0.42);
    put(px, x, y, col);
  }
}
// 外側に 1px の暗い縁（白い背景でも形が見える）
function rim(px, c) {
  const a = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : px[(y * S + x) * 4 + 3]);
  const add = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!a(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => a(x + dx, y + dy))) add.push([x, y]);
  for (const [x, y] of add) put(px, x, y, c, 255);
}

// ---------- 防具 ----------
const MAT = {
  leather: { c: '#9a6234', trim: '#6e4120', grain: 0.07, tex: (x, y) => 1 + ((x * 7 + y * 3) % 5 === 0 ? -0.06 : 0), rim: '#2a170a' },
  chain: { c: '#8e9399', trim: '#6c7177', grain: 0.03, tex: (x, y, d) => (d >= 2 && (x + y) % 2 === 0 ? 0.72 : 1.04), rim: '#1f2226' },
  iron: { c: '#d3d8de', trim: '#a9b0b8', shine: 0.5, grain: 0.02, rim: '#3a4047' },
  gold: { c: '#efb726', trim: '#c4870c', shine: 0.55, grain: 0.02, rim: '#4e2f02' },
  diamond: { c: '#45d6cf', trim: '#1aa3a6', shine: 0.6, grain: 0.02, rim: '#063a40' },
};
const GEM = { leather: '#3f8fe6', chain: '#4cc35a', iron: '#3f8fe6', gold: '#e0303a', diamond: '#f4f1ff' };
const SHAPE = {
  // かんむり：とがった 3 つの先（先に玉）・下に帯・帯に宝石。顔をかくさない形
  head: [
    '................',
    '................',
    '.tt....tt....tt.',
    '.mm....mm....mm.',
    '.mm...mmmm...mm.',
    '.mmm..mmmm..mmm.',
    '.mmmm.mmmm.mmmm.',
    '.mmmmmmmmmmmmmm.',
    '.mmmmmmmmmmmmmm.',
    '.mmmmmmmmmmmmmm.',
    '.bbbbbbbbbbbbbb.',
    '.bggbbbggbbbggb.',
    '.bggbbbggbbbggb.',
    '.bbbbbbbbbbbbbb.',
    '................',
    '................',
  ],
  chest: [
    '................',
    '.mmmm......mmmm.',
    '.mmmmm....mmmmm.',
    '.mmmmmmmmmmmmmm.',
    '.mmmmmmmmmmmmmm.',
    '..mmmmmmmmmmmm..',
    '...mmmmddmmmm...',
    '...mmmmddmmmm...',
    '...mmmmddmmmm...',
    '...mmmmddmmmm...',
    '...mmmmddmmmm...',
    '...mmmmmmmmmm...',
    '...bbbbbbbbbb...',
    '...bbbbbbbbbb...',
    '................',
    '................',
  ],
  legs: [
    '................',
    '..bbbbbbbbbbbb..',
    '..bbbbbbbbbbbb..',
    '..mmmmmmmmmmmm..',
    '..mmmmmmmmmmmm..',
    '..mmmmm..mmmmm..',
    '..mmmmm..mmmmm..',
    '..mmmmm..mmmmm..',
    '..ddddd..ddddd..',
    '..ddddd..ddddd..',
    '..mmmmm..mmmmm..',
    '..mmmmm..mmmmm..',
    '..mmmmm..mmmmm..',
    '..mmmmm..mmmmm..',
    '................',
    '................',
  ],
  feet: [ // 2 足：手前（左下）と、少しうしろ（右上・少し暗い）
    '................',
    '................',
    '.......cccc.....',
    '.......nnnn.....',
    '.......nnnn.....',
    '.bbbb..nnnn.....',
    '.mmmm..nnnnnn...',
    '.mmmm..nnnnnnn..',
    '.mmmm..rrrrrrr..',
    '.mmmm...........',
    '.mmmmmmm........',
    '.mmmmmmmm.......',
    '.ssssssss.......',
    '................',
    '................',
    '................',
  ],
};
function armor(px, part, mat) {
  const M = MAT[mat], c = hex(M.c), tr = hex(M.trim);
  const mats = { m: { c, shine: M.shine, grain: M.grain, tex: M.tex }, b: { c: tone(tr, 1.08), shine: M.shine, grain: M.grain, lift: 0.15 }, d: { c: tone(c, 0.86), shine: (M.shine || 0) * 0.6, flat: true, tex: M.tex }, t: { c: mat === 'leather' ? hex('#c9a46a') : tone(c, 1.1), shine: 0.7 }, g: { c: hex(GEM[mat]), shine: 0.8, flat: true }, s: { c: mat === 'leather' ? hex('#4a2c16') : tone(tr, 0.7), flat: true } };
  Object.assign(mats, { n: { c: tone(c, 0.8), shine: (M.shine || 0) * 0.5, grain: M.grain, tex: M.tex }, c: { c: tone(tr, 0.9), shine: (M.shine || 0) * 0.5 }, r: { c: tone(mats.s.c, 0.85), flat: true } });
  if (part === 'head' && mat === 'leather') mats.t = { c: hex('#d9b26a'), shine: 0.5 }; // 革のかんむりの先は真ちゅうのびょう
  puffy(px, grid(SHAPE[part]), mats, part + mat);
  // 革はぬい目（明るい点線）
  if (mat === 'leather') { const g = grid(SHAPE[part]); for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) if (g[y * S + x] === 'b' && g[(y - 1) * S + x] === 'b' && g[(y + 1) * S + x] !== 'b' && x % 2 === 0) put(px, x, y - 1, hex('#e2c08a')); }
  rim(px, hex(M.rim));
}

// ---------- ストーン（面ごとに明るさを変えた宝石） ----------
const STONE = { common: '#e9e4d8', uncommon: '#4cc35a', rare: '#3f8fe6', epic: '#a457e0', legend: '#f5c518' };
const GEM_SHAPE = [
  '................',
  '................',
  '.....mmmmmm.....',
  '....mmmmmmmm....',
  '...mmmmmmmmmm...',
  '..mmmmmmmmmmmm..',
  '..mmmmmmmmmmmm..',
  '..mmmmmmmmmmmm..',
  '..mmmmmmmmmmmm..',
  '..mmmmmmmmmmmm..',
  '..mmmmmmmmmmmm..',
  '...mmmmmmmmmm...',
  '....mmmmmmmm....',
  '.....mmmmmm.....',
  '................',
  '................',
];
function gem(px, colorAt, rimC, seed) {
  const g = grid(GEM_SHAPE), cx = 7.5, cy = 7.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!g[y * S + x]) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, c = colorAt(x, y);
    let f;
    if (Math.abs(dx) <= 2.6 && Math.abs(dy) <= 2.6) f = 1.18 - (dx + dy) * 0.03; // まん中の平らな面（テーブル）
    else {
      // まわりの面：8 方向に分け、左上ほど明るく右下ほど暗い
      const a = Math.atan2(dy, dx), k = Math.round(a / (Math.PI / 4)), na = k * (Math.PI / 4);
      const lit = -(Math.cos(na) * 0.62 + Math.sin(na) * 0.78);
      f = 0.86 + lit * 0.34;
    }
    f *= 1 + noise(seed, x, y) * 0.03;
    const outer = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => !g[(y + ay) * S + x + ax]);
    let col = tone(c, f);
    if (outer) col = tone(c, (dx + dy) > 0 ? 0.5 : 0.78);
    put(px, x, y, col);
  }
  // テーブルの縁（面の境目）を少し暗く、左上に光
  for (const [x, y] of [[5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5]]) { const i = (y * S + x) * 4; put(px, x, y, [px[i] * 0.9, px[i + 1] * 0.9, px[i + 2] * 0.9]); }
  for (const [x, y, k] of [[5, 3, 0.9], [4, 4, 0.75], [6, 6, 0.95], [7, 6, 0.6], [6, 7, 0.6]]) { const i = (y * S + x) * 4; put(px, x, y, [px[i] + (255 - px[i]) * k, px[i + 1] + (255 - px[i + 1]) * k, px[i + 2] + (255 - px[i + 2]) * k]); }
  rim(px, rimC);
}
function stone(px, key) {
  const c = hex(STONE[key]);
  gem(px, () => c, key === 'common' ? hex('#6b6458') : tone(c, 0.3), 'st' + key);
}
function stoneUnique(px) {
  // ユニーク：だいだい → 赤むらさきへ色が流れる宝石に、星のきらめき
  const A = hex('#ff8a2a'), B = hex('#e0368f'), C2 = hex('#7a4cf0');
  const mix = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
  gem(px, (x, y) => { const t = (x + y) / 30; return t < 0.5 ? mix(A, B, t * 2) : mix(B, C2, (t - 0.5) * 2); }, hex('#4a1030'), 'stu');
  for (const [x, y] of [[11, 2], [12, 3], [10, 3], [11, 4], [11, 3]]) put(px, x, y, [255, 252, 220]);
  put(px, 3, 11, [255, 240, 200]);
}
function shard(px) {
  // かけら：うす紫の小さな欠片が 3 つ
  const c = hex('#c9bdf5'), rows = [
    '................',
    '................',
    '................',
    '......mm........',
    '.....mmmm.......',
    '.....mmmm.......',
    '......mmm.......',
    '..............',
    '..nn.....ooo....',
    '.nnnn...ooooo...',
    '.nnnn...ooooo...',
    '..nnn...oooo....',
    '..........o.....',
    '................',
    '................',
    '................',
  ];
  puffy(px, grid(rows), { m: { c, shine: 0.7, flat: true }, n: { c: tone(c, 0.95), shine: 0.7, flat: true }, o: { c: tone(c, 1.05), shine: 0.7, flat: true } }, 'shard');
  rim(px, hex('#3a2a66'));
}

const ICONS = {};
for (const part of ['head', 'chest', 'legs', 'feet']) for (const mat of Object.keys(MAT)) ICONS[`armor_${mat}_${part}`] = (px) => armor(px, part, mat);
for (const k of Object.keys(STONE)) ICONS['stone_' + k] = (px) => stone(px, k);
ICONS.stone_unique = stoneUnique;
ICONS.stone_shard = shard;

fs.mkdirSync(OUT, { recursive: true });
const made = {};
for (const [name, draw] of Object.entries(ICONS)) { const px = canvas(); draw(px); writePNG(path.join(OUT, name + '.png'), S, S, px); made[name] = px; }
console.log('防具とストーンのアイコンを ' + Object.keys(ICONS).length + ' 個作りました');
if (process.env.GEAR_SHEET) {
  const names = Object.keys(ICONS), Z = 8, CELL = S * Z + 12, COLS = 5;
  const W = CELL * COLS + 12, H = CELL * Math.ceil(names.length / COLS) + 12, sheet = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 246; sheet[i * 4 + 1] = 239; sheet[i * 4 + 2] = 224; sheet[i * 4 + 3] = 255; }
  names.forEach((k, n) => {
    const px = made[k], ox = 12 + (n % COLS) * CELL, oy = 12 + Math.floor(n / COLS) * CELL;
    for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) {
      const si = (Math.floor(y / Z) * S + Math.floor(x / Z)) * 4; if (!px[si + 3]) continue;
      const di = ((oy + y) * W + ox + x) * 4; sheet[di] = px[si]; sheet[di + 1] = px[si + 1]; sheet[di + 2] = px[si + 2];
    }
  });
  writePNG(process.env.GEAR_SHEET, W, H, sheet); console.log('見本: ' + process.env.GEAR_SHEET);
}
