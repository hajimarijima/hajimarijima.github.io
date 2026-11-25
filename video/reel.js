// インスタのリール用の縦動画（1080x1920）。window.renderFrame(t) で t 秒のコマを描く。
// tools/render_video.js がブラウザでこれを開いて、コマを書き出す。
// 見せるのは 0 日目〜2 日目だけ。順番：だれもいない → 参加（「住みたい ピッケル」の人が木のつるはしを持って来る）
// → 最初の道具を選べる → その人が岩を掘る → 整地 → 何を建てる？ → どこに建てる？ → 木を切る → 夜 → 道具を作る
// → 建て始める → チェストの中 → 池で釣り（2 日目）→ これから（イメージ）：畑が育つ・柵の動物。
// 歩く速さは人がふつうに歩くくらい（2.6／秒、背の高さ 3.8）。遠くへ行く所は歩かせずに場面を切りかえる。
// 投票の結果・場所・チェストの中身・作った道具は、どれも tools/video_days.js が記録した sim.js の結果のまま。
// 見本の村人の名前は出さない（顔と「村人」だけ）。敵は出さない（config.enemies.enabled=false）。
import * as THREE from 'three';
import { makeCharacter, animate, setTool, setCarry, setAccent, fishCycle, chibiOf } from '../js/character.js';
import { makePond, animatePond, makeBobber, makeAnimal, animateAnimal, animalPos, makeField, makeFarm, makeCanal, makePen } from '../js/farm3d.js';
import { mat, box, hash, rnd, makeBush, makeTree, makeRock } from '../js/world3d.js';
import { makeSky } from '../js/daynight.js';
import { makeForest, makeRockField, makeFx, makePile, setPile, setRock, rockScale, setTreeState, setTreeFall, setTreeCrack, makeDebris, makeChest, setChestOpen, makeMarker, MARK_COL, strikeAt, breakTime, dropPos, chipList, FALL_END, TREE_LEN, TREE_LEAF_Y } from '../js/blocks.js';
const _pv = new THREE.Vector3();
const TREE_R = 3.4; // 葉の塊の半分の幅（横の小さな塊も入れて、大きさ 1 の木）

const W = 1080, H = 1920, FPS = 30;
const SAFE_TOP = H * 0.15, SAFE_BOTTOM = H * 0.85;
const FONT = '"BIZ UDPGothic", "Yu Gothic", "Meiryo", sans-serif';
const [D, config] = await Promise.all([fetch('days.json').then((r) => r.json()), fetch('../data/config.json').then((r) => r.json())]);
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };
const backOut = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const IT = config.items;
const BN = (k) => config.buildings[k].name;

// ---------- sim.js の結果 ----------
const D1 = D.days[1], D2 = D.days[2];
const WHAT = D.decisions.find((d) => d.kind === 'what'), WHERE = D.decisions.find((d) => d.kind === 'where');
const SITE = D2.plan && D2.plan.site ? D2.plan.site : { x: WHERE.options.find((o) => o.key === WHERE.key).x, z: WHERE.options.find((o) => o.key === WHERE.key).z };
const byAction = (day, a) => day.active.filter((k) => day.life[k][0] === a);
const LEVELERS = byAction(D1, 'level').slice(0, 2);
const KJ = D1.active.find((k) => D1.life[k][7] === 'pickaxe' && D1.life[k][0] === 'dig') || byAction(D1, 'dig')[0]; // 「住みたい ピッケル」の人（1 日目に岩を掘った）
const KDG = KJ;
const KCH = byAction(D1, 'chop')[0];                 // 1 日目に木を切った人
const KFI = byAction(D2, 'fish')[0] || null;          // 2 日目、池で釣りをした人（村ではじめて魚を釣った）
const FISH_KEY = KFI ? (D2.life[KFI][6] || []).find((k) => /^fish_/.test(k)) || 'fish_funa' : 'fish_funa';
const toolKey = (kind, tier) => kind + ':' + (!tier || tier === 'hand' ? 'wood' : tier); // 道具の素材で色と形を変える
const BUILDERS = [...byAction(D2, 'level'), ...byAction(D2, 'chop')].slice(0, 3);
const TREE_SIM = D.trees.find((t) => t.id === D1.life[KCH][1]); // sim.js で切った木
const ROCK0 = D.days[0].rocks.find((r) => r.id === D1.life[KJ][1]) || D.days[1].rocks.find((r) => r.id === D1.life[KJ][1]);
const CH_TIER = D1.life[KCH][4] || 'hand'; // 木を切った人の斧（最初の道具が斧なら木の斧）
// 最初の道具（sim.js の life の 8 番目）。コメントに道具の言葉があった人はその言葉、なければ自動
const START = (k) => (D1.life[k] && D1.life[k][7]) || null;
const START_AUTO = (k) => !!(D1.life[k] && D1.life[k][8]);
const START_HAND = { pickaxe: 'pick', axe: 'axe', fishing_rod: 'rod', hoe: 'hoe' };
const START_WORD = { pickaxe: 'ピッケル', axe: '斧', fishing_rod: '釣り', hoe: 'くわ' };
const startTool = (k) => (START(k) ? START_HAND[START(k)] + ':wood' : null);
// 2 日目にチェストの材料で作った道具（なければ、作り方の例として木の斧）
const MADE = (() => { for (const k of D2.active) { const m = /(木のつるはし|木の斧)を作った/.exec(D2.life[k][5]); if (m) return m[1]; } return null; })();
const MADE_KEY = MADE === '木のつるはし' ? 'wood_pickaxe' : 'wood_axe';
const STORE = D2.store;
const hm = (iso) => `${(new Date(iso).getUTCHours() + 9) % 24}時`;

// ---------- 時間割 ----------
const T = {
  s0: 0, join: 2.0, pick: 6.4, rock: 9.2, level: 15.4, what: 20.8, where: 24.6, tree: 28.6, night: 35.0,
  craft: 36.4, build: 39.4, chest: 42.6, fish: 46.4, farm: 49.6, ranch: 52.4, end: 55.2,
};
const DURATION = 58.2;
const SC_ORDER = ['s0', 'join', 'pick', 'rock', 'level', 'what', 'where', 'tree', 'night', 'craft', 'build', 'chest', 'fish', 'farm', 'ranch', 'end'];
const scene0 = (t) => { let s = 's0'; for (const k of SC_ORDER) if (t >= T[k]) s = k; return s; };
const dayAt = (t) => (t < T.join ? 0 : t < T.night + 0.7 ? 1 : 2);
function hourAt(t) {
  if (t < T.join) return lerp(10, 11, t / T.join);
  if (t < T.night) return lerp(8, 16.5, (t - T.join) / (T.night - T.join));
  if (t < T.craft) return lerp(17, 30.6, (t - T.night) / (T.craft - T.night)) % 24;
  if (t < T.end) return lerp(7, 15.5, (t - T.craft) / (T.end - T.craft));
  return lerp(15.5, 16, (t - T.end) / (DURATION - T.end));
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
scene.fog = new THREE.Fog(0xbcd9ea, 110, 300);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.3, 700);
const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
scene.add(sun.target);
sun.position.set(-30, 50, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 200 });
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
  const far = (x, z) => Math.hypot(x - D.square.x, z - D.square.z) > D.square.r + 2;
  for (const c of [0xf2f2f2, 0xf2d24a, 0xe2507a, 0x6a9cd8]) {
    const inst = new THREE.InstancedMesh(geo, mat(c), 80); const m4 = new THREE.Matrix4();
    for (let i = 0; i < 80; i++) { let x, z; do { x = (R() - 0.5) * 150; z = Math.min((R() - 0.5) * 130 - 10, D.seaZ - 4); } while (!far(x, z)); m4.makeTranslation(x, 0.12, z); inst.setMatrixAt(i, m4); }
    scene.add(inst);
  }
}
const fx = makeFx(scene);

// たき火
const fire = new THREE.Group();
for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; box(0.35, 0.25, 0.35, 0x7d7a74, Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7, fire); }
box(0.6, 0.15, 0.15, 0x6b4628, 0, 0.12, 0, fire); box(0.15, 0.15, 0.6, 0x6b4628, 0, 0.18, 0, fire);
const flame = box(0.4, 0.6, 0.4, 0xff9a2a, 0, 0.5, 0, fire); flame.castShadow = false;
fire.position.set(D.campfire.x, 0, D.campfire.z); scene.add(fire);

// 木を切る場面の木：村のまん中に近いふちの木で、横から引いて見た時に手前の木で画面がふさがらない木（イメージ）。
// 森の木は消さない（穴をあけない）。sim.js で切った木が見やすければ、その木を使う
const TREES0 = D.trees.filter((t, i) => D.days[0].trees[i] === 't');
const ROCKS0 = D.days[0].rocks.filter((r) => r.hp > 0);
// 木を切る場面の形：カメラは村のまん中の側から。打つ人は木の横に立ち（横顔が見える）、木は反対の横へ、少し手前（草地）に倒れる
function treeGeo(t, side) {
  const S = t.size || 1, toC = unit(D.square.x - t.x, D.square.z - t.z), perp = { x: -toC.z * side, z: toC.x * side };
  const ws = { x: t.x + perp.x * (1.0 * S + 0.8) + toC.x * 0.4, z: t.z + perp.z * (1.0 * S + 0.8) + toC.z * 0.4 };
  const from = { x: ws.x + perp.x * 2.0, z: ws.z + perp.z * 2.0 }; // 2.0 を 0.8 秒（人の歩く速さ）
  const fdir = unit(-perp.x * 0.85 + toC.x * 0.5, -perp.z * 0.85 + toC.z * 0.5);
  const cam = [t.x + toC.x * 22 + perp.x * 2.0, 6.5, t.z + toC.z * 22 + perp.z * 2.0, t.x + toC.x * 1.0 - perp.x * 0.6, 5.5, t.z + toC.z * 1.0 - perp.z * 0.6];
  return { S, toC, perp, ws, from, fdir, cam };
}
const TREE_PICK = (() => {
  let best = null;
  for (const t of TREES0) {
    const dSq = Math.hypot(t.x - D.square.x, t.z - D.square.z); if (dSq > 34) continue;
    for (const side of [1, -1]) {
      const G = treeGeo(t, side);
      let cost = frameCost(G.cam, TREES0, ROCKS0, [t.id]) + (t.id === TREE_SIM.id ? -0.5 : 0) + dSq * 0.01;
      // 倒れる所と打つ人の所に、ほかの木や岩がないこと
      for (const r of ROCKS0) for (let k = 0; k < 0.75; k += 0.05) if (Math.hypot(r.x - lerp(G.cam[0], t.x, k), r.z - lerp(G.cam[2], t.z, k)) < 3.2) { cost += 3; break; } // 手前の岩
      for (const o of TREES0) if (o.id !== t.id && Math.hypot(o.x - t.x, o.z - t.z) < 7) cost += 0.3; // となりの木と葉が重なって見分けにくい
      for (const o of [...TREES0, ...ROCKS0]) { if (o.id === t.id) continue; for (let k = 1.5; k <= 13; k += 1.5) if (Math.hypot(o.x - (t.x + G.fdir.x * k), o.z - (t.z + G.fdir.z * k)) < 2.4) { cost += 0.6; break; } if (Math.hypot(o.x - G.ws.x, o.z - G.ws.z) < 2.0) cost += 1; }
      if (!best || cost < best.cost) best = { cost, t, side };
    }
  }
  return best || { t: TREE_SIM, side: 1 };
})();
const TREE = TREE_PICK.t;

