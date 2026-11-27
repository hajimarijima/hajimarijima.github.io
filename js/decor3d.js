// 家の飾りの模型（町の画面・村人のページ・家を飾るページで共通）。決まり（マス・置き方）は js/decor.js。
//   ・どの部品も、ふちを少し暗く・面にこまかな濃淡を入れた小さな絵（8×8 ドット）をはって、のっぺりさせない
//   ・飾りは何段かの箱を重ね、出っぱり・へこみ・取っ手・花びらなどを付けて立体にする
//   ・町の画面（js/town.js）からは loadHomeDecor → homeDecorSolids（人がよける）→ addHomeDecor（描く）の 3 つだけ呼ぶ
import * as THREE from 'three';
import { DECOR, CELL, gridOf, localPos, toWorldPos, mailboxLocal, residentsOf, homeLayoutFor, sizeOf } from './decor.js';
import { makeMailbox } from './mailbox3d.js';
import { LAMP_MAT, TORCH_MAT, makeHouse, rnd } from './world3d.js';

// ---------- 部品 ----------
const texCache = {}, matCache = {};
// 8×8 の濃淡の絵：ふちは暗く、上と左は少し明るく、面はこまかくまだら（同じ色なら同じ絵）
function voxTex(hex) {
  if (texCache[hex]) return texCache[hex];
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'), base = new THREE.Color(hex), R = rnd('vox' + hex);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let k = 0.93 + R() * 0.12;
    if (x === 0 || y === 0) k += 0.08;
    if (x === 7 || y === 7) k -= 0.16;
    const col = base.clone().multiplyScalar(k);
    g.fillStyle = '#' + col.getHexString(); g.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[hex] = t);
}
const voxMat = (hex) => matCache[hex] || (matCache[hex] = new THREE.MeshLambertMaterial({ map: voxTex(hex) }));
const geoCache = {};
const boxGeo = (w, h, d) => { const k = w.toFixed(3) + ',' + h.toFixed(3) + ',' + d.toFixed(3); return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d)); };
// 箱を 1 つ足す（color は数か、そのまま使う material）
export function part(parent, w, h, d, color, x = 0, y = 0, z = 0, rot = null) {
  const m = new THREE.Mesh(boxGeo(w, h, d), typeof color === 'object' ? color : voxMat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  parent.add(m);
  return m;
}
const S = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();

// ---------- 飾りの模型（マスの中心が原点・床が y=0。向き 0 で前は +z） ----------
const MODEL = {
  flowerbed(g, R) {
    const wood = 0x8a5a33;
    for (const s of [-1, 1]) { part(g, 0.84, 0.3, 0.1, wood, 0, 0.15, s * 0.37); part(g, 0.1, 0.3, 0.64, S(wood, 0.92), s * 0.37, 0.15, 0); }
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, 0.13, 0.36, 0.13, 0x6b4628, x * 0.37, 0.18, z * 0.37);
    part(g, 0.64, 0.06, 0.64, 0x5a3a22, 0, 0.27, 0); // 土
    for (let i = 0; i < 6; i++) part(g, 0.08 + R() * 0.05, 0.03, 0.08 + R() * 0.05, 0x6e4a2e, (R() - 0.5) * 0.5, 0.31, (R() - 0.5) * 0.5); // 土のでこぼこ
    const cols = [0xe2507a, 0xf2d24a, 0xffffff, 0x9a6ad2, 0xf28a3a];
    for (let i = 0; i < 7; i++) {
      const x = -0.22 + (i % 3) * 0.22 + (R() - 0.5) * 0.06, z = -0.2 + Math.floor(i / 3) * 0.2 + (R() - 0.5) * 0.06, h = 0.14 + R() * 0.16, c = cols[Math.floor(R() * cols.length)];
      part(g, 0.035, h, 0.035, 0x4d8a34, x, 0.3 + h / 2, z);
      part(g, 0.1, 0.03, 0.05, 0x5f9c40, x + 0.04, 0.3 + h * 0.45, z, [0, 0, 0.4]); // 葉
      part(g, 0.12, 0.07, 0.12, c, x, 0.32 + h, z);
      part(g, 0.06, 0.05, 0.06, c === 0xf2d24a ? 0xc0582a : 0xf2d24a, x, 0.36 + h, z); // 花のまん中
    }
  },
  fence(g) {
    const wood = 0xa47a4a;
    for (const x of [-0.36, 0.36]) { part(g, 0.13, 0.82, 0.13, 0x7a5232, x, 0.41, 0); part(g, 0.17, 0.06, 0.17, 0x6b4628, x, 0.85, 0); }
    for (const y of [0.3, 0.6]) part(g, 0.84, 0.08, 0.06, S(wood, 0.85), 0, y, -0.06);
    for (let i = 0; i < 4; i++) {
      const x = -0.21 + i * 0.14;
      part(g, 0.1, 0.62, 0.05, wood, x, 0.36, 0.0);
      part(g, 0.07, 0.07, 0.05, S(wood, 1.08), x, 0.7, 0.0, [0, 0, Math.PI / 4]); // とがった先
    }
  },
  flag(g, R) {
    part(g, 0.5, 0.12, 0.5, 0x8f8b84, 0, 0.06, 0); part(g, 0.34, 0.12, 0.34, 0xa8a49c, 0, 0.18, 0);
    part(g, 0.07, 2.0, 0.07, 0xd9d4c8, 0, 1.24, 0);
    part(g, 0.12, 0.12, 0.12, 0xd4af37, 0, 2.3, 0); // 先の玉
    const cols = [0xd8302c, 0xf6f1e4, 0x2f6db0];
    const c0 = cols[Math.floor(R() * 3)], c1 = 0xf6f1e4;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const wave = Math.sin(i * 1.1) * 0.05;
      part(g, 0.13, 0.15, 0.04, (j === 1) ? c1 : c0, 0.1 + i * 0.13, 2.08 - j * 0.15, wave);
    }
  },
  lantern(g) {
    part(g, 0.46, 0.1, 0.46, 0x8f8b84, 0, 0.05, 0); part(g, 0.3, 0.1, 0.3, 0xa8a49c, 0, 0.15, 0);
    part(g, 0.12, 1.3, 0.12, 0x5e3e24, 0, 0.85, 0);
    part(g, 0.4, 0.08, 0.08, 0x5e3e24, 0.14, 1.46, 0); // 腕
    const iron = 0x2e2e32, x = 0.28;
    part(g, 0.03, 0.12, 0.03, iron, x, 1.38, 0);
    part(g, 0.24, 0.05, 0.24, iron, x, 1.31, 0); part(g, 0.16, 0.05, 0.16, iron, x, 1.35, 0); // 屋根
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, 0.03, 0.24, 0.03, iron, x + a * 0.09, 1.16, b * 0.09);
    part(g, 0.15, 0.2, 0.15, LAMP_MAT, x, 1.16, 0).castShadow = false;
    part(g, 0.22, 0.04, 0.22, iron, x, 1.03, 0);
    g.userData.light = { x, y: 1.16, z: 0 };
  },
  bench(g) {
    const wood = 0x9a6a3a, dark = 0x6b4628;
    for (let i = 0; i < 3; i++) part(g, 1.62, 0.05, 0.12, i % 2 ? S(wood, 0.94) : wood, 0, 0.42, -0.14 + i * 0.14);
    for (const x of [-0.7, 0.7]) {
      part(g, 0.08, 0.42, 0.08, dark, x, 0.21, 0.14); part(g, 0.08, 0.85, 0.08, dark, x, 0.42, -0.2);
      part(g, 0.08, 0.06, 0.44, dark, x, 0.6, -0.01); part(g, 0.08, 0.2, 0.06, dark, x, 0.52, 0.17); // ひじかけ
      part(g, 0.06, 0.05, 0.36, S(dark, 0.9), x, 0.18, -0.03); // 足の間
    }
    for (const y of [0.62, 0.76]) part(g, 1.48, 0.09, 0.04, y > 0.7 ? wood : S(wood, 0.92), 0, y, -0.21);
  },
  barrel(g, R) {
    const wood = 0x8a5a2c, hoop = 0x3a3a40;
    part(g, 0.56, 0.7, 0.56, wood, 0, 0.35, 0);
    part(g, 0.64, 0.4, 0.64, S(wood, 1.05), 0, 0.35, 0); // ふくらみ
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; part(g, 0.05, 0.42, 0.05, S(wood, 0.8), Math.cos(a) * 0.33, 0.35, Math.sin(a) * 0.33); } // 板の継ぎ目
    for (const y of [0.12, 0.58]) part(g, 0.6, 0.05, 0.6, hoop, 0, y, 0);
    part(g, 0.68, 0.05, 0.68, hoop, 0, 0.35, 0);
    part(g, 0.48, 0.03, 0.48, 0x3f86b0, 0, 0.69, 0); // 水
    // 魚（しっぽが出ている）
    for (const [x, z, a] of [[-0.08, 0.05, 0.5], [0.12, -0.06, -0.6]]) {
      const f = new THREE.Group(); f.position.set(x, 0.72, z); f.rotation.set(0.35, a, 0); g.add(f);
      part(f, 0.08, 0.16, 0.05, 0x9fb3c2, 0, 0.06, 0); part(f, 0.14, 0.06, 0.04, 0x7f93a6, 0, 0.16, 0); part(f, 0.04, 0.04, 0.052, 0x1d2a3a, 0, 0.01, 0);
    }
    if (R() < 0.5) part(g, 0.18, 0.04, 0.12, 0x6b4628, 0.2, 0.72, 0.2, [0, 0.4, 0]);
  },
  planter(g, R) {
    const clay = 0xb8643c;
    part(g, 0.36, 0.24, 0.36, clay, 0, 0.12, 0); part(g, 0.48, 0.1, 0.48, S(clay, 1.08), 0, 0.29, 0); part(g, 0.4, 0.04, 0.4, 0x4a3020, 0, 0.33, 0);
    part(g, 0.08, 0.5, 0.08, 0x6b4628, 0, 0.58, 0);
    const greens = [0x4a8a3c, 0x5a9c46, 0x3f7a34, 0x6aaa50];
    for (let i = 0; i < 6; i++) { const s = 0.2 + R() * 0.12; part(g, s, s * 0.85, s, greens[i % 4], (R() - 0.5) * 0.3, 0.86 + R() * 0.22, (R() - 0.5) * 0.3); }
    for (let i = 0; i < 3; i++) part(g, 0.05, 0.05, 0.05, 0xd8302c, (R() - 0.5) * 0.36, 0.9 + R() * 0.2, 0.16 + R() * 0.04);
  },
  bed(g) {
    const wood = 0x8a5a33;
    part(g, 0.8, 0.26, 1.7, wood, 0, 0.17, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, 0.1, 0.12, 0.1, S(wood, 0.8), x * 0.35, 0.06, z * 0.78);
    part(g, 0.72, 0.14, 1.6, 0xf2efe6, 0, 0.36, 0); // しきぶとん
    part(g, 0.76, 0.1, 1.06, 0x3f78b8, 0, 0.46, 0.28); // かけぶとん
    part(g, 0.78, 0.04, 0.14, 0xf2efe6, 0, 0.5, -0.2); // 折り返し
    for (const z of [0.14, 0.46]) part(g, 0.77, 0.02, 0.06, 0x2d5a92, 0, 0.515, z); // しま
    part(g, 0.5, 0.12, 0.26, 0xfaf7ee, 0, 0.48, -0.6); // まくら
    part(g, 0.86, 0.8, 0.1, S(wood, 0.9), 0, 0.4, -0.84); part(g, 0.9, 0.06, 0.14, S(wood, 1.1), 0, 0.82, -0.84); // 頭の板
    part(g, 0.86, 0.4, 0.08, S(wood, 0.9), 0, 0.3, 0.84);
  },
  desk(g) {
    const wood = 0xa06a3a, dark = 0x6b4628;
    part(g, 1.6, 0.07, 0.72, wood, 0, 0.74, 0); part(g, 1.64, 0.03, 0.76, S(wood, 0.85), 0, 0.695, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, 0.08, 0.68, 0.08, dark, x * 0.74, 0.34, z * 0.3);
    part(g, 0.5, 0.3, 0.62, S(wood, 0.95), 0.5, 0.52, 0); part(g, 0.36, 0.1, 0.02, S(wood, 1.12), 0.5, 0.58, 0.315); part(g, 0.08, 0.03, 0.03, 0xd8c27a, 0.5, 0.58, 0.33); // 引き出し
    part(g, 0.26, 0.05, 0.2, 0xd8302c, -0.4, 0.8, 0.02); part(g, 0.24, 0.04, 0.18, 0x3f78b8, -0.41, 0.845, 0.0); part(g, 0.27, 0.01, 0.17, 0xf2ead6, -0.4, 0.822, 0.02); // 本
    part(g, 0.08, 0.1, 0.08, 0x2e2e32, -0.05, 0.825, -0.15); part(g, 0.02, 0.16, 0.02, 0xf2ead6, -0.02, 0.88, -0.13, [0.3, 0, 0]); // インクと羽ペン
  },
  chair(g) {
    const wood = 0x9a6a3a, dark = 0x6b4628;
    part(g, 0.5, 0.06, 0.5, wood, 0, 0.45, 0); part(g, 0.42, 0.04, 0.42, 0xc0503a, 0, 0.49, 0.02); // 座ぶとん
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, 0.07, 0.42, 0.07, dark, x * 0.2, 0.21, z * 0.2);
    for (const x of [-0.2, 0.2]) part(g, 0.07, 0.56, 0.07, dark, x, 0.76, -0.2);
    for (const y of [0.72, 0.92]) part(g, 0.44, 0.08, 0.05, wood, 0, y, -0.2);
  },
  shelf(g, R) {
    const wood = 0x7a5232;
    part(g, 0.84, 1.6, 0.06, S(wood, 0.8), 0, 0.8, -0.2);
    for (const x of [-0.39, 0.39]) part(g, 0.06, 1.6, 0.46, wood, x, 0.8, 0);
    for (const y of [0.04, 0.55, 1.06, 1.57]) part(g, 0.84, 0.06, 0.46, S(wood, 1.06), 0, y, 0);
    const cols = [0xd8302c, 0x3f78b8, 0x4b9a5e, 0xe0a030, 0x8c4a7a, 0xf2ead6];
    for (const y of [0.07, 0.58, 1.09]) { let x = -0.33; while (x < 0.3) { const w = 0.06 + R() * 0.05, h = 0.28 + R() * 0.14; part(g, w, h, 0.3, cols[Math.floor(R() * cols.length)], x + w / 2, y + h / 2, 0.02); x += w + 0.01; } }
  },
  lamp(g) {
    part(g, 0.34, 0.06, 0.34, 0x5e3e24, 0, 0.03, 0); part(g, 0.2, 0.06, 0.2, 0x7a5232, 0, 0.09, 0);
    part(g, 0.06, 1.0, 0.06, 0x2e2e32, 0, 0.6, 0);
    part(g, 0.16, 0.16, 0.16, LAMP_MAT, 0, 1.12, 0).castShadow = false;
    part(g, 0.4, 0.08, 0.4, 0xe8d6a8, 0, 1.08, 0); part(g, 0.34, 0.14, 0.34, 0xf2e4bc, 0, 1.19, 0); part(g, 0.24, 0.06, 0.24, 0xd8c08a, 0, 1.29, 0); // かさ
    g.userData.light = { x: 0, y: 1.1, z: 0 };
  },
  plant(g, R) {
    part(g, 0.36, 0.3, 0.36, 0xe8e0d0, 0, 0.15, 0); part(g, 0.42, 0.06, 0.42, 0xd8cfbe, 0, 0.32, 0); part(g, 0.32, 0.03, 0.32, 0x4a3020, 0, 0.35, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + R() * 0.4, h = 0.5 + R() * 0.35;
      const l = part(g, 0.1, h, 0.03, i % 2 ? 0x3f7a34 : 0x5a9c46, Math.cos(a) * 0.1, 0.36 + h / 2, Math.sin(a) * 0.1);
      l.rotation.set(Math.sin(a) * 0.45, -a, -Math.cos(a) * 0.45);
    }
  },
  rug(g, R) {
    const base = [0xb8433a, 0x3f6fa8, 0x4b8a5e][Math.floor(R() * 3)], edge = 0xe8d6a8;
    part(g, 1.7, 0.03, 1.7, edge, 0, 0.015, 0);
    part(g, 1.5, 0.035, 1.5, base, 0, 0.02, 0);
    part(g, 1.1, 0.04, 1.1, S(base, 0.75), 0, 0.022, 0);
    part(g, 0.6, 0.045, 0.6, edge, 0, 0.024, 0);
    part(g, 0.3, 0.05, 0.3, base, 0, 0.026, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, 0.18, 0.045, 0.18, edge, x * 0.6, 0.024, z * 0.6);
    for (let i = -3; i <= 3; i++) for (const s of [-1, 1]) part(g, 0.06, 0.02, 0.1, edge, i * 0.24, 0.01, s * 0.89); // ふさ
  },
  picture(g, R) {
    // 奥の壁にかける（前は +z。原点は壁ぎわの床）
    const frame = R() < 0.5 ? 0xb88a2a : 0x6b4628, y = 1.35;
    part(g, 0.72, 0.56, 0.05, frame, 0, y, 0.03);
    part(g, 0.6, 0.44, 0.03, 0x8fc6e8, 0, y, 0.06); // 空
    part(g, 0.6, 0.12, 0.035, 0x3f86b0, 0, y - 0.16, 0.065); // 海
    part(g, 0.24, 0.14, 0.04, 0x5a9c46, -0.12, y - 0.06, 0.07); part(g, 0.12, 0.08, 0.04, 0x4a8a3c, -0.12, y + 0.04, 0.072); // 島
    part(g, 0.08, 0.08, 0.04, 0xf2d24a, 0.18, y + 0.12, 0.07); // お日さま
    for (const x of [-0.36, 0.36]) part(g, 0.06, 0.62, 0.07, S(frame, 1.1), x, y, 0.04);
    for (const yy of [-0.29, 0.29]) part(g, 0.78, 0.06, 0.07, S(frame, 1.1), 0, y + yy, 0.04);
  },
};
// 飾りの模型（seed で花の色などが決まる）
export function makeDecor(id, seed = id) {
  const g = new THREE.Group();
  (MODEL[id] || MODEL.flowerbed)(g, rnd('decor:' + seed));
  g.userData.decor = id;
  return g;
}

