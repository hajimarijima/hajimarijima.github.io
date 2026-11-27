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
    // ツインテールの房（スキンの使われていない x56〜63・y16〜25 に描いてある。描いていないスキンでは透けて見えない）
    tail: boxGeo(56, 16, 2, 8, 2),
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
  } else if (kind === 'hammer') {
    // 鍛冶の金づち：木の柄に、鉄の四角い頭（打つ面は明るく）
    g.add(box(0.06, 0.56, 0.06, toolMats.wood, 0, 0.18, 0));
    g.add(box(0.13, 0.13, 0.26, toolMats.ironDark, 0, 0.47, 0.02));
    g.add(box(0.135, 0.135, 0.04, toolMats.ironTip, 0, 0.47, 0.16));
  } else if (kind === 'can') {
    // じょうろ：持つ所（原点）は上の取っ手。その下にブリキの胴が立ち、胴の前の上から細い口が前下へのびる（先 userData.spout から水が出る）
    //   形は「立てた向き」で作る（+y が上・+z が口の向き）。手に持たせる向きは holdCan で毎コマ合わせる（腕の角度によらず胴が立つ）
    const tin = toolMats.ironDark || head, tinL = toolMats.ironTip || light;
    const can = new THREE.Group(); g.add(can); g.userData.can = can;
    can.add(box(0.05, 0.05, 0.24, tin, 0, 0, 0)); // 取っ手（横棒）
    for (const z of [-0.1, 0.1]) can.add(box(0.05, 0.08, 0.05, tin, 0, -0.05, z)); // 取っ手の足
    can.add(box(0.26, 0.24, 0.3, tin, 0, -0.21, 0)); // 胴
    can.add(box(0.27, 0.03, 0.31, tinL, 0, -0.095, 0)); // 上のふち（明るい）
    can.add(box(0.27, 0.03, 0.31, tinL, 0, -0.33, 0)); // 下のふち
    const A = 0.3, dy = -Math.sin(A), dz = Math.cos(A), L = 0.32, s0 = { y: -0.15, z: 0.15 }; // 口：胴の前の上から前へ。先だけ少し下がる（約 17 度）
    const spout = box(0.055, 0.055, L, tin, 0, s0.y + dy * L / 2, s0.z + dz * L / 2); spout.rotation.x = A; can.add(spout);
    const rose = box(0.1, 0.1, 0.045, tinL, 0, s0.y + dy * (L + 0.02), s0.z + dz * (L + 0.02)); rose.rotation.x = A; can.add(rose); // はす口
    const sp = new THREE.Object3D(); sp.position.set(0, s0.y + dy * (L + 0.06), s0.z + dz * (L + 0.06)); can.add(sp); g.userData.spout = sp;
  } else if (kind === 'basket') {
    g.add(box(0.28, 0.18, 0.22, toolMats.basket, 0, -0.05, 0.12));
    g.add(box(0.08, 0.06, 0.08, toolMats.berry, 0.05, 0.06, 0.1));
  }
  // 手に持つ道具は少し大きめにして、遠くからでも形が分かるようにする
  g.userData.base = ['axe', 'pick', 'hoe', 'shovel', 'sword', 'hammer'].includes(kind) ? 1.35 : 1;
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
const TAIL_Z = 2.5, TAIL_Z_ARMOR = 3.4; // 房の箱のまん中の前後（px）。胴は ±2、防具は ±2.75（腕の防具 ±2.9）
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
  // ツインテールの房：胸の両横（x ±2.9px、上は首の高さで頭の下に隠れる）に縦に垂れる箱。前へ 3.5px まで出るので真横からも見える。
  //   胴に付けるので、歩いても腕と一緒にはゆれない。胴の防具を着た時は防具の外まで前へ出す（setArmor）
  //   肩のうしろ側にも同じ箱を置く（真うしろ・うしろ斜めからも房が見える）。userData.back：うしろ側は z を負に
  const tails = [];
  for (const back of [false, true]) for (const s of [-1, 1]) {
    const t = mk(G.tail, over); t.userData.back = back;
    t.position.set(s * 2.9 * PX, 2 * PX, (back ? -TAIL_Z : TAIL_Z) * PX); torso.add(t); tails.push(t);
  }

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
  root.userData.parts = { tails, torso, body, head, rarm, larm, rleg, lleg, hand, front, tool: null, toolKind: null, carry: null, carryKind: null };
  return root;
}

