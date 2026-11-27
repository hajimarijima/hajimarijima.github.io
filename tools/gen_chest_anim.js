#!/usr/bin/env node
'use strict';
// 宝箱を開ける演出の絵（32x32 のドット絵 3 枚。重ねて使う）→ icons/chest_base.png・chest_lid.png・chest_lid_open.png
//   chest_base     … 箱の本体と、開いた口（中に光る金貨）。ふたを閉じている間は chest_lid が口をかくす。
//   chest_lid      … 閉じたふた（丸い屋根の形。正面）
//   chest_lid_open … 後ろへ開いたふた（内がわが見える。下からの光で手前が明るい）
//   立体感：左上から光。上と左のふちは明るく、右と下は暗い。板の継ぎ目・金具のふち・影を入れる。まわりは暗いふちどり。
// 使い方: node tools/gen_chest_anim.js [見本の出力先.png]
const path = require('path');
const { writePNG } = require('./png');

const OUT = path.join(__dirname, '..', 'icons');
const S = 32;
const C = {
  ol: [42, 22, 12],
  w1: [196, 128, 66], w2: [160, 96, 46], w3: [124, 70, 32], w4: [92, 50, 24], seam: [86, 46, 22],
  g1: [255, 236, 130], g2: [244, 192, 48], g3: [210, 138, 28], g4: [150, 90, 20],
  in1: [70, 38, 20], in2: [48, 26, 14],
  c1: [255, 248, 200], c2: [255, 222, 100], c3: [236, 170, 40],
  key: [30, 16, 10], white: [255, 255, 255],
};
const mk = () => Array.from({ length: S }, () => new Array(S).fill(null));
const set = (g, x, y, c) => { if (x >= 0 && y >= 0 && x < S && y < S) g[y][x] = c; };

// 木の色：左が明るく右が暗い（＋上のふちは明るい）
const wood = (x, x0, x1, lift = 0) => { const u = (x - x0) / (x1 - x0); const i = Math.min(3, Math.max(0, Math.floor(u * 3.2 + 0.4) - lift)); return [C.w1, C.w2, C.w2, C.w3][i]; };
const gold = (x, y, x0, y0, x1, y1) => (x === x0 || y === y0 ? C.g1 : x === x1 || y === y1 ? C.g4 : (x + y) % 5 === 0 ? C.g3 : C.g2);

function body(g) {
  const X0 = 3, X1 = 28, Y0 = 16, Y1 = 28;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    let c;
    if (x <= 5) c = gold(x, y, 3, Y0, 5, Y1);
    else if (x >= 26) c = gold(x, y, 26, Y0, 28, Y1);
    else if (y >= 26) c = gold(x, y, X0, 26, X1, Y1);
    else {
      c = wood(x, 6, 25);
      if (y === 21) c = C.seam; // 板の継ぎ目
      else if (y === 22) c = C.w1; // 継ぎ目の下は光が当たる
      if (y === Y0) c = C.w4; // ふたの下の影
      if ((x * 7 + y * 3) % 11 === 0 && y !== 21) c = C.w3; // 木目
    }
    set(g, x, y, c);
  }
  // 錠前（本体の上のまん中）
  for (let y = 17; y <= 22; y++) for (let x = 13; x <= 18; x++) set(g, x, y, gold(x, y, 13, 17, 18, 22));
  set(g, 15, 19, C.key); set(g, 16, 19, C.key); set(g, 15, 20, C.key); set(g, 16, 20, C.key); set(g, 16, 21, C.key);
  // 金具の鋲
  for (const [x, y] of [[4, 18], [27, 18], [4, 24], [27, 24]]) set(g, x, y, C.g1);
}

function mouth(g) {
  // 開いた口（上から少しのぞく）：奥のふち → 中の金貨（光る）→ 手前のふち
  for (let x = 4; x <= 27; x++) {
    set(g, x, 11, x <= 5 || x >= 26 ? C.g3 : C.w3); // 奥のふち
    set(g, x, 12, x <= 5 || x >= 26 ? C.g4 : C.in2); // 奥の内がわ（暗い）
    for (let y = 13; y <= 14; y++) {
      const k = (x * 3 + y * 5) % 7;
      set(g, x, y, k === 0 ? C.c1 : k < 4 ? C.c2 : C.c3);
    }
    set(g, x, 15, x <= 5 || x >= 26 ? C.g1 : C.w1); // 手前のふち（光が当たる）
  }
  set(g, 3, 12, C.g3); set(g, 3, 13, C.g3); set(g, 3, 14, C.g2); set(g, 3, 15, C.g1);
  set(g, 28, 12, C.g4); set(g, 28, 13, C.g4); set(g, 28, 14, C.g4); set(g, 28, 15, C.g3);
  set(g, 9, 13, C.white); set(g, 20, 14, C.white); set(g, 14, 13, C.c1);
}

