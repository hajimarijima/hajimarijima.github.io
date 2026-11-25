// インスタのリール用の縦動画（1080x1920）。window.renderFrame(t) で t 秒のコマを描く。
// tools/render_video.js がブラウザでこれを開いて、コマを書き出す。
// 見本の村人の名前は動画に出さない（名札・コメント・字幕のどこにも）。顔と「村人」「見張り」だけで見せる。
import * as THREE from 'three';
import { makeCharacter, animate, setTool, setCarry, setAccent, setShield } from '../js/character.js';
import { mat, box, hash, rnd, makeTree, makeRock, makeBush, makeField, makeBuilding, obstaclesFor, routeAround, routeLength, pointAt, makeRoads } from '../js/world3d.js';
import { makeSky } from '../js/daynight.js';
import { makeMob, animateMob, makeArrow, arrowAt } from '../js/mobs.js';
import { makeForest, makeFx, makePile, setPile, PILE_MAX, setRockHp, setTreeCut, setCrack, strikeAt, breakTime, dropPos, chipList, LOGS, LOG, B, SHRINK, STAGES } from '../js/blocks.js';

const W = 1080, H = 1920, FPS = 30;
const SAFE_TOP = H * 0.15, SAFE_BOTTOM = H * 0.85;
const FONT = '"BIZ UDPGothic", "Yu Gothic", "Meiryo", sans-serif';
const [D, config] = await Promise.all([fetch('days.json').then((r) => r.json()), fetch('../data/config.json').then((r) => r.json())]);
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };

// ---------- 何を見せるか（どれも sim.js の結果のまま） ----------
const DEC = D.decisions[0];                     // はじめての投票
const DD = DEC ? DEC.day : -1;
const VB = DEC ? D.buildings.find((b) => b.type === DEC.build && b.day >= DEC.day) : null; // 投票で決まって建った建物
const VBD = VB ? VB.day : D.days.length - 1;
const LAST = Math.min(D.days.length - 1, VBD);   // それが建つ日まで見せる
const NIGHTS = D.nights || {};
const MOB_JA = { zombie: 'ゾンビ', skeleton: 'スケルトン', spider: 'クモ' };
const FIND = D.history.find((h) => h.type === 'find' && h.item === 'iron' && h.day >= 2 && h.day <= LAST); // 鉄が出た日
const IRON_D = FIND ? FIND.day : -1;
const ATK = (() => { let best = null; for (let d = 2; d < LAST; d++) { const n = NIGHTS[d]; if (!n || n.quiet || !n.count) continue; const sc = n.count + (n.groups || []).length * 0.6 + (n.groups || []).some((g) => g.type === 'skeleton') * 1.5; if (!best || sc > best.sc) best = { d, sc, n }; } return best; })();

// ---------- 時間割：0 日目から 1 日ずつ。日が変わるたびに短い夜をはさむ ----------
const T_JOIN = [3.6, 6.2], D1_END = 19.3, SEQ0 = 20.1;
const DAY_LEN = 2.0, NIGHT_LEN = 0.6;
const EXTRA = { iron: 4.4, vote: 2.6, atk: 4.8, last: 1.8 };
const SEG = [{ d: 0, t0: 0, t1: 1.3, t2: T_JOIN[0] }, { d: 1, t0: T_JOIN[0], t1: D1_END, t2: SEQ0 }];
{
  let tt = SEQ0;
  for (let d = 2; d <= LAST; d++) {
    const dayLen = DAY_LEN + (d === IRON_D ? EXTRA.iron : 0) + (d === DD ? EXTRA.vote : 0) + (d === LAST ? EXTRA.last : 0);
    const nightLen = d === LAST ? 0 : NIGHT_LEN + (ATK && d === ATK.d ? EXTRA.atk : 0);
    SEG.push({ d, t0: tt, t1: tt + dayLen, t2: tt + dayLen + nightLen }); tt += dayLen + nightLen;
  }
}
const T_END = SEG[SEG.length - 1].t2;
const DURATION = Math.round((T_END + 5.2) * 10) / 10;
const SC = { s1: [0, T_JOIN[0]], join: T_JOIN, s2: [T_JOIN[1], SEQ0] };
const inS = (t, s) => t >= SC[s][0] && t < SC[s][1];
const segAt = (t) => SEG.find((s) => t < s.t2) || SEG[SEG.length - 1];
const atkSeg = ATK ? SEG.find((s) => s.d === ATK.d) : null;
const inAtk = (t) => atkSeg && t >= atkSeg.t1 && t < atkSeg.t2;
const ironSeg = IRON_D > 0 ? SEG.find((s) => s.d === IRON_D) : null;
const IRON_WIN = ironSeg ? [ironSeg.t0 + 0.2, ironSeg.t0 + 0.2 + EXTRA.iron - 0.1] : null;
const inIron = (t) => IRON_WIN && t >= IRON_WIN[0] && t < IRON_WIN[1];
// その時の時刻（昼は 7〜17 時、夜は 17 時〜翌朝を早送り。敵の夜は明け方をゆっくり見せる）
function hourAt(t) {
  const s = segAt(t);
  if (t >= T_END) return lerp(15, 16.2, clamp01((t - T_END) / (DURATION - T_END)));
  if (t < s.t1) return lerp(s.d === 0 ? 9 : 7, s.d === LAST ? 15 : 17, (t - s.t0) / (s.t1 - s.t0));
  const f = (t - s.t1) / (s.t2 - s.t1);
  if (atkSeg && s === atkSeg) return (f < 0.66 ? lerp(17, 27.4, f / 0.66) : lerp(28.9, 31.2, (f - 0.66) / 0.34)) % 24;
  return lerp(17, 30.6, f) % 24;
}
// 札の日：夜がほとんど明けてから次の日へ（夜の字幕と重ならないように）
function badgeDay(t) { const s = segAt(t); if (t >= s.t2 || t < s.t1) return s.d; return (t - s.t1) / (s.t2 - s.t1) > 0.93 ? Math.min(LAST, s.d + 1) : s.d; }
// 建物はその日の昼の終わりごろに建つ（最後の日は早めに建てて、長く見せる）
const popTime = (s) => (s.d === LAST ? s.t0 + 0.5 : s.t1 - 0.95);
function dayFloatAt(t) {
  const s = segAt(t);
  if (s.d < 2) return s.d;
  if (t >= s.t1) return s.d + 0.45;
  const p = popTime(s);
  return t < p ? s.d - 0.02 : s.d + Math.min(0.45, t - p);
}

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'gl';
document.body.appendChild(renderer.domElement);
const out = document.getElementById('out');
const ctx = out.getContext('2d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd9ea);
scene.fog = new THREE.Fog(0xbcd9ea, 130, 320);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.3, 700);
const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
scene.add(sun.target);
sun.position.set(-30, 50, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
scene.add(sun);
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x86b85a));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(400, 6), mat(0xe8d6a0));
  beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0.01, D.seaZ - 1); beach.receiveShadow = true; scene.add(beach);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 140), new THREE.MeshLambertMaterial({ color: 0x4a9fd0 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.05, D.seaZ + 70); scene.add(sea);
  const R = rnd('flowers');
  const geo = new THREE.BoxGeometry(0.18, 0.25, 0.18);
  for (const c of [0xf2f2f2, 0xf2d24a, 0xe2507a, 0x6a9cd8]) {
    const inst = new THREE.InstancedMesh(geo, mat(c), 80); const m4 = new THREE.Matrix4();
    for (let i = 0; i < 80; i++) { m4.makeTranslation((R() - 0.5) * 150, 0.12, Math.min((R() - 0.5) * 130 - 10, D.seaZ - 4)); inst.setMatrixAt(i, m4); }
    scene.add(inst);
  }
  const tufts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), mat(0x76a84c), 320); const m4 = new THREE.Matrix4();
  for (let i = 0; i < 320; i++) { m4.makeTranslation((R() - 0.5) * 160, 0.07, Math.min((R() - 0.5) * 140 - 10, D.seaZ - 4)); tufts.setMatrixAt(i, m4); }
  scene.add(tufts);
}
const fx = makeFx(scene);
const v3 = new THREE.Vector3();

// たき火（広場ができるまで）
const fire = new THREE.Group();
for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; box(0.35, 0.25, 0.35, 0x7d7a74, Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7, fire); }
box(0.6, 0.15, 0.15, 0x6b4628, 0, 0.12, 0, fire); box(0.15, 0.15, 0.6, 0x6b4628, 0, 0.18, 0, fire);
const flame = box(0.4, 0.6, 0.4, 0xff9a2a, 0, 0.5, 0, fire); flame.castShadow = false;
fire.position.set(D.campfire.x, 0, D.campfire.z); scene.add(fire);