// ---------- 家に置く ----------
// 家の中心から見た位置に、置いた物を入れる（place：'out' | 'in'）。list：[[飾り, i, j, 向き, 村人?]]
export function placeDecor(parent, place, look, list, seedBase = '') {
  const out = [];
  for (const [id, i, j, r, who] of list || []) {
    if (!DECOR[id]) continue;
    const p = localPos(place, look, id, i, j, r), o = makeDecor(id, `${seedBase}:${who || ''}:${i}:${j}`);
    if (DECOR[id].layer === 'wall') { o.position.set(p.x, 0, -(look.d || 3) / 2 + 0.03); o.rotation.y = 0; } // 絵は奥の壁
    else { o.position.set(p.x, 0, p.z); o.rotation.y = p.yaw; }
    parent.add(o); out.push(o);
  }
  return out;
}
// 部品を material ごとにまとめる（町の画面で、描く数を減らす）
async function compact(group) {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), by = new Map();
  group.traverse((m) => {
    if (!m.isMesh) return;
    const gg = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (!by.has(m.material)) by.set(m.material, []);
    by.get(m.material).push(gg);
  });
  const out = new THREE.Group();
  for (const [mt, list] of by) { const merged = new THREE.Mesh(mergeGeometries(list, false), mt); merged.castShadow = true; merged.receiveShadow = true; out.add(merged); }
  return { merged: out };
}

