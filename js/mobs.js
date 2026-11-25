// 夜に来る敵の模型（自作の箱型）。ゾンビ・スケルトン・クモ。
// ゾンビとスケルトンの肌や服は、ここで描く 16px のドット絵（左上が明るく右下が暗い陰で立体に見せる）。
import * as THREE from 'three';
import { pixelTex, px, pixelRng } from './blocks.js';

const M = (c) => new THREE.MeshLambertMaterial({ color: c });
const GLOW = (c) => new THREE.MeshBasicMaterial({ color: c }); // 暗くても見える目
const mats = {
  bone: M(0xe6e0cf), bone2: M(0xc9c2ad), dark: M(0x2a2622),
  sBody: M(0x3b2c2a), sBody2: M(0x2a1f1e), sStripe: M(0xb86a2a), sLeg: M(0x2f2322),
  eyeB: GLOW(0x8fe0ff), eyeR: GLOW(0xff4a3a), eyeZ: GLOW(0x9a2a1e),
  bow: M(0x7a5232), bow2: M(0x5a3a20), string: M(0xeae6da), shaft: M(0xc8a878), tip: M(0x8c9298), feather: M(0xe8e4dc),
  flame: new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.95 }),
  flame2: new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95 }),
  smoke: new THREE.MeshLambertMaterial({ color: 0x55504a, transparent: true, opacity: 0.6 }),
};
function b(w, h, d, m, x, y, z, p) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; }
const pivot = (x, y, z, p) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
const tex = (k, draw) => new THREE.MeshLambertMaterial({ map: pixelTex('mob:' + k, draw) });

// ---------- ゾンビのドット絵 ----------
const SK = ['#7c8b6e', '#738265', '#869578', '#6a795e', '#8f9d80'];   // 緑がかった灰色の肌
const pick = (R, a) => a[Math.floor(R() * a.length)];
function skin(g, R) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, SK));
  for (let k = 0; k < 4; k++) { const x = Math.floor(R() * 13), y = Math.floor(R() * 13); px(g, x, y, '#5d6b52'); px(g, x + 1, y, '#5d6b52'); px(g, x, y + 1, '#56634b'); } // あざ
  for (let i = 0; i < 16; i++) { px(g, i, 0, '#97a589'); px(g, 0, i, '#93a185'); px(g, i, 15, '#55624a'); px(g, 15, i, '#56634b'); }
}
const zSkin = () => tex('zskin', skin);
const zTop = () => tex('ztop', (g, R) => { skin(g, R); for (let k = 0; k < 22; k++) px(g, Math.floor(R() * 16), Math.floor(R() * 16), pick(R, ['#2e2a24', '#3a342c'])); }); // うすい髪
const zFace = () => tex('zface', (g, R) => {
  skin(g, R);
  for (let x = 2; x < 14; x++) px(g, x, 5, '#5a684f'); // まゆの出っぱりの影
  // くぼんだ暗い目（奥に小さく赤黒い点）
  for (const ex of [3, 9]) {
    for (let x = ex; x < ex + 4; x++) for (let y = 6; y < 9; y++) px(g, x, y, '#1b1f17');
    px(g, ex, 6, '#2c3326'); px(g, ex + 3, 8, '#11140e'); px(g, ex + 1, 7, '#5a1a14');
  }
  px(g, 7, 9, '#5d6b52'); px(g, 8, 9, '#5d6b52'); px(g, 7, 10, '#4f5c45'); // 鼻の影
  // 開いた口：中は暗く、上に欠けた歯
  for (let x = 5; x < 11; x++) for (let y = 11; y < 15; y++) px(g, x, y, y === 11 ? '#3a1c18' : '#241010');
  for (const x of [5, 7, 9]) px(g, x, 11, '#cfc6a2');
  px(g, 10, 12, '#bdb48f');
  for (let x = 4; x < 12; x++) px(g, x, 15, '#55624a');
});
// 破れた服：色あせた赤茶。破れ目から肌が見え、すそはぎざぎざ
function rag(g, R, base, hole) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, base));
  for (let y = 2; y < 16; y += 5) for (let x = 0; x < 16; x++) if (R() < 0.5) px(g, x, y, '#00000022');
  for (const [hx, hy, w, h] of hole) {
    for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) if (R() > 0.15) px(g, x, y, pick(R, SK));
    for (let x = hx; x < hx + w; x++) px(g, x, hy - 1, '#2e2018'); // 破れ目のふちの影
    px(g, hx + w, hy, '#2e2018');
  }
  for (let i = 0; i < 16; i++) { px(g, i, 0, '#a0786a'); px(g, i, 15, '#3a2820'); px(g, 15, i, '#3e2c22'); }
}
const SHIRT = ['#7a5444', '#6e4a3c', '#84604e', '#684538'];
const zShirt = () => tex('zshirt', (g, R) => { rag(g, R, SHIRT, [[3, 5, 4, 3], [10, 9, 3, 4], [5, 13, 6, 3]]); for (let x = 0; x < 16; x += 2) if (R() < 0.6) px(g, x, 15, pick(R, SK)); });
const zShirtB = () => tex('zshirtb', (g, R) => rag(g, R, SHIRT, [[8, 3, 3, 3], [2, 11, 4, 4]]));
const PANTS = ['#454052', '#3c3848', '#4e495c', '#37333f'];
const zPants = () => tex('zpants', (g, R) => rag(g, R, PANTS, [[4, 7, 5, 3]]));
const zArm = () => tex('zarm', (g, R) => { skin(g, R); for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) if (y < 4 || R() < 0.5) px(g, x, y, pick(R, SHIRT)); for (let x = 0; x < 16; x++) px(g, x, 0, '#a0786a'); }); // 破れた袖
const six = (side, top, bottom, front, back) => [side, side, top, bottom, front, back || side];