// ---------- 村人 ----------
const VIL = Object.fromEntries(D.villagers.map((v) => [v.key, v]));
const chars = {};
for (const v of D.villagers) { const ch = makeCharacter('../skins/skin_' + String(v.skin).padStart(3, '0') + '.png', { scale: 1.9 }); if (v.profile && v.profile.color) setAccent(ch, v.profile.color); ch.visible = false; scene.add(ch); chars[v.key] = ch; }
const objPos = (id, day) => {
  if (!id) return null;
  if (id[0] === 't') return D.trees.find((x) => x.id === id);
  if (id[0] === 'b') return D.bushes.find((x) => x.id === id);
  const snap = D.days[day];
  return snap.rocks.find((x) => x.id === id) || snap.fields.find((x) => x.id === id) || D.buildings.find((x) => x.id === id);
};
const POSE = { chop: 'chop', dig: 'dig', dig_last: 'dig', till: 'dig', berry: 'gather', harvest: 'gather', tend: 'gather', forage: 'gather' };
const TOOL = { chop: 'axe', dig: 'pick', dig_last: 'pick', till: 'hoe', berry: 'basket', harvest: 'basket', tend: 'hoe', forage: 'basket' };
const workSpot = (key, action, tg) => {
  const ang = (hash(key) % 360) * Math.PI / 180;
  const off = action && action.startsWith('dig') ? 2.3 : action === 'chop' ? 1.25 * ((tg && tg.size) || 1) + 0.6 : 1.3;
  return tg ? { x: tg.x + Math.cos(ang) * off, z: tg.z + Math.sin(ang) * off, fx: tg.x, fz: tg.z } : { x: -14 + (hash(key) % 9), z: 12 + (hash(key) % 5), fx: null };
};
function pushOut(p, obs) {
  for (let n = 0; n < 4; n++) {
    let moved = false;
    for (const o of obs) {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
      if (d < o.r + 0.5) { const k = (o.r + 0.6) / (d || 1); p.x = o.x + (d ? dx : 1) * k; p.z = o.z + (d ? dz : 0) * k; moved = true; }
    }
    if (!moved) break;
  }
  return p;
}
const obsCache = {};
function obsForDay(day) {
  if (obsCache[day]) return obsCache[day];
  const snap = D.days[day];
  return (obsCache[day] = obstaclesFor({ buildings: D.buildings.filter((b) => b.day <= day), rocks: snap.rocks, trees: [] }, config));
}
function hideAll() { for (const k in chars) { const ch = chars[k]; ch.visible = false; setShield(ch, false); ch.userData.block = false; } }

// ---------- 1 日目の場面：岩を掘る・木を切る・運ぶ（台本どおりに動く） ----------
const RD = { rate: 2.0, phase: 0.65 };            // 動画では少し速くたたく（1 秒に 2 回）
const RC = { rate: 1.6, phase: 0.75 }, CH = 4;     // 木はふつうの速さで、4 回で幹 1 つ
const animAt = (u, pose) => (pose === 'dig' ? u * RD.rate / 1.3 : u * RC.rate / 1.6); // 振りと打つ時を合わせる
const S2 = (() => {
  const d0 = D.days[0];
  // 1 日目の寄りでは、上の 2 つが石か石炭の岩を掘る（鉄やダイヤは sim.js で見つかった日に見せる）
  const plain = (r) => !/[igd]/.test((r.blocks || '').slice(0, 2));
  const near0 = d0.rocks.filter((r) => !r.far && plain(r));
  const anchor = near0.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  const toward = unit(-anchor.x, -anchor.z);
  const side = { x: -toward.z, z: toward.x };
  const U = (p) => (p.x - anchor.x) * toward.x + (p.z - anchor.z) * toward.z;
  const V = (p) => (p.x - anchor.x) * side.x + (p.z - anchor.z) * side.z;
  const rock2 = near0.filter((r) => r !== anchor).sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z))[0];
  const trees = D.trees.map((t, i) => ({ ...t, i })).filter((t, i) => !t.far && d0.trees[i] === 't' && d0.rocks.every((r) => Math.hypot(r.x - t.x, r.z - t.z) > 3.6) && U(t) > -6)
    .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z)).slice(0, 5);
  const crew = D.days[1].active.slice(0, 5);
  const jobs = [['dig', anchor], ['chop', trees[0]], ['dig', rock2], ['chop', trees[1]], ['chop', trees[2]]];
  const obstacles = obstaclesFor({ buildings: [], rocks: d0.rocks.filter((r) => !r.far), trees: D.trees.filter((t) => !t.far).map((t) => ({ ...t, state: 'tree' })) }, config);
  const at = (u, v) => ({ x: anchor.x + toward.x * u + side.x * v, z: anchor.z + toward.z * u + side.z * v });
  const chopT = jobs.filter((j) => j[0] === 'chop').map((j) => j[1]);
  const vWood = chopT.reduce((s, t) => s + V(t), 0) / chopT.length, uWood = Math.max(...chopT.map(U)) + 2.6;
  const vStone = (V(anchor) + V(rock2)) / 2, uStone = Math.max(U(anchor), U(rock2)) + 3.4;
  const woodPile = pushOut(at(uWood, vWood), obstacles), stonePile = pushOut(at(uStone, vStone), obstacles);
  const placedWs = [];
  const plans = crew.map((key, i) => {
    const [action, tg] = jobs[i];
    const pile = action === 'chop' ? woodPile : stonePile;
    const off = action === 'dig' ? 2.3 : 1.25 * (tg.size || 1) + 0.6;
    const a = Math.atan2(toward.z, toward.x) + (action === 'dig' ? (i % 2 ? 0.75 : -0.75) : (i % 2 ? 0.3 : -0.3));
    const ws = { x: tg.x + Math.cos(a) * off, z: tg.z + Math.sin(a) * off };
    pushOut(ws, obstacles.filter((o) => Math.hypot(o.x - tg.x, o.z - tg.z) > 0.2));
    for (const q of placedWs) { const dx = ws.x - q.x, dz = ws.z - q.z, d = Math.hypot(dx, dz); if (d < 1.8) { ws.x = q.x + (dx / (d || 1)) * 1.8; ws.z = q.z + (dz / (d || 1)) * 1.8; } }
    placedWs.push(ws);
    const spawn = pushOut(at(Math.max(...[anchor, rock2, ...trees.slice(0, 3)].map(U)) + 4.2 + (i % 2) * 1.2, (vWood + vStone) / 2 + (i - 2) * 2.1), obstacles);
    const dv = action === 'chop' ? [0, -1.6, 0, 1.6, 0][i] : (i === 0 ? -1.0 : 1.0), du = 1.3;
    const drop = { x: pile.x + toward.x * du + side.x * dv, z: pile.z + toward.z * du + side.z * dv };
    const tg2 = action === 'chop' ? (trees[3 + (i % 2)] || tg) : tg;
    let ws2 = ws;
    if (tg2 !== tg) { const a2 = Math.atan2(toward.z, toward.x) + (i % 2 ? -0.6 : 0.6); const o2 = 1.25 * (tg2.size || 1) + 0.6; ws2 = pushOut({ x: tg2.x + Math.cos(a2) * o2, z: tg2.z + Math.sin(a2) * o2 }, obstacles.filter((o) => Math.hypot(o.x - tg2.x, o.z - tg2.z) > 0.2)); }
    const r1 = routeAround(spawn, ws, obstacles), r2 = routeAround(ws, drop, obstacles), r3 = routeAround(drop, ws2, obstacles);
    const enter = SC.s2[0] + i * 0.15;
    const appear = SC.join[0] + 0.3 + i * 0.42; // 「参加したい」が届いて現れる
    const speed = 4.2;
    const t1 = enter + routeLength(spawn, r1) / speed;
    // 岩は 2 ブロック、木は幹 4 つを壊して、落ちた物を拾い終わるまで
    const work = action === 'dig' ? breakTime(1, RD) + SHRINK + 1.3 + 0.25 : breakTime(LOGS - 1, RC, CH) + SHRINK + 1.3 + 0.25;
    const t2 = t1 + work;
    const t3 = t2 + routeLength(ws, r2) / speed;
    const t4 = t3 + 0.6;
    const t5 = t4 + routeLength(drop, r3) / speed;
    return { key, i, action, tg, ws, tg2, ws2, spawn, drop, r1, r2, r3, enter, appear, t1, t2, t3, t4, t5, speed, gain: action === 'dig' ? 2 : LOGS };
  });
  const pts = [...plans.map((p) => p.ws), ...plans.map((p) => p.tg), woodPile, stonePile];
  const vMin = Math.min(...pts.map(V)), vMax = Math.max(...pts.map(V)), uMid = (Math.min(...pts.map(U)) + Math.max(...pts.map(U))) / 2;
  const center = at(uMid + 0.5, (vMin + vMax) / 2);
  const dist = Math.max(18, (vMax - vMin + 3.5) / 0.5246);
  return { anchor, rock2, plans, toward, side, trees, woodPile, stonePile, center, dist };
})();
window.S2 = S2;

