#!/usr/bin/env node
'use strict';
// 持ち物のアイコン（16x16 のドット絵）を作る。ブロックは斜めから見た立方体、
// 物は「ふくらみ」と左上からの光で陰をつけ、平面的にならないようにする。
// 使い方: node tools/gen_icons.js  → icons/*.png
const fs = require('fs');
const path = require('path');
const { writePNG } = require('./png');
const { hashStr } = require('./rand');

const OUT = path.join(__dirname, '..', 'icons');
const S = 16;
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
// 暗い所は青紫へ、明るい所は黄色へ少し寄せる
function tone(c, f) {
  if (f >= 1) { const k = f - 1; return [c[0] * f + k * 50, c[1] * f + k * 34, c[2] * f + k * 6]; }
  const k = 1 - f; return [c[0] * f - k * 8, c[1] * f - k * 4, c[2] * f + k * 30];
}
const noise = (seed, x, y) => ((hashStr(seed + ':' + x + ',' + y) % 1000) / 1000) * 2 - 1;

function canvas() { return new Uint8Array(S * S * 4); }
function put(px, x, y, c, a = 255) { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = clamp(c[0]); px[i + 1] = clamp(c[1]); px[i + 2] = clamp(c[2]); px[i + 3] = a; }

// ---------- 斜めから見た箱 ----------
// tex(face, u, v) -> 色。face: top / left / right
function isoBox(px, { a, b, c, cx, cy, tex, seed }) {
  const L = { top: 1.06, left: 0.8, right: 0.6 };
  const hit = (x, y) => {
    const X0 = x - cx, Y0 = 2 * (y - cy + c);
    let X = (X0 + Y0) / 2, Z = (Y0 - X0) / 2;
    if (X >= 0 && X <= a && Z >= 0 && Z <= b) return ['top', X / a, Z / b];
    let Zr = cx + a - x, Yr = cy + (a + Zr) / 2 - y;
    if (Zr >= 0 && Zr <= b && Yr >= 0 && Yr <= c) return ['right', Zr / b, 1 - Yr / c];
    let Xl = x - cx + b, Yl = cy + (Xl + b) / 2 - y;
    if (Xl >= 0 && Xl <= a && Yl >= 0 && Yl <= c) return ['left', Xl / a, 1 - Yl / c];
    return null;
  };
  const grid = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) grid[y * S + x] = hit(x + 0.5, y + 0.5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const h = grid[y * S + x];
    if (!h) continue;
    const [face, u, v] = h;
    let col = tone(tex(face, u, v, x, y), L[face] * (1 + noise(seed, x, y) * 0.04));
    const empty = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx < 0 || yy < 0 || xx >= S || yy >= S || !grid[yy * S + xx]; };
    const other = (dx, dy) => { const xx = x + dx, yy = y + dy; const g = xx >= 0 && yy >= 0 && xx < S && yy < S && grid[yy * S + xx]; return g && g[0] !== face; };
    if (empty(0, -1) || empty(-1, 0) || empty(1, 0) || empty(0, 1)) col = tone(col, face === 'top' ? 0.62 : 0.5); // 外の線
    else if (face === 'top' && (other(0, 1) || other(1, 1) || other(-1, 1))) col = tone(col, 1.18); // 角の光
    put(px, x, y, col);
  }
}

