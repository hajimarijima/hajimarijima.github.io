// 遊びのページの 3D：島の一部（南の浜と北の森）の小さな場面。js/town.js とは別（町の画面には何も足さない）。
// 島の形は js/island.js（radiusAt・shoreDist・shorePoint）で作る。1 マス＝1（村人の背は 2）。
// 地面はブロックの積み重ね（草・土・砂・石）で、ドット絵の模様（16×16）を貼って立体に見せる。
//   木：幹 1×1 を 6 段、葉は 4 段目より上（振り上げた斧が葉に入らない高さ。tools の到達を測って確かめる）。
//   岩・木の実のしげみ・光る宝箱。歩ける所は shoreDist と物の丸い当たり（walkable）で決め、A* で道を探す。
import * as THREE from 'three';
import { shoreDist, shorePoint } from '../island.js';
import { makeRng, treasureSpot } from './rules.js';

export const ISLE = { id: 'play', x: 0, z: 0, r: 15, wob: [[0.07, 3, 0.4], [0.04, 5, 1.7], [0.025, 9, 0.3]] };
export const WATER_Y = -0.25;
const CLEAR = 0.5; // 村人の体の半分（腕の外まで）＋少し

// ---------- ドット絵の模様 ----------
function canvasTex(draw, n = 16) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); draw(g, n);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(cols, seed, extra) {
  return canvasTex((g, n) => {
    const r = makeRng(seed);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = cols[Math.floor(r.next() * cols.length)]; g.fillRect(x, y, 1, 1); }
    if (extra) extra(g, n, r);
  });
}
const GREEN = ['#6fae45', '#7dbb4f', '#5f9c3a', '#86c457', '#6aa742'];
const DIRT = ['#8a5a35', '#7a4e2c', '#966541', '#6f4527'];
const SAND = ['#ead9a2', '#e0ce90', '#f2e4b2', '#d8c486'];
const STONE = ['#8f9296', '#7d8084', '#9da0a4', '#6f7276'];
const LEAF = ['#3f8a2e', '#4d9c37', '#357726', '#5aa83f', '#2f6d22'];
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const L = (map, o = {}) => new THREE.MeshLambertMaterial({ map, ...o });
  const grassSide = speckle(DIRT, 11, (g, n, r) => {
    for (let x = 0; x < n; x++) { const h = 3 + (r.next() < 0.45 ? 1 : 0) + (r.next() < 0.2 ? 1 : 0); for (let y = 0; y < h; y++) { g.fillStyle = GREEN[Math.floor(r.next() * GREEN.length)]; g.fillRect(x, y, 1, 1); } }
  });
  const logSide = canvasTex((g, n) => { const r = makeRng(5); for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) { const s = (x % 4 === 0 ? 0 : x % 4 === 2 ? 2 : 1); g.fillStyle = ['#5a3d22', '#6b4a2b', '#7a5634'][r.next() < 0.15 ? 0 : s]; g.fillRect(x, y, 1, 1); } });
  const logTop = canvasTex((g, n) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); g.fillStyle = d > 6.5 ? '#5a3d22' : Math.floor(d) % 2 ? '#a07a48' : '#b8915a'; g.fillRect(x, y, 1, 1); } });
  const planks = canvasTex((g, n) => { const r = makeRng(9); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = y % 4 === 3 ? '#6e4a26' : ['#a87a45', '#9c6f3d', '#b4864f'][Math.floor(r.next() * 3)]; g.fillRect(x, y, 1, 1); } });
  const leaf = speckle(LEAF, 21, (g, n, r) => { for (let i = 0; i < 10; i++) { g.fillStyle = '#245a1a'; g.fillRect(Math.floor(r.next() * n), Math.floor(r.next() * n), 1, 1); } });
  const bushLeaf = speckle(['#3a7d2a', '#468f33', '#2f6a22', '#519a3b'], 23);
  const stone = speckle(STONE, 31, (g, n, r) => { for (let i = 0; i < 6; i++) { g.fillStyle = '#5f6266'; g.fillRect(Math.floor(r.next() * 15), Math.floor(r.next() * 15), 2, 1); } });
  const iron = speckle(['#b9bec4', '#a7adb4', '#cfd3d8'], 41);
  const gold = speckle(['#f2c230', '#e0a81c', '#ffe070'], 43);
  MATS = {
    grass: [L(grassSide), L(grassSide), L(speckle(GREEN, 12)), L(speckle(DIRT, 13)), L(grassSide), L(grassSide)],
    dirt: L(speckle(DIRT, 14)), sand: L(speckle(SAND, 15)), wetSand: L(speckle(['#c9b57c', '#bfab72', '#d2bf88'], 16)),
    stone: L(stone), log: [L(logSide), L(logSide), L(logTop), L(logTop), L(logSide), L(logSide)],
    leaf: L(leaf), bush: L(bushLeaf), planks: L(planks), iron: L(iron), gold: L(gold, { emissive: 0x6a4a00, emissiveIntensity: 0.6 }),
    berry: new THREE.MeshLambertMaterial({ color: 0xd8283a }), berryHi: new THREE.MeshLambertMaterial({ color: 0xff8a8a }),
    water: new THREE.MeshPhongMaterial({ color: 0x3f93c8, transparent: true, opacity: 0.74, shininess: 80, specular: 0x88aacc }),
    deep: new THREE.MeshLambertMaterial({ color: 0x1f5d86 }),
    foam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    flower: [0xf2d64b, 0xf07ab0, 0xffffff, 0x9fb8ff].map((c) => new THREE.MeshLambertMaterial({ color: c })),
    stem: new THREE.MeshLambertMaterial({ color: 0x3f7f2a }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    spark: new THREE.MeshBasicMaterial({ color: 0xfff2b0 }),
    inner: new THREE.MeshBasicMaterial({ color: 0xffd760 }),
  };
  return MATS;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
function block(mat, w, h, d, x, y, z, cast = true) {
  const m = new THREE.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true; return m;
}

// ---------- 島の地面 ----------
// 砂浜の幅：南（+z）ほど広い（浜）。北は森が岸の近くまで
const sandWidth = (x, z) => 1.6 + 4.6 * Math.max(0, Math.sin(Math.atan2(z - ISLE.z, x - ISLE.x)));
export const groundKind = (x, z) => { const d = shoreDist(ISLE, x, z); return d <= 0 ? 'sea' : d < sandWidth(x, z) ? 'sand' : 'grass'; };

function buildGround(scene) {
  const M = mats();
  const cells = { grass: [], dirt: [], sand: [], wet: [] };
  const R = ISLE.r * 1.25;
  for (let gx = -Math.ceil(R); gx < Math.ceil(R); gx++) for (let gz = -Math.ceil(R); gz < Math.ceil(R); gz++) {
    const x = gx + 0.5, z = gz + 0.5, d = shoreDist(ISLE, x, z);
    if (d > 0) {
      const k = groundKind(x, z);
      if (k === 'grass') { cells.grass.push([x, -0.5, z]); cells.dirt.push([x, -1.5, z]); } else { cells.sand.push([x, -0.5, z]); cells.sand.push([x, -1.5, z]); }
    } else if (d > -3.5) cells.wet.push([x, d > -1.5 ? -1.5 : -2.5, z]); // 水の中の砂（岸から離れるほど深い）
  }
  const inst = (mat, list) => {
    const m = new THREE.InstancedMesh(BOX, mat, list.length);
    const o = new THREE.Object3D();
    list.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.receiveShadow = true; m.castShadow = false; scene.add(m); return m;
  };
  inst(M.grass, cells.grass); inst(M.dirt, cells.dirt); inst(M.sand, cells.sand); inst(M.wetSand, cells.wet);
  // 深い所の底と、海の面
  const deep = new THREE.Mesh(new THREE.CircleGeometry(90, 48), M.deep); deep.rotation.x = -Math.PI / 2; deep.position.y = -3.2; scene.add(deep);
  const water = new THREE.Mesh(new THREE.CircleGeometry(90, 64), M.water); water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true; scene.add(water);
  const foam = new THREE.Group(); // （波打ちぎわの泡は、ブロックの岸と合わずに板が浮いて見えるので置かない）
  return { water, foam };
}

// ---------- 物 ----------
function makeTree(x, z, h = 6) {
  const M = mats(), g = new THREE.Group(); g.position.set(x, 0, z);
  for (let y = 0; y < h; y++) g.add(block(M.log, 1, 1, 1, 0, y + 0.5, 0));
  const leaves = new THREE.Group(); g.add(leaves);
  const leafMat = M.leaf.clone(); // 木ごとに 1 つ（村人がかくれる時だけ、その木の葉をうすくする）
  // 葉：4・5 段目は 5×5（四すみなし）、6 段目は 3×3、てっぺんは十字
  const lay = (y, n, corners) => { for (let i = -n; i <= n; i++) for (let k = -n; k <= n; k++) { if (!corners && Math.abs(i) === n && Math.abs(k) === n) continue; if (i === 0 && k === 0 && y < h) continue; leaves.add(block(leafMat, 1, 1, 1, i, y + 0.5, k)); } };
  lay(4, 2, false); lay(5, 2, false); lay(6, 1, true);
  for (const [i, k] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) leaves.add(block(leafMat, 1, 1, 1, i, 7.5, k));
  g.userData = { kind: 'tree', r: 0.5, leaves, leafMat, fade: 0, canopy: new THREE.Box3(new THREE.Vector3(x - 2.5, 3.6, z - 2.5), new THREE.Vector3(x + 2.5, 8.2, z + 2.5)) };
  return g;
}
function makeRock(x, z, seed) {
  const M = mats(), g = new THREE.Group(); g.position.set(x, 0, z);
  const r = makeRng(seed);
  g.add(block(M.stone, 1, 0.9, 1, 0, 0.45, 0));
  g.add(block(M.stone, 0.55, 0.42, 0.55, (r.next() - 0.5) * 0.3, 1.11, (r.next() - 0.5) * 0.3));
  g.userData = { kind: 'rock', r: 0.55 };
  return g;
}
function makeBush(x, z, seed) {
  const M = mats(), g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(block(M.bush, 1, 0.85, 1, 0, 0.425, 0));
  g.add(block(M.bush, 0.7, 0.3, 0.7, 0, 0.99, 0));
  // 実：しげみの面の上に小さな赤い粒（面から少しだけ出す。中に埋めない）
  const berries = new THREE.Group(); g.add(berries);
  const r = makeRng(seed), BG = new THREE.BoxGeometry(0.13, 0.13, 0.13);
  for (let i = 0; i < 9; i++) {
    const side = i % 4, u = (r.next() - 0.5) * 0.7, y = 0.18 + r.next() * 0.55;
    const b = new THREE.Mesh(BG, r.next() < 0.3 ? M.berryHi : M.berry); b.castShadow = true;
    const o = 0.5 + 0.06;
    b.position.set(side === 0 ? o : side === 1 ? -o : u, y, side === 2 ? o : side === 3 ? -o : u);
    berries.add(b);
  }
  g.userData = { kind: 'bush', r: 0.55, berries };
  return g;
}
// 畑（2×2）：耕した土の板に、うねと麦の芽。水をやると土が濃くなる（userData.wet 0〜1。setWet で色を変える）
const FARM = ['#7a5636', '#6c4a2d', '#86603e', '#5f412a'], FARM_WET = ['#4f3520', '#45301c', '#5a3d25', '#3e2a17'];
function makeField(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const tex = (cols, seed) => speckle(cols, seed, (c, n) => { c.fillStyle = cols[3]; for (let y = 3; y < n; y += 5) c.fillRect(0, y, n, 1); });
  const dry = new THREE.MeshLambertMaterial({ map: tex(FARM, 51) }), wetM = new THREE.MeshLambertMaterial({ map: tex(FARM_WET, 52), transparent: true, opacity: 0 });
  const base = block(dry, 2, 0.12, 2, 0, 0.06, 0, false); g.add(base);
  const wetTop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), wetM); wetTop.rotation.x = -Math.PI / 2; wetTop.position.y = 0.121; wetTop.receiveShadow = true; g.add(wetTop);
  // ふち（木の枠。土より少し高い）
  const M = mats();
  for (const [w, d, px, pz] of [[2.16, 0.08, 0, 1.04], [2.16, 0.08, 0, -1.04], [0.08, 2.0, 1.04, 0], [0.08, 2.0, -1.04, 0]]) g.add(block(M.planks, w, 0.18, d, px, 0.09, pz));
  // 麦の芽：うね 4 本に 5 本ずつ（土の上に立てる。埋めない）
  const sprout = [new THREE.MeshLambertMaterial({ color: 0x7fbf3f }), new THREE.MeshLambertMaterial({ color: 0x9ccf4a }), new THREE.MeshLambertMaterial({ color: 0xc8c45a })];
  const r = makeRng('field' + x + z);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 5; k++) {
    const h = 0.16 + r.next() * 0.14, px = -0.72 + i * 0.48, pz = -0.76 + k * 0.38;
    g.add(block(sprout[Math.floor(r.next() * 3)], 0.06, h, 0.06, px - 0.04, 0.12 + h / 2, pz, false));
    g.add(block(sprout[Math.floor(r.next() * 3)], 0.06, h * 0.8, 0.06, px + 0.05, 0.12 + h * 0.4, pz + 0.04, false));
  }
  g.userData = { kind: 'field', r: 1.15, wet: 0, wetM };
  return g;
}
export function setWet(o, k) { const u = o.g.userData; u.wet = Math.max(0, Math.min(1, k)); u.wetM.opacity = u.wet; u.wetM.visible = u.wet > 0.01; }
function makeFlower(x, z, c) {
  const M = mats(), g = new THREE.Group(); g.position.set(x, 0, z);
  g.add(block(M.stem, 0.06, 0.3, 0.06, 0, 0.15, 0, false));
  g.add(block(M.flower[c % M.flower.length], 0.18, 0.12, 0.18, 0, 0.34, 0, false));
  return g;
}
// 光る宝箱：板の箱に鉄の帯と金の留め金。ふたは後ろのふちを軸に開く
export function makeChest() {
  const M = mats(), g = new THREE.Group();
  const W = 0.9, D = 0.7, H = 0.55, LH = 0.28;
  const body = new THREE.Group(); g.add(body);
  body.add(block(M.planks, W, H, D, 0, H / 2, 0));
  for (const s of [-1, 1]) body.add(block(M.iron, 0.1, H + 0.01, D + 0.02, s * (W / 2 - 0.12), H / 2, 0));
  body.add(block(M.inner, W - 0.12, 0.02, D - 0.12, 0, H - 0.005, 0, false)); // 中の金貨（ふたを開けると見える）
  const lid = new THREE.Group(); lid.position.set(0, H, -D / 2); g.add(lid); // 軸は後ろの上のふち
  lid.add(block(M.planks, W, LH, D, 0, LH / 2, D / 2));
  for (const s of [-1, 1]) lid.add(block(M.iron, 0.1, LH + 0.01, D + 0.02, s * (W / 2 - 0.12), LH / 2, D / 2));
  const latch = block(M.gold, 0.16, 0.2, 0.06, 0, 0.0, D + 0.03); lid.add(latch);
  // 光：上へのぼる光の柱と、まわりを回る粒
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 3.2, 16, 1, true), M.glow); glow.position.y = 1.7; g.add(glow);
  const sparks = new THREE.Group(); g.add(sparks);
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), M.spark); s.userData.ph = i / 10; sparks.add(s); }
  const light = new THREE.PointLight(0xffd36a, 2.2, 6, 1.6); light.position.set(0, 1.0, 0); g.add(light);
  g.userData = { kind: 'chest', r: 0.6, lid, glow, sparks, light, open: 0, W, D };
  return g;
}