// ---------- 自然（日ごとに入れかえ。変わらない木はまとめて描く） ----------
const STATE = { t: 'tree', s: 'stump', p: 'sapling' };
const dynTree = new Set(S2.trees.map((t) => t.i));
D.trees.forEach((t, i) => { for (let d = 0; d <= LAST; d++) if (D.days[d].trees[i] !== 't') { dynTree.add(i); break; } });
scene.add(makeForest(D.trees.filter((t, i) => !dynTree.has(i)).map((t) => ({ ...t, state: 'tree' }))));
const treeObjs = D.trees.map(() => ({ state: null, obj: null }));
function setTree(i, st) {
  const o = treeObjs[i];
  if (o.state === st) return o.obj;
  if (o.obj) scene.remove(o.obj);
  o.obj = makeTree({ ...D.trees[i], state: st }); o.state = st; scene.add(o.obj);
  return o.obj;
}
const bushObjs = D.bushes.map(() => ({ ready: null, obj: null }));
const rockObjs = {}; const fieldObjs = {};
function syncNature(day, override = {}) {
  const snap = D.days[Math.max(0, Math.min(30, day))];
  for (const i of dynTree) { const st = override.trees?.[i] || STATE[snap.trees[i]]; const o = setTree(i, st); if (o.userData.tree) setTreeCut(o, st === 'tree' ? 0 : LOGS); }
  D.bushes.forEach((b, i) => {
    const r = snap.bushes[i] === '1'; const o = bushObjs[i];
    if (o.ready !== r) { if (o.obj) scene.remove(o.obj); o.obj = makeBush({ ...b, ready: r }); o.ready = r; scene.add(o.obj); }
  });
  const seen = new Set();
  for (const r of snap.rocks) {
    const hp = override.rockHp?.[r.id] ?? r.hp;
    seen.add(r.id);
    let o = rockObjs[r.id];
    if (!o) { const obj = makeRock(r); scene.add(obj); o = rockObjs[r.id] = { obj }; }
    setRockHp(o.obj, hp); // ひび・縮みも毎回もどす
  }
  for (const id in rockObjs) rockObjs[id].obj.visible = seen.has(id);
  const fs = new Set();
  for (const f of snap.fields) {
    fs.add(f.id);
    const o = fieldObjs[f.id];
    if (!o || o.stage !== f.stage) { if (o) scene.remove(o.obj); const obj = makeField(f); scene.add(obj); fieldObjs[f.id] = { stage: f.stage, obj }; }
  }
  for (const id in fieldObjs) fieldObjs[id].obj.visible = fs.has(id);
  return snap;
}

// ---------- 掘る・切るの見た目（たたく → ひび → 壊れる → 落ちる → 拾う） ----------
const ITEM_NAME = { cobble: '丸石', coal: '石炭', iron: '鉄鉱石', gold: '金鉱石', diamond: 'ダイヤ', log: '原木' };
const ITEM_COL = { iron: '#ffc69a', gold: '#ffe25a', diamond: '#7ffff4', coal: '#e0e0e0' };
const ORE = { c: 'coal', i: 'iron', g: 'gold', d: 'diamond' };
const RARE = new Set(['iron', 'gold', 'diamond']);
const CHIP_COL = { s: 0x8a8d91, c: 0x3a3a3e, i: 0xd49d74, g: 0xf0cb36, d: 0x45dcd6 };
const PICK = 0.8; // 落ちてから拾うまで
// 落ちた物：はねて回る → 人の手へ → 頭の上に「+1 丸石」
function itemLife(kind, o, seed, age, toward, who, t, big = 1.7) {
  if (age < 0) return 0;
  const head = { x: lerp(who.x, o.x, 0.45), y: 3.0, z: lerp(who.z, o.z, 0.45) }; // 人と岩の間の上（画面の上の札と重ねない）
  if (age < PICK) {
    const d = dropPos(o, seed, age, toward);
    fx.item(kind, d.x, d.y, d.z, d.rot, big);
    if (RARE.has(kind)) fx.glow(kind, d.x, d.y + 0.05, d.z, 1, t, 1.3 * big);
    else fx.glow('coal', d.x, d.y + 0.05, d.z, 0.55, t, 0.8 * big); // ふつうの物も、うすく光らせて見つけやすく
    return 0;
  }
  if (age < PICK + 0.3) {
    const d = dropPos(o, seed, PICK, toward), k = (age - PICK) / 0.3;
    fx.item(kind, lerp(d.x, who.x, k), lerp(d.y, 1.6, k) + Math.sin(k * Math.PI) * 0.5, lerp(d.z, who.z, k), age * 3, big * (1 - k * 0.5));
    return 0;
  }
  if (age < PICK + 1.5) {
    const k = (age - PICK - 0.3) / 1.2;
    fx.plus('+1 ' + ITEM_NAME[kind], head.x, head.y + k * 0.7, head.z, k < 0.75 ? 1 : (1 - k) * 4, ITEM_COL[kind] || '#fff6c8', 1.05);
    if (RARE.has(kind)) fx.glow(kind, who.x, 2.6, who.z, (1 - k) * 0.9, t, 1.1);
  }
  return 1;
}
// 岩：blocks の順に 1 つずつ。u は掘り始めてからの秒。戻り値は拾った数
function digView(rockObj, blocks, u, who, seed, t, sp = RD) {
  const R = rockObj.userData.rock; if (!R) return 0;
  const s = strikeAt(u, sp);
  let got = 0;
  blocks.forEach((bi, i) => {
    const mesh = R.meshes[bi]; if (!mesh) return;
    mesh.getWorldPosition(v3);
    const o = { x: v3.x, y: v3.y, z: v3.z };
    const dir = unit(who.x - o.x, who.z - o.z), face = { x: o.x + dir.x * B * 0.5, y: o.y, z: o.z + dir.z * B * 0.5 };
    const kind = R.kinds[bi];
    if (i < s.broken) {
      const a = u - breakTime(i, sp);
      if (a < SHRINK) { mesh.visible = true; mesh.scale.setScalar(1 - 0.3 * (a / SHRINK)); setCrack(mesh, STAGES - 1); }
      else { mesh.visible = false; setCrack(mesh, -1); }
      fx.chips(chipList(face, dir, seed + 'b' + bi, a, 14), CHIP_COL[kind] || CHIP_COL.s);
      got += itemLife(ORE[kind] || 'cobble', o, seed + bi, a - SHRINK, unit(camera.position.x - o.x, camera.position.z - o.z), who, t, kind === 's' ? 2.0 : 2.3);
    } else {
      mesh.visible = true; mesh.scale.setScalar(1);
      if (i === s.broken) { setCrack(mesh, s.stage); if (s.n && s.inBlk) fx.chips(chipList(face, dir, seed + s.n, s.since, 9), CHIP_COL[kind] || CHIP_COL.s); }
      else setCrack(mesh, -1);
    }
  });
  return got;
}
// 木：下の幹から 1 つずつ。切ると上が 1 段落ちる。最後は葉が散る
function chopView(treeObj, u, who, seed, t) {
  const T = treeObj.userData.tree; if (!T) return 0;
  const s = strikeAt(u, RC, CH);
  const n = Math.min(LOGS, s.broken);
  let fall = 0;
  if (n > 0 && n < LOGS) { const a = u - breakTime(n - 1, RC, CH); fall = a < 0.22 ? 1 - (a / 0.22) * (a / 0.22) : 0; }
  setTreeCut(treeObj, n, fall);
  T.logs.forEach((l, i) => setCrack(l, i === n && n < LOGS ? s.stage : -1));
  const S = T.size, g = treeObj.position;
  const dir = unit(who.x - g.x, who.z - g.z);
  const base = { x: g.x, y: (0.3 + LOG / 2) * S, z: g.z };
  if (n < LOGS && s.n && s.inBlk) fx.chips(chipList({ x: base.x + dir.x * LOG * 0.5 * S, y: base.y, z: base.z + dir.z * LOG * 0.5 * S }, dir, seed + 't' + s.n, s.since, 9), 0x8a6238);
  let got = 0;
  for (let i = 0; i < n; i++) {
    const a = u - breakTime(i, RC, CH);
    if (a < SHRINK) { // 壊れた幹が少し縮んで消える（下に残像を出す）
      fx.item('log', base.x, base.y, base.z, 0, (LOG * S / 0.3) * (1 - 0.3 * a / SHRINK));
    }
    got += itemLife('log', base, seed + 'log' + i, a - SHRINK, unit(camera.position.x - base.x, camera.position.z - base.z), who, t);
  }
  if (n >= LOGS) {
    const a = u - breakTime(LOGS - 1, RC, CH);
    const top = { x: g.x, y: (0.3 + 0.8) * S, z: g.z };
    for (let k = 0; k < 3; k++) fx.chips(chipList(top, { x: (k - 1) * 0.7, z: 0.3 }, seed + 'leaf' + k, a * 0.8, 12).map((q) => ({ ...q, s: q.s * 2.4 })), new THREE.Color(T.leafCol).getHex());
  }
  return got;
}

// 置き場の山（置くたびに高くなる）
const pileS = makePile('cobble'), pileW = makePile('log');
pileS.position.set(S2.stonePile.x, 0, S2.stonePile.z); pileW.position.set(S2.woodPile.x, 0, S2.woodPile.z);
scene.add(pileS, pileW);
const resPile = { wood: makePile('log'), stone: makePile('cobble') };
resPile.wood.position.set(D.campfire.x + 3.2, 0, D.campfire.z - 2.6);
resPile.stone.position.set(D.campfire.x - 3.0, 0, D.campfire.z - 2.8);
scene.add(resPile.wood, resPile.stone);
function syncResPile(day) {
  const r = D.days[day].resources;
  setPile(resPile.wood, Math.min(PILE_MAX, Math.ceil((r.wood || 0) / 6)));
  setPile(resPile.stone, Math.min(PILE_MAX, Math.ceil((r.stone || 0) / 6)));
  resPile.wood.visible = resPile.stone.visible = true;
}

