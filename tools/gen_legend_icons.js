#!/usr/bin/env node
'use strict';
// 激レアの物・宝箱・島のトロフィーの絵（16x16 のドット絵）を作る。→ icons/<物>.png
//   形は下の文字の並び（1 文字 = 1 ドット、空白は何もない）。色は文字ごと。
//   平面的にしないように：左上から光が当たる向きで、左上のふちは明るく・右下のふちは暗く、形の中も左上から右下へ少しずつ暗くする。
//   まわりは暗いふちどり。激レア（rarity: legend）は、外に金色のぼんやりした光と、きらっと光る粒を足す。
// 使い方: node tools/gen_legend_icons.js [見本の出力先.png]
const fs = require('fs');
const path = require('path');
const { writePNG } = require('./png');

const OUT = path.join(__dirname, '..', 'icons');
const S = 16;
const RAINBOW = [[236, 76, 76], [246, 150, 56], [246, 214, 70], [96, 198, 96], [76, 148, 236], [168, 98, 222]];
const PAL = {
  G: [242, 188, 40], g: [212, 132, 28], e: [28, 18, 18], Y: [244, 198, 54], y: [196, 128, 28], r: [214, 40, 60], b: [62, 120, 232],
  S: [255, 232, 112], B: [150, 204, 250], T: [44, 172, 150], t: [22, 108, 98], F: [222, 52, 40], f: [250, 142, 40], q: [240, 228, 196],
  P: [246, 150, 192], W: [252, 250, 244], O: [250, 142, 40], o: [206, 88, 30], C: [194, 142, 60], w: [246, 236, 206], k: [44, 36, 42],
  D: [150, 92, 48], L: [184, 120, 66], h: [250, 210, 222], '*': [255, 255, 255],
};
const ICONS = {
  golden_fish: { legend: true, g: [
    '     gg       ',
    '   GGGGGG   gg',
    '  GGGGGGGG ggg',
    ' GeGGGGGGGGgg ',
    'GGGGGGGGGGGgg ',
    ' GGGGGGGGGGggg',
    '  GGGGGGGG  gg',
    '   GGGGGG     ',
    '     gg       '] },
  old_crown: { legend: true, g: [
    'Y    Y    Y',
    'YY  YYY  YY',
    'YYY YYYYYYY',
    'YYYYYYYYYYY',
    'YrYYYbYYYrY',
    'YYYYYYYYYYY',
    'yyyyyyyyyyy'] },
  star_shard: { legend: true, g: [
    '     S     ',
    '    SSS    ',
    '    SSS    ',
    'SSSSSSSSSSS',
    ' SSSSSSSSS ',
    '  SSSSSSS  ',
    '  SSSSSSS  ',
    ' SSSS SSSS ',
    ' SSS   SSS ',
    'SS       SS'] },
  rainbow_shell: { legend: true, g: [
    '    RRRRR    ',
    '  RRRRRRRRR  ',
    ' RRRRRRRRRRR ',
    'RRRRRRRRRRRRR',
    'RRRRRRRRRRRRR',
    ' RRRRRRRRRRR ',
    '  RRRRRRRRR  ',
    '    RRRRR    ',
    '   hhhhhhh   ',
    '    hhhhh    '] },
  moon_drop: { legend: true, g: [
    '    B    ',
    '    B    ',
    '   BBB   ',
    '   BBB   ',
    '  BBBBB  ',
    ' BB*BBBB ',
    ' B*BBBBB ',
    'BBBBBBBBB',
    'BBBBBBBBB',
    'BBBBBBBBB',
    ' BBBBBBB ',
    '  BBBBB  '] },
  dragon_scale: { legend: true, g: [
    '  TTTTTTT  ',
    ' TTTTTTTTT ',
    'TTTTTtTTTTT',
    'TTTTTtTTTTT',
    'TTTTTtTTTTT',
    ' TTTTtTTTT ',
    ' TTTTtTTTT ',
    '  TTTtTTT  ',
    '   TTtTT   ',
    '    TTT    ',
    '     T     '] },
  phoenix_feather: { legend: true, g: [
    '       YY',
    '      YfY',
    '     ffFf',
    '    fFFFf',
    '   fFFFFf',
    '  fFFFFf ',
    '  fFFFf  ',
    ' fFFFf   ',
    ' fFFf    ',
    ' fFf     ',
    ' qf      ',
    'q        '] },
  mermaid_comb: { legend: true, g: [
    '  PPPPPPPP  ',
    ' PPPPWWPPPP ',
    'PPPPPWWPPPPP',
    'PPPPPPPPPPPP',
    'P P P P P P ',
    'P P P P P P ',
    'P P P P P P '] },
  sun_stone: { legend: true, g: [
    '   OOOOO   ',
    '  O*OOOOO  ',
    ' O*OOOOOOO ',
    'OOOOOOOOOOO',
    'ooooooooooo',
    ' ooooooooo ',
    '  ooooooo  ',
    '   ooooo   ',
    '    ooo    ',
    '     o     '] },
  ancient_compass: { legend: true, g: [
    '    CCCCC    ',
    '  CCwwwwwCC  ',
    ' CwwwwrwwwwC ',
    ' CwwwrrrwwwC ',
    'CwwwwrrrwwwwC',
    'CwwwwwrwwwwwC',
    'CwwwwwkwwwwwC',
    'CwwwwwkwwwwwC',
    'CwwwwkkkwwwwC',
    ' CwwwwkwwwwC ',
    ' CwwwwwwwwwC ',
    '  CCwwwwwCC  ',
    '    CCCCC    '] },
  island_trophy: { legend: true, g: [
    '  YYYYYYY  ',
    'YYYYYYYYYYY',
    'Y YYYYYYY Y',
    'Y YYYYYYY Y',
    ' YYYYYYYYY ',
    '   YYYYY   ',
    '    YYY    ',
    '     Y     ',
    '    YYY    ',
    '   kkkkk   ',
    '   kkkkk   '] },
  treasure_box: { legend: false, g: [
    ' LLLLLLLLLLLL ',
    'LLLLLLLLLLLLLL',
    'YYYYYYYYYYYYYY',
    'DDDDDDYYDDDDDD',
    'DDDDDYkkYDDDDD',
    'DDDDDDYYDDDDDD',
    'DDDDDDDDDDDDDD',
    'YYYYYYYYYYYYYY',
    'DDDDDDDDDDDDDD'] },
};

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function draw(def) {
  const rows = def.g, h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const ox = Math.floor((S - w) / 2), oy = Math.floor((S - h) / 2) + (def.legend ? 0 : 1);
  const at = (x, y) => { const r = rows[y - oy]; const c = r && r[x - ox]; return c && c !== ' ' ? c : null; };
  const px = new Uint8Array(S * S * 4);
  const put = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = clamp(c[0]); px[i + 1] = clamp(c[1]); px[i + 2] = clamp(c[2]); px[i + 3] = a; };
  const cx = ox + w / 2, cy = oy + h / 2;
  // 形：左上が明るく右下が暗い（ふちは強めに）
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ch = at(x, y); if (!ch) continue;
    let base = ch === 'R' ? RAINBOW[Math.min(5, Math.floor(((x - ox) / w) * 6))] : PAL[ch];
    if (ch === 'R' && (x - ox) % 2 === 1) base = base.map((v) => v * 0.9); // 貝のすじ
    if (ch === '*') { put(x, y, base); continue; }
    const same = (dx, dy) => at(x + dx, y + dy) === ch;
    const lit = (!at(x - 1, y) ? 1 : !same(-1, 0) ? 0.4 : 0) + (!at(x, y - 1) ? 1 : !same(0, -1) ? 0.4 : 0);
    const dark = (!at(x + 1, y) ? 1 : !same(1, 0) ? 0.4 : 0) + (!at(x, y + 1) ? 1 : !same(0, 1) ? 0.4 : 0);
    const grad = ((cx - x) + (cy - y)) / (w + h) * 0.36;
    let f = 1 + 0.16 * lit - 0.2 * dark + grad;
    f += (((x * 5 + y * 3) % 3) - 1) * 0.02;
    put(x, y, f >= 1 ? base.map((v) => v + (255 - v) * (f - 1) * 0.9) : base.map((v) => v * f));
  }
  // ふちどり（となりの色を暗くした色）
  const outline = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (at(x, y)) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => at(x + dx, y + dy)).find(Boolean);
    if (!n) continue;
    const c = n === 'R' ? RAINBOW[2] : PAL[n];
    put(x, y, c.map((v) => v * 0.28 + 8)); outline.push([x, y]);
  }
  // 激レア：金色の光と、きらっとした粒
  if (def.legend) {
    const filled = (x, y) => x >= 0 && y >= 0 && x < S && y < S && px[(y * S + x) * 4 + 3] > 0;
    const ring1 = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!filled(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => filled(x + dx, y + dy))) ring1.push([x, y]);
    for (const [x, y] of ring1) put(x, y, [255, 210, 80], [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled(x + dx, y + dy)) ? 150 : 70);
    const spark = (sx, sy) => { if (filled(sx, sy) && px[(sy * S + sx) * 4 + 3] === 255) return; put(sx, sy, [255, 255, 255], 255); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!filled(sx + dx, sy + dy) || px[((sy + dy) * S + sx + dx) * 4 + 3] < 255) put(sx + dx, sy + dy, [255, 246, 190], 200); };
    spark(S - 2, 1); spark(1, S - 3);
  }
  return px;
}

const made = [];
for (const [k, def] of Object.entries(ICONS)) { const px = draw(def); writePNG(path.join(OUT, k + '.png'), S, S, px); made.push([k, px]); }
console.log(`${made.length} 枚つくりました（icons/）`);
const sheet = process.argv[2];
if (sheet) {
  const Z = 8, cols = 6, gap = 8, rows = Math.ceil(made.length / cols), W = cols * (S * Z + gap) + gap, H = rows * (S * Z + gap) + gap;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = 70; out[i + 1] = 78; out[i + 2] = 92; out[i + 3] = 255; }
  made.forEach(([, px], n) => {
    const bx = gap + (n % cols) * (S * Z + gap), by = gap + Math.floor(n / cols) * (S * Z + gap);
    for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) {
      const s = (Math.floor(y / Z) * S + Math.floor(x / Z)) * 4, a = px[s + 3] / 255; if (!a) continue;
      const o = ((by + y) * W + bx + x) * 4; for (let c = 0; c < 3; c++) out[o + c] = out[o + c] * (1 - a) + px[s + c] * a;
    }
  });
  writePNG(sheet, W, H, out);
}
module.exports = { ICONS };