// ---------- 場面ぜんたい ----------
export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9d8f2);
  scene.fog = new THREE.Fog(0xa9d8f2, 38, 85);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8f6a, 1.15));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.9);
  sun.position.set(-14, 22, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const ground = buildGround(scene);

  const objs = []; // { x, z, r, kind, id, g }
  const add = (g, id) => { scene.add(g); const o = { x: g.position.x, z: g.position.z, r: g.userData.r, kind: g.userData.kind, id, g }; g.userData.obj = o; objs.push(o); return o; };
  // 釣り場（南の浜。沖を向く）と、おてつだいの広場
  const fishAng = Math.PI / 2 + 0.12;
  const fp = shorePoint(ISLE, fishAng, 0.95);
  const fishSpot = { x: fp.x, z: fp.z, yaw: Math.atan2(Math.cos(fishAng), Math.sin(fishAng)) };
  const camp = { x: 0.4, z: 1.2 };
  // 宝箱を置く候補（森の奥・岩のかげ・西の浜のはし など。カメラを回さないと見えない所が多い）
  //   はじめのカメラ（南から）の見える所には置かない
  const chestSpots = [[-0.4, -11.6], [7.4, -8.6], [-8.6, -7.4], [11.4, -1.6], [-12.4, 1.8], [3.6, -12.2]].map(([x, z]) => ({ x, z }));
  const keep = [fishSpot, camp, ...chestSpots];
  const campClear = 3.6; // 広場のまわりはあける（村人が見えるように）
  const nearKeep = (x, z, d) => keep.some((k) => Math.hypot(k.x - x, k.z - z) < d);
  // 森：北側に木を並べる（少しずらす）。宝箱の候補と広場のまわりはあける
  const rr = makeRng('forest');
  let tid = 0;
  for (let gx = -12; gx <= 12; gx += 4) for (let gz = -13; gz <= -3; gz += 4) {
    const x = Math.round(gx + (rr.next() - 0.5) * 2) + 0.5, z = Math.round(gz + (rr.next() - 0.5) * 2) + 0.5;
    if (groundKind(x, z) !== 'grass' || shoreDist(ISLE, x, z) < 2.4 || nearKeep(x, z, 2.6) || Math.hypot(x - camp.x, z - camp.z) < campClear + 2.5) continue;
    add(makeTree(x, z), 'tree' + tid++);
  }
  // 岩（東）と木の実のしげみ（西）
  [[5.5, -1.5], [7.5, 1.5], [9.5, -3.5]].forEach(([x, z], i) => { if (!nearKeep(x, z, 1.6)) add(makeRock(x, z, 70 + i), 'rock' + i); });
  [[-5.5, 0.5], [-7.5, -2.5], [-3.5, 3.5]].forEach(([x, z], i) => { if (!nearKeep(x, z, 1.6)) add(makeBush(x, z, 90 + i), 'bush' + i); });
  // 畑（広場の南東。水やりのおてつだい）
  [[4.6, 4.2]].forEach(([x, z], i) => { if (groundKind(x, z) === 'grass' && !nearKeep(x, z, 2.2)) add(makeField(x, z), 'field' + i); });
  // 浜の岩（宝箱のかげ）
  [[6.5, 9.0], [-5.2, 8.6], [-11.4, 3.0]].forEach(([x, z], i) => add(makeRock(x, z, 80 + i), 'brock' + i));
  // 花（飾り。当たりなし）
  for (let i = 0; i < 26; i++) { const x = (rr.next() - 0.5) * 22, z = (rr.next() - 0.5) * 18 - 2; if (groundKind(x, z) === 'grass' && !objs.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.6) && !nearKeep(x, z, 0.9)) scene.add(makeFlower(x, z, i)); }

  // ---------- 歩ける所と道さがし ----------
  //   extra：物からさらにあける間（宝探しで探知機を前に出して歩く時。ふだんは 0）
  const blocked = (x, z, ignore, extra = 0) => objs.some((o) => o !== ignore && !o.passable && Math.hypot(o.x - x, o.z - z) < o.r + CLEAR + extra);
  const walkable = (x, z, ignore, extra = 0) => shoreDist(ISLE, x, z) > 0.7 && !blocked(x, z, ignore, extra);
  const lineOk = (a, b, ignore, extra = 0) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2); for (let i = 1; i <= n; i++) { const k = i / n; if (!walkable(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, ignore, extra)) return false; } return true; };
  const S = 0.5, N = 72, O = -18;
  const cell = (x, z) => [Math.round((x - O) / S), Math.round((z - O) / S)];
  const posOf = (i, k) => ({ x: O + i * S, z: O + k * S });
  function findPath(from, to, ignore, extra = 0) {
    if (lineOk(from, to, ignore, extra)) return [to];
    const [si, sk] = cell(from.x, from.z), [ti, tk] = cell(to.x, to.z);
    const key = (i, k) => i * N + k, open = new Map(), came = new Map(), gs = new Map();
    const h = (i, k) => Math.hypot(i - ti, k - tk);
    open.set(key(si, sk), h(si, sk)); gs.set(key(si, sk), 0);
    let guard = 0;
    while (open.size && guard++ < 6000) {
      let best = null, bf = Infinity;
      for (const [k0, f] of open) if (f < bf) { bf = f; best = k0; }
      open.delete(best);
      const bi = Math.floor(best / N), bk = best % N;
      if (Math.abs(bi - ti) <= 1 && Math.abs(bk - tk) <= 1) {
        const pts = [to]; let c = best;
        while (came.has(c)) { pts.unshift(posOf(Math.floor(c / N), c % N)); c = came.get(c); }
        // 見通せる所はまっすぐつなぐ
        const out = []; let cur = from;
        for (let i = 0; i < pts.length; i++) {
          let j = pts.length - 1;
          while (j > i && !lineOk(cur, pts[j], ignore, extra)) j--;
          out.push(pts[j]); cur = pts[j]; i = j;
        }
        return out;
      }
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = bi + di, nk = bk + dk; if (ni < 0 || nk < 0 || ni >= N || nk >= N) continue;
        const p = posOf(ni, nk); if (!walkable(p.x, p.z, ignore, extra)) continue;
        if (di && dk) { const a = posOf(bi + di, bk), b = posOf(bi, bk + dk); if (!walkable(a.x, a.z, ignore, extra) || !walkable(b.x, b.z, ignore, extra)) continue; }
        const g2 = gs.get(best) + Math.hypot(di, dk);
        const nkey = key(ni, nk);
        if (g2 < (gs.get(nkey) ?? Infinity)) { gs.set(nkey, g2); came.set(nkey, best); open.set(nkey, g2 + h(ni, nk)); }
      }
    }
    return null;
  }
  // 物のそばの、働く時に立つ所（物のまん中から dist。広場の向きから順に、歩ける所を探す）
  function standNear(o, dist, from = camp) {
    const a0 = Math.atan2(from.x - o.x, from.z - o.z);
    for (let i = 0; i < 16; i++) {
      const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
      const x = o.x + Math.sin(a) * dist, z = o.z + Math.cos(a) * dist;
      if (walkable(x, z, o) && findPath(from, { x, z }, o)) return { x, z, yaw: Math.atan2(o.x - x, o.z - z) };
    }
    return null;
  }
  // きょうの宝箱：島のどこか（日付で決まる所）の地面の中にうまっている。掘り出すまでは見えず、当たりもない（上を歩ける）
  //   広場（はじめに立つ所）から離れた、まわりに物がない所（宝のまわりに立って掘れる・出てきた宝箱が物に重ならない）
  const treasureOk = (x, z) => groundKind(x, z) !== 'sea' && shoreDist(ISLE, x, z) >= 1.9 && Math.hypot(x - camp.x, z - camp.z) >= 6 && Math.hypot(x - fishSpot.x, z - fishSpot.z) >= 2.5 && !objs.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1.8);
  function placeChest(date) {
    const s = treasureSpot(date, treasureOk) || { x: -0.4, z: -11.6 };
    const g = makeChest(); g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.atan2(camp.x - s.x, camp.z - s.z);
    g.visible = false;
    const o = add(g, 'chest');
    o.passable = true; // うまっている間は上を歩ける
    return o;
  }
  return { scene, sun, ground, objs, fishSpot, camp, chestSpots, walkable, findPath, standNear, placeChest, lineOk, treasureOk };
}

