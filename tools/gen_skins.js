#!/usr/bin/env node
'use strict';
// 村人のスキン（64x64・マイクラと同じ配置）を自動で作る。
// 使い方: node tools/gen_skins.js [枚数]
// すべてこのスクリプトの組み合わせで作る。既存のスキンは写していない。
const fs = require('fs');
const path = require('path');
const { makeRng, hashStr, SKIN_COUNT } = require('./rand');
const { writePNG } = require('./png');

const OUT = path.join(__dirname, '..', 'skins');
const COUNT = Number(process.argv[2]) || SKIN_COUNT;
const W = 64;

// ---------- 色 ----------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const SKIN_TONES = ['#ffe2c8', '#f6cfae', '#ebbd97', '#dca77c', '#c68c62', '#a8714b', '#86553a', '#64402c'].map(hex);
const HAIR = [
  ['黒', '#2a2428', 10], ['こげ茶', '#4a3024', 10], ['茶', '#74492c', 9], ['くり色', '#8e5530', 6],
  ['明るい茶', '#a8784a', 5], ['金', '#d9b062', 4], ['白金', '#e6dcbc', 2], ['赤毛', '#bb5a2a', 3],
  ['赤茶', '#7f2e26', 3], ['灰', '#8f9096', 2], ['白', '#d8d8de', 1], ['青', '#4a6cbc', 1.2],
  ['桃', '#d87aa0', 1.2], ['緑', '#4f9466', 0.8], ['紫', '#7a52a8', 1],
].map(([n, c, w]) => ({ name: n, c: hex(c), w }));
const FABRIC = [
  ['赤', '#c43c3c'], ['青', '#3c64b4'], ['緑', '#468c5a'], ['黄', '#e2c04e'], ['白', '#ecebe4'],
  ['炭', '#34343e'], ['こげ茶', '#80583a'], ['だいだい', '#d48a3a'], ['紫', '#7a52a0'], ['青緑', '#4aa2b4'],
  ['桃', '#dc8296'], ['灰', '#969ea8'], ['生成り', '#ccb88c'], ['紺', '#283c6e'], ['オリーブ', '#6e823c'],
  ['えんじ', '#9c2a3c'], ['空色', '#86b8e2'], ['若草', '#9cc45c'],
].map(([n, c]) => ({ name: n, c: hex(c) }));
const PANTS = [
  ['紺のジーンズ', '#324678'], ['ジーンズ', '#46649a'], ['黒', '#2a2a30'], ['茶', '#644630'],
  ['カーキ', '#a8966c'], ['灰', '#62666e'], ['オリーブ', '#5a643c'], ['生成り', '#c8c2b2'],
].map(([n, c]) => ({ name: n, c: hex(c) }));
const SHOES = ['#5a3c28', '#242226', '#dcdcd6', '#a83232', '#96704a', '#3c4a6e'].map(hex);
const EYES = ['#5a3c28', '#28202a', '#3c6ebe', '#3c8250', '#6e7882', '#b4782a', '#7a4aa0'].map(hex);
const LEATHER = hex('#5e3e26');
const GOLD = hex('#e0b648');

// ---------- 描く道具 ----------
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// 明るさを変える。暗い所は青み、明るい所は黄みへ少し寄せる（のっぺり防止）
function tone(c, f) {
  if (f >= 1) { const k = f - 1; return [c[0] * f + k * 40, c[1] * f + k * 26, c[2] * f + k * 2]; }
  const k = 1 - f;
  return [c[0] * f - k * 10, c[1] * f - k * 6, c[2] * f + k * 26];
}
const FACE_LIGHT = { top: 1.1, front: 1.0, left: 0.9, right: 0.86, back: 0.8, bottom: 0.68 };

function faceRects(px, py, w, h, d) {
  return {
    top: [px + d, py, w, d], bottom: [px + d + w, py, w, d],
    right: [px, py + d, d, h], front: [px + d, py + d, w, h],
    left: [px + d + w, py + d, d, h], back: [px + 2 * d + w, py + d, w, h],
  };
}

