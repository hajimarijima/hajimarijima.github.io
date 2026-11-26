// 夜の魔物（3 つ目の大きな島に、夜だけ出る）。箱を組んだ自作の形 3 種。頭は +x 向き（foemove.js・animalmove.js と同じ）。
//   どろんこ：泥のかたまりの体にこけが生えた、腕の長いずんぐりした魔物（黄色い目）
//   かげオオカミ：むらさきの影の四つ足。背中に光る水晶のとげ（水色の目）
//   おばけキノコ：大きなかさに光る点がある、歩くキノコ（緑の目）
// 体は上の面が明るく、下や影は暗い色の箱を重ねて立体に見せる。夜でも形が分かるよう、体はほんのり自分で光る（emissive）。
// 朝は土にもぐって煙になる（煙は makeFoeSmoke / smokeAt）。
import * as THREE from 'three';
import { box, shade } from './world3d.js';
import { FOE_SCALE } from './foemove.js'; // 大きさの倍率（歩ける所の体の大きさと同じ）

const lam = new Map();
// 夜に少しだけ見える体の色（emissive は色の 18%）
const bodyMat = (c, glow = 0.18) => { const k = c + ':' + glow; if (!lam.has(k)) lam.set(k, new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(glow) })); return lam.get(k); };
const glowMat = (c) => { const k = 'g' + c; if (!lam.has(k)) lam.set(k, new THREE.MeshBasicMaterial({ color: c })); return lam.get(k); };
const haloMat = (c) => { const k = 'h' + c; if (!lam.has(k)) lam.set(k, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })); return lam.get(k); };
const B = (w, h, d, c, x, y, z, p, glow) => box(w, h, d, bodyMat(c, glow), x, y, z, p);
// 光る目：芯（明るい）と、まわりのうすい光
function eyes(p, c, x, y, zs, s = 0.18) {
  for (const z of zs) {
    box(0.06, s, s, glowMat(c), x, y, z, p).castShadow = false;
    const h = box(0.04, s * 2.1, s * 2.1, haloMat(c), x + 0.03, y, z, p); h.castShadow = false; h.receiveShadow = false;
  }
}
const limb = (p, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };

function mud() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  // ぬれた泥：こげ茶の地に、明るいてかり（ぬれた所）と暗いくぼみ。四角い箱に見えないよう、
  //   体は「十字に重ねた段」を下から上へ積んだ丸いかたまり（角が段々にけずれる）。下のふちから泥がたれ、足もとに泥だまり
  const C = 0x6b4a2c, D = shade(C, 0.66), L = 0x9a7048, WET = 0xb48a5c, MOSS = 0x5b8a3c, MOSSL = 0x7aab50;
  const blob = (w, h, y, c, x = 0, p = body) => { B(w, h, w * 0.7, c, x, y, 0, p); B(w * 0.7, h, w, c, x, y, 0, p); B(w * 0.86, h, w * 0.86, c, x, y, 0, p); };
  const legs = [];
  for (const z of [0.36, -0.36]) { const l = limb(body, 0, 0.6, z); blob(0.46, 0.6, -0.3, D, 0, l); blob(0.56, 0.12, -0.55, shade(C, 0.55), 0.04, l); legs.push(l); }
  // 体：下から上へ（幅, 高さ, y）。まん中がいちばん太く、上は頭のふくらみ
  [[1.15, 0.22, 0.66, D], [1.45, 0.28, 0.9], [1.6, 0.34, 1.2], [1.6, 0.3, 1.52], [1.45, 0.26, 1.8], [1.22, 0.22, 2.04, L], [0.9, 0.16, 2.23, L], [0.52, 0.12, 2.37, L]]
    .forEach(([w, h, y, c]) => blob(w, h, y, c || C));
  // ぬれたてかり（前と上の明るい点）と、暗いくぼみ
  for (const [x, y, z, s] of [[0.62, 1.95, 0.32, 0.18], [0.5, 2.15, -0.28, 0.14], [0.72, 1.3, -0.45, 0.16], [0.1, 2.34, 0.12, 0.2], [-0.5, 1.6, 0.6, 0.16]]) B(s, s * 0.5, s, WET, x, y, z, body, 0.3);
  for (const [x, y, z] of [[0.78, 0.98, 0.18], [-0.78, 1.4, -0.3], [0.2, 1.1, 0.79]]) B(0.1, 0.22, 0.22, D, x, y, z, body);
  // こけ（頭と肩）
  B(0.5, 0.1, 0.42, MOSS, -0.08, 2.46, 0.08, body); B(0.26, 0.1, 0.26, MOSSL, 0.1, 2.52, -0.12, body); B(0.3, 0.12, 0.26, MOSS, -0.32, 2.12, 0.5, body); B(0.18, 0.18, 0.06, MOSSL, -0.1, 2.6, 0.0, body);
  // 下のふちからたれる泥（長さちがい）と、足もとの泥だまり
  const drips = [];
  for (const [x, z, h] of [[0.7, 0.42, 0.42], [0.74, -0.36, 0.3], [0.2, 0.74, 0.5], [-0.42, 0.62, 0.36], [-0.7, -0.2, 0.44], [0.1, -0.76, 0.34], [-0.2, -0.7, 0.26]]) {
    const d = B(0.13, h, 0.13, D, x, 0.62 - h / 2 + 0.06, z, body); drips.push({ m: d, h, y: 0.62 - h / 2 + 0.06 }); B(0.17, 0.08, 0.17, C, x, 0.62 - h + 0.06, z, body);
  }
  const pud = new THREE.Group(); g.add(pud);
  B(1.7, 0.03, 1.1, 0x3a2716, 0, 0.015, 0, pud); B(1.2, 0.03, 1.6, 0x3a2716, 0, 0.015, 0, pud); B(0.5, 0.035, 0.4, 0x6e5034, 0.4, 0.02, 0.35, pud);
  // 顔：口はたれ下がったへの字、光る目
  B(0.06, 0.1, 0.4, 0x1e140a, 0.81, 1.38, 0, body); B(0.06, 0.1, 0.12, 0x1e140a, 0.81, 1.3, 0.24, body); B(0.06, 0.1, 0.12, 0x1e140a, 0.81, 1.3, -0.24, body);
  eyes(body, 0xffd34a, 0.79, 1.78, [0.3, -0.3], 0.2);
  const arms = [];
  for (const z of [0.9, -0.9]) {
    const a = limb(body, 0, 1.78, z);
    blob(0.42, 0.42, -0.18, C, 0, a); blob(0.36, 0.44, -0.6, C, 0.02, a); blob(0.44, 0.36, -1.0, D, 0.04, a); // 肩・うで・手のかたまり
    for (const [dx, dz, h] of [[0.12, 0.08, 0.3], [-0.06, -0.1, 0.22], [0.04, 0.12, 0.18]]) B(0.09, h, 0.09, D, 0.04 + dx, -1.18 - h / 2, dz, a); // 手からたれる泥
    arms.push(a);
  }
  g.userData.foe = { kind: 'mud', body, legs, arms, drips, pud, h: 2.6 };
  return g;
}

function wolf() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const C = 0x2f2a48, D = shade(C, 0.7), L = shade(C, 1.35), CR = 0x8f6bff, CRL = 0xc2adff;
  const legs = [];
  for (const [x, z] of [[0.75, 0.32], [0.75, -0.32], [-0.75, 0.32], [-0.75, -0.32]]) { const l = limb(body, x, 0.95, z); B(0.26, 0.9, 0.26, D, 0, -0.45, 0, l); B(0.32, 0.12, 0.3, shade(C, 0.5), 0.05, -0.88, 0, l); legs.push(l); }
  B(2.0, 0.8, 0.86, C, 0, 1.3, 0, body); B(1.8, 0.16, 0.7, L, 0, 1.76, 0, body); B(2.02, 0.14, 0.88, D, 0, 0.9, 0, body);
  B(0.7, 0.86, 0.96, C, 0.75, 1.36, 0, body); // 胸の毛（ふくらみ）
  const head = new THREE.Group(); head.position.set(1.2, 1.62, 0); body.add(head);
  B(0.66, 0.6, 0.66, C, 0.2, 0, 0, head); B(0.5, 0.3, 0.42, L, 0.66, -0.12, 0, head); B(0.12, 0.12, 0.16, 0x111018, 0.92, -0.05, 0, head); // 鼻先
  B(0.52, 0.1, 0.4, shade(C, 0.55), 0.62, -0.31, 0, head); // 下あご
  for (const z of [0.2, -0.2]) { B(0.16, 0.34, 0.12, D, 0.08, 0.44, z, head); B(0.08, 0.18, 0.06, CR, 0.1, 0.42, z, head, 0.7); }
  eyes(head, 0x6ff3ff, 0.54, 0.1, [0.19, -0.19], 0.13);
  // 背中の水晶のとげ（前から後ろへ低くなる）
  [[0.5, 0.55], [0.1, 0.7], [-0.32, 0.6], [-0.72, 0.45]].forEach(([x, h], i) => {
    B(0.24, h, 0.24, i % 2 ? CR : CRL, x, 1.82 + h / 2, 0, body, 0.75);
    B(0.12, h * 0.5, 0.12, CRL, x - 0.04, 1.82 + h + h * 0.18, 0, body, 0.9);
  });
  const tail = limb(body, -1.0, 1.55, 0); B(0.7, 0.24, 0.24, C, -0.35, 0.1, 0, tail); B(0.22, 0.3, 0.14, CR, -0.62, 0.32, 0, tail, 0.75);
  g.userData.foe = { kind: 'wolf', body, legs, head, tail, h: 2.5 };
  return g;
}

function shroom() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const ST = 0xd9ccb0, STD = shade(ST, 0.7), CAP = 0x6e2a63, CAPD = shade(CAP, 0.65), CAPL = shade(CAP, 1.3), SPOT = 0xd6ff8a;
  const legs = [];
  for (const z of [0.3, -0.3]) { const l = limb(body, 0, 0.5, z); B(0.32, 0.5, 0.32, STD, 0, -0.25, 0, l); B(0.4, 0.12, 0.38, shade(ST, 0.5), 0.05, -0.45, 0, l); legs.push(l); }
  B(0.95, 1.1, 0.95, ST, 0, 1.05, 0, body); B(0.99, 0.14, 0.99, STD, 0, 0.52, 0, body);
  eyes(body, 0x9dff6a, 0.49, 1.25, [0.2, -0.2], 0.16);
  B(0.05, 0.1, 0.3, 0x3a2a20, 0.49, 0.9, 0, body); // 口
  const arms = [];
  for (const z of [0.56, -0.56]) { const a = limb(body, 0, 1.3, z); B(0.2, 0.62, 0.2, STD, 0, -0.28, 0, a); arms.push(a); }
  // かさ：3 段（下が広く、上が明るい）。うらは暗いひだ
  const cap = new THREE.Group(); cap.position.set(0, 1.7, 0); body.add(cap);
  B(2.1, 0.14, 2.1, CAPD, 0, 0, 0, cap); B(1.95, 0.4, 1.95, CAP, 0, 0.27, 0, cap); B(1.45, 0.3, 1.45, CAPL, 0, 0.62, 0, cap); B(0.8, 0.18, 0.8, CAPL, 0, 0.86, 0, cap);
  for (const [x, z, y] of [[0.6, 0.55, 0.48], [-0.5, 0.65, 0.48], [0.1, -0.7, 0.48], [-0.7, -0.35, 0.48], [0.35, -0.1, 0.78], [-0.25, 0.25, 0.78], [0.98, -0.3, 0.27], [-0.98, 0.2, 0.27]]) {
    const s = box(0.24, 0.08, 0.24, glowMat(SPOT), x, y, z, cap); s.castShadow = false;
    if (Math.abs(x) > 0.95) { s.scale.set(0.35, 2.4, 1); }
  }
  // 前の印：かさの前のふちが少しとがって前へ出て、上に前向きの「く」の字の光る線（上から見ても向きが分かる）
  B(0.5, 0.14, 0.9, CAPD, 1.2, 0, 0, cap); B(0.4, 0.3, 0.7, CAP, 1.12, 0.22, 0, cap); B(0.3, 0.12, 0.4, CAPD, 1.48, -0.01, 0, cap);
  for (const [x, z, ry] of [[0.62, 0.22, 0.9], [0.62, -0.22, -0.9]]) { const m = box(0.42, 0.06, 0.1, glowMat(SPOT), x, 0.98 - Math.abs(x) * 0.05, z, cap); m.rotation.y = ry; m.castShadow = false; }
  B(0.36, 0.22, 0.6, ST, 0.62, 1.05, 0, body); // 柄の前のふくらみ（顔のある向き）
  eyes(body, 0x9dff6a, 0.81, 1.22, [0.17, -0.17], 0.15);
  g.userData.foe = { kind: 'shroom', body, legs, arms, cap, h: 2.6 };
  return g;
}

