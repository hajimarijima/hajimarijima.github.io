// 夕方の広場の誕生日パーティと島の行事（冬祭り・花火大会・収穫祭・釣り大会）の 3D。
//   sim.js が state.today.events に書いた今日の行事（js/islandevents.js）を見て、広場に飾り・ケーキ・屋台を出し、
//   夕方（PARTY_HOURS）に村人を集める。誕生日の人はまん中、周りの人はその人の方を向いて手をふったり跳ねたりする。
//   町の本体（js/town.js）からは window.TOWN の scene・people・state・world・square・hourNow・walk・solids・addSolid・reAct だけを使う。
//   town.js の updatePerson は、p.party がある人を window.TOWN.partyStep にまかせる。
//   上のカードと「島のいま」のタブに「今日は ○○ さんの誕生日」「今日は冬祭り」を出す。
//   確かめ用：window.TOWN_PARTY（state・start()・stop()）。?party=birthday,winter で見本の行事を出せる（データは変えない）
import * as THREE from 'three';
import { animate } from './character.js';
import { icon } from './icons.js';
import { esc } from './common.js';
import { onLand } from './island.js';
import { PARTY_HOURS, todayLine, eventList } from './islandevents.js';

const T = () => window.TOWN;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let a = hash(String(seed)); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ---------- ドットの質感（ふちを暗く・内がわに明るい線・つぶつぶのむら。平らに見せない） ----------
const texCache = new Map();
function pixTex(hex, style = '') {
  const key = hex + ':' + style;
  if (texCache.has(key)) return texCache.get(key);
  const N = 16, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), c = new THREE.Color(hex), R = rng(key);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let f = 1 + (R() - 0.5) * 0.16;
    if (style === 'wood') f *= (y % 4 === 0 ? 0.82 : 1) * (1 + Math.sin(x * 0.9 + y * 0.2) * 0.04);
    if (style === 'snow') f = 1 + (R() - 0.5) * 0.06 - (y > 12 ? 0.08 : 0);
    if (style === 'leaf') f *= R() < 0.18 ? 0.78 : R() < 0.1 ? 1.15 : 1;
    if (x === 0 || y === 0 || x === N - 1 || y === N - 1) f *= 0.74; // ふち
    else if (x === 1 || y === 1) f *= 1.1; // 光の当たる側
    else if (x === N - 2 || y === N - 2) f *= 0.9;
    g.fillStyle = `rgb(${Math.min(255, c.r * 255 * f) | 0},${Math.min(255, c.g * 255 * f) | 0},${Math.min(255, c.b * 255 * f) | 0})`;
    g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
