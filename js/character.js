// マイクラのような四角い体を、64x64 のスキン画像から作る
import * as THREE from 'three';
import { toolPixels } from './toolart.js';

const PX = 1 / 16;
const loader = new THREE.TextureLoader();
const texCache = {};
export function skinTexture(url) {
  if (!texCache[url]) {
    const t = loader.load(url);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
    texCache[url] = t;
  }
  return texCache[url];
}
// 2 頭身の顔：目を 2 マスの高さにして、1 マス下げる（まゆ→目→目→口。ほおの段をぬく）。帽子の層のめがねも同じだけ下げる
const chibiTexCache = {};
function chibiTexture(url) {
  if (chibiTexCache[url]) return chibiTexCache[url];
  if (typeof document === 'undefined') return skinTexture(url);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0);
    // 顔の正面は (8,8)〜(15,15)、帽子の層の正面は (40,8)〜(47,15)。v は顔の中の行
    for (const ox of [8, 40]) {
      const row = (v) => g.getImageData(ox, 8 + v, 8, 1);
      const r4 = row(4), r6 = row(6), r7 = row(7);
      g.clearRect(ox, 8 + 5, 8, 3);
      g.putImageData(r4, ox, 8 + 5); // 目をもう 1 段（大きく・下に）
      g.putImageData(r6, ox, 8 + 6); g.putImageData(r7, ox, 8 + 7);
    }
    t.needsUpdate = true;
  };
  img.src = url;
  return (chibiTexCache[url] = t);
}
// その村人を 2 頭身で描くか（村人ごとの体型 body: "chibi"。?chibi=1 なら全員を 2 頭身で試せる）
const CHIBI_ALL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('chibi') === '1';
export const chibiOf = (v) => CHIBI_ALL || !!(v && v.body === 'chibi');

// 箱の面ごとにスキンの場所を割り当てる（three の面の順: +x, -x, +y, -y, +z, -z）
function boxGeo(ox, oy, w, h, d, grow = 0) {
  const g = new THREE.BoxGeometry((w + grow) * PX, (h + grow) * PX, (d + grow) * PX);
  const rects = [
    [ox + d + w, oy + d, d, h], // +x = 左側（キャラの左）
    [ox, oy + d, d, h],         // -x = 右側
    [ox + d, oy, w, d],         // 上
    [ox + d + w, oy, w, d],     // 下
    [ox + d, oy + d, w, h],     // 正面
    [ox + 2 * d + w, oy + d, w, h], // 背中
  ];
  const uv = g.attributes.uv;
  rects.forEach(([x, y, rw, rh], f) => {
    const u0 = x / 64, u1 = (x + rw) / 64, v0 = 1 - y / 64, v1 = 1 - (y + rh) / 64;
    if (f === 3) { // 下の面は上下を返す
      uv.setXY(f * 4, u0, v1); uv.setXY(f * 4 + 1, u1, v1); uv.setXY(f * 4 + 2, u0, v0); uv.setXY(f * 4 + 3, u1, v0);
    } else {
      uv.setXY(f * 4, u0, v0); uv.setXY(f * 4 + 1, u1, v0); uv.setXY(f * 4 + 2, u0, v1); uv.setXY(f * 4 + 3, u1, v1);
    }
  });
  uv.needsUpdate = true;
  return g;
}

let GEO = null;
let charCount = 0;
function geos() {
  if (GEO) return GEO;
  GEO = {
    head: boxGeo(0, 0, 8, 8, 8), hat: boxGeo(32, 0, 8, 8, 8, 1), hatS: boxGeo(32, 0, 8, 8, 8, 0.4), // hatS：2 頭身用（頭が大きいので、帽子のはみ出し＝つばを短く）
    body: boxGeo(16, 16, 8, 12, 4), jacket: boxGeo(16, 32, 8, 12, 4, 0.5),
    rarm: boxGeo(40, 16, 4, 12, 4), rsleeve: boxGeo(40, 32, 4, 12, 4, 0.5),
    larm: boxGeo(32, 48, 4, 12, 4), lsleeve: boxGeo(48, 48, 4, 12, 4, 0.5),
    rleg: boxGeo(0, 16, 4, 12, 4), rpants: boxGeo(0, 32, 4, 12, 4, 0.5),
    lleg: boxGeo(16, 48, 4, 12, 4), lpants: boxGeo(0, 48, 4, 12, 4, 0.5),
    // 細い腕（3px）のスキン
    rarmS: boxGeo(40, 16, 3, 12, 4), rsleeveS: boxGeo(40, 32, 3, 12, 4, 0.5),
    larmS: boxGeo(32, 48, 3, 12, 4), lsleeveS: boxGeo(48, 48, 3, 12, 4, 0.5),
  };
  return GEO;
}