function scene2(t) {
  const over = { trees: {}, rockHp: {} };
  for (const p of S2.plans) { if (p.action === 'chop') over.trees[p.tg.i] = 'tree'; else over.rockHp[p.tg.id] = p.tg.max; }
  syncNature(0, over);
  let nw = 0, ns = 0;
  const pops = [];
  const live = [];
  for (const p of S2.plans) {
    const ch = chars[p.key];
    const rockObj = p.action === 'dig' ? rockObjs[p.tg.id].obj : null, treeObj = p.action === 'chop' ? treeObjs[p.tg.i].obj : null;
    // 岩・木の見た目（掘る前・途中・後）
    const wu = t - p.t1;
    if (t >= p.t1) {
      if (rockObj) digView(rockObj, [0, 1], Math.min(wu, 50), p.ws, p.key, t);
      else chopView(treeObj, Math.min(wu, 50), p.ws, p.key, t);
    }
    ch.visible = t >= p.appear;
    if (!ch.visible) continue;
    let pose = 'walk', pos, tool = TOOL[p.action], carry = null, face = null, at = t + p.i;
    ch.scale.setScalar(1.9 * backOut(clamp01((t - p.appear) / 0.35)));
    if (t < p.enter) {
      ch.position.set(p.spawn.x, 0, p.spawn.z); ch.rotation.y = Math.atan2(S2.toward.x, S2.toward.z);
      setTool(ch, null); setCarry(ch, null); animate(ch, 'idle', t + p.i); live.push({ key: p.key, ch }); continue;
    }
    if (t < p.t1) { const q = pointAt(p.spawn, p.r1, (t - p.enter) * p.speed); pos = q; face = q.dir; }
    else if (t < p.t2) { pos = p.ws; pose = POSE[p.action]; face = Math.atan2(p.tg.x - p.ws.x, p.tg.z - p.ws.z); at = animAt(wu, pose); }
    else if (t < p.t3) { const q = pointAt(p.ws, p.r2, (t - p.t2) * p.speed); pos = q; face = q.dir; pose = 'carry'; tool = null; carry = p.action === 'chop' ? 'wood' : 'stone'; }
    else if (t < p.t4) { pos = p.drop; pose = 'idle'; tool = null; face = Math.atan2((p.action === 'chop' ? S2.woodPile : S2.stonePile).x - p.drop.x, (p.action === 'chop' ? S2.woodPile : S2.stonePile).z - p.drop.z); }
    else if (t < p.t5) { const q = pointAt(p.drop, p.r3, (t - p.t4) * p.speed); pos = q; face = q.dir; }
    else { pos = p.ws2; pose = POSE[p.action]; face = Math.atan2(p.tg2.x - p.ws2.x, p.tg2.z - p.ws2.z); at = t - p.t5; }
    if (t >= p.t3) { if (p.action === 'chop') nw += p.gain; else ns += p.gain; if (t < p.t3 + 1.3) pops.push({ pile: p.action === 'chop' ? pileW : pileS, n: p.gain, a: t - p.t3 }); }
    setTool(ch, tool); setCarry(ch, carry);
    ch.position.set(pos.x, 0, pos.z);
    if (face !== null && face !== undefined) ch.rotation.y = face;
    animate(ch, pose, at);
    live.push({ key: p.key, ch });
  }
  setPile(pileS, Math.min(PILE_MAX, 3 + ns)); setPile(pileW, Math.min(PILE_MAX, 3 + nw));
  pileS.visible = pileW.visible = true;
  for (const q of pops) fx.plus('+' + q.n, q.pile.position.x, 2.4 + q.a * 0.7, q.pile.position.z, q.a < 1 ? 1 : (1.3 - q.a) / 0.3, '#fff6c8', 1.5);
  return live;
}

// ---------- 鉄が出る場面（sim.js の「見つけた」の日・人・岩のまま） ----------
const IRON = FIND ? (() => {
  const key = FIND.who[0];
  const prev = D.days[IRON_D - 1].rocks.find((r) => r.id === FIND.rock);
  const rk = D.days[IRON_D].rocks.find((r) => r.id === FIND.rock) || prev;
  const from = rk.max - prev.hp;
  let bi = rk.blocks.indexOf('i', from); if (bi < 0) bi = rk.blocks.indexOf('i');
  const toC = unit(-rk.x, -rk.z), sd = { x: -toC.z, z: toC.x };
  const ws = { x: rk.x + toC.x * 2.3 * 0.8 + sd.x * 2.3 * 0.6, z: rk.z + toC.z * 2.3 * 0.8 + sd.z * 2.3 * 0.6 };
  return { key, rk, bi, ws, toC, sd };
})() : null;
function ironScene(t) {
  const u = t - IRON_WIN[0] - 0.15;
  const o = rockObjs[IRON.rk.id].obj;
  setRockHp(o, IRON.rk.max - IRON.bi); // 鉄のブロックがいちばん上に出ている
  const ch = chars[IRON.key]; ch.visible = true; ch.scale.setScalar(1.9);
  setTool(ch, 'pick'); setCarry(ch, null);
  ch.position.set(IRON.ws.x, 0, IRON.ws.z); ch.rotation.y = Math.atan2(IRON.rk.x - IRON.ws.x, IRON.rk.z - IRON.ws.z);
  const broke = u > breakTime(0, RD) + 0.4;
  animate(ch, broke ? 'idle' : 'dig', broke ? t : animAt(Math.max(0, u), 'dig'));
  digView(o, [IRON.bi], Math.max(-1, u), IRON.ws, 'iron', t);
  return [{ key: IRON.key, ch }];
}

// ---------- 道 ----------
let roadObj = null, roadN = -1;
function syncRoads(dayF) {
  const bs = D.buildings.filter((b) => b.day <= dayF);
  if (bs.length === roadN) return;
  if (roadObj) scene.remove(roadObj);
  roadObj = makeRoads(bs, D.plots, config); scene.add(roadObj); roadN = bs.length;
}

// ---------- 建物 ----------
const bObjs = D.buildings.map((b) => {
  const g = makeBuilding(b, config);
  const wrap = new THREE.Group(); wrap.add(g);
  g.position.set(0, 0, 0); wrap.position.set(b.x, 0, b.z); wrap.rotation.y = b.rot || 0; g.rotation.y = 0;
  scene.add(wrap);
  g.updateMatrixWorld(true);
  const emit = g.userData.steam ? [] : null;
  if (emit) for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshLambertMaterial({ color: g.userData.steam.dark ? 0x9a9a9a : 0xffffff, transparent: true, opacity: 0.6 }));
    m.castShadow = false; wrap.add(m); emit.push(m);
  }
  return { b, wrap, g, emit, hands: g.userData.clockHand || [], cows: g.userData.cows || [] };
});
const backOut = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
function syncBuildings(dayF, t, popDays = 0.45) {
  for (const o of bObjs) {
    const p = (dayF - o.b.day) / popDays;
    o.wrap.visible = p >= 0;
    if (p < 0) continue;
    const k = p >= 1 ? 1 : Math.max(0.001, backOut(clamp01(p)));
    o.wrap.scale.set(lerp(0.6, 1, Math.min(1, k)), k, lerp(0.6, 1, Math.min(1, k)));
    for (const h of o.hands) h.rotation.z = -t * 0.6;
    o.cows.forEach((c, i) => { c.rotation.y = i + Math.sin(t * 0.5 + i) * 0.4; });
    if (o.emit) {
      const s = o.g.userData.steam;
      o.emit.forEach((m, i) => {
        const life = (t * 0.45 + i / o.emit.length) % 1;
        const R = rnd(o.b.id + i);
        m.position.set(s.x + (s.wide ? (R() - 0.5) * 2.4 : 0) + life * 0.6, s.y + life * 2.2, s.z + (s.wide ? (R() - 0.5) * 2.4 : 0));
        m.scale.setScalar(1 + life * 1.2); m.material.opacity = 0.6 * (1 - life);
      });
    }
  }
  fire.visible = !D.buildings.some((b) => b.type === 'plaza' && b.day <= dayF);
  flame.scale.y = 0.8 + Math.sin(t * 12) * 0.2;
}

