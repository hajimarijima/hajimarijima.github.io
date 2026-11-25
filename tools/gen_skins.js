#!/usr/bin/env node
'use strict';
// 村人のスキン（64x64・マイクラと同じ配置）を作る。形と色の決まりは js/skingen.js（サイトの「別のを引く」と同じ）。
// 使い方: node tools/gen_skins.js [枚数]
//   skins/skin_000.png … ：ふだんの村人のスキン（体の種類は「指定なし」、シードは番号）
//   skins/見本24.png ：男性・女性・指定なしを 8 体ずつ並べた見本
// すべてこのスクリプトの組み合わせで作る。既存のスキンは写していない。
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { SKIN_COUNT } = require('./rand');
const { writePNG } = require('./png');

const OUT = path.join(__dirname, '..', 'skins');
const COUNT = Number(process.argv[2]) || SKIN_COUNT;
const W = 64;

// 正面の 2D（16×32）：[元 x, 元 y, 幅, 高さ, 先 x, 先 y]。slim は腕が 3px
const front = (slim) => {
  const aw = slim ? 3 : 4;
  return [
    [8, 8, 8, 8, 4, 0], [20, 20, 8, 12, 4, 8], [44, 20, aw, 12, 4 - aw, 8], [36, 52, aw, 12, 12, 8], [4, 20, 4, 12, 4, 20], [20, 52, 4, 12, 8, 20],
    [40, 8, 8, 8, 4, 0], [20, 36, 8, 12, 4, 8], [44, 36, aw, 12, 4 - aw, 8], [52, 52, aw, 12, 12, 8], [4, 36, 4, 12, 4, 20], [4, 52, 4, 12, 8, 20],
  ];
};
function sheet(skins, cols, scale, file) {
  const cw = 16 * scale + 16, chh = 32 * scale + 16, rows = Math.ceil(skins.length / cols);
  const SW = cols * cw, SH = rows * chh, px = new Uint8Array(SW * SH * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 238; px[i + 1] = 233; px[i + 2] = 220; px[i + 3] = 255; }
  skins.forEach((s, k) => {
    const ox = (k % cols) * cw + 8, oy = Math.floor(k / cols) * chh + 8;
    for (const [sx, sy, w, h, dx, dy] of front(s.slim)) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((sy + y) * W + sx + x) * 4;
      if (s.px[si + 3] < 128) continue;
      for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
        const X = ox + (dx + x) * scale + b, Y = oy + (dy + y) * scale + a, di = (Y * SW + X) * 4;
        px[di] = s.px[si]; px[di + 1] = s.px[si + 1]; px[di + 2] = s.px[si + 2]; px[di + 3] = 255;
      }
    }
  });
  writePNG(file, SW, SH, px);
}

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'skingen.js')).href);
  fs.mkdirSync(OUT, { recursive: true });
  const index = [];
  for (let i = 0; i < COUNT; i++) {
    const s = G.makeSkin(i, 'none');
    const file = 'skin_' + String(i).padStart(3, '0') + '.png';
    writePNG(path.join(OUT, file), W, W, s.px);
    index.push({ id: i, file, traits: s.traits });
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  // 見本：男性 8・女性 8・指定なし 8
  const sample = [];
  for (const body of ['male', 'female', 'none']) for (let k = 0; k < 8; k++) sample.push(G.makeSkin(1000 + k * 7919, body));
  sheet(sample, 8, 5, path.join(OUT, '見本24.png'));
  console.log('スキンを ' + COUNT + ' 枚と、見本 24 体を作りました: ' + OUT);
})();