const toolMats = {
  wood: new THREE.MeshLambertMaterial({ color: 0x6a4424 }), // 柄（木の頭より暗い）
  iron: new THREE.MeshLambertMaterial({ color: 0xb8bec6 }),
  basket: new THREE.MeshLambertMaterial({ color: 0xc89a55 }),
  berry: new THREE.MeshLambertMaterial({ color: 0xc0303a }),
  log: new THREE.MeshLambertMaterial({ color: 0x9b6b3d }),
  ironDark: new THREE.MeshLambertMaterial({ color: 0x5c636b }),
  ironTip: new THREE.MeshLambertMaterial({ color: 0xe8edf2 }),
  cloth: new THREE.MeshLambertMaterial({ color: 0x6b5236 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff9a2a }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
  stone: new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }),
};
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
// 素材ごとの色（中・暗・明）。木の頭は柄より明るい板の色。石はごつごつ、鉄は明るい銀、金、ダイヤ
export const TOOL_MAT = {
  wood: [0xc8955a, 0x8d5f2c, 0xe6bb80], stone: [0x55585b, 0x2e3032, 0x77797c], iron: [0xe4e8ec, 0x9aa2ab, 0xffffff],
  gold: [0xf0bd28, 0xb47a0a, 0xffe46a], diamond: [0x3fd8d2, 0x1aa3a6, 0xb0f8f0],
};
const matCache = {};
const tm = (c) => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));
// 頭の飾り：木は木目のすじ、石はこぶ、金属は刃の縁の光る線
function finish(g, mat, M, w, h, d, x, y, z) {
  if (mat === 'wood') { for (const k of [-0.3, 0.25]) g.add(box(w + 0.006, h * 0.12, d * 0.8, tm(M[1]), x, y + h * k, z)); }
  else if (mat === 'stone') { g.add(box(w * 0.7 + 0.02, h * 0.3, d * 0.25, tm(M[1]), x, y + h * 0.3, z - d * 0.2)); g.add(box(w + 0.02, h * 0.25, d * 0.2, tm(M[2]), x, y - h * 0.2, z + d * 0.15)); }
}
// 道具の 16×16 の絵（js/toolart.js、アイコンと同じ）を厚み 1 マスで押し出した形（マイクラのアイテムと同じ作り方）。
// 見えない面（となりにマスがある面）は作らない。形と色は種類と素材ごとに 1 つだけ作って使い回す
const SPRITE_KIND = { axe: 'axe', pick: 'pickaxe', pickaxe: 'pickaxe', hoe: 'hoe', shovel: 'shovel', sword: 'sword' };
const spriteGeoCache = {};
const spriteMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function spriteGeo(kind, mat) {
  const key = kind + ':' + mat;
  if (spriteGeoCache[key]) return spriteGeoCache[key];
  const px = toolPixels(kind, mat), N = 16;
  const on = (x, y) => x >= 0 && y >= 0 && x < N && y < N && px[(y * N + x) * 4 + 3] > 0;
  const pos = [], nor = [], col = [];
  // 絵の x → -z、絵の上 → +y、厚みは x。1 マス = 1
  const quad = (pts, n, c) => { for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...pts[i]); nor.push(...n); col.push(...c); } };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!on(x, y)) continue;
    const i = (y * N + x) * 4, c = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255].map((v) => Math.pow(v, 2.2));
    const z0 = -x, z1 = -x - 1, y0 = -y - 1, y1 = -y, a = -0.5, b = 0.5;
    const cs = c.map((v) => v * 0.8); // 側面は少し暗く
    quad([[b, y0, z0], [b, y0, z1], [b, y1, z1], [b, y1, z0]], [1, 0, 0], c);
    quad([[a, y0, z1], [a, y0, z0], [a, y1, z0], [a, y1, z1]], [-1, 0, 0], c);
    if (!on(x, y - 1)) quad([[a, y1, z0], [b, y1, z0], [b, y1, z1], [a, y1, z1]], [0, 1, 0], cs);
    if (!on(x, y + 1)) quad([[a, y0, z1], [b, y0, z1], [b, y0, z0], [a, y0, z0]], [0, -1, 0], cs);
    if (!on(x - 1, y)) quad([[a, y0, z0], [b, y0, z0], [b, y1, z0], [a, y1, z0]], [0, 0, 1], cs);
    if (!on(x + 1, y)) quad([[b, y0, z1], [a, y0, z1], [a, y1, z1], [b, y1, z1]], [0, 0, -1], cs);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // 握る所（絵の (3.5, 11.5) あたり）を原点に
  g.translate(0, 11.5, 3.5);
  return (spriteGeoCache[key] = g);
}
function makeSpriteTool(kind, mat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(spriteGeo(kind, mat), spriteMat); m.castShadow = true;
  const inner = new THREE.Group(); inner.add(m);
  inner.rotation.x = Math.PI / 4; // 絵の斜めの柄を、手の向き（+y）にそろえる。頭の刃は +z 側
  const k = 0.052; inner.scale.setScalar(k);
  g.add(inner);
  g.userData.base = 1; g.userData.sprite = true;
  return g;
}
function makeTool(kind0) {
  const [kind1, mat1] = String(kind0).split(':');
  if (SPRITE_KIND[kind1]) return makeSpriteTool(SPRITE_KIND[kind1], TOOL_MAT[mat1] ? mat1 : 'iron');
  const g = new THREE.Group();
  const [kind, mat0] = String(kind0).split(':');
  const mat = TOOL_MAT[mat0] ? mat0 : 'iron', M = TOOL_MAT[mat];
  const head = tm(M[0]), dark = tm(M[1]), light = tm(M[2]);
  const metal = mat !== 'wood' && mat !== 'stone';
  if (kind === 'axe') {
    g.add(box(0.06, 0.62, 0.06, toolMats.wood, 0, 0.2, 0));
    g.add(box(0.08, 0.1, 0.1, dark, 0, 0.44, 0)); // 柄をはめる所
    const bw = mat === 'wood' ? 0.07 : mat === 'diamond' ? 0.04 : 0.05;
    g.add(box(bw, 0.18, 0.2, head, 0, 0.44, 0.12));
    g.add(box(bw + 0.01, 0.22, 0.04, metal ? light : dark, 0, 0.44, 0.23)); // 刃の縁
    g.add(box(0.06, 0.07, 0.07, dark, 0, 0.44, -0.07)); // 背
    finish(g, mat, M, bw, 0.18, 0.2, 0, 0.44, 0.12);
  } else if (kind === 'pick') {
    // 柄の先に、両側へ下向きに曲がってとがる頭（横から見ても「つるはし」と分かる太さ）
    g.add(box(0.07, 0.66, 0.07, toolMats.wood, 0, 0.21, 0));
    g.add(box(0.12, 0.13, 0.16, dark, 0, 0.53, 0)); // 柄をはめる所
    const th = mat === 'wood' ? 1.2 : mat === 'diamond' ? 0.8 : 1;
    for (const s of [1, -1]) {
      const arm = new THREE.Group(); arm.position.set(0, 0.54, s * 0.07); arm.rotation.x = s * 0.32; g.add(arm);
      arm.add(box(0.09 * th, 0.1 * th, 0.2, head, 0, 0, s * 0.1));
      const tip = box(0.07 * th, 0.07 * th, 0.14, head, 0, -0.01, s * 0.26); tip.rotation.x = s * 0.25; arm.add(tip);
      arm.add(box(0.045, 0.045, 0.06, light, 0, -0.03, s * 0.35));
      if (metal) arm.add(box(0.095 * th, 0.02, 0.2, light, 0, 0.05 * th, s * 0.1)); // 上の縁の光
      if (mat === 'wood') arm.add(box(0.095 * th, 0.015, 0.16, dark, 0, 0.0, s * 0.1)); // 木目
      if (mat === 'stone') arm.add(box(0.1, 0.05, 0.05, dark, 0, 0.03, s * 0.18)); // こぶ
    }
  } else if (kind === 'hoe') {
    g.add(box(0.06, 0.7, 0.06, toolMats.wood, 0, 0.24, 0));
    g.add(box(0.07, 0.07, 0.2, head, 0, 0.58, 0.08));
    g.add(box(0.06, 0.16, 0.06, head, 0, 0.52, 0.17)); // 下へ下がる刃
    g.add(box(0.065, 0.03, 0.065, metal ? light : dark, 0, 0.44, 0.17));
    finish(g, mat, M, 0.07, 0.07, 0.2, 0, 0.58, 0.08);
  } else if (kind === 'shovel') {
    g.add(box(0.06, 0.7, 0.06, toolMats.wood, 0, 0.24, 0));
    g.add(box(0.2, 0.24, 0.04, head, 0, 0.66, 0.01));
    g.add(box(0.22, 0.03, 0.045, metal ? light : dark, 0, 0.78, 0.01));
  } else if (kind === 'rod') {
    // 釣りざお：握り・リール・細くなるさお。先（userData.tip）から糸をたらす
    g.add(box(0.08, 0.22, 0.08, toolMats.cloth, 0, 0.0, 0));
    g.add(box(0.1, 0.1, 0.06, dark, 0.06, 0.08, 0)); // リール
    g.add(box(0.05, 0.6, 0.05, head, 0, 0.4, 0));
    g.add(box(0.035, 0.6, 0.035, head, 0, 0.98, 0));
    for (const y of [0.55, 0.95, 1.22]) g.add(box(0.055, 0.025, 0.055, light, 0, y, 0)); // 糸を通す輪
    const tip = new THREE.Object3D(); tip.position.set(0, 1.28, 0); g.add(tip); g.userData.tip = tip;
  } else if (kind === 'torch') {
    g.add(box(0.07, 0.6, 0.07, toolMats.wood, 0, 0.2, 0));
    g.add(box(0.11, 0.1, 0.11, toolMats.cloth, 0, 0.5, 0));
    const f = box(0.14, 0.2, 0.14, toolMats.flame, 0, 0.64, 0); f.castShadow = false; g.add(f);
    const f2 = box(0.08, 0.12, 0.08, toolMats.flameCore, 0, 0.78, 0); f2.castShadow = false; g.add(f2);
    g.userData.flame = [f, f2];
  } else if (kind === 'basket') {
    g.add(box(0.28, 0.18, 0.22, toolMats.basket, 0, -0.05, 0.12));
    g.add(box(0.08, 0.06, 0.08, toolMats.berry, 0.05, 0.06, 0.1));
  }
  // 手に持つ道具は少し大きめにして、遠くからでも形が分かるようにする
  g.userData.base = ['axe', 'pick', 'hoe', 'shovel', 'sword'].includes(kind) ? 1.35 : 1;
  g.scale.setScalar(g.userData.base);
  return g;
}
function makeCarry(kind) {
  if (kind === 'wood') { const g = new THREE.Group(); g.add(box(0.5, 0.14, 0.14, toolMats.log, 0, 0, 0)); g.add(box(0.5, 0.14, 0.14, toolMats.log, 0, 0.14, 0.02)); return g; }
  if (kind === 'stone') return box(0.3, 0.24, 0.26, toolMats.stone);
  return makeTool('basket');
}