const matCache = new Map();
const matOf = (hex, style = '', glow = 0) => {
  const k = hex + ':' + style + ':' + glow;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ map: pixTex(hex, style), emissive: glow ? new THREE.Color(hex) : new THREE.Color(0), emissiveIntensity: glow }));
  return matCache.get(k);
};
// 下の面が y0 の箱（ぶつかり・めり込みを考えやすいよう、床から積む）
function put(w, h, d, hex, x, y0, z, parent, { style = '', glow = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof hex === 'object' ? hex : matOf(hex, style, glow));
  m.position.set(x, y0 + h / 2, z); m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const COL = { wood: 0x9a6a3e, woodD: 0x6e4526, cream: 0xfbf1dc, pink: 0xf08aa6, red: 0xd9364a, gold: 0xf2c94c, white: 0xf8f8f4, green: 0x3f8f4a, blue: 0x3f78b8, purple: 0x8e5bb5, orange: 0xe9822e };
const FLAGS = [COL.red, COL.gold, COL.green, COL.blue, COL.pink, COL.purple];

// ---------- 部品 ----------
const glows = []; // 夜に光る物（ろうそく・ちょうちん・飾り）
const flames = []; // ゆらす火
const bobbers = []; // ゆれる風船
function makeTable(g) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(0.2, 1.3, 0.2, COL.woodD, sx * 1.35, 0, sz * 0.55, g, { style: 'wood' });
  put(3.0, 0.16, 1.4, COL.wood, 0, 1.3, 0, g, { style: 'wood' });
  put(3.12, 0.06, 1.52, COL.white, 0, 1.46, 0, g); // テーブルかけ
  for (const sz of [-1, 1]) { put(3.12, 0.5, 0.04, COL.white, 0, 0.98, sz * 0.78, g); put(3.14, 0.09, 0.05, COL.pink, 0, 0.96, sz * 0.79, g); }
  for (const sx of [-1, 1]) { put(0.04, 0.5, 1.52, COL.white, sx * 1.58, 0.98, 0, g); put(0.05, 0.09, 1.54, COL.pink, sx * 1.59, 0.96, 0, g); }
  return 1.52; // 上の面の高さ
}
function makeCake(g, y) {
  put(1.5, 0.05, 1.5, COL.white, 0, y, 0, g); // お皿
  put(1.2, 0.45, 1.2, COL.cream, 0, y + 0.05, 0, g);
  put(1.23, 0.1, 1.23, COL.pink, 0, y + 0.2, 0, g);
  put(0.86, 0.38, 0.86, COL.cream, 0, y + 0.5, 0, g);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; put(0.12, 0.14, 0.12, COL.pink, Math.cos(a) * 0.4, y + 0.74, Math.sin(a) * 0.4, g); } // たれたクリーム
  put(0.58, 0.3, 0.58, 0xf6c7d3, 0, y + 0.88, 0, g);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.4; put(0.15, 0.13, 0.15, COL.red, Math.cos(a) * 0.5, y + 0.5, Math.sin(a) * 0.5, g); } // いちご
  const cs = [[-0.16, -0.16], [0.16, -0.16], [0, 0], [-0.16, 0.16], [0.16, 0.16]];
  cs.forEach(([x, z], i) => {
    put(0.07, 0.3, 0.07, FLAGS[i % FLAGS.length], x, y + 1.18, z, g);
    const f = put(0.08, 0.13, 0.08, new THREE.MeshBasicMaterial({ color: 0xffd25a }), x, y + 1.49, z, g, { shadow: false });
    flames.push(f);
  });
}
function makeGift(g, s, hex, rib, x, y0, z, rot = 0) {
  const b = new THREE.Group(); b.position.set(x, y0, z); b.rotation.y = rot; g.add(b);
  put(s, s * 0.8, s, hex, 0, 0, 0, b);
  put(s + 0.02, s * 0.8 + 0.02, s * 0.18, rib, 0, -0.01, 0, b); put(s * 0.18, s * 0.8 + 0.02, s + 0.02, rib, 0, -0.01, 0, b);
  put(s * 0.3, s * 0.18, s * 0.12, rib, -s * 0.16, s * 0.8, 0, b).rotation.z = 0.5; put(s * 0.3, s * 0.18, s * 0.12, rib, s * 0.16, s * 0.8, 0, b).rotation.z = -0.5;
}
function makePole(g, x, z, h = 4.6) {
  put(0.18, h, 0.18, COL.woodD, x, 0, z, g, { style: 'wood' });
  put(0.32, 0.12, 0.32, COL.wood, x, h, z, g, { style: 'wood' });
  put(0.5, 0.18, 0.5, 0x8a8a82, x, 0, z, g); // 足もとの石
}
// 2 本の柱の間の旗（たるませる）。夜はちょうちんが光る
function makeBunting(g, a, b, h, seed, lantern) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), n = Math.max(3, Math.floor(L / 0.62));
  const yaw = -Math.atan2(dz, dx);
  for (let i = 0; i <= n; i++) {
    const u = i / n, sag = Math.sin(u * Math.PI) * 0.55;
    const x = a.x + dx * u, z = a.z + dz * u, y = h - sag;
    if (i < n) { const s = put(L / n + 0.02, 0.03, 0.03, 0x4a3a2a, x + dx / n / 2, y - 0.02, z + dz / n / 2, g, { shadow: false }); s.rotation.y = yaw; s.rotation.z = Math.atan2(-(Math.sin((u + 1 / n) * Math.PI) - Math.sin(u * Math.PI)) * 0.55, L / n); }
    if (i === 0 || i === n) continue;
    if (lantern && i % 3 === 0) {
      const lg = new THREE.Group(); lg.position.set(x, y - 0.6, z); g.add(lg);
      put(0.03, 0.2, 0.03, 0x4a3a2a, 0, 0.4, 0, lg, { shadow: false });
      const m = put(0.34, 0.4, 0.34, 0xf0703a, 0, 0, 0, lg, { glow: 0.2 }); glows.push(m);
      put(0.36, 0.05, 0.36, 0x3a2a1a, 0, 0.4, 0, lg); put(0.36, 0.05, 0.36, 0x3a2a1a, 0, -0.04, 0, lg);
      continue;
    }
    const col = FLAGS[(i + seed) % FLAGS.length];
    const f = new THREE.Group(); f.position.set(x, y - 0.03, z); f.rotation.y = yaw; g.add(f);
    put(0.34, 0.14, 0.03, col, 0, -0.14, 0, f, { shadow: false }); put(0.22, 0.12, 0.03, col, 0, -0.26, 0, f, { shadow: false }); put(0.1, 0.1, 0.03, col, 0, -0.36, 0, f, { shadow: false });
  }
}
function makeBalloons(g, x, z, top, seed) {
  const R = rng('bal' + seed);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Group(); const bx = x + (R() - 0.5) * 0.7, bz = z + (R() - 0.5) * 0.7, by = top + 0.8 + R() * 0.7;
    b.position.set(bx, by, bz); g.add(b);
    const col = FLAGS[(seed + i) % FLAGS.length];
    put(0.5, 0.6, 0.5, col, 0, 0, 0, b); put(0.36, 0.1, 0.36, col, 0, 0.6, 0, b); put(0.1, 0.1, 0.1, col, 0, -0.1, 0, b);
    put(0.025, by - top + 0.1, 0.025, 0xdddddd, 0, -(by - top), 0, b, { shadow: false });
    bobbers.push({ o: b, y: by, ph: R() * 6 });
  }
}
// 文字の入った横断幕（表だけに字。裏は無地）
function makeBanner(g, text, w, y0, z) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  const c = cv.getContext('2d');
  c.fillStyle = '#fbf1dc'; c.fillRect(0, 0, 512, 96);
  c.fillStyle = '#d9364a'; c.fillRect(0, 0, 512, 10); c.fillRect(0, 86, 512, 10);
  for (let x = 0; x < 512; x += 32) { c.fillStyle = x % 64 ? '#f2c94c' : '#3f78b8'; c.fillRect(x + 8, 14, 16, 6); c.fillRect(x + 8, 76, 16, 6); }
  let fs = 50; c.font = `bold ${fs}px "Hiragino Maru Gothic ProN","Yu Gothic",sans-serif`;
  while (c.measureText(text).width > 470 && fs > 20) { fs -= 2; c.font = `bold ${fs}px "Hiragino Maru Gothic ProN","Yu Gothic",sans-serif`; }
  c.fillStyle = '#8a2a44'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const plain = matOf(0xfbf1dc);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, w * 96 / 512, 0.06), [plain, plain, plain, plain, new THREE.MeshLambertMaterial({ map: t }), plain]);
  m.position.set(0, y0 + (w * 96 / 512) / 2, z); m.castShadow = true; g.add(m);
  return m;
}
// 屋台（台・柱・しまのひさし・売り物）。前が +z
function makeStall(g, kind, col) {
  const s = new THREE.Group(); g.add(s);
  put(2.6, 1.1, 1.0, COL.wood, 0, 0, 0, s, { style: 'wood' });
  put(2.64, 0.5, 0.04, col, 0, 0.45, 0.52, s); put(2.66, 0.08, 0.06, COL.white, 0, 0.42, 0.53, s);
  put(2.7, 0.08, 1.1, COL.woodD, 0, 1.1, 0, s, { style: 'wood' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(0.14, 2.9, 0.14, COL.woodD, sx * 1.25, 0, sz * 0.45, s, { style: 'wood' });
  for (let i = 0; i < 6; i++) { const st = put(0.47, 0.08, 1.5, i % 2 ? COL.white : col, -1.18 + i * 0.47, 2.9, 0.1, s); st.rotation.x = 0.22; }
  for (let i = 0; i < 6; i++) put(0.47, 0.24, 0.05, i % 2 ? COL.white : col, -1.18 + i * 0.47, 2.66, 0.84, s, { shadow: false });
  const lan = put(0.3, 0.36, 0.3, 0xf0703a, 0.9, 2.24, 0.62, s, { glow: 0.2 }); glows.push(lan);
  put(0.03, 0.06, 0.03, 0x3a2a1a, 0.9, 2.6, 0.62, s);
  const y = 1.18;
  if (kind === 'winter') { put(0.6, 0.45, 0.6, 0x4a4a52, -0.6, y, 0, s); put(0.64, 0.06, 0.64, 0x2e2e34, -0.6, y + 0.45, 0, s); put(0.5, 0.05, 0.5, 0xc98a3a, -0.6, y + 0.4, 0, s); for (let i = 0; i < 3; i++) put(0.2, 0.24, 0.2, [COL.red, COL.blue, COL.green][i], 0.2 + i * 0.32, y, 0.1, s); }
  else if (kind === 'harvest') { for (let i = 0; i < 3; i++) { put(0.5, 0.38, 0.5, COL.orange, -0.8 + i * 0.6, y, 0, s); put(0.08, 0.14, 0.08, COL.green, -0.8 + i * 0.6, y + 0.38, 0, s); } for (let i = 0; i < 4; i++) put(0.16, 0.16, 0.16, COL.red, 0.6 + (i % 2) * 0.2, y + (i > 1 ? 0.16 : 0), (i % 2) * 0.18, s); }
  else if (kind === 'fishing') { put(1.8, 0.12, 0.7, 0xbfe3f0, 0, y, 0, s, { style: 'snow' }); for (let i = 0; i < 3; i++) { put(0.5, 0.14, 0.2, [0x7c93a8, 0xd97a5a, 0x8aa0b4][i], -0.6 + i * 0.6, y + 0.12, 0, s); put(0.12, 0.18, 0.16, [0x5d7387, 0xb85e43, 0x6d8398][i], -0.32 + i * 0.6, y + 0.1, 0, s); } }
  else { for (let i = 0; i < 4; i++) { put(0.04, 0.6, 0.04, COL.woodD, -0.9 + i * 0.6, y, 0, s); const w = put(0.3, 0.3, 0.04, FLAGS[i], -0.9 + i * 0.6, y + 0.6, 0, s); w.rotation.z = Math.PI / 4; flames.push(w); } }
  return s;
}
// まん中の飾り：冬祭りのもみの木と雪だるま
function makeWinter(g) {
  put(0.5, 0.8, 0.5, COL.woodD, 0, 0, 0, g, { style: 'wood' });
  const tiers = [3.0, 2.5, 2.0, 1.5, 1.0, 0.55];
  tiers.forEach((s, i) => {
    const y = 0.8 + i * 0.7;
    put(s, 0.72, s, i % 2 ? 0x2f7a3e : 0x276b36, 0, y, 0, g, { style: 'leaf' });
    put(s * 0.82, 0.1, s * 0.82, COL.white, 0, y + 0.72, 0, g, { style: 'snow' });
    if (s > 0.8) for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + i; const o = put(0.18, 0.18, 0.18, [COL.red, COL.gold, COL.blue, 0xf8f8f4][(k + i) % 4], Math.cos(a) * s / 2, y + 0.24, Math.sin(a) * s / 2, g, { glow: 0.15 }); glows.push(o); }
  });
  const sy = 0.8 + tiers.length * 0.7 + 0.1;
  const st = put(0.5, 0.5, 0.12, COL.gold, 0, sy, 0, g, { glow: 0.5 }); st.rotation.z = Math.PI / 4; glows.push(st);
  // 雪だるま（右前）
  const sm = new THREE.Group(); sm.position.set(2.6, 0, 0.9); sm.rotation.y = -0.5; g.add(sm);
  put(1.1, 1.0, 1.1, COL.white, 0, 0, 0, sm, { style: 'snow' }); put(0.8, 0.75, 0.8, COL.white, 0, 1.0, 0, sm, { style: 'snow' }); put(0.56, 0.52, 0.56, COL.white, 0, 1.75, 0, sm, { style: 'snow' });
  put(0.84, 0.14, 0.84, COL.red, 0, 1.7, 0, sm); put(0.2, 0.5, 0.1, COL.red, 0.25, 1.25, 0.42, sm);
  for (const ex of [-0.12, 0.12]) put(0.08, 0.08, 0.04, 0x1c1c1c, ex, 2.0, 0.28, sm);
  put(0.08, 0.08, 0.28, COL.orange, 0, 1.9, 0.38, sm);
  for (const sx of [-1, 1]) put(0.5, 0.06, 0.06, COL.woodD, sx * 0.62, 1.4, 0, sm).rotation.z = sx * 0.5;
  put(0.46, 0.08, 0.46, 0x2a2a2a, 0, 2.27, 0, sm); put(0.32, 0.3, 0.32, 0x2a2a2a, 0, 2.35, 0, sm);
  for (const [x, z, w] of [[-2.4, -1.2, 1.4], [1.2, -2.6, 1.1], [-1.6, 2.4, 1.0]]) put(w, 0.06, w * 0.7, COL.white, x, 0, z, g, { style: 'snow', shadow: false }); // 地面の雪
  return [{ x: 0, z: 0, r: 1.8 }, { x: 2.6, z: 0.9, r: 0.8 }];
}
function makeHarvest(g) {
  const R = rng('harv');
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, r = i % 3 ? 1.0 : 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r, y = i % 3 ? 0 : 0.62; const s = 0.6 + R() * 0.2; put(s, s * 0.75, s, COL.orange, x, y, z, g); put(s * 0.2, s * 0.75 + 0.01, s + 0.01, 0xc96a20, x, y, z, g); put(0.08, 0.16, 0.08, COL.green, x, y + s * 0.75, z, g); }
  for (const [x, z] of [[-1.9, -0.6], [1.9, -0.4]]) { for (let k = 0; k < 9; k++) put(0.1, 1.6, 0.1, 0xe6c35a, x + ((k % 3) - 1) * 0.13, 0, z + (Math.floor(k / 3) - 1) * 0.13, g); put(0.46, 0.12, 0.46, 0xb08a3a, x, 0.7, z, g); put(0.6, 0.4, 0.6, 0xf0d472, x, 1.5, z, g, { style: 'leaf' }); }
  const cr = new THREE.Group(); cr.position.set(0.4, 0, 1.8); g.add(cr);
  put(1.0, 0.5, 0.7, COL.wood, 0, 0, 0, cr, { style: 'wood' }); for (let k = 0; k < 6; k++) put(0.18, 0.18, 0.18, COL.red, -0.3 + (k % 3) * 0.3, 0.5, (k > 2 ? 0.15 : -0.15), cr);
  return [{ x: 0, z: 0, r: 1.5 }, { x: -1.9, z: -0.6, r: 0.5 }, { x: 1.9, z: -0.4, r: 0.5 }, { x: 0.4, z: 1.8, r: 0.65 }];
}
// 釣り大会：表彰台と大きな魚の看板。優勝した人は台の上に立つ（立つ高さを返す）
function makeFishing(g) {
  put(1.3, 0.9, 1.3, COL.gold, 0, 0, 0, g, { style: 'wood' }); put(1.3, 0.6, 1.3, 0xc9ccd2, -1.32, 0, 0, g, { style: 'wood' }); put(1.3, 0.4, 1.3, 0xc58a52, 1.32, 0, 0, g, { style: 'wood' });
  for (const [x, h, n] of [[0, 0.9, 1], [-1.32, 0.6, 2], [1.32, 0.4, 3]]) for (let k = 0; k < n; k++) put(0.12, 0.3, 0.02, 0x3a2a1a, x - (n - 1) * 0.1 + k * 0.2, h * 0.3, 0.66, g, { shadow: false });
  const b = new THREE.Group(); b.position.set(0, 0, -1.8); g.add(b);
  for (const sx of [-1, 1]) put(0.16, 3.4, 0.16, COL.woodD, sx * 1.3, 0, 0, b, { style: 'wood' });
  put(3.0, 1.4, 0.12, COL.wood, 0, 1.9, 0, b, { style: 'wood' });
  const f = [[-0.9, 0.4, 0.5], [-0.4, 0.7, 0.6], [0.2, 0.8, 0.62], [0.7, 0.6, 0.55]];
  for (const [x, w, h] of f) put(w, h, 0.08, 0x4f86b0, x, 2.6 - h / 2, 0.08, b);
  put(0.4, 0.6, 0.08, 0x3d6f94, 1.15, 2.3, 0.08, b); put(0.1, 0.1, 0.04, 0xf8f8f4, -0.9, 2.62, 0.13, b);
  return { solids: [{ x: 0, z: 0, r: 0.95 }, { x: -1.32, z: 0, r: 0.95 }, { x: 1.32, z: 0, r: 0.95 }, { x: -1.3, z: -1.8, r: 0.3 }, { x: 1.3, z: -1.8, r: 0.3 }], top: 0.9 };
}
// 花火：打ち上げの箱と、夜空にひらく光の粒
const bursts = [];
function makeFireworksRack(g) {
  put(1.6, 0.6, 1.0, COL.wood, 0, 0, 0, g, { style: 'wood' });
  for (let i = 0; i < 4; i++) put(0.26, 0.8, 0.26, [COL.red, COL.blue, COL.gold, COL.green][i], -0.54 + i * 0.36, 0.6, 0, g);
  return [{ x: 0, z: 0, r: 1.0 }];
}
// 色は 2 色を組にする（外の輪と内の輪）。赤・金・緑・青・桃・白
const FW_COLS = [0xff3b4e, 0xffcf3a, 0x3fe07a, 0x4a8cff, 0xff6ad5, 0xfff4e0];
const LOOK_UP = -0.5; // 空を見上げる時の頭の傾き
const TRAIL = 3; // 1 つの光の粒に、うしろへ伸びる尾を 2 つ（丸く広がる線に見える）
function burstAt(parent, x, y, z, seed) {
  const R = rng(seed), big = 110, small = 50, n = (big + small) * TRAIL;
  const geo = new THREE.BoxGeometry(0.75, 0.75, 0.75), m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const im = new THREE.InstancedMesh(geo, m, n); im.frustumCulled = false;
  const cA = new THREE.Color(FW_COLS[Math.floor(R() * FW_COLS.length)]);
  let cB = new THREE.Color(FW_COLS[Math.floor(R() * FW_COLS.length)]); if (cB.equals(cA)) cB = new THREE.Color(0xffcf3a);
  const dirs = [];
  for (let i = 0; i < big + small; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u), inner = i >= big;
    dirs.push({ v: new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a)), k: inner ? 0.5 : 0.92 + R() * 0.12 });
    for (let t = 0; t < TRAIL; t++) im.setColorAt(i * TRAIL + t, (inner ? cB : cA).clone().multiplyScalar(1 - t * 0.3));
  }
  im.instanceColor.needsUpdate = true;
  parent.add(im);
  bursts.push({ im, dirs, at: { x, y, z }, t: 0, life: 2.8, col: cA });
}