// ---------- その日の町で働く・運ぶ村人 ----------
const walkCache = {};
function walkersFor(day) {
  if (walkCache[day]) return walkCache[day];
  const snap = D.days[day];
  const obstacles = obsForDay(day);
  const stores = D.buildings.filter((b) => b.day <= day && (b.type === 'storehouse' || b.type === 'plaza'));
  const store = stores.pop() || { x: D.campfire.x, z: D.campfire.z + 3 };
  const drop0 = pushOut({ x: store.x * 0.82, z: store.z * 0.82 }, obstacles);
  return (walkCache[day] = snap.active.filter((k) => snap.life[k]).map((key) => {
    const [action, target] = snap.life[key];
    const tg = objPos(target, day);
    const ws = workSpot(key, action, tg);
    pushOut(ws, obstacles.filter((o) => !tg || Math.hypot(o.x - tg.x, o.z - tg.z) > 0.2));
    const da = (hash(key + 'd') % 360) * Math.PI / 180, dr = 2 + (hash(key + 'r') % 30) / 10;
    const drop = pushOut({ x: drop0.x + Math.cos(da) * dr, z: drop0.z + Math.sin(da) * dr }, obstacles);
    const r2 = routeAround(ws, drop, obstacles), r4 = routeAround(drop, ws, obstacles);
    const l2 = routeLength(ws, r2), l4 = routeLength(drop, r4);
    const sp = 2.6, work = 6 + (hash(key) % 4);
    const cyc = work + l2 / sp + 1.6 + l4 / sp;
    return { key, action, tg, ws, drop, r2, r4, l2, l4, sp, work, cyc, off: (hash(key + 'o') % 1000) / 1000 * cyc, job: snap.life[key][3] };
  }));
}
let NEAR_CUT = 12;
function sceneDay(t, day, skip = new Set()) {
  const live = [];
  for (const p of walkersFor(day)) {
    if (skip.has(p.key)) continue;
    const ch = chars[p.key];
    let u = (t + p.off) % p.cyc, pose, pos, face = null, tool = TOOL[p.action], carry = null;
    if (u < p.work) { pos = p.ws; pose = POSE[p.action] || 'gather'; if (p.tg) face = Math.atan2(p.tg.x - p.ws.x, p.tg.z - p.ws.z); }
    else if ((u -= p.work) < p.l2 / p.sp) { const q = pointAt(p.ws, p.r2, u * p.sp); pos = q; face = q.dir; pose = 'carry'; tool = null; carry = p.job; }
    else if ((u -= p.l2 / p.sp) < 1.6) { pos = p.drop; pose = 'idle'; tool = null; }
    else { u -= 1.6; const q = pointAt(p.drop, p.r4, u * p.sp); pos = q; face = q.dir; pose = 'walk'; }
    if (Math.hypot(pos.x - camera.position.x, pos.z - camera.position.z) < NEAR_CUT) continue;
    ch.visible = true;
    setTool(ch, tool); setCarry(ch, carry);
    ch.position.set(pos.x, 0, pos.z); if (face !== null && face !== undefined) ch.rotation.y = face;
    animate(ch, pose, t + (hash(p.key) % 100) / 10);
    live.push({ key: p.key, ch });
  }
  return live;
}

// ---------- 工事の足場 ----------
function makeScaffold(w) {
  const g = new THREE.Group();
  for (const [x, z] of [[-w, -w], [w, -w], [-w, w], [w, w]]) box(0.25, 3.2, 0.25, 0x9b6b3d, x, 1.6, z, g);
  for (const y of [1.2, 2.6]) { box(w * 2 + 0.3, 0.2, 0.2, 0x8a5a33, 0, y, -w, g); box(w * 2 + 0.3, 0.2, 0.2, 0x8a5a33, 0, y, w, g); box(0.2, 0.2, w * 2 + 0.3, 0x8a5a33, -w, y, 0, g); box(0.2, 0.2, w * 2 + 0.3, 0x8a5a33, w, y, 0, g); }
  box(w * 2, 0.15, w * 2, 0xb08a5a, 0, 0.08, 0, g);
  scene.add(g); g.visible = false; return g;
}
const H0 = D.buildings.filter((b) => b.type !== 'plaza').sort((a, b) => a.day - b.day)[0];
const scaf0 = makeScaffold(1.6), scafVB = makeScaffold(1.8);
const stacks = { w0: makePile('log'), s0: makePile('cobble'), wV: makePile('log'), sV: makePile('cobble') };
for (const k in stacks) { setPile(stacks[k], 12); stacks[k].visible = false; scene.add(stacks[k]); }
function placeSite(b, scaf, sw, ss) {
  if (!b) return;
  const toC = unit(-b.x, -b.z), side = { x: -toC.z, z: toC.x };
  scaf.position.set(b.x, 0, b.z); scaf.rotation.y = b.rot || 0;
  sw.position.set(b.x + toC.x * 2.8 + side.x * 3.4, 0, b.z + toC.z * 2.8 + side.z * 3.4);
  ss.position.set(b.x + toC.x * 2.6 - side.x * 3.6, 0, b.z + toC.z * 2.6 - side.z * 3.6);
}
placeSite(H0, scaf0, stacks.w0, stacks.s0);
placeSite(VB, scafVB, stacks.wV, stacks.sV);
const VB_START = DD >= 0 ? DD + 1 : VBD - 2;
function syncSites(dayF) {
  const on0 = H0 && dayF >= H0.day - 2 && dayF < H0.day;
  scaf0.visible = !!on0; if (on0) scaf0.scale.y = clamp01(0.4 + 0.6 * (1 - (H0.day - dayF) / 2));
  stacks.w0.visible = stacks.s0.visible = !!(H0 && dayF >= H0.day - 2 && dayF < H0.day + 0.3);
  const onV = VB && VB !== H0 && dayF >= VB_START && dayF < VBD;
  scafVB.visible = !!onV;
  stacks.wV.visible = stacks.sV.visible = !!(onV || (VB && VB !== H0 && dayF >= VB_START && dayF < VBD + 0.3));
  return { on0, onV };
}
function siteCrew(t, day, dayF, skip) {
  const live = [];
  const act = new Set(D.days[day].active);
  const put = (b, n, r) => {
    const toC = unit(-b.x, -b.z), base = Math.atan2(toC.z, toC.x);
    (b.builders || []).filter((k) => act.has(k)).slice(0, n).forEach((key, i) => {
      const a = base + [-1.1, 1.1, 0][i], p = { x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r };
      const ch = chars[key]; ch.visible = true; ch.scale.setScalar(1.9); ch.position.set(p.x, 0, p.z); ch.rotation.y = Math.atan2(b.x - p.x, b.z - p.z);
      setCarry(ch, null); setTool(ch, i % 2 ? 'axe' : 'pick'); animate(ch, i % 2 ? 'chop' : 'dig', t + i * 0.37);
      skip.add(key); live.push({ key, ch });
    });
  };
  const s = syncSites(dayF);
  if (s.on0) put(H0, 2, 3.3);
  if (s.onV) put(VB, 3, 3.3);
  return live;
}