// キャラクターを作る。返す group の userData.parts でアニメさせる
// slim：細い腕（3px）のスキン（女性の見た目など）
// chibi：2 頭身のデフォルメ（見本。頭 1.7 倍、体と手足は短く太く。頭と体はおよそ 1:1）。スキンの絵はそのまま使う
export const CHIBI = { head: 1.7, torso: [1.1, 0.55, 1.1], arm: [1.2, 0.55, 1.2], leg: [1.2, 0.5, 1.2] };
export function makeCharacter(url, { scale = 1, oneHand = null, slim = false, chibi = false } = {}) {
  const G = geos();
  const tex = chibi ? chibiTexture(url) : skinTexture(url);
  const base = new THREE.MeshLambertMaterial({ map: tex });
  const over = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const body = new THREE.Group(); // 全体（しゃがむ時に下げる）
  root.add(body);
  const mk = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };

  const head = new THREE.Group(); head.position.y = 24 * PX;
  const h1 = mk(G.head, base); h1.position.y = 4 * PX; head.add(h1);
  const h2 = mk(chibi ? G.hatS : G.hat, over); h2.position.y = 4 * PX; head.add(h2);

  const torso = new THREE.Group(); torso.position.y = 18 * PX;
  torso.add(mk(G.body, base)); torso.add(mk(G.jacket, over));

  const limb = (g1, g2, x, y) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const a = mk(g1, base); a.position.y = -6 * PX; p.add(a);
    const b = mk(g2, over); b.position.y = -6 * PX; p.add(b);
    return p;
  };
  const ax = slim ? 5.5 : 6;
  // 基準の高さ（px）：脚の付け根・胴のまん中・肩（＝頭の下）。2 頭身は脚 6・胴 6.6・頭 13.6
  const C = chibi ? CHIBI : null;
  const hip = C ? 12 * C.leg[1] : 12, top = C ? hip + 12 * C.torso[1] : 24;
  const bp = { head: top * PX, torso: (hip + top) / 2 * PX, arm: top * PX };
  const armX = C ? (4 * C.torso[0] + 2 * (slim ? 1.5 / 2 : 1) * C.arm[0] + 0.2) : ax, legX = C ? 2 * C.leg[0] : 2;
  const rarm = limb(slim ? G.rarmS : G.rarm, slim ? G.rsleeveS : G.rsleeve, -armX * PX, bp.arm); // キャラの右手は -x
  const larm = limb(slim ? G.larmS : G.larm, slim ? G.lsleeveS : G.lsleeve, armX * PX, bp.arm);
  const rleg = limb(G.rleg, G.rpants, -legX * PX, hip * PX);
  const lleg = limb(G.lleg, G.lpants, legX * PX, hip * PX);
  body.add(head, torso, rarm, larm, rleg, lleg);
  head.position.y = bp.head; torso.position.y = bp.torso;
  if (C) {
    head.scale.setScalar(C.head); torso.scale.set(...C.torso);
    for (const a of [rarm, larm]) a.scale.set(...C.arm);
    for (const l of [rleg, lleg]) l.scale.set(...C.leg);
  }

  const hand = new THREE.Group(); hand.position.set(0, -11 * PX, 0.5 * PX); rarm.add(hand);
  // 2 頭身は腕を縮めているので、手の中の道具がゆがまないように逆に戻す（道具は少しだけ小さく）
  if (C) hand.scale.set(0.72 / C.arm[0], 0.72 / C.arm[1], 0.72 / C.arm[2]);
  const front = new THREE.Group(); front.position.set(0, (C ? hip + 5 : 17) * PX, (C ? 5 : 4.5) * PX); body.add(front);
  root.scale.setScalar(scale);
  root.userData.seed = (charCount++ * 0.6180339) % 1;
  // 片手で振る人と両手で振る人がいる（oneHand で指定もできる）
  root.userData.oneHand = oneHand ?? root.userData.seed < 0.4;
  root.userData.balance = root.userData.seed < 0.2 ? 'out' : 'down';
  root.userData.base = bp; root.userData.chibi = !!chibi;
  root.userData.parts = { torso, body, head, rarm, larm, rleg, lleg, hand, front, tool: null, toolKind: null, carry: null, carryKind: null };
  return root;
}