// ---------- 置き場所：広場のまわりで、ぶつかる物から十分はなれた所 ----------
function findSpot(need) {
  const { solids, square, world } = T();
  const land = (x, z) => !(world.islands && world.islands.length) || onLand(world, x, z, 1.5);
  let best = null;
  for (let r = 0; r <= 16; r += 1) for (let k = 0; k < Math.max(1, r * 6); k++) {
    const a = (k / Math.max(1, r * 6)) * Math.PI * 2, x = square.x + Math.cos(a) * r, z = square.z + Math.sin(a) * r;
    if (!land(x, z)) continue;
    let clear = Infinity;
    for (const o of solids) { const d = Math.hypot(o.x - x, o.z - z) - o.r - pad(o); if (d < clear) clear = d; if (clear < need) break; }
    let ok = true; for (let j = 0; j < 12 && ok; j++) { const b = (j / 12) * Math.PI * 2; ok = land(x + Math.cos(b) * need * 0.8, z + Math.sin(b) * need * 0.8); }
    if (clear >= need && ok) return { x, z, clear };
    if (!best || clear > best.clear) best = { x, z, clear };
  }
  return best;
}
// 木は幹のまわりに葉が広がる（人の頭・柱・旗が葉にささらないよう、幹の円より広くよける）
const pad = (o) => (o.tree ? 2.4 * (o.tree.size || 1) : 0);
const freeAt = (x, z, r, extra = []) => T().solids.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + pad(o) + r) && extra.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r);