// ---------- 自然：日ごとの森と岩（動画で動かす木 1 本と岩 1 つは別に作る） ----------
const STATE = { t: 'tree', s: 'stump', p: 'sapling' };
function natureFor(snap, skip = () => false) {
  const g = new THREE.Group();
  const trees = [];
  D.trees.forEach((t, i) => {
    if (t.id === TREE.id || skip(t)) return;
    const st = snap.trees[i];
    if (st === 't') trees.push({ ...t, state: 'tree' });
    else if (st === 's' || st === 'p') g.add(makeTree({ ...t, state: STATE[st] }));
  });
  const forest = makeForest(trees); g.add(forest);
  const rocks = snap.rocks.filter((r) => r.id !== ROCK0.id && !skip(r, true));
  g.add(makeRockField(rocks));
  g.visible = false; scene.add(g);
  return { g, trees, forest, rocks: rocks.filter((r) => r.hp > 0) };
}
// 1 日目は 0 日目の終わり、2 日目は 1 日目の終わりのようす。建て始めた後は 2 日目の終わり（場所をならした）
// 木を切る場面だけは、切る木の奥と横の木を間引いて、明るい空き地で撮る（人が森にまぎれないように。イメージ）
const TG = treeGeo(TREE, TREE_PICK.side);
const inClearing = (o, rock) => { if (rock) { const dx = o.x - TREE.x, dz = o.z - TREE.z; return Math.hypot(dx, dz) < 18 && dx * TG.toC.x + dz * TG.toC.z > -2; } // 手前の岩もどける
  const dx = o.x - TREE.x, dz = o.z - TREE.z, d = Math.hypot(dx, dz), along = dx * TG.toC.x + dz * TG.toC.z; return d < 20 && along < 3 && (d > 4 || along < 0) || (d < 9 && along >= 3); };
const NAT = [natureFor(D.days[0]), natureFor(D.days[1]), natureFor(D.days[2]), natureFor(D.days[0], inClearing)];
const natIdx = (t) => (t >= T.tree && t < T.night ? 3 : t < T.night + 0.7 ? 0 : t < T.build ? 1 : 2);
for (const b of D.bushes) scene.add(makeBush({ ...b, ready: true }));
const treeObj = makeTree({ ...TREE, state: 'tree' }); scene.add(treeObj);
const rockObj = makeRock({ ...ROCK0, hp: 99 }); scene.add(rockObj);
const rockBits = makeDebris([0, 1, 2, 3].map((i) => ({ x: ROCK0.x + Math.cos(i * 1.7) * (0.6 + i * 0.25), z: ROCK0.z + Math.sin(i * 1.7) * (0.6 + i * 0.25), k: 'stone', s: 0.42 - i * 0.05 })));
scene.add(rockBits);
// 整地する前の草と小石
const debris = makeDebris(D.debris); scene.add(debris);
// チェスト
const chest = makeChest(); chest.position.set(D1.chest.x, 0, D1.chest.z); chest.rotation.y = Math.atan2(-D1.chest.x, -(D1.chest.z + 1)) + Math.PI; scene.add(chest);
// 「どこに建てる？」の旗
const markers = WHERE.options.map((o) => { const m = makeMarker(o.key); m.position.set(o.x, 0, o.z); m.scale.setScalar(1.6); m.visible = false; scene.add(m); return { o, m }; });
// 建て始めた所：ならした地面と足場、材料の山
const site = new THREE.Group();
{
  const w = 2.4;
  box(w * 2 + 1.2, 0.05, w * 2 + 1.2, 0xb59a72, 0, 0.025, 0, site);
  const sc = new THREE.Group(); site.add(sc);
  for (const [x, z] of [[-w, -w], [w, -w], [-w, w], [w, w]]) box(0.24, 3.2, 0.24, 0x9b6b3d, x, 1.6, z, sc);
  for (const y of [1.1, 2.5]) { box(w * 2 + 0.3, 0.18, 0.18, 0x8a5a33, 0, y, -w, sc); box(w * 2 + 0.3, 0.18, 0.18, 0x8a5a33, 0, y, w, sc); box(0.18, 0.18, w * 2 + 0.3, 0x8a5a33, -w, y, 0, sc); box(0.18, 0.18, w * 2 + 0.3, 0x8a5a33, w, y, 0, sc); }
  const base = box(w * 2, 0.5, w * 2, 0x8d9196, 0, 0.25, 0, site); // 倉庫の石の土台から
  site.userData = { sc, base };
}
site.position.set(SITE.x, 0, SITE.z); site.rotation.y = Math.atan2(-SITE.x, -(SITE.z + 1)); site.visible = false; scene.add(site);
const pileW = makePile('log'), pileS = makePile('cobble');
{ const toC = unit(-SITE.x, -SITE.z), sd = { x: -toC.z, z: toC.x }; pileW.position.set(SITE.x + toC.x * 4.2 + sd.x * 2.6, 0, SITE.z + toC.z * 4.2 + sd.z * 2.6); pileS.position.set(SITE.x + toC.x * 4.2 - sd.x * 2.6, 0, SITE.z + toC.z * 4.2 - sd.z * 2.6); }
setPile(pileW, Math.min(12, STORE.log || 0)); setPile(pileS, Math.min(12, STORE.cobble || 0));
scene.add(pileW, pileS);

// ---------- 池・野の動物・これからの畑と柵（イメージ） ----------
const pond = makePond(D.pond); scene.add(pond);
const wild = (D.animals || []).map((a) => { const o = makeAnimal(a.kind); scene.add(o); return { a, o }; });
const FA = { x: -37, z: 4 }, PN = { x: -37, z: -7.5 };
const farmG = new THREE.Group(); farmG.position.set(FA.x, 0, FA.z); scene.add(farmG);
farmG.add(makeFarm());
{ const c = makeCanal(); c.position.set(4.4, 0, 0); farmG.add(c); farmG.userData.canal = c; }
const CROPS = config.farming.crops, CROP_KEYS = Object.keys(CROPS);
const tiles = [];
for (let i = 0; i < 6; i++) {
  const lx = ((i % 3) - 1) * 2.3, lz = (Math.floor(i / 3) - 0.5) * 2.5, crop = CROP_KEYS[i % 3], max = CROPS[crop].days;
  const st = [];
  for (let s = 0; s <= max; s++) { const f = makeField({ x: lx, z: lz, stage: s, max, crop, water: i % 3 === 2 ? 1 : 0 }); f.visible = false; farmG.add(f); st.push(f); }
  tiles.push({ st, max, lx, lz, fast: i % 3 === 2 });
}
const penG = makePen(); penG.position.set(PN.x, 0, PN.z); scene.add(penG);
const penAnimals = ['cow', 'sheep', 'pig', 'chicken', 'sheep', 'cow', 'pig', 'chicken'].map((kind, i) => { const a = { id: 'p' + i + 'x', kind, x: PN.x + ((i % 4) - 1.5) * 1.6, z: PN.z + (Math.floor(i / 4) - 0.5) * 2.0 }; const o = makeAnimal(kind); scene.add(o); return { a, o }; });
const bob = makeBobber(); scene.add(bob);
const fishLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff })); scene.add(fishLine);

