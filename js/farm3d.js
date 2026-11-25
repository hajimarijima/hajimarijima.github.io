// 池・畑の作物・水路・動物の柵・動物（トップの地図と動画で共通）
// 動物は四角い箱を組んだ自作の形。色は面ごとに明・中・暗を分けて、平らに見えないようにする。
import * as THREE from 'three';
import { box, mat, rnd, shade } from './world3d.js';

// ---------- 池 ----------
export function makePond(p) {
  const g = new THREE.Group();
  const R = rnd('pond' + p.x + ',' + p.z);
  const deep = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.72, p.r * 0.72, 0.05, 28), new THREE.MeshLambertMaterial({ color: 0x2f6f9e }));
  deep.position.y = 0.045; deep.receiveShadow = true; g.add(deep);
  const shallow = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.05, 28), new THREE.MeshLambertMaterial({ color: 0x5d9cc4 }));
  shallow.position.y = 0.035; shallow.receiveShadow = true; g.add(shallow);
  const mud = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.55, p.r + 0.7, 0.04, 28), mat(0x8a7a58));
  mud.position.y = 0.02; mud.receiveShadow = true; g.add(mud);
  // ふちの石（明るい上面と暗い側面が分かるよう 2 段）
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + R() * 0.2, r = p.r + 0.35 + R() * 0.35, s = 0.35 + R() * 0.35;
    const st = box(s, 0.2 + R() * 0.15, s * (0.7 + R() * 0.5), [0x8d9196, 0x9fa3a8, 0x7c8085][i % 3], Math.cos(a) * r, 0.1, Math.sin(a) * r, g);
    st.rotation.y = R() * 3;
    if (i % 3 === 0) box(s * 0.6, 0.08, s * 0.5, 0xb4b8bc, Math.cos(a) * r, 0.24, Math.sin(a) * r, g);
  }
  // 葦（あし）と、はすの葉
  for (let i = 0; i < 9; i++) {
    const a = 2.2 + R() * 1.6, r = p.r - 0.2 - R() * 0.4;
    for (let k = 0; k < 3; k++) box(0.06, 0.7 + R() * 0.5, 0.06, k % 2 ? 0x5e8f3a : 0x4c7a2e, Math.cos(a) * r + (k - 1) * 0.12, 0.4, Math.sin(a) * r + R() * 0.1, g);
    if (i % 3 === 0) box(0.1, 0.22, 0.1, 0x6b4a2b, Math.cos(a) * r, 0.95, Math.sin(a) * r, g); // がまの穂
  }
  for (let i = 0; i < 5; i++) {
    const a = R() * Math.PI * 2, r = R() * p.r * 0.7;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 10), mat(i % 2 ? 0x4f8f3a : 0x5fa344));
    pad.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r); g.add(pad);
    if (i === 1) box(0.12, 0.08, 0.12, 0xf3d0dc, pad.position.x, 0.12, pad.position.z, g);
  }
  // 水面のきらめき（時間で動かす）
  const glints = [];
  for (let i = 0; i < 6; i++) { const m = box(0.4, 0.01, 0.06, 0xd8ecf8, 0, 0.075, 0, g); m.castShadow = false; m.userData.ph = R() * 10; m.userData.r = R() * p.r * 0.8; m.userData.a = R() * 6.28; glints.push(m); }
  g.userData.glints = glints;
  g.position.set(p.x, 0, p.z);
  return g;
}
export function animatePond(g, t) {
  for (const m of g.userData.glints || []) {
    const u = (t * 0.35 + m.userData.ph) % 1;
    m.visible = u < 0.6;
    m.position.set(Math.cos(m.userData.a) * m.userData.r, 0.075, Math.sin(m.userData.a) * m.userData.r);
    m.scale.x = 0.4 + Math.sin(u * Math.PI) * 0.9;
  }
}

// うき：赤と白。sink 0..1 で沈む
export function makeBobber() {
  const g = new THREE.Group();
  box(0.16, 0.12, 0.16, 0xf4f4f0, 0, 0.0, 0, g);
  box(0.18, 0.12, 0.18, 0xd83a32, 0, 0.11, 0, g);
  box(0.04, 0.12, 0.04, 0xd83a32, 0, 0.22, 0, g);
  const ring = box(0.5, 0.01, 0.5, 0xbfe0f4, 0, -0.04, 0, g); ring.castShadow = false; g.userData.ring = ring;
  return g;
}