// ---------- 今日の行事 ----------
function todayEvents(state) {
  const q = new URLSearchParams(location.search).get('party'); // 確かめ用の見本（データは変えない）
  if (q) {
    const ids = q.split(',');
    const out = [];
    const ppl = T().people || [];
    // 誕生日の人は、島のデータの今日の誕生日の人（名札と同じ元）。いなければ見本として先頭の人
    const real = ((state && state.today && state.today.birthdays) || []).filter((k) => ppl.some((p) => p.v.key === k));
    const pool = [...real, ...ppl.map((p) => p.v.key).filter((k) => !real.includes(k))];
    if (ids.includes('birthday') && ppl.length) out.push({ id: 'birthday', name: '誕生日パーティ', who: pool.slice(0, ids.includes('two') ? Math.max(2, real.length) : Math.max(1, real.length)) });
    for (const e of eventList(T().config)) if (ids.includes(e.id)) out.push({ id: e.id, name: e.name, day: 1, ...(e.id === 'fishing' && ppl[2] ? { winner: ppl[2].v.key } : {}) });
    return out;
  }
  return ((state && state.today && state.today.events) || []).filter((e) => e && e.id);
}

// ---------- 上のカードと島のいまに「今日は…」 ----------
function showNotes(events) {
  const V = T().villagers || [];
  const nameOf = (k) => (V.find((v) => v.key === k) || {}).display || k;
  const html = events.map((ev) => `<li class="${ev.id === 'birthday' ? 'bd' : ''}">${icon(ev.id === 'birthday' ? 'cake' : ev.id === 'fishing' ? 'fish' : 'gift', { size: 15 })}<span>${esc(todayLine(ev, nameOf))}</span></li>`).join('');
  const put1 = (id, after, cls) => {
    let el = document.getElementById(id);
    if (!html) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('ul'); el.id = id; el.className = cls; el.setAttribute('aria-label', '今日の行事'); after && after.after(el); }
    el.innerHTML = html;
  };
  put1('evtop', document.querySelector('.topcard .tc-head'), 'evline');
  put1('evnow', document.getElementById('dayline'), 'evline tab-now-ev');
}