class Skin {
  constructor(seed) { this.px = new Uint8Array(W * W * 4); this.seed = seed; }
  noise(x, y) { return ((hashStr(this.seed + ':' + x + ',' + y) % 1000) / 1000) * 2 - 1; }
  put(x, y, c, amp = 0.03) {
    const n = 1 + this.noise(x, y) * amp;
    const i = (y * W + x) * 4;
    this.px[i] = clamp(c[0] * n); this.px[i + 1] = clamp(c[1] * n); this.px[i + 2] = clamp(c[2] * n); this.px[i + 3] = 255;
  }
  // 箱の 6 面を塗る。fn(面, u, v, 幅, 高さ) が色か null を返す
  paint(origin, dims, fn, light = true) {
    const rects = faceRects(origin[0], origin[1], dims[0], dims[1], dims[2]);
    for (const face in rects) {
      const [x0, y0, fw, fh] = rects[face];
      for (let v = 0; v < fh; v++) for (let u = 0; u < fw; u++) {
        const r = fn(face, u, v, fw, fh);
        if (!r) continue;
        const c = Array.isArray(r) ? r : r.c;
        const amp = Array.isArray(r) ? 0.03 : (r.amp ?? 0.03);
        let f = light ? FACE_LIGHT[face] : 1;
        // 側面は上が明るく下が暗い
        if (light && face !== 'top' && face !== 'bottom') f *= 1.04 - 0.08 * (v / Math.max(1, fh - 1));
        this.put(x0 + u, y0 + v, tone(c, f), amp);
      }
    }
  }
}

// 部位の場所（64x64 の配置）
const P = {
  head: [0, 0], hat: [32, 0],
  body: [16, 16], jacket: [16, 32],
  rarm: [40, 16], rsleeve: [40, 32], larm: [32, 48], lsleeve: [48, 48],
  rleg: [0, 16], rpants: [0, 32], lleg: [16, 48], lpants: [0, 48],
};
const HEAD = [8, 8, 8], BODY = [8, 12, 4], LIMB = [4, 12, 4];

// ---------- 髪型 ----------
// fr: 正面の列ごとの髪の深さ（0..3 行）、sf: 横の前側、bk: うしろ
const HAIR_STYLES = [
  { id: 'short', name: 'ショート', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 2, bk: 4, w: 10 },
  { id: 'bangs', name: 'ぱっつん', fr: [3, 3, 3, 3, 3, 3, 3, 3], sf: 5, bk: 6, w: 6 },
  { id: 'sidepart', name: '七三', fr: [3, 3, 2, 1, 1, 1, 1, 2], sf: 3, bk: 5, w: 8 },
  { id: 'swept', name: '流し前髪', fr: [1, 1, 1, 2, 2, 3, 3, 3], sf: 3, bk: 5, w: 7 },
  { id: 'long', name: 'ロング', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 8, bk: 8, body: 5, w: 6 },
  { id: 'longbangs', name: 'ロング前髪', fr: [3, 3, 3, 2, 2, 3, 3, 3], sf: 8, bk: 8, body: 6, w: 5 },
  { id: 'bob', name: 'ボブ', fr: [2, 2, 2, 2, 2, 2, 2, 2], sf: 6, bk: 6, w: 6 },
  { id: 'ponytail', name: 'ポニーテール', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 3, bk: 5, tail: true, w: 6 },
  { id: 'spiky', name: 'つんつん', fr: [2, 1, 2, 1, 2, 1, 2, 1], sf: 2, bk: 3, tufts: true, w: 6 },
  { id: 'curly', name: 'くせ毛', fr: [2, 2, 3, 2, 2, 3, 2, 2], sf: 4, bk: 6, curly: true, w: 5 },
  { id: 'bun', name: 'おだんご', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 3, bk: 5, bun: true, w: 4 },
  { id: 'buzz', name: 'ぼうず', fr: [1, 1, 1, 1, 1, 1, 1, 1], sf: 1, bk: 2, buzz: true, w: 3 },
  { id: 'bald', name: 'つるつる', fr: [0, 0, 0, 0, 0, 0, 0, 0], sf: 0, bk: 0, bald: true, w: 1 },
];