// ---------- 畑の作物（小麦・にんじん・じゃがいも。段階で育つ） ----------
export function makeField(f) {
  const g = new THREE.Group();
  const wet = !!f.water;
  const soil = wet ? 0x5e3f24 : 0x7a5636, ridge = wet ? 0x4a3019 : 0x5f412a, top = wet ? 0x6e4a2c : 0x8c6644;
  box(2.1, 0.08, 2.3, soil, 0, 0.04, 0, g);
  for (let i = 0; i < 3; i++) { box(2.0, 0.12, 0.3, ridge, 0, 0.1, -0.75 + i * 0.75, g); box(2.0, 0.02, 0.18, top, 0, 0.17, -0.78 + i * 0.75, g); }
  const max = f.max || 3, k = Math.min(1, (f.stage || 0) / max), ripe = (f.stage || 0) >= max;
  const crop = f.crop || 'wheat';
  if (f.stage > 0) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const x = -0.75 + j * 0.5, z = -0.75 + i * 0.75, y = 0.17;
      if (crop === 'wheat') {
        const h = 0.15 + k * 0.75, c = ripe ? 0xd9b444 : k > 0.6 ? 0x9cba48 : 0x6dbb4a;
        box(0.06, h, 0.06, c, x - 0.06, y + h / 2, z, g); box(0.06, h * 0.85, 0.06, shade(c, 0.85), x + 0.07, y + h * 0.42, z + 0.05, g);
        if (k > 0.5) { box(0.1, 0.22, 0.1, ripe ? 0xe8c858 : 0xb2c858, x - 0.06, y + h + 0.08, z, g); box(0.09, 0.2, 0.09, ripe ? 0xc89a32 : 0x98b048, x + 0.07, y + h * 0.85 + 0.08, z + 0.05, g); }
      } else if (crop === 'carrot') {
        const h = 0.1 + k * 0.35;
        const a = box(0.22, h, 0.05, 0x5aa83c, x, y + h / 2, z, g); a.rotation.y = 0.6;
        const b = box(0.22, h * 0.9, 0.05, 0x4a8f30, x, y + h * 0.45, z, g); b.rotation.y = -0.6;
        if (k > 0.6) box(0.12, 0.08, 0.12, ripe ? 0xe8742a : 0xc98a3a, x, y + 0.02, z, g); // 土から出たにんじんの頭
      } else {
        const s = 0.12 + k * 0.28;
        box(s, s * 0.7, s, 0x4f8f3a, x, y + s * 0.35, z, g); box(s * 0.7, s * 0.5, s * 0.7, 0x62a548, x + 0.03, y + s * 0.75, z - 0.02, g);
        if (ripe) { box(0.07, 0.07, 0.07, 0xf2f0e6, x, y + s * 1.05, z, g); box(0.14, 0.1, 0.12, 0xb8935a, x + 0.16, y + 0.03, z + 0.12, g); }
      }
    }
  }
  g.position.set(f.x, 0, f.z);
  g.rotation.y = f.rot || 0;
  return g;
}