// ---------- 夜の敵 ----------
const mobPool = [];
const getMob = (type, i) => { const k = type + i; let m = mobPool.find((x) => x.k === k); if (!m) { m = { k, g: makeMob(type) }; m.g.visible = false; scene.add(m.g); mobPool.push(m); } return m.g; };
const arrowPool = [];
const getArrow = (i) => { while (arrowPool.length <= i) { const a = makeArrow(); a.scale.setScalar(1.7); a.visible = false; scene.add(a); arrowPool.push(a); } const a = arrowPool[i]; a.visible = true; return a; };
function hideMobs() { for (const m of mobPool) m.g.visible = false; for (const a of arrowPool) a.visible = false; }
// 0 日目の夜：だれもいない平地の向こうを、ゾンビがうろつくだけ
function wanderMobs(t, n) {
  if (n < 0.45) return;
  const tw = S2.toward, sd = S2.side, C = S2.center;
  for (let i = 0; i < 3; i++) {
    const g = getMob('zombie', i);
    g.scale.setScalar(1.7); g.position.y = 0;
    const base = { x: C.x + tw.x * (1 + (i % 2) * 2.5) + sd.x * (i - 1) * 3.8, z: C.z + tw.z * (1 + (i % 2) * 2.5) + sd.z * (i - 1) * 3.8 };
    const s = Math.sin(t * 0.45 + i * 2.1) * 1.8, ds = Math.cos(t * 0.45 + i * 2.1);
    g.position.set(base.x + sd.x * s, 0, base.z + sd.z * s);
    g.rotation.y = Math.atan2(sd.x * Math.sign(ds), sd.z * Math.sign(ds));
    animateMob(g, 'walk', t);
  }
}
// 敵が来た夜：ゾンビとクモは近くまで来て、たいまつで追い払われる。スケルトンは離れた所から弓を射る。見張りは盾で受ける
const ATKV = ATK ? (() => {
  const n = ATK.n, f = unit(n.from.x, n.from.z), fs = { x: -f.z, z: f.x };
  const act = new Set(D.days[ATK.d].active);
  const gk = (n.guards || []).filter((k) => act.has(k)).slice(0, 3);
  const obs = obsForDay(ATK.d);
  const posts = gk.map((key, i) => ({ key, p: pushOut({ x: f.x * 23 + fs.x * (i - (gk.length - 1) / 2) * 2.8, z: f.z * 23 + fs.z * (i - (gk.length - 1) / 2) * 2.8 }, obs) }));
  const list = [];
  for (const g of n.groups || []) for (let k = 0; k < g.n; k++) list.push(g.type);
  const cnt = list.length;
  const mobs = list.map((type, i) => {
    const o = (i - (cnt - 1) / 2);
    const r = type === 'skeleton' ? 31.5 : 26.4;
    return { type, i, start: { x: f.x * 42 + fs.x * o * 3.2, z: f.z * 42 + fs.z * o * 3.2 }, goal: { x: f.x * r + fs.x * o * 2.0, z: f.z * r + fs.z * o * 2.0 } };
  });
  const cam = { x: f.x * 10 + fs.x * 12.5, y: 9.5, z: f.z * 10 + fs.z * 12.5 }, tgt = { x: f.x * 27.5, y: 1.2, z: f.z * 27.5 };
  const text0 = `${ATK.d}日目の夜`;
  const text1 = `${(n.groups || []).map((g) => `${MOB_JA[g.type]} ${g.n} 体`).join('と')}`;
  const text2 = n.result === 'repelled' ? '見張りが追い払った' : '見張りが戦って追い返した';
  const archers = list.includes('skeleton');
  return { f, fs, posts, mobs, cam, tgt, text0, text1, text2, archers };
})() : null;
const SHOT = 0.9; // 弓を引いて放つ 1 回
function attackScene(t) {
  const u = t - atkSeg.t1, live = [];
  const fight = u >= 2.2 && u < 3.5, shooting = ATKV.archers && u >= 2.0 && u < 3.5;
  for (const { key, p } of ATKV.posts) {
    const ch = chars[key]; ch.visible = true; ch.scale.setScalar(1.9); ch.position.set(p.x, 0, p.z); ch.rotation.y = Math.atan2(ATKV.f.x, ATKV.f.z);
    setCarry(ch, null); setTool(ch, 'torch'); setShield(ch, true); ch.userData.block = shooting;
    animate(ch, fight && !shooting ? 'chop' : fight ? 'chop' : 'idle', t + (hash(key) % 10) * 0.1);
    live.push({ key, ch });
  }
  const dawn = u >= 3.5;
  let ai = 0;
  for (const mb of ATKV.mobs) {
    const g = getMob(mb.type, 10 + mb.i);
    g.scale.setScalar(1.7); g.position.y = 0;
    if (u < 0.6) continue;
    const face = Math.atan2(mb.goal.x - mb.start.x, mb.goal.z - mb.start.z);
    if (u < 2.0) { const k = ease((u - 0.6) / 1.4) * 0.6 + ((u - 0.6) / 1.4) * 0.4; g.position.set(lerp(mb.start.x, mb.goal.x, k), 0, lerp(mb.start.z, mb.goal.z, k)); g.rotation.y = face; animateMob(g, 'walk', t); }
    else if (!dawn) {
      g.position.set(mb.goal.x, 0, mb.goal.z); g.rotation.y = face;
      if (mb.type === 'skeleton') {
        const k = ((u - 2.0) % SHOT) / SHOT; animateMob(g, 'shoot', t, k);
        // 放った矢：飛んで、見張りの手前の地面に刺さる（刺さったまま残る）
        const target = ATKV.posts[mb.i % Math.max(1, ATKV.posts.length)];
        for (let j = 0; j < 2; j++) {
          const rel = u - 2.0 - j * SHOT - 0.6 * SHOT; if (rel < 0) continue;
          const tp = target ? target.p : { x: ATKV.f.x * 23, z: ATKV.f.z * 23 };
          const dx = mb.goal.x - tp.x, dz = mb.goal.z - tp.z, dl = Math.hypot(dx, dz) || 1;
          const to = { x: tp.x + (dx / dl) * (1.4 + j * 0.9) + (j - 0.5) * 1.2 * (-dz / dl), y: 0.15, z: tp.z + (dz / dl) * (1.4 + j * 0.9) + (j - 0.5) * 1.2 * (dx / dl) };
          const fr = { x: mb.goal.x - (dx / dl) * 0.8, y: 2.7, z: mb.goal.z - (dz / dl) * 0.8 };
          arrowAt(getArrow(ai++), fr, to, rel / 0.35, 1.2);
        }
      } else animateMob(g, 'hit', t, ((u - 2.2) % 0.55) / 0.55);
    } else {
      // 朝：ゾンビは日に焼かれて燃え（火と煙）、ほかは森へ逃げる。刺さった矢は残る
      for (let j = 0; j < 2 && mb.type === 'skeleton'; j++) {
        const target = ATKV.posts[mb.i % Math.max(1, ATKV.posts.length)], tp = target ? target.p : { x: ATKV.f.x * 23, z: ATKV.f.z * 23 };
        const dx = mb.goal.x - tp.x, dz = mb.goal.z - tp.z, dl = Math.hypot(dx, dz) || 1;
        const to = { x: tp.x + (dx / dl) * (1.4 + j * 0.9) + (j - 0.5) * 1.2 * (-dz / dl), y: 0.15, z: tp.z + (dz / dl) * (1.4 + j * 0.9) + (j - 0.5) * 1.2 * (dx / dl) };
        arrowAt(getArrow(ai++), { x: mb.goal.x - (dx / dl) * 0.8, y: 2.7, z: mb.goal.z - (dz / dl) * 0.8 }, to, 1, 1.2);
      }
      const k = clamp01((u - 3.5) / 1.0);
      if (mb.type === 'zombie') { g.position.set(mb.goal.x, 0, mb.goal.z); g.rotation.y = face; const b = clamp01((u - 3.55) / 1.45); animateMob(g, 'burn', t, b); g.visible = b < 1; }
      else { g.position.set(lerp(mb.goal.x, mb.start.x, k), 0, lerp(mb.goal.z, mb.start.z, k)); g.rotation.y = face + Math.PI; animateMob(g, 'flee', t); g.visible = k < 1; }
    }
  }
  return live;
}

// ---------- 明かり ----------
const lightAll = [];
for (const o of bObjs) { o.wrap.updateMatrixWorld(true); for (const l of o.g.userData.lights || []) { const p = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(o.g.matrixWorld); lightAll.push({ x: p.x, y: p.y, z: p.z, day: o.b.day }); } }
const sky = makeSky(scene, { hemi, sun, sunDist: 60, radius: 200, maxLights: 8, nightBoost: 0.45 });

// ---------- カメラ ----------
function look(px, py, pz, tx, ty, tz) { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); }
const lerpCam = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const s2cam = (k) => {
  const tw = S2.toward, sd = S2.side, C = S2.center;
  const d = S2.dist * lerp(0.9, 0.82, k), so = lerp(-1.5, 1.5, k);
  return [C.x + tw.x * d + sd.x * so, d * 0.3, C.z + tw.z * d + sd.z * so, C.x - tw.x * 0.5, 1.8, C.z - tw.z * 0.5];
};
// 寄り：人と、掘っている物を横から
const blockers = (day) => [...D.trees.filter((t, i) => D.days[day].trees[i] === 't' || (day === 0 && dynTree.has(i))).map((t) => ({ x: t.x, z: t.z, r: 1.7 * (t.size || 1) })), ...D.days[day].rocks.filter((r) => r.hp > 0).map((r) => ({ x: r.x, z: r.z, r: 1.4 }))];
const sideCache = {};
function sideCam(ws, tg, dist, h, ty = 1.4, bias = 0.5, day = 0) {
  const fx = tg.x - ws.x, fz = tg.z - ws.z, fl = Math.hypot(fx, fz) || 1, tw = S2.toward;
  const cx = lerp(ws.x, tg.x, bias), cz = lerp(ws.z, tg.z, bias);
  const key = [ws.x, ws.z, tg.x, tg.z, dist, day].map((v) => Math.round(v * 10)).join(',');
  if (!(key in sideCache)) {
    // 左右どちらから見るか：カメラと見る所の間に木や岩が少ない方
    const obs = blockers(day).filter((o) => Math.hypot(o.x - tg.x, o.z - tg.z) > 0.5);
    // 横の向きを少しずつ回して、間に木や岩がいちばん少ない向きを選ぶ（同じなら真横）
    const pref = (-fz / fl) * tw.x + (fx / fl) * tw.z >= 0 ? 1 : -1;
    let best = null;
    for (const s of [pref, -pref]) for (const r of [0, 0.45, -0.45, 0.85, -0.85]) {
      const bx0 = (-fz / fl) * s, bz0 = (fx / fl) * s, c0 = Math.cos(r), s0 = Math.sin(r);
      const bx = bx0 * c0 - bz0 * s0, bz = bx0 * s0 + bz0 * c0;
      let c = Math.abs(r) * 0.5 + (s === pref ? 0 : 0.3);
      for (let k = 0.12; k <= 1; k += 0.04) { const x = cx + bx * dist * k, z = cz + bz * dist * k; for (const o of obs) if (Math.hypot(x - o.x, z - o.z) < o.r) c += 1; }
      if (!best || c < best.c) best = { c, bx, bz };
    }
    sideCache[key] = best;
  }
  const px = sideCache[key].bx, pz = sideCache[key].bz;
  return [cx + px * dist, h, cz + pz * dist, cx, ty, cz];
}
const P0 = S2.plans[0];
const CLOSE = [P0.t1 - 0.6, P0.t3 + 0.9]; // 1 人目の「たたく → … → 運ぶ」を寄りで
const WIDE2 = [CLOSE[1] + 0.3, D1_END];
function closeCam(t) {
  const dig = sideCam(P0.ws, P0.tg, 9.0, 4.0, 1.8, 0.5);
  const pile = S2.stonePile, carry = sideCam(P0.ws, pile, 11.0, 4.8, 1.6, 0.5);
  const k = ease((t - P0.t2 + 0.2) / 1.0);
  return lerpCam(dig, carry, k);
}
const focusAt = (dayF) => {
  if (!H0 || !VB) return { x: 0, z: 0 };
  const k = clamp01((dayF - (H0.day + 0.5)) / Math.max(1, VB_START - H0.day));
  return { x: lerp(H0.x, VB.x, k) * 0.7, z: lerp(H0.z, VB.z, k) * 0.7 };
};
function orbitCam(t) {
  const dayF = Math.min(LAST + 0.4, dayFloatAt(Math.min(t, T_END - 0.01)));
  const F = focusAt(dayF);
  const a = Math.atan2(F.x, F.z) + Math.sin(t * 0.13) * 0.25 + 0.15;
  const r = Math.hypot(F.x, F.z) + 22;
  return [Math.sin(a) * r, 14, Math.cos(a) * r, F.x * 0.75, 1.8, F.z * 0.75];
}
// 終わり：投票で建った建物を画面のまん中に
const endCam = () => {
  if (!VB) return orbitCam(T_END);
  const toC = unit(-VB.x, -VB.z), sd = { x: -toC.z, z: toC.x };
  return [VB.x + toC.x * 21 + sd.x * 6, 11, VB.z + toC.z * 21 + sd.z * 6, VB.x, 2.2, VB.z];
};
function ironCam() {
  const o = { x: IRON.rk.x, z: IRON.rk.z };
  return sideCam(IRON.ws, o, 8.6, 3.9, 1.7, 0.5, IRON_D);
}
function cameraAt(t) {
  if (t < SC.s2[0]) {
    const k = ease(t / SC.s2[0]), e = s2cam(0), C = S2.center, m = lerp(1.3, 1, k);
    return look(C.x + (e[0] - C.x) * m, e[1] * m, C.z + (e[2] - C.z) * m, e[3], e[4], e[5]);
  }
  if (t < SEQ0) {
    const wide = s2cam(clamp01((t - SC.s2[0]) / (SEQ0 - SC.s2[0])));
    const kin = ease((t - CLOSE[0]) / 0.7) * (1 - ease((t - CLOSE[1]) / 0.8));
    return look(...lerpCam(wide, closeCam(Math.min(t, CLOSE[1])), kin));
  }
  if (inIron(t)) { const k = ease((t - IRON_WIN[0]) / 0.5) * (1 - ease((t - IRON_WIN[1] + 0.45) / 0.45)); return look(...lerpCam(orbitCam(t), ironCam(), k)); }
  if (inAtk(t)) {
    const { cam, tgt } = ATKV; const u = (t - atkSeg.t1) / (atkSeg.t2 - atkSeg.t1);
    const c = [cam.x - ATKV.f.x * u * 2, cam.y, cam.z - ATKV.f.z * u * 2, tgt.x, tgt.y, tgt.z];
    const k = ease((t - atkSeg.t1) / 0.3) * (1 - ease((t - atkSeg.t2 + 0.3) / 0.3));
    return look(...lerpCam(orbitCam(t), c, k));
  }
  const last = SEG[SEG.length - 1];
  if (t >= last.t0 && VB) { const k = ease((t - last.t0 - 0.2) / 1.2); return look(...lerpCam(orbitCam(t), endCam(), k)); }
  return look(...orbitCam(t));
}

