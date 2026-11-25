#!/usr/bin/env node
'use strict';
// 斧の案を 8 倍で並べる（選ぶ用）。使い方: node tools/gen_axe_ideas.js → video/斧の案.png
// 行：案 1・2・3（js/toolart.js の AXE_IDEAS）。採用した案の行の左に明るい印。
// 横：斧（木）・斧（鉄）・斧（ダイヤ）、すき間、黒い影だけの つるはし・斧・シャベル・くわ（形だけで斧と分かるか）
const path = require('path');
const { writePNG } = require('./png');

(async () => {
  const TA = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'js', 'toolart.js')).href);
  const S = 16, Z = 8, CELL = S * Z + 12, LEFT = 60, GAP = 30;
  const ideas = Object.keys(TA.AXE_IDEAS).map(Number);
  const cols = [['axe', 'wood'], ['axe', 'iron'], ['axe', 'diamond'], null, ['pickaxe', 'iron', 1], ['axe', 'iron', 1], ['shovel', 'iron', 1], ['hoe', 'iron', 1]];
  const W = LEFT + CELL * 7 + GAP + 12, ROW_H = CELL + 12, H = 12 + ROW_H * ideas.length;
  const px = new Uint8Array(W * H * 4);
  const fill = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; } };
  fill(0, 0, W, H, [46, 42, 38]);
  const GLYPH = { 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], 2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'] };
  ideas.forEach((n, r) => {
    const oy = 12 + r * ROW_H;
    const col = n === TA.AXE_CHOSEN ? [255, 214, 90] : [200, 190, 170];
    (GLYPH[n] || []).forEach((row, gy) => [...row].forEach((b, gx) => { if (b === '1') fill(14 + gx * 6, oy + 40 + gy * 6, 6, 6, col); }));
    if (n === TA.AXE_CHOSEN) fill(4, oy, 4, S * Z, col);
    let ox = LEFT;
    for (const c of cols) {
      if (!c) { ox += GAP; continue; }
      const [kind, mat, shadow] = c;
      const img = TA.toolPixels(kind, mat, { axe: n });
      fill(ox, oy, S * Z, S * Z, shadow ? [225, 225, 225] : [139, 139, 139]);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4; if (img[i + 3]) fill(ox + x * Z, oy + y * Z, Z, Z, shadow ? [0, 0, 0] : [img[i], img[i + 1], img[i + 2]]); }
      ox += CELL;
    }
  });
  const dst = path.join(__dirname, '..', 'video', '斧の案.png');
  writePNG(dst, W, H, px);
  console.log('斧の案: ' + dst);
})();
