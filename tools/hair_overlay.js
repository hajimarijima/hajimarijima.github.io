#!/usr/bin/env node
'use strict';
// ふだんの村人のスキン（skins/skin_NNN.png）の髪を、今の js/skingen.js の髪にそろえる（頭の重ね層の髪の厚み・背中へ垂れる髪・三つ編みなど）。
// 腕・脚は変えない。何度やっても同じ結果になる（2 回目以降は何も変わらない）。skins/index.json の髪型の名前もそろえる。
// 使い方: node tools/hair_overlay.js [--backup <フォルダ>] [--dry]
//   --backup：書きかえる前の元の画像を置く所（サイトの外。省くと一時フォルダの town-skins-backup）。すでにある控えは上書きしない
//   --dry：書かずに、変わる枚数だけ数える
// やり方：
//   1) スキンの腕・脚が js/skingen.js の makeSkin(番号, 'none') と同じなら、作り方どおりのスキンとみて、
//      今の makeSkin の頭と胴（下の層・重ね層）をそのまま写す
//   2) 違う（手で直した・外から来た）スキンは、下の層は変えず、頭のてっぺんの色を髪の色とみて、横・うしろ・前髪の髪の色の所に
//      空いている頭の重ね層だけ、明・中・暗の髪を足す
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { readPNG, writePNG } = require('./png');

const SKINS = path.join(__dirname, '..', 'skins');
const W = 64;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bi = args.indexOf('--backup');
const BACKUP = bi >= 0 ? path.resolve(args[bi + 1]) : path.join(os.tmpdir(), 'town-skins-backup');
// 髪が描かれる所：頭（下の層・重ね層）と胴（下の層・重ね層＝背中に垂れる髪）。ここ以外（腕・脚）が作り方どおりなら、作り方の物とみる
//   袖の層（右 x40〜55・y32〜47、左 x48〜63・y48〜63）もツインテールの房・肩の毛先が描かれる
const inHat = (x, y) => y < 16 || (x >= 16 && x < 40 && y >= 16 && y < 48) || (x >= 40 && x < 56 && y >= 32 && y < 48) || (x >= 48 && y >= 48);

// 2) の作り方：見本の色に近い所だけに髪を重ねる
function sampleOverlay(px) {
  const at = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
  const top = [];
  for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) top.push(at(x, y));
  const med = [0, 1, 2].map((k) => top.map((c) => c[k]).sort((a, b) => a - b)[top.length >> 1]);
  const near = (c) => c[3] > 200 && Math.abs(c[0] - med[0]) + Math.abs(c[1] - med[1]) + Math.abs(c[2] - med[2]) < 90;
  if (top.filter(near).length < 40) return px; // てっぺんが髪でない（はげ・帽子）なら足さない
  const out = Uint8Array.from(px);
  const put = (x, y, c, f) => { const i = (y * W + x) * 4; if (out[i + 3] > 0) return; out[i] = Math.min(255, c[0] * f); out[i + 1] = Math.min(255, c[1] * f); out[i + 2] = Math.min(255, c[2] * f); out[i + 3] = 255; };
  // てっぺん
  for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) { const c = at(x, y); if (near(c)) put(x + 32, y, c, (x - 8) + y >= 3 && (x - 8) + y <= 5 ? 1.14 : 1.02); }
  // 横（右 x0〜7・左 x16〜23）とうしろ（x24〜31）：上から続く髪の色の所。毛先は 1 マスおきに抜く
  for (let x = 0; x < 32; x++) {
    if (x >= 8 && x < 16) continue;
    let n = 0;
    while (n < 8 && near(at(x, 8 + n))) n++;
    for (let v = 0; v < n; v++) { if (n >= 3 && v === n - 1 && x % 2 === 0) continue; put(x + 32, 8 + v, at(x, 8 + v), v === 1 ? 1.12 : v === n - 1 ? 0.8 : 1); }
  }
  // 前髪（正面 x8〜15）：上から髪の色が続く所、ただし 3 段まで（目とまゆは見える）
  for (let x = 8; x < 16; x++) {
    let n = 0;
    while (n < 3 && near(at(x, 8 + n))) n++;
    for (let v = 0; v < n; v++) { if (n >= 2 && v === n - 1 && x % 2 === 0) continue; put(x + 32, 8 + v, at(x, 8 + v), v === 0 ? 1.1 : v === n - 1 ? 0.8 : 1); }
  }
  return out;
}

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'skingen.js')).href);
  const files = fs.readdirSync(SKINS).filter((f) => /^skin_\d{3}\.png$/.test(f)).sort();
  let fromGen = 0, sampled = 0, same = 0;
  if (!dry) fs.mkdirSync(BACKUP, { recursive: true });
  for (const f of files) {
    const file = path.join(SKINS, f), id = Number(f.slice(5, 8));
    const img = readPNG(file);
    if (img.w !== W || img.h !== W) { console.log('64x64 でないので飛ばす: ' + f); continue; }
    const gen = G.makeSkin(id, 'none').px;
    let match = true;
    for (let y = 0; y < W && match; y++) for (let x = 0; x < W; x++) {
      if (inHat(x, y)) continue;
      const i = (y * W + x) * 4;
      if (img.px[i] !== gen[i] || img.px[i + 1] !== gen[i + 1] || img.px[i + 2] !== gen[i + 2] || img.px[i + 3] !== gen[i + 3]) { match = false; break; }
    }
    let out;
    if (match) {
      out = Uint8Array.from(img.px);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (inHat(x, y)) for (let k = 0; k < 4; k++) out[(y * W + x) * 4 + k] = gen[(y * W + x) * 4 + k];
    } else out = sampleOverlay(img.px);
    if (out.every((v, i) => v === img.px[i])) { same++; continue; }
    if (match) fromGen++; else sampled++;
    if (dry) continue;
    const bk = path.join(BACKUP, f);
    if (!fs.existsSync(bk)) fs.copyFileSync(file, bk);
    writePNG(file, W, W, out);
  }
  // index.json の特徴（髪型の名前）を今の作り方にそろえる
  const IDX = path.join(SKINS, 'index.json');
  if (fs.existsSync(IDX)) {
    const idx = JSON.parse(fs.readFileSync(IDX, 'utf8'));
    let changed = 0;
    for (const e of idx) {
      const t = G.makeSkin(e.id, 'none').traits;
      if (JSON.stringify(t) !== JSON.stringify(e.traits)) { e.traits = t; changed++; }
    }
    if (changed && !dry) {
      const bk = path.join(BACKUP, 'index.json');
      if (!fs.existsSync(bk)) fs.copyFileSync(IDX, bk);
      fs.writeFileSync(IDX, JSON.stringify(idx, null, 1) + '\n');
    }
    if (changed) console.log(`index.json の特徴：${changed} 件${dry ? 'が変わる' : 'を直した'}`);
  }
  console.log(`${dry ? '（ためし）' : ''}髪の重ね層：作り方どおり ${fromGen} 枚・色から足した ${sampled} 枚・変わらない ${same} 枚` + (dry ? '' : `。元の画像の控え: ${BACKUP}`));
})();