export function setTool(ch, kind) {
  const P = ch.userData.parts;
  if (P.toolKind === kind) return;
  if (P.tool) P.hand.remove(P.tool);
  P.tool = kind ? makeTool(kind) : null; P.toolKind = kind;
  if (P.tool) { P.tool.rotation.x = Math.PI / 2; P.hand.add(P.tool); }
}
// 好きな色を服の差し色に（スカーフと帯）
export function setAccent(ch, color) {
  const P = ch.userData.parts;
  if (P.accent) { P.torso.remove(P.accent); P.accent = null; }
  if (!color) return;
  const m = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  const scarf = box(8.8 * PX, 1.6 * PX, 4.8 * PX, m, 0, 5.4 * PX, 0); g.add(scarf);
  const tail = box(1.6 * PX, 3 * PX, 0.8 * PX, m, 2 * PX, 3.4 * PX, 2.6 * PX); g.add(tail);
  const belt = box(8.7 * PX, 1.2 * PX, 4.7 * PX, m, 0, -5.2 * PX, 0); g.add(belt);
  P.torso.add(g); P.accent = g;
}
export function setCarry(ch, kind) {
  const P = ch.userData.parts;
  if (P.carryKind === kind) return;
  if (P.carry) P.front.remove(P.carry);
  P.carry = kind ? makeCarry(kind) : null; P.carryKind = kind;
  if (P.carry) P.front.add(P.carry);
}