// ---------- ふくらみのある物 ----------
function shapeGrid() { return Array.from({ length: S * S }, () => null); }
function disc(g, cx, cy, r, m) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g[y * S + x] = m; }
function ellipse(g, cx, cy, rx, ry, m) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) g[y * S + x] = m; }
function line(g, x0, y0, x1, y1, w, m) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x + 0.5, py = y + 0.5, dx = x1 - x0, dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) <= w / 2) g[y * S + x] = m;
  }
}
function poly(g, pts, m) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let inside = false; const px = x + 0.5, py = y + 0.5;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) g[y * S + x] = m;
  }
}
// mats: { key: { c: 色, shine: 0..1, flat: true } }
function puffy(px, g, mats, seed) {
  const idx = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : g[y * S + x]);
  // 同じ材料の中での縁からの距離
  const d = new Array(S * S).fill(0);
  for (let i = 0; i < S * S; i++) if (g[i]) d[i] = 99;
  for (let pass = 0; pass < 6; pass++) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; if (!g[i]) continue;
      let m = 99;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = idx(x + dx, y + dy); const dn = n === g[i] ? d[(y + dy) * S + x + dx] : 0; m = Math.min(m, dn + 1); }
      d[i] = Math.min(d[i], m);
    }
  }
  const z = (x, y) => { const n = idx(x, y); if (!n) return 0; const M = mats[n]; return Math.sqrt(Math.min(d[y * S + x], M.flat ? 1.5 : 3) / 3); };
  const Lx = -0.55, Ly = -0.65, Lz = 0.52;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = idx(x, y); if (!k) continue;
    const M = mats[k];
    const nx = -(z(x + 1, y) - z(x - 1, y)) * 1.3, ny = -(z(x, y + 1) - z(x, y - 1)) * 1.3, nz = 0.6;
    const nl = Math.hypot(nx, ny, nz);
    const lam = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / nl);
    let f = 0.62 + 0.62 * lam;
    // 光の当たる側と影の側の縁
    if (!idx(x, y - 1) || !idx(x - 1, y)) f *= 1.12;
    if (!idx(x, y + 1) || !idx(x + 1, y)) f *= 0.62;
    let col = tone(M.c, f * (1 + noise(seed, x, y) * (M.grain || 0.04)));
    if (M.shine && lam > 0.86 && d[y * S + x] >= 2) col = [col[0] + (255 - col[0]) * M.shine, col[1] + (255 - col[1]) * M.shine, col[2] + (255 - col[2]) * M.shine];
    // 外側の縁はいちばん暗い色
    const outer = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !idx(x + dx, y + dy));
    if (outer && (!idx(x + 1, y) || !idx(x, y + 1))) col = tone(M.c, 0.42);
    put(px, x, y, col);
  }
}