function makeSkin(index) {
  const R = makeRng('town-skin-' + index);
  const S = new Skin('s' + index);
  const traits = [];

  const skin = R.pick(SKIN_TONES);
  const hairDef = R.weighted(HAIR.map((h) => [h, h.w]));
  const hair = hairDef.c;
  const style = R.weighted(HAIR_STYLES.map((s) => [s, s.w]));
  const eye = R.pick(EYES);
  traits.push('髪: ' + style.name + '・' + hairDef.name);

  // 列ごとの髪の色むら（毛の束）
  const strand = Array.from({ length: 32 }, () => R.range(0.9, 1.08));
  const hairDark = tone(hair, 0.62);

  // 服
  const shirt = R.pick(FABRIC);
  let shirt2 = R.pick(FABRIC); if (shirt2 === shirt) shirt2 = FABRIC[(FABRIC.indexOf(shirt) + 5) % FABRIC.length];
  const pattern = R.weighted([['plain', 6], ['stripe', 2], ['twotone', 2], ['buttons', 2]]);
  const longSleeve = R.chance(0.55);
  const top = R.weighted([['none', 5], ['jacket', 3], ['vest', 2], ['hoodie', 2], ['cardigan', 1.5]]);
  let topColor = R.pick(FABRIC); if (topColor === shirt) topColor = FABRIC[(FABRIC.indexOf(shirt) + 3) % FABRIC.length];
  const pants = R.pick(PANTS);
  const bottom = R.weighted([['pants', 7], ['shorts', 2], ['skirt', 2]]);
  const skirtDef = R.pick(FABRIC);
  const skirtColor = skirtDef.c;
  const overalls = top === 'none' && R.chance(0.18);
  const apron = !overalls && R.chance(0.16);
  const apronColor = R.pick([hex('#f0ece0'), hex('#c8a46e'), hex('#7a9c6e'), hex('#6e86b4'), hex('#b45a5a')]);
  const belt = !overalls && !apron && top !== 'hoodie' && R.chance(0.5);
  const shoes = R.pick(SHOES);
  const boots = R.chance(0.3);
  const scarf = R.chance(0.1);
  const scarfColor = R.pick(FABRIC).c;
  const neckV = R.chance(0.4);

  const topName = { none: '', jacket: '上着', vest: 'ベスト', hoodie: 'パーカー', cardigan: 'カーディガン' }[top];
  traits.push('服: ' + shirt.name + 'のシャツ' + (topName ? '・' + topColor.name + 'の' + topName : '') + (overalls ? '・つなぎ' : ''));
  traits.push((bottom === 'skirt' ? 'スカート' : bottom === 'shorts' ? '半ズボン' : 'ズボン') + ': ' + (bottom === 'skirt' ? skirtDef.name : pants.name));

  // 顔
  const eyeStyle = R.weighted([['white', 5], ['big', 3], ['dot', 2]]);
  const mouth = R.weighted([['line', 4], ['smile', 3], ['small', 2], ['open', 1]]);
  const blush = R.chance(0.3);
  const freckles = R.chance(0.1);
  const facial = style.bald || style.buzz || R.chance(0.12) ? R.weighted([['none', 2], ['mustache', 1], ['beard', 1]]) : 'none';

  // 小物（重ねる層）
  const hat = R.weighted([['none', 10], ['cap', 2], ['beanie', 2], ['straw', 1.5], ['headband', 1.5], ['bandana', 1.2], ['flower', 1]]);
  const hatColor = R.pick(FABRIC).c;
  const glasses = R.chance(0.16);
  const glassColor = R.pick([hex('#2a2a2e'), hex('#7a4a2a'), hex('#b0b4bc'), hex('#a83a3a')]);
  const watch = R.chance(0.12);
  const hatName = { none: '', cap: '帽子', beanie: 'ニット帽', straw: '麦わら帽子', headband: 'ヘアバンド', bandana: 'バンダナ', flower: '花かざり' }[hat];
  const extras = [hatName, glasses ? 'めがね' : '', apron ? 'エプロン' : '', scarf ? 'マフラー' : '', watch ? 'うで時計' : ''].filter(Boolean);
  if (extras.length) traits.push('小物: ' + extras.join('・'));

  // ---------- 頭 ----------
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  function hairDepth(face, u) {
    if (style.bald) return 0;
    if (face === 'front') return style.fr[u];
    if (face === 'right') return lerp(style.bk, Math.max(style.sf, style.fr[0]), u / 7); // u=7 が前
    if (face === 'left') return lerp(Math.max(style.sf, style.fr[7]), style.bk, u / 7); // u=0 が前
    if (face === 'back') return style.bk;
    return 0;
  }
  function hairPx(face, u, v, depth) {
    let f = strand[(face.length * 7 + u * 3) % 32];
    if (depth > 0 && v === depth - 1) f *= 0.8;        // 毛先は暗く
    if (v === 0 && face !== 'top') f *= 1.06;
    if (style.curly && ((u + v * 3) % 4 === 0)) f *= 0.82;
    if (style.buzz) return { c: mix(tone(hair, f * 0.9), skin, 0.35), amp: 0.08 };
    return { c: tone(hair, f), amp: style.curly ? 0.07 : 0.04 };
  }
  S.paint(P.head, HEAD, (face, u, v) => {
    if (face === 'top') {
      if (style.bald) return tone(skin, 1.05);
      let f = strand[(u * 5 + v) % 32];
      if (u + v >= 2 && u + v <= 4) f *= 1.12;   // 光の筋
      if (style.id === 'sidepart' && u === 5) f *= 0.75; // 分け目
      if (style.buzz) return { c: mix(tone(hair, f * 0.9), skin, 0.35), amp: 0.08 };
      return { c: tone(hair, f), amp: 0.05 };
    }
    if (face === 'bottom') return tone(skin, 0.85);
    const d = hairDepth(face, u);
    if (v < d) return hairPx(face, u, v, d);
    let c = skin;
    let f = 1;
    if (v === d && d > 0) f *= 0.86; // 髪の影
    if (face === 'front') {
      // 目
      if (v === 4) {
        if (eyeStyle === 'white') {
          if (u === 1 || u === 6) return [244, 244, 246];
          if (u === 2 || u === 5) return tone(eye, 0.9);
        } else if (eyeStyle === 'big') {
          if (u === 1 || u === 6) return tone(eye, 1.15);
          if (u === 2 || u === 5) return tone(eye, 0.75);
        } else if (u === 2 || u === 5) return [36, 30, 36];
      }
      if (v === 3 && eyeStyle === 'big' && (u === 1 || u === 2 || u === 5 || u === 6)) return hairDark;
      if (v === 3 && eyeStyle !== 'big' && (u === 1 || u === 2 || u === 5 || u === 6)) {
        if (style.fr[u] < 3 || true) return tone(mix(hairDark, skin, style.bald ? 0.5 : 0.15), 1);
      }
      // ひげ
      if (facial === 'mustache' && v === 5 && u >= 2 && u <= 5) return tone(hair, 0.85);
      if (facial === 'beard' && v >= 6 && !(v === 6 && (u === 3 || u === 4))) return { c: tone(hair, 0.85 + (v === 7 ? -0.1 : 0)), amp: 0.06 };
      if (facial === 'beard' && v === 5 && (u === 0 || u === 7)) return tone(hair, 0.85);
      // 鼻
      if (v === 5 && u === 4 && facial !== 'mustache') f *= 0.9;
      if (v === 5 && u === 3 && facial !== 'mustache') f *= 1.03;
      // 口
      const lip = mix(tone(skin, 0.7), [170, 70, 70], 0.35);
      if (mouth === 'line' && v === 6 && (u === 3 || u === 4)) return lip;
      if (mouth === 'small' && v === 6 && u === 4) return lip;
      if (mouth === 'smile') {
        if (v === 6 && u >= 3 && u <= 4) return lip;
        if (v === 5 && (u === 2 || u === 5) && facial === 'none') return mix(lip, skin, 0.4);
      }
      if (mouth === 'open' && v === 6 && (u === 3 || u === 4)) return u === 3 ? [110, 40, 46] : [150, 60, 64];
      // ほお
      if (blush && v === 5 && (u === 1 || u === 6)) c = mix(skin, [236, 120, 120], 0.35);
      if (freckles && v === 5 && (u === 1 || u === 2 || u === 5 || u === 6) && ((u + index) % 2 === 0)) f *= 0.84;
      if (v === 7) f *= 0.94;
      if (u === 0 || u === 7) f *= 0.95;
    } else {
      // 耳
      const earU = face === 'right' ? 4 : 3;
      if ((v === 4 || v === 5) && u === earU) f *= 0.88;
      if (v === 4 && u === earU + (face === 'right' ? 1 : -1)) f *= 0.94;
      if (v >= 6) f *= 0.95;
      if (face === 'back' && style.tail && (u === 3 || u === 4) && v >= d) return hairPx('back', u, v, 9);
    }
    return { c: tone(c, f), amp: 0.025 };
  });

  // 頭の重ね層：帽子・めがね・髪のボリューム
  S.paint(P.hat, HEAD, (face, u, v) => {
    if (face === 'bottom') return null;
    if (hat === 'cap') {
      if (face === 'top') return tone(hatColor, (u + v) % 5 === 0 ? 0.9 : 1);
      if (v <= 1) return face === 'back' && v === 1 && (u === 3 || u === 4) ? null : tone(hatColor, v === 1 ? 0.9 : 1);
      if (face === 'front' && v === 2) return tone(hatColor, 0.65);
    } else if (hat === 'beanie') {
      if (face === 'top') return (u === 3 || u === 4) && (v === 3 || v === 4) ? tone(hatColor, 1.25) : { c: tone(hatColor, u % 2 ? 0.94 : 1), amp: 0.05 };
      if (v <= 2) return tone(hatColor, v === 2 ? 1.12 : (u % 2 ? 0.9 : 1));
    } else if (hat === 'straw') {
      const straw = hex('#e6c878');
      if (face === 'top') return { c: tone(straw, (u + v) % 2 ? 0.94 : 1.02), amp: 0.06 };
      if (v === 0) return tone(straw, 0.98);
      if (v === 1) return tone(hatColor, 0.9);
      if (v === 2) return { c: tone(straw, 0.86), amp: 0.06 };
    } else if (hat === 'headband') {
      if (face !== 'top' && v === 1) return tone(hatColor, 1);
    } else if (hat === 'bandana') {
      if (face === 'top') return tone(hatColor, (u * v) % 3 === 0 ? 1.1 : 1);
      if (v === 0) return tone(hatColor, 1);
      if (face === 'back' && (u === 3 || u === 4) && v <= 3) return tone(hatColor, 0.85);
    } else if (hat === 'flower') {
      if (face === 'left' && v === 1 && u === 1) return [250, 250, 250];
      if (face === 'left' && ((v === 0 && u === 1) || (v === 2 && u === 1) || (v === 1 && (u === 0 || u === 2)))) return tone(hatColor, 1.15);
    }
    if (glasses && face === 'front') {
      if (v === 3 && (u === 1 || u === 2 || u === 5 || u === 6)) return glassColor;
      if (v === 4 && (u === 0 || u === 3 || u === 4 || u === 7)) return glassColor;
    }
    if (glasses && (face === 'left' || face === 'right') && v === 4) {
      const nearFront = face === 'right' ? u >= 5 : u <= 2;
      if (nearFront) return tone(glassColor, 0.9);
    }
    if (hat === 'none' && !style.bald && !style.buzz) {
      if (style.tufts && face === 'top' && (u + v) % 3 === 0) return tone(hair, 1.08);
      if (style.tufts && face !== 'top' && v === 0 && u % 2 === 0) return tone(hair, 1.02);
      if (style.curly && face === 'top') return { c: tone(hair, (u + v) % 2 ? 0.86 : 1.05), amp: 0.08 };
      if (style.curly && face !== 'top' && v === 0) return tone(hair, 0.95);
      if (style.bun && face === 'top' && u >= 3 && u <= 4 && v >= 2 && v <= 4) return tone(hair, v === 2 ? 1.12 : 0.92);
      if (style.bun && face === 'back' && u >= 3 && u <= 4 && v <= 1) return tone(hair, 0.9);
      if (style.tail && face === 'back' && (u === 3 || u === 4) && v >= 3 && v <= 5) return tone(hair, v === 3 ? 0.7 : 1.05);
    }
    return null;
  }, true);

  // ---------- 胴 ----------
  const shirtAt = (u, v, face) => {
    let c = shirt.c;
    if (pattern === 'stripe' && v % 3 === 1) c = mix(shirt.c, shirt2.c, 0.75);
    if (pattern === 'twotone' && v <= 3) c = shirt2.c;
    if (pattern === 'buttons' && face === 'front' && u === 3 && (v === 2 || v === 5 || v === 8)) return tone(shirt.c, 0.65);
    if (pattern === 'buttons' && face === 'front' && v === 0 && (u === 2 || u === 5)) c = mix(shirt.c, [255, 255, 255], 0.5);
    return c;
  };
  const torsoColor = (face, u, v, fw) => {
    // 下 2 行は腰（ズボン or スカート）
    const lower = bottom === 'skirt' ? skirtColor : pants.c;
    if (v >= 10) return { c: tone(lower, v === 11 ? 0.92 : 1), amp: 0.04 };
    if (overalls) {
      const bib = face === 'front' ? (u >= 1 && u <= 6 && v >= 5) || ((u === 1 || u === 6) && v < 5) : face === 'back' ? (v >= 8 || ((u === 2 || u === 5) && v < 8)) : v >= 8;
      if (bib) {
        if (face === 'front' && v === 5 && (u === 1 || u === 6)) return GOLD;
        if (face === 'front' && v >= 6 && v <= 7 && u >= 3 && u <= 4) return tone(pants.c, 0.85);
        return { c: pants.c, amp: 0.04 };
      }
    }
    if (belt && v === 9) {
      if (face === 'front' && (u === 3 || u === 4)) return u === 3 ? GOLD : tone(GOLD, 0.8);
      return tone(LEATHER, 1);
    }
    if (scarf && v <= 1) return tone(scarfColor, (u + v) % 3 === 0 ? 0.85 : 1);
    if (scarf && face === 'front' && u === 5 && v <= 5) return tone(scarfColor, v === 5 ? 0.85 : 0.95);
    if (apron) {
      if (face === 'front' && u >= 1 && u <= 6 && v >= 2) {
        if (v >= 6 && v <= 7 && u >= 2 && u <= 5) return tone(apronColor, v === 6 ? 0.85 : 0.92);
        return { c: apronColor, amp: 0.03 };
      }
      if (face === 'front' && (u === 2 || u === 5) && v < 2) return apronColor;
      if (face === 'back' && v === 6 && u >= 2 && u <= 5) return tone(apronColor, 0.95);
      if (face === 'back' && v === 7 && (u === 3 || u === 4)) return tone(apronColor, 0.85);
      if ((face === 'left' || face === 'right') && v === 6) return tone(apronColor, 0.9);
    }
    if (top === 'hoodie') {
      let f = 1;
      if (face === 'front' && (u === 3 || u === 4) && v >= 1 && v <= 3) return v === 3 ? [236, 236, 236] : [214, 214, 214];
      if (face === 'front' && v >= 6 && v <= 8 && u >= 2 && u <= 5) f = (v === 6 || u === 2 || u === 5) ? 0.82 : 0.92;
      if (face === 'back' && v <= 2 && u >= 1 && u <= 6) f = v === 2 ? 0.78 : 0.9;
      if (v === 9) f = 0.84;
      return { c: tone(topColor.c, f), amp: 0.04 };
    }
    if (top === 'jacket' || top === 'cardigan' || top === 'vest') {
      const open = face === 'front' && u >= 2 && u <= 5;
      if (!open) {
        let f = 1;
        if (face === 'front' && (u === 1 || u === 6)) f = 0.84; // 打ち合わせの影
        if (face === 'front' && (u === 2 || u === 5) && v <= 1) return tone(topColor.c, 1.15);
        if (top === 'cardigan' && face === 'front' && (u === 1) && v % 3 === 2) return tone(topColor.c, 1.3);
        if (top === 'jacket' && face === 'front' && v === 6 && (u === 0 || u === 7)) f = 0.8; // ポケット
        return { c: tone(topColor.c, f), amp: 0.035 };
      }
      if (face === 'front' && (u === 2 || u === 5) && v <= 1) return tone(topColor.c, 1.15);
    }
    // シャツ
    if (face === 'front' && neckV && v === 0 && (u === 3 || u === 4)) return tone(skin, 0.88);
    let f = 1;
    if (face === 'front' && (u === 0 || u === 7)) f *= 0.93;
    if (v === 8 && !belt) f *= 0.92;
    if (hashStr('fold' + index + face + u + ',' + v) % 100 < 6) f *= 0.9;
    return { c: tone(shirtAt(u, v, face), f), amp: 0.03 };
  };
  S.paint(P.body, BODY, (face, u, v, fw) => {
    if (face === 'top') return tone(top === 'none' || top === 'vest' ? shirt.c : topColor.c, 1);
    if (face === 'bottom') return tone(bottom === 'skirt' ? skirtColor : pants.c, 1);
    // 長い髪は背中にかかる
    if (face === 'back' && style.body && v < style.body && u >= 1 && u <= 6) {
      const ends = (u + index) % 2 === 0 ? style.body - 1 : style.body;
      if (v < ends) return { c: tone(hair, strand[u] * (v === ends - 1 ? 0.82 : 1)), amp: 0.04 };
    }
    if (face === 'back' && style.tail && (u === 3 || u === 4) && v <= 4) return { c: tone(hair, strand[u] * (v === 4 ? 0.8 : 1)), amp: 0.04 };
    return torsoColor(face, u, v, fw);
  });

  // ---------- 腕 ----------
  const sleeveColor = top === 'jacket' || top === 'hoodie' || top === 'cardigan' ? topColor.c : shirt.c;
  const longArm = top === 'jacket' || top === 'hoodie' || top === 'cardigan' ? true : longSleeve;
  const armFn = (isLeft) => (face, u, v) => {
    const inner = isLeft ? face === 'right' : face === 'left'; // 体側の面
    let f = inner ? 0.86 : 1;
    if (face === 'top') return tone(sleeveColor, 1);
    if (face === 'bottom') return tone(skin, 0.9);
    const sleeveEnd = longArm ? 9 : 3;
    if (v <= sleeveEnd) {
      if (v === sleeveEnd) f *= longArm ? 0.85 : 0.82; // そで口
      if (longArm && v === 5 && face === 'front') f *= 0.92; // ひじのしわ
      let c = sleeveColor;
      if (pattern === 'stripe' && sleeveColor === shirt.c && v % 3 === 1) c = mix(shirt.c, shirt2.c, 0.75);
      if (pattern === 'twotone' && sleeveColor === shirt.c) c = shirt2.c;
      return { c: tone(c, f), amp: 0.035 };
    }
    if (watch && isLeft && v === 9) return face === 'front' ? [230, 230, 236] : [60, 60, 70];
    if (v >= 10) f *= v === 11 ? 0.9 : 0.97; // 手
    if (!longArm && v === 4) f *= 0.9;
    return { c: tone(skin, f), amp: 0.025 };
  };
  S.paint(P.rarm, LIMB, armFn(false));
  S.paint(P.larm, LIMB, armFn(true));

  // ---------- 脚 ----------
  const legFn = (isLeft) => (face, u, v) => {
    const inner = isLeft ? face === 'right' : face === 'left';
    let f = inner ? 0.82 : 1;
    if (face === 'top') return tone(pants.c, 1);
    if (face === 'bottom') return tone(shoes, 0.45);
    const shoeTop = boots ? 8 : 10;
    if (v >= shoeTop) {
      if (v === 11) return tone(shoes, 0.55); // 靴底
      if (v === shoeTop) f *= 1.08;
      if (face === 'front' && v === 10 && u === 1) f *= 1.15;
      return { c: tone(shoes, f), amp: 0.04 };
    }
    if (apron && face === 'front' && v <= 5) return tone(apronColor, v === 5 ? 0.88 : 0.97);
    if (bottom === 'skirt') {
      if (v <= 4) return { c: tone(skirtColor, f * (v === 4 ? 0.82 : 1)), amp: 0.04 };
      if (v === shoeTop - 1) return tone([238, 238, 232], f);
      return { c: tone(skin, f * (v === 5 ? 0.86 : 1)), amp: 0.025 };
    }
    if (bottom === 'shorts') {
      if (v <= 4) return { c: tone(pants.c, f * (v === 4 ? 0.82 : 1)), amp: 0.04 };
      if (v === shoeTop - 1) return tone([238, 238, 232], f);
      return { c: tone(skin, f * (v === 5 ? 0.86 : 1)), amp: 0.025 };
    }
    if (face === 'front' && u === (isLeft ? 1 : 2) && v >= 1 && v <= 8) f *= 0.9; // 折り目
    if (v === 6 && face === 'front') f *= 1.05; // ひざ
    if (v === shoeTop - 1) f *= 0.84; // すそ
    if (face === 'front' && v === 1 && u === (isLeft ? 2 : 1) && pants.name.includes('ジーンズ')) f *= 0.8;
    return { c: tone(pants.c, f), amp: 0.05 };
  };
  S.paint(P.rleg, LIMB, legFn(false));
  S.paint(P.lleg, LIMB, legFn(true));

  return { px: S.px, traits, style: style.id };
}

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (let i = 0; i < COUNT; i++) {
  const s = makeSkin(i);
  const file = 'skin_' + String(i).padStart(3, '0') + '.png';
  writePNG(path.join(OUT, file), W, W, s.px);
  index.push({ id: i, file, traits: s.traits });
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log('スキンを ' + COUNT + ' 枚作りました: ' + OUT);