// ---------- 村人 ----------
const VIL = Object.fromEntries(D.villagers.map((v) => [v.key, v]));
const CREW = [KJ, ...D1.active.filter((k) => k !== KJ)].slice(0, 5); // 先頭は「住みたい ピッケル」の人
const chars = {};
for (const key of new Set([...CREW, ...D2.active])) {  // 釣りをした人も D2.active に入っている
  const v = VIL[key];
  const ch = makeCharacter('../skins/skin_' + String(v.skin).padStart(3, '0') + '.png', { scale: 1.9, chibi: chibiOf(v) });
  if (v.profile && v.profile.color) setAccent(ch, v.profile.color);
  ch.visible = false; scene.add(ch); chars[key] = ch;
}
function hideAll() { for (const k in chars) chars[k].visible = false; }
function put(key, p, face, pose, at, tool = null, carry = null, s = 1, toolScale = 1) {
  const ch = chars[key]; if (!ch) return;
  ch.visible = true; ch.scale.setScalar(1.9 * s);
  ch.position.set(p.x, 0, p.z); if (face != null) ch.rotation.y = face;
  setTool(ch, tool); setCarry(ch, carry); animate(ch, pose, at);
  if (ch.userData.parts.tool) ch.userData.parts.tool.scale.setScalar(toolScale * (ch.userData.parts.tool.userData.base || 1));
}
const WALK = 2.6; // 歩く速さ（town.js の SPEED と同じ。1 秒に 2 歩くらい）
const faceTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const SQ = D.square;
// 見る所より手前の木（葉の塊と幹）が、画面をどれだけふさぐか（0 = ふさがない）。木は消さずに、カメラの向きで避ける
function frameCost(c, trees, rocks, skipIds = [], extra = []) {
  camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); camera.updateMatrixWorld(true);
  const far = Math.hypot(c[3] - c[0], c[5] - c[2]) - 1.5;
  let cost = 0;
  const boxes = [];
  for (const t of [...trees, ...extra]) {
    if (skipIds.includes(t.id)) continue;
    const s = t.size || 1, d = Math.hypot(t.x - c[0], t.z - c[2]);
    if (d > far + TREE_R * s) continue;
    if (d < TREE_R * s + 0.6 && c[1] > TREE_LEAF_Y * s - 0.5 && c[1] < TREE_LEN * s + 0.5) return 99; // カメラが葉の中
    boxes.push([t, TREE_R * s, TREE_LEAF_Y * s, TREE_LEN * s, 1], [t, 0.7 * s, 0, TREE_LEAF_Y * s, 0.6]);
  }
  for (const r of rocks) if (!skipIds.includes(r.id) && Math.hypot(r.x - c[0], r.z - c[2]) < far) boxes.push([r, 2.2, 0, 3.0, 3]); // 手前の岩は大きく見えるので重く
  for (const [t, r, y0, y1, w] of boxes) {
    {
      let x0 = 9, x1 = -9, ya = 9, yb = -9, behind = false;
      for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [y0, y1]) {
        _pv.set(t.x + dx, y, t.z + dz).applyMatrix4(camera.matrixWorldInverse);
        if (_pv.z > -0.3) { behind = true; continue; }
        _pv.applyMatrix4(camera.projectionMatrix);
        x0 = Math.min(x0, _pv.x); x1 = Math.max(x1, _pv.x); ya = Math.min(ya, _pv.y); yb = Math.max(yb, _pv.y);
      }
      if (behind) { if (x1 < x0) continue; x0 = -1; x1 = 1; } // カメラのすぐ横をまたぐ物は、画面の横いっぱい
      const ox = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)), oy = Math.max(0, Math.min(1, yb) - Math.max(-1, ya));
      cost += (ox * oy) / 4 * w * 10;
    }
  }
  return cost;
}
// 引きのカメラ：まわりをぐるっと回って、手前の木で画面がふさがらない向きを選ぶ
function bestAngle(cx, cz, r, natI = 0, pref = 0.4, h = 13, ty = 0.8) {
  let best = null;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const c = [cx + Math.sin(a) * r, h, cz + Math.cos(a) * r, cx, ty, cz];
    const cost = Math.abs(Math.atan2(Math.sin(a - pref), Math.cos(a - pref))) * 0.2 + frameCost(c, NAT[natI].trees, NAT[natI].rocks, [], [TREE]);
    if (!best || cost < best.cost) best = { cost, a };
  }
  return best.a;
}
const A0 = bestAngle(SQ.x, SQ.z, 21, 0, 0.4, 27);
// 参加して最初に立つ所（広場のまわり、カメラの側）
const JOIN_AT = CREW.map((k, i) => {
  const a = A0 + (i - 2) * 0.42, p = { x: SQ.x + Math.sin(a) * 3.8, z: SQ.z + Math.cos(a) * 3.8 };
  const d = Math.hypot(p.x - D.campfire.x, p.z - D.campfire.z);
  if (d < 1.8) { const u = unit(p.x - D.campfire.x, p.z - D.campfire.z); p.x = D.campfire.x + u.x * 1.8; p.z = D.campfire.z + u.z * 1.8; }
  return p;
});
const T_APPEAR = CREW.map((k, i) => (i === 0 ? T.join + 0.35 : T.join + 1.55 + (i - 1) * 0.42));

// ---------- 整地：2 人が 3 か所ずつ回って、草と石をどける ----------
const LV = (() => {
  const stops = [];
  const R0 = 3.0; // 止まる所の円（となりの所まで 3.0、歩いて 1.15 秒）
  LEVELERS.forEach((key, li) => { for (let s = 0; s < 3; s++) { const a = (li * 3 + s) / 6 * Math.PI * 2 + 0.5; stops.push({ key, li, s, a, p: { x: SQ.x + Math.cos(a) * R0, z: SQ.z + Math.sin(a) * R0 } }); } });
  const t0 = T.level + 0.35, stopLen = 0.8, walk = 2 * R0 * Math.sin(Math.PI / 6) / WALK;
  const ang = (d) => { const a = Math.atan2(d.z - SQ.z, d.x - SQ.x) - 0.5; return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); };
  const gone = D.debris.map((d, i) => {
    const sec = Math.min(5, Math.floor(ang(d) / (Math.PI * 2 / 6)));
    const li = Math.floor(sec / 3), s = sec % 3;
    const same = D.debris.map((e, j) => j).filter((j) => Math.min(5, Math.floor(ang(D.debris[j]) / (Math.PI * 2 / 6))) === sec);
    const order = same.indexOf(i);
    return t0 + s * (stopLen + walk) + 0.25 + (order + 0.5) * (stopLen - 0.35) / same.length + li * 0.12;
  });
  return { stops, t0, stopLen, walk, gone, done: t0 + 3 * (stopLen + walk) };
})();
function levelScene(t) {
  const items = debris.userData.items;
  D.debris.forEach((d, i) => {
    const a = t - LV.gone[i], o = items[i];
    o.visible = a < 0.25;
    if (a >= 0 && a < 0.25) o.scale.setScalar((d.s || 1) * (1 - a / 0.25));
    else o.scale.setScalar(d.s || 1);
    if (a >= 0 && a < 0.6) fx.chips(chipList({ x: d.x, y: 0.3, z: d.z }, { x: 0, z: 0 }, 'deb' + i, a, 9), d.k === 'grass' ? 0x5e9a3c : 0x8d9196);
  });
  LEVELERS.forEach((key, li) => {
    const u = t - LV.t0;
    const my = LV.stops.filter((s) => s.li === li);
    const i = Math.max(0, Math.min(2, Math.floor(u / (LV.stopLen + LV.walk))));
    const w = u - i * (LV.stopLen + LV.walk);
    let p = my[i].p, pose = 'dig';
    if (u < 0) pose = 'idle'; // 場面が変わった時には、もう最初の所にいる（遠くから歩かせない）
    else if (w > LV.stopLen && i < 2) { const k = (w - LV.stopLen) / LV.walk; p = { x: lerp(my[i].p.x, my[i + 1].p.x, k), z: lerp(my[i].p.z, my[i + 1].p.z, k) }; pose = 'walk'; }
    else if (u > 3 * (LV.stopLen + LV.walk)) pose = 'idle';
    const away = { x: SQ.x + Math.cos(my[i].a) * 7, z: SQ.z + Math.sin(my[i].a) * 7 };
    put(key, p, faceTo(p, away), pose === 'dig' ? 'gather' : pose, t + li, null); // 手で草をぬく
  });
  // ほかの人は、それぞれの仕事へ（森へ歩いていく）
  CREW.filter((k) => !LEVELERS.includes(k) && k !== KJ).forEach((key, i) => {
    const p0 = JOIN_AT[CREW.indexOf(key)], tg = D1.life[key][1];
    const to = (D.trees.find((x) => x.id === tg) || D.days[0].rocks.find((x) => x.id === tg) || D.bushes.find((x) => x.id === tg) || { x: p0.x * 3, z: p0.z * 3 });
    const d = unit(to.x - p0.x, to.z - p0.z), s = Math.max(0, t - T.level - 0.2 - i * 0.3) * WALK;
    if (s > 12) return;
    const p = { x: p0.x + d.x * s, z: p0.z + d.z * s };
    put(key, p, Math.atan2(d.x, d.z), s > 0 ? 'walk' : 'idle', t + i, startTool(key));
  });
}

// ---------- 木を切る（素手）：何回もたたくと倒れて、原木が落ち、切り株が残る ----------
const VC = { rate: 3.2, phase: 0.75 }, VD = { rate: 3.0, phase: 0.65 };
const TIERS = config.crafting.tiers;
const TR = (() => {
  const { S, ws, from } = treeGeo(TREE, TREE_PICK.side);
  const t1 = T.tree + 0.85, hits = TIERS[CH_TIER].hits;
  const tFell = t1 + breakTime(0, VC, hits);
  return { S, ws, from, t1, hits, tFell, FALL: 1.3, VAN: 1.3 * FALL_END + 0.35 }; // VAN：倒れ始めてから消えるまで
})();
// 人と相手のまん中を、横から見るカメラ。手前の木や岩で人がかくれず、葉が画面をふさがない向きを選ぶ
function clearCam(a, b, dist, h, ty, natI, skipIds = []) {
  const nat = NAT[natI];
  const rocks = nat.rocks.filter((r) => !skipIds.includes(r.id)).map((r) => ({ x: r.x, z: r.z, r: 2.0 }));
  const c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const ax = Math.atan2(b.z - a.z, b.x - a.x);
  let best = null;
  for (let k = 0; k < 36; k++) {
    const ang = ax + Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 18);
    const p = { x: c.x + Math.cos(ang) * dist, z: c.z + Math.sin(ang) * dist };
    const cam = [p.x, h, p.z, c.x, ty, c.z];
    let cost = Math.abs(Math.sin(ang - ax - Math.PI / 2)) * 1.2 + frameCost(cam, NAT[natI].trees, NAT[natI].rocks, skipIds);
    for (const q of [a, b]) for (let s = 0.06; s < 0.97; s += 0.04) { const x = lerp(p.x, q.x, s), z = lerp(p.z, q.z, s); for (const o of rocks) if (Math.hypot(x - o.x, z - o.z) < o.r) cost += 1; }
    if (!best || cost < best.cost) best = { cost, cam };
  }
  return best.cam;
}
// 木は人の 3 倍以上高いので、横から大きく引いて、低い所から見上げる（倒れる木が画面に収まる）
const CAM_TREE = treeGeo(TREE, TREE_PICK.side).cam;
// 倒れる向き：カメラから見て横（打つ人と反対の側）、少しだけ奥へ
const FDIR = treeGeo(TREE, TREE_PICK.side).fdir;
const LOGS_N = 3;
const logPos = (i) => ({ x: TREE.x + FDIR.x * (2.2 + i * 2.8) * TR.S, y: 0.45, z: TREE.z + FDIR.z * (2.2 + i * 2.8) * TR.S }); // 横たわった幹のあと
const CH_TOOL = CH_TIER === 'hand' ? null : toolKey('axe', CH_TIER);
function treeScene(t, after) {
  // after：倒れた後の場面（切り株だけ）
  if (after) { setTreeState(treeObj, 'stump'); return; }
  const u = t - TR.t1;
  if (u < breakTime(0, VC, TR.hits)) {
    setTreeState(treeObj, 'tree');
    const s = strikeAt(Math.max(-1, u), VC, TR.hits);
    setTreeCrack(treeObj, u > 0 ? s.stage : -1);
    if (u > 0 && s.n) fx.chips(chipList({ x: TREE.x + (TR.ws.x - TREE.x) * 0.12, y: 0.9, z: TREE.z + (TR.ws.z - TREE.z) * 0.12 }, unit(TR.ws.x - TREE.x, TR.ws.z - TREE.z), 'tc' + s.n, s.since, 8), 0x8a6238);
  } else {
    const a = t - TR.tFell;
    // 根元を軸に、ゆっくり傾き始めてだんだん速く倒れ、地面で少し弾んでから消える
    setTreeFall(treeObj, a / TR.FALL, FDIR, a > TR.VAN - 0.15 ? Math.min(1, (a - TR.VAN + 0.15) / 0.3) : 0);
    setTreeCrack(treeObj, -1);
    if (a >= TR.VAN) {
      const ag = a - TR.VAN;
      // 消える時に葉が散る（葉の塊があった所から）
      for (let k = 0; k < 4; k++) { const d = (TREE_LEAF_Y + 0.6 + k * 2.0) * TR.S; fx.chips(chipList({ x: TREE.x + FDIR.x * d, y: 1.2, z: TREE.z + FDIR.z * d }, { x: (k % 2 - 0.5) * 0.8, z: 0.4 }, 'leaf' + k, ag * 0.75, 14).map((q) => ({ ...q, s: q.s * 2.6 })), new THREE.Color(treeObj.userData.tree.leafCol).getHex()); }
      // 原木：倒れた幹のあとに落ちて、低いところを通って打った人の足もとへ（顔の前を通らない）
      const side = { x: TR.ws.x + FDIR.x * 0.9, z: TR.ws.z + FDIR.z * 0.9 };
      for (let i = 0; i < LOGS_N; i++) {
        const age = ag - i * 0.1, o = logPos(i);
        if (age < 0) continue;
        const pick = 0.8 + i * 0.1;
        if (age < pick) { const d = dropPos(o, 'log' + i, age, FDIR); fx.item('log', d.x, d.y, d.z, d.rot, 1.9); fx.glow('coal', d.x, d.y + 0.05, d.z, 0.5, t, 0.9); }
        else if (age < pick + 0.35) { const d = dropPos(o, 'log' + i, pick, null), k = (age - pick) / 0.35; fx.item('log', lerp(d.x, side.x, k), lerp(d.y, 0.7, k) + Math.sin(k * Math.PI) * 0.35, lerp(d.z, side.z, k), age * 3, 1.9 * (1 - 0.6 * k)); }
      }
      const pk = ag - 0.75;
      if (pk > 0 && pk < 1.0) fx.plus(`+${LOGS_N} 原木`, logPos(1).x, 2.4 + pk * 0.5, logPos(1).z, pk < 0.75 ? 1 : (1.0 - pk) / 0.25, '#fff6c8', 1.3); // 倒れた木のあとの上（顔に重ならない）
    }
  }
  // 打つ人
  if (t < TR.t1) { const k = clamp01((t - T.tree) / (TR.t1 - T.tree)); const p = { x: lerp(TR.from.x, TR.ws.x, k), z: lerp(TR.from.z, TR.ws.z, k) }; put(KCH, p, faceTo(p, TREE), 'walk', t, CH_TOOL); }
  else if (t < TR.tFell + 0.25) put(KCH, TR.ws, faceTo(TR.ws, TREE), 'chop', u * VC.rate / 1.6, CH_TOOL);
  else put(KCH, TR.ws, faceTo(TR.ws, logPos(1)), t - TR.tFell > TR.VAN && t - TR.tFell < TR.VAN + 1.2 ? 'gather' : 'idle', t, CH_TOOL);
}