// ---------- アイテム ----------
const ICONS = {
  log(px) {
    const bark = hex('#6b4a2b'), barkD = hex('#4e3420'), ring = hex('#c9a46a'), ringD = hex('#a07c48');
    isoBox(px, { a: 7, b: 7, c: 7, cx: 8, cy: 8, seed: 'log', tex: (f, u, v, x) => {
      if (f === 'top') { const r = Math.hypot(u - 0.5, v - 0.5); if (r > 0.42) return bark; return Math.floor(r * 10) % 2 ? ringD : ring; }
      return (Math.floor(u * 7) + (v > 0.5 ? 1 : 0)) % 3 === 0 ? barkD : bark;
    } });
  },
  cobble(px) {
    const c1 = hex('#8f9399'), c2 = hex('#a9adb2'), cd = hex('#5f6368');
    const cells = [[0.2, 0.25], [0.7, 0.2], [0.45, 0.6], [0.15, 0.8], [0.85, 0.7], [0.55, 0.95]];
    isoBox(px, { a: 7, b: 7, c: 7, cx: 8, cy: 8, seed: 'cobble', tex: (f, u, v) => {
      const ds = cells.map(([cx, cy], i) => [Math.hypot(u - cx, v - cy), i]).sort((p, q) => p[0] - q[0]);
      if (ds[1][0] - ds[0][0] < 0.08) return cd;
      return ds[0][1] % 2 ? c2 : c1;
    } });
  },
  // 鉄鉱石：石のかたまりに、赤茶の粒
  iron(px) { oreChunk(px, hex('#d6a27c'), hex('#b07650'), 'iron'); },
  gold(px) { oreChunk(px, hex('#f2cf3a'), hex('#c99a1c'), 'gold'); },
  diamond(px) {
    const g = shapeGrid();
    poly(g, [[3, 6], [6, 3], [10, 3], [13, 6], [8, 14]], 'd');
    poly(g, [[3, 6], [13, 6], [12, 7], [4, 7]], 'e');
    puffy(px, g, { d: { c: hex('#4fd8d2'), shine: 0.7 }, e: { c: hex('#9af2ee'), shine: 0.5, flat: true } }, 'dia');
    put(px, 6, 4, [255, 255, 255]); put(px, 7, 4, [230, 255, 255]);
  },
  planks(px) {
    const p1 = hex('#c49a5c'), p2 = hex('#ad8248'), pd = hex('#7d5a2e');
    isoBox(px, { a: 7, b: 7, c: 7, cx: 8, cy: 8, seed: 'planks', tex: (f, u, v) => {
      const row = f === 'top' ? u : v;
      const k = Math.floor(row * 4);
      if (Math.abs(row * 4 - Math.round(row * 4)) < 0.14) return pd; // 板のすき間
      return k % 2 ? p2 : p1;
    } });
  },
  stick(px) {
    const g = shapeGrid();
    line(g, 4, 13, 12, 3, 1.9, 'w');
    puffy(px, g, { w: { c: hex('#9a6a3a'), shine: 0.2 } }, 'stick');
  },
  coal(px) {
    const g = shapeGrid();
    poly(g, [[3, 6], [6, 3], [10, 3], [13, 6], [13, 10], [10, 13], [5, 13], [3, 10]], 'c');
    disc(g, 4.5, 11, 1.6, 'c');
    puffy(px, g, { c: { c: hex('#34343c'), shine: 0.35, grain: 0.1 } }, 'coal');
    put(px, 6, 6, [210, 210, 220]); put(px, 9, 8, [150, 150, 165]);
  },
  wheat(px) {
    const art = ["................","...h....k....h..","..hkh..kkh..hkh.","..khk..hkk..khk.","..hkh..khh..hkh.","..khk..hkk..khk.","...hk..khh..kh..","....s..hkk..s...",".....s..s..s....","......s.s.s.....",".....bbbbbb.....","......s.s.s.....",".....s..s..s....","....s...s...s...","...s....s....s..","................"];
    const g = shapeGrid();
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') g[y * S + x] = ch; }));
    puffy(px, g, { h: { c: hex('#ecc852'), shine: 0.3 }, k: { c: hex('#cfa23a'), shine: 0.2 }, s: { c: hex('#9a9a3a'), flat: true }, b: { c: hex('#8a5a2c'), flat: true } }, 'wheat');
  },
  seeds(px) {
    const g = shapeGrid();
    for (const [x, y, r] of [[5, 6, 0.5], [10, 5, -0.4], [7, 10, 0.2], [11.5, 10.5, 0.6]]) { const gg = shapeGrid(); ellipse(gg, x, y, 1.6, 2.4, 'a'); gg.forEach((v, i) => { if (v) g[i] = 'a'; }); }
    puffy(px, g, { a: { c: hex('#7a9a3a'), shine: 0.3 } }, 'seeds');
  },
  berry(px) {
    const g = shapeGrid();
    ellipse(g, 9, 4, 3.5, 1.6, 'l');
    disc(g, 5, 9.5, 2.7, 'r'); disc(g, 11, 9.8, 2.7, 'q'); disc(g, 8, 13, 2.4, 'p');
    puffy(px, g, { r: { c: hex('#c8303c'), shine: 0.6 }, q: { c: hex('#a82436'), shine: 0.6 }, p: { c: hex('#b82a3a'), shine: 0.6 }, l: { c: hex('#4f8f3a') } }, 'berry');
  },
  apple(px) {
    const g = shapeGrid();
    disc(g, 6, 9.5, 4.6, 'r'); disc(g, 10, 9.5, 4.6, 'r');
    line(g, 8, 5.5, 9, 2, 1.2, 's'); ellipse(g, 11.5, 3.2, 2.2, 1.2, 'l');
    puffy(px, g, { r: { c: hex('#d2343a'), shine: 0.6 }, s: { c: hex('#6b4a2b'), flat: true }, l: { c: hex('#5aa03c') } }, 'apple');
  },
  flower_r(px) { flower(px, hex('#d83a4a'), 'fr'); },
  flower_y(px) { flower(px, hex('#f0c832'), 'fy'); },
  sapling(px) {
    const g = shapeGrid();
    line(g, 8, 15, 8, 7, 1.4, 's');
    disc(g, 5, 8, 2.8, 'l'); disc(g, 11, 7, 2.8, 'k'); disc(g, 8, 4, 3, 'l'); disc(g, 6.5, 12, 2, 'k');
    puffy(px, g, { s: { c: hex('#6b4a2b'), flat: true }, l: { c: hex('#4f9a3a'), shine: 0.15 }, k: { c: hex('#3f8030'), shine: 0.15 } }, 'sap');
  },
  fish_funa(px) { fishIcon(px, '#8a8f6a', '#c9ccb0', 'funa'); },
  fish_koi(px) { fishIcon(px, '#d8682a', '#f2e6d8', 'koi'); },
  fish_masu(px) { fishIcon(px, '#6f8f9a', '#e8b0b8', 'masu'); },
  fish_namazu(px) { fishIcon(px, '#4e4a40', '#8a8474', 'namazu', true); },
  carrot(px) {
    const g = shapeGrid();
    poly(g, [[4, 14], [10.5, 5.5], [12.5, 7.5]], 'o');
    for (const [x0, y0, x1, y1] of [[11, 6, 13, 1.5], [11.5, 6.5, 15, 4], [10.5, 5.5, 9, 1.5]]) line(g, x0, y0, x1, y1, 1.5, 'l');
    puffy(px, g, { o: { c: hex('#e8742a'), shine: 0.35 }, l: { c: hex('#4f9a3a') } }, 'carrot');
    put(px, 7, 10, hex('#b8541a')); put(px, 9, 8, hex('#b8541a'));
  },
  potato(px) {
    const g = shapeGrid();
    ellipse(g, 8, 8.5, 5.6, 4.4, 'p');
    puffy(px, g, { p: { c: hex('#c49a5a'), shine: 0.2, grain: 0.1 } }, 'potato');
    for (const [x, y] of [[6, 7], [10, 9], [8, 11]]) put(px, x, y, hex('#7d5a2e'));
  },
  egg(px) {
    const g = shapeGrid();
    ellipse(g, 8, 8.8, 4.2, 5.4, 'e');
    puffy(px, g, { e: { c: hex('#efe2c4'), shine: 0.5 } }, 'egg');
  },
  milk(px) {
    const g = shapeGrid();
    poly(g, [[4, 6], [12, 6], [12.5, 14.5], [3.5, 14.5]], 'b'); poly(g, [[6, 2.5], [10, 2.5], [10, 6.2], [6, 6.2]], 'n'); poly(g, [[4.5, 7], [11.5, 7], [11.6, 9.5], [4.4, 9.5]], 'm');
    puffy(px, g, { b: { c: hex('#8a6a48'), shine: 0.2 }, n: { c: hex('#6b4f34') }, m: { c: hex('#f4f4ee'), shine: 0.3, flat: true } }, 'milk');
  },
  wool(px) {
    const g = shapeGrid();
    for (const [x, y, r] of [[5.5, 9, 3.4], [10.5, 9, 3.4], [8, 6, 3.6], [8, 11, 3.4]]) disc(g, x, y, r, 'w');
    puffy(px, g, { w: { c: hex('#ece8dc'), shine: 0.25 } }, 'wool');
    for (const [x, y] of [[6, 7], [10, 6], [8, 10], [11, 11]]) put(px, x, y, hex('#c8c2b2'));
  },
  mushroom(px) {
    const g = shapeGrid();
    ellipse(g, 8, 6.5, 6, 3.8, 'c'); poly(g, [[6, 8], [10, 8], [10.5, 14], [5.5, 14]], 's');
    puffy(px, g, { c: { c: hex('#b8603a'), shine: 0.3 }, s: { c: hex('#ece2c8') } }, 'mush');
    for (const [x, y] of [[6, 5], [10, 4], [9, 7]]) put(px, x, y, hex('#f4e8d0'));
  },
  old_coin(px) {
    const g = shapeGrid();
    disc(g, 8, 8, 5.8, 'c'); disc(g, 8, 8, 3.6, 'i');
    puffy(px, g, { c: { c: hex('#d8a832'), shine: 0.5 }, i: { c: hex('#b88a22'), shine: 0.3, flat: true } }, 'coin');
    put(px, 8, 6, hex('#6e4e10')); put(px, 8, 7, hex('#6e4e10')); put(px, 8, 8, hex('#6e4e10')); put(px, 7, 9, hex('#6e4e10'));
  },
  pearl(px) {
    const g = shapeGrid();
    poly(g, [[2, 10], [8, 13.5], [14, 10], [12, 14.5], [4, 14.5]], 's'); disc(g, 8, 8.5, 3.6, 'p');
    puffy(px, g, { s: { c: hex('#c8b8a8') }, p: { c: hex('#f2eef6'), shine: 0.8 } }, 'pearl');
  },
  old_boot(px) {
    const g = shapeGrid();
    poly(g, [[5, 2], [10, 2], [10, 9], [14, 10.5], [14, 14], [4, 14], [4.5, 8]], 'b'); poly(g, [[4, 12.5], [14, 12.5], [14, 14.2], [4, 14.2]], 's');
    puffy(px, g, { b: { c: hex('#5a4a3a'), grain: 0.1 }, s: { c: hex('#2e2620'), flat: true } }, 'boot');
    put(px, 7, 5, hex('#3a2e24')); put(px, 8, 7, hex('#3a2e24'));
  },
  driftwood(px) {
    const g = shapeGrid();
    line(g, 2.5, 11, 13.5, 5, 3, 'w'); line(g, 8, 8, 11, 12.5, 1.6, 'w');
    puffy(px, g, { w: { c: hex('#a8957a'), grain: 0.12 } }, 'drift');
  },
  lock(px) {
    const g = shapeGrid();
    for (let t = 0; t <= 1; t += 0.02) { const a = Math.PI * (1 + t); disc(g, 8 + Math.cos(a) * 3.2, 7 + Math.sin(a) * 3.2, 1.1, 's'); }
    line(g, 4.8, 7, 4.8, 8.5, 2, 's'); line(g, 11.2, 7, 11.2, 8.5, 2, 's');
    poly(g, [[3, 8], [13, 8], [13, 14.5], [3, 14.5]], 'b');
    puffy(px, g, { s: { c: hex('#b8bec6'), flat: true }, b: { c: hex('#d9a93a'), shine: 0.4 } }, 'lock');
    put(px, 8, 10, [70, 50, 20]); put(px, 8, 11, [70, 50, 20]);
  },
};
// ---------- 道具（つるはし・斧・シャベル・くわ・剣・釣りざお × 木・石・鉄・金・ダイヤ） ----------
// 柄は茶色の棒を左下から右上へ斜めに。頭は素材の色。形は素材で変えず、色で見分ける（自作のドット）。
// 色は 5 段（縁・暗・中・明・光）。光は左上から：左上の縁は明るく、右下の縁は暗く、外に 1px の縁取り。
//   木 = 明るい板の色＋木目 / 石 = 暗い灰色＋まだら / 鉄 = 白に近い銀 / 金 = 黄色 / ダイヤ = 水色
const PAL = {
  wood: ['#3b240f', '#8d5f2c', '#b98447', '#d9a865', '#f0cd92'],
  stone: ['#161718', '#3a3c3e', '#55585b', '#74777a', '#94979a'],
  iron: ['#4a5058', '#a9b0b8', '#dde2e7', '#f4f6f8', '#ffffff'],
  gold: ['#5e3a02', '#c4870c', '#efbb26', '#fde062', '#fff6b8'],
  diamond: ['#08414a', '#1aa3a6', '#3fd8d2', '#93f5ee', '#effffe'],
  stick: ['#26160a', '#5a3818', '#7e5128', '#a06c38', '#bc8a52'],
  wrap: ['#1e140c', '#3f2c1c', '#5e4430', '#7b5d44', '#95775c'],
  line: ['#8d949c', '#c9ced4', '#e4e8ec', '#f4f6f8', '#ffffff'],
  hook: ['#2e333a', '#6e7884', '#a7b1bc', '#d5dbe1', '#ffffff'],
};
for (const k in PAL) PAL[k] = PAL[k].map(hex);
const MATS = ['wood', 'stone', 'iron', 'gold', 'diamond'];
const KINDS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'fishing_rod'];
// 柄の向きにそった座標：a = 柄にそった位置（右上ほど大きい）、p = 柄からの横のずれ（左上が負）
const AP = (x, y) => ({ a: x - y, p: x + y - 15 });
const fillAP = (g, test, m) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const { a, p } = AP(x, y); if (test(a, p)) g[y * S + x] = m; } };
const stick = (g, aMax, aMin = -13) => fillAP(g, (a, p) => (p === 0 || p === 1) && a >= aMin && a <= aMax, 'w');
// 柄にそった座標 u（右上ほど大きい）と、柄からの距離 v（左上が正）で形を決めて、1 マスを 4×4 に分けて半分以上入るマスをぬる
const region = (g, fn, m, th = 0.5) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let n = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const X = x + (i + 0.5) / 4, Y = y + (j + 0.5) / 4; if (fn((X - Y) / Math.SQRT2, (16.5 - X - Y) / Math.SQRT2)) n++; } if (n / 16 >= th) g[y * S + x] = m; } };
const rows = (g, list, m) => { for (const [y, xs] of list) for (const x of xs) g[y * S + x] = m; };
const dots = (g, map) => map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') g[y * S + x] = 'm'; else if (ch === 'w') g[y * S + x] = 'w'; }));
const rng2 = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const TOOL_SHAPE = {
  // 4 つとも：頭は大きく（6〜8 マス以上）、柄は 1 マスの細い茶色の線。1 マスずつのドット図をそのまま書く（# = 頭、w = 柄、. = なし）。
  // 縁取り（濃い色の 1 マス）は drawTool が外側につける。並べた時に輪郭がまったく違うように、頭の形を変えている。
  // つるはし：上が平らで両はしが下へ曲がる「⌒」。x = 6 を軸に左右対称。柄は頭のまん中から右下へ斜めに
  pickaxe(g) {
    dots(g, [
      '................',
      '................',
      '....#######.....',
      '..###########...',
      '.##...###...##..',
      '.##....w....##..',
      '.#......w....#..',
      '.........w......',
      '..........w.....',
      '...........w....',
      '............w...',
      '.............w..',
      '..............w.',
      '................',
      '................',
      '................',
    ]);
  },
  // 斧：柄の上の片側（左）に、大きな四角っぽい刃（刃先の左はしは上下に少し広がる）。反対側（右）の背は短い
  axe(g) {
    dots(g, [
      '................',
      '...#####........',
      '...#######......',
      '...##########w..',
      '...#########w##.',
      '...########w##..',
      '...#######w.....',
      '...#####.w......',
      '........w.......',
      '.......w........',
      '......w.........',
      '.....w..........',
      '....w...........',
      '...w............',
      '..w.............',
      '................',
    ]);
  },
  // シャベル：柄の先に、平たいしずく形のスコップ（先は丸く、柄の方へ細くなる）
  shovel(g) {
    dots(g, [
      '................',
      '..........###...',
      '.........#####..',
      '........#######.',
      '........#######.',
      '.......########.',
      '.......#######..',
      '.......######...',
      '......w.###.....',
      '.....w..........',
      '....w...........',
      '...w............',
      '..w.............',
      '.w..............',
      '................',
      '................',
    ]);
  },
  // くわ：柄の上から片側（左）へ、薄い棒がのびて、はしで短い刃が直角に下がる（L 字）。刃は斧より薄く小さい
  hoe(g) {
    dots(g, [
      '................',
      '................',
      '......########..',
      '......##...##...',
      '......#...w.....',
      '......#..w......',
      '........w.......',
      '.......w........',
      '......w.........',
      '.....w..........',
      '....w...........',
      '...w............',
      '..w.............',
      '.w..............',
      '................',
      '................',
    ]);
  },
  // 剣：まっすぐな刃と先・つば・握り・柄頭
  sword(g) {
    fillAP(g, (a, p) => a >= -1 && a <= 11 && p >= -2 && p <= 2, 'm');
    fillAP(g, (a, p) => a >= 12 && a <= 13 && p >= -1 && p <= 1, 'm');
    fillAP(g, (a, p) => a >= -3 && a <= -2 && p >= -5 && p <= 5, 'g');
    fillAP(g, (a, p) => a >= -9 && a <= -4 && (p === 0 || p === 1), 'w');
    fillAP(g, (a, p) => a >= -12 && a <= -10 && p >= -1 && p <= 2, 'g');
  },
  // 釣りざお：茶色の握りと、素材のさお
  fishing_rod(g) {
    fillAP(g, (a, p) => a >= -12 && a <= -6 && (p === 0 || p === 1), 'b');
    fillAP(g, (a, p) => a >= -5 && a <= 11 && (p === 0 || (p === 1 && a < 3)), 'm');
  },
};
const ROD_LINE = [[14, 3], [14, 4], [14, 5], [14, 6], [14, 7], [14, 8], [14, 9], [14, 10]];
function drawTool(px, mat, kind) {
  const g = shapeGrid();
  TOOL_SHAPE[kind](g);
  const seed = mat + kind;
  const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : g[y * S + x]);
  // 釣りざおの木のさおは柄と同じ茶色。つば・柄頭は濃い革色
  const palOf = (c) => ({ m: PAL[mat], w: PAL.stick, b: PAL.wrap, g: PAL.wrap }[c]);
  const out = (x, y) => !at(x, y);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 縁取り：形の外側に 1px（中の色を縁で食わない）。色は、となりの部品のいちばん暗い色
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (at(x, y)) continue;
    const n = N4.map(([dx, dy]) => at(x + dx, y + dy)).find(Boolean);
    if (n) put(px, x, y, palOf(n)[0]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = at(x, y); if (!c) continue;
    const P = palOf(c);
    // 1 暗 2 中 3 明 4 光：左か上が外なら明るく、右か下が外なら暗く
    const ul = out(x - 1, y) || out(x, y - 1), dr = out(x + 1, y) || out(x, y + 1);
    let t = ul && !dr ? 3 : dr && !ul ? 1 : 2;
    if (out(x - 1, y) && out(x, y - 1) && !dr) t = 4; // 左上の角は光
    // 違う部品と接する所は、下の部品に 1px の影
    const nb = (dx, dy) => { const o = at(x + dx, y + dy); return o && o !== c; };
    if (c === 'w' && (nb(1, 0) || nb(0, -1) || nb(1, -1))) t = 1;
    if (c === 'm') {
      const n = noise(seed, x, y);
      if (mat === 'wood' && !ul && !dr && (x + 2 * y) % 5 === 0) t = 1; // 木目のすじ
      if (mat === 'stone' && !ul && n > 0.45) t = 1; // まだら（ごつごつ）
      if (mat === 'stone' && !dr && n < -0.7) t = 3;
      if ((mat === 'iron' || mat === 'gold') && t === 3 && n > 0.3) t = 4; // 光のすじ
      if (mat === 'diamond' && !ul && !dr && (x + y) % 4 === 0) t = 3; // 面
    }
    if (c === 'm' && mat !== 'wood' && mat !== 'stone' && (kind === 'axe' || kind === 'hoe') && out(x - 1, y)) t = 4; // 刃の先は研いだ光
    if (c === 'w' && t === 2 && (x + y) % 4 === 0) t = 3; // 柄の明るい点
    if (c === 'b' && t === 2 && (x - y) % 2 === 0) t = 1; // 巻いた革のすじ
    put(px, x, y, P[t]);
  }
  if (kind === 'fishing_rod') {
    for (const [x, y] of ROD_LINE) if (!at(x, y)) put(px, x, y, PAL.line[1 + (y % 2)]);
    put(px, 13, 11, PAL.hook[1]); put(px, 13, 12, PAL.hook[2]); put(px, 14, 12, PAL.hook[0]); put(px, 14, 11, PAL.hook[3]); put(px, 12, 10, PAL.hook[0]);
  }
}
for (const mat of MATS) for (const kind of KINDS) ICONS[mat + '_' + kind] = (px) => drawTool(px, mat, kind);
// 前の名前（素材なし）は鉄・木の絵で残す
ICONS.axe = (px) => drawTool(px, 'iron', 'axe'); ICONS.pickaxe = (px) => drawTool(px, 'iron', 'pickaxe'); ICONS.hoe = (px) => drawTool(px, 'wood', 'hoe');
// 鉱石：ごつごつした石のかたまりに、色の粒（光る点つき）
function oreChunk(px, ore, oreD, seed) {
  const g = shapeGrid();
  poly(g, [[2, 8], [5, 3.5], [10, 2.5], [14, 6], [14, 11], [10, 14], [4, 13.5]], 's');
  for (const [x, y, r] of [[6, 6.5, 1.5], [10.5, 6, 1.3], [8, 10.5, 1.6], [11.5, 10.5, 1.1], [4.5, 10.5, 1]]) disc(g, x, y, r, 'o');
  puffy(px, g, { s: { c: hex('#8d9196'), grain: 0.12 }, o: { c: ore, shine: 0.55 } }, seed);
  put(px, 6, 6, tone(ore, 1.45)); put(px, 10, 5, tone(ore, 1.4)); put(px, 7, 10, tone(oreD, 0.9));
}
// 魚：背の色・腹の色。尾びれ・背びれ・目。ナマズはひげ
function fishIcon(px, back, belly, seed, whisker) {
  const g = shapeGrid();
  ellipse(g, 7.6, 8.5, 5.6, 3.1, 'b'); ellipse(g, 7.6, 9.8, 4.8, 1.6, 'w');
  poly(g, [[12.5, 8.5], [15.5, 5], [15.5, 12]], 't'); poly(g, [[6, 5.8], [9.5, 4.2], [10, 6]], 't');
  puffy(px, g, { b: { c: hex(back), shine: 0.35 }, w: { c: hex(belly), shine: 0.3, flat: true }, t: { c: tone(hex(back), 0.75) } }, seed);
  put(px, 4, 8, [20, 20, 24]); put(px, 4, 7, [240, 240, 240]);
  if (whisker) { put(px, 1, 10, hex('#2e2a24')); put(px, 2, 10, hex('#2e2a24')); put(px, 1, 7, hex('#2e2a24')); }
}
function flower(px, petal, seed) {
  const g = shapeGrid();
  line(g, 8, 15, 8, 8, 1.4, 's');
  ellipse(g, 5.5, 12, 2.2, 1.1, 'l'); ellipse(g, 10.5, 11, 2.2, 1.1, 'l');
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; disc(g, 8 + Math.cos(a) * 2.8, 5.5 + Math.sin(a) * 2.8, 1.9, 'p'); }
  disc(g, 8, 5.5, 1.4, 'c');
  puffy(px, g, { s: { c: hex('#4f8f3a'), flat: true }, l: { c: hex('#5aa03c') }, p: { c: petal, shine: 0.3 }, c: { c: hex('#f6e27a'), shine: 0.2 } }, seed);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, draw] of Object.entries(ICONS)) { const px = canvas(); draw(px); writePNG(path.join(OUT, name + '.png'), S, S, px); }
