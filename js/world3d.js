// 町の地面・木・岩・建物を作る道具（トップの地図と動画で共通）
import * as THREE from 'three';
import { makeTree as treeModel, makeRock as rockModel } from './blocks.js';
import { makeFarm, makeCanal, makePen } from './farm3d.js';

// ---------- 小さな道具 ----------
const matCache = {};
export const mat = (c) => matCache[c] || (matCache[c] = new THREE.MeshLambertMaterial({ color: c }));
export function box(w, h, d, color, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'object' ? color : mat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rnd(seed) { let a = hash(String(seed)); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 夜に光る物（窓・たいまつ・街灯）。daynight.js が emissive を変える
export const WINDOW_MAT = new THREE.MeshLambertMaterial({ color: 0xfff1b8 });
export const TORCH_MAT = new THREE.MeshLambertMaterial({ color: 0xffa040, emissive: 0x000000 });
export const LAMP_MAT = new THREE.MeshLambertMaterial({ color: 0xfff3a0 });
export const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return c.getHex(); };

// ---------- 地形・自然 ----------
// 木と岩は前の形（blocks.js）。岩はたたくたびに一段ずつ小さくなり、木は倒れて切り株が残る
export const makeTree = (t) => treeModel(t);
export const makeRock = (r) => rockModel(r);
export function makeBush(b) {
  const g = new THREE.Group();
  box(1.4, 0.9, 1.4, 0x4a8a3c, 0, 0.45, 0, g);
  box(0.9, 0.5, 0.9, 0x5a9c46, 0.2, 1.0, -0.1, g);
  if (b.ready) {
    const R = rnd(b.id);
    for (let i = 0; i < 6; i++) box(0.16, 0.16, 0.16, 0xc8323c, (R() - 0.5) * 1.3, 0.3 + R() * 0.8, 0.72 * (R() > 0.5 ? 1 : -1), g);
  }
  g.position.set(b.x, 0, b.z);
  return g;
}
export function makeField(f) {
  const g = new THREE.Group();
  box(3.1, 0.08, 3.1, 0x7a5636, 0, 0.04, 0, g).receiveShadow = true;
  for (let i = 0; i < 4; i++) box(3.0, 0.1, 0.22, 0x5f412a, 0, 0.08, -1.2 + i * 0.8, g);
  if (f.stage > 0) {
    const h = [0, 0.2, 0.45, 0.6][f.stage];
    const c = f.stage >= 3 ? 0xd8b84a : 0x6dbb4a;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) box(0.22, h, 0.22, c, -1.1 + j * 0.73, 0.1 + h / 2, -1.2 + i * 0.8, g);
  }
  g.position.set(f.x, 0, f.z);
  return g;
}

// ---------- 建物 ----------
function roof(g, kind, w, d, rh, color, y) {
  if (kind === 'flat') { box(w + 0.3, 0.3, d + 0.3, color, 0, y + 0.15, 0, g); return; }
  const p = new THREE.Group(); p.position.y = y; g.add(p);
  if (kind === 'pyramid') {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.7072, 1, 4), mat(color));
    m.rotation.y = Math.PI / 4; m.position.y = 0.5; m.castShadow = true; p.add(m);
    p.scale.set(w * 1.15, rh, d * 1.15);
  } else { // 切妻
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.577, 0.577, 1, 3), mat(color));
    m.rotation.x = -Math.PI / 2; m.rotation.y = 0; m.position.y = 0.2887; m.castShadow = true;
    const q = new THREE.Group(); q.rotation.y = Math.PI / 2; q.add(m); p.add(q);
    p.scale.set(w * 1.12, rh / 0.866, d * 1.1);
  }
}
function windows(g, w, d, h, floors, color = WINDOW_MAT) {
  for (let f = 0; f < floors; f++) {
    const y = (h / floors) * (f + 0.62);
    const n = Math.max(1, Math.floor(w / 1.6));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      if (f === 0 && Math.abs(x) < 0.6) continue; // 扉の所
      box(0.5, 0.5, 0.05, color, x, y, d / 2 + 0.02, g);
      box(0.5, 0.5, 0.05, color, x, y, -d / 2 - 0.02, g);
    }
    box(0.05, 0.5, 0.5, color, w / 2 + 0.02, y, 0, g);
    box(0.05, 0.5, 0.5, color, -w / 2 - 0.02, y, 0, g);
  }
}
const ROOF_VARIANTS = [0xb5523b, 0x3f6e8c, 0x6a8a3c, 0x8c4a7a];
export function makeHouse(L, b) {
  const g = new THREE.Group();
  const { w, d, h } = L;
  const floors = L.floors || 1;
  if (L.base) box(w + 0.2, 0.4, d + 0.2, L.base, 0, 0.2, 0, g);
  box(w, h, d, L.wall, 0, h / 2, 0, g);
  if (L.log) for (let y = 0.3; y < h; y += 0.4) { box(w + 0.08, 0.08, 0.08, shade(L.wall, 0.75), 0, y, d / 2 + 0.03, g); box(0.08, 0.08, d + 0.08, shade(L.wall, 0.75), w / 2 + 0.03, y, 0, g); box(0.08, 0.08, d + 0.08, shade(L.wall, 0.75), -w / 2 - 0.03, y, 0, g); }
  // 角の柱
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.18, h, 0.18, shade(L.wall, 0.7), sx * w / 2, h / 2, sz * d / 2, g);
  box(0.8, 1.3, 0.08, 0x5a3a22, 0, 0.65, d / 2 + 0.04, g); // 扉
  // 扉の横のたいまつ（夜に光る）
  box(0.08, 0.4, 0.08, 0x6b4628, 0.7, 1.35, d / 2 + 0.12, g); box(0.16, 0.18, 0.16, TORCH_MAT, 0.7, 1.62, d / 2 + 0.12, g).castShadow = false;
  (g.userData.lights = g.userData.lights || []).push({ x: 0.7, y: 1.8, z: d / 2 + 0.5 });
  windows(g, w, d, h, floors);
  if (floors > 1) for (let f = 1; f < floors; f++) box(w + 0.1, 0.12, d + 0.1, shade(L.wall, 0.8), 0, (h / floors) * f, 0, g);
  const roofColor = L.varyRoof ? ROOF_VARIANTS[(b.variant || 0) % ROOF_VARIANTS.length] : L.roof;
  roof(g, L.roofType || 'gable', w, d, Math.min(w, d) * 0.55, roofColor, h);
  if (L.chimney) box(0.5, 1.4, 0.5, 0x7d6a5c, w * 0.28, h + 0.9, -d * 0.2, g);
  if (L.awning) { const a = box(w * 0.8, 0.12, 1.0, L.awning, 0, 1.9, d / 2 + 0.5, g); a.rotation.x = 0.3; for (let i = 0; i < 2; i++) { const s = box(w * 0.16, 0.13, 1.0, 0xfaf6ee, -w * 0.16 + i * w * 0.32, 1.91, d / 2 + 0.5, g); s.rotation.x = 0.3; } }
  if (L.props === 'crates') { box(0.7, 0.7, 0.7, 0xa47a4a, w / 2 + 0.6, 0.35, d / 2 - 0.4, g); box(0.6, 0.6, 0.6, 0x93693c, w / 2 + 0.5, 1.0, d / 2 - 0.4, g); }
  if (L.props === 'workbench') { box(1.4, 0.7, 0.7, 0x8a5a33, -w / 2 - 0.9, 0.35, d / 2 - 0.6, g); }
  if (L.props === 'anvil') { // 金床（台・くびれ・上の打つ面と角）。鍛冶職人は前（+z）に立って打つ
    const ax = w / 2 + 0.75, az = d / 2 + 0.2;
    // 村人（背の高さ約 3.8）のももの高さ（打つ面 1.45）。金づちが打つ面に届く高さ
    box(0.9, 0.3, 0.6, 0x2e2e32, ax, 0.15, az, g); box(0.48, 0.82, 0.38, 0x3a3a3e, ax, 0.71, az, g);
    box(1.3, 0.34, 0.56, 0x46464c, ax, 1.28, az, g); box(0.3, 0.24, 0.32, 0x46464c, ax - 0.78, 1.32, az, g);
    box(1.31, 0.03, 0.57, 0x8a8f96, ax, 1.46, az, g); // 打つ面の光
  }
  if (L.props === 'nets') { box(0.08, 1.4, 0.08, 0x6b4a2b, w / 2 + 0.8, 0.7, 0, g); box(0.05, 0.9, 1.6, 0x9fb8a0, w / 2 + 0.8, 0.9, 0, g); }
  if (L.bell) { box(0.8, 1.0, 0.8, L.wall, 0, h + Math.min(w, d) * 0.55 + 0.2, 0, g); box(0.4, 0.4, 0.4, 0xd4af37, 0, h + Math.min(w, d) * 0.55 + 0.3, 0, g); }
  if (L.spire) { const s = new THREE.Group(); box(1.6, 3, 1.6, L.wall, 0, h + 1.5, d / 2 - 0.8, s); roof(s, 'pyramid', 1.6, 1.6, 2.4, L.roof, h + 3); s.position.z = 0; g.add(s); }
  if (L.columns) for (let i = 0; i < 5; i++) box(0.35, h, 0.35, 0xffffff, -w / 2 + 0.6 + i * (w - 1.2) / 4, h / 2, d / 2 + 0.5, g);
  if (L.clockFront) { box(1, 1, 0.1, 0xffffff, 0, h + 0.6, d / 2 + 0.1, g); }
  if (L.steam) g.userData.steam = { x: 0, y: h + 1, z: 0 };
  if (L.smoke) g.userData.steam = { x: w * 0.28, y: h + 1.8, z: -d * 0.2, dark: true };
  if (L.chimney && !g.userData.steam) g.userData.steam = { x: w * 0.28, y: h + 1.8, z: -d * 0.2, dark: true, thin: true };
  return g;
}
export function makeTower(L) {
  const g = new THREE.Group();
  const { w, h } = L;
  if (L.stripes) { const n = 5; for (let i = 0; i < n; i++) box(w - i * 0.1, h / n, w - i * 0.1, i % 2 ? L.stripes : L.wall, 0, h / n * (i + 0.5), 0, g); }
  else box(w, h, w, L.wall, 0, h / 2, 0, g);
  for (let y = 1.5; y < h - 1; y += 2) { box(0.4, 0.6, 0.05, 0x3a3a46, 0, y, w / 2 + 0.02, g); }
  box(0.8, 1.3, 0.06, 0x5a3a22, 0, 0.65, w / 2 + 0.03, g);
  if (L.clock) { for (const s of [1, -1]) { box(1.6, 1.6, 0.1, 0xfaf6e8, 0, h - 1.2, s * (w / 2 + 0.05), g); const hand = box(0.1, 0.6, 0.06, 0x222222, 0, h - 1.0, s * (w / 2 + 0.12), g); g.userData.clockHand = (g.userData.clockHand || []).concat(hand); } }
  if (L.light) { box(w * 0.8, 0.9, w * 0.8, LAMP_MAT, 0, h + 0.45, 0, g); g.userData.lamp = true; }
  if (L.dome) { const m = new THREE.Mesh(new THREE.SphereGeometry(w * 0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(L.roof)); m.position.y = h; m.castShadow = true; g.add(m); }
  else roof(g, 'pyramid', w, w, w * 0.9, L.roof, h + (L.light ? 0.9 : 0));
  return g;
}
export function makeSpecial(kind, b) {
  const g = new THREE.Group();
  if (kind === 'plaza') {
    box(9, 0.1, 9, 0xc9c0ad, 0, 0.05, 0, g).receiveShadow = true;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) box(1.05, 0.11, 1.05, 0xbab09b, -3.95 + i * 1.13, 0.06, -3.95 + j * 1.13, g);
    box(2.2, 0.5, 2.2, 0x9ca3a8, 0, 0.3, 0, g); box(1.8, 0.1, 1.8, 0x6fb4d8, 0, 0.56, 0, g); box(0.4, 1.2, 0.4, 0x9ca3a8, 0, 0.9, 0, g);
    for (const [x, z, r] of [[3, 0, 0], [-3, 0, 0], [0, 3, Math.PI / 2], [0, -3, Math.PI / 2]]) { const s = box(1.4, 0.4, 0.5, 0x8a5a33, x, 0.35, z, g); s.rotation.y = r; }
    g.userData.water = true;
  } else if (kind === 'well') {
    box(1.6, 0.8, 1.6, 0x9ca3a8, 0, 0.4, 0, g); box(1.2, 0.1, 1.2, 0x3d6f8f, 0, 0.82, 0, g);
    box(0.15, 1.6, 0.15, 0x7a5230, 0.7, 1.4, 0, g); box(0.15, 1.6, 0.15, 0x7a5230, -0.7, 1.4, 0, g);
    roof(g, 'gable', 1.8, 1.4, 0.7, 0x8a4a32, 2.2);
  } else if (kind === 'garden') {
    box(4, 0.1, 3, 0x6a9a3a, 0, 0.05, 0, g);
    const R = rnd(b.id); const cols = [0xe2507a, 0xf2d24a, 0xffffff, 0x9a6ad2, 0xf28a3a];
    for (let i = 0; i < 28; i++) box(0.22, 0.4, 0.22, cols[i % cols.length], (R() - 0.5) * 3.6, 0.25, (R() - 0.5) * 2.6, g);
  } else if (kind === 'onsen') {
    box(6, 0.5, 4.6, 0x8d8b86, 0, 0.25, 0, g); box(5, 0.1, 3.6, 0x7fd0d8, 0, 0.52, 0, g);
    const R = rnd('onsen'); for (let i = 0; i < 10; i++) box(0.7, 0.5 + R() * 0.3, 0.7, 0x7c7a76, (R() - 0.5) * 6, 0.4, R() > 0.5 ? 2.4 : -2.4, g);
    const hut = makeHouse({ w: 2.4, d: 2, h: 1.8, wall: '#c9a777', roof: '#4a3b2b', roofType: 'gable' }, b); hut.position.set(-3.6, 0, -1.4); g.add(hut);
    g.userData.steam = { x: 0, y: 1, z: 0, wide: true };
  } else if (kind === 'dock') {
    box(2.6, 0.2, 8, 0x8a6a48, 0, 0.35, 3, g);
    for (let i = 0; i < 5; i++) { box(0.25, 1.4, 0.25, 0x5e4026, 1.2, 0, i * 2 - 0.5, g); box(0.25, 1.4, 0.25, 0x5e4026, -1.2, 0, i * 2 - 0.5, g); }
    const boat = new THREE.Group(); box(1.4, 0.5, 3.2, 0xa0522d, 0, 0, 0, boat); box(1.1, 0.1, 2.8, 0xd2b48c, 0, 0.25, 0, boat); box(0.08, 2.2, 0.08, 0x5e4026, 0, 1.2, 0.2, boat); box(0.05, 1.4, 1.2, 0xf4f0e6, 0, 1.4, 0.8, boat);
    boat.position.set(2.6, 0.05, 4.5); g.add(boat); g.userData.boat = boat;
  } else if (kind === 'farm') { g.add(makeFarm());
  } else if (kind === 'canal') { const c = makeCanal(); g.add(c); g.userData.canal = c;
  } else if (kind === 'pen') { g.add(makePen());
  } else if (kind === 'windmill') {
    const t = makeTower({ w: 3, h: 5, wall: '#efe6d2', roof: '#7a3b2e' }); g.add(t);
    const hub = new THREE.Group(); hub.position.set(0, 4.4, 1.7); g.add(hub);
    for (let i = 0; i < 4; i++) { const arm = new THREE.Group(); arm.rotation.z = (i * Math.PI) / 2; box(0.25, 3.2, 0.1, 0x8a5a33, 0, 1.7, 0, arm); box(0.9, 2.6, 0.05, 0xf4f0e6, 0.55, 1.9, 0.02, arm); hub.add(arm); }
    g.userData.blades = hub;
  } else if (kind === 'ranch') {
    const W = 9, D = 6;
    for (let i = 0; i <= 9; i++) { box(0.15, 0.9, 0.15, 0x8a5a33, -W / 2 + i, 0.45, D / 2, g); box(0.15, 0.9, 0.15, 0x8a5a33, -W / 2 + i, 0.45, -D / 2, g); }
    for (let i = 0; i <= 6; i++) { box(0.15, 0.9, 0.15, 0x8a5a33, -W / 2, 0.45, -D / 2 + i, g); box(0.15, 0.9, 0.15, 0x8a5a33, W / 2, 0.45, -D / 2 + i, g); }
    for (const z of [D / 2, -D / 2]) box(W, 0.1, 0.08, 0xa47a4a, 0, 0.7, z, g);
    for (const x of [W / 2, -W / 2]) box(0.08, 0.1, D, 0xa47a4a, x, 0.7, 0, g);
    const cows = [];
    for (let i = 0; i < 3; i++) { const c = new THREE.Group(); box(1.2, 0.7, 0.6, 0xf4f4f0, 0, 0.75, 0, c); box(0.4, 0.4, 0.4, 0x2a2a2a, 0.75, 0.95, 0, c); box(0.3, 0.3, 0.62, 0x2a2a2a, -0.2, 0.9, 0, c); for (const [x, z] of [[0.4, 0.2], [0.4, -0.2], [-0.4, 0.2], [-0.4, -0.2]]) box(0.15, 0.45, 0.15, 0xf4f4f0, x, 0.22, z, c); c.position.set(-2 + i * 2, 0, (i - 1) * 1.2); c.rotation.y = i; g.add(c); cows.push(c); }
    g.userData.cows = cows;
  } else if (kind === 'market') {
    const cols = [0xd24a3a, 0x3f78b8, 0xe0a030, 0x4b9a5e];
    for (let i = 0; i < 4; i++) { const s = new THREE.Group(); box(1.8, 0.9, 1.0, 0x8a5a33, 0, 0.45, 0, s); for (const x of [-0.85, 0.85]) box(0.1, 2, 0.1, 0x6b4a2b, x, 1, 0.45, s); const a = box(2.1, 0.12, 1.4, cols[i], 0, 2.05, 0.1, s); a.rotation.x = 0.25; box(0.3, 0.3, 0.3, [0xc8323c, 0xe2c04e, 0x6aa84f, 0xd48a3a][i], -0.4, 1.05, 0, s); s.position.set((i % 2 ? 1.3 : -1.3), 0, i < 2 ? -1.4 : 1.4); g.add(s); }
  } else if (kind === 'castle') {
    box(6, 4, 6, 0xbdb6a8, 0, 2, 0, g);
    for (let i = 0; i < 6; i++) { box(0.6, 0.6, 0.4, 0xbdb6a8, -2.7 + i * 1.08, 4.3, 2.8, g); box(0.6, 0.6, 0.4, 0xbdb6a8, -2.7 + i * 1.08, 4.3, -2.8, g); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const t = makeTower({ w: 1.8, h: 6, wall: '#c7c0b2', roof: '#3c5a8a' }); t.position.set(sx * 3, 0, sz * 3); g.add(t); }
    const k = makeTower({ w: 2.6, h: 8, wall: '#d4cdbf', roof: '#a33b3b' }); g.add(k);
  } else if (kind === 'fence' || kind === 'wall' || kind === 'lamps') {
    // 町をぐるりと囲む（区画の外側の楕円）。東西南北に門のすき間をあける
    const R0 = kind === 'fence' ? 31.5 : kind === 'wall' ? 33.5 : 29.3;
    const N = kind === 'lamps' ? 12 : kind === 'fence' ? 96 : 84;
    const gate = (a) => [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI * 1.5].some((q) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q))) < (kind === 'lamps' ? 0 : 0.07));
    g.userData.lights = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (kind === 'lamps' ? Math.PI / 12 : 0);
      if (gate(a)) continue;
      const x = Math.cos(a) * R0, z = Math.sin(a) * R0 * 0.92;
      if (z > 26) continue; // 海べはあける
      if (LAND && b) { const ro = b.rot || 0; if (!LAND(b.x + x * Math.cos(ro) + z * Math.sin(ro), b.z - x * Math.sin(ro) + z * Math.cos(ro))) continue; } // 海の上には立てない
      if (kind === 'fence') {
        box(0.22, 1.3, 0.22, 0x7a5230, x, 0.65, z, g);
        const a2 = ((i + 0.5) / N) * Math.PI * 2, L = (Math.PI * 2 * R0) / N + 0.1;
        for (const y of [0.45, 0.95]) { const r = box(0.1, 0.12, L, 0x9b6b3d, Math.cos(a2) * R0, y, Math.sin(a2) * R0 * 0.92, g); r.rotation.y = -a2; }
      } else if (kind === 'wall') {
        const L = (Math.PI * 2 * R0) / N + 0.25;
        const m = box(0.9, 2.2, L, i % 2 ? 0x9a9690 : 0xa8a49c, x, 1.1, z, g); m.rotation.y = -a;
        if (i % 2) { const c = box(0.95, 0.5, L * 0.5, 0x8d8983, x, 2.45, z, g); c.rotation.y = -a; }
      } else {
        box(0.18, 3.0, 0.18, 0x3d3a36, x, 1.5, z, g); box(0.5, 0.1, 0.5, 0x3d3a36, x, 3.05, z, g);
        box(0.42, 0.45, 0.42, LAMP_MAT, x, 2.8, z, g).castShadow = false;
        g.userData.lights.push({ x, y: 2.6, z });
      }
    }
  } else if (kind === 'watch') {
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.22, 3.6, 0.22, 0x7a5230, x, 1.8, z, g);
    box(2.6, 0.2, 2.6, 0x9b6b3d, 0, 3.6, 0, g);
    for (const s of [-1.25, 1.25]) { box(2.6, 0.5, 0.1, 0x8a5a33, 0, 3.95, s, g); box(0.1, 0.5, 2.6, 0x8a5a33, s, 3.95, 0, g); }
    box(0.15, 1.6, 0.15, 0x6b4628, 1.2, 4.6, 1.2, g); box(0.15, 1.6, 0.15, 0x6b4628, -1.2, 4.6, -1.2, g);
    roof(g, 'pyramid', 2.8, 2.8, 1.2, 0x5e4026, 5.3);
    for (let y = 0.5; y < 3.6; y += 0.55) box(0.5, 0.08, 0.1, 0x8a5a33, 0, y, 1.15, g); // はしご
    box(0.08, 0.5, 0.08, 0x6b4628, 1.2, 4.1, -1.2, g); box(0.2, 0.22, 0.2, TORCH_MAT, 1.2, 4.42, -1.2, g).castShadow = false;
    g.userData.lights = [{ x: 1.2, y: 4.6, z: -1.2 }];
  } else if (kind === 'storehouse') {
    // 倉庫：石の土台・大きな両開きの戸・前に樽と木箱・荷を上げる腕木。家とは形を変える
    const w = 5.2, d = 4, h = 2.6;
    box(w + 0.4, 0.5, d + 0.4, 0x8d8b86, 0, 0.25, 0, g);
    box(w, h, d, 0x9a7650, 0, 0.5 + h / 2, 0, g);
    for (let x = -w / 2 + 0.4; x < w / 2; x += 0.55) box(0.06, h, 0.06, 0x7a5a38, x, 0.5 + h / 2, d / 2 + 0.03, g); // 縦板
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.24, h + 0.1, 0.24, 0x5e4026, sx * w / 2, 0.5 + h / 2, sz * d / 2, g);
    box(2.0, 2.0, 0.1, 0x5a3a22, 0, 1.5, d / 2 + 0.06, g); // 戸
    for (const x of [-0.5, 0.5]) { const r = box(0.08, 2.2, 0.06, 0x3a2614, x, 1.5, d / 2 + 0.12, g); r.rotation.z = x > 0 ? 0.72 : -0.72; }
    box(2.2, 0.12, 0.14, 0x3a2614, 0, 2.55, d / 2 + 0.1, g);
    // 屋根（低い切妻）と荷上げの腕木
    roof(g, 'gable', w, d, 1.3, 0x6b4a2f, 0.5 + h);
    box(0.18, 0.18, 1.6, 0x5e4026, 0, 0.5 + h + 0.95, d / 2 + 0.5, g); box(0.04, 0.9, 0.04, 0xd8c8a0, 0, 0.5 + h + 0.4, d / 2 + 1.2, g);
    // 樽と木箱
    for (const [x, z] of [[-w / 2 - 0.6, d / 2 - 0.2], [-w / 2 - 0.6, d / 2 - 1.1]]) { box(0.7, 0.9, 0.7, 0x8a5a2c, x, 0.45, z, g); box(0.74, 0.08, 0.74, 0x3a3a40, x, 0.7, z, g); box(0.74, 0.08, 0.74, 0x3a3a40, x, 0.2, z, g); }
    box(0.8, 0.8, 0.8, 0xb08a52, w / 2 + 0.7, 0.4, d / 2 - 0.3, g); box(0.6, 0.6, 0.6, 0x9c7642, w / 2 + 0.7, 1.1, d / 2 - 0.3, g); box(0.7, 0.7, 0.7, 0xb08a52, w / 2 + 0.75, 0.35, d / 2 - 1.3, g);
    box(1.4, 0.5, 0.06, 0xe8dcc0, 0, 2.95 + 0.25, d / 2 + 0.08, g); // 看板
    box(0.08, 0.4, 0.08, 0x6b4628, 1.3, 1.9, d / 2 + 0.12, g); box(0.16, 0.18, 0.16, TORCH_MAT, 1.3, 2.18, d / 2 + 0.12, g).castShadow = false;
    g.userData.lights = [{ x: 1.3, y: 2.3, z: d / 2 + 0.5 }];
  } else if (kind === 'workbench') {
    // 作業台：板の台に、のこぎりと金づち。小さな屋根の下
    box(1.6, 0.9, 1.0, 0x9a6a3a, 0, 0.45, 0, g);
    box(1.7, 0.12, 1.1, 0xc49a5c, 0, 0.96, 0, g);
    for (let i = 0; i < 3; i++) box(0.04, 0.02, 1.08, 0x7d5a2e, -0.55 + i * 0.55, 1.03, 0, g);
    box(0.7, 0.04, 0.22, 0xc8ced6, -0.35, 1.06, 0.2, g); box(0.25, 0.08, 0.1, 0x7a4f2a, -0.75, 1.07, 0.2, g); // のこぎり
    box(0.08, 0.08, 0.5, 0x7a4f2a, 0.45, 1.07, -0.1, g); box(0.24, 0.14, 0.14, 0x55585e, 0.45, 1.1, -0.36, g); // 金づち
    for (const [x, z] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) box(0.16, 2.2, 0.16, 0x6b4628, x, 1.1, z, g);
    roof(g, 'gable', 2.8, 2.0, 0.8, 0x7a5a38, 2.2);
    box(0.8, 0.5, 0.6, 0xb08a52, 1.6, 0.25, 0.5, g); box(0.5, 0.35, 0.5, 0x8a6a42, -1.7, 0.18, -0.4, g);
  } else if (kind === 'fountain') {
    box(6, 0.6, 6, 0xb8b2a4, 0, 0.3, 0, g); box(5.2, 0.1, 5.2, 0x6fb4d8, 0, 0.62, 0, g);
    box(1.6, 1.6, 1.6, 0xc9c3b5, 0, 1.1, 0, g); box(1.2, 0.1, 1.2, 0x6fb4d8, 0, 1.92, 0, g); box(0.5, 1.2, 0.5, 0xc9c3b5, 0, 2.5, 0, g);
    g.userData.water = true; g.userData.steam = { x: 0, y: 3.2, z: 0, water: true };
  }
  return g;
}
export function makeBuilding(b, config) {
  const def = config.buildings[b.type];
  const L = def.look;
  let g;
  if (L.kind === 'house') g = makeHouse(L, b);
  else if (L.kind === 'tower') g = makeTower(L);
  else g = makeSpecial(L.kind, b);
  g.position.set(b.x, 0, b.z);
  g.rotation.y = b.rot || 0;
  g.userData.building = b;
  return g;
}


// ---------- 通れない所（建物・木・岩）をよけて歩く ----------
const R_SPECIAL = { storehouse: 3.6, workbench: 1.8, plaza: 0, garden: 0, dock: 0, fence: 0, wall: 0, lamps: 0, watch: 1.8, well: 1.3, onsen: 3.8, windmill: 2.2, ranch: 5.6, farm: 0, canal: 0, pen: 0, market: 3.2, castle: 5.2, fountain: 3.4 };
export function footprint(b, config) {
  const L = config.buildings[b.type].look;
  if (L.kind === 'house') return Math.hypot(L.w, L.d) / 2 + 0.35;
  if (L.kind === 'tower') return L.w * 0.75 + 0.3;
  return R_SPECIAL[L.kind] ?? 2;
}
export function obstaclesFor(world, config, { trees = true } = {}) {
  const obs = [];
  for (const b of world.buildings) { const r = footprint(b, config); if (r > 0) obs.push({ x: b.x, z: b.z, r }); }
  for (const r of world.rocks) if (r.hp > 0 && !r.far && !r.gone) obs.push({ x: r.x, z: r.z, r: 2.1 });
  if (trees) for (const t of world.trees) if (t.state === 'tree' && !t.far && !t.gone) obs.push({ x: t.x, z: t.z, r: 0.75 * (t.size || 1) });
  return obs;
}
// a から b へ、障害物の円をよける折れ線（b をふくむ点の列）を返す
export function routeAround(a, b, obs, depth = 0) {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  if (L2 < 1e-6 || depth > 7) return [b];
  let best = null, bestT = 2;
  for (const o of obs) {
    if (Math.hypot(a.x - o.x, a.z - o.z) < o.r || Math.hypot(b.x - o.x, b.z - o.z) < o.r) continue;
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t;
    if (Math.hypot(px - o.x, pz - o.z) < o.r && t < bestT) { best = { o, px, pz }; bestT = t; }
  }
  if (!best) return [b];
  const { o } = best;
  let nx = best.px - o.x, nz = best.pz - o.z, n = Math.hypot(nx, nz);
  if (n < 1e-3) { nx = -dz; nz = dx; n = Math.hypot(nx, nz); }
  const w = { x: o.x + (nx / n) * (o.r + 0.7), z: o.z + (nz / n) * (o.r + 0.7) };
  return [...routeAround(a, w, obs, depth + 1), ...routeAround(w, b, obs, depth + 1)];
}
export function routeLength(a, pts) { let s = 0, p = a; for (const q of pts) { s += Math.hypot(q.x - p.x, q.z - p.z); p = q; } return s; }
// 折れ線の上で距離 s の所
export function pointAt(a, pts, s) {
  let p = a;
  for (const q of pts) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (s <= d) { const k = d ? s / d : 0; return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, dir: Math.atan2(q.x - p.x, q.z - p.z) }; }
    s -= d; p = q;
  }
  const last = pts[pts.length - 1] || a; return { x: last.x, z: last.z, dir: null };
}
// 名前の札が重ならないように、近い順に置いて、ぶつかったら上へずらす
export function declutter(tags, { step = 1, maxShift = 3 } = {}) {
  const placed = [];
  for (const t of tags.slice().sort((p, q) => p.depth - q.depth)) {
    t.shift = -1;
    for (let k = 0; k <= maxShift; k++) {
      const y = t.y - k * (t.h + step);
      const hit = placed.some((p) => Math.abs(p.x - t.x) < (p.w + t.w) / 2 + 2 && Math.abs(p.y2 - y) < (p.h + t.h) / 2 + step);
      if (!hit) { t.shift = k; placed.push({ x: t.x, y2: y, w: t.w, h: t.h }); break; }
    }
  }
  return tags;
}

// ---------- 道（建物の前を通る輪の道・広場から外への道・家の前の小道） ----------
// 区画は楕円の輪（半径 12・19・26、z は 0.92 倍して -1 ずらす）に並ぶので、輪の内側に道を通す。
const RINGS = [12, 19, 26];
const ROAD_IN = 3.7; // 区画の中心から道までの距離
// 村のまん中（拠点）。前の町は (0, -1)。拠点を投票で決めた町は world.square の所（町の画面が setTownCenter で教える）。
// LAND：陸かどうか（小さな島の町だけ）。道や柵が海の上に出ないように使う
let CTR = { x: 0, z: -1 }, LAND = null;
export function setTownCenter(c, land = null) { if (c) CTR = { x: c.x, z: c.z }; LAND = land; }
const ell = (a, r) => ({ x: CTR.x + Math.cos(a) * r, z: CTR.z + Math.sin(a) * r * 0.92 });
const angOf = (p) => Math.atan2((p.z - CTR.z) / 0.92, p.x - CTR.x);
const ringOf = (b) => { const r = Math.hypot(b.x - CTR.x, (b.z - CTR.z) / 0.92); let best = -1, bd = 2.5; RINGS.forEach((R, i) => { if (Math.abs(r - R) < bd) { bd = Math.abs(r - R); best = i; } }); return best; };
const seaAt = (x, z) => (LAND ? !LAND(x, z) : z > 27);
const roadMat = new THREE.MeshLambertMaterial({ color: 0xcbb48a });
const yardMat = new THREE.MeshLambertMaterial({ color: 0xb8a57c });
const segGeo = new THREE.BoxGeometry(1, 0.05, 1);
export function makeRoads(buildings, plots, config) {
  const g = new THREE.Group();
  const segs = []; // [x1, z1, x2, z2, width]
  const blocks = buildings.map((b) => ({ x: b.x, z: b.z, r: footprint(b, config) * 0.85 }));
  const blocked = (x, z) => blocks.some((o) => o.r > 0 && Math.hypot(x - o.x, z - o.z) < o.r);
  const used = new Set(buildings.map(ringOf).filter((i) => i >= 0));
  if (!used.size) return g;
  const outer = Math.max(...used);
  // 輪の道
  for (const i of used) {
    const r = RINGS[i] - ROAD_IN, N = 72;
    for (let k = 0; k < N; k++) {
      const p = ell((k / N) * Math.PI * 2, r), q = ell(((k + 1) / N) * Math.PI * 2, r);
      if (seaAt(q.x, q.z) || (LAND && seaAt(p.x, p.z)) || blocked((p.x + q.x) / 2, (p.z + q.z) / 2)) continue;
      segs.push([p.x, p.z, q.x, q.z, 1.5]);
    }
  }
  // 広場から外への道：区画のすき間の向きを 4 本えらぶ
  const pa = (plots || []).map(angOf);
  const clear = (a) => Math.min(...pa.map((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))), 9);
  const spokes = [];
  for (let qd = 0; qd < 4; qd++) {
    let best = null, bc = -1;
    for (let k = 0; k < 30; k++) { const a = -Math.PI / 2 + qd * Math.PI / 2 - Math.PI / 4 + (k / 30) * Math.PI / 2; const c = clear(a); if (c > bc) { bc = c; best = a; } }
    spokes.push(best);
  }
  for (const a of spokes) {
    const r1 = RINGS[outer] - ROAD_IN;
    for (let r = 2.5; r < r1; r += 1) {
      const p = ell(a, r), q = ell(a, Math.min(r1, r + 1));
      if (seaAt(q.x, q.z) || (LAND && seaAt(p.x, p.z)) || blocked((p.x + q.x) / 2, (p.z + q.z) / 2)) continue;
      segs.push([p.x, p.z, q.x, q.z, 1.4]);
    }
  }
  // 家の前の小道と、足もとの地面
  for (const b of buildings) {
    const i = ringOf(b);
    const fr = footprint(b, config);
    if (fr <= 0 && b.plot === 'ring') continue;
    const yard = new THREE.Mesh(segGeo, yardMat);
    yard.scale.set(fr * 1.5, 0.6, fr * 1.5); yard.position.set(b.x, 0.012, b.z); yard.rotation.y = b.rot || 0; yard.receiveShadow = true; g.add(yard);
    if (i < 0) continue;
    const a = angOf(b);
    const from = { x: b.x + Math.sin(b.rot || 0) * (fr - 0.6), z: b.z + Math.cos(b.rot || 0) * (fr - 0.6) };
    const to = ell(a, RINGS[i] - ROAD_IN);
    segs.push([from.x, from.z, to.x, to.z, 1.0]);
  }
  for (const [x1, z1, x2, z2, w] of segs) {
    const m = new THREE.Mesh(segGeo, roadMat);
    const L = Math.hypot(x2 - x1, z2 - z1) + w * 0.5;
    m.scale.set(w, 1, L); m.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2); m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    m.receiveShadow = true; g.add(m);
  }
  g.userData.spokes = spokes;
  return g;
}
// 道の上の点（村人が道を通って歩くため）：輪の道の半径
export const roadRadius = (b) => { const i = ringOf(b); return i < 0 ? null : RINGS[i] - ROAD_IN; };