// ---------- 建物：畑のふち・水路・動物の柵 ----------
export function makeFarm() {
  const g = new THREE.Group();
  const W = 7.6, D = 5.6;
  for (const s of [1, -1]) { box(W, 0.22, 0.18, 0x7a5230, 0, 0.11, s * D / 2, g); box(0.18, 0.22, D, 0x7a5230, s * W / 2, 0.11, 0, g); }
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) box(0.26, 0.5, 0.26, 0x5e3d20, x, 0.25, z, g);
  // かかし（自作の形：麦わら帽子・青い服）
  const sc = new THREE.Group(); sc.position.set(-W / 2 - 0.9, 0, 0); g.add(sc);
  box(0.12, 1.8, 0.12, 0x6b4628, 0, 0.9, 0, sc); box(1.3, 0.1, 0.1, 0x6b4628, 0, 1.45, 0, sc);
  box(0.6, 0.7, 0.32, 0x3f6fa8, 0, 1.35, 0, sc); box(0.62, 0.12, 0.34, 0x2f5585, 0, 1.0, 0, sc);
  box(0.4, 0.4, 0.4, 0xe2cf9a, 0, 1.95, 0, sc); box(0.7, 0.06, 0.7, 0xd8b45a, 0, 2.17, 0, sc); box(0.36, 0.18, 0.36, 0xc89f44, 0, 2.27, 0, sc);
  for (const s of [1, -1]) box(0.1, 0.1, 0.42, 0xd8c070, s * 0.68, 1.42, 0, sc);
  return g;
}
export function makeCanal() {
  const g = new THREE.Group();
  const L = 7.2;
  box(1.6, 0.06, L, 0x8a7a58, 0, 0.03, 0, g);
  const water = box(0.9, 0.05, L, 0x4f8fc0, 0, 0.07, 0, g); water.receiveShadow = true;
  for (const s of [1, -1]) for (let i = 0; i < 8; i++) {
    const z = -L / 2 + (i + 0.5) * (L / 8);
    box(0.36, 0.26, L / 8 - 0.04, i % 2 ? 0x8d9196 : 0x9ea2a7, s * 0.63, 0.13, z, g);
    box(0.38, 0.04, L / 8 - 0.06, 0xb2b6ba, s * 0.63, 0.27, z, g);
  }
  // 水門（板と取っ手）
  box(1.4, 0.7, 0.14, 0x7a5230, 0, 0.35, -L / 2 + 0.3, g); box(0.12, 0.5, 0.12, 0x5e3d20, 0, 0.9, -L / 2 + 0.3, g);
  const flow = [];
  for (let i = 0; i < 5; i++) { const m = box(0.3, 0.01, 0.05, 0xcfe6f6, 0, 0.1, 0, g); m.castShadow = false; m.userData.ph = i / 5; flow.push(m); }
  g.userData.flow = flow; g.userData.len = L;
  return g;
}
export function makePen() {
  const g = new THREE.Group();
  const W = 7.4;
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const u = -W / 2 + (i * W) / n;
    for (const [x, z] of [[u, -W / 2], [u, W / 2], [-W / 2, u], [W / 2, u]]) {
      if (z === W / 2 && Math.abs(x) < 0.6) continue; // 門のすき間
      box(0.18, 1.0, 0.18, 0x7a5230, x, 0.5, z, g); box(0.22, 0.06, 0.22, 0x9b6b3d, x, 1.02, z, g);
    }
  }
  for (const y of [0.45, 0.82]) for (const s of [1, -1]) {
    box(W, 0.1, 0.08, 0xa47a4a, 0, y, -W / 2, g); box(0.08, 0.1, W, 0xa47a4a, s * W / 2, y, 0, g);
    box(W / 2 - 0.6, 0.1, 0.08, 0xa47a4a, s * (W / 4 + 0.3), y, W / 2, g);
  }
  // 水おけ・干し草・えさ箱
  box(1.4, 0.4, 0.5, 0x6b4628, 2.4, 0.2, -2.6, g); box(1.2, 0.06, 0.34, 0x5d9cc4, 2.4, 0.38, -2.6, g);
  box(0.9, 0.6, 0.9, 0xd8b85a, -2.5, 0.3, -2.5, g); box(0.92, 0.08, 0.92, 0xb8963c, -2.5, 0.42, -2.5, g); box(0.7, 0.2, 0.7, 0xe6c86a, -2.5, 0.7, -2.5, g);
  return g;
}

