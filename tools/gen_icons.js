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
    // 丸石：灰色の石がごつごつ集まったブロック。面ごとに石を 7〜8 個、石のまん中は明るく縁は暗い。目地は濃く太め。角はところどころ欠ける
    const c1 = hex('#9a9ea4'), c2 = hex('#848890'), c3 = hex('#adb1b6'), cd = hex('#45484d');
    const CELLS = {
      top: [[0.18, 0.2], [0.55, 0.15], [0.85, 0.35], [0.3, 0.55], [0.68, 0.62], [0.15, 0.88], [0.5, 0.92], [0.88, 0.85]],
      left: [[0.2, 0.18], [0.62, 0.22], [0.9, 0.5], [0.35, 0.55], [0.12, 0.85], [0.55, 0.88], [0.85, 0.9]],
      right: [[0.15, 0.25], [0.5, 0.15], [0.85, 0.3], [0.3, 0.62], [0.7, 0.6], [0.2, 0.92], [0.6, 0.95]],
    };
    const cols = [c1, c2, c3];
    isoBox(px, { a: 7, b: 7, c: 7, cx: 8, cy: 8, seed: 'cobble', tex: (f, u, v) => {
      const ds = CELLS[f].map(([cx, cy], i) => [Math.hypot(u - cx, v - cy), i]).sort((p, q) => p[0] - q[0]);
      if (ds[1][0] - ds[0][0] < 0.1) return cd; // 目地
      const k = 1.12 - ds[0][0] * 1.1; // 石のまん中ほど明るい（ふくらんで見える）
      const c = cols[ds[0][1] % 3];
      return [c[0] * k, c[1] * k, c[2] * k];
    } });
    for (const [x, y] of [[8, 1], [2, 5], [14, 5], [1, 11], [15, 10], [8, 15]]) { const i = (y * S + x) * 4; px[i + 3] = 0; } // 角の欠け
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
    // 板：横に長い板 4 枚を、上から下へ積んだ面（正面）。板と板の境目は濃い線 1 本、板の中は長い木目のすじ。
    // 継ぎ目をずらすとレンガに見えるので、板は端から端まで 1 枚でつなげる
    const P = [hex('#c79254'), hex('#b47e44'), hex('#c08a4e'), hex('#ab763e')], gap = hex('#5a3a1c'), grain = hex('#8e602f');
    const x0 = 1, x1 = 14, y0 = 1; // 板 1 枚 = 3 マス、境目 1 マス → 4 枚で 15 マス
    // 木目：板ごとに、長さ 3〜5 マスのすじを 2 本（位置は板ごとに変える）
    const STREAK = [[[2, 6, 1], [8, 12, 2]], [[4, 9, 1], [10, 13, 2]], [[2, 5, 2], [7, 12, 1]], [[3, 8, 2], [9, 13, 1]]];
    for (let y = y0; y < y0 + 15; y++) for (let x = x0; x <= x1; x++) {
      const r = y - y0, k = Math.floor(r / 4), w = r % 4;
      let c;
      if (w === 3) c = gap;
      else {
        c = P[k];
        if (w === 0) c = tone(c, 1.12);       // 板の上の縁は明るい
        if (w === 2) c = tone(c, 0.9);        // 下の縁は少し暗い
        for (const [sx, ex, row] of STREAK[k]) if (w === row && x >= sx && x <= ex) c = tone(grain, w === 1 ? 1 : 0.92);
      }
      if (x === x0) c = tone(c, 0.82);         // 左の縁
      if (x === x1) c = tone(c, 0.62);         // 右の縁（かげ）
      if (y === y0 + 14) c = tone(c, 0.55);
      put(px, x, y, c);
    }
    for (let y = y0; y < y0 + 15; y++) put(px, x1 + 1, y, tone(gap, 0.75)); // 右の厚み（立体に見せる）
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
    // 小麦の束：黄金色の太い穂 3 本が上でふくらみ、下を紐で縛る。穂のまわりは濃い縁で 1 本ずつ分け、粒は 1 段ごとに互いちがい
    const art = [
      '................',
      '.......e........',
      '...e..eee..e....',
      '..eee.eee.eee...',
      '..eee.eee.eee...',
      '..eee.eee.eee...',
      '..eee.eee.eee...',
      '..eee..s..eee...',
      '...e...s...e....',
      '....s..s..s.....',
      '.....bbbbbb.....',
      '.....bbbbbb.....',
      '.....s..s..s....',
      '....s...s...s...',
      '...s....s....s..',
      '................',
    ];
    const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? '.' : art[y][x]);
    const EL = hex('#fbe070'), EM = hex('#eebc34'), ED = hex('#c08a1c'), OUT = hex('#5a3c0c');
    const SL = hex('#d8bc5a'), SD = hex('#9a7e2c'), BL = hex('#b8682e'), BD = hex('#7a3e18');
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = at(x, y);
      if (c === '.') { if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) === 'e')) put(px, x, y, OUT); continue; }
      if (c === 'e') {
        const l = at(x - 1, y) !== 'e', r = at(x + 1, y) !== 'e';
        let col = (x + y) % 2 ? EL : EM; // 粒
        if (r && !l) col = ED; else if (l && !r && (x + y) % 2) col = tone(EL, 1.05);
        put(px, x, y, col);
      } else if (c === 's') put(px, x, y, at(x + 1, y + 1) === 's' || at(x - 1, y + 1) === '.' ? SL : SD);
      else put(px, x, y, (y === 10 ? BL : BD));
    }
    // 茎と紐の外の縁（右下だけ濃く）
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (at(x, y) === 'b' && (at(x + 1, y) === '.' || at(x, y + 1) === '.')) put(px, x, y, tone(BD, 0.7));
    for (const x of [7, 8]) put(px, x, 10, hex('#e09a58')); // 結び目の光
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
  stump(px) {
    // 切り株：短い丸太。上の面に年輪、側面は皮、根元に根が 4 本はり出す
    const bark = hex('#6b4a2b'), barkD = hex('#4e3420'), ring = hex('#d6b076'), ringD = hex('#a8804a');
    isoBox(px, { a: 7, b: 7, c: 4, cx: 8, cy: 9, seed: 'stump', tex: (f, u, v) => {
      if (f === 'top') { const r = Math.hypot(u - 0.5, v - 0.5); if (r > 0.44) return bark; return Math.floor(r * 11) % 2 ? ringD : ring; }
      return Math.floor(u * 6) % 2 ? barkD : bark;
    } });
    const root = hex('#5a3c22'), rootD = hex('#3c2614');
    for (const [x, y, d] of [[1, 12, 0], [2, 12, 0], [1, 13, 1], [14, 12, 0], [15, 12, 0], [15, 13, 1], [6, 15, 0], [7, 15, 1], [10, 15, 0], [11, 15, 1]]) put(px, x, y, d ? rootD : root);
  },
  fish_funa(px) { fishIcon(px, '#8a8f6a', '#c9ccb0', 'funa'); },
  fish_koi(px) { fishIcon(px, '#d8682a', '#f2e6d8', 'koi'); },
  fish_masu(px) { fishIcon(px, '#6f8f9a', '#e8b0b8', 'masu'); },
  fish_namazu(px) { fishIcon(px, '#4e4a40', '#8a8474', 'namazu', true); },
  // 夜だけ釣れる魚。ホタルメダカ：小さめの青緑の魚で、背と尾に光る点
  fish_hotaru(px) {
    fishIcon(px, '#2f5a66', '#bfe3c8', 'hotaru');
    for (const [x, y, k] of [[8, 6, 1.0], [10, 6, 0.85], [14, 7, 0.9], [14, 10, 0.8], [6, 7, 0.7]]) put(px, x, y, tone(hex('#e6ff6a'), 1 + k * 0.2));
    put(px, 9, 5, tone(hex('#e6ff6a'), 0.9));
  },
  // ツキウナギ：夜の池の細長い魚。濃い紺の体がうねり、背に月のような黄色い斑
  fish_tsuki(px) {
    const g = shapeGrid();
    for (const [x0, y0, x1, y1] of [[1.5, 11.5, 5, 9.5], [5, 9.5, 8.5, 10.5], [8.5, 10.5, 12, 7.5], [12, 7.5, 14.5, 4.5]]) line(g, x0, y0, x1, y1, 2.6, 'b');
    for (const [x0, y0, x1, y1] of [[2.5, 12.3, 5, 10.6], [5, 10.6, 8.5, 11.6]]) line(g, x0, y0, x1, y1, 1, 'w');
    puffy(px, g, { b: { c: hex('#2c3452'), shine: 0.45 }, w: { c: hex('#9aa6c8'), flat: true } }, 'tsuki');
    put(px, 14, 4, [20, 20, 28]); put(px, 13, 4, [235, 235, 245]);
    for (const [x, y] of [[9, 9], [10, 9], [6, 9]]) put(px, x, y, hex('#f4dc6a'));
  },
  // ベッド：木の枠に赤い掛け布団、頭の側に白いまくら（斜めから見た箱）
  bed(px) {
    // 左が頭の板、まくら、掛け布団（上の面と前の垂れ）、木の枠、脚。光は左上から
    const art = [
      '................',
      '................',
      '................',
      '.hh.............',
      '.hHh............',
      '.hHhwwwW........',
      '.hHhwwwwRRRRRR..',
      '.hHhWwwRRRRRRRR.',
      '.hHhRRRRRRRRRRRr',
      '.hHhrrrrrrrrrrrr',
      '.hHhrrrrrrrrrrrr',
      '.hHhFFFFFFFFFFFf',
      '.hHhffffffffffff',
      '.d.d.........d.d',
      '................',
      '................',
    ];
    const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? '.' : art[y][x]);
    const wood = hex('#a87040'), woodL = hex('#c88c54'), woodD = hex('#6e4524'), red = hex('#cc3c3c'), redL = hex('#e86058'), redD = hex('#962a30'), white = hex('#f4f1e8'), whiteD = hex('#cfcabc');
    const COL = { h: woodD, H: woodL, w: white, W: whiteD, R: red, r: redD, F: woodL, f: wood, d: woodD };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const ch = at(x, y); if (ch === '.') continue;
      let c = COL[ch];
      if (ch === 'R' && (at(x, y - 1) === '.' || at(x - 1, y) === 'w' || at(x - 1, y) === 'W')) c = redL;      // 布団の上の縁は明るい
      if (ch === 'R' && (x + y) % 5 === 0) c = tone(red, 0.9);                                                   // しわ
      if (ch === 'r' && y === 9) c = tone(redD, 1.12);
      if (ch === 'w' && (at(x, y - 1) === '.')) c = tone(white, 1.04);
      if ((at(x + 1, y) === '.' || at(x, y + 1) === '.') && ch !== 'd') c = tone(c, 0.62);                       // 右下の縁はかげ
      put(px, x, y, c);
    }
  },
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
    // ミルク：白いミルクが入った鉄のバケツ（取っ手つき）
    const g = shapeGrid();
    poly(g, [[3, 7.5], [13, 7.5], [11.8, 15], [4.2, 15]], 'b');
    poly(g, [[3.4, 10.2], [12.6, 10.2], [12.4, 11.4], [3.6, 11.4]], 'd');
    ellipse(g, 8, 7.4, 5.2, 1.9, 'r');
    ellipse(g, 8, 7.4, 4.0, 1.2, 'm');
    for (const [x0, y0, x1, y1] of [[2.8, 7, 4.2, 3.6], [4.2, 3.6, 8, 2.2], [8, 2.2, 11.8, 3.6], [11.8, 3.6, 13.2, 7]]) line(g, x0, y0, x1, y1, 1.0, 'h');
    puffy(px, g, { b: { c: hex('#a8aeb6'), shine: 0.4 }, d: { c: hex('#7c828a'), flat: true }, r: { c: hex('#cfd4da'), shine: 0.3, flat: true }, m: { c: hex('#fbfbf6'), shine: 0.5, flat: true }, h: { c: hex('#5c6168'), flat: true } }, 'milk');
    put(px, 6, 7, [255, 255, 255]); put(px, 7, 7, [255, 255, 255]);
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
// マイクラの決まりにならう（絵は写さず、配置と形の考え方だけ）：
//   柄は左下の角から右上へ 45° にまっすぐ。明るい茶（x + y = 15）と暗い茶（x + y = 16）の 2 段で、1 マスずつの階段。
//   頭は右上の端。どの道具も柄の向きは同じ。頭は 3〜4 段の明るさ（左上が明るく右下が暗い）、縁取りは頭の色のいちばん暗い色。
// 柄にそった座標 u（右上ほど大きい）と、柄からの横のずれ v（左上が正）。マスの中を 4×4 に分けて、半分以上入るマスをぬる
const UV = (X, Y) => ({ u: (X - Y) / Math.SQRT2, v: (15.5 - X - Y) / Math.SQRT2 });
const fillUV = (g, fn, m, th = 0.5) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let n = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const { u, v } = UV(x + (i + 0.5) / 4, y + (j + 0.5) / 4); if (fn(u, v)) n++; } if (n / 16 >= th) g[y * S + x] = m; } };
// 柄：yTop の行まで（左下の角 (0,15) から）
const handle = (g, yTop) => { for (let y = 15; y >= yTop; y--) { const xl = 15 - y, xd = 16 - y; if (xl >= 0 && xl < S) g[y * S + xl] = 'w'; if (xd < S && y >= 1) g[y * S + xd] = 'd'; } };
const TOOL_SHAPE = {
  // つるはし：柄に直角の大きな弓。左上の角の近くから右下の角の近くまで対角いっぱいにのび、まん中が右上へふくらむ「⌒」。柄は弓のまん中に刺さる
  pickaxe(g) {
    handle(g, 5);
    // 弓の中心線：v（柄に直角）を -1〜1 で動かすと、u（右上）がまん中でいちばん大きい
    for (let k = -1; k <= 1.0001; k += 0.01) {
      const vv = k * 9.2, uu = 6.2 - 3.4 * k * k, r = 1.25 - 0.55 * k * k;
      fillUV(g, (u, v) => (u - uu) ** 2 + (v - vv) ** 2 <= r * r, 'm', 0.45);
    }
  },
  // 斧：柄の上の端の左に、5×5 ぐらいの斧頭（刃の外側＝左がすこし広い）。右には柄の先が少し出るだけ
  axe(g) {
    handle(g, 1);
    rows(g, [[1, rng2(5, 8)], [2, rng2(5, 11)], [3, rng2(6, 12)], [4, rng2(6, 11)], [5, rng2(5, 10)], [6, rng2(5, 8)]], 'm');
  },
  // シャベル：柄の先に、柄と同じ向きの平たいスコップ（幅 3〜4 マス、先は丸い）
  shovel(g) {
    handle(g, 6);
    fillUV(g, (u, v) => { const w = 1.9; if (Math.abs(v) > w) return false; if (u < 2.6) return false; const tip = 8.2; if (u > tip - w) return (u - (tip - w)) ** 2 + v * v <= w * w; return true; }, 'm');
  },
  // くわ：柄の先から左へ 3〜4 マスの細い頭。左のはしが少し下がる。斧よりずっと小さい
  hoe(g) {
    handle(g, 1);
    rows(g, [[1, rng2(9, 14)], [2, [9, 10]], [3, [9]]], 'm');
  },
  // 剣：刃は左下から右上へ斜め。左下よりに柄と直角の短いつば、その下に短い握りと柄頭
  sword(g) {
    fillUV(g, (u, v) => u > -3.2 && u < 9.6 && Math.abs(v) <= 1.25 - Math.max(0, u - 8.2) * 0.8, 'm');
    fillUV(g, (u, v) => u >= -4.4 && u <= -3.2 && Math.abs(v) <= 3.0, 'g');
    for (const [x, y] of [[3, 12], [2, 13]]) g[y * S + x] = 'w';
    for (const [x, y] of [[4, 12], [3, 13]]) g[y * S + x] = 'd';
    for (const [x, y] of [[1, 14], [2, 14], [1, 13]]) g[y * S + x] = 'g';
  },
  // 釣りざお：茶色の握りと、素材のさお（今の形のまま）
  fishing_rod(g) {
    fillAP(g, (a, p) => a >= -12 && a <= -6 && (p === 0 || p === 1), 'b');
    fillAP(g, (a, p) => a >= -5 && a <= 11 && (p === 0 || (p === 1 && a < 3)), 'm');
  },
};
const ROD_LINE = [[14, 3], [14, 4], [14, 5], [14, 6], [14, 7], [14, 8], [14, 9], [14, 10]];
// 釣りざおだけは前の描き方。ほかの道具は js/toolart.js の絵（3D の道具と同じ）
let TA = null;
function drawTool(px, mat, kind) {
  if (kind !== 'fishing_rod') { px.set(TA.toolPixels(kind, mat)); return; }
  const g = shapeGrid();
  TOOL_SHAPE[kind](g);
  const seed = mat + kind;
  const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : g[y * S + x]);
  // 釣りざおの木のさおは柄と同じ茶色。つば・柄頭は濃い革色
  const palOf = (c) => ({ m: PAL[mat], w: PAL.stick, d: PAL.stick, b: PAL.wrap, g: PAL.wrap }[c]);
  const out = (x, y) => !at(x, y);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 縁取り：形の外側に 1px（中の色を縁で食わない）。色は、となりの部品のいちばん暗い色
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (at(x, y)) continue;
    const n = N4.map(([dx, dy]) => at(x + dx, y + dy)).find((c) => c === 'm' || c === 'g' || c === 'b'); // 縁取りは頭（とつば・握り）だけ。柄の階段はそのまま
    if (n) put(px, x, y, palOf(n)[0]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = at(x, y); if (!c) continue;
    const P = palOf(c);
    if (c === 'w' || c === 'd') { put(px, x, y, P[c === 'w' ? 3 : 1]); continue; } // 柄：明るい茶と暗い茶の 2 段
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

(async () => {
TA = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'js', 'toolart.js')).href);
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
// 8 倍で 4 つ（つるはし・斧・シャベル・くわ）を並べた確かめ用。上の段が木、下の段が鉄
{
  const Z = 8, CELL = S * Z + 16, K4 = ['pickaxe', 'axe', 'shovel', 'hoe'], M2 = ['wood', 'iron'];
  const W = CELL * K4.length + 16, H = CELL * M2.length + 16, sheet = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 139; sheet[i * 4 + 1] = 139; sheet[i * 4 + 2] = 139; sheet[i * 4 + 3] = 255; }
  M2.forEach((mat, r) => K4.forEach((kind, c) => {
    const px = canvas(); drawTool(px, mat, kind);
    for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) {
      const si = (Math.floor(y / Z) * S + Math.floor(x / Z)) * 4; if (!px[si + 3]) continue;
      const di = ((8 + r * CELL + y) * W + 8 + c * CELL + x) * 4; sheet[di] = px[si]; sheet[di + 1] = px[si + 1]; sheet[di + 2] = px[si + 2];
    }
  }));
  const dst = path.join(__dirname, '..', 'video', '道具_8倍.png');
  writePNG(dst, W, H, sheet);
  console.log('8 倍の確かめ: ' + dst);
}
})();