function zombie() {
  const root = new THREE.Group(), body = pivot(0, 0, 0, root);
  const sk = zSkin(), pa = zPants(), sh = zShirt(), shB = zShirtB(), ar = zArm();
  const legL = pivot(0.15, 0.8, 0, body), legR = pivot(-0.15, 0.8, 0, body);
  for (const l of [legL, legR]) { b(0.28, 0.8, 0.28, pa, 0, -0.4, 0, l); b(0.3, 0.1, 0.33, M(0x3a3430), 0, -0.76, 0.03, l); }
  const torso = pivot(0, 0.8, 0, body);
  b(0.58, 0.74, 0.3, six(shB, sh, sh, sh, shB), 0, 0.37, 0, torso);
  // すその垂れた布（ぎざぎざに見えるよう少しずらして傾ける）
  b(0.16, 0.18, 0.04, sh, 0.18, -0.05, 0.15, torso).rotation.z = 0.25;
  b(0.12, 0.14, 0.04, sh, -0.16, -0.03, 0.15, torso).rotation.z = -0.3;
  const head = pivot(0, 0.74, 0, torso);
  b(0.48, 0.48, 0.48, six(sk, zTop(), sk, zFace()), 0, 0.24, 0, head);
  b(0.42, 0.05, 0.05, M(0x66745a), 0, 0.33, 0.26, head); // まゆの出っぱり
  b(0.2, 0.06, 0.08, M(0x6f7e62), 0, 0.02, 0.24, head); // 下がったあご（口が開いている）
  const armL = pivot(0.4, 0.66, 0, torso), armR = pivot(-0.4, 0.66, 0, torso);
  b(0.22, 0.74, 0.22, ar, 0, -0.33, 0, armL); b(0.22, 0.74, 0.22, ar, 0, -0.33, 0, armR);
  b(0.24, 0.16, 0.24, sh, 0, -0.04, 0, armL); // 肩に残った袖
  root.userData.mob = { type: 'zombie', parts: { body, torso, head, armL, armR, legL, legR } };
  return root;
}