// ---------- 岩を掘る（木のつるはし）：決まった回数で 1 つ落ちる。形は変わらず、最後はくだけて消える ----------
const RK = (() => {
  const toC = unit(SQ.x - ROCK0.x, SQ.z - ROCK0.z), sd = { x: -toC.z, z: toC.x };
  const ws = { x: ROCK0.x + toC.x * 3.0 + sd.x * 0.8, z: ROCK0.z + toC.z * 3.0 + sd.z * 0.8 };
  const from = { x: ws.x + toC.x * 2.6, z: ws.z + toC.z * 2.6 }; // 2.6 を 1.0 秒
  const t1 = T.rock + 1.1, hits = TIERS.wood.hits, N = 2;
  const kinds = [...(ROCK0.blocks || 'sss').slice(0, 3)].map((c) => ({ c: 'coal', i: 'iron', g: 'gold', d: 'diamond' }[c] || 'cobble'));
  return { ws, from, t1, hits, N, kinds };
})();
const CAM_ROCK = clearCam(RK.ws, ROCK0, 17.0, 4.6, 2.0, 0, [ROCK0.id]); // 縦長の画面は横が狭いので、人と岩が両方入るまで引く
const CHIP_COL = { cobble: 0x8a8d91, coal: 0x3a3a3e, iron: 0xd49d74, gold: 0xf0cb36, diamond: 0x45dcd6 };
function rockScene(t, state) {
  // state：'full'（まだ）/'gone'（掘り終えた）/ undefined（掘っている）
  rockBits.visible = state === 'gone';
  if (state === 'full') { setRock(rockObj, RK.N); return; }
  if (state === 'gone') { setRock(rockObj, 0); return; }
  const u = t - RK.t1, s = strikeAt(Math.max(-1, u), VD, RK.hits);
  const broken = Math.min(RK.N, u > 0 ? s.broken : 0);
  const hp = RK.N - broken;
  const dir = unit(RK.ws.x - ROCK0.x, RK.ws.z - ROCK0.z);
  const face = { x: ROCK0.x + dir.x * 1.9, y: 1.2, z: ROCK0.z + dir.z * 1.9 };
  const last = broken > 0 ? u - breakTime(broken - 1, VD, RK.hits) : 9;
  setRock(rockObj, hp, hp > 0 && u > 0 ? s.stage : -1, last < 0.2 ? 1 - last / 0.2 : 0);
  rockBits.visible = hp <= 0;
  if (u > 0 && s.n && hp > 0) fx.chips(chipList(face, dir, 'rk' + s.n, s.since, 7), CHIP_COL.cobble);
  for (let i = 0; i < broken; i++) {
    const a = u - breakTime(i, VD, RK.hits), kind = RK.kinds[i];
    fx.chips(chipList(face, dir, 'rb' + i, a, 12), CHIP_COL[kind]);
    if (i === RK.N - 1) fx.chips(chipList({ x: ROCK0.x, y: 0.6, z: ROCK0.z }, { x: 0, z: 0 }, 'rend', a, 22).map((q) => ({ ...q, s: q.s * 2.6 })), CHIP_COL.cobble);
    const o = { x: face.x, y: Math.max(0.5, face.y), z: face.z }, toward = unit(CAM_ROCK[0] - o.x, CAM_ROCK[2] - o.z);
    if (a < 0.8) { const d = dropPos(o, 'ri' + i, a, toward); fx.item(kind, d.x, d.y, d.z, d.rot, 2.0); fx.glow(kind === 'cobble' ? 'coal' : kind, d.x, d.y + 0.05, d.z, kind === 'cobble' ? 0.5 : 0.9, t, 1.0); }
    else if (a < 1.1) { const d = dropPos(o, 'ri' + i, 0.8, toward), q = (a - 0.8) / 0.3; fx.item(kind, lerp(d.x, RK.ws.x, q), lerp(d.y, 0.8, q) + Math.sin(q * Math.PI) * 0.3, lerp(d.z, RK.ws.z, q), a * 3, 2.0 * (1 - q * 0.6)); } // 足もとへ（顔の前を通らない）
    else if (a < 2.2) { const q = (a - 1.1) / 1.1; fx.plus('+1 ' + IT[kind].name, ROCK0.x, 3.6 + q * 0.5, ROCK0.z, q < 0.75 ? 1 : (1 - q) * 4, kind === 'coal' ? '#e0e0e0' : '#fff6c8', 1.1); } // 岩の上（顔に重ならない）
  }
  const done = u > breakTime(RK.N - 1, VD, RK.hits) + 0.25;
  if (u < 0) { const k = clamp01((t - T.rock) / 1.0); const p = { x: lerp(RK.from.x, RK.ws.x, k), z: lerp(RK.from.z, RK.ws.z, k) }; put(KJ, p, faceTo(p, ROCK0), k < 1 ? 'walk' : 'idle', t, 'pick:wood'); return; }
  put(KJ, RK.ws, faceTo(RK.ws, ROCK0), done ? 'idle' : 'dig', done ? t : Math.max(0, u) * VD.rate / 1.3, 'pick:wood');
}

// ---------- 建て始める ----------
function buildScene(t) {
  site.visible = true;
  const k = ease((t - T.build - 0.3) / 3.2);
  site.userData.sc.scale.set(1, Math.max(0.05, k), 1);
  site.userData.base.scale.set(1, Math.max(0.1, ease((t - T.build) / 1.2)), 1);
  pileW.visible = pileS.visible = true;
  const toC = unit(-SITE.x, -SITE.z), b0 = Math.atan2(toC.z, toC.x);
  BUILDERS.forEach((key, i) => {
    const a = b0 + [-0.9, 0.9, 0][i], p = { x: SITE.x + Math.cos(a) * 3.3, z: SITE.z + Math.sin(a) * 3.3 };
    put(key, p, faceTo(p, SITE), i === 2 ? 'dig' : 'chop', t * 1.2 + i * 0.37, toolKey(i === 2 ? 'pick' : 'axe', D2.life[key][4]));
  });
}
const CAM_BUILD = (() => { const toC = unit(-SITE.x, -(SITE.z + 1)), sd = { x: -toC.z, z: toC.x }; return [SITE.x + toC.x * 15 + sd.x * 5, 8.5, SITE.z + toC.z * 15 + sd.z * 5, SITE.x, 1.6, SITE.z]; })();

// ---------- チェストへ運ぶ ----------
const CH = (() => {
  const c = D1.chest, ry = Math.atan2(-c.x, -(c.z + 1)) + Math.PI;
  const F = { x: Math.sin(ry), z: Math.cos(ry) }, Sd = { x: Math.cos(ry), z: -Math.sin(ry) }; // 前（錠前の側）と横
  const at = { x: c.x + F.x * 0.9 + Sd.x * 2.1, z: c.z + F.z * 0.9 + Sd.z * 2.1 }; // チェストの横に立つ（前の錠前をかくさない）
  const dir = unit(F.x * 0.5 + Sd.x, F.z * 0.5 + Sd.z), from = { x: at.x + dir.x * 2.6, z: at.z + dir.z * 2.6 }; // 2.6 を 1.0 秒
  return { c, F, Sd, at, from, arrive: T.chest + 1.0, open: T.chest + 1.15, gui: T.chest + 2.3 };
})();
const CAM_CHEST = [CH.c.x + CH.F.x * 10.5 - CH.Sd.x * 4.4, 4.8, CH.c.z + CH.F.z * 10.5 - CH.Sd.z * 4.4, CH.c.x + CH.Sd.x * 0.9, 1.7, CH.c.z + CH.Sd.z * 0.9];
function chestScene(t) {
  const a = t - CH.open;
  setChestOpen(chest, a < 0 ? 0 : Math.min(1, a / 0.25));
  if (t < CH.arrive) { const k = clamp01((t - T.chest) / (CH.arrive - T.chest)); const p = { x: lerp(CH.from.x, CH.at.x, k), z: lerp(CH.from.z, CH.at.z, k) }; put(KCH, p, faceTo(p, CH.c), 'carry', t, null, 'wood'); }
  else put(KCH, CH.at, faceTo(CH.at, CH.c), a < 0.9 ? 'gather' : 'idle', t, null, null);
  for (let i = 0; i < 3; i++) {
    const q = (a - i * 0.18) / 0.45;
    if (q < 0 || q > 1) continue;
    const kind = i === 1 ? 'cobble' : 'log';
    fx.item(kind, lerp(CH.at.x, CH.c.x, q), 1.5 + Math.sin(q * Math.PI) * 0.8 - q * 0.5, lerp(CH.at.z, CH.c.z, q), q * 4, 1.6 * (1 - q * 0.4));
  }
}