export { FOE_SCALE };
export function makeFoe(kind) {
  const g = kind === 'wolf' ? wolf() : kind === 'shroom' ? shroom() : mud();
  g.scale.setScalar(FOE_SCALE);
  return g;
}

// move 0..1（歩く速さの割合）。t は秒
export function animateFoe(g, t, move) {
  const F = g.userData.foe; if (!F) return;
  const sw = Math.sin(t * (F.kind === 'wolf' ? 9 : 6)) * move;
  if (F.kind === 'wolf') {
    F.legs.forEach((l, i) => { l.rotation.z = sw * 0.55 * ((i === 0 || i === 3) ? 1 : -1); }); // 対角の脚がいっしょ
    F.body.position.y = Math.abs(Math.sin(t * 9)) * 0.06 * move;
    F.head.rotation.z = Math.sin(t * 1.3) * 0.08 - 0.05; F.head.rotation.y = Math.sin(t * 0.7) * 0.15 * (1 - move);
    F.tail.rotation.z = 0.25 + Math.sin(t * 3) * 0.15; F.tail.rotation.y = Math.sin(t * 4) * 0.3;
  } else {
    F.legs.forEach((l, i) => { l.rotation.z = sw * 0.5 * (i ? -1 : 1); });
    (F.arms || []).forEach((a, i) => { a.rotation.z = -sw * 0.35 * (i ? -1 : 1) + (F.kind === 'mud' ? 0.12 : 0.2); a.rotation.x = (i ? -1 : 1) * (0.08 + Math.sin(t * 1.7 + i) * 0.04); });
    F.body.rotation.x = Math.sin(t * 6) * 0.05 * move; // 左右にゆれて歩く
    F.body.position.y = Math.abs(Math.sin(t * 6)) * 0.05 * move;
    if (F.cap) F.cap.rotation.x = Math.sin(t * 6) * 0.04 * move + Math.sin(t * 1.1) * 0.02;
    // どろんこ：腕を大きく前後にふり、たれた泥がのびちぢみする（上のはしは体についたまま）
    if (F.kind === 'mud') {
      F.arms.forEach((a, i) => { a.rotation.z = -Math.sin(t * 6) * (0.15 + 0.4 * move) * (i ? -1 : 1) + 0.1; });
      F.drips.forEach((d, i) => { const s = 1 + 0.3 * Math.sin(t * 2.3 + i * 1.7); d.m.scale.y = s; d.m.position.y = d.y + d.h / 2 - (d.h * s) / 2; });
    }
  }
}

// 朝に土へもぐる時の煙（灰色の箱が広がって上り、消える）。k 0..1
export function makeFoeSmoke() {
  const g = new THREE.Group(), puffs = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: i % 3 ? 0x8a8794 : 0xb3b0bb, transparent: true, opacity: 0.8, depthWrite: false }));
    const a = (i / 9) * Math.PI * 2;
    m.userData.dir = { x: Math.cos(a), z: Math.sin(a), up: 0.6 + (i % 3) * 0.45 };
    m.castShadow = false; g.add(m); puffs.push(m);
  }
  g.visible = false; g.userData.puffs = puffs;
  return g;
}
export function smokeAt(g, k) {
  g.visible = k > 0 && k < 1;
  if (!g.visible) return;
  for (const m of g.userData.puffs) {
    const d = m.userData.dir, r = 0.3 + k * 1.3;
    m.position.set(d.x * r, 0.3 + d.up * k * 2.2, d.z * r);
    m.scale.setScalar(0.6 + k * 1.2); m.rotation.y = k * 2 + d.up;
    m.material.opacity = 0.8 * (1 - k);
  }
}