// ---------- 3D の場面と、村人を集める ----------
const P = { mine: new Set(), on: false, events: [], group: null, spots: [], stars: [], who: new Map(), started: false, center: null };
function build(events) {
  const TW = T();
  const bd = events.find((e) => e.id === 'birthday'), fest = events.find((e) => e.id !== 'birthday');
  const fishWin = fest && fest.id === 'fishing' && fest.winner;
  // 誕生日：1 列目・2 列目・旗の柱。行事：木や飾りを囲む輪・屋台・旗の柱（屋台の外）。置けない所はとばす
  const R1 = 5.6, R2 = 8.6, RT = 7.6, RS = 13.4, RP = bd ? 11.4 : 17.0;
  const spot = findSpot(bd ? 4.0 : 4.4); // まん中（ケーキ・横断幕・飾り）が空いている、広場にいちばん近い所
  if (!spot) return;
  const C = { x: spot.x, z: spot.z };
  P.center = C;
  const g = new THREE.Group(); g.position.set(C.x, 0, C.z); g.name = 'party'; TW.scene.add(g); P.group = g;
  const extra = []; // 置いた物（ほかの飾りがそこに重ならないように）
  const addS = (x, z, r) => { extra.push({ x: C.x + x, z: C.z + z, r }); TW.addSolid(C.x + x, C.z + z, r); P.mine.add(TW.solids[TW.solids.length - 1]); };
  // まん中
  P.stars = [];
  if (bd) {
    const n = bd.who.length;
    // 1 列に 3 人まで。4 人目からはうしろの列に、前の人の間から見えるようにずらして立つ
    bd.who.forEach((k, i) => { const row = Math.floor(i / 3), inRow = Math.min(3, n - row * 3), j = i % 3; P.stars.push({ key: k, x: (j - (inRow - 1) / 2) * 2.7 + (row % 2) * 1.35, z: -row * 1.25, yaw: 0, y: 0 }); });
    const tg = new THREE.Group(); tg.position.set(0, 0, 2.15); g.add(tg);
    const top = makeTable(tg); makeCake(tg, top);
    makeGift(tg, 0.45, COL.blue, COL.gold, -1.05, top, 0.1, 0.3); makeGift(tg, 0.38, COL.green, COL.red, 1.1, top, -0.05, -0.4);
    for (const sx of [-0.8, 0.8]) addS(sx, 2.15, 0.95);
    makeGift(g, 0.6, COL.purple, COL.white, -2.4, 0, 1.6, 0.5); makeGift(g, 0.52, COL.red, COL.gold, 2.4, 0, 1.7, -0.3); addS(-2.4, 1.6, 0.5); addS(2.4, 1.7, 0.45);
    // うしろの横断幕
    const bw = Math.max(4.6, Math.min(3, n) * 2.7 + 1.4 + (n > 3 ? 1.35 : 0));
    const bz = -2.3 - (Math.ceil(n / 3) - 1) * 1.25; // うしろの列の人より、さらにうしろ
    for (const sx of [-1, 1]) { makePole(g, sx * bw / 2, bz, 4.6); addS(sx * bw / 2, bz, 0.3); makeBalloons(g, sx * bw / 2, bz, 4.6, sx > 0 ? 2 : 0); }
    makeBanner(g, n > 1 ? 'みんな おたんじょうび おめでとう' : 'おたんじょうび おめでとう', bw - 0.3, 3.3, bz);
  } else if (fest) {
    const ss = fest.id === 'winter' ? makeWinter(g) : fest.id === 'harvest' ? makeHarvest(g) : fest.id === 'fireworks' ? makeFireworksRack(g) : null;
    if (ss) for (const s of ss) addS(s.x, s.z, s.r);
    if (fest.id === 'fishing') { const f = makeFishing(g); for (const s of f.solids) addS(s.x, s.z, s.r); if (fishWin) P.stars.push({ key: fishWin, x: 0, z: 0, yaw: 0, y: f.top }); }
  }
  if (bd && fest) { // 誕生日と行事が同じ日：行事の飾りは右うしろに小さく
    const sx = 7.0, sz = -5.0;
    if (freeAt(C.x + sx, C.z + sz, 2.2, extra)) { const fg = new THREE.Group(); fg.position.set(sx, 0, sz); fg.scale.setScalar(0.7); g.add(fg); const ss = fest.id === 'winter' ? makeWinter(fg) : fest.id === 'harvest' ? makeHarvest(fg) : fest.id === 'fireworks' ? makeFireworksRack(fg) : makeFishing(fg).solids; for (const s of ss || []) addS(sx + s.x * 0.7, sz + s.z * 0.7, s.r * 0.7); }
  }
  // 屋台（行事の日）：まん中の飾りを囲む輪の外。まん中を向く。ぶつかる物がある所には置かない
  const stalls = [];
  if (fest) {
    const cols = { winter: COL.blue, harvest: COL.orange, fishing: 0x2e9a8a, fireworks: COL.red };
    const RSx = bd ? 11.6 : RS;
    for (const a of (bd ? [Math.PI * 0.8, Math.PI * 0.2] : [Math.PI * 0.75, Math.PI * 0.25, Math.PI * 1.25, Math.PI * 1.75, Math.PI * 1.5, Math.PI * 0.5])) {
      const x = Math.cos(a) * RSx, z = -Math.sin(a) * RSx;
      if (!freeAt(C.x + x, C.z + z, 1.9, extra)) continue;
      if (stalls.length >= (bd ? 2 : 4)) break;
      const s = makeStall(g, fest.id, cols[fest.id] || COL.red);
      s.position.set(x, 0, z); s.rotation.y = Math.atan2(-x, -z);
      addS(x + Math.cos(s.rotation.y) * 0.65, z - Math.sin(s.rotation.y) * 0.65, 0.85); addS(x - Math.cos(s.rotation.y) * 0.65, z + Math.sin(s.rotation.y) * 0.65, 0.85);
      stalls.push({ x, z });
    }
  }
  // 旗の柱の輪（置けた柱どうしを旗でつなぐ）
  const poles = [];
  const NP = 10;
  for (let i = 0; i < NP; i++) {
    const a = (i / NP) * Math.PI * 2 + 0.31, x = Math.cos(a) * RP, z = Math.sin(a) * RP;
    if (!freeAt(C.x + x, C.z + z, 0.5, extra)) { poles.push(null); continue; }
    makePole(g, x, z); addS(x, z, 0.3); poles.push({ x, z });
    if (bd && i % 3 === 0) makeBalloons(g, x, z, 4.6, i);
  }
  for (let i = 0; i < NP; i++) { const a = poles[i], b = poles[(i + 1) % NP]; if (a && b && freeAt(C.x + (a.x + b.x) / 2, C.z + (a.z + b.z) / 2, 0.2)) makeBunting(g, a, b, 4.5, i, fest && fest.id !== 'fishing'); } // 旗のひもが建物や木にささらない所だけ
  // 集まる場所：まん中の人（いなければ飾り）の方を向く。1 列目と 2 列目。誕生日はうしろ（横断幕の裏）を空ける
  P.spots = [];
  const face = (x, z) => {
    if (!P.stars.length) return Math.atan2(-x, -z);
    let s = P.stars[0], dm = Infinity;
    for (const t of P.stars) { const d = Math.hypot(t.x - x, t.z - z); if (d < dm) { dm = d; s = t; } }
    return Math.atan2(s.x - x, s.z - z);
  };
  // となりの人とは 3.3 以上あける（人のはば 2.0・手をふる腕の分と、名札が重ならない分）
  const GAP = 3.3;
  const tryAdd = (x, z, yaw, kind) => {
    if (!freeAt(C.x + x, C.z + z, 1.1)) return;
    if (P.spots.some((s) => Math.hypot(s.x - x, s.z - z) < GAP - 0.3)) return;
    P.spots.push({ x, z, yaw, kind });
  };
  if (bd) {
    // 誕生日：まん中の人を半円より広い弧で囲む。2 列目は 1 列目の間に立つ（前の人の頭の間から見える）
    const ARC = Math.PI * 1.5;
    for (const R of [R1, R2]) {
      const n = Math.floor((ARC * R) / GAP) + 1, off = R === R2 ? 0.5 : 0;
      for (let i = 0; i < n; i++) {
        const th = -ARC / 2 + ((i + off) / (n - (off ? 0 : 1))) * ARC;
        const x = Math.sin(th) * R, z = Math.cos(th) * R;
        if (z > 0 && Math.abs(x) < z * 0.62 + 1.2) continue; // ケーキの正面（手前の扇の形）は空けて、手前からまん中の人とケーキが見えるようにする
        tryAdd(x, z, face(x, z), 'ring');
      }
    }
  } else {
    // 行事：屋台の前に 2 人ずつ（屋台を見る）→ まん中の飾りを囲む輪（飾りから 7.6 はなれ、間を 3.6 あける）
    for (const s of stalls) {
      const L = Math.hypot(s.x, s.z), ux = -s.x / L, uz = -s.z / L; // 屋台からまん中へ
      for (const side of [-1, 1]) {
        const x = s.x + ux * 2.5 + uz * side * 1.6, z = s.z + uz * 2.5 - ux * side * 1.6;
        tryAdd(x, z, Math.atan2(s.x - x, s.z - z), 'stall');
      }
    }
    const n = Math.floor((Math.PI * 2 * RT) / 3.6);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + 0.2;
      const x = Math.sin(th) * RT, z = Math.cos(th) * RT;
      tryAdd(x, z, face(x, z), 'ring');
    }
  }
}
function clearScene() {
  if (P.group) { T().scene.remove(P.group); P.group = null; }
  glows.length = 0; flames.length = 0; bobbers.length = 0;
  for (const b of bursts) b.im.parent && b.im.parent.remove(b.im);
  bursts.length = 0;
}