function lidClosed(g) {
  // 丸い屋根の形：上ほど狭い
  const span = (y) => (y === 5 ? [8, 23] : y === 6 ? [5, 26] : y === 7 ? [4, 27] : [3, 28]);
  for (let y = 5; y <= 16; y++) {
    const [a, b] = span(y);
    for (let x = a; x <= b; x++) {
      let c;
      if (x <= a + 2 && y >= 7) c = gold(x, y, a, 7, a + 2, 16);
      else if (x >= b - 2 && y >= 7) c = gold(x, y, b - 2, 7, b, 16);
      else if (y >= 15) c = y === 15 ? C.g2 : C.g4; // ふたの下の金の帯
      else {
        c = wood(x, 6, 25, y <= 7 ? 1 : 0);
        if (y <= 6) c = y === 5 ? C.w1 : (x < 14 ? C.w1 : C.w2); // 屋根のてっぺんは明るい
        if (y === 10) c = C.seam; else if (y === 11) c = x < 22 ? C.w1 : C.w2;
        if ((x * 5 + y * 7) % 13 === 0 && y !== 10) c = C.w3;
      }
      set(g, x, y, c);
    }
  }
  for (let x = 6; x <= 25; x++) if (g[16][x] === C.g4 && (x === 6 || x === 25)) set(g, x, 16, C.g3);
  // 留め金（錠前に下りる舌）
  for (let y = 13; y <= 17; y++) for (let x = 14; x <= 17; x++) set(g, x, y, gold(x, y, 14, 13, 17, 17));
  set(g, 15, 17, C.g4); set(g, 16, 17, C.g4);
}

function lidOpen(g) {
  // 後ろへ倒れたふた：内がわが見える。遠い上のほうは狭い。下（口に近いほう）は中の光で明るい
  const top = 1, bot = 10;
  for (let y = top; y <= bot; y++) {
    const inset = Math.round((bot - y) * 0.35);
    const a = 3 + inset, b = 28 - inset;
    for (let x = a; x <= b; x++) {
      let c;
      if (y === top) c = x < 16 ? C.w1 : C.w2; // てっぺんの外がわ（ふたの背）
      else if (x <= a + 1) c = y >= bot - 2 ? C.g2 : C.g3;
      else if (x >= b - 1) c = y >= bot - 2 ? C.g3 : C.g4;
      else {
        // 内がわ：上は暗く、口に近いほど光を受けて明るい
        const lit = (y - top) / (bot - top);
        c = lit > 0.8 ? [212, 150, 70] : lit > 0.55 ? C.w3 : lit > 0.3 ? C.w4 : C.in1;
        if ((x - a) % 6 === 0) c = c.map((v) => v * 0.78); // 板の継ぎ目（たて）
      }
      set(g, x, y, c);
    }
  }
  // ふたのふち（手前に金の帯）
  for (let x = 3; x <= 28; x++) set(g, x, bot, x < 10 ? C.g1 : x > 22 ? C.g3 : C.g2);
}

function outline(g) {
  const o = mk();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx])) o[y][x] = C.ol;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (o[y][x]) g[y][x] = o[y][x];
}

function toPx(g, shadow) {
  const px = new Uint8Array(S * S * 4);
  if (shadow) for (let x = 4; x <= 27; x++) for (const y of [30]) { const i = (y * S + x) * 4; px[i + 3] = x < 7 || x > 24 ? 50 : 90; }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = g[y][x]; if (!c) continue;
    const i = (y * S + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return px;
}

const gb = mk(); mouth(gb); body(gb); outline(gb);
const gl = mk(); lidClosed(gl); outline(gl);
const go = mk(); lidOpen(go); outline(go);
const out = { chest_base: toPx(gb, true), chest_lid: toPx(gl), chest_lid_open: toPx(go) };
for (const [k, px] of Object.entries(out)) writePNG(path.join(OUT, k + '.png'), S, S, px);
console.log('3 枚つくりました（icons/chest_*.png）');

const sheet = process.argv[2];
if (sheet) {
  // 見本：閉じた形と開いた形を 8 倍で並べる
  const Z = 8, gap = 16, W = gap + 2 * (S * Z + gap), H = S * Z + 2 * gap;
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 40; px[i + 1] = 36; px[i + 2] = 70; px[i + 3] = 255; }
  const blit = (src, bx, by) => { for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) { const s = (Math.floor(y / Z) * S + Math.floor(x / Z)) * 4, a = src[s + 3] / 255; if (!a) continue; const o = ((by + y) * W + bx + x) * 4; for (let c = 0; c < 3; c++) px[o + c] = px[o + c] * (1 - a) + src[s + c] * a; } };
  blit(out.chest_base, gap, gap); blit(out.chest_lid, gap, gap);
  blit(out.chest_base, gap * 2 + S * Z, gap); blit(out.chest_lid_open, gap * 2 + S * Z, gap);
  writePNG(sheet, W, H, px);
}