export function setTool(ch, kind) {
  const P = ch.userData.parts;
  if (P.toolKind === kind) return;
  if (P.tool) P.hand.remove(P.tool);
  P.tool = kind ? makeTool(kind) : null; P.toolKind = kind;
  if (P.tool) { P.tool.rotation.x = kind === 'can' ? 0 : Math.PI / 2; P.hand.add(P.tool); } // じょうろは腕を下ろした時に胴が立つ向き（水をまく間は holdCan）
}
// じょうろを自然に持たせる：取っ手が上・胴はほぼ水平・口は yaw（世界の向き。+z が 0。ふつうは村人の正面）の方へ、先だけ少し下がる。
//   手の向き（腕の角度）を打ち消して、世界で見た向きを決める。animate と腕の調整のあと、毎コマ呼ぶ
const _hq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qx = new THREE.Quaternion();
const _UY = new THREE.Vector3(0, 1, 0), _UX = new THREE.Vector3(1, 0, 0);
export function holdCan(ch, yaw, tilt = 0.06) {
  const P = ch.userData.parts, t = P && P.tool;
  if (!t || P.toolKind !== 'can') return;
  P.hand.getWorldQuaternion(_hq);
  _wq.multiplyQuaternions(_qy.setFromAxisAngle(_UY, yaw), _qx.setFromAxisAngle(_UX, tilt)); // tilt：前へ少しかたむける
  t.quaternion.copy(_hq.invert().multiply(_wq));
}
// 好きな色を服の差し色に（スカーフと帯）
export function setAccent(ch, color) {
  const P = ch.userData.parts;
  if (P.accent) { P.torso.remove(P.accent); P.accent = null; }
  if (!color) return;
  const m = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  const scarf = box(8.8 * PX, 1.6 * PX, 4.8 * PX, m, 0, 5.4 * PX, 0); g.add(scarf);
  const tail = box(1.6 * PX, 3 * PX, 0.8 * PX, m, 2 * PX, 3.4 * PX, 2.6 * PX); g.add(tail); tail.visible = !P.armorBody; // 胴の防具を着ている時は、スカーフの先は防具の中
  const belt = box(8.7 * PX, 1.2 * PX, 4.7 * PX, m, 0, -5.2 * PX, 0); g.add(belt);
  P.torso.add(g); P.accent = g;
}
// 防具（鍛冶職人が作る）を体に重ねる。look = { head, body, feet }：'素材#色'（js/smithing.js の armorLook。例 'wool#f2eee4'）。
//   体の部位を少しだけ大きくした外側の層（胴・腕の上・すねの下と足）で、体の形にぴったり沿う。
//   板やボタンは貼らず、層のドット絵の模様で素材を見せる（羊毛＝白っぽい毛のまだら、革＝茶の濃淡とふちどり、鉄＝銀の明暗と鋲）。
//   帽子は頭を包まず、てっぺん側だけの小さな帽子（顔と前髪・横の髪は見える）。胴の層は首のスカーフと腰の帯が見える高さまで
const armorTexCache = {};
const hashN = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// 1 面ぶんの絵（1px＝1 マス）。w×h マス、face で模様をずらす
function armorFaceTex(tier, color, w, h, face) {
  const key = [tier, color, w, h, face].join('|');
  if (armorTexCache[key]) return armorTexCache[key];
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), base = new THREE.Color(color);
  const put = (x, y, k) => { const c = base.clone().multiplyScalar(k); g.fillStyle = '#' + new THREE.Color(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b)).getHexString(); g.fillRect(x, y, 1, 1); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = hashN(x + face * 31, y, w * 7 + h), edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    let k = 1;
    if (tier === 'wool') {
      // 白っぽい毛のまだら：明るい粒・少し暗い粒、下のふちは影
      k = r < 0.28 ? 1.06 : r < 0.5 ? 0.9 : r < 0.56 ? 0.82 : 1;
      if (y === h - 1) k *= 0.84;
    } else if (tier === 'leather') {
      // 茶の濃淡：ふちは濃くふちどり、その内側に明るい縫い目、面の中はまだら
      k = 0.94 + r * 0.14;
      if (edge) k = 0.62;
      else if ((x === 1 || x === w - 2 || y === 1 || y === h - 2) && (x + y) % 2 === 0) k = 1.22;
    } else {
      // 鉄の明暗：上と左は光、下と右は影、すじ、四すみに鋲
      k = 0.97 + r * 0.06 + (x % 3 === 0 ? -0.05 : 0);
      if (y === 0 || x === 0) k = 1.16;
      if (y === h - 1 || x === w - 1) k = 0.7;
      if (w > 3 && h > 3 && (x === 1 || x === w - 2) && (y === 1 || y === h - 2)) k = 0.6;
    }
    put(x, y, k);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return (armorTexCache[key] = t);
}
const armorMatCache = {};
// 箱の 6 面（+x -x +y -y +z -z）それぞれに、面の大きさ（px）に合わせた模様
function armorMats(tier, color, w, h, d) {
  const key = [tier, color, w, h, d].join('|');
  if (armorMatCache[key]) return armorMatCache[key];
  const R = (n) => Math.max(1, Math.round(n));
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const mats = dims.map(([a, b], i) => { const map = armorFaceTex(tier, color, R(a), R(b), i); return map ? new THREE.MeshLambertMaterial({ map }) : new THREE.MeshLambertMaterial({ color }); });
  return (armorMatCache[key] = mats);
}
const armorPart = (look) => { const [tier, c] = String(look).split('#'); return { tier: tier || 'wool', color: '#' + (c || 'e6dcc4') }; };
export function setArmor(ch, look) {
  const P = ch.userData.parts;
  const key = look ? ['head', 'body', 'feet'].map((k) => look[k] || '').join('|') : '';
  if (P.armorKey === key) return;
  for (const m of P.armor || []) m.parent && m.parent.remove(m);
  P.armor = []; P.armorKey = key; P.armorBody = !!(look && look.body);
  if (P.accent && P.accent.children[1]) P.accent.children[1].visible = !P.armorBody; // スカーフの先は胴の層の中
  for (const t of P.tails || []) t.position.z = (P.armorBody ? TAIL_Z_ARMOR : TAIL_Z) * (t.userData.back ? -1 : 1) * PX; // ツインテールの房は防具の外へ
  if (!look) return;
  const add = (parent, A, w, h, d, x, y, z) => { const m = box(w * PX, h * PX, d * PX, armorMats(A.tier, A.color, w, h, d), x * PX, y * PX, z * PX); parent.add(m); P.armor.push(m); };
  if (look.head) {
    // 頭（0〜8px、スキンの帽子の層は 8.5 まで）のてっぺん側だけ：上 1.5px と、前に少し出たつば
    const A = armorPart(look.head);
    add(P.head, A, 9.4, 1.5, 9.4, 0, 8.55, 0);
    add(P.head, A, 9.4, 0.6, 1.8, 0, 7.9, 5.45); // つばの奥の面は帽子の層の正面（4.5）より少し前（重なってちらつかない）
  }
  if (look.body) {
    // 胴（8×12×4、上着の層は +0.5）を 0.75 ふくらませた層。高さは -4.5〜4.5（首のスカーフと腰の帯は見える）
    const A = armorPart(look.body);
    add(P.torso, A, 9.5, 9, 5.5, 0, 0, 0);
    // 胴の重ね層（js/skingen.js では髪だけ：背中へ垂れる長い髪・三つ編み・ツインテール・肩にかかる髪）を、防具の外側にもう 1 枚。
    //   防具の下に隠れて「首の下で髪が切れた」ように見えないようにする。防具（9.5×9×5.5）より少し大きく、ちらつかない
    const jacket = P.torso.children[1];
    if (jacket && jacket.isMesh) {
      const hair = new THREE.Mesh(jacket.geometry, jacket.material); hair.castShadow = true;
      hair.scale.set(9.8 / 8.5, 1, 6.2 / 4.5); // 前と後ろは腕の防具（奥行き 5.8）よりも外（ちらつかない） hair.position.copy(jacket.position);
      P.torso.add(hair); P.armor.push(hair);
    }
    // 両腕の上側（肩から 5px）を 0.75 ふくらませた層。細い腕（3px）は細く
    for (const arm of [P.rarm, P.larm]) {
      const g0 = arm.children[0] && arm.children[0].geometry;
      if (g0 && !g0.boundingBox) g0.computeBoundingBox();
      const aw = g0 ? Math.round((g0.boundingBox.max.x - g0.boundingBox.min.x) / PX) : 4;
      // 内側（胴の側）へはふくらませない（肩の上で頭の角に入らない）。外・前後・上へ 0.6〜0.9。奥行きは胴の層より少し大きく（前の面が重なってちらつかない）
      const out = Math.sign(arm.position.x) || 1;
      add(arm, A, aw + 0.75, 5.6, 5.8, out * 0.375, -2.2, 0);
    }
  }
  if (look.feet) {
    // 足とすねの下（脚 4×12×4 の下 5.4px）を 0.6 ふくらませた層。底は地面の高さ
    const A = armorPart(look.feet);
    // 左右のくつは内側で少し重なるので、左を わずかに大きくして同じ面が重ならない（ちらつかない）ようにする
    [P.rleg, P.lleg].forEach((leg, i) => add(leg, A, 5.2 + i * 0.1, 5.45 + i * 0.1, 5.2 + i * 0.1, 0, -9.325 + i * 0.05, 0));
  }
}
export function setCarry(ch, kind) {
  const P = ch.userData.parts;
  if (P.carryKind === kind) return;
  if (P.carry) P.front.remove(P.carry);
  P.carry = kind ? makeCarry(kind) : null; P.carryKind = kind;
  if (P.carry) P.front.add(P.carry);
}