function gather(instant) {
  const TW = T(), C = P.center;
  if (!C) return;
  const ppl = TW.people || [];
  const byKey = new Map(ppl.map((p) => [p.v.key, p]));
  const toWorld = (s) => ({ x: C.x + s.x, z: C.z + s.z });
  const join = (p, s, role) => {
    TW.walk.endChat && TW.walk.endChat(p);
    if (p.talk) { p.talk.on = false; p.talk = null; } if (p.bubble) p.bubble.hidden = true;
    const w = toWorld(s);
    p.party = { role, kind: s.kind || '', fest: !P.events.some((e) => e.id === 'birthday'), spot: w, yaw: s.yaw, y: s.y || 0, route: instant ? [] : TW.walk.safeRoute({ ...p.pos }, w), ri: 0, arrived: !!instant, seed: (hash(p.v.key) % 1000) / 1000 };
    if (instant) { p.pos = { ...w }; p.ch.rotation.y = s.yaw; }
    p.mode = 'party';
    P.who.set(p.v.key, p);
  };
  for (const s of P.stars) { const p = byKey.get(s.key); if (p) join(p, { ...s }, 'star'); }
  const cand = ppl.filter((p) => !P.who.has(p.v.key) && !p.photo && (p.mode === 'day' || p.mode === 'party') && Math.hypot(p.pos.x - C.x, p.pos.z - C.z) < 70)
    .sort((a, b) => Math.hypot(a.pos.x - C.x, a.pos.z - C.z) - Math.hypot(b.pos.x - C.x, b.pos.z - C.z));
  P.spots.forEach((s, i) => { if (cand[i]) join(cand[i], s, 'guest'); });
}
function release() {
  for (const p of P.who.values()) { p.party = null; if (p.mode === 'party') p.mode = 'day'; T().reAct(p); }
  P.who.clear();
}

// 1 人分の 1 コマ（town.js の updatePerson から）。true を返すと、町の本体はこの人を動かさない
function partyStep(p, dt, time) {
  const q = p.party, W = T().walk;
  if (!q) return false;
  p.mode = 'party'; p.ch.visible = true; p.ch.userData.lieY = 0; p.ch.userData.nod = 0;
  W.setTool(p.ch, null); W.setCarry(p.ch, null);
  let pose = 'idle', phase = null, hop = 0, cheer = false;
  if (!q.arrived) {
    const ri = p.ri; p.ri = q.ri;
    const done = !q.route.length || W.walkTo(p, q.route, dt);
    q.ri = p.ri; p.ri = ri;
    if (done || Math.hypot(p.pos.x - q.spot.x, p.pos.z - q.spot.z) < 0.15) { q.arrived = true; p.pos = { ...q.spot }; }
    else { pose = 'walk'; W.keepApart(p); }
  }
  let y = 0;
  if (q.arrived && P.fwView) { // 花火の夜：花火の開く向きを向いて、空を見上げる。ときどき指さす・手をふる
    const dir = new THREE.Vector3(); T().camera.getWorldDirection(dir);
    W.turnTo(p.ch, Math.atan2(dir.x, dir.z), dt);
    const k = Math.floor(time / 5 + q.seed * 7) % 4;
    p.ch.position.set(p.pos.x, q.y, p.pos.z);
    if (p.lod === 'full') {
      animate(p.ch, k === 3 ? 'wave' : 'idle', time + q.seed * 10, k === 3 ? (time * 0.3 + q.seed) % 1 : null);
      const Pt = p.ch.userData.parts; if (Pt && Pt.head) Pt.head.rotation.x = LOOK_UP;
    }
    return true;
  }
  if (q.arrived) {
    W.turnTo(p.ch, q.yaw, dt);
    // 4 秒ごとに、手をふる・ばんざいして跳ねる・手をたたく（人ごとにずらす）
    const k = Math.floor(time / 4 + q.seed * 7) % 3, u = ((time / 4 + q.seed * 7) % 1);
    if (q.role === 'star') { pose = 'wave'; phase = (time * 0.35 + q.seed) % 1; if (k === 1) { hop = Math.max(0, Math.sin(time * 5.2)) * 0.25; } }
    else if (q.kind === 'stall') { pose = k === 2 ? 'wave' : k === 1 ? 'idle' : 'talk'; phase = u; } // 屋台を見て、店の人と話す
    else if (q.fest) { pose = k === 1 ? 'idle' : k === 0 ? 'talk' : 'wave'; phase = u; } // 飾りを囲んで見上げる・話す・手をふる
    else if (k === 0) { pose = 'wave'; phase = u; }
    else if (k === 1) { pose = 'wave'; phase = 0.5; cheer = true; hop = Math.max(0, Math.sin((time + q.seed) * 8.4)) * 0.5; }
    else { pose = 'talk'; }
    y = q.y + hop;
  }
  p.ch.position.set(p.pos.x, y, p.pos.z);
  if (p.lod === 'full') {
    animate(p.ch, pose, time + q.seed * 10, phase);
    const Pt = p.ch.userData.parts;
    if (Pt && cheer) { // ばんざい：左手も右手と同じだけ上げる（向きは左右反対）
      Pt.larm.position.y = Pt.rarm.position.y; Pt.larm.rotation.set(Pt.rarm.rotation.x, 0, -Pt.rarm.rotation.z);
      if (hop > 0.05) { Pt.rleg.rotation.x = -0.25; Pt.lleg.rotation.x = -0.25; }
    }
  }
  return true;
}