// 毎コマの小さな動き（泡・宝箱の光）
export function tickScene(S, t) {
  for (const f of S.ground.foam.children) { const k = 0.5 + 0.5 * Math.sin(t * 1.3 + f.userData.ph); f.material.opacity = 0.55; f.scale.set(0.8 + k * 0.5, 1, 1); }
  for (const o of S.objs) {
    if (o.kind !== 'chest') continue;
    const U = o.g.userData;
    U.glow.material.opacity = 0.22 + 0.12 * Math.sin(t * 2.4);
    U.glow.visible = U.open < 0.99 || true;
    U.sparks.children.forEach((s, i) => {
      const a = (s.userData.ph + t * 0.25) * Math.PI * 2, up = ((t * 0.5 + s.userData.ph) % 1);
      const r = 0.75 + U.open * 0.4;
      s.position.set(Math.cos(a) * r, 0.3 + up * (1.6 + U.open * 1.2), Math.sin(a) * r);
      s.rotation.set(t * 3 + i, t * 2, 0);
      s.scale.setScalar(1 - up * 0.6);
    });
    U.lid.rotation.x = -U.open * 1.75; // 後ろのふちを軸に、ほぼ立つまで開く
    U.light.intensity = 2.2 + U.open * 2.5 + 0.4 * Math.sin(t * 3);
  }
}

// カメラと村人のあいだにある木の葉は、うすくする（村人が葉にかくれて見えなくならない）
const _ray = new THREE.Ray(), _hp = new THREE.Vector3(), _hit = new THREE.Vector3();
export function fadeLeaves(S, camera, heroPos, dt) {
  _hp.set(heroPos.x, 1.2, heroPos.z);
  const len = camera.position.distanceTo(_hp);
  _ray.origin.copy(camera.position); _ray.direction.copy(_hp).sub(camera.position).normalize();
  for (const o of S.objs) {
    if (o.kind !== 'tree') continue;
    const U = o.g.userData, hit = _ray.intersectBox(U.canopy, _hit);
    const want = hit && camera.position.distanceTo(_hit) < len ? 1 : 0;
    U.fade += (want - U.fade) * Math.min(1, dt * 8);
    const m = U.leafMat, op = 1 - 0.72 * U.fade;
    if (op < 0.99) { m.transparent = true; m.opacity = op; m.depthWrite = false; } else if (m.transparent) { m.transparent = false; m.opacity = 1; m.depthWrite = true; }
    m.needsUpdate = m.needsUpdate || (op < 0.99) !== !!U.wasFaded; U.wasFaded = op < 0.99;
  }
}