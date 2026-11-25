#!/usr/bin/env node
'use strict';
// バッジの絵（48x48 のドット絵）を作る。
// 真ん中の絵は Codex の画像生成で作った tools/badge_emblems.png（3×2 に 6 つ並んだ絵）から切り出して縮め、
// まわりのメダルの輪（銅・銀・金・ダイヤ）はここで描く。輪は左上から光が当たったふくらみ、
// 内側はくぼんだ皿にして、平面的にならないようにする。段は輪の下の粒の数（1〜4）でもわかる。
// 使い方: node tools/gen_badges.js [見本の出力先.png]  → icons/badge_<id>_<段>.png, icons/badge_founder.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writePNG } = require('./png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'icons');
const SRC = path.join(__dirname, 'badge_emblems.png');
const S = 48;
// 元絵の並び（左上から右へ、上の段・下の段）
const ORDER = ['founder', 'guard', 'lumber', 'miner', 'farmer', 'builder'];
const TIERS = [
  { name: 'bronze', c: [184, 112, 58] },
  { name: 'silver', c: [196, 204, 216] },
  { name: 'gold', c: [240, 192, 56] },
  { name: 'diamond', c: [92, 222, 232] },
];
const FOUNDER = { name: 'founder', c: [86, 188, 104] };

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function tone(c, f) {
  if (f >= 1) { const k = f - 1; return [c[0] * f + k * 50, c[1] * f + k * 34, c[2] * f + k * 6]; }
  const k = 1 - f; return [c[0] * f - k * 8, c[1] * f - k * 4, c[2] * f + k * 30];
}

// ---------- PNG を読む（8bit の RGB / RGBA、インターレースなし） ----------
function readPNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, type = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; if (d[8] !== 8 || d[12]) throw new Error('8bit・インターレースなしの PNG だけ読めます'); }
    if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0; if (!bpp) throw new Error('RGB か RGBA の PNG だけ読めます');
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; px[o] = cur[x * bpp]; px[o + 1] = cur[x * bpp + 1]; px[o + 2] = cur[x * bpp + 2]; px[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    prev = cur;
  }
  return { w, h, px };
}

// ---------- 元絵から 1 つ切り出す（白い背景は外側からたどって透明に） ----------
function cutEmblem(img, col, row) {
  const cw = Math.floor(img.w / 3), ch = Math.floor(img.h / 2), x0 = col * cw, y0 = row * ch;
  const bg = new Uint8Array(cw * ch);
  const isBg = (x, y) => { const o = ((y0 + y) * img.w + x0 + x) * 4, r = img.px[o], g = img.px[o + 1], b = img.px[o + 2]; return Math.min(r, g, b) > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 26; };
  const st = [];
  for (let x = 0; x < cw; x++) st.push([x, 0], [x, ch - 1]);
  for (let y = 0; y < ch; y++) st.push([0, y], [cw - 1, y]);
  while (st.length) {
    const [x, y] = st.pop();
    if (x < 0 || y < 0 || x >= cw || y >= ch || bg[y * cw + x] || !isBg(x, y)) continue;
    bg[y * cw + x] = 1; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  let minX = cw, minY = ch, maxX = -1, maxY = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (!bg[y * cw + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { get: (x, y) => { const o = ((y0 + y) * img.w + x0 + x) * 4; return bg[y * cw + x] ? null : [img.px[o], img.px[o + 1], img.px[o + 2]]; }, minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// n×n に縮める（ます目ごとの平均。半分以上が絵なら色を置く）
function shrink(E, n) {
  const sc = Math.max(E.w, E.h) / n, ow = Math.round(E.w / sc), oh = Math.round(E.h / sc), out = [];
  for (let y = 0; y < oh; y++) {
    const row = [];
    for (let x = 0; x < ow; x++) {
      let r = 0, g = 0, b = 0, k = 0, all = 0;
      for (let yy = Math.floor(y * sc); yy < Math.floor((y + 1) * sc); yy++) for (let xx = Math.floor(x * sc); xx < Math.floor((x + 1) * sc); xx++) {
        all++; const c = E.get(E.minX + xx, E.minY + yy); if (c) { r += c[0]; g += c[1]; b += c[2]; k++; }
      }
      row.push(k * 2 >= all ? [r / k, g / k, b / k] : null);
    }
    out.push(row);
  }
  return out;
}

// ---------- メダル ----------
function medal(tier, emblem, pips, sparkle) {
  const px = new Uint8Array(S * S * 4), cx = (S - 1) / 2, cy = (S - 1) / 2;
  const put = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = clamp(c[0]); px[i + 1] = clamp(c[1]); px[i + 2] = clamp(c[2]); px[i + 3] = a; };
  const R = 23, RI = 18.2, L = [-0.68, -0.73], base = tier.c;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), nx = dx / (d || 1), ny = dy / (d || 1), lit = nx * L[0] + ny * L[1];
    if (d > R + 0.5) continue;
    if (d > R - 0.7) { put(x, y, tone(base, 0.28)); continue; } // 外のふち
    if (d > RI) { // 輪：外側半分はふくらみ、内側半分は内へ落ちる面
      const u = (d - RI) / (R - RI);
      let f = u > 0.45 ? 1 + 0.55 * lit : 0.88 - 0.42 * lit;
      if (u > 0.45 && u < 0.62) f += 0.14 + 0.12 * Math.max(0, lit); // 輪の頂の光
      f += (((x * 7 + y * 13) % 5) - 2) * 0.015; // 少しざらつき
      put(x, y, tone(base, f)); continue;
    }
    if (d > RI - 0.9) { put(x, y, tone(base, 0.32)); continue; } // 内のふち
    // くぼんだ皿：左上が影、右下が明るい
    const f = 0.48 - 0.16 * lit * (d / RI) + 0.04 * (1 - d / RI);
    put(x, y, tone(base.map((v) => v * 0.55 + 40), f));
  }
  // 段の粒（輪の下、1〜4 個）
  for (let i = 0; i < pips; i++) {
    const a = Math.PI / 2 + (i - (pips - 1) / 2) * 0.26, px0 = Math.round(cx + Math.cos(a) * 20.6), py0 = Math.round(cy + Math.sin(a) * 20.6);
    for (let yy = -1; yy <= 2; yy++) for (let xx = -1; xx <= 2; xx++) if (!((xx === -1 || xx === 2) && (yy === -1 || yy === 2))) put(px0 + xx, py0 + yy, [30, 22, 28]);
    put(px0, py0, [255, 255, 240]); put(px0 + 1, py0, tone(base, 1.25)); put(px0, py0 + 1, tone(base, 1.1)); put(px0 + 1, py0 + 1, tone(base, 0.7));
  }
  if (sparkle) for (const [sx, sy] of [[9, 9], [38, 13], [12, 38]]) { put(sx, sy, [255, 255, 255]); put(sx - 1, sy, [210, 250, 255]); put(sx + 1, sy, [210, 250, 255]); put(sx, sy - 1, [210, 250, 255]); put(sx, sy + 1, [210, 250, 255]); }
  // 真ん中の絵：影 → ふちどり → 絵
  const eh = emblem.length, ew = emblem[0].length, ox = Math.round(cx - ew / 2 + 0.5), oy = Math.round(cy - eh / 2 + 0.5);
  const at = (x, y) => (y >= 0 && y < eh && x >= 0 && x < ew ? emblem[y][x] : null);
  const getPx = (x, y) => { const i = (y * S + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  for (let y = -1; y <= eh + 1; y++) for (let x = -1; x <= ew + 1; x++) {
    if (at(x, y) || !at(x - 1, y - 1)) continue;
    const X = ox + x + 1, Y = oy + y + 1; if (X < 0 || Y < 0 || X >= S || Y >= S) continue; put(X, Y, getPx(X, Y).map((v) => v * 0.55));
  }
  for (let y = -1; y <= eh; y++) for (let x = -1; x <= ew; x++) {
    if (at(x, y)) continue;
    if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) put(ox + x, oy + y, [28, 22, 30]);
  }
  for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) { const c = at(x, y); if (c) put(ox + x, oy + y, c.map((v) => (v - 128) * 1.08 + 128)); }
  return px;
}

const img = readPNG(SRC);
const emb = {};
ORDER.forEach((id, i) => { emb[id] = shrink(cutEmblem(img, i % 3, Math.floor(i / 3)), 28); });
const made = [];
const save = (name, px) => { writePNG(path.join(OUT, name + '.png'), S, S, px); made.push([name, px]); };
save('badge_founder', medal(FOUNDER, emb.founder, 0, true));
for (const id of ORDER.slice(1)) TIERS.forEach((t, i) => save(`badge_${id}_${i}`, medal(t, emb[id], i + 1, i === 3)));
console.log(`${made.length} 枚つくりました（icons/badge_*.png）`);

// 見本（4 倍に広げて並べる）
const sheet = process.argv[2];
if (sheet) {
  const Z = 4, cols = 4, gap = 8, rows = Math.ceil(made.length / cols), W = cols * (S * Z + gap) + gap, H = rows * (S * Z + gap) + gap;
  const out = new Uint8Array(W * H * 4).fill(255);
  for (let i = 0; i < out.length; i += 4) { out[i] = 60; out[i + 1] = 66; out[i + 2] = 78; }
  made.forEach(([, px], n) => {
    const bx = gap + (n % cols) * (S * Z + gap), by = gap + Math.floor(n / cols) * (S * Z + gap);
    for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) {
      const s = (Math.floor(y / Z) * S + Math.floor(x / Z)) * 4; if (!px[s + 3]) continue;
      const o = ((by + y) * W + bx + x) * 4; out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2];
    }
  });
  writePNG(sheet, W, H, out);
}