// ---------- 動物（ウシ・ヒツジ・ニワトリ・ブタ） ----------
const leg = (g, x, z, w, h, c, hoof) => { const p = new THREE.Group(); p.position.set(x, h, z); g.add(p); box(w, h, w, c, 0, -h / 2, 0, p); if (hoof) box(w + 0.01, 0.08, w + 0.01, hoof, 0, -h + 0.04, 0, p); return p; };
export function makeAnimal(kind) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const head = new THREE.Group(); body.add(head);
  const legs = [];
  if (kind === 'cow') {
    box(1.5, 0.82, 0.82, 0xe9e3d6, 0, 1.05, 0, body);
    box(1.52, 0.2, 0.84, 0xd4cdbd, 0, 0.7, 0, body); // おなか側は暗く
    for (const [x, y, z, w, h] of [[0.2, 1.25, 0.42, 0.5, 0.4], [-0.45, 1.0, 0.42, 0.4, 0.35], [-0.1, 1.2, -0.42, 0.6, 0.45], [0.5, 0.95, -0.42, 0.3, 0.3], [-0.3, 1.47, 0, 0.5, 0.02]]) box(w, h, 0.02 + (y > 1.4 ? 0.5 : 0), 0x5b3d28, x, y, z * 1.02, body);
    box(0.32, 0.16, 0.36, 0xeaa8a8, -0.35, 0.58, 0, body); // 乳
    head.position.set(0.85, 1.25, 0);
    box(0.52, 0.5, 0.56, 0xe9e3d6, 0.12, 0, 0, head); box(0.2, 0.3, 0.58, 0x5b3d28, 0.02, 0.06, 0, head);
    box(0.2, 0.26, 0.46, 0xe6b4a4, 0.42, -0.1, 0, head); box(0.04, 0.06, 0.08, 0x6b4038, 0.53, -0.06, 0.12, head); box(0.04, 0.06, 0.08, 0x6b4038, 0.53, -0.06, -0.12, head);
    for (const s of [1, -1]) { box(0.1, 0.18, 0.08, 0xd8cfb8, 0.05, 0.32, s * 0.24, head); box(0.08, 0.1, 0.22, 0xe9e3d6, -0.02, 0.1, s * 0.36, head); box(0.07, 0.07, 0.04, 0x1e1e22, 0.39, 0.08, s * 0.2, head); }
    box(0.08, 0.6, 0.08, 0xd4cdbd, -0.78, 1.0, 0, body); box(0.12, 0.14, 0.12, 0x5b3d28, -0.78, 0.68, 0, body);
    for (const [x, z] of [[0.55, 0.28], [0.55, -0.28], [-0.55, 0.28], [-0.55, -0.28]]) legs.push(leg(body, x, z, 0.24, 0.64, 0xd9d2c3, 0x3a2c22));
  } else if (kind === 'sheep') {
    box(1.1, 0.78, 0.86, 0xf1eee6, 0, 0.9, 0, body);
    box(1.12, 0.16, 0.88, 0xd9d4c8, 0, 0.56, 0, body);
    for (const [x, z] of [[0.3, 0.3], [-0.25, -0.25], [0, 0], [-0.35, 0.28], [0.28, -0.3]]) box(0.42, 0.18, 0.42, 0xfbfaf6, x, 1.35, z, body); // 毛のこぶ
    for (const s of [1, -1]) box(0.9, 0.5, 0.1, 0xe4e0d6, -0.05, 0.92, s * 0.47, body);
    head.position.set(0.68, 1.08, 0);
    box(0.36, 0.42, 0.4, 0x3d342e, 0.1, 0, 0, head); box(0.42, 0.2, 0.46, 0xf1eee6, 0.0, 0.22, 0, head);
    box(0.12, 0.14, 0.3, 0x4d433c, 0.3, -0.12, 0, head);
    for (const s of [1, -1]) { box(0.14, 0.08, 0.2, 0x3d342e, 0.0, 0.08, s * 0.3, head); box(0.05, 0.06, 0.04, 0xe8d8a0, 0.29, 0.06, s * 0.14, head); }
    for (const [x, z] of [[0.36, 0.26], [0.36, -0.26], [-0.36, 0.26], [-0.36, -0.26]]) legs.push(leg(body, x, z, 0.16, 0.56, 0x3d342e));
  } else if (kind === 'chicken') {
    box(0.5, 0.42, 0.38, 0xf6f3ea, 0, 0.55, 0, body);
    box(0.52, 0.1, 0.4, 0xdcd6c8, 0, 0.36, 0, body);
    for (const s of [1, -1]) box(0.34, 0.24, 0.06, 0xe6e1d4, -0.04, 0.56, s * 0.21, body); // 羽
    box(0.18, 0.34, 0.3, 0xece8dc, -0.3, 0.78, 0, body); box(0.12, 0.2, 0.2, 0x2f2f33, -0.36, 0.95, 0, body); // 尾
    head.position.set(0.22, 0.86, 0);
    box(0.24, 0.3, 0.24, 0xf6f3ea, 0.02, 0.05, 0, head);
    box(0.14, 0.08, 0.12, 0xe8a030, 0.2, 0.06, 0, head); box(0.06, 0.12, 0.08, 0xd83a32, 0.16, -0.06, 0, head);
    box(0.16, 0.1, 0.06, 0xd83a32, 0.0, 0.25, 0, head); box(0.06, 0.06, 0.04, 0x1e1e22, 0.1, 0.1, 0.12, head); box(0.06, 0.06, 0.04, 0x1e1e22, 0.1, 0.1, -0.12, head);
    for (const z of [0.1, -0.1]) legs.push(leg(body, 0.02, z, 0.06, 0.34, 0xe8a030));
  } else { // pig
    box(1.1, 0.62, 0.66, 0xeca8a4, 0, 0.72, 0, body);
    box(1.12, 0.16, 0.68, 0xd28c8a, 0, 0.45, 0, body);
    box(0.5, 0.06, 0.4, 0xf6c0bc, 0.05, 1.04, 0, body); // 背中の光
    for (const [x, z] of [[-0.2, 0.34], [0.25, -0.34]]) box(0.26, 0.2, 0.02, 0x8a6a5a, x, 0.8, z, body); // どろ
    head.position.set(0.66, 0.8, 0);
    box(0.44, 0.46, 0.54, 0xeca8a4, 0.04, 0, 0, head);
    box(0.14, 0.22, 0.3, 0xf2b8b4, 0.3, -0.06, 0, head); box(0.03, 0.06, 0.06, 0x8a4a4a, 0.38, -0.06, 0.07, head); box(0.03, 0.06, 0.06, 0x8a4a4a, 0.38, -0.06, -0.07, head);
    for (const s of [1, -1]) { const e = box(0.2, 0.06, 0.18, 0xd88e8c, 0.0, 0.26, s * 0.2, head); e.rotation.x = s * 0.4; box(0.06, 0.06, 0.04, 0x1e1e22, 0.27, 0.08, s * 0.16, head); }
    box(0.06, 0.06, 0.16, 0xd88e8c, -0.58, 0.88, 0.0, body); box(0.06, 0.12, 0.06, 0xd88e8c, -0.6, 0.94, 0.08, body); // 巻いたしっぽ
    for (const [x, z] of [[0.36, 0.22], [0.36, -0.22], [-0.36, 0.22], [-0.36, -0.22]]) legs.push(leg(body, x, z, 0.18, 0.42, 0xe29c98, 0x8a5a54));
  }
  g.userData.animal = { kind, body, head, legs, headY: head.position.y };
  return g;
}
// move 0..1（歩いている強さ）、graze 0..1（草を食べる）
export function animateAnimal(g, t, move, graze) {
  const A = g.userData.animal; if (!A) return;
  const sp = A.kind === 'chicken' ? 14 : 7;
  A.legs.forEach((l, i) => { l.rotation.z = Math.sin(t * sp + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5 * move; });
  A.body.position.y = Math.abs(Math.sin(t * sp)) * 0.03 * move;
  A.head.rotation.z = -graze * (A.kind === 'chicken' ? 1.0 : 0.7) + Math.sin(t * 2) * 0.04;
  A.head.position.y = A.headY - graze * (A.kind === 'chicken' ? 0.15 : 0.3);
}
// 動物の歩く道：家の位置のまわりをゆっくり回る（時刻だけで決まるので、動画でも同じ）
export function animalPos(a, t, pen) {
  const ph = (a.id.charCodeAt(1) || 0) * 1.7 + (a.id.length > 2 ? a.id.charCodeAt(2) : 0);
  const R = pen ? 1.0 : 6.5, sp = a.kind === 'chicken' ? 0.5 : 0.24;
  const u = t * sp + ph;
  // 歩く → 止まって草を食べる、をくり返す
  const cyc = (u / 6.28) % 1, walking = cyc < 0.6;
  const w = walking ? cyc / 0.6 : 1;
  const ang = Math.floor(u / 6.28) * 2.4 + ph + w * 2.6;
  const x = a.x + Math.cos(ang) * R * (0.6 + 0.4 * Math.sin(ph)), z = a.z + Math.sin(ang) * R * 0.8;
  // 進む向き（円の接線）。動物の頭は +x 向きなので、+x が接線を向くように回す
  const face = Math.atan2(-Math.cos(ang), -Math.sin(ang));
  const graze = walking ? 0 : Math.min(1, (cyc - 0.55) / 0.08) * (cyc > 0.95 ? (1 - cyc) / 0.05 : 1);
  return { x, z, face, move: walking ? 1 : 0, graze };
}