// 見張りの盾（木の板に鉄のふち）。左腕に付け、矢が来たら前に上げる
const shieldMats = { wood: new THREE.MeshLambertMaterial({ color: 0x8a5a32 }), wood2: new THREE.MeshLambertMaterial({ color: 0x744a28 }), rim: new THREE.MeshLambertMaterial({ color: 0x6a7078 }), boss: new THREE.MeshLambertMaterial({ color: 0xb8bec4 }) };
export function setShield(ch, on) {
  const P = ch.userData.parts;
  if (!!P.shield === on) return;
  if (P.shield) { P.larm.remove(P.shield); P.shield = null; return; }
  const g = new THREE.Group(); g.position.set(0.5 * PX, -9 * PX, 0);
  // 腕の向き（-y）が前を向いた時に、板が前を向くように：厚みは y
  for (let i = 0; i < 3; i++) g.add(box(0.14, 0.05, 0.5, i % 2 ? shieldMats.wood2 : shieldMats.wood, -0.14 + i * 0.14, 0, 0));
  g.add(box(0.46, 0.06, 0.05, shieldMats.rim, 0, 0, 0.24)); g.add(box(0.46, 0.06, 0.05, shieldMats.rim, 0, 0, -0.24));
  g.add(box(0.1, 0.08, 0.1, shieldMats.boss, 0, -0.04, 0));
  P.larm.add(g); P.shield = g;
}