console.log('アイコンを ' + Object.keys(ICONS).length + ' 個作りました: ' + OUT);

// 道具一覧（目で確かめる用）：横 = つるはし・斧・シャベル・くわ・剣・釣りざお、縦 = 木・石・鉄・金・ダイヤ。1 マス 16px を 6 倍
{
  const Z = 6, CELL = S * Z + 16, W = CELL * KINDS.length + 16, H = CELL * MATS.length + 16;
  const sheet = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 46; sheet[i * 4 + 1] = 42; sheet[i * 4 + 2] = 38; sheet[i * 4 + 3] = 255; }
  const fill = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; sheet[i] = c[0]; sheet[i + 1] = c[1]; sheet[i + 2] = c[2]; } };
  MATS.forEach((mat, r) => KINDS.forEach((kind, c) => {
    const ox = 8 + c * CELL, oy = 8 + r * CELL;
    // 持ち物の枠と同じ、くぼんだマス
    fill(ox, oy, CELL - 8, CELL - 8, [139, 139, 139]);
    fill(ox, oy, CELL - 8, 3, [55, 55, 55]); fill(ox, oy, 3, CELL - 8, [55, 55, 55]);
    fill(ox, oy + CELL - 11, CELL - 8, 3, [255, 255, 255]); fill(ox + CELL - 11, oy, 3, CELL - 8, [255, 255, 255]);
    const px = canvas(); drawTool(px, mat, kind);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4; if (!px[i + 3]) continue;
      fill(ox + 4 + x * Z, oy + 4 + y * Z, Z, Z, [px[i], px[i + 1], px[i + 2]]);
    }
  }));
  const dst = path.join(__dirname, '..', 'video', '道具一覧.png');
  writePNG(dst, W, H, sheet);
  console.log('道具一覧: ' + dst);
}
