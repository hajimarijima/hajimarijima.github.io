#!/usr/bin/env node
'use strict';
// ふだんの村人のスキン（skins/skin_NNN.png。体の種類は「指定なし」）を、見た目で「女性っぽい」「男性っぽい」「どちらとも」に分けて
// skins/gender.json に書く（tools/gender.js が、名前から女性・男性と分かった人のスキンをこの中から選ぶ）。
// 形は js/skingen.js の makeSkin と同じ作り方から決めるので、スキンを作り直しても同じ結果になる。
// 使い方: node tools/skin_gender.js [見本の画像を書くフォルダ]   … フォルダを渡すと、女性・男性・どちらともの見本を並べた画像も書く
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { SKIN_COUNT } = require('./rand');
const { writePNG } = require('./png');

const OUT = path.join(__dirname, '..', 'skins', 'gender.json');
const LONG = ['long', 'longbangs', 'bob', 'ponytail', 'bun'], SHORT = ['short', 'sidepart', 'spiky', 'buzz', 'bald'];
// 女性らしい所の点：長い髪・ボブ・ポニーテール・おだんご 2、ぱっつん 1、スカート・ワンピース 2、リボン・花かざり 1。ひげがあれば 0。
// 女性：fNeed 点以上（ふだんのスキンは腕が太くまつ毛もないので 3、女性の体は細い腕・まつ毛があるので 2）。男性：mMax 点以下（ふだんのスキンは
// ぱっつん前髪くらいなら男性に見えるので 1。男性の体に変える時は、はっきりさせるため 0）
// ポニーテール・おだんごは、女性の体の時だけ顔の横にも髪がかかる（ほかの体では前から短い髪に見えるので 1 点）
const femPoints = (s) => (s.facial && s.facial !== 'none') ? 0
  : ((s.style === 'ponytail' || s.style === 'bun') && s.body !== 'female' ? 1 : LONG.includes(s.style) ? 2 : s.style === 'bangs' ? 1 : 0) + (s.bottom === 'skirt' || s.dress ? 2 : 0) + (s.hat === 'ribbon' || s.hat === 'flower' ? 1 : 0);
function tagOf(s, fNeed = 3, mMax = 1) {
  const f = femPoints(s);
  return f >= fNeed ? 'f' : f <= mMax ? 'm' : 'n';
}

// 見本：正面の 2D を並べる（tools/gen_skins.js と同じ並べ方）
const front = (aw) => [[8, 8, 8, 8, 4, 0], [20, 20, 8, 12, 4, 8], [44, 20, aw, 12, 4 - aw, 8], [36, 52, aw, 12, 12, 8], [4, 20, 4, 12, 4, 20], [20, 52, 4, 12, 8, 20],
  [40, 8, 8, 8, 4, 0], [20, 36, 8, 12, 4, 8], [44, 36, aw, 12, 4 - aw, 8], [52, 52, aw, 12, 12, 8], [4, 36, 4, 12, 4, 20], [4, 52, 4, 12, 8, 20]];
function sheet(skins, cols, scale, file) {
  const cw = 16 * scale + 8, chh = 32 * scale + 8, rows = Math.max(1, Math.ceil(skins.length / cols));
  const SW = cols * cw, SH = rows * chh, px = new Uint8Array(SW * SH * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 238; px[i + 1] = 233; px[i + 2] = 220; px[i + 3] = 255; }
  skins.forEach((s, k) => {
    const ox = (k % cols) * cw + 4, oy = Math.floor(k / cols) * chh + 4;
    for (const [sx, sy, w, h, dx, dy] of front(s.slim ? 3 : 4)) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((sy + y) * 64 + sx + x) * 4;
      if (s.px[si + 3] < 128) continue;
      for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
        const di = ((oy + (dy + y) * scale + a) * SW + ox + (dx + x) * scale + b) * 4;
        px[di] = s.px[si]; px[di + 1] = s.px[si + 1]; px[di + 2] = s.px[si + 2]; px[di + 3] = 255;
      }
    }
  });
  writePNG(file, SW, SH, px);
}

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'skingen.js')).href);
  const out = {
    note: 'tools/skin_gender.js が作る。f / m：ふだんのスキン skin_NNN.png（指定なし）が女性 / 男性に見える番号。ff / mm：makeSkin(番号, female / male) がはっきり女性 / 男性に見える番号（体の種類を変える時は、この中のシードを使う）',
    f: [], m: [], ff: [], mm: [],
  };
  const all = { f: [], m: [], n: [], ff: [], mm: [] };
  for (let i = 0; i < SKIN_COUNT; i++) {
    const s = G.makeSkin(i, 'none'), t = tagOf(s);
    if (t !== 'n') out[t].push(i);
    all[t].push(s);
    const sf = G.makeSkin(i, 'female'), sm = G.makeSkin(i, 'male');
    if (tagOf(sf, 2) === 'f') { out.ff.push(i); all.ff.push(sf); }
    if (tagOf(sm, 3, 0) === 'm') { out.mm.push(i); all.mm.push(sm); }
  }
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`ふだんのスキン：女性 ${out.f.length}・男性 ${out.m.length}・どちらとも ${SKIN_COUNT - out.f.length - out.m.length}／女性の体ではっきり女性 ${out.ff.length}・男性の体ではっきり男性 ${out.mm.length}: ${OUT}`);
  const dir = process.argv[2];
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const t of ['f', 'm', 'n', 'ff', 'mm']) sheet(all[t].slice(0, 64), 16, 3, path.join(dir, 'skins_' + t + '.png'));
    console.log('見本: ' + dir);
  }
})();