// ---------- 2 日目：池で釣り（sim.js で、村ではじめて魚が釣れた日） ----------
const FS = (() => {
  const toV = unit(SQ.x - D.pond.x, SQ.z - D.pond.z);
  const ws = { x: D.pond.x + toV.x * (D.pond.r + 0.9), z: D.pond.z + toV.z * (D.pond.r + 0.9) };
  const bp = { x: ws.x - toV.x * 2.6, z: ws.z - toV.z * 2.6 };
  return { ws, bp };
})();
const CAM_FISH = (() => { const v = unit(FS.bp.x - FS.ws.x, FS.bp.z - FS.ws.z), sd = { x: -v.z, z: v.x }; const m = { x: (FS.ws.x + FS.bp.x) / 2, z: (FS.ws.z + FS.bp.z) / 2 }; return [m.x + sd.x * 10.0 + v.x * 1.6, 4.4, m.z + sd.z * 10.0 + v.z * 1.6, m.x - v.x * 0.6, 1.4, m.z - v.z * 0.6]; })(); // 横から少し前寄り：顔と体の横が見える
const _tip = new THREE.Vector3();
function fishScene(t) {
  const key = KFI || CREW[4];
  const u = t - T.fish + 3.0, f = fishCycle(u);
  put(key, FS.ws, faceTo(FS.ws, FS.bp), 'fish', u, 'rod:' + ((KFI && D2.life[KFI][4] !== 'hand' && D2.life[KFI][4]) || 'wood'));
  const y = 0.1 + Math.sin(t * 2.2) * 0.02 - f.sink * 0.16 + f.reel * 0.6;
  bob.visible = true; fishLine.visible = true;
  bob.position.set(lerp(FS.bp.x, FS.ws.x, f.reel * 0.45), y, lerp(FS.bp.z, FS.ws.z, f.reel * 0.45));
  bob.userData.ring.scale.setScalar(1 + f.sink * 1.6);
  const ch = chars[key]; ch.updateMatrixWorld(true);
  const tool = ch.userData.parts.tool;
  if (tool && tool.userData.tip) { tool.userData.tip.getWorldPosition(_tip); fishLine.geometry.setFromPoints([_tip.clone(), bob.position.clone().setY(y + 0.25)]); }
  if (f.caught) {
    const q = clamp01((f.c - 0.74) / 0.1);
    fx.item(FISH_KEY, bob.position.x, y + 0.3 + q * 0.5, bob.position.z, u * 5, 2.2);
    if (f.c > 0.78) fx.plus('+1 ' + IT[FISH_KEY].name, FS.bp.x, 1.9 + (f.c - 0.78) * 1.5, FS.bp.z, 1, '#bfe8ff', 1.2);
  }
  if (f.sink > 0.2) fx.chips(chipList({ x: FS.bp.x, y: 0.12, z: FS.bp.z }, { x: 0, z: 0 }, 'splash', (f.c - 0.62) * 7, 8), 0xd8ecf8);
}
// ---------- これから（イメージ）：畑が育つ・柵の動物 ----------
const CAM_FARM = [FA.x - 0.1, 6.6, FA.z + 19.5, FA.x - 0.1, 1.5, FA.z + 0.6];
const FARM_GOLD = { x: FA.x - 2.5, z: FA.z + 2.0 }, FARM_DIA = { x: FA.x + 2.3, z: FA.z + 2.7 };
function farmScene(t) {
  const p = clamp01((t - T.farm - 0.2) / 2.3);
  for (const tl of tiles) { const s = Math.min(tl.max, Math.floor(p * (tl.max + 0.99) * (tl.fast ? 1.35 : 1))); tl.st.forEach((m, i) => { m.visible = i === s; }); }
  // 畑の左右のふちに立って、横向きで働く（道具がカメラから見える。少し大きめに見せる）
  const key = CREW[1];
  put(key, FARM_GOLD, faceTo(FARM_GOLD, { x: FA.x, z: FARM_GOLD.z }), 'chop', t * 1.1, 'hoe:gold', null, 1, 1.5);
  const k2 = CREW[3];
  if (k2) put(k2, FARM_DIA, faceTo(FARM_DIA, { x: FA.x + 4.4, z: FARM_DIA.z }), 'dig', t * 1.2 + 0.4, 'shovel:diamond', null, 1, 1.5);
  const a = clamp01((t - T.farm - 0.3) / 0.3) * clamp01((T.ranch - t - 0.1) / 0.3);
  fx.plus('金のくわ', FARM_GOLD.x + 0.8, 5.0, FARM_GOLD.z, a, '#ffe27a', 1.0);
  if (k2) fx.plus('ダイヤのシャベル', FARM_DIA.x - 0.6, 5.0, FARM_DIA.z, a, '#a8f6f0', 1.8);
  const c = farmG.userData.canal; for (const m of c.userData.flow) { const q = (t * 0.25 + m.userData.ph) % 1; m.position.z = -c.userData.len / 2 + q * c.userData.len; }
}
const CAM_PEN = [PN.x + 10.5, 6.4, PN.z + 4.5, PN.x, 0.6, PN.z];
function ranchScene(t) {
  for (const { a, o } of penAnimals) { const q = animalPos(a, t, true); o.visible = true; o.position.set(q.x, 0, q.z); o.rotation.y = q.face; animateAnimal(o, t, q.move, q.graze); }
  const hen = penAnimals[3], hp = animalPos(hen.a, t, true); // カメラに近い列のニワトリ
  const key = CREW[2], wp = { x: PN.x - 3.0, z: PN.z - 1.6 }; // 柵の奥（カメラから遠い側）。動物の後ろに立つ
  put(key, wp, faceTo(wp, hp), 'gather', t, 'basket');
  const a = t - T.ranch - 0.9;
  if (a > 0 && a < 1.0) { const d = dropPos({ x: hp.x, y: 0.4, z: hp.z }, 'egg', a, unit(CAM_PEN[0] - hp.x, CAM_PEN[2] - hp.z)); fx.item('egg', d.x, d.y, d.z, d.rot, 2.0); }
  if (a > 1.0 && a < 2.2) fx.plus('+1 たまご', hp.x + 0.9, 1.5 + (a - 1.0) * 0.4, hp.z + 0.5, 1, '#fff6c8', 1.2);
}

// ---------- 明かり・空 ----------
const sky = makeSky(scene, { hemi, sun, sunDist: 60, radius: 200, maxLights: 8, nightBoost: 0.35 });