// ---------- 文字 ----------
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function caption(lines, y, size, alpha = 1, opts = {}) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lh = size * 1.28;
  const wmax = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (opts.band !== false) {
    ctx.fillStyle = opts.bg || 'rgba(24, 36, 28, 0.62)';
    roundRect(W / 2 - wmax / 2 - 44, y - lh / 2 - 22, wmax + 88, lh * lines.length + 44, 34); ctx.fill();
  }
  lines.forEach((l, i) => {
    const yy = y + i * lh;
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(l, W / 2, yy);
    ctx.fillStyle = opts.color || '#fffdf4'; ctx.fillText(l, W / 2, yy);
  });
  ctx.restore();
}
const fade = (t, a, b, f = 0.3) => Math.min(clamp01((t - a) / f), clamp01((b - t) / f));
function dayBadge(day, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.font = `700 84px ${FONT}`; ctx.textBaseline = 'middle';
  const txt = `${day}日目`; const w = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(47, 74, 55, 0.92)'; roundRect(64, SAFE_TOP + 24, w + 72, 124, 62); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(txt, 100, SAFE_TOP + 88);
  ctx.restore();
}
function voteCard(t, a, b) {
  const appear = ease((t - a) / 0.35), leave = ease((b - t) / 0.35);
  const k = Math.min(appear, leave);
  if (k <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(10, 16, 12, ${0.5 * k})`; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = k;
  ctx.translate(W / 2, H / 2); ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k); ctx.translate(-W / 2, -H / 2);
  const x = 80, y = 470, w = W - 160, h = 1010;
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 44); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#6f6656'; ctx.font = `700 44px ${FONT}`; ctx.fillText(`${DD}日目の投票`, W / 2, y + 90);
  ctx.fillStyle = '#2f2a22'; ctx.font = `700 84px ${FONT}`; ctx.fillText('次に何を作る？', W / 2, y + 190);
  const total = DEC.votes.A + DEC.votes.B + DEC.votes.C;
  const grow = lerp(0.3, 1, ease((t - a - 0.35) / 1.5));
  const decided = t > a + 1.95;
  const COLS = { A: '#d0603e', B: '#3f78b8', C: '#4b9a5e' };
  DEC.options.forEach((o, i) => {
    const ry = y + 320 + i * 200;
    const win = decided && o.key === DEC.key;
    if (win) { ctx.fillStyle = 'rgba(63, 120, 184, 0.12)'; roundRect(x + 30, ry - 80, w - 60, 172, 28); ctx.fill(); ctx.strokeStyle = COLS[o.key]; ctx.lineWidth = 6; ctx.stroke(); }
    ctx.globalAlpha = k * (decided && !win ? 0.45 : 1);
    ctx.fillStyle = COLS[o.key]; roundRect(x + 60, ry - 50, 100, 100, 22); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 64px ${FONT}`; ctx.fillText(o.key, x + 110, ry + 2);
    ctx.textAlign = 'left'; ctx.fillStyle = '#2f2a22'; ctx.font = `700 62px ${FONT}`; ctx.fillText(o.name, x + 190, ry - 20);
    const n = Math.round(DEC.votes[o.key] * grow);
    const bw = w - 190 - 210;
    ctx.fillStyle = '#ece4d2'; roundRect(x + 190, ry + 30, bw, 26, 13); ctx.fill();
    ctx.fillStyle = COLS[o.key]; roundRect(x + 190, ry + 30, Math.max(26, bw * (DEC.votes[o.key] / total) * grow), 26, 13); ctx.fill();
    ctx.textAlign = 'right'; ctx.fillStyle = '#2f2a22'; ctx.font = `700 54px ${FONT}`; ctx.fillText(`${n}票`, x + w - 50, ry + 10);
    ctx.textAlign = 'center'; ctx.globalAlpha = k;
  });
  if (decided) {
    const s = ease((t - a - 1.95) / 0.3);
    ctx.globalAlpha = k * s;
    ctx.fillStyle = '#c0392b'; ctx.font = `700 76px ${FONT}`;
    ctx.fillText(`${DEC.name}に決定`, W / 2, y + h - 90);
  }
  ctx.restore();
}
// 顔（スキンから）
const skinImg = {};
for (const v of D.villagers) { const im = new Image(); im.src = '../skins/skin_' + String(v.skin).padStart(3, '0') + '.png'; skinImg[v.key] = im; }
function face(key, x, y, s) {
  const im = skinImg[key]; if (!im || !im.complete) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#3b3326'; ctx.fillRect(x - 5, y - 5, s + 10, s + 10);
  ctx.drawImage(im, 8, 8, 8, 8, x, y, s, s);
  ctx.drawImage(im, 40, 8, 8, 8, x - s * 0.06, y - s * 0.06, s * 1.12, s * 1.12);
  ctx.imageSmoothingEnabled = true;
}

// ---------- 「参加したい」のコメント（顔だけ。名前は出さない）と、村人の数 ----------
const JOINS = [];
for (const p of S2.plans) JOINS.push({ key: p.key, t: p.appear - 0.12 });
for (const s of SEG) {
  if (s.d < 2) continue;
  const before = new Set(D.days[s.d - 1].active);
  D.days[s.d].active.filter((k) => !before.has(k)).forEach((key, j) => JOINS.push({ key, t: s.t0 + 0.12 + j * 0.45 }));
}
function villagerCount(t) {
  if (t < SC.join[0]) return 0;
  let n = JOINS.filter((j) => j.t <= t).length;
  const d1 = D.days[1].active.length;
  if (t >= SC.s2[0]) n += Math.max(0, d1 - S2.plans.length);
  return n;
}
function counterChip(n) {
  ctx.save(); ctx.font = `700 60px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  const txt = `村人 ${n} 人`, w = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(255, 253, 244, 0.94)'; roundRect(W - 64 - w - 60, SAFE_TOP + 36, w + 60, 100, 50); ctx.fill();
  ctx.fillStyle = '#2f4a37'; ctx.fillText(txt, W - 94, SAFE_TOP + 88);
  ctx.restore();
}
function imageLabel() {
  ctx.save(); ctx.font = `700 34px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  const w = ctx.measureText('イメージ').width;
  ctx.fillStyle = 'rgba(20, 24, 20, 0.55)'; roundRect(W - 64 - w - 36, SAFE_TOP + 150, w + 36, 56, 28); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText('イメージ', W - 82, SAFE_TOP + 179);
  ctx.restore();
}
const CARD_TOP = SAFE_TOP + 230, CARD_H = 104;
function commentCards(t) {
  const shown = JOINS.filter((j) => t >= j.t && t < j.t + 1.9).slice(-3);
  shown.forEach((j, i) => {
    const k = ease((t - j.t) / 0.25), out = ease((j.t + 1.9 - t) / 0.3);
    const a = Math.min(k, out); if (a <= 0) return;
    const w = 400, x = W - 64 - w + (1 - k) * 120, y = CARD_TOP + i * (CARD_H + 18);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; roundRect(x + 4, y + 6, w, CARD_H, 30); ctx.fill();
    ctx.fillStyle = '#fffdf7'; roundRect(x, y, w, CARD_H, 30); ctx.fill();
    face(j.key, x + 20, y + 18, 68);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2f2a22'; ctx.font = `700 44px ${FONT}`; ctx.fillText('参加したい', x + 116, y + CARD_H / 2 + 2);
    ctx.restore();
  });
}

