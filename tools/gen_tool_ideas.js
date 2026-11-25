#!/usr/bin/env node
'use strict';
// 道具の 3 案を 1 枚に並べる（選んでもらう用）。今の採用版のアイコンは変えない。
// 使い方: node tools/gen_tool_ideas.js → video/道具の案.png
// 行：案 A・B・C。各行の上の段が 16px のまま（2 倍の灰色の枠の中）、下の段が 8 倍。
// 横：つるはし・斧・シャベル・くわ・剣を、木（左の 5 つ）と鉄（右の 5 つ）で
const path = require('path');
const { writePNG } = require('./png');

(async () => {
  const TI = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'js', 'toolart_ideas.js')).href);
  const S = 16, Z = 8, MATS = ['wood', 'iron'];
  const items = [];
  for (const mat of MATS) for (const kind of TI.IDEA_KINDS) items.push([kind, mat]);
  const CELL = S * Z + 12, LEFT = 60, W = LEFT + CELL * items.length + 12;
  const SMALL_H = 40, ROW_H = SMALL_H + CELL + 24, H = 12 + ROW_H * TI.IDEAS.length;
  const px = new Uint8Array(W * H * 4);
  const fill = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = (y * W + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; } };
  fill(0, 0, W, H, [46, 42, 38]);
  // 行の名前（A・B・C）を 5×7 のドット文字で
  const GLYPH = { A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'], C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'] };
  const blit = (img, ox, oy, z) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4; if (img[i + 3]) fill(ox + x * z, oy + y * z, z, z, [img[i], img[i + 1], img[i + 2]]); } };
  TI.IDEAS.forEach((style, r) => {
    const oy = 12 + r * ROW_H;
    GLYPH[style].forEach((row, gy) => [...row].forEach((b, gx) => { if (b === '1') fill(14 + gx * 6, oy + 40 + gy * 6, 6, 6, [240, 230, 200]); }));
    items.forEach(([kind, mat], c) => {
      const ox = LEFT + c * CELL;
      const img = TI.ideaPixels(style, kind, mat);
      // 16px のまま（持ち物の枠のような灰色）
      fill(ox, oy, 36, 36, [139, 139, 139]); blit(img, ox + 10, oy + 10, 1);
      // 8 倍
      fill(ox, oy + SMALL_H, S * Z, S * Z, [139, 139, 139]); blit(img, ox, oy + SMALL_H, Z);
    });
    if (r < TI.IDEAS.length - 1) fill(8, oy + ROW_H - 12, W - 16, 2, [90, 84, 76]);
  });
  const dst = path.join(__dirname, '..', 'video', '道具の案.png');
  writePNG(dst, W, H, px);
  console.log('道具の案: ' + dst);
})();
