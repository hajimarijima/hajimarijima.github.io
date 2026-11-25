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
  iron(px) {
    const s = hex('#d9dee4');
    isoBox(px, { a: 8, b: 4, c: 3, cx: 7, cy: 7, seed: 'iron', tex: (f, u, v) => (f === 'top' && u > 0.15 && u < 0.6 && v < 0.5 ? tone(s, 1.12) : s) });
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
  axe(px) {
    const g = shapeGrid();
    line(g, 3, 14, 11.5, 5.5, 2, 'w');
    poly(g, [[8, 3], [11, 1.5], [15, 5.5], [13, 8], [10.5, 6.5]], 'm');
    puffy(px, g, { w: { c: hex('#8a5a33'), flat: true }, m: { c: hex('#c8ced6'), shine: 0.5 } }, 'axe');
  },
  pickaxe(px) {
    const g = shapeGrid();
    line(g, 3, 14, 11, 6, 2, 'w');
    for (let t = 0; t <= 1; t += 0.01) { const a = (-100 + t * 106) * Math.PI / 180; const mid = 1 - Math.abs(t - 0.5) * 2; disc(g, 3 + Math.cos(a) * 10, 13 + Math.sin(a) * 10, 0.9 + mid * 0.6, 'm'); }
    puffy(px, g, { w: { c: hex('#8a5a33'), flat: true }, m: { c: hex('#c8ced6'), shine: 0.45 } }, 'pick');
  },
  hoe(px) {
    const g = shapeGrid();
    line(g, 3, 14, 11.5, 5, 2, 'w');
    poly(g, [[7, 2.5], [13.5, 2.5], [13.5, 5], [7, 5]], 'm'); poly(g, [[7, 2.5], [9.2, 2.5], [9.2, 8], [7, 8]], 'm');
    puffy(px, g, { w: { c: hex('#8a5a33'), flat: true }, m: { c: hex('#c8ced6'), shine: 0.45 } }, 'hoe');
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