// 打った時に飛ぶかけら（石・木くず）
const chipMats = { stone: new THREE.MeshLambertMaterial({ color: 0x8d9298 }), wood: new THREE.MeshLambertMaterial({ color: 0xc89a5e }) };
const chipGeo = new THREE.BoxGeometry(1.4 * PX, 1.4 * PX, 1.4 * PX);
function chips(P, kind, p, hx, hy, hz) {
  if (!P.chips) {
    P.chips = new THREE.Group();
    for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(chipGeo, chipMats.stone); m.castShadow = false; P.chips.add(m); }
    P.body.parent.add(P.chips);
  }
  P.chips.visible = p >= 0 && p < 1;
  if (!P.chips.visible) return;
  P.chips.children.forEach((m, i) => {
    m.material = chipMats[kind];
    const a = (i / 5) * Math.PI * 1.6 - 0.8 + kind.length; // 横へ広がる向き
    const sp = 0.55 + (i % 3) * 0.2;
    m.position.set(hx + Math.sin(a) * sp * p * 0.6, hy + (0.9 + (i % 2) * 0.4) * p - 2.2 * p * p, hz - Math.cos(a) * sp * p * 0.25 - 0.15 * p);
    m.rotation.set(p * 7 + i, p * 5, 0);
    m.scale.setScalar(1 - p * 0.5);
  });
}

// 両手で道具を持つための腕の向き（手が体の真ん中に寄る）
const GRIP = 0.42;