// ---------- 町の画面 ----------
const isHome = (b, config) => { const d = config.buildings[b.type]; return !!(d && d.cap && d.look && d.look.kind === 'house'); };
// 町の画面のデータ（data/decor.json・data/mail.json。なければ空）から、家ごとの飾りと郵便受けを決める
export async function loadHomeDecor(D) {
  const get = (n) => fetch('data/' + n + '.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [decor, mail] = await Promise.all([get('decor'), get('mail')]);
  const { config, world, life, active, state } = D;
  const homes = [];
  const newTo = new Set(((mail && mail.letters) || []).filter((L) => L.day === state.day).map((L) => L.to));
  for (const b of world.buildings || []) {
    if (!isHome(b, config)) continue;
    const res = residentsOf(b, active, life);
    if (!res.length) continue;
    const look = config.buildings[b.type].look;
    homes.push({ b, look, residents: res.map((v) => v.key), layout: homeLayoutFor(b, look, res, decor || {}, config), flag: res.some((v) => newTo.has(v.key)) });
  }
  return { homes };
}
// 人がよける所（郵便受けと、外に置いた物）
export function homeDecorSolids(HD) {
  const out = [];
  for (const H of (HD && HD.homes) || []) {
    const m = toWorldPos(H.b, mailboxLocal(H.look)); out.push({ x: m.x, z: m.z, r: 0.3, decor: 'mailbox' });
    for (const [id, i, j, r] of H.layout.out) {
      const [sw, sd] = sizeOf(id, r), p = toWorldPos(H.b, localPos('out', H.look, id, i, j, r));
      // 長い物（ベンチ）は 2 つの円で
      if (sw > 1 || sd > 1) { const ax = sw > 1 ? CELL / 2 : 0, az = sd > 1 ? CELL / 2 : 0, c = Math.cos(H.b.rot || 0), s = Math.sin(H.b.rot || 0); for (const k of [-1, 1]) out.push({ x: p.x + k * (ax * c + az * s), z: p.z + k * (-ax * s + az * c), r: 0.42, decor: id }); }
      else out.push({ x: p.x, z: p.z, r: 0.42, decor: id });
    }
  }
  return out;
}
// 町に描く（外の飾りと郵便受け。家の中は外から見えないので、村人のページの「家」で見る）
export function addHomeDecor(scene, HD, { merge = true } = {}) {
  const root = new THREE.Group(); root.name = 'homeDecor';
  for (const H of (HD && HD.homes) || []) {
    const g = new THREE.Group(); g.position.set(H.b.x, 0, H.b.z); g.rotation.y = H.b.rot || 0;
    const items = new THREE.Group(); g.add(items);
    placeDecor(items, 'out', H.look, H.layout.out, H.b.id);
    const mb = makeMailbox({ flag: H.flag, seed: H.b.id }), mp = mailboxLocal(H.look);
    mb.position.set(mp.x, 0, mp.z); g.add(mb); // 郵便受けは旗がゆれるので、まとめない
    root.add(g);
    // 飾りは material ごとに 1 つにまとめる（ランタンの灯りは町の LAMP_MAT のままなので、夜は光る）
    if (merge && items.children.length) compact(items).then(({ merged }) => { items.clear(); items.add(merged); }).catch(() => {});
  }
  scene.add(root);
  if (window.TOWN) window.TOWN.homeDecor = HD; // 確かめ用
  return root;
}

// ---------- 村人のページ・家を飾るページの見た目 ----------
// 家（外）か、家の中（手前と右の壁を外した部屋）。el に描く。戻り値 { show(mode, layout, flag), dispose }
export function makeHomeView(el, { look, b = { id: 'home', x: 0, z: 0, rot: 0, variant: 0 }, controls: OrbitControls = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  el.append(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.8); sun.position.set(-6, 12, 9); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); sun.shadow.bias = -0.0008;
  scene.add(sun);
  const holder = new THREE.Group(); scene.add(holder);
  let orbit = null;
  if (OrbitControls) { orbit = new OrbitControls(cam, renderer.domElement); orbit.enableDamping = true; orbit.enablePan = false; orbit.minPolarAngle = 0.35; orbit.maxPolarAngle = 1.35; }
  let mode = 'out';
  function show(m, layout, flag = false) {
    mode = m; holder.clear();
    const w = look.w || 4, d = look.d || 3.4;
    if (m === 'in') {
      buildRoom(holder, look, (layout && layout.in) || [], b.id);
      cam.position.set(w * 0.55, 3.6 + d * 0.3, d * 1.25 + 2.2); setTarget(0, 0.7, -0.2);
    } else {
      const house = makeHouse(look, b); holder.add(house);
      const yard = new THREE.Mesh(new THREE.BoxGeometry(8, 0.04, d + 5.4), new THREE.MeshLambertMaterial({ color: 0x86b85a })); yard.position.set(0, -0.02, 0.9); yard.receiveShadow = true; holder.add(yard);
      const path = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 3.2), new THREE.MeshLambertMaterial({ color: 0xcbb48a })); path.position.set(0, 0.0, d / 2 + 1.5); path.receiveShadow = true; holder.add(path);
      placeDecor(holder, 'out', look, (layout && layout.out) || [], b.id);
      const mb = makeMailbox({ flag, seed: b.id }), mp = mailboxLocal(look); mb.position.set(mp.x, 0, mp.z); holder.add(mb);
      cam.position.set(4.2, 4.6, d / 2 + 8.6); setTarget(0, 0.9, d / 2 + 0.6);
    }
    holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  function setTarget(x, y, z) { if (orbit) { orbit.target.set(x, y, z); orbit.update(); } else cam.lookAt(x, y, z); }
  const size = () => { const W = el.clientWidth || 300, H = el.clientHeight || 220; renderer.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null; if (ro) ro.observe(el); else addEventListener('resize', size);
  size();
  renderer.setAnimationLoop(() => { if (orbit) orbit.update(); renderer.render(scene, cam); });
  return { show, get mode() { return mode; }, dispose() { renderer.setAnimationLoop(null); ro && ro.disconnect(); renderer.dispose(); } };
}
const WIN = new THREE.MeshLambertMaterial({ color: 0xbfe3f2 });
// 家の中の部屋：床・奥の壁・左の壁（中が見えるように手前と右はない）と、置いた飾り。戻り値は置いた飾りの模型の list（遊びに行った時の js/visitroom.js が使う）
export function buildRoom(holder, look, list, seedBase = '') {
  const w = look.w || 4, d = look.d || 3.4;
  const floor = new THREE.Group(); floor.name = 'floor'; holder.add(floor);
  for (let x = -w / 2 + 0.25; x < w / 2; x += 0.5) part(floor, 0.49, 0.1, d, Math.round((x + 9) * 2) % 2 ? 0xb08050 : 0xa47444, x, -0.05, 0);
  part(holder, w + 0.2, 2.4, 0.14, 0xd9c7a2, 0, 1.2, -d / 2 - 0.07);
  part(holder, 0.14, 2.4, d + 0.2, 0xcdbb94, -w / 2 - 0.07, 1.2, 0);
  part(holder, w + 0.2, 0.16, 0.18, 0x8a5a33, 0, 0.08, -d / 2 - 0.05); part(holder, 0.18, 0.16, d + 0.2, 0x8a5a33, -w / 2 - 0.05, 0.08, 0); // はば木
  part(holder, 0.06, 0.7, 0.8, WIN, -w / 2 + 0.01, 1.45, 0.2); part(holder, 0.08, 0.08, 0.9, 0x8a5a33, -w / 2 + 0.02, 1.84, 0.2); part(holder, 0.08, 0.08, 0.9, 0x8a5a33, -w / 2 + 0.02, 1.06, 0.2); // 窓
  // 扉の所の印（床の明るい四角）
  part(holder, 0.9, 0.012, 0.5, 0xd8c08a, 0, 0.006, d / 2 - 0.25);
  return placeDecor(holder, 'in', look, list, seedBase);
}

// ---------- 絵（パレットの小さな絵。模型をななめ上から描く） ----------
let iconR = null;
const iconCache = {};
export function decorIcon(id, size = 96) {
  if (iconCache[id + size]) return iconCache[id + size];
  if (!iconR) {
    iconR = { renderer: new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }), scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(26, 1, 0.1, 50) };
    iconR.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.2));
    const s = new THREE.DirectionalLight(0xffffff, 1.7); s.position.set(-3, 5, 4); iconR.scene.add(s);
  }
  const { renderer, scene, cam } = iconR;
  renderer.setSize(size, size, false); renderer.setPixelRatio(1);
  const m = makeDecor(id, 'icon'); scene.add(m);
  if (id === 'picture') m.position.y = -0.8;
  const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const dir = id === 'picture' ? new THREE.Vector3(0.35, 0.25, 1).normalize() : new THREE.Vector3(0.9, 0.85, 1.1).normalize();
  cam.position.copy(c).addScaledVector(dir, r / Math.sin((26 / 2) * Math.PI / 180) * 1.02); cam.lookAt(c);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(m);
  return (iconCache[id + size] = url);
}
export { gridOf };