// ---------- 1 コマ ----------
window.renderFrame = (t) => {
  hideAll(); hideMobs(); fx.begin();
  pileS.visible = pileW.visible = false;
  scaf0.visible = scafVB.visible = false;
  for (const k in stacks) stacks[k].visible = false;
  resPile.wood.visible = resPile.stone.visible = false;
  const seg = segAt(t), dayF = dayFloatAt(t), bd = badgeDay(t);
  cameraAt(t);
  sky.set(hourAt(t), { x: camera.position.x * 0.5, z: camera.position.z * 0.5 });
  let live = [];
  if (t < SEQ0) {
    syncBuildings(-1, t); syncRoads(-1);
    if (t >= SC.join[0]) live = scene2(t); else { syncNature(0); wanderMobs(t, sky.n); }
    fire.visible = t >= SC.join[0];
  } else {
    const d = Math.min(LAST, seg.d);
    syncNature(d); syncBuildings(dayF, t); syncRoads(dayF); syncResPile(d);
    if (inAtk(t)) { syncSites(dayF); live = attackScene(t); }
    else if (sky.n > 0.6) syncSites(dayF);
    else {
      const skip = new Set();
      if (inIron(t)) { live = ironScene(t); skip.add(IRON.key); NEAR_CUT = 9; } else NEAR_CUT = 14;
      live = live.concat(siteCrew(t, d, dayF, skip)); live = live.concat(sceneDay(t, Math.max(1, d), skip));
    }
  }
  sky.anchors = lightAll.filter((l) => l.day <= dayF);
  if (fire.visible) sky.anchors.push({ x: D.campfire.x, y: 1.4, z: D.campfire.z });
  if (inAtk(t)) for (const { p } of ATKV.posts) sky.anchors.push({ x: p.x, y: 2.6, z: p.z });
  sky.placeLights(camera.position);
  fx.end();
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);

  // 文字（上下 15% はあける）
  const CAP = SAFE_BOTTOM - 190;
  const ending = t >= T_END;
  if (!ending) dayBadge(bd);
  counterChip(villagerCount(t));
  if (t >= SC.join[0]) imageLabel();
  commentCards(t);
  if (t < SC.join[0]) caption(['まだ、だれもいない'], H / 2 + 330, 84, fade(t, 0.4, SC.join[0] - 0.2, 0.35));
  if (inS(t, 'join')) caption(['「参加したい」のコメントで、', '村人が 1 人ずつ'], CAP, 66, fade(t, SC.join[0] + 0.3, SC.join[1] - 0.1));
  if (t >= SC.s2[0] && t < SEQ0) {
    const b0 = P0.t1 + breakTime(0, RD), b1 = P0.t1 + breakTime(1, RD);
    caption(['みんなで、木を切って岩を掘る'], CAP, 64, fade(t, SC.s2[0] + 0.1, CLOSE[0] + 0.3));
    caption(['たたくたびに、ひびが入る'], CAP, 66, fade(t, P0.t1 + 0.2, b0 + 0.05, 0.2));
    caption(['こわれて、落ちる'], CAP, 66, fade(t, b0 + 0.15, b0 + 1.3, 0.2));
    caption(['もう 1 つ'], CAP, 66, fade(t, b0 + 1.4, b1 + 0.1, 0.2));
    caption(['拾って、運ぶ'], CAP, 66, fade(t, b1 + 0.2, P0.t3 + 0.9, 0.2));
    caption(['木は、下から 1 つずつ'], CAP, 64, fade(t, WIDE2[0] + 0.2, D1_END - 0.1, 0.25));
  }
  if (t >= SEQ0 && !ending) {
    const s = seg, inDay = t < s.t1;
    if (inAtk(t)) {
      const u = t - atkSeg.t1;
      caption(['夜は、森から敵がやって来る'], CAP, 62, fade(u, 0.3, 1.95, 0.25));
      caption([ATKV.text0, ATKV.text1, ATKV.text2], CAP - 70, 54, fade(u, 2.05, 3.45, 0.2));
      caption(['朝日で、ゾンビは燃えて消える'], CAP, 60, fade(u, 3.6, (atkSeg.t2 - atkSeg.t1) * 0.92, 0.2));
    } else if (inDay) {
      const busy = (s.d === IRON_D && inIron(t)) || (s.d === DD);
      if (s.d === 2 && !busy) caption(['1 日ずつ、町が育つ'], CAP, 66, fade(t, s.t0 + 0.1, s.t1 - 0.05, 0.2));
      if (inIron(t)) {
        const bt = IRON_WIN[0] + 0.15 + breakTime(0, RD);
        caption(['ときどき、岩から鉱石が出る'], CAP, 62, fade(t, IRON_WIN[0] + 0.2, bt + 0.05, 0.2));
        caption(['村人が鉄鉱石を見つけた'], CAP, 66, fade(t, bt + 0.15, IRON_WIN[1], 0.2), { color: '#ffd9b8' });
      }
      if (H0 && s.d === H0.day) caption([`${H0.day}日目　はじめての${config.buildings[H0.type].name}`], CAP, 64, fade(t, popTime(s) + 0.2, s.t1 + 0.2, 0.15));
      if (s.d === DD) voteCard(t, (s.d === IRON_D ? IRON_WIN[1] : s.t0) + 0.15, s.t1 - 1.05);
      if (s.d === LAST && VB) caption([`${VBD}日目　投票で決まった`, `${config.buildings[VB.type].name}が建った`], SAFE_BOTTOM - 260, 62, fade(t, popTime(s) + 0.5, T_END, 0.3));
    }
  }
  if (ending) {
    // 建物が見えるよう、暗くしすぎない。文字は上と下に分ける
    const k = ease((t - T_END) / 0.6);
    ctx.fillStyle = `rgba(12, 20, 14, ${0.22 * k})`; ctx.fillRect(0, 0, W, H);
    caption(['あなたが', '最初の村人に。'], SAFE_TOP + 250, 100, fade(t, T_END + 0.2, DURATION + 1, 0.35));
    caption(['コメントに', '『参加したい』'], SAFE_BOTTOM - 210, 94, fade(t, T_END + 0.9, DURATION + 1, 0.35), { color: '#ffe08a' });
  }
};

// 打つ音の時刻（見た目と同じ式から出す）
const SFX = [];
for (const p of S2.plans) {
  const sp = p.action === 'dig' ? RD : RC, n = p.action === 'dig' ? 10 : LOGS * CH;
  for (let k = 0; k < n; k++) SFX.push({ t: p.t1 + (k + sp.phase) / sp.rate, type: p.action, gain: 1 });
  for (let k = 0; ; k++) { const tt = p.t5 + (k + (p.action === 'dig' ? 0.65 : 0.75)) / (p.action === 'dig' ? 1.3 : 1.6); if (tt >= D1_END) break; SFX.push({ t: tt, type: p.action, gain: 0.7 }); }
}
if (IRON) for (let k = 0; k < 5; k++) SFX.push({ t: IRON_WIN[0] + 0.15 + (k + RD.phase) / RD.rate, type: 'dig', gain: 1 });
window.SFX = SFX.filter((s) => s.t < DURATION);

// スキンの画像が読み終わるまで待つ
async function waitTextures() {
  for (let i = 0; i < 200; i++) {
    let ok = true;
    for (const k in chars) chars[k].traverse((o) => { if (o.isMesh && o.material.map && !(o.material.map.image && o.material.map.image.complete && o.material.map.image.width)) ok = false; });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
await waitTextures();
const jpeg = (q) => new Promise((r) => out.toBlob(r, 'image/jpeg', q));
window.sendStills = async (list) => { for (const s of list) { window.renderFrame(s); await fetch('/__still?name=t' + String(s).replace('.', '_'), { method: 'POST', body: await jpeg(0.85) }); } return list.length; };
window.sendAll = async () => {
  await fetch('/__start', { method: 'POST' });
  const total = Math.round(DURATION * FPS);
  window.SEND = { f: 0, total };
  for (let f = 0; f < total; f++) { window.renderFrame(f / FPS); await fetch('/__frame?f=' + f, { method: 'POST', body: await jpeg(0.92) }); window.SEND.f = f + 1; }
  const r = await fetch('/__done', { method: 'POST', body: JSON.stringify({ DURATION, FPS, sfx: window.SFX }) });
  window.SEND.done = await r.text();
  return window.SEND;
};
window.REEL = { W, H, FPS, DURATION, ready: true, SEG, ATK: ATK && ATK.d, LAST, DD, VBD, IRON_D, CLOSE, WIDE2, IRON_WIN, T_END, P0: { t1: P0.t1, t2: P0.t2, t3: P0.t3 } };
window.renderFrame(0);