// 見張りの盾（木の板に鉄のふち）。左の前腕の外側にベルトで付け、体の前に構える。矢や攻撃が来たら腕ごと上げて顔の前で受ける
const shieldMats = { wood: new THREE.MeshLambertMaterial({ color: 0x8a5a32 }), wood2: new THREE.MeshLambertMaterial({ color: 0x744a28 }), rim: new THREE.MeshLambertMaterial({ color: 0x6a7078 }), boss: new THREE.MeshLambertMaterial({ color: 0xb8bec4 }) };
export function setShield(ch, on) {
  const P = ch.userData.parts;
  if (!!P.shield === on) return;
  if (P.shield) { P.shield.parent?.remove(P.shield); P.shield = null; return; }
  // 縦長の板（厚みは z）。位置と向きは animate の placeShield で毎コマ左手の前に合わせる
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(box(0.15, 0.56, 0.05, i % 2 ? shieldMats.wood2 : shieldMats.wood, -0.15 + i * 0.15, 0, 0));
  g.add(box(0.5, 0.05, 0.065, shieldMats.rim, 0, 0.27, 0)); g.add(box(0.5, 0.05, 0.065, shieldMats.rim, 0, -0.27, 0));
  g.add(box(0.05, 0.5, 0.07, shieldMats.rim, 0.24, 0, 0)); g.add(box(0.05, 0.5, 0.07, shieldMats.rim, -0.24, 0, 0)); // 上下のふちと重ならない長さ・厚み（チカチカ防ぎ）
  g.add(box(0.12, 0.12, 0.06, shieldMats.boss, 0, 0, 0.04));
  g.add(box(0.06, 0.16, 0.05, shieldMats.rim, 0, -0.02, -0.045)); // 裏の取っ手（手がここを握る）
  P.larm.parent.add(g); P.shield = g; placeShield(P);
}

// 打った時に飛ぶかけら（石・木くず）
const chipMats = { stone: new THREE.MeshLambertMaterial({ color: 0x8d9298 }), wood: new THREE.MeshLambertMaterial({ color: 0xc89a5e }), spark: new THREE.MeshBasicMaterial({ color: 0xffb030 }) };
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
// pose: 'idle' | 'talk' | 'walk' | 'chop' | 'dig' | 'gather' | 'carry' | 'fish' | 'strike'（見張りが敵をたたく。phase: 0..1 の 1 振り分、0.75 で当たる）
export function animate(ch, pose, t, phase = null) {
  const P = ch.userData.parts;
  const seed = ch.userData.seed || 0;
  P.body.position.y = 0; P.body.rotation.set(0, 0, 0);
  P.head.rotation.set(0, 0, 0);
  const B0 = ch.userData.base || { head: 24 * PX, torso: 18 * PX, arm: 24 * PX };
  P.head.position.y = B0.head; P.torso.position.y = B0.torso;
  P.rarm.position.y = B0.arm; P.larm.position.y = B0.arm;
  P.head.position.z = 0; P.torso.position.z = 0; P.rarm.position.z = 0; P.larm.position.z = 0; P.torso.rotation.set(0, 0, 0); // お辞儀で前へ出した・倒した分をもどす
  for (const k of ['rarm', 'larm', 'rleg', 'lleg']) P[k].rotation.set(0, 0, 0);
  if (P.chips) P.chips.visible = false;
  if (P.vsign) for (const v of P.vsign) v.visible = false;
  if (P.tool) P.tool.rotation.x = Math.PI / 2;
  if (P.hand) { P.hand.rotation.set(0, 0, 0); P.hand.position.x = 0; }
  if (P.fish && pose !== 'showfish') { P.fish.visible = false; if (P.tool) P.tool.visible = true; }
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
  } else if (pose === 'smith') {
    // 金床で金づちをふるう：右手で小さく振りかぶって打ち下ろす（片手）。左手は金床の上の品を押さえる。打つと火花
    const c = ((t + seed) * 1.7) % 1, up = -2.2, hit = -0.62, H0 = 0.5, H1 = 0.66;
    let a;
    if (c < H0) { const k = c / H0, e = k * k * (3 - 2 * k); a = hit + (up - hit) * e; }
    else if (c < H1) { const k = (c - H0) / (H1 - H0); a = up + (hit - up) * k * k; }
    else { const k = (c - H1) / (1 - H1); a = hit - Math.sin(Math.min(1, k * 3) * Math.PI) * 0.1; }
    P.rarm.rotation.set(a, 0, 0.12);
    if (P.tool) P.tool.rotation.x = Math.PI / 2 + (c < H0 ? -0.35 : 0.3);
    P.larm.rotation.set(-0.72, 0, -0.22);
    P.body.rotation.x = 0.16; P.head.rotation.x = 0.35;
    P.rleg.rotation.x = 0.14; P.lleg.rotation.x = -0.14;
    breathe(0.2);
    chips(P, 'spark', c >= H1 ? (c - H1) / 0.25 : -1, -1 * PX, 12.5 * PX, 11 * PX);
  } else if (pose === 'dig' || pose === 'chop' || pose === 'strike') {
    // 振りかぶる → 振り下ろす → 当たって小さく止まる → もどす
    const dig = pose === 'dig';
    const strike = pose === 'strike', c = strike && phase !== null ? phase : (t * (dig ? 1.3 : 1.6)) % 1;
    const H0 = dig ? 0.45 : 0.5, H1 = dig ? 0.65 : 0.75, H2 = dig ? 0.76 : 0.85; // 振り下ろし開始・当たる・止まり終わり
    const up = dig ? -3.0 : -2.5, hit = dig ? -0.85 : -1.45, rest = dig ? -0.9 : -1.1;
    let a, lean, twist = 0, recoil = 0;
    if (c < H0) { const k = c / H0; const e = k * k * (3 - 2 * k); a = rest + (up - rest) * e; lean = -0.1 * e; twist = (dig ? 0 : 0.35) * e; }
    else if (c < H1) { const k = (c - H0) / (H1 - H0); const e = k * k; a = up + (hit - up) * e; lean = -0.1 + (dig ? 0.42 : 0.3) * e; twist = (dig ? 0 : 0.35) - (dig ? 0 : 0.45) * e; }
    else if (c < H2) { const k = (c - H1) / (H2 - H1); recoil = Math.sin(k * Math.PI) * 0.12; a = hit - recoil; lean = dig ? 0.32 : 0.2; twist = dig ? 0 : -0.1; }
    else { const k = (c - H2) / (1 - H2); const e = k * k * (3 - 2 * k); a = hit + (rest - hit) * e; lean = (dig ? 0.32 : 0.2) * (1 - e); twist = (dig ? 0 : -0.1) * (1 - e); }
    // 手首を返す量：振り下ろしで前へ返し、当たったところで止める
    const k1 = c < H0 ? -0.45 * (c / H0) : c < H1 ? -0.45 + 0.85 * ((c - H0) / (H1 - H0)) : c < H2 ? 0.4 : 0.4 * (1 - (c - H2) / (1 - H2));
    if (ch.userData.oneHand || strike) {
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
    if (dig) chips(P, 'stone', p, 0, 3 * PX, 19 * PX); else if (!strike) chips(P, 'wood', p, 0, 13 * PX, 15 * PX);
  } else if (pose === 'fish') {
    // 両手でさおを前に出して待つ。うきが沈んだら、さおを上へ振り上げる
    breathe(0.3);
    const f = fishCycle(t);
    P.rarm.rotation.set(-0.95 - f.reel * 0.8, 0, 0.18); P.larm.rotation.set(-0.75 - f.reel * 0.6, 0, -0.42);
    if (P.tool) P.tool.rotation.x = Math.PI / 2 + 0.4 - f.reel * 0.5; // さおは前へ 35 度ほど上向き。釣り上げる時に立てる
    P.body.rotation.x = 0.06 - f.reel * 0.12; P.head.rotation.x = 0.25 - f.reel * 0.2;
    P.rleg.rotation.x = 0.12; P.lleg.rotation.x = -0.12;
  } else if (pose === 'showfish') {
    showFishPose(ch, P, B0, t);
  } else if (pose === 'gather') {
    // （下の共通処理で盾を上げる）
    const c = Math.sin(t * 3);
    P.body.position.y = -0.18; P.body.rotation.x = 0.35;
    P.rleg.rotation.x = -0.7; P.lleg.rotation.x = -0.7;
    P.rarm.rotation.x = -1.0 + c * 0.35; P.larm.rotation.x = -0.9 - c * 0.35;
    P.head.rotation.x = 0.3;
    breathe(0.25);
  } else if (pose === 'water') {
    // 畑に水をやる：立ったまま、両手を前に出して、ゆっくり左右にふりながら水をまく（しゃがむ「集める」とは別の形）
    breathe(0.3);
    const s = Math.sin(t * 1.6 + seed * 5);
    P.rarm.rotation.set(-1.05 + s * 0.08, s * 0.25, 0.25); P.larm.rotation.set(-0.95 + s * 0.08, s * 0.25, -0.25);
    P.body.rotation.x = 0.12; P.body.rotation.y = s * 0.12;
    P.head.rotation.x = 0.35;
    P.rleg.rotation.x = 0.1; P.lleg.rotation.x = -0.1;
  } else if (pose === 'lie') {
    // 寝る：あお向けに横になる（頭は後ろ側）。ベッドの上なら ch.userData.lieY だけ上げる。ゆっくり息をする
    P.body.rotation.x = -Math.PI / 2;
    P.body.position.y = 2.2 * PX + (ch.userData.lieY || 0);
    P.rarm.rotation.z = -0.12; P.larm.rotation.z = 0.12;
    P.rleg.rotation.z = -0.04; P.lleg.rotation.z = 0.04;
    P.head.rotation.y = 0.35 * (seed < 0.5 ? 1 : -1); // 顔を少し横へ
    breathe(0.25 * (1 + Math.sin(t * 0.5 + seed * 7)));
  } else if (pose === 'sit') {
    // 木にもたれて眠る：脚を前へ投げ出して座り、少し後ろへもたれ、首をかしげる
    const hipY = P.rleg.position.y;
    P.body.position.y = -hipY + 1.5 * PX;
    P.body.rotation.x = -0.1; // 後ろへ少しだけ（頭の後ろが幹に入らない角度。town.js の幹からの間と合わせてある）
    P.rleg.rotation.set(-1.45, 0, -0.1); P.lleg.rotation.set(-1.45, 0, 0.1);
    P.rarm.rotation.set(-0.35, 0, -0.15); P.larm.rotation.set(-0.35, 0, 0.15);
    P.head.rotation.x = 0.35; P.head.rotation.z = 0.25 * (seed < 0.5 ? 1 : -1);
    breathe(0.3);
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
      // 腕は肩から離さず、ひじ下を少し前に出す小さな手ぶり（z は外向きにして胸へめりこませない）
      P.rarm.rotation.x = -0.3 - g * 0.3; P.rarm.rotation.y = 0; P.rarm.rotation.z = -0.08;
      P.head.rotation.y = Math.sin(t * 0.7 + seed) * 0.1;
    } else if (pose === 'bow' || pose === 'nod' || pose === 'wave') {
      greetPose(ch, P, pose, phase ?? 0, t); // あいさつ（phase：0..1 の 1 回分）
    } else if (pose.startsWith('pm_')) {
      photoPose(ch, P, pose, phase ?? 1, t); // 写真モードのポーズ（phase：ポーズを始めてからの秒）
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
  if (ch.userData.chibi && pose !== 'lie' && pose !== 'sit' && pose !== 'pm_sit' && pose !== 'pm_jump') {
    P.body.rotation.x *= 0.35; P.head.rotation.x *= 0.5; P.body.position.y *= 0.5;
    // 道具を持って立つ・歩く時は、腕を前に出して体の前で持つ（大きな頭のかげや体の後ろに隠れないように）
    if (P.tool && (pose === 'idle' || pose === 'walk' || pose === 'talk') && P.toolKind !== 'basket') {
      P.rarm.rotation.set(-0.85 + P.rarm.rotation.x * 0.2, 0, 0.65);
      P.tool.rotation.x = Math.PI / 2 - 0.2;
      P.tool.rotation.y = 1.2; // 道具の絵の面を前へ向ける（正面から形が分かる。真横向きのままだと棒にしか見えない）
    } else if (P.tool) P.tool.rotation.y = 0;
    // 話す時の手ぶりは、2 頭身では腕が短く太いので ごく小さく（前へ出すと胸から離れた箱に見える）
    if (pose === 'talk' && !P.tool) { P.rarm.rotation.x *= 0.35; P.rarm.rotation.z = -0.04; }
    // 振る時も、手を体のまん中へ寄せて、道具が体の前を通るようにする
    if (P.tool && (pose === 'dig' || pose === 'chop' || pose === 'strike') && (ch.userData.oneHand || pose === 'strike')) P.rarm.rotation.z = 0.5;
  } else if (P.tool && (pose === 'idle' || pose === 'walk' || pose === 'talk') && P.toolKind !== 'basket' && !String(P.toolKind).startsWith('torch')) {
    // 道具を下げて持つ時は、握った手から少し外・少し下へ向ける（斜め前から見て、柄が腰や服に入っているように見えない）
    // 柄の後ろの端が胴（ベストの厚み）へ寄らないよう、握る所を腕の外寄りにして、外へ向ける角度は小さめ
    P.hand.rotation.set(0.3, -0.28, 0); P.hand.position.x = -0.7 * PX;
  }
  // 盾を持っていて矢が来ている時は、左腕を前に上げて盾で受ける（少し身をかがめる）
  if (P.shield) {
    // 構え：ひじを曲げたように腕を少し前へ出し、体の前（胸からおなか）を盾でかくす。受ける時は腕を前へ上げて顔の前に
    const up = ch.userData.block ? 1 : 0;
    P.larm.rotation.set(up ? -1.3 : -0.55, 0, up ? -0.55 : -0.42);
    if (up) { P.body.rotation.x = Math.max(P.body.rotation.x, 0.1); P.head.rotation.x = -0.05; }
  }
  if (ch.userData.nod && pose === 'walk') P.head.rotation.x += 0.32 * ch.userData.nod; // すれちがう時の会釈（town.js が 0..1 を入れる）
  if (ch.userData.smooth) smoothPose(ch, P, t);
  if (P.shield) placeShield(P);
}
// ---------- あいさつ：お辞儀（腰から曲げる）・会釈（首と少しだけ腰）・手をふる ----------
// u：0..1 の 1 回分。a まで曲げる → b まで止める → もどす
const easeIO = (k) => k * k * (3 - 2 * k);
const bell = (u, a, b) => (u <= 0 || u >= 1 ? 0 : u < a ? easeIO(u / a) : u < b ? 1 : easeIO((1 - u) / (1 - b)));
// 腰（脚の付け根）を軸に、胴・頭・両腕を前へ th だけ回す。脚と足は地面に立ったまま。
// 軸は胴の下の「後ろの角」：後ろは脚の上とつながったまま、前の角は脚の中へ下がる（すき間ができない）
function bendWaist(P, th) {
  const hip = P.rleg.position.y, bz = -2 * PX * P.torso.scale.z, c = Math.cos(th), s = Math.sin(th);
  for (const k of ['torso', 'head', 'rarm', 'larm']) {
    const o = P[k], dy = o.position.y - hip, dz = o.position.z - bz;
    o.position.y = hip + dy * c - dz * s; o.position.z = bz + dy * s + dz * c; o.rotation.x += th;
  }
}
function greetPose(ch, P, pose, u, t) {
  const C = ch.userData.chibi;
  if (pose === 'wave') {
    // 右手を顔の横へ上げて、左右に小さくふる。腕は胴の横にあるので、真上へ回すと付け根が肩の上に浮く。
    // 回す点を肩の角の 2.5px 下（腕の太さの まん中あたり）へ下げ、上げた腕の根元が胴の横に重なってつながって見えるようにする
    const k = bell(u, 0.2, 0.8), w = Math.sin(t * 11) * bell(u, 0.3, 0.72);
    P.rarm.position.y -= 3.5 * PX * P.rarm.scale.y * k;
    P.rarm.rotation.set(-2.95 * k, 0, -(C ? 1.0 : 0.24 + 0.1 * w) * k); // 外へ 8〜20 度だけ開く（開きすぎると根元がはなれる）
    P.larm.rotation.set(0, 0, 0.06);
    P.head.rotation.z = 0.07 * k; P.head.rotation.y = 0;
    return;
  }
  const bow = pose === 'bow', k = bell(u, bow ? 0.32 : 0.3, bow ? 0.62 : 0.48);
  // 腰から 24 度ほど（会釈より深いお辞儀）。向かい合う 2 人のあいだ（town.js の 2.1）で、頭が相手に当たらない深さ
  const th = (bow ? (C ? 0.3 : 0.42) : (C ? 0.05 : 0.1)) * k;
  P.head.rotation.y = 0;
  bendWaist(P, th);
  P.head.rotation.x += (bow ? 0.06 : 0.38) * k;
  // 腕は胴にそわせる（気をつけの形のまま体といっしょに倒す）。真下へたらすと横から胴がかくれて、折れて見える
  P.rarm.rotation.x -= th * 0.12; P.larm.rotation.x -= th * 0.12;
  P.rarm.rotation.z = -0.06; P.larm.rotation.z = 0.06;
}
// ---------- 写真モードのポーズ（js/photomode.js の「はい、チーズ」）----------
// e：ポーズを始めてからの秒。0.7 秒かけてポーズに入り、1 秒で決まる（その時に撮る）。
// 腕は肩の角を軸に回る 4×12×4px の箱（2 頭身は太く短い）。頭（8px、2 頭身は 13.6px）や胴へめり込まないよう、上げる腕は外へ開き、
// 前へ出す腕は肩ごと少し前・外へずらす（数値はポーズごとに 2 種類の体型で、腕の箱が頭・胴の箱に入らないことを確かめた値）
// 指（ピース）：手の先に 2 本の小さな箱。色は腕の下の面（手のひら）の色をスキンから取る
function skinOfHand(arm) {
  const m = arm.children[0] && arm.children[0].material, img = m && m.map && m.map.image;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d'), w = img.width || 64, h = img.height || 64;
    g.drawImage(img, Math.floor(w * 49 / 64), Math.floor(h * 17 / 64), 1, 1, 0, 0, 1, 1); // 右腕の下の面（手の先）
    const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data;
    if (a > 100) return (r << 16) | (gg << 8) | b;
  } catch (e) { /* 読めない時は肌色 */ }
  return 0xe7b98e;
}
function vSign(P, arm) {
  if (!P.vsign) P.vsign = [];
  let v = arm.userData.vsign;
  if (!v) {
    v = new THREE.Group(); v.position.y = -12 * PX;
    const mat = new THREE.MeshLambertMaterial({ color: skinOfHand(P.rarm) });
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(1.1 * PX, 3.6 * PX, 1.1 * PX), mat);
      f.position.set(s * 0.95 * PX, -1.6 * PX, 0.3 * PX); f.rotation.z = s * 0.22; f.castShadow = true; v.add(f);
    }
    arm.add(v); arm.userData.vsign = v; P.vsign.push(v);
  }
  v.visible = true;
}
// 腕を上げる：side 1＝右腕（-x）・-1＝左腕。up：前へ回す量（-2.95 でほぼ真上）、out：外へ開く量。肩の軸を下げて、根元が胴の横につながって見えるようにする
function liftArm(P, arm, side, k, up, out, drop) {
  arm.position.y -= drop * PX * arm.scale.y * k;
  arm.rotation.set(up * k, 0, -side * out * k);
}
function photoPose(ch, P, pose, e, t) {
  const C = ch.userData.chibi, k = easeIO(Math.min(1, Math.max(0, e / 0.7)));
  const mirror = pose.endsWith('R'), base = mirror ? pose.slice(0, -1) : pose;
  P.head.rotation.y = 0;
  // ピース：片手を頭の横の斜め上へ（頭から離して外へ開く）。指を 2 本立てる
  const peace = (arm, side) => { liftArm(P, arm, side, k, -2.55, C ? 1.05 : 0.5, 2.5); if (k > 0.6) vSign(P, arm); };
  if (base === 'pm_peace') {
    peace(P.rarm, 1); P.larm.rotation.set(0, 0, 0.07 * k);
    P.head.rotation.z = -0.1 * k;
  } else if (base === 'pm_banzai' || base === 'pm_jump') {
    let air = 0;
    if (base === 'pm_jump' && e > 0.7) { // 1.3 秒ごとに跳ぶ。e＝1 秒でいちばん高い所
      let d = (((e - 1) % 1.3) + 1.3) % 1.3; if (d > 0.65) d -= 1.3;
      air = Math.abs(d) < 0.32 ? 1 - (d / 0.32) ** 2 : 0;
      P.body.position.y = 0.6 * air;
      P.rleg.rotation.x = -0.3 * air; P.lleg.rotation.x = 0.22 * air;
    }
    const a = base === 'pm_jump' ? k * (0.55 + 0.45 * air) : k;
    liftArm(P, P.rarm, 1, a, -2.9, C ? 1.0 : 0.34, 3.5); liftArm(P, P.larm, -1, a, -2.9, C ? 1.0 : 0.34, 3.5);
    P.head.rotation.x = -0.12 * k;
  } else if (base === 'pm_bow') {
    greetPose(ch, P, 'bow', 0.32 * k, t);
  } else if (base === 'pm_cross') {
    // 腕組み：両腕を前へ上げて内へ寄せ、体の前で重ねる。右腕は少し上・左腕は少し前（重なって見える）。肩ごと前・外へずらして胴に入らないように
    const zin = C ? 0.62 : 0.6;
    P.rarm.position.z += (C ? 2.4 : 2.2) * PX * k; P.rarm.position.x -= (C ? 0.6 : 0.5) * PX * k;
    P.larm.position.z += (C ? 3.4 : 3.2) * PX * k; P.larm.position.x += (C ? 0.6 : 0.5) * PX * k;
    P.rarm.rotation.set(-1.35 * k, 0, zin * k); P.larm.rotation.set(-1.12 * k, 0, -zin * k);
    P.head.rotation.x = -0.04 * k; P.head.rotation.z = 0.05 * k;
  } else if (base === 'pm_sit') {
    // 地面に座る：脚を前へ出して、手はひざの横。背すじはのばして前を向く
    const hipY = P.rleg.position.y;
    P.body.position.y = (-hipY + 1.5 * PX) * k;
    P.rleg.rotation.set(-1.45 * k, 0, -0.08 * k); P.lleg.rotation.set(-1.45 * k, 0, 0.08 * k);
    P.rarm.rotation.set(-0.55 * k, 0, -0.1 * k); P.larm.rotation.set(-0.55 * k, 0, 0.1 * k);
    P.head.rotation.z = 0.07 * k;
  } else if (base === 'pm_hug') {
    // 2 人で肩を組む（呼んだ相手は横・少し前に立つ）：内側の腕を横へのばして相手の肩のうしろにまわし、外の手でピース
    const inner = mirror ? P.rarm : P.larm, side = mirror ? 1 : -1;
    inner.rotation.set(0, 0, -side * 1.45 * k);
    peace(mirror ? P.larm : P.rarm, -side);
    P.head.rotation.z = 0.1 * k * -side;
  } else if (base === 'pm_pal') {
    // 肩を組まれる側：外の手でピース、内側の手は下ろしたまま
    peace(mirror ? P.rarm : P.larm, mirror ? 1 : -1);
    P.head.rotation.z = 0.1 * k * (mirror ? -1 : 1);
  }
}
// ---------- 釣った魚を持ち上げて見せる（pose 'showfish'。ch.userData.showFish = { cm, key }） ----------
// 魚の模型は長さ 1 の箱の組み合わせ（頭が +x）。大きさは cm で決める（村人の背 2（=32px）を約 170cm として、1cm ≒ 0.19px）。
// 形の外側：x ±0.5、y -0.16〜+0.2、z ±0.075（目まで）。めり込まないように、置き場所はこの外側で計算する
const FISH_COL = { fish_funa: [0x7f8456, 0xc9c79a], fish_masu: [0x9ea3b8, 0xe7b8c4], fish_koi: [0xe2752c, 0xf6eee0], fish_namazu: [0x55503f, 0x9a9278], fish_hotaru: [0x9fd86a, 0xe9ffb0], fish_tsuki: [0xd6cfa6, 0xf4f0d8],
  fish_dojou: [0x7a6a48, 0xc8b88a], fish_bluegill: [0x5f7a5a, 0xe0a050], fish_ugui: [0x8a96a0, 0xd9b07a], fish_aji: [0x6f8fa8, 0xe8ecef], fish_saba: [0x3f7a8c, 0xdfe6ea],
  fish_mebaru: [0x6a5a5e, 0xb9a8a0], fish_kasago: [0xb5502e, 0xe8a070], fish_tai: [0xe06a6a, 0xf8d8d0], fish_maguro: [0x2c3e5c, 0xc8d0d8], fish_hoshi: [0x2a3a78, 0x9fc8ff] };
export const fishLenPx = (cm) => Math.max(2.2, (+cm || 0) * 0.188);
function makeShowFish(key) {
  const [c1, c2] = FISH_COL[key] || [0x8a9aa8, 0xdfe6ea];
  const m1 = new THREE.MeshLambertMaterial({ color: c1 }), m2 = new THREE.MeshLambertMaterial({ color: c2 }), me = new THREE.MeshLambertMaterial({ color: 0x15171a });
  const g = new THREE.Group();
  const b = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); };
  b(0.62, 0.28, 0.14, 0, 0, 0, m1);            // 胴
  b(0.5, 0.06, 0.145, 0, -0.115, 0, m2);        // 白っぽいおなか
  b(0.18, 0.22, 0.12, 0.40, -0.01, 0, m1);      // 頭
  b(0.1, 0.14, 0.08, -0.36, 0, 0, m1);          // 尾の付け根
  b(0.08, 0.32, 0.04, -0.45, 0, 0, m2);         // 尾びれ
  b(0.22, 0.06, 0.03, -0.02, 0.17, 0, m2);      // 背びれ
  b(0.04, 0.04, 0.15, 0.43, 0.04, 0, me);       // 目（左右）
  g.userData.key = key;
  return g;
}
function showFishPose(ch, P, B0, t) {
  const sf = ch.userData.showFish || { cm: 20 };
  if (!P.fish || P.fish.userData.key !== sf.key) { if (P.fish) P.body.remove(P.fish); P.fish = makeShowFish(sf.key); P.body.add(P.fish); }
  const F = P.fish; F.visible = true;
  if (P.tool) P.tool.visible = false; // 釣りざおは置いて、手で持つ
  // 腕の長さと厚みの半分は、そで（上着の層、0.5px 大きい）までふくめる
  const S = Math.abs(P.rarm.position.x), Ys = B0.arm, armLen = 12.25 * PX * P.rarm.scale.y, armHalf = 2.25 * PX * P.rarm.scale.z;
  const chibi = !!ch.userData.chibi;
  let L = fishLenPx(sf.cm) * PX;
  if (chibi) L = Math.max(1.3 * PX, Math.min(L * 0.6, 6.5 * PX)); // 2 頭身は腕が短いので、小さめにして片手で下げる
  const wag = Math.sin(t * 9) * 0.12; // 魚がぴちぴち動く（縦の軸のまわり）
  F.scale.setScalar(L);
  P.body.rotation.x = -0.05; P.head.rotation.x = 0.12; // 少し胸をはって、魚を見る
  P.rleg.rotation.x = 0.06; P.lleg.rotation.x = -0.06;
  if (!chibi && L >= 10 * PX) {
    // 大きい魚：両腕を前へ水平に出し、魚を手の上にのせて抱える。腕の上の面（肩の高さ＋腕の厚みの半分）より上に魚の下の面
    // マグロのように腕の幅より長い魚は、手を広げすぎず（φ は -0.64 まで）、はみ出したまま腕にのせる。顔に当たらないよう、魚の胸がわの面は頭より前
    const hx = Math.min(Math.max(S, L / 2 - 1.2 * PX), S + armLen * 0.6), phi = Math.asin(Math.max(-1, Math.min(1, (S - hx) / armLen)));
    P.rarm.rotation.set(-Math.PI / 2, 0, phi); P.larm.rotation.set(-Math.PI / 2, 0, -phi);
    F.rotation.set(0, wag, 0);
    F.position.set(0, Ys + armHalf + 0.16 * L + 0.1 * PX, Math.max(armLen * Math.cos(phi) - 1.5 * PX, 6 * PX + 0.09 * L));
  } else if (!chibi) {
    // 小さい魚：右手を前へまっすぐ出し、指先で尾をつまんで下げる（魚は手の先の面より前。頭が下）
    P.rarm.rotation.set(-Math.PI / 2, 0, 0); P.larm.rotation.set(0.05, 0, -0.05);
    F.rotation.set(0, wag, -Math.PI / 2);
    F.position.set(-S, Ys + 0.3 * PX - 0.5 * L, armLen + 0.075 * L + 0.04 * L + 0.1 * PX);
  } else {
    // 2 頭身：右手を前下へ出し、腕のいちばん低い所（手の先の下の角）より下に魚を下げる
    const th = 1.2;
    P.rarm.rotation.set(-th, 0, 0); P.larm.rotation.set(0.05, 0, -0.05);
    const tipY = Ys - armLen * Math.cos(th), tipZ = armLen * Math.sin(th);
    const low = tipY - armHalf * Math.sin(th);
    F.rotation.set(0, wag, -Math.PI / 2);
    F.position.set(-S, low - 0.1 * PX - 0.5 * L, tipZ);
  }
}
// 盾は腕の子にせず体に付け、毎コマ「左手の先」の少し前へ置く。板は縦で前向き（受ける時は少し上向き）。
// 腕は必ず板の後ろ側に来るので、どの姿勢でも腕や手が板を突き抜けない。手は板の裏の取っ手を握る位置になる
const _hv = new THREE.Vector3(), _e = new THREE.Euler();
function placeShield(P) {
  const a = P.larm, g = P.shield;
  _hv.set(0, -11 * PX, 0).multiply(a.scale).applyEuler(a.rotation).add(a.position); // 手の位置（体の中の座標）
  const up = Math.min(1, Math.max(0, (-a.rotation.x - 0.55) / 0.75)); // 0＝構え 1＝受け
  g.position.set(_hv.x - 0.5 * PX, _hv.y + (1 - up) * 1.5 * PX, _hv.z + 3.4 * PX + up * 1.2 * PX);
  g.rotation.set(-0.12 - up * 0.25, 0, 0);
}
// 動きの切りかわり（待つ→歩く など）を、ゆるやかな曲線でつなぐ：前のコマの角度から、今の角度へ少しずつ寄せる。
// 寄せる速さは時間で決めるので、コマの数がちがっても同じ。大きく時間がとんだ時（画面の外から戻った時）はそのまま
const SMOOTH_PARTS = ['rarm', 'larm', 'rleg', 'lleg', 'head', 'body'];
function smoothPose(ch, P, t) {
  const S = ch.userData.prevPose || (ch.userData.prevPose = { t: null, r: SMOOTH_PARTS.map(() => [0, 0, 0]), by: 0 });
  const dt = S.t === null ? 1 : t - S.t; S.t = t;
  if (!(dt > 0 && dt < 0.25)) { SMOOTH_PARTS.forEach((k, i) => { const r = P[k].rotation; S.r[i][0] = r.x; S.r[i][1] = r.y; S.r[i][2] = r.z; }); S.by = P.body.position.y; return; }
  const k = 1 - Math.exp(-dt * 16); // 約 0.06 秒で追いつく（振り下ろしの勢いは残す）
  SMOOTH_PARTS.forEach((name, i) => {
    const r = P[name].rotation, q = S.r[i];
    q[0] += (r.x - q[0]) * k; q[1] += (r.y - q[1]) * k; q[2] += (r.z - q[2]) * k;
    r.set(q[0], q[1], q[2]);
  });
  S.by += (P.body.position.y - S.by) * k; P.body.position.y = S.by;
}