// 釣りの周期（7 秒）：待つ → うきが沈む → さおを上げて釣り上げる。うきと体の動きをそろえるため、時刻だけで決める
export function fishCycle(t) {
  const c = ((t % 7) + 7) % 7 / 7;
  const sink = c > 0.6 && c < 0.72 ? Math.sin((c - 0.6) / 0.12 * Math.PI) : 0;
  const reel = c >= 0.7 && c < 0.88 ? Math.sin((c - 0.7) / 0.18 * Math.PI) : 0;
  return { c, sink, reel, caught: c >= 0.74 && c < 0.95 };
}
// pose: 'idle' | 'talk' | 'walk' | 'chop' | 'dig' | 'gather' | 'carry' | 'fish'
export function animate(ch, pose, t) {
  const P = ch.userData.parts;
  const seed = ch.userData.seed || 0;
  P.body.position.y = 0; P.body.rotation.set(0, 0, 0);
  P.head.rotation.set(0, 0, 0);
  const B0 = ch.userData.base || { head: 24 * PX, torso: 18 * PX, arm: 24 * PX };
  P.head.position.y = B0.head; P.torso.position.y = B0.torso;
  P.rarm.position.y = B0.arm; P.larm.position.y = B0.arm;
  for (const k of ['rarm', 'larm', 'rleg', 'lleg']) P[k].rotation.set(0, 0, 0);
  if (P.chips) P.chips.visible = false;
  if (P.tool) P.tool.rotation.x = Math.PI / 2;
  // 呼吸：上半身だけが小さく上下する（人ごとに周期をずらす）
  const breathe = (amp) => {
    const b = Math.sin((t / (3.2 + seed * 1.6) + seed) * Math.PI * 2) * amp * PX;
    P.head.position.y += b; P.torso.position.y += b * 0.6; P.rarm.position.y += b; P.larm.position.y += b;
  };
  if (pose === 'walk' || pose === 'carry') {
    // 1 秒に 2 歩くらい（人の歩く速さ）。歩幅は SPEED（town.js）と合う大きさ
    const s = Math.sin(t * 6.2) * 0.5;
    P.rleg.rotation.x = s; P.lleg.rotation.x = -s;
    if (pose === 'carry') { P.rarm.rotation.x = -1.2; P.larm.rotation.x = -1.2; P.rarm.rotation.z = 0.12; P.larm.rotation.z = -0.12; }
    else { P.rarm.rotation.x = -s * 0.9; P.larm.rotation.x = s * 0.9; }
    P.body.position.y = Math.abs(Math.cos(t * 6.2)) * 0.03;
  } else if (pose === 'dig' || pose === 'chop') {
    // 振りかぶる → 振り下ろす → 当たって小さく止まる → もどす
    const dig = pose === 'dig';
    const c = (t * (dig ? 1.3 : 1.6)) % 1;
    const H0 = dig ? 0.45 : 0.5, H1 = dig ? 0.65 : 0.75, H2 = dig ? 0.76 : 0.85; // 振り下ろし開始・当たる・止まり終わり
    const up = dig ? -3.0 : -2.5, hit = dig ? -0.85 : -1.45, rest = dig ? -0.9 : -1.1;
    let a, lean, twist = 0, recoil = 0;
    if (c < H0) { const k = c / H0; const e = k * k * (3 - 2 * k); a = rest + (up - rest) * e; lean = -0.1 * e; twist = (dig ? 0 : 0.35) * e; }
    else if (c < H1) { const k = (c - H0) / (H1 - H0); const e = k * k; a = up + (hit - up) * e; lean = -0.1 + (dig ? 0.42 : 0.3) * e; twist = (dig ? 0 : 0.35) - (dig ? 0 : 0.45) * e; }
    else if (c < H2) { const k = (c - H1) / (H2 - H1); recoil = Math.sin(k * Math.PI) * 0.12; a = hit - recoil; lean = dig ? 0.32 : 0.2; twist = dig ? 0 : -0.1; }
    else { const k = (c - H2) / (1 - H2); const e = k * k * (3 - 2 * k); a = hit + (rest - hit) * e; lean = (dig ? 0.32 : 0.2) * (1 - e); twist = (dig ? 0 : -0.1) * (1 - e); }
    // 手首を返す量：振り下ろしで前へ返し、当たったところで止める
    const k1 = c < H0 ? -0.45 * (c / H0) : c < H1 ? -0.45 + 0.85 * ((c - H0) / (H1 - H0)) : c < H2 ? 0.4 : 0.4 * (1 - (c - H2) / (1 - H2));
    if (ch.userData.oneHand) {
      // 片手：利き手で振り、手首を返す。もう片方はバランスを取る（前に出す）か、体の横に下ろす
      P.rarm.rotation.set(a, 0, 0.1);
      if (P.tool) P.tool.rotation.x = Math.PI / 2 + k1;
      if (ch.userData.balance === 'out') { const q = c < H1 ? Math.min(1, c / H0) : 1 - (c - H1) / (1 - H1); P.larm.rotation.set(-0.9 * q + 0.2, 0, -0.35 - 0.25 * q); }
      else P.larm.rotation.set(0.15 + lean * 0.3, 0, -0.08);
      P.body.rotation.y = twist + (dig ? 0.12 : 0.08); // 利き手側に少しひねる
    } else {
      P.rarm.rotation.set(a, 0, GRIP); P.larm.rotation.set(a - 0.05, 0, -GRIP);
      if (P.tool) P.tool.rotation.x = Math.PI / 2 + k1 * 0.5;
    }
    P.body.rotation.x = lean; P.body.rotation.y = twist;
    // 前に体重をかける足の開き
    P.rleg.rotation.x = 0.28 - lean * 0.4; P.lleg.rotation.x = -0.32 - lean * 0.4;
    P.body.position.y = -Math.abs(lean) * 0.08;
    P.head.rotation.x = 0.2 + lean * 0.3; // 当てる所を見る
    const p = c >= H1 ? (c - H1) / 0.28 : -1;
    if (dig) chips(P, 'stone', p, 0, 3 * PX, 19 * PX); else chips(P, 'wood', p, 0, 13 * PX, 15 * PX);
  } else if (pose === 'fish') {
    // 両手でさおを前に出して待つ。うきが沈んだら、さおを上へ振り上げる
    breathe(0.3);
    const f = fishCycle(t);
    P.rarm.rotation.set(-0.95 - f.reel * 0.8, 0, 0.18); P.larm.rotation.set(-0.75 - f.reel * 0.6, 0, -0.42);
    if (P.tool) P.tool.rotation.x = Math.PI / 2 + 0.4 - f.reel * 0.5; // さおは前へ 35 度ほど上向き。釣り上げる時に立てる
    P.body.rotation.x = 0.06 - f.reel * 0.12; P.head.rotation.x = 0.25 - f.reel * 0.2;
    P.rleg.rotation.x = 0.12; P.lleg.rotation.x = -0.12;
  } else if (pose === 'gather') {
    // （下の共通処理で盾を上げる）
    const c = Math.sin(t * 3);
    P.body.position.y = -0.18; P.body.rotation.x = 0.35;
    P.rleg.rotation.x = -0.7; P.lleg.rotation.x = -0.7;
    P.rarm.rotation.x = -1.0 + c * 0.35; P.larm.rotation.x = -0.9 - c * 0.35;
    P.head.rotation.x = 0.3;
    breathe(0.25);
  } else {
    // 立っている：呼吸＋ときどき周りを見る・伸びをする（人ごとに違う）
    breathe(0.35);
    const per = 8 + seed * 5, u = ((t / per) + seed * 3.7) % 1;
    P.rarm.rotation.z = -0.05; P.larm.rotation.z = 0.05;
    const sw = Math.sin(t * 1.4 + seed * 6) * 0.05;
    P.rarm.rotation.x = sw; P.larm.rotation.x = -sw;
    if (pose === 'talk') {
      // 話す：うなずきと身ぶり
      P.head.rotation.x = Math.max(0, Math.sin(t * 5 + seed * 9)) * 0.12;
      const g = Math.max(0, Math.sin(t * 2.3 + seed * 4));
      P.rarm.rotation.x = -0.5 - g * 0.6; P.rarm.rotation.z = 0.25;
      P.head.rotation.y = Math.sin(t * 0.7 + seed) * 0.1;
    } else if (u < 0.22) {
      // 首を回して周りを見る
      const k = u / 0.22;
      P.head.rotation.y = Math.sin(k * Math.PI * 2) * 0.7;
      P.head.rotation.x = -0.05;
    } else if (u > 0.55 && u < 0.7 && seed > 0.3) {
      // 伸び
      const k = Math.sin(((u - 0.55) / 0.15) * Math.PI);
      P.rarm.rotation.set(-2.9 * k, 0, 0.25 * k); P.larm.rotation.set(-2.9 * k, 0, -0.25 * k);
      P.body.rotation.x = -0.12 * k; P.head.rotation.x = -0.3 * k;
      P.head.position.y += 0.4 * k * PX;
    } else {
      P.head.rotation.y = Math.sin(t * 0.4 + seed * 5) * 0.15;
    }
  }
  // 2 頭身は頭が重く大きいので、体の前かがみと首の傾きを小さくする（大きく傾けると頭が地面に付いて見える）
  if (ch.userData.chibi) {
    P.body.rotation.x *= 0.35; P.head.rotation.x *= 0.5; P.body.position.y *= 0.5;
    // 道具を持って立つ・歩く時は、腕を前に出して体の前で持つ（大きな頭のかげや体の後ろに隠れないように）
    if (P.tool && (pose === 'idle' || pose === 'walk' || pose === 'talk') && P.toolKind !== 'basket') {
      P.rarm.rotation.set(-0.85 + P.rarm.rotation.x * 0.2, 0, 0.65);
      P.tool.rotation.x = Math.PI / 2 - 0.2;
      P.tool.rotation.y = 1.2; // 道具の絵の面を前へ向ける（正面から形が分かる。真横向きのままだと棒にしか見えない）
    } else if (P.tool) P.tool.rotation.y = 0;
    // 振る時も、手を体のまん中へ寄せて、道具が体の前を通るようにする
    if (P.tool && (pose === 'dig' || pose === 'chop') && ch.userData.oneHand) P.rarm.rotation.z = 0.5;
  }
  // 盾を持っていて矢が来ている時は、左腕を前に上げて盾で受ける（少し身をかがめる）
  if (P.shield && ch.userData.block) { P.larm.rotation.set(-1.45, 0.25, -0.2); P.body.rotation.x = Math.max(P.body.rotation.x, 0.12); P.head.rotation.x = -0.1; }
  else if (P.shield) P.larm.rotation.set(-1.0, 0.2, -0.15); // 盾を前に構えておく
}