// 飾りのうごき（火・風船・花火）と、夕方の始まり・終わり
let last = performance.now(), fwT = 0, fwN = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!P.events.length || !P.group) return;
  hideFarTags();
  const h = T().hourNow(), t = now / 1000;
  const fw = P.events.some((e) => e.id === 'fireworks');
  const bdOn = P.events.some((e) => e.id !== 'fireworks');
  const h0 = bdOn ? PARTY_HOURS[0] : 18.3, h1 = fw ? 21 : PARTY_HOURS[1]; // 花火の日は、暗くなって花火が終わるまで広場にいる
  const inParty = h >= h0 && h < h1;
  if (inParty && !P.on) { P.on = true; setTimeout(aimCamera, P.started ? 0 : 1500); gather(h > h0 + 0.25 || !P.started); P.started = true; }
  else if (!inParty && P.on) { P.on = false; release(); }
  P.started = true;
  const dark = h >= 17.5 || h < 6;
  for (const m of glows) m.material.emissiveIntensity = dark ? 0.9 : 0.12;
  for (const f of flames) f.scale.y = 0.8 + Math.sin(t * 13 + f.id) * 0.25;
  for (const b of bobbers) { b.o.position.y = b.y + Math.sin(t * 1.3 + b.ph) * 0.12; b.o.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.06; }
  // 花火：18 時半〜21 時。カメラを低くして空を見上げ、木より高い空に 0.7 秒に 1 つ開く
  const fwNight = fw && h >= 18.5 && h < 21 && P.on;
  if (fwNight && !P.fwView) { P.fwView = true; aimFireworks(); }
  else if (!fwNight && P.fwView) { P.fwView = false; endFireworksView(); }
  if (fwNight) {
    fwT += dt;
    if (fwT > (innerWidth < 600 ? 1.1 : 0.7)) { // 見ている向きの遠くの空（木の上）に開く。どの向きから見ても空に入る
      fwT = 0; const R = rng('fw' + fwN++), cam = T().camera, cp = cam.position, dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const L = Math.hypot(dir.x, dir.z) || 1, ux = dir.x / L, uz = dir.z / L;
      const D = 52 + R() * 20, side = (R() - 0.5) * D * (innerWidth < 600 ? 0.22 : 0.7);
      const el = Math.max(0.2, Math.min(1.1, Math.asin(Math.max(-1, Math.min(1, dir.y))) + 0.12 + (R() - 0.5) * 0.1));
      const H = Math.max(28, cp.y + D * Math.tan(el)); // 木（高さ 12 ほど）より十分高い
      burstAt(T().scene, cp.x + ux * D - uz * side, H, cp.z + uz * D + ux * side, 'b' + fwN);
    }
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  let flash = 0, fcol = null, fat = null;
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.t += dt;
    const k = b.t / b.life, grow = 1 - Math.pow(1 - Math.min(1, k * 2.2), 3), r = 12 * grow, fall = k * k * 7; // 丸く広がって、だんだん落ちる
    b.im.material.opacity = Math.max(0, 1 - Math.pow(k, 1.6));
    for (let j = 0; j < b.dirs.length; j++) {
      const d = b.dirs[j];
      for (let t = 0; t < TRAIL; t++) {
        const rr = r * d.k * (1 - t * 0.07 * grow), ft = fall * (1 - t * 0.12);
        V.set(b.at.x + d.v.x * rr, b.at.y + d.v.y * rr - ft, b.at.z + d.v.z * rr); S.setScalar((1 - k * 0.55) * (1 - t * 0.28)); M.compose(V, Q, S); b.im.setMatrixAt(j * TRAIL + t, M);
      }
    }
    b.im.instanceMatrix.needsUpdate = true;
    const f = Math.max(0, 1 - k * 2.2); if (f > flash) { flash = f; fcol = b.col; fat = b.at; }
    if (b.t > b.life) { b.im.parent.remove(b.im); b.im.geometry.dispose(); b.im.material.dispose(); bursts.splice(i, 1); }
  }
  // 開いた時、広場と村人がその色でほんのり明るくなる
  if (fwLight) { fwLight.intensity = flash * 2.2; if (fcol) { fwLight.color.copy(fcol); const C = P.center; fwLight.position.set((fat.x + C.x) / 2, 30, (fat.z + C.z) / 2); } }
}
// 花火の夜のカメラ：広場の外から、村人の頭より少し高い所で、空を見上げる（画面の上半分が空）
let fwLight = null;
function aimFireworks() {
  const TW = T(), C = P.center;
  if (!C || !TW.lookAt) return;
  if (!fwLight) { fwLight = new THREE.PointLight(0xffffff, 0, 140, 0); TW.scene.add(fwLight); }
  if (camTouched) return;
  const trees = TW.solids.filter((o) => o.tree), blds = TW.solids.filter((o) => !o.tree && o.r >= 0.6 && !P.mine.has(o));
  const narrow = innerWidth < 600, pol = 1.62, CH = 7; // 家の屋根より高い 9 から、水平より 5 度ほど上を見る（下に広場の村人、上半分に空）
  let best = 0, bs = Infinity, R0 = 16; const cands = [];
  for (const Rt of [12, 16, 20, 24]) for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2, cx = C.x + Math.sin(a) * Rt, cz = C.z + Math.cos(a) * Rt;
    // カメラのそばの木・家（大きく写って空をふさぐ）と、見る向きの先 25 までの木
    let s = 0;
    for (const o of trees) { const d = Math.hypot(o.x - cx, o.z - cz); if (d < 12 * (o.tree.size || 1)) s += (12 * (o.tree.size || 1) - d) * 1.5; } // 頭の上・すぐ横の木の葉
    const ux = (C.x - cx) / Rt, uz = (C.z - cz) / Rt;
    for (const o of blds) { const tx = o.x - cx, tz = o.z - cz, al = tx * ux + tz * uz, lat = Math.abs(tx * uz - tz * ux), d = Math.hypot(tx, tz); if (d < o.r + 5) s += (o.r + 5 - d) * 3; else if (al > 0 && al < Rt + 2 && lat < al * 0.45 + o.r + 1) s += 4 + o.r; } // 村人との間の家・柵
    for (const o of trees) { const tx = o.x - cx, tz = o.z - cz, al = tx * ux + tz * uz, lat = Math.abs(tx * uz - tz * ux); if (al > 0 && al < 30 && lat < al * 0.5 + 3) s += 1.5; }
    s += Rt * 0.15; // 近い方が村人がよく見える
    cands.push({ s, a, Rt, cx, cz });
  }
  // 数で見た良い所から順に、カメラの所から空と広場へ光の線を飛ばして、ふさぐ物（町の外の森の木など）を数える
  cands.sort((p, q) => p.s - q.s);
  const ray = new THREE.Raycaster(); ray.far = 45; ray.camera = TW.camera;
  const hitList = TW.scene.children.filter((o) => o !== P.group && o.visible && !o.isLight && !(o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry' && o.scale.x > 100));
  const from = new THREE.Vector3(), dir = new THREE.Vector3();
  for (const c of cands.slice(0, 120)) {
    from.set(c.cx, CH, c.cz);
    const base = Math.atan2(C.x - c.cx, C.z - c.cz), spread = [-0.7, -0.35, 0, 0.35, 0.7]; // 縦長の画面でも同じ所をえらぶ
    let hits = 0;
    for (const da of spread) for (const el of [0.08, 0.3, 0.5]) {
      dir.set(Math.sin(base + da) * Math.cos(el), Math.sin(el), Math.cos(base + da) * Math.cos(el));
      ray.set(from, dir); if (ray.intersectObjects(hitList, true).length) hits += el > 0.2 ? 2 : 1;
    }
    // 広場の村人が見えるか（家や柵にさえぎられないか）
    for (const sp of P.spots.slice(0, 12)) { dir.set(C.x + sp.x - c.cx, 2.5 - CH, C.z + sp.z - c.cz); const L = dir.length(); if (L < 4) continue; dir.normalize(); ray.far = L - 1.5; ray.set(from, dir); if (ray.intersectObjects(hitList.filter((o) => !o.userData || !o.userData.isPerson), true).length) hits += 1.5; } ray.far = 45;
    c.score = c.s * 0.3 + hits * 4;
    if (c.score < bs) { bs = c.score; best = c.a; R0 = c.Rt; }
  }
  TW.controls.maxPolarAngle = 1.8;
  const dist = R0 / Math.sin(pol), ty = CH - Math.cos(pol) * dist;
  TW.camY = ty;
  TW.lookAt(C.x, C.z, dist, best, pol, ty);
  P.cam = { az: +best.toFixed(2), score: +bs.toFixed(1), fw: true };
}
function endFireworksView() {
  const TW = T();
  TW.camY = 0; if (TW.controls) TW.controls.maxPolarAngle = 1.3;
  if (fwLight) fwLight.intensity = 0;
}

// 名札の「誕生日」の印を、今日の誕生日パーティの人だけにそろえる（上のカードと同じ元）
function syncLabels() {
  const bd = P.events.find((e) => e.id === 'birthday'), who = new Set((bd && bd.who) || []);
  for (const p of T().people || []) {
    const L = p.label; if (!L) continue;
    const has = L.classList.contains('bday');
    if (who.has(p.v.key) && !has) { L.classList.add('bday'); L.textContent = '誕生日 ' + L.textContent; }
    else if (!who.has(p.v.key) && has) { L.classList.remove('bday'); L.textContent = L.textContent.replace(/^誕生日 /, ''); }
  }
}
// パーティの間、名札が重なる時は遠い方を消す（町の本体が札をずらしたあとの位置で調べる）
let tagF = 0, hidTags = [];
function hideFarTags() {
  if (!P.on) { hidTags = []; return; }
  if (tagF++ & 3) { for (const L of hidTags) L.style.opacity = '0'; return; } // 町の本体は毎コマ札を出し直すので、消した札は毎コマ消す
  for (const L of hidTags) L.style.opacity = '';
  hidTags = [];
  const cam = T().camera; if (!cam) return;
  const tags = [];
  for (const p of T().people || []) {
    const L = p.label; if (!L || L.style.opacity === '0' || L.style.display === 'none' || !p.ch.visible) continue;
    const r = L.getBoundingClientRect(); if (!r.width) continue;
    tags.push({ L, r, d: cam.position.distanceTo(p.ch.position), star: L.classList.contains('bday') });
  }
  tags.sort((a, b) => (b.star - a.star) || (a.d - b.d)); // 誕生日の人の札がいちばん先
  const kept = [];
  for (const t of tags) {
    const hit = kept.some((k) => t.r.left < k.right + 3 && t.r.right > k.left - 3 && t.r.top < k.bottom + 2 && t.r.bottom > k.top - 2);
    if (hit) { t.L.style.opacity = '0'; hidTags.push(t.L); } else kept.push(t.r);
  }
}
// 行事の時だけ、カメラを行事の場所へ寄せる。木の葉がかからない向きをえらぶ（さわった後は動かさない）
let camTouched = false;
function aimCamera() {
  const TW = T(), C = P.center;
  if (!C || camTouched || !TW.lookAt || P.fwView) return;
  const trees = TW.solids.filter((o) => o.tree), blds = TW.solids.filter((o) => !o.tree && o.r >= 1.5 && Math.hypot(o.x - C.x, o.z - C.z) > 12); // 家などの大きな物も、見る線の上はさける
  const fw = P.events.length === 1 && P.events[0].id === 'fireworks'; // 花火だけの日は、空が入るよう低く見上げる
  const narrow = innerWidth < 600, dist = (narrow ? 34 : 22) + (fw ? 22 : 0), pol = fw ? 1.05 : P.events.some((e) => e.id === 'birthday') ? 0.62 : 0.8, r = Math.sin(pol) * dist;
  const segD = (px, pz, bx, bz) => { const dx = bx - C.x, dz = bz - C.z, L = dx * dx + dz * dz; const u = Math.max(0.3, Math.min(1.15, ((px - C.x) * dx + (pz - C.z) * dz) / L)); return Math.hypot(px - C.x - dx * u, pz - C.z - dz * u); };
  // カメラと行事の場所の間で、画面の左右に入る木（葉が大きく写って絵をふさぐ）
  const side = (o, cx, cz) => { const dx = C.x - cx, dz = C.z - cz, L = Math.hypot(dx, dz), tx = o.x - cx, tz = o.z - cz; const along = (tx * dx + tz * dz) / L, lat = Math.abs(tx * dz - tz * dx) / L; if (along < -3 || along > L * 0.8) return 0; return lat < Math.max(0, along) * 0.95 + 3.6 * (o.tree.size || 1) ? 4 + (L - along) * 0.3 : 0; };
  let best = 0, bs = Infinity;
  const front = P.events.some((e) => e.id === 'birthday') ? 0.8 : 0.15; // 誕生日は正面から外れすぎない
  for (let k = 0; k < (front > 0.5 ? 15 : 63); k++) { // 誕生日は正面から ±0.7 まで（横断幕とケーキが前を向いて見える）
    const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.1; // 正面（誕生日の人の前）から左右に少しずつ
    const cx = C.x + Math.sin(a) * r, cz = C.z + Math.cos(a) * r;
    const s = trees.reduce((n, o) => n + Math.max(0, 6.5 * (o.tree.size || 1) - segD(o.x, o.z, cx, cz)) + side(o, cx, cz), 0) + blds.reduce((n, o) => n + Math.max(0, o.r + 2.5 - segD(o.x, o.z, cx, cz)) * 2, 0) + Math.abs(a) * front; // 見る線の上と、カメラの両わきの木の葉
    if (s < bs) { bs = s; best = a; }
  }
  TW.lookAt(C.x, C.z, dist, best, pol, 0);
  P.cam = { az: +best.toFixed(2), score: +bs.toFixed(1) };
}
function start() {
  const TW = T();
  P.events = todayEvents(TW.state);
  showNotes(P.events);
  syncLabels(); setTimeout(syncLabels, 1500);
  if (!P.events.length) return;
  build(P.events);
  TW.partyStep = partyStep;
  if (TW.controls) TW.controls.addEventListener('start', () => { camTouched = true; });
  requestAnimationFrame(tick);
}
function stop() { if (P.fwView) { P.fwView = false; endFireworksView(); } release(); clearScene(); P.events = []; showNotes([]); }
window.TOWN_PARTY = { state: P, start, stop, bursts };

// 町ができるのを待つ
(function wait(n = 0) {
  const TW = T();
  if (TW && TW.walk && TW.people && TW.state && TW.solids) { start(); return; }
  if (n < 600) setTimeout(() => wait(n + 1), 100);
})();