// ---------- スケルトン：細い骨と弓。少し離れた所で止まって矢を放つ ----------
function makeBow() {
  const g = new THREE.Group();
  const seg = [[0, 0, 0.12, 0], [0, 0.17, 0.09, 0.35], [0, -0.17, 0.09, -0.35], [0, 0.31, 0.03, 0.75], [0, -0.31, 0.03, -0.75]];
  for (const [x, y, z, r] of seg) b(0.05, 0.18, 0.05, r === 0 ? mats.bow2 : mats.bow, x, y, z, g).rotation.x = -r;
  const s1 = b(0.015, 0.34, 0.015, mats.string, 0, 0.19, -0.03, g), s2 = b(0.015, 0.34, 0.015, mats.string, 0, -0.19, -0.03, g);
  g.userData.string = [s1, s2];
  return g;
}
export function makeArrow() {
  const g = new THREE.Group();
  b(0.035, 0.035, 0.66, mats.shaft, 0, 0, 0, g);
  b(0.07, 0.07, 0.1, mats.tip, 0, 0, 0.36, g);
  b(0.012, 0.09, 0.14, mats.feather, 0, 0, -0.28, g); b(0.09, 0.012, 0.14, mats.feather, 0, 0, -0.28, g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function skeleton() {
  const root = new THREE.Group(), body = pivot(0, 0, 0, root);
  const legL = pivot(0.13, 0.86, 0, body), legR = pivot(-0.13, 0.86, 0, body);
  for (const l of [legL, legR]) { b(0.1, 0.42, 0.1, mats.bone, 0, -0.2, 0, l); b(0.14, 0.08, 0.14, mats.bone2, 0, -0.43, 0, l); b(0.1, 0.4, 0.1, mats.bone, 0, -0.64, 0, l); b(0.16, 0.06, 0.24, mats.bone2, 0, -0.84, 0.04, l); }
  const torso = pivot(0, 0.86, 0, body);
  b(0.38, 0.1, 0.16, mats.bone2, 0, 0.02, 0, torso); // 腰
  b(0.08, 0.66, 0.08, mats.bone, 0, 0.36, -0.06, torso); // 背骨
  for (let i = 0; i < 4; i++) b(0.44 - i * 0.04, 0.06, 0.26, mats.bone, 0, 0.28 + i * 0.13, 0, torso); // あばら
  b(0.56, 0.08, 0.14, mats.bone2, 0, 0.72, 0, torso); // 肩
  const head = pivot(0, 0.78, 0, torso);
  b(0.38, 0.34, 0.36, mats.bone, 0, 0.2, 0, head);
  b(0.3, 0.1, 0.3, mats.bone2, 0, 0.0, 0.03, head); // あご
  b(0.1, 0.08, 0.02, mats.eyeB, 0.09, 0.22, 0.19, head); b(0.1, 0.08, 0.02, mats.eyeB, -0.09, 0.22, 0.19, head);
  b(0.06, 0.06, 0.02, mats.dark, 0, 0.12, 0.19, head);
  const armL = pivot(0.3, 0.7, 0, torso), armR = pivot(-0.3, 0.7, 0, torso);
  for (const a of [armL, armR]) { b(0.08, 0.36, 0.08, mats.bone, 0, -0.18, 0, a); b(0.08, 0.34, 0.08, mats.bone, 0, -0.5, 0.02, a); }
  const bow = makeBow(); bow.position.set(0, -0.66, 0.04); bow.rotation.x = Math.PI / 2; armL.add(bow);
  const nock = makeArrow(); nock.position.set(0, -0.66, -0.26); nock.rotation.x = Math.PI / 2; armR.add(nock); // つがえた矢
  root.userData.mob = { type: 'skeleton', parts: { body, torso, head, armL, armR, legL, legR, bow, nock } };
  return root;
}
// クモ：低くて丸い体に縞の腹、曲がった 8 本足、赤い目が 4 つ
function spider() {
  const root = new THREE.Group(), body = pivot(0, 0.5, 0, root);
  b(0.7, 0.42, 0.6, mats.sBody, 0, 0, 0.28, body); // 頭胸
  const abd = pivot(0, 0.1, -0.32, body);
  b(1.0, 0.7, 0.9, mats.sBody2, 0, 0.05, -0.2, abd);
  for (let i = 0; i < 3; i++) b(1.02, 0.1, 0.12, mats.sStripe, 0, 0.32, -0.5 + i * 0.28, abd);
  for (const [x, y] of [[0.14, 0.08], [-0.14, 0.08], [0.24, -0.02], [-0.24, -0.02]]) b(0.09, 0.09, 0.02, mats.eyeR, x, y, 0.59, body);
  b(0.08, 0.14, 0.08, mats.sLeg, 0.1, -0.2, 0.6, body); b(0.08, 0.14, 0.08, mats.sLeg, -0.1, -0.2, 0.6, body); // きば
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const s = i < 4 ? 1 : -1, k = i % 4;
    const hip = pivot(s * 0.3, 0, 0.42 - k * 0.24, body);
    hip.rotation.y = s * (0.5 - k * 0.32);
    const up = pivot(0, 0, 0, hip); up.rotation.z = s * -0.7;
    b(0.62, 0.08, 0.08, mats.sLeg, s * 0.3, 0, 0, up);
    const low = pivot(s * 0.6, 0, 0, up); low.rotation.z = s * 1.5;
    b(0.6, 0.07, 0.07, mats.sLeg, s * 0.3, 0, 0, low);
    legs.push({ hip, up, low, s, k });
  }
  root.userData.mob = { type: 'spider', parts: { body, abd, legs } };
  return root;
}
export function makeMob(type) { const g = type === 'skeleton' ? skeleton() : type === 'spider' ? spider() : zombie(); g.scale.setScalar(1.7); return g; }

// 朝日で燃える火と煙（ゾンビの子にして一緒に動く）
function burnFx(g, t, k) {
  let F = g.userData.fire;
  if (!F) {
    F = new THREE.Group(); F.userData.parts = [];
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), i % 3 ? mats.flame : mats.flame2); F.add(m); F.userData.parts.push(m); }
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mats.smoke.clone()); F.add(m); F.userData.parts.push(m); }
    g.add(F); g.userData.fire = F;
  }
  F.visible = k > 0 && k < 1;
  const R = pixelRng('fire' + g.id);
  F.userData.parts.forEach((m, i) => {
    const sx = (R() - 0.5) * 0.6, sz = (R() - 0.5) * 0.4, ph = R();
    if (i < 10) { // 炎：体のまわりで上へゆらぐ
      const u = (t * 2.2 + ph) % 1;
      m.position.set(sx, 0.3 + R() * 1.4 + u * 0.5, sz); m.scale.set(1 - u * 0.6, (1 - u) * 1.4 + 0.3, 1 - u * 0.6);
      m.visible = true;
    } else { // 煙：上へのぼって薄くなる
      const u = (t * 0.6 + ph) % 1;
      m.position.set(sx * 1.4, 1.6 + u * 2.2, sz); m.scale.setScalar(0.6 + u * 1.6); m.material.opacity = 0.55 * (1 - u);
    }
  });
}

// mode: 'walk'（近づく）| 'hit'（たたかれてひるむ）| 'flee'（逃げる）| 'burn'（朝日で燃える）| 'shoot'（スケルトンが弓を引いて放つ。k: 0..1 の 1 回分）
export function animateMob(g, mode, t, k = 0) {
  const { type, parts: P } = g.userData.mob;
  const seed = (g.id % 7) * 0.9;
  if (type === 'spider') {
    const sp = mode === 'flee' ? 16 : 9;
    P.legs.forEach((L, i) => { const ph = t * sp + i * 1.7 + seed; L.hip.rotation.x = Math.sin(ph) * 0.35; L.up.rotation.z = L.s * (-0.7 + Math.max(0, Math.cos(ph)) * 0.3); });
    P.body.position.y = 0.5 + Math.abs(Math.sin(t * sp)) * 0.04 + (mode === 'hit' ? Math.sin(k * Math.PI) * 0.35 : 0);
    P.abd.rotation.x = Math.sin(t * 2 + seed) * 0.08;
    P.body.rotation.x = mode === 'hit' ? -0.4 * Math.sin(k * Math.PI) : 0;
  } else if (type === 'zombie') {
    // 腕を前に出し、左右にふらふら揺れながら歩く
    const sp = mode === 'flee' ? 9 : 3.6, still = mode === 'burn';
    const s = still ? 0 : Math.sin(t * sp + seed) * 0.42;
    P.legL.rotation.x = s; P.legR.rotation.x = -s;
    P.armL.rotation.set(-1.45 + Math.sin(t * 2.1 + seed) * 0.12, 0, 0.06); P.armR.rotation.set(-1.32 - Math.sin(t * 1.7 + seed) * 0.14, 0, -0.08);
    P.body.rotation.z = Math.sin(t * sp / 2 + seed) * 0.11;
    P.head.rotation.set(0.1, Math.sin(t * 0.9 + seed) * 0.2, 0.18 + Math.sin(t * 1.3) * 0.08);
    P.body.position.y = Math.abs(Math.cos(t * sp + seed)) * 0.04;
    P.torso.rotation.x = 0.08 + (mode === 'hit' ? -0.55 * Math.sin(k * Math.PI) : 0) + (mode === 'flee' ? 0.2 : 0);
    if (still) { P.armL.rotation.x = -1.0 - Math.sin(t * 9) * 0.5; P.armR.rotation.x = -1.2 + Math.sin(t * 8) * 0.5; P.body.rotation.z = Math.sin(t * 7) * 0.15; } // 燃えてもがく
  } else {
    const sp = mode === 'flee' ? 11 : 6.5;
    const moving = mode === 'walk' || mode === 'flee';
    const s = moving ? Math.sin(t * sp + seed) * 0.6 : 0;
    P.legL.rotation.x = s; P.legR.rotation.x = -s;
    P.body.position.y = moving ? Math.abs(Math.cos(t * sp + seed)) * 0.04 : 0;
    P.torso.rotation.set(0.05 + (mode === 'hit' ? -0.6 * Math.sin(k * Math.PI) : 0) + (mode === 'flee' ? 0.25 : 0), 0, 0);
    P.head.rotation.y = 0; P.body.rotation.y = 0;
    if (mode === 'shoot') {
      // 弓を前へ、右手で弦を引いて（0〜0.6）、放つ（0.6）。少し体を横に向ける
      const pull = k < 0.6 ? Math.min(1, k / 0.5) : Math.max(0, 1 - (k - 0.6) * 6);
      P.body.rotation.y = 0.35; P.head.rotation.y = -0.35;
      P.armL.rotation.set(-1.55, -0.35, 0);
      P.armR.rotation.set(-1.5 + pull * 0.1, 0.45 - pull * 0.35, 0);
      P.armR.position.z = -pull * 0.18;
      const [s1, s2] = P.bow.userData.string;
      const back = -0.03 - pull * 0.2; s1.position.z = back / 2 - 0.015; s2.position.z = back / 2 - 0.015;
      s1.rotation.x = Math.atan2(back + 0.03, 0.34); s2.rotation.x = -Math.atan2(back + 0.03, 0.34);
      P.nock.visible = k < 0.6;
    } else {
      P.armR.position.z = 0;
      P.armL.rotation.set(moving ? -s * 0.6 - 0.3 : -0.4, 0, 0); P.armR.rotation.set(moving ? s * 0.8 : 0.1, 0, 0);
      P.nock.visible = false;
      const [s1, s2] = P.bow.userData.string; s1.position.z = s2.position.z = -0.03; s1.rotation.x = s2.rotation.x = 0;
    }
  }
  g.visible = true;
  if (mode === 'burn') {
    g.scale.setScalar(1.7 * (1 - Math.max(0, k - 0.5) * 1.6)); // 燃えてから、最後に小さくなって消える
    g.position.y = 0;
    burnFx(g, t, k);
  } else if (g.userData.fire) g.userData.fire.visible = false;
}

// 矢の飛び方：放物線で飛んで、地面や柵に刺さる。u: 0..1（1 で刺さる）
export function arrowAt(arrow, from, to, u, arc = 1.6) {
  const k = Math.min(1, u);
  const x = from.x + (to.x - from.x) * k, z = from.z + (to.z - from.z) * k;
  const y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * arc;
  arrow.position.set(x, y, z);
  const dy = (to.y - from.y) + Math.cos(k * Math.PI) * Math.PI * arc, dl = Math.hypot(to.x - from.x, to.z - from.z);
  arrow.rotation.order = 'YXZ';
  arrow.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  arrow.rotation.x = -Math.atan2(dy, dl);
}