// ---------- カメラ ----------
let LASTC = null;
function look(c) { LASTC = c; camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); }
const lerpCam = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const orbit = (a, r, h, ty = 0.8, cx = SQ.x, cz = SQ.z) => [cx + Math.sin(a) * r, h, cz + Math.cos(a) * r, cx, ty, cz];
// 「どこに建てる？」：旗 3 本が画面の上半分（カードの上）に入るまで引く
const CAM_WHERE = (() => {
  const pts = WHERE.options.map((o) => new THREE.Vector3(o.x, 8.2, o.z)).concat(WHERE.options.map((o) => new THREE.Vector3(o.x, 0, o.z)));
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  let best = null;
  for (let dist = 24; dist < 170; dist += 3) for (let off = -12; off <= 24; off += 3) {
    const c = [cx, dist * 0.95, cz - dist * 0.55, cx, 0, cz + off];
    look(c); camera.updateMatrixWorld(true);
    let bad = 0;
    for (const p of pts) { const v = p.clone().project(camera); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H; bad += Math.max(0, 120 - x) + Math.max(0, x - (W - 120)) + Math.max(0, SAFE_TOP + 240 - y) + Math.max(0, y - 1010); }
    const score = bad * 10 + dist; // 入るなかで、いちばん近いもの
    if (!best || score < best.score) best = { score, c };
  }
  return best.c;
})();
const CAM_WIDE0 = orbit(A0 + 0.15, 26, 32), CAM_WIDE1 = orbit(A0, 21, 27);
const A_END = bestAngle((SITE.x + SQ.x) / 2, (SITE.z + SQ.z) / 2, 27, 2, 0.4, 27);
function cameraAt(t) {
  const sc = scene0(t);
  if (sc === 's0') return look(lerpCam(orbit(A0 + 0.3, 31, 36), CAM_WIDE0, ease(t / T.join)));
  if (sc === 'join') return look(lerpCam(CAM_WIDE0, CAM_WIDE1, ease((t - T.join) / (T.pick - T.join))));
  if (sc === 'pick') return look(lerpCam(CAM_WIDE1, orbit(A0 + 0.05, 19, 24), ease((t - T.pick) / (T.rock - T.pick))));
  if (sc === 'level') return look(lerpCam(CAM_WIDE1, orbit(A0 - 0.15, 22, 26), ease((t - T.level) / 1.5)));
  if (sc === 'what') return look(orbit(A0 - 0.15 - (t - T.what) * 0.03, 22, 26));
  if (sc === 'where') return look(lerpCam(orbit(A0 - 0.26, 22, 26), CAM_WHERE, ease((t - T.where) / 1.2)));
  if (sc === 'tree') {
    // 打つ間は近くから人を大きく、倒れ始めたら引いて木全体を入れる
    const c = CAM_TREE.slice(), v = unit(c[0] - c[3], c[2] - c[5]);
    const near = [TR.ws.x + v.x * 11.5, 4.4, TR.ws.z + v.z * 11.5, TR.ws.x - TG.perp.x * 1.2, 3.4, TR.ws.z - TG.perp.z * 1.2];
    const k = ease(clamp01((t - (TR.tFell - 0.2)) / 1.4));
    return look(lerpCam(near, c, k));
  }
  if (sc === 'night') return look(orbit(A0 + (t - T.night) * 0.05, 24, 27));
  if (sc === 'craft') return look(orbit(A0 + 0.1 + (t - T.craft) * 0.03, 22, 26));
  if (sc === 'rock') { const k = (t - T.rock) / (T.level - T.rock); const c = CAM_ROCK.slice(); const v = unit(c[0] - c[3], c[2] - c[5]); c[0] -= v.x * k * 1.2; c[2] -= v.z * k * 1.2; return look(c); }
  if (sc === 'build') { const k = (t - T.build) / (T.chest - T.build); const c = CAM_BUILD.slice(); c[0] += k * 1.5; return look(c); }
  if (sc === 'fish') { const k = (t - T.fish) / (T.farm - T.fish); const c = CAM_FISH.slice(); c[1] -= k * 0.4; return look(c); }
  if (sc === 'farm') { const k = (t - T.farm) / (T.ranch - T.farm); const c = CAM_FARM.slice(); c[2] -= k * 1.0; return look(c); }
  if (sc === 'ranch') { const k = (t - T.ranch) / (T.end - T.ranch); const c = CAM_PEN.slice(); c[2] += k * 1.2; return look(c); }
  if (sc === 'chest') return look(lerpCam(CAM_CHEST, [CAM_CHEST[3] + (CAM_CHEST[0] - CAM_CHEST[3]) * 0.9, 4.4, CAM_CHEST[5] + (CAM_CHEST[2] - CAM_CHEST[5]) * 0.9, CAM_CHEST[3], 1.6, CAM_CHEST[5]], ease((t - T.chest) / 2.3)));
  const k = ease((t - T.end) / 3);
  return look(lerpCam(orbit(A_END, 27, 27, 1.5, (SITE.x + SQ.x) / 2, (SITE.z + SQ.z) / 2), orbit(A_END + 0.12, 34, 33, 1.5, (SITE.x + SQ.x) / 2, (SITE.z + SQ.z) / 2), k));
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
  ctx.fillStyle = opts.bg || 'rgba(24, 36, 28, 0.66)';
  roundRect(W / 2 - wmax / 2 - 44, y - lh / 2 - 22, wmax + 88, lh * lines.length + 44, 34); ctx.fill();
  lines.forEach((l, i) => {
    const yy = y + i * lh;
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(l, W / 2, yy);
    ctx.fillStyle = opts.color || '#fffdf4'; ctx.fillText(l, W / 2, yy);
  });
  ctx.restore();
}
// 字幕の並び：続けて出る字幕どうしは消えずに入れかわる（場面の切れ目でちらつかない）
const CAP = SAFE_BOTTOM - 190;
const RB0 = RK.t1 + breakTime(0, VD, RK.hits), RB1 = RK.t1 + breakTime(1, VD, RK.hits);
const CAPS = [
  [0.4, T.join, ['まだ、だれもいない'], { y: H / 2 + 330, size: 84 }],
  [T.join + 0.2, T.pick, ['「住みたい」のコメントで、', '村人が 1 人ずつ']],
  [T.rock + 0.1, RB0 + 0.2, ['つるはしを選んだ人は、', 'まず岩を掘る']],
  [RB0 + 0.2, RB1 + 0.6, ['決まった回数たたくと、1 つ落ちる']],
  [RB1 + 0.6, T.level, ['最後は、くだけて消える']],
  [T.level, T.level + 2.2, ['ほかの人は、村のまん中を整地']],
  [T.level + 2.2, LV.done + 0.1, ['草をぬいて、石をどける']],
  [LV.done + 0.1, T.what, ['集めた物を入れる、チェストを置いた']],
  [T.tree + 0.1, TR.tFell, [CH_TIER === 'hand' ? '素手で木を切る。何回もたたくと' : '斧の人は木を切る。何回もたたくと']],
  [TR.tFell, T.night, ['倒れて、原木が落ちる。切り株が残る']],
  [T.night + 0.2, T.craft - 0.1, ['夜が明けて、2 日目']],
  [T.build + 0.1, T.chest, [`投票で決まった${WHAT.name}を`, `${SITE.label || WHERE.name}に建て始めた`]],
  [T.chest + 0.1, CH.gui, ['集めた物は、町のチェストへ']],
  [T.fish + 0.1, T.farm, KFI ? ['池で釣り。うきが沈んだら釣り上げる', '村ではじめて魚が釣れた'] : ['池で釣り。うきが沈んだら釣り上げる']],
  [T.farm + 0.1, T.ranch, ['これから：畑は何日かで実る', '金やダイヤの道具も作れる']],
  [T.ranch, T.end, ['柵で動物を飼うと', 'たまご・ミルク・羊毛がもらえる']],
];
function captions(t) {
  CAPS.forEach(([a, b, lines, o = {}], i) => {
    if (t < a - 0.3 || t > b + 0.3) return;
    const prev = CAPS[i - 1], next = CAPS[i + 1];
    const inA = prev && Math.abs(prev[1] - a) < 0.05 ? (t >= a ? 1 : 0) : clamp01((t - a) / 0.25);
    const outA = next && Math.abs(next[0] - b) < 0.05 ? (t < b ? 1 : 0) : clamp01((b - t) / 0.25);
    caption(lines, o.y || CAP, o.size || 64, Math.min(inA, outA));
  });
}
function dayBadge(day) {
  ctx.save();
  ctx.font = `700 84px ${FONT}`; ctx.textBaseline = 'middle';
  const txt = day == null ? 'これから' : `${day}日目`; const w = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(47, 74, 55, 0.92)'; roundRect(64, SAFE_TOP + 24, w + 72, 124, 62); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(txt, 100, SAFE_TOP + 88);
  ctx.restore();
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
// 顔（スキンから）
const skinImg = {};
for (const key in chars) { const im = new Image(); im.src = '../skins/skin_' + String(VIL[key].skin).padStart(3, '0') + '.png'; skinImg[key] = im; }
function face(key, x, y, s) {
  const im = skinImg[key]; if (!im || !im.complete) return;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#3b3326'; ctx.fillRect(x - 5, y - 5, s + 10, s + 10);
  ctx.drawImage(im, 8, 8, 8, 8, x, y, s, s);
  ctx.drawImage(im, 40, 8, 8, 8, x - s * 0.06, y - s * 0.06, s * 1.12, s * 1.12);
  ctx.imageSmoothingEnabled = true;
}
const CARD_TOP = SAFE_TOP + 230, CARD_H = 104;
function commentCards(t) {
  const shown = CREW.map((key, i) => ({ key, i, t: T_APPEAR[i] - 0.12, len: i === 0 ? 2.6 : 1.9 })).filter((j) => t >= j.t && t < j.t + j.len).slice(-3);
  shown.forEach((j, i) => {
    const k = ease((t - j.t) / 0.25), o = ease((j.t + j.len - t) / 0.3);
    const a = Math.min(k, o); if (a <= 0) return;
    const txt = commentText(j.key);
    ctx.font = `700 44px ${FONT}`;
    const w = Math.max(400, 150 + ctx.measureText(txt).width), x = W - 64 - w + (1 - a) * (w + 90), y = CARD_TOP + i * (CARD_H + 18); // 透けずに、横から入って横へ出る
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; roundRect(x + 4, y + 6, w, CARD_H, 30); ctx.fill();
    ctx.fillStyle = '#fffdf7'; roundRect(x, y, w, CARD_H, 30); ctx.fill();
    face(j.key, x + 20, y + 18, 68);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2f2a22'; ctx.font = `700 44px ${FONT}`; ctx.fillText(txt, x + 116, y + CARD_H / 2 + 2);
    ctx.restore();
  });
}
function commentText(key) { const s = START(key); return s && !START_AUTO(key) ? `住みたい ${START_WORD[s]}` : '住みたい'; }
const villagerCount = (t) => T_APPEAR.filter((a) => a - 0.12 <= t).length;

// ---------- 投票カード（A/B/C・票が伸びる・決まる） ----------
const COLS = { A: '#d0603e', B: '#3f78b8', C: '#4b9a5e' };
function voteRows(dec, x, y, w, rowH, grow, decided, k, big = 1) {
  const total = dec.votes.A + dec.votes.B + dec.votes.C || 1;
  dec.options.forEach((o, i) => {
    const ry = y + i * rowH;
    const win = decided && o.key === dec.key;
    ctx.globalAlpha = k;
    if (win) { ctx.fillStyle = 'rgba(63, 120, 184, 0.10)'; roundRect(x + 20, ry - rowH * 0.42, w - 40, rowH * 0.86, 26); ctx.fill(); ctx.strokeStyle = COLS[o.key]; ctx.lineWidth = 6; ctx.stroke(); }
    ctx.globalAlpha = k * (decided && !win ? 0.45 : 1);
    const bs = 96 * big;
    ctx.fillStyle = COLS[o.key]; roundRect(x + 50, ry - bs / 2, bs, bs, 22); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = `700 ${62 * big}px ${FONT}`; ctx.fillText(o.key, x + 50 + bs / 2, ry + 2);
    ctx.textAlign = 'left'; ctx.fillStyle = '#2f2a22'; ctx.font = `700 ${58 * big}px ${FONT}`; ctx.fillText(o.name, x + 80 + bs, ry - 20 * big);
    const bw = w - (80 + bs) - 200;
    ctx.fillStyle = '#ece4d2'; roundRect(x + 80 + bs, ry + 26 * big, bw, 24, 12); ctx.fill();
    ctx.fillStyle = COLS[o.key]; roundRect(x + 80 + bs, ry + 26 * big, Math.max(24, bw * (dec.votes[o.key] / total) * grow), 24, 12); ctx.fill();
    ctx.textAlign = 'right'; ctx.fillStyle = '#2f2a22'; ctx.font = `700 ${52 * big}px ${FONT}`; ctx.fillText(`${Math.round(dec.votes[o.key] * grow)}票`, x + w - 44, ry + 6);
  });
  ctx.globalAlpha = k;
}
// カードは半透明にしない：出る時は大きくなり、消える時は小さくなる（後ろの物と重なって透けない）
function cardIn(t, a, b, cx, cy) {
  const kin = clamp01((t - a) / 0.28), kout = clamp01((b - t) / 0.22);
  if (kin <= 0 || kout <= 0) return 0;
  const s = kin < 1 ? backOut(kin) : kout < 1 ? kout * kout : 1;
  ctx.translate(cx, cy); ctx.scale(Math.max(0.001, s), Math.max(0.001, s)); ctx.translate(-cx, -cy);
  return 1;
}
function whatCard(t, a, b) {
  const k = Math.min(ease((t - a) / 0.35), ease((b - t) / 0.35)); if (k <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(10, 16, 12, ${0.45 * k})`; ctx.fillRect(0, 0, W, H);
  const x = 80, y = 470, w = W - 160, h = 1000;
  if (!cardIn(t, a, b, W / 2, y + h / 2)) { ctx.restore(); return; }
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 44); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#6f6656'; ctx.font = `700 42px ${FONT}`; ctx.fillText(`1日目の投票（${hm(WHAT.opensAt)}〜${hm(WHAT.closesAt)}）`, W / 2, y + 86);
  ctx.fillStyle = '#2f2a22'; ctx.font = `700 92px ${FONT}`; ctx.fillText('何を建てる？', W / 2, y + 190);
  const grow = lerp(0.15, 1, ease((t - a - 0.4) / 1.6)), decided = t > a + 2.3;
  voteRows(WHAT, x, y + 340, w, 196, grow, decided, 1);
  ctx.textAlign = 'center';
  if (decided) { ctx.globalAlpha = 1; ctx.fillStyle = '#c0392b'; ctx.font = `700 76px ${FONT}`; ctx.fillText(`${WHAT.name}に決定`, W / 2, y + h - 80); }
  ctx.restore();
}
function whereCard(t, a, b) {
  ctx.save();
  const x = 64, h = 560, y = SAFE_BOTTOM - h - 10, w = W - 128;
  if (!cardIn(t, a, b, W / 2, y + h / 2)) { ctx.restore(); return; }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(x + 4, y + 8, w, h, 40); ctx.fill();
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 40); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2f2a22'; ctx.font = `700 70px ${FONT}`; ctx.fillText(`${WHAT.name}を、どこに建てる？`, W / 2, y + 74);
  ctx.fillStyle = '#6f6656'; ctx.font = `700 36px ${FONT}`; ctx.fillText(`地図の旗 A・B・C から（${hm(WHERE.opensAt)}〜${hm(WHERE.closesAt)}）`, W / 2, y + 140);
  const grow = lerp(0.15, 1, ease((t - a - 0.5) / 1.6)), decided = t > a + 2.4;
  voteRows(WHERE, x, y + 236, w, 118, grow, decided, 1, 0.72);
  ctx.restore();
}
function whereMarkers(t) {
  const a = T.where + 0.6, decided = t > a + 2.4;
  for (const { o, m } of markers) {
    const pop = backOut(clamp01((t - T.where - 0.3 - 'ABC'.indexOf(o.key) * 0.2) / 0.4));
    const win = o.key === WHERE.key;
    m.visible = pop > 0.01 && (!decided || win || t < a + 2.9);
    m.scale.setScalar(1.6 * Math.max(0.01, pop) * (decided && win ? 1 + 0.12 * Math.sin((t - a) * 8) * Math.exp(-(t - a - 2.4)) : 1) * (decided && !win ? Math.max(0.01, 1 - (t - a - 2.4) / 0.5) : 1));
    m.userData.flag.rotation.y = Math.sin(t * 0.8 + o.x) * 0.3;
  }
}

// ---------- 道具作り（マインクラフト風の作業台） ----------
const ICON = {};
for (const k of ['log', 'planks', 'stick', 'cobble', 'coal', 'iron', 'gold', 'diamond', 'berry', 'wheat', 'apple', 'sapling', 'seeds', 'wood_pickaxe', 'wood_axe', 'wood_fishing_rod', 'wood_hoe', 'flower_r', 'flower_y', 'fish_funa', 'fish_masu', 'fish_koi', 'fish_namazu', 'egg', 'carrot', 'potato']) { const im = new Image(); im.src = '../icons/' + k + '.png'; ICON[k] = im; }
const PATTERN = { wood_pickaxe: { planks: [[0, 0], [0, 1], [0, 2]], stick: [[1, 1], [2, 1]] }, wood_axe: { planks: [[0, 0], [0, 1], [1, 0]], stick: [[1, 1], [2, 1]] } };
function mcPanel(x, y, w, h) {
  ctx.fillStyle = '#c6c6c6'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, 6); ctx.fillRect(x, y, 6, h);
  ctx.fillStyle = '#555555'; ctx.fillRect(x, y + h - 6, w, 6); ctx.fillRect(x + w - 6, y, 6, h);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
}
// 奥まった枠：上と左に濃い影（2 段）、下と右に光
function mcSlot(x, y, s) {
  ctx.fillStyle = '#8b8b8b'; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = '#7a7a7a'; ctx.fillRect(x + 4, y + 4, s - 8, 10); ctx.fillRect(x + 4, y + 4, 10, s - 8);
  ctx.fillStyle = '#373737'; ctx.fillRect(x, y, s, 5); ctx.fillRect(x, y, 5, s);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y + s - 4, s, 4); ctx.fillRect(x + s - 4, y, 4, s);
}
function mcIcon(k, x, y, s, alpha = 1) {
  const im = ICON[k]; if (!im || !im.complete || !im.width) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.imageSmoothingEnabled = false; ctx.drawImage(im, x, y, s, s); ctx.restore();
}
function mcCount(n, x, y, size) {
  ctx.save(); ctx.font = `700 ${size}px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#3f3f3f'; ctx.fillText(String(n), x + 4, y + 4);
  ctx.fillStyle = '#ffffff'; ctx.fillText(String(n), x, y);
  ctx.restore();
}
// mode 'fail'：足りない（材料は薄く）/ 'ok'：材料が入って、道具ができる
function craftCard(t, a, b, mode) {
  const k = Math.min(ease((t - a) / 0.3), ease((b - t) / 0.3)); if (k <= 0) return;
  const key = MADE_KEY;
  ctx.save();
  ctx.fillStyle = `rgba(10, 16, 12, ${0.45 * k})`; ctx.fillRect(0, 0, W, H);
  const x = 90, y = 520, w = W - 180, h = 860;
  if (!cardIn(t, a, b, W / 2, y + h / 2)) { ctx.restore(); return; }
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 44); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2f2a22'; ctx.font = `700 76px ${FONT}`;
  ctx.fillText(mode === 'fail' ? `${IT[key].name}を作りたい` : '道具を作る', W / 2, y + 96);
  // 作業台の窓
  const S = 112, gx = x + 90, gy = y + 200;
  mcPanel(gx - 30, gy - 30, S * 3 + 60 + 300, S * 3 + 60);
  const P = PATTERN[key], cells = [];
  for (const it of ['planks', 'stick']) for (const [r, c] of P[it]) cells.push({ it, r, c });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) mcSlot(gx + c * S, gy + r * S, S - 6);
  cells.forEach((q, i) => {
    const tIn = a + 0.4 + i * 0.22;
    const s = mode === 'fail' ? 1 : ease((t - tIn) / 0.25);
    if (s <= 0) return;
    mcIcon(q.it, gx + q.c * S + 12, gy + q.r * S + 12 - (1 - s) * 40, S - 30, mode === 'fail' ? 0.3 : s);
  });
  // 矢印と、できる物
  const ax = gx + S * 3 + 40, ay = gy + S * 1.5;
  ctx.fillStyle = '#8b8b8b'; ctx.fillRect(ax, ay - 14, 90, 28); ctx.beginPath(); ctx.moveTo(ax + 90, ay - 36); ctx.lineTo(ax + 136, ay); ctx.lineTo(ax + 90, ay + 36); ctx.closePath(); ctx.fill();
  const rx = ax + 156, ry = gy + S * 0.85;
  mcSlot(rx - 10, ry - 10, S + 26);
  // できる物の枠には、いつも道具の絵を出す（足りない時は灰色の幕と小さな × 、できたら大きくはずむ）
  if (mode === 'fail') {
    mcIcon(key, rx + 8, ry + 8, S - 10, 1);
    ctx.fillStyle = 'rgba(70, 70, 70, 0.45)'; ctx.fillRect(rx - 6, ry - 6, S + 18, S + 18);
    const bx = rx + S - 34, by = ry + S - 34;
    ctx.fillStyle = '#c0392b'; roundRect(bx - 6, by - 6, 52, 52, 12); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(bx + 6, by + 6); ctx.lineTo(bx + 34, by + 34); ctx.moveTo(bx + 34, by + 6); ctx.lineTo(bx + 6, by + 34); ctx.stroke();
  } else {
    const tr = a + 0.4 + cells.length * 0.22 + 0.25, q = clamp01((t - tr) / 0.35), s = q > 0 ? 1 + Math.sin(q * Math.PI) * 0.18 : 1;
    const c = rx + 8 + (S - 10) / 2;
    mcIcon(key, c - (S - 10) * s / 2, ry + 8 + (S - 10) / 2 - (S - 10) * s / 2, (S - 10) * s, 1);
    if (q <= 0) { ctx.fillStyle = 'rgba(70, 70, 70, 0.45)'; ctx.fillRect(rx - 6, ry - 6, S + 18, S + 18); }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const r = config.crafting.recipes[key].from;
  ctx.fillStyle = '#2f2a22'; ctx.font = `700 56px ${FONT}`;
  ctx.fillText(`${IT.planks.name} ${r.planks} ＋ ${IT.stick.name} ${r.stick} → ${IT[key].name}`, W / 2, y + 640);
  if (mode === 'fail') {
    ctx.fillStyle = '#c0392b'; ctx.font = `700 60px ${FONT}`; ctx.fillText('材料が足りない', W / 2, y + 740);
  } else {
    ctx.fillStyle = '#6f6656'; ctx.font = `700 40px ${FONT}`;
    ctx.fillText('原木 1 → 板 4・板 2 → 棒 4（チェストの材料で）', W / 2, y + 724);
    ctx.fillText('良い道具ほど、早く・多く取れて、長持ち', W / 2, y + 784);
  }
  ctx.restore();
}

// ---------- 最初の道具を選べる ----------
const PICK_OPTS = [['wood_pickaxe', 'つるはし', '岩を掘る', 'ピッケル'], ['wood_axe', '斧', '木を切る', '斧'], ['wood_fishing_rod', '釣りざお', '池で釣り', '釣り'], ['wood_hoe', 'くわ', '畑を作る', 'くわ']];
function pickCard(t, a, b) {
  const k = Math.min(ease((t - a) / 0.3), ease((b - t) / 0.3)); if (k <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(10, 16, 12, ${0.45 * k})`; ctx.fillRect(0, 0, W, H);
  const x = 80, y = 470, w = W - 160, h = 1000;
  if (!cardIn(t, a, b, W / 2, y + h / 2)) { ctx.restore(); return; }
  ctx.fillStyle = '#fffdf6'; roundRect(x, y, w, h, 44); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2f2a22'; ctx.font = `700 84px ${FONT}`; ctx.fillText('最初の道具を選べる', W / 2, y + 110);
  ctx.fillStyle = '#6f6656'; ctx.font = `700 40px ${FONT}`; ctx.fillText('木の道具を 1 つ持って、その仕事を先にする', W / 2, y + 190);
  const S = 150, rowH = 170;
  PICK_OPTS.forEach(([icon, name, job, word], i) => {
    const ry = y + 260 + i * rowH, s = ease((t - a - 0.3 - i * 0.15) / 0.25);
    ctx.globalAlpha = s;
    mcSlot(x + 60, ry, S); mcIcon(icon, x + 60 + 18, ry + 18, S - 36, 1);
    ctx.textAlign = 'left'; ctx.fillStyle = '#2f2a22'; ctx.font = `700 60px ${FONT}`; ctx.fillText(name, x + 250, ry + 52);
    ctx.fillStyle = '#6f6656'; ctx.font = `700 40px ${FONT}`; ctx.fillText(`${job}・「住みたい ${word}」`, x + 250, ry + 116);
    ctx.globalAlpha = 1;
  });
  ctx.textAlign = 'center'; ctx.fillStyle = '#6f6656'; ctx.font = `700 36px ${FONT}`;
  ctx.fillText('書かなければ、人の少ない仕事の道具になる', W / 2, y + h - 52);
  ctx.restore();
}

// ---------- 町のチェスト（マインクラフト風の中身） ----------
const ORDER = ['log', 'planks', 'stick', 'cobble', 'coal', 'iron', 'gold', 'diamond', 'berry', 'wheat', 'apple', 'fish_funa', 'fish_masu', 'fish_koi', 'fish_namazu', 'sapling', 'seeds', 'flower_r', 'flower_y'];
const STORE_ROWS = ORDER.filter((k) => STORE[k] > 0).concat(Object.keys(STORE).filter((k) => STORE[k] > 0 && !ORDER.includes(k)));
function chestGui(t, a) {
  const k = ease((t - a) / 0.35); if (k <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(10, 16, 12, ${0.4 * k})`; ctx.fillRect(0, 0, W, H);
  const cols = 4, S = 196, gw = cols * S, rows = Math.ceil(STORE_ROWS.length / cols);
  const pw = gw + 80, ph = rows * S + 210, px = (W - pw) / 2, py = 560;
  if (!cardIn(t, a, 1e9, W / 2, py + ph / 2)) { ctx.restore(); return; }
  mcPanel(px, py, pw, ph);
  ctx.fillStyle = '#3f3f3f'; ctx.font = `700 54px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('町のチェスト（2日目）', px + 44, py + 70);
  STORE_ROWS.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = px + 40 + c * S, y = py + 130 + r * S;
    mcSlot(x, y, S - 12);
    const s = ease((t - a - 0.3 - i * 0.12) / 0.25);
    if (s <= 0) return;
    mcIcon(it, x + 34, y + 14 - (1 - s) * 30, S - 80, s);
    mcCount(STORE[it], x + S - 26, y + S - 64, 50);
    ctx.globalAlpha = s;
    ctx.fillStyle = '#ffffff'; ctx.font = `700 30px ${FONT}`; ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(40,40,40,0.8)'; ctx.strokeText(IT[it].name, x + (S - 12) / 2, y + S - 34); ctx.fillText(IT[it].name, x + (S - 12) / 2, y + S - 34);
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

// ---------- 1 コマ ----------
window.renderFrame = (t) => {
  hideAll(); fx.begin();
  const sc = scene0(t), day = dayAt(t);
  cameraAt(t);
  const hour = hourAt(t);
  sky.set(hour, { x: camera.position.x * 0.5, z: camera.position.z * 0.5 });
  const ni = natIdx(t);
  NAT.forEach((n, i) => { n.g.visible = i === ni; });
  // 木と岩（動画で動かす物）
  const treeDone = t >= T.night;
  if (sc === 'tree') treeScene(t, false); else setTreeState(treeObj, treeDone ? 'stump' : 'tree');
  if (sc === 'rock') rockScene(t); else rockScene(t, t >= T.level ? 'gone' : 'full');
  // 整地の前の草と石
  debris.visible = t < LV.done + 0.3;
  if (sc === 's0' || sc === 'join') for (const [i, o] of debris.userData.items.entries()) { o.visible = true; o.scale.setScalar(D.debris[i].s || 1); }
  // チェスト（整地のあとに置く）
  const chestPop = clamp01((t - LV.done - 0.05) / 0.4);
  chest.visible = chestPop > 0; chest.scale.setScalar(1.3 * (chestPop > 0 ? Math.max(0.01, backOut(chestPop)) : 1));
  if (sc !== 'chest') setChestOpen(chest, 0);
  site.visible = t >= T.build; pileW.visible = pileS.visible = t >= T.build;
  for (const { m } of markers) m.visible = false;
  fire.visible = t >= T.join; flame.scale.y = 0.8 + Math.sin(t * 12) * 0.2;
  animatePond(pond, t);
  bob.visible = false; fishLine.visible = false;
  const future = sc === 'farm' || sc === 'ranch';
  farmG.visible = future; penG.visible = future;
  for (const { o } of penAnimals) o.visible = false;
  for (const { a, o } of wild) {
    o.visible = !future || Math.hypot(a.x - FA.x, a.z - (FA.z + PN.z) / 2) > 16; // これからの畑と柵のまわりの野の動物は、柵の中へ入ったつもりで出さない
    const q = animalPos(a, t, false); o.position.set(q.x, 0, q.z); o.rotation.y = q.face; animateAnimal(o, t, q.move, q.graze);
  }

  if (sc === 'join' || sc === 'pick') {
    // 参加した人は、選んだ（または自動で決まった）木の道具を手に持って現れる
    CREW.forEach((key, i) => { const s = backOut(clamp01((t - T_APPEAR[i]) / 0.35)); if (s <= 0.001) return; const p = JOIN_AT[i]; put(key, p, faceTo(p, { x: camera.position.x, z: camera.position.z }), 'idle', t + i, startTool(key), null, Math.max(0.01, s)); });
  } else if (sc === 'level') levelScene(t);
  else if (sc === 'what' || sc === 'where') {
    // みんな広場のまわりで投票中（スマホを見ているつもりで、立っている）
    CREW.forEach((key, i) => { const p = { x: SQ.x + Math.sin(i * 1.25 + 0.3) * 3.2, z: SQ.z + Math.cos(i * 1.25 + 0.3) * 3.2 }; put(key, p, faceTo(p, SQ), 'idle', t + i); });
    if (sc === 'where') whereMarkers(t);
  } else if (sc === 'craft') CREW.forEach((key, i) => { const p = { x: SQ.x + Math.sin(i * 1.25) * 3.4, z: SQ.z + Math.cos(i * 1.25) * 3.4 }; put(key, p, faceTo(p, D1.chest), 'idle', t + i); });
  else if (sc === 'rock') { /* rockScene が人も置く */ }
  else if (sc === 'build') buildScene(t);
  else if (sc === 'chest') chestScene(t);
  else if (sc === 'fish') fishScene(t);
  else if (sc === 'farm') farmScene(t);
  else if (sc === 'ranch') ranchScene(t);
  else if (sc === 'end') buildScene(t);
  // 夜は村人を出さない（暗い中に「+1」だけ浮かないように、fx も出さない）
  if (sc === 'night') { hideAll(); fx.begin(); }

  sky.anchors = fire.visible ? [{ x: D.campfire.x, y: 1.4, z: D.campfire.z }] : [];
  sky.placeLights(camera.position);
  fx.end();
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);

  // 文字（上下 15% はあける）
  const ending = t >= T.end;
  if (!ending) dayBadge(sc === 'farm' || sc === 'ranch' ? null : day);
  counterChip(villagerCount(t));
  if (t >= T.join) imageLabel();
  commentCards(t);
  captions(t);
  if (sc === 'what') whatCard(t, T.what + 0.1, T.where - 0.05);
  if (sc === 'where') whereCard(t, T.where + 0.6, T.tree - 0.05);
  if (sc === 'pick') pickCard(t, T.pick + 0.1, T.rock - 0.05);
  if (sc === 'craft') craftCard(t, T.craft + 0.1, T.rock - 0.05, 'ok');
  if (sc === 'chest') chestGui(t, CH.gui);
  if (ending) {
    const k = ease((t - T.end) / 0.6);
    ctx.fillStyle = `rgba(12, 20, 14, ${0.22 * k})`; ctx.fillRect(0, 0, W, H);
    caption(['あなたも', '村人に。'], SAFE_TOP + 250, 100, clamp01((t - T.end - 0.2) / 0.35));
    caption(['コメントに', '『住みたい』'], SAFE_BOTTOM - 210, 94, clamp01((t - T.end - 0.9) / 0.35), { color: '#ffe08a' });
  }
};

// 打つ音の時刻（見た目と同じ式から出す）
const SFX = [];
for (let k = 0; k < TR.hits; k++) SFX.push({ t: TR.t1 + (k + VC.phase) / VC.rate, type: 'chop', gain: 1 });
for (let k = 0; k < RK.hits * RK.N; k++) SFX.push({ t: RK.t1 + (k + VD.phase) / VD.rate, type: 'dig', gain: 1 });
for (let k = 0; T.build + 0.5 + k * 0.83 < T.chest; k++) SFX.push({ t: T.build + 0.5 + k * 0.83, type: 'chop', gain: 0.5 });
window.SFX = SFX.filter((s) => s.t < DURATION);

// スキンと絵の読み込みを待つ
async function waitTextures() {
  for (let i = 0; i < 200; i++) {
    let ok = Object.values(ICON).every((im) => im.complete) && Object.values(skinImg).every((im) => im.complete);
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
window.REEL = { W, H, FPS, DURATION, ready: true, T, TR: { t1: TR.t1, tFell: TR.tFell, van: TR.tFell + TR.VAN }, RK: { t1: RK.t1, b: [0, 1, 2].map((i) => RK.t1 + breakTime(i, VD, RK.hits)) }, LV: { done: LV.done }, CH: { arrive: CH.arrive, gui: CH.gui }, KEYS: { KJ: !!KJ, KCH: !!KCH, KFI: !!KFI, L: LEVELERS.length, B: BUILDERS.length, MADE, CH_TIER } };
window.renderFrame(0);
