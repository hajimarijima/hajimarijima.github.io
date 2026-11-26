// トップの町の 3D 地図
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeCharacter, animate, setTool as setTool0, setCarry as setCarry0, setAccent, setShield as setShield0, setArmor, fishCycle, chibiOf } from './character.js';
import { armorLook, gearNames } from './smithing.js'; // 鍛冶職人が作った防具と、カードの「装備」
// 姿をまだ作っていない人（遠くの人）には、道具や荷物を持たせない（作った時に、その時の物を持たせる）
// ?chibi=1：2 頭身の見本の体型で試す（採用前。ふだんは今の体型）
const setTool = (ch, k) => { if (ch.userData.parts) setTool0(ch, k); };
const setCarry = (ch, k) => { if (ch.userData.parts) setCarry0(ch, k); };
const setShield = (ch, on) => { if (ch.userData.parts) setShield0(ch, on); };
import { mat, box, hash, rnd, makeTree, makeRock, makeBush, makeBuilding, makeHouse, obstaclesFor, routeAround as routeAround0, declutter, makeRoads, setTownCenter } from './world3d.js';
import { makeField, makePond, animatePond, makeBobber, makeAnimal, animateAnimal, animalPos } from './farm3d.js';
import { loadAll, nav, esc, skinUrl, skinSrc, skinSlim, gaugeHtml,villagerUrl, JOB, ACTION, RES, RES_COLOR, fmtDate, faceCanvas, homeName, buildingLabel, showError, emptyNote, startNote, joinText, titleBadges, bestFishText, mbtiText } from './common.js';
import { makeSky, jstHour, parseTime, phaseName } from './daynight.js';
import { hourOf, hourText, isNight } from './hours.js';
import { tagName, igUrl } from './search.js';
import { goalHtml, chestHtml, projectList, projectCardHtml } from './chestview.js';
// 動画の書き出し（?video=1）で開いた時
let IS_VIDEO = false;
import { makeTerrain, BLOCK } from './terrain_gen.js';
import { makeTerrainView } from './terrain.js';
import { SpatialHash, TILE } from './tilemap.js';
import { BED, bedParts, sleeperOnBed, bedInHouse } from './beds.js';
import { TENT, MAT, tentExit, tentPlan, tentSites, tentBed, tentFront, tentPoint, inTent } from './tents.js';
import { islandAt, isOpen, randomLand, radiusAt, onLand, MAIN } from './island.js';
import { makeClouds } from './clouds.js';
import { seededRng, fightNight, roundsOf } from './combat.js';
import { makeFloatText } from './floattext.js';
import { closeOf, greetOf, moreLines } from './chat.js'; // 立ち話のあいさつと言葉
import { makeMob, animateMob, makeArrow, arrowAt, flashMob, fadeMob, makeHitFx, hitFxAt, MOB_SCALE } from './mobs.js';
import { makeChunkObjects, makeFx, setRock, rockScale, setTreeState, setTreeFall, setTreeCrack, makeDebris, makeChest, setChestOpen, makeMarker, strikeAt, breakTime, dropPos, chipList, DIG, CHOP, FALL_END, pixelTex, px, pixelRng } from './blocks.js';

// 時刻：ふだんは日本時間の今。?time=morning / day / evening / night や ?time=21:30 で切りかえて確かめられる。
// ?hour=7 は、その時刻の空と、村人のその時間の行動（L.hours）を出す（動画用）
const QS = new URLSearchParams(location.search);
const FIXED_H = parseTime(QS.get('hour') ?? QS.get('time'));
const hourNow = () => (FIXED_H ?? jstHour());

nav('index.html');

// ---------- 島から島へ歩く道：ちがう島へ行く時は、できあがった橋をわたる ----------
const ROUTE = { world: null, bridges: [] };
const islandOfPt = (p) => (islandAt(ROUTE.world, p.x, p.z, -4) || { id: MAIN }).id;
function routeAround(a, b, obs) {
  if (!ROUTE.world || !ROUTE.bridges.length) return routeAround0(a, b, obs);
  const ia = islandOfPt(a), ib = islandOfPt(b);
  if (ia === ib) return routeAround0(a, b, obs);
  const br = ROUTE.bridges.find((x) => (x.to === ia && ib === MAIN) || (x.to === ib && ia === MAIN));
  if (!br) return routeAround0(a, b, obs);
  const [p, q] = ia === MAIN ? [br.a, br.b] : [br.b, br.a];
  return [...routeAround0(a, p, obs), { x: q.x, z: q.z }, ...routeAround0(q, b, obs)];
}

// ---------- 煙・湯気 ----------
const puffs = [];
function addPuff(scene, src) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshLambertMaterial({ color: src.dark ? 0x9a9a9a : src.water ? 0xbfe6f5 : 0xffffff, transparent: true, opacity: 0.7 }));
  const spread = src.wide ? 2.4 : 0.2;
  m.position.set(src.wx + (Math.random() - 0.5) * spread, src.wy, src.wz + (Math.random() - 0.5) * spread);
  m.userData.life = 0; m.userData.src = src;
  scene.add(m); puffs.push(m);
}

// ---------- 地図の本体 ----------
async function main() {
  const TM0 = { start: performance.now() }; // 開くまでの時間の内わけ（確かめ用：window.TOWN.timing）
  const D = await loadAll();
  TM0.data = performance.now();
  const { config, state, world, life, active } = D;
  // 小さな島の町（world.islands）：木と岩は少ないので、遠い物も 1 本ずつぶつかる物として扱う（far の印は使わない）
  const ISLANDS = !!(world.islands && world.islands.length);
  if (ISLANDS) for (const o of [...world.trees, ...world.rocks]) delete o.far;
  const onMain = (o) => !ISLANDS || (islandAt(world, o.x, o.z, -3) || { id: MAIN }).id === MAIN;
  // 村のまん中（拠点）。拠点を投票で決めた町は、決まった場所（world.square）。道・柵・向きはここを中心にする
  const CTR = world.square ? { x: world.square.x, z: world.square.z } : { x: 0, z: -1 };
  setTownCenter(CTR, ISLANDS ? (x, z) => onLand(world, x, z, 1.2) : null);
  // 拠点の場所の投票中（0 日目）：チェスト・たき火・広場はまだ無く、地図に A/B/C の候補が出る
  const baseVote = (state.votes || []).find((v) => v.kind === 'base') || null;
  if (baseVote) {
    // 旗の場所・名前は config.json の候補に合わせる（sim の tools/base.js と同じ）。旗のまわりの木と岩は描かない（古いデータでも旗が木にうまらない）
    const cands = (config.baseVote || {}).candidates || [];
    baseVote.options.forEach((o, i) => { const c = cands[i]; if (c) Object.assign(o, { x: c.x, z: c.z, name: c.name, desc: c.desc || '' }); });
    const nearFlag = (o) => baseVote.options.some((f) => Math.hypot(o.x - f.x, o.z - f.z) < 5.2); // 旗の輪（3.5 × 1.35）の中
    world.trees = world.trees.filter((t) => !nearFlag(t)); world.rocks = world.rocks.filter((r) => !nearFlag(r));
    // baseVote.needPost の時は、投票の投稿の URL を貼るまで「投票中」の帯を出さない（旗だけ出す）
    const postReady = /instagram\.com\//.test(String(config.votePostUrl || ''));
    if (!(config.baseVote || {}).needPost || postReady) document.querySelector('.map').insertAdjacentHTML('beforeend', baseBanner(baseVote, config));
  }
  if (!active.length) document.querySelector('.map').insertAdjacentHTML('beforeend', emptyNote(config));
  renderPanel(D);

  const stage = document.getElementById('stage');
  const small = Math.min(innerWidth, innerHeight) < 700;
  // スマホ（小さい画面・指で操作）は、最初から軽い設定：画素の倍率 1・影なし・描く距離を短く・ふちのなめらかさなし。
  // ?lite=1 で PC でも軽い設定、?lite=0 でスマホでもふつうの設定
  const qLite = new URLSearchParams(location.search).get('lite');
  IS_VIDEO = new URLSearchParams(location.search).get('video') === '1';
  const LITE = qLite === '1' || (qLite !== '0' && (small || matchMedia('(pointer: coarse)').matches));
  const renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, LITE ? 1 : 2));
  renderer.shadowMap.enabled = !LITE;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1'; // 名札はこの中だけで重なる（村人カードより下）
  stage.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd9ea);
  scene.fog = new THREE.Fog(0xbcd9ea, 150, 330);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 700);
  const far = innerWidth < 600 ? 1.35 : 1;
  camera.position.set(0, 46 * far, 54 * far);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 2);
  // 指を離した後もゆっくり減らして止まる（回す・動かす）。ズームは下の camStep でなめらかに寄せる
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.8; controls.panSpeed = 0.9;
  controls.zoomSpeed = 1.6;
  controls.minDistance = 8; controls.maxDistance = 190;
  controls.maxPolarAngle = 1.3; controls.minPolarAngle = 0.25;
  // 小さな島の町：開いた時のカメラは、はじまり島がちょうど 1 画面に入る所（向きは前と同じ。画面の縦横の比で距離を決める）
  let VIEW_K = 1; // 開いた時のカメラが前（約 69）より遠い分だけ、札や細かい姿を出す距離ものばす
  if (ISLANDS) {
    const m = world.islands[0];
    camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight); camera.updateProjectionMatrix();
    const tgt = new THREE.Vector3(m.x, 0, m.z + 2), dir = new THREE.Vector3(0, 46, 52).normalize();
    const pts = Array.from({ length: 48 }, (_, k) => { const a = (k / 48) * Math.PI * 2, r = radiusAt(m, a) + 1.5; return new THREE.Vector3(m.x + Math.cos(a) * r, 0, m.z + Math.sin(a) * r); });
    const q = new THREE.Vector3();
    let d = 40;
    for (; d < 320; d += 2) {
      camera.position.copy(tgt).addScaledVector(dir, d); camera.lookAt(tgt); camera.updateMatrixWorld();
      if (pts.every((p) => { q.copy(p).project(camera); return Math.abs(q.x) < 0.95 && q.y < 0.86 && q.y > -0.95; })) break;
    }
    controls.target.copy(tgt);
    controls.maxDistance = Math.max(controls.maxDistance, d * 1.4);
    VIEW_K = Math.max(1, d / 69.4);
    camera.far = Math.max(camera.far, d * 4); camera.updateProjectionMatrix();
  }
  controls.screenSpacePanning = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  window.TOWN = { camera, controls, lite: LITE }; // 確かめ用（カメラを動かして撮る）
  // カメラをなめらかに：
  //  ・開いた時は、高い所から島へゆっくり寄る（触ったらすぐやめる。?intro=0 でなし）
  //  ・ホイールやピンチのズームは、その場で飛ばずに、目標の距離へ少しずつ寄せる（指を離しても少し続いて止まる）
  const CAM_HOME = camera.position.clone();
  const cam = { intro: new URLSearchParams(location.search).get('intro') !== '0' && !navigator.webdriver ? 0 : -1, introLen: LITE ? 2.4 : 2.8, from: null, want: 0, last: 0, zoomUntil: 0 };
  if (cam.intro === 0) { cam.from = CAM_HOME.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.55).multiplyScalar(1.9); camera.position.copy(cam.from); }
  const markZoom = () => { cam.zoomUntil = performance.now() + 450; };
  renderer.domElement.addEventListener('wheel', markZoom, { passive: true });
  renderer.domElement.addEventListener('touchmove', (e) => { if (e.touches.length > 1) markZoom(); }, { passive: true });
  controls.addEventListener('start', () => { if (cam.intro >= 0) cam.intro = -1; });
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const _off = new THREE.Vector3();
  function camStep(dt) {
    if (cam.intro >= 0) {
      cam.intro += dt;
      const k = easeInOut(Math.min(1, cam.intro / cam.introLen));
      camera.position.lerpVectors(cam.from, CAM_HOME, k);
      if (k >= 1) cam.intro = -1;
    }
    controls.update();
    // ズーム：OrbitControls が一度に動かした距離を「目標」にして、実際の距離はそこへ少しずつ寄せる
    _off.copy(camera.position).sub(controls.target);
    const d = _off.length();
    if (!cam.last || cam.intro >= 0) { cam.last = cam.want = d; return; }
    if (performance.now() < cam.zoomUntil && Math.abs(d - cam.last) > 1e-4) cam.want = Math.min(controls.maxDistance, Math.max(controls.minDistance, cam.want * d / cam.last));
    else if (performance.now() >= cam.zoomUntil && Math.abs(cam.want - cam.last) < 0.02) cam.want = d; // ほかの動き（プログラムで動かした時など）はそのまま
    const nd = cam.last + (cam.want - cam.last) * (1 - Math.exp(-dt * 7));
    camera.position.copy(controls.target).addScaledVector(_off, nd / d);
    cam.last = nd;
  }

  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
  scene.add(sun.target);
  sun.position.set(-30, 50, 25);
  sun.castShadow = !LITE;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 200 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; // 影のしま模様（チカチカ）を防ぐ
  scene.add(sun);

  // 地面：どこまでも続く地形（チャンクごとに作り、カメラから離れたら捨てる）。町の中は平らで、南は海
  // 建物と予定地のまわり（config.terrain.clearBlocks マス）には、木も岩も作らない
  const TC = config.terrain || {};
  const keepOut = world.buildings.map((b) => ({ x: b.x, z: b.z, r: 2.5 }))
    .concat(state.plan && state.plan.site ? [{ x: state.plan.site.x, z: state.plan.site.z, r: 3 }] : [])
    .concat((state.votes || []).filter((v) => v.kind === 'where' || v.kind === 'base').flatMap((v) => v.options.map((o) => ({ x: o.x, z: o.z, r: 3 }))));
  const terrainGen = makeTerrain({ seed: TC.seed || 'town', seaZ: world.seaZ, zone: { x0: -112, x1: 112, z0: -112, z1: world.seaZ + 2 }, keepOut, keepR: TC.clearBlocks ?? 4, islands: world.islands || null });
  const VIEW_R = LITE ? (TC.viewChunksMobile || 5) : (TC.viewChunks || 8);
  const terrain = makeTerrainView(scene, terrainGen, { radius: VIEW_R, lod: LITE ? [1, 2] : [2, 5], perFrame: LITE ? 2 : 3, treeNear: LITE ? 2 : 3, rockNear: LITE ? 2 : 4, shadow: !LITE });
  terrain.update(controls.target);
  for (let i = 0; i < (LITE ? 10 : 40) && terrain.pending; i++) terrain.update(controls.target); // 近くは開いた時に作っておく（スマホは少しだけ。残りは動き出してから少しずつ）
  const VIEW_UNITS = VIEW_R * 16 * BLOCK;
  window.TOWN.terrain = terrain;
  // 草花（見た目だけ）。テントの床にかかる物は、テントを置いたあとで隠す（decoInst）
  const decoInst = [];
  {
    const R = rnd('flowers');
    const geo = new THREE.BoxGeometry(0.18, 0.25, 0.18);
    const cols = [0xf2f2f2, 0xf2d24a, 0xe2507a, 0x6a9cd8];
    cols.forEach((c, ci) => {
      const inst = new THREE.InstancedMesh(geo, mat(c), 60); decoInst.push(inst);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 60; i++) {
        let x = (R() - 0.5) * 140, z = (R() - 0.5) * 120 - 10, hide = 0;
        if (ISLANDS) { const p = randomLand(world, R, 5, 12) || { x: 0, z: 0, y: -60 }; x = p.x; z = p.z; hide = p.y || 0; } // 島の草の上だけ（だめなら見えない所）
        m4.makeTranslation(x, 0.12 + hide, ISLANDS ? z : Math.min(z, world.seaZ - 4)); inst.setMatrixAt(i, m4);
      }
      scene.add(inst);
    });
    const tufts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), mat(0x76a84c), 260);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 260; i++) {
      let x = (R() - 0.5) * 150, z = Math.min((R() - 0.5) * 130 - 10, world.seaZ - 4), hide = 0;
      if (ISLANDS) { const p = randomLand(world, R, 5, 12) || { x: 0, z: 0, y: -60 }; x = p.x; z = p.z; hide = p.y || 0; }
      m4.makeTranslation(x, 0.07 + hide, z); tufts.setMatrixAt(i, m4);
    }
    scene.add(tufts); decoInst.push(tufts);
  }
  // 道（広場があれば石畳、なければ土）
  const hasPlaza = world.buildings.some((b) => b.type === 'plaza');
  for (const b of world.buildings) {
    if (b.type === 'plaza' || b.plot === 'coast' || b.plot === 'coast2' || b.plot === 'coast3' || !onMain(b)) continue; // ほかの島の建物には、まん中からの道を引かない（海の上になる）
    const len = Math.hypot(b.x - CTR.x, b.z - CTR.z);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.2, len), mat(hasPlaza ? 0xc2b59a : 0xb59a72));
    path.rotation.x = -Math.PI / 2; path.rotation.z = Math.atan2(b.x - CTR.x, b.z - CTR.z);
    path.position.set((b.x + CTR.x) / 2, 0.02, (b.z + CTR.z) / 2); path.receiveShadow = true; scene.add(path);
  }

  const objById = {};
  // 今日だれかが切る木・掘る岩だけは 1 本ずつ作る（たたくたびに小さくする・倒すため）。ほかはまとめて描く
  const workIds = new Set(active.map((v) => (life[v.key] || {}).target).filter(Boolean));
  const loneTrees = [], loneRocks = [];
  const todayIds = new Set(active.flatMap((v) => (life[v.key] || {}).targets || []));
  for (const t0 of world.trees) {
    // 今日掘り出した切り株（removed）は、その日のうちは切り株として描く
    if (t0.gone && !(t0.state === 'removed' && todayIds.has(t0.id))) continue;
    const t = t0.state === 'removed' ? { ...t0, state: 'stump' } : t0;
    // 今日だれも触らない木・切り株・苗木は、チャンクごとにまとめた 1 つのメッシュで描く
    if (!workIds.has(t.id) && !todayIds.has(t.id) && (t.state === 'tree' || t.state === 'stump' || t.state === 'sapling')) { loneTrees.push(t); objById[t.id] = { ...t, obj: null }; continue; }
    const o = makeTree(t); scene.add(o); objById[t.id] = { ...t, obj: o };
  }
  for (const r of world.rocks) {
    if (workIds.has(r.id) || (todayIds.has(r.id) && r.hp > 0)) { const o = makeRock(r); scene.add(o); objById[r.id] = { ...r, obj: o }; continue; }
    if (r.hp > 0) loneRocks.push(r);
    objById[r.id] = { ...r, obj: null };
  }
  scene.add(makeChunkObjects(loneTrees.concat(loneRocks), { shadow: !LITE }));
  for (const b of world.bushes) { const o = makeBush(b); scene.add(o); objById[b.id] = { ...b, obj: o }; }
  for (const f of world.fields) { const o = makeField(f); scene.add(o); objById[f.id] = { ...f, obj: o }; }
  // 池と、森や野原を歩く動物（柵に入った動物は柵の中を歩く）
  let pondObj = null;
  if (world.pond) { pondObj = makePond(world.pond); scene.add(pondObj); }
  const animals = (world.animals || []).filter((a) => (ISLANDS ? !!islandAt(world, a.x, a.z) : Math.hypot(a.x, a.z) < 70)).map((a) => { const o = makeAnimal(a.kind); scene.add(o); return { a, o }; });
  const emitters = [];
  const btags = [];
  const lightAnchors = [];
  const anim = { blades: [], boats: [], cows: [], lamps: [], hands: [], canals: [] };
  for (const b of world.buildings) {
    const o = makeBuilding(b, config); scene.add(o);
    objById[b.id] = { ...b, obj: o };
    o.updateMatrixWorld(true);
    if (o.userData.steam) { const s = o.userData.steam; const p = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(o.matrixWorld); emitters.push({ ...s, wx: p.x, wy: p.y, wz: p.z, t: 0 }); }
    if (o.userData.blades) anim.blades.push(o.userData.blades);
    if (o.userData.boat) anim.boats.push(o.userData.boat);
    if (o.userData.cows) anim.cows.push(...o.userData.cows);
    if (o.userData.canal) anim.canals.push(o.userData.canal);
    if (o.userData.clockHand) anim.hands.push(...o.userData.clockHand);
    for (const l of o.userData.lights || []) { const p = new THREE.Vector3(l.x, l.y, l.z).applyMatrix4(o.matrixWorld); lightAnchors.push({ x: p.x, y: p.y, z: p.z }); }
    // 名前札（今日できた建物は目立たせる）
    const tag = document.createElement('div');
    tag.className = 'btag' + (b.day === state.day ? ' new' : '');
    tag.textContent = (b.day === state.day ? '今日できた ' : '') + buildingLabel(b, world, config);
    const lo = new CSS2DObject(tag);
    const top = config.buildings[b.type].look.h || 2;
    lo.position.set(b.x, Math.min(12, top + 3), b.z); scene.add(lo);
    btags.push(lo);
  }
  // 道と家の前の小道
  scene.add(makeRoads(world.buildings, (world.plots || []).filter((p) => !p.island), config));
  // 建てている物・作っている橋（押すと「あと何個いるか」の札。userData.project に projectList の id）
  const projPicks = [];
  const pjTag = (tag, id) => { tag.classList.add('pjtag'); tag.style.pointerEvents = 'auto'; tag.addEventListener('click', (e) => { e.stopPropagation(); openProject(id); }); };
  // 橋（となりの島へ。config.expansion）と、島の名前の札
  const bridges = ISLANDS ? makeBridges() : [];
  ROUTE.world = world; ROUTE.bridges = bridges.filter((b) => b.built);
  function makeBridges() {
    const out = [];
    for (const br of world.bridges || []) {
      const ex = (state.expansion || {})[br.id];
      const prog = br.built ? 1 : ex ? Math.max(0, Math.min(1, ex.prog || 0)) : 0;
      const isl = world.islands.find((i) => i.id === br.to);
      const dx = br.b.x - br.a.x, dz = br.b.z - br.a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      const ext = 2, total = L + ext * 2, hw = (br.w || 3.4) / 2;
      if (ex || br.built) {
        // 橋は最初は無い。作り始めると 3 つの段階で少しずつできていく（板の上の面は地面と同じ高さ）
        //   0〜35%：海にくいを岸から順に立てる / 35〜90%：くいの上に板を岸から少しずつ渡す / 90〜100%：手すりをつける
        const g = new THREE.Group();
        g.position.set(br.a.x - ux * ext, 0, br.a.z - uz * ext); g.rotation.y = Math.atan2(dx, dz);
        const stage = (a, b) => Math.max(0, Math.min(1, (prog - a) / (b - a)));
        const pPost = stage(0, 0.35), pPlank = stage(0.35, 0.9), pRail = stage(0.9, 1);
        const P = 0.95, n = Math.ceil(total / P), shown = Math.round(n * pPlank), len = shown * P;
        for (let k = 0; k < shown; k++) box(hw * 2, 0.14, P - 0.06, k % 2 ? 0xa57a4a : 0xb48a56, 0, -0.06, k * P + P / 2, g);
        // くい（水の中から）。最初の日から岸のそばに 1 組は立っている
        const posts = []; for (let s = 1.8; s < total - 0.5; s += 3.8) posts.push(s);
        const nPost = Math.max(1, Math.round(posts.length * pPost));
        for (const s of posts.slice(0, nPost)) for (const sx of [-1, 1]) box(0.34, 1.9, 0.34, 0x6e4a2a, sx * (hw + 0.05), -0.75, s, g);
        // 手すり：柱と横木は、できた板の上にだけ
        if (pRail > 0) {
          const rlen = len * pRail;
          for (const s of posts) if (s < rlen - 0.5) for (const sx of [-1, 1]) box(0.18, 0.95, 0.18, 0x7a5232, sx * (hw - 0.1), 0.47, s, g);
          const rl = Math.max(0, rlen - 1.4);
          if (rl > 0) for (const sx of [-1, 1]) box(0.14, 0.14, rl, 0x8a6038, sx * (hw - 0.1), 0.92, 0.7 + rl / 2, g);
        }
        if (!br.built) { // 作っている間：岸に材料の山
          for (let i = 0; i < 3; i++) box(1.6, 0.22, 0.26, 0xa87a48, hw + 1.6, 0.12 + i * 0.24, 0.6 + (i % 2) * 0.1, g);
          for (let i = 0; i < 2; i++) box(0.5, 0.42, 0.5, 0x9a9da2, -hw - 1.4 - i * 0.6, 0.21, 0.8, g);
        }
        g.traverse((o) => { if (o.isMesh) { o.castShadow = !LITE; o.receiveShadow = true; } });
        scene.add(g);
        if (!br.built) { g.userData.project = 'bridge:' + br.id; projPicks.push(g); }
      }
      if (ex || br.built) {
        const tag = document.createElement('div');
        tag.className = 'btag' + (br.built === state.day || !br.built ? ' new' : '');
        tag.textContent = br.built ? (br.built === state.day ? '今日できた ' : '') + (br.name || '橋') : `橋を作っている（${Math.round(prog * 100)}%）`;
        if (!br.built) pjTag(tag, 'bridge:' + br.id);
        const lo = new CSS2DObject(tag); const mid = br.built ? 0.5 : Math.max(0.08, prog * 0.5);
        lo.position.set(br.a.x + dx * mid, 3, br.a.z + dz * mid); scene.add(lo); btags.push(lo);
      }
      out.push({ ...br, a: { x: br.a.x - ux * 1, z: br.a.z - uz * 1 }, b: { x: br.b.x + ux * 1, z: br.b.z + uz * 1 } });
    }
    // 島には名前の札を出さない（海の向こうに見えているだけ）
    return out;
  }
  // たき火とテント（家がない人の寝床）
  const camp = world.campfire;
  if (!hasPlaza && active.length && !baseVote) { // だれもいない間は、木と岩だけ。拠点の投票中は、たき火もまだない（テントだけ）
    const fire = new THREE.Group();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; box(0.35, 0.25, 0.35, 0x7d7a74, Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7, fire); }
    box(0.6, 0.15, 0.15, 0x6b4628, 0, 0.12, 0, fire); box(0.15, 0.15, 0.6, 0x6b4628, 0, 0.18, 0, fire);
    const flame = box(0.4, 0.6, 0.4, 0xff9a2a, 0, 0.5, 0, fire); flame.castShadow = false; anim.flame = flame;
    fire.position.set(camp.x, 0, camp.z); scene.add(fire);
    emitters.push({ wx: camp.x, wy: 1.2, wz: camp.z, dark: true, thin: true, t: 0 });
    lightAnchors.push({ x: camp.x, y: 1.4, z: camp.z });
  }
  // 立てたたいまつ（作業台で 棒＋石炭 から作る。チェストのたいまつの数だけ、posts 本まで村のまわりに立てる）。作るまでは夜はたき火だけで暗い
  const nTorch = Math.min((config.guardGear && config.guardGear.posts) || 0, (state.store && state.store.torch) || 0);
  const torchFlames = [], torchObjs = []; // torchObjs：テントにかかったら、輪にそって外へずらす
  if (active.length && nTorch > 0) {
    const cx = camp ? camp.x : 0, cz = camp ? camp.z : 0, R0 = hasPlaza ? 14 : 9;
    for (let i = 0; i < nTorch; i++) {
      const a = (i / nTorch) * Math.PI * 2 + 0.4;
      const q = { x: cx + Math.cos(a) * R0, z: cz + Math.sin(a) * R0 };
      const t = new THREE.Group(); t.position.set(q.x, 0, q.z);
      box(0.16, 1.5, 0.16, 0x7a5232, 0, 0.75, 0, t); box(0.22, 0.2, 0.22, 0x2a2624, 0, 1.6, 0, t);
      const f1 = box(0.2, 0.3, 0.2, 0xffb03a, 0, 1.86, 0, t), f2 = box(0.11, 0.16, 0.11, 0xfff0a0, 0, 2.06, 0, t);
      for (const f of [f1, f2]) { f.castShadow = false; f.material = new THREE.MeshBasicMaterial({ color: f.material.color }); }
      torchFlames.push(f1, f2); scene.add(t);
      const la = { x: q.x, y: 2.1, z: q.z }; lightAnchors.push(la); torchObjs.push({ g: t, la, a, cx, cz, R0 });
    }
  }
  anim.torches = torchFlames;
  // 整地する前の村のまん中（草と小石）
  const debrisObj = !world.square || !world.square.leveled ? makeDebris(world.debris || []) : null;
  if (debrisObj) scene.add(debrisObj);
  // チェスト（集めた物が入る）
  let chestObj = null;
  if (world.chest && world.chest.day) {
    chestObj = makeChest(); chestObj.position.set(world.chest.x, 0, world.chest.z); chestObj.rotation.y = Math.atan2(-(world.chest.x - CTR.x), -(world.chest.z - CTR.z)); chestObj.scale.setScalar(1.3); scene.add(chestObj);
    const tag = document.createElement('a'); tag.className = 'btag chesttag'; tag.href = '#chestcard'; tag.textContent = '町のチェスト'; tag.style.pointerEvents = 'auto';
    const lo = new CSS2DObject(tag); lo.position.set(world.chest.x, 2.6, world.chest.z); scene.add(lo); btags.push(lo);
  }
  // 建てている所（投票で決まった物・場所。整地が終わったら足場）
  const plan = state.plan;
  if (plan && plan.site && plan.leveled && plan.site.plot !== 'ring') {
    // 建てる段階：材料・部品を集めている間は足場と材料の山。建て始めたら 土台 → 壁 → 屋根 と少しずつできる（sim の hourProg）
    const g = new THREE.Group();
    const L = (config.buildings[plan.build] || {}).look || {};
    const W = Math.max(2.4, Math.min(7, L.w || 4)) / 2, D = Math.max(2.4, Math.min(7, L.d || L.w || 4)) / 2, Hh = Math.max(1.6, Math.min(4.5, L.h || 2.4));
    const hp = Array.isArray(plan.hourProg) ? plan.hourProg[((Math.floor(hourNow()) % 24) + 24) % 24] : null;
    const prog = plan.started ? Math.max(0, Math.min(1, hp ?? (plan.buildNeed ? (plan.buildH || 0) / plan.buildNeed : 0))) : 0;
    const st = (config.construction || {}).stages || [0.34, 0.67];
    const k0 = Math.min(1, prog / st[0]), k1 = Math.max(0, Math.min(1, (prog - st[0]) / (st[1] - st[0]))), k2 = Math.max(0, Math.min(1, (prog - st[1]) / (1 - st[1])));
    const wallC = new THREE.Color(L.wall || '#b08a5c').getHex(), roofC = new THREE.Color(L.roof || '#7a4a2e').getHex();
    box(W * 2 + 1.0, 0.06, D * 2 + 1.0, 0xb59a72, 0, 0.03, 0, g); // ならした地面
    if (!plan.started) { // 材料と部品の山（集めている間）
      for (let i = 0; i < 3; i++) box(1.6, 0.22, 0.26, 0xa87a48, -W + 0.9, 0.12 + i * 0.24, D + 0.9 + (i % 2) * 0.1, g);
      for (let i = 0; i < 3; i++) box(0.5, 0.42, 0.5, 0x9a9da2, W - 0.4 - i * 0.55, 0.21, D + 0.9, g);
    }
    if (prog > 0) box(W * 2 + 0.3, 0.42 * k0, D * 2 + 0.3, 0x8f9296, 0, 0.21 * k0, 0, g); // 土台（石材）
    if (k0 >= 1) { // 壁：四すみの柱が立ち、壁が下から上へ
      const hw = Hh * k1;
      for (const [x, z] of [[-W, -D], [W, -D], [-W, D], [W, D]]) box(0.3, Math.max(0.05, Hh * Math.min(1, k1 * 2)), 0.3, 0x8a5e3a, x, 0.42 + Hh * Math.min(1, k1 * 2) / 2, z, g);
      if (hw > 0.02) {
        box(W * 2, hw, 0.18, wallC, 0, 0.42 + hw / 2, -D, g); box(W * 2, hw, 0.18, wallC, 0, 0.42 + hw / 2, D, g);
        box(0.18, hw, D * 2, wallC, -W, 0.42 + hw / 2, 0, g); box(0.18, hw, D * 2, wallC, W, 0.42 + hw / 2, 0, g);
      }
    }
    if (k1 >= 1 && k2 > 0) { // 屋根：屋根板を下から並べていく
      const n = Math.max(1, Math.ceil(k2 * 4));
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / 4, y = 0.42 + Hh + t * Hh * 0.55, w2 = (W + 0.35) * (1 - t * 0.85); box(w2 * 2, 0.22, (D + 0.35) * 2 * (1 - t * 0.85), roofC, 0, y, 0, g); }
    }
    if (prog < 1) { // 足場
      const sw = W + 0.5, sd = D + 0.5, sh = 0.42 + Hh + 0.8;
      for (const [x, z] of [[-sw, -sd], [sw, -sd], [-sw, sd], [sw, sd]]) box(0.16, sh, 0.16, 0x9b6b3d, x, sh / 2, z, g);
      for (const y of [1.1, Math.min(sh - 0.2, 2.4)]) { box(sw * 2 + 0.2, 0.14, 0.14, 0x8a5a33, 0, y, -sd, g); box(sw * 2 + 0.2, 0.14, 0.14, 0x8a5a33, 0, y, sd, g); box(0.14, 0.14, sd * 2 + 0.2, 0x8a5a33, -sw, y, 0, g); box(0.14, 0.14, sd * 2 + 0.2, 0x8a5a33, sw, y, 0, g); }
    }
    g.position.set(plan.site.x, 0, plan.site.z); g.rotation.y = Math.atan2(-(plan.site.x - CTR.x), -(plan.site.z - CTR.z)); scene.add(g);
    g.userData.project = 'plan'; projPicks.push(g);
    const stN = ['土台', '壁', '屋根', 'できあがり'][prog >= 1 ? 3 : prog >= st[1] ? 2 : prog >= st[0] ? 1 : 0];
    const tag = document.createElement('div'); tag.className = 'btag new'; tag.textContent = '建てている：' + config.buildings[plan.build].name + (plan.started ? `（${stN} ${Math.round(prog * 100)}%）` : '（材料と部品を集めている）');
    pjTag(tag, 'plan');
    const lo = new CSS2DObject(tag); lo.position.set(plan.site.x, 4.2, plan.site.z); scene.add(lo); btags.push(lo);
  }
  // 「どこに建てる？」の投票中は、A/B/C の場所に旗
  const markers = [];
  for (const v of state.votes || []) {
    if (v.kind !== 'where') continue;
    for (const o of v.options) { const m = makeMarker(o.key); m.position.set(o.x, 0, o.z); scene.add(m); markers.push(m); }
  }
  // 拠点の場所の投票中：A/B/C の候補に旗と札（名前と今の票）。札はいつも出す（ほかの札と重なれば上へずらす）
  if (baseVote) for (const o of baseVote.options) {
    const m = makeMarker(o.key); m.position.set(o.x, 0, o.z); m.scale.setScalar(1.35); scene.add(m); markers.push(m);
    const tag = document.createElement('a'); tag.className = 'btag basetag bt-' + o.key; tag.href = 'vote.html'; tag.style.pointerEvents = 'auto';
    tag.innerHTML = `<b>${esc(o.key)}</b> ${esc(o.name)}<span class="bt-n">${(baseVote.votes || {})[o.key] || 0}票</span>`;
    const lo = new CSS2DObject(tag); lo.position.set(o.x, 5.2, o.z); scene.add(lo); btags.push(lo);
  }
  // 昼と夜
  const sky = makeSky(scene, { hemi, sun, sunDist: 60, lightAnchors, maxLights: LITE ? 2 : 8, dome: true, camera, radius: 320 });
  // 雲：薄く平たい箱を重ねた落ち着いた雲（js/clouds.js、戦いの確かめページと同じ）。ゆっくり流れる
  const clouds = makeClouds(scene, { count: LITE ? 10 : 18, area: 240, height: 95, speed: 1.4, scale: 1.7, opacity: 0.8 });
  const cloudDay = new THREE.Color(0xffffff), cloudNight = new THREE.Color(0x4a5570), cloudCol = new THREE.Color();
  sky.set(hourNow(), { x: 0, z: 0 });
  const homeless = active.filter((v) => !(life[v.key] || {}).home);
  // テント（家のない人の寝床。js/tents.js・config.json の tent）：たき火のうしろに大きいテントを 1 つ。人が多いと 2 つ目・3 つ目。
  //   中に 1 人 1 つの寝床（敷物。ベッドを作った人はベッド）を並べる。入れない人は、たき火のそばで横になる
  const tentP = tentPlan(active, life, config);
  const sqC = world.square ? { x: world.square.x, z: world.square.z } : { x: camp.x - 2.5, z: camp.z - 4 };
  const tObst = obstaclesFor(world, config).filter((o) => Math.hypot(o.x - sqC.x, o.z - sqC.z) < 30);
  const planSite = state.plan && state.plan.site && state.plan.site.plot !== 'ring' ? state.plan.site : null;
  const tentBlocked = (x, z) => (ISLANDS && !onLand(world, x, z, 1)) || tObst.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.2)
    || (world.pond && Math.hypot(x - world.pond.x, z - world.pond.z) < world.pond.r + 1)
    || (world.chest && world.chest.day && Math.hypot(x - world.chest.x, z - world.chest.z) < 1.3)
    || Math.hypot(x - camp.x, z - camp.z) < 2.3 || (planSite && Math.hypot(x - planSite.x, z - planSite.z) < 4.5);
  const tents = tentP.tents ? tentSites(sqC, tentP.tents, tentP.perTent, tentBlocked) : [];
  const tentOf = {}; // 村人 → { t: テント, i: 何番目の寝床 }
  for (const [k, s] of Object.entries(tentP.slot)) if (tents[s.tent]) tentOf[k] = { t: tents[s.tent], i: s.i };
  const tentPos = {}, tentAt = {}; // tentPos：休む所（テントの口の前。入れない人は たき火のそば）
  for (const [k, s] of Object.entries(tentOf)) tentPos[k] = tentFront(s.t, s.i, tentP.perTent);
  homeless.filter((v) => !tentOf[v.key]).forEach((v, i) => { const a = 0.6 + i * 0.9; tentPos[v.key] = { x: camp.x + Math.cos(a) * 3.2, z: camp.z + Math.sin(a) * 3.2 }; });
  // テントの形：ブロックを組んだ作り。羊毛ブロック（ドット絵の織り目、赤と白）と、原木の柱。
  //   横の低い壁 → 両がわから階段ブロックで上がる三角屋根（4 段）→ てっぺんの原木の棟木。奥と前の三角の壁も同じ段々で閉じる。
  //   前の壁のまん中に入口（はば TENT.door・高さ TENT.doorH。村人の背より高い）。寝床は奥に寄せて並べ、足の先と前の壁の間が通り道。
  //   壁の厚みは内がわへ TENT.wall だけ（寝床は ±len/2 - pad - 0.9 の内側なので、壁にかからない）
  //   屋根の部品には userData.tentRoof（屋根をはずして中を見る時に使う）
  const tentMats = (() => {
    let M = null;
    const wool = (key, pal, line) => pixelTex(key, (g, R) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pal[Math.floor(R() * pal.length)]);
      for (let y = 1; y < 15; y += 3) for (let x = (y % 2) + 1; x < 15; x += 4) { px(g, x, y, line); px(g, x + 1, y + 1, line); } // 織り目
      for (let i = 0; i < 16; i++) { px(g, i, 0, pal[0]); px(g, 0, i, pal[0]); px(g, i, 15, line); px(g, 15, i, line); } // ブロックのふち
    });
    const log = (key) => pixelTex(key, (g, R) => {
      const pal = ['#6b4a2b', '#5a3d22', '#7a5532', '#4e341c'];
      for (let x = 0; x < 16; x++) { const c = pal[Math.floor(R() * pal.length)]; for (let y = 0; y < 16; y++) px(g, x, y, R() < 0.18 ? pal[Math.floor(R() * pal.length)] : c); }
      for (let i = 0; i < 16; i++) { px(g, 0, i, '#3e2a16'); px(g, 15, i, '#3e2a16'); }
    });
    const lam = (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true; return new THREE.MeshLambertMaterial({ map: tex }); };
    return () => M || (M = {
      cream: lam(wool('tentwool', ['#efe6cf', '#e6dcc2', '#ddd2b6', '#f4ecd8'], '#c9bc9c')),
      red: lam(wool('tentwoolred', ['#c8443a', '#b93b32', '#d24e42', '#a9342c'], '#8a2a24')),
      rug: lam(wool('tentrug', ['#8a6a44', '#7f603c', '#94734b'], '#6a4f30')),
      log: lam(log('tentlog')),
    });
  })();
  // 箱の 6 面の UV を、1 ブロック（unit）で 1 回くり返すようにする（長い箱でも模様が伸びない）
  const blockGeo = (w, h, d, unit) => {
    const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * dims[f][0] / unit, uv.getY(j) * dims[f][1] / unit); }
    return geo;
  };
  const LAMP_GLASS = new THREE.MeshBasicMaterial({ color: 0xffd27a }); // ランタンのガラス（いつも明るい）
  function makeTent(t, perTent) {
    const g = new THREE.Group(), { depth: D, len: Lt } = t, { wallH: WH, ridgeH: RH, wall: TW, door: DW, doorH: DH } = TENT, M = tentMats();
    const hw = Lt / 2, N = 4, sh = (RH - WH) / N, top = Math.max(DW / 2 + 0.4, hw - (N - 1) * 1.1), sw = (hw - top) / (N - 1), BU = 1.1;
    const roofMats = { red: M.red.clone(), cream: M.cream.clone(), log: M.log.clone() }; // 屋根だけ自分の材質（近くから見る時に半透明にする）
    const blk = (w, h, d, m, x, y, z, roof) => {
      const o = new THREE.Mesh(blockGeo(w, h, d, BU), m); o.position.set(x, y, z);
      o.castShadow = !LITE; o.receiveShadow = true; if (roof) o.userData.tentRoof = true; g.add(o); return o;
    };
    // 屋根は階段ブロック（断面が L 字：下半分は 1 段のはば全部、上半分はてっぺん側の半分だけ）を両がわから 4 段。
    //   段 k（0 が軒、N-1 がてっぺん）。半分ずつ上がるので、斜めの面がなめらかに見える。
    //   面ごとに明暗：上の面がいちばん明るく、外を向いた立ち上がりの面は暗く、ほかは少し暗く（材質は屋根だけ自分の物。半透明にもする）
    const shadeOf = (m, f) => { const c = m.clone(); c.color.setScalar(f); return c; };
    const stairMats = [M.red, M.cream].map((m) => ({ top: roofMats[m === M.red ? 'red' : 'cream'], mid: shadeOf(m, 0.86), dark: shadeOf(m, 0.7) }));
    roofMats.more = stairMats.flatMap((q) => [q.mid, q.dark]);
    const stair = (w, h, x, y, k, side) => { // side：外を向いた面（+1 は +x、-1 は -x、0 はどちらも少し暗く）
      const q = stairMats[k % 2], mats = [side > 0 ? q.dark : q.mid, side < 0 ? q.dark : q.mid, q.top, q.mid, q.mid, q.mid];
      const o = blk(w, h, D + 0.6, mats, x, y, 0, true); return o;
    };
    const lo = (k) => WH + k * sh, h2 = sh / 2;
    blk(Lt - 0.1, 0.06, D - 0.1, M.rug, 0, 0.03, 0);                                     // 床の敷物
    for (const sd of [-1, 1]) blk(TW, WH, D, M.cream, sd * (hw - TW / 2), WH / 2, 0);      // 横の低い壁
    for (let k = 0; k < N; k++) {
      if (k < N - 1) for (const sd of [-1, 1]) {
        const a = hw - (k + 1) * sw, b = hw - k * sw;
        stair(b - a + 0.02, h2 + 0.02, sd * (a + b) / 2, lo(k) + h2 / 2, k, sd);                  // 下半分（はば全部）
        stair(sw / 2 + 0.02, h2 + 0.02, sd * (a + sw / 4), lo(k) + h2 * 1.5, k, sd);              // 上半分（てっぺん側の半分）
      } else {
        stair(2 * top, h2 + 0.02, 0, lo(k) + h2 / 2, k, 0);
        for (const sd of [-1, 1]) stair(top / 2 + 0.01, h2 + 0.02, sd * top / 4, lo(k) + h2 * 1.5, k, sd); // 上半分（まん中）
      }
    }
    blk(0.4, 0.4, D + 0.9, roofMats.log, 0, RH + 0.18, 0, true);                                // てっぺんの棟木（原木）
    // 奥と前の三角の壁：屋根の階段と同じ形（半分ずつの段）。前のまん中は入口（はば DW・高さ DH）をあける
    const cols = []; // [内がわの |x|, 外がわの |x|, 高さ]
    for (let k = 0; k < N - 1; k++) { const a = hw - (k + 1) * sw; cols.push([a + sw / 2, a + sw, lo(k) + h2], [a, a + sw / 2, lo(k) + sh]); }
    cols.push([top / 2, top, lo(N - 1) + h2], [0, top / 2, RH]);
    for (const zs of [-1, 1]) {
      const z = zs * (D / 2 - TW / 2);
      for (const [a, b, h] of cols) for (const sd of [-1, 1]) {
        const part = (p, q, y0) => { if (q - p > 1e-3 && h - y0 > 1e-3) blk(q - p, h - y0, TW, M.cream, sd * (p + q) / 2, (h + y0) / 2, z); };
        if (zs < 0 || b <= a || a >= DW / 2) { part(a, b, 0); continue; }
        part(Math.max(a, DW / 2), b, 0); part(a, Math.min(b, DW / 2), DH); // 入口のところは上だけ
      }
      if (zs > 0) {
        for (const sd of [-1, 1]) blk(0.3, DH, 0.4, M.log, sd * (DW / 2 + 0.15), DH / 2, z + 0.06); // 入口の原木の柱
        blk(DW + 0.6, 0.3, 0.4, M.log, 0, DH + 0.15, z + 0.06);                                  // 入口の上の横木
        blk(DW + 0.6, 0.1, 0.24, M.red, 0, DH + 0.35, z + 0.08);                                 // 巻き上げた入口の幕
      }
    }
    for (const s of [-1, 1]) for (const zs of [-1, 1]) blk(0.36, WH + 0.25, 0.36, M.log, s * (hw + 0.02), (WH + 0.25) / 2, zs * (D / 2 + 0.02)); // 角の原木の柱
    // 夜の明かり：中の棟木からつるしたランタンと、入口からもれる暖かい光
    const lamp = new THREE.Group();
    box(0.06, 0.6, 0.06, 0x2d2d2d, 0, 0.3, 0, lamp);
    for (const y of [0.04, -0.44]) box(0.44, 0.08, 0.44, 0x2d2d2d, 0, y, 0, lamp); // ランタンの上下のふた
    box(0.32, 0.4, 0.32, LAMP_GLASS, 0, -0.2, 0, lamp);
    lamp.position.set(0, RH - sh - 0.65, 0.4); g.add(lamp);
    const light = new THREE.PointLight(0xffb45a, 0, 9, 1.6); light.position.set(0, RH - sh - 1.2, 0.6); g.add(light);
    g.userData.roofMats = [roofMats.red, roofMats.cream, roofMats.log, ...roofMats.more]; g.userData.light = light; g.userData.fade = 1;
    g.position.set(t.x, 0, t.z); g.rotation.y = t.yaw;
    return g;
  }
  const tentGroups = tents.map((t) => { const m = makeTent(t, tentP.perTent); scene.add(m); return m; });
  // テントの中にかかる草花・小石は隠し、たいまつは輪にそって外へずらす（床やベッドを突きぬけない）
  if (tents.length) {
    const inAny = (x, z, pad) => tents.some((t) => inTent(t, x, z, pad));
    const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
    for (const inst of decoInst) {
      let ch = false;
      for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m4); v3.setFromMatrixPosition(m4); if (inAny(v3.x, v3.z, 0.4)) { m4.makeTranslation(v3.x, -60, v3.z); inst.setMatrixAt(i, m4); ch = true; } }
      if (ch) inst.instanceMatrix.needsUpdate = true;
    }
    if (debrisObj) debrisObj.traverse((o) => { if (o !== debrisObj && o.parent === debrisObj) { o.getWorldPosition(v3); if (inAny(v3.x, v3.z, 0.4)) o.visible = false; } });
    for (const T of torchObjs) for (let k = 1; k < 60 && inAny(T.g.position.x, T.g.position.z, 1.3); k++) {
      const a = T.a + Math.ceil(k / 2) * 0.12 * (k % 2 ? 1 : -1);
      T.g.position.set(T.cx + Math.cos(a) * T.R0, 0, T.cz + Math.sin(a) * T.R0); T.la.x = T.g.position.x; T.la.z = T.g.position.z;
    }
  }
  // 夜：テントの中の明かりをつける。カメラが近くて上から見ている時だけ、屋根を半透明にして中の寝床を見せる（昼はいつも屋根あり）
  function updateTents(n, dt) {
    const night = Math.min(1, Math.max(0, (n - 0.3) / 0.4));
    for (const g of tentGroups) {
      g.userData.light.intensity = night * 14;
      const d = Math.hypot(camera.position.x - g.position.x, camera.position.z - g.position.z);
      const want = night > 0.5 && d < 26 && camera.position.y > 8 && camera.position.y > d * 0.55 ? 0.22 : 1;
      const f = g.userData.fade + (want - g.userData.fade) * Math.min(1, dt * 4);
      if (Math.abs(f - g.userData.fade) < 1e-4 && f === want) continue;
      g.userData.fade = Math.abs(f - want) < 0.01 ? want : f;
      const solid = g.userData.fade > 0.99;
      for (const m of g.userData.roofMats) { if (m.transparent === solid) m.needsUpdate = true; m.opacity = g.userData.fade; m.transparent = !solid; m.depthWrite = solid; }
      g.traverse((o) => { if (o.userData.tentRoof) o.castShadow = solid && !LITE; });
    }
  }
  // 月あかり：夜だけ、青白い弱い光を上から当てる（寝ている人や見張りの形が分かるくらい。昼のようには明るくしない）
  const moon = new THREE.DirectionalLight(0xa9bcff, 0);
  scene.add(moon, moon.target);

  TM0.scene = performance.now();
  // ---------- 村人 ----------
  const drop = world.chest && world.chest.day ? { x: world.chest.x, z: world.chest.z } : { x: camp.x + 1.5, z: camp.z + 1.5 };
  const people = [];
  const clickables = [];
  const obstacles = obstaclesFor(world, config).concat(Object.values(tentPos).map((p) => ({ x: p.x, z: p.z, r: 0 })));
  // 道は読まれた時に初めて作る（あとから p.routes.night などを入れるのはそのまま使える）
  const lazyRoutes = (pairs) => {
    const r = {};
    for (const [k, [a, b]] of Object.entries(pairs)) {
      let v = null;
      Object.defineProperty(r, k, { enumerable: true, configurable: true, get: () => v || (v = safeRoute(a, b)), set: (x) => { v = x; } });
    }
    return r;
  };
  const footR = (b) => { const o = obstacles.find((q) => q.x === b.x && q.z === b.z); return o ? o.r : 2.2; };

  // ---------- ぶつからない決まり ----------
  // 入れない物（円）：建物・岩・木の幹（四角い幹の角まで）・テント・たき火・チェスト・畑・ベッド（2 マス）
  // 村人の体は、前後 0.45・左右 0.95（はば 1 ブロック）の だ円。人どうしも、この形で重ならない
  const BODY_F = 0.45, BODY_S = 0.95;
  // 金床（world3d.js の anvil：建物の右前）の場所と、鍛冶職人が立つ所（金床の円 0.8＋体の前 0.45 より外）
  const anvilOf = (b) => {
    const Lk = (config.buildings[b.type] || {}).look || {};
    if (Lk.props !== 'anvil') return null;
    const r = b.rot || 0, cs = Math.cos(r), sn = Math.sin(r), lx = (Lk.w || 4) / 2 + 0.75, lz = (Lk.d || 4) / 2;
    const at = (z) => ({ x: b.x + lx * cs + z * sn, z: b.z - lx * sn + z * cs });
    return { ...at(lz + 0.2), stand: at(lz + 1.5) };
  };
  const solids =obstaclesFor(world, config, { trees: false }).map((o) => ({ x: o.x, z: o.z, r: o.r }));
  for (const t of world.trees) if (t.state === 'tree' && !t.far && !t.gone) solids.push({ x: t.x, z: t.z, r: 0.95 * (t.size || 1), tree: t });
  for (const t of world.trees) if (t.state === 'stump' && !t.far && !t.gone) solids.push({ x: t.x, z: t.z, r: 0.75 * (t.size || 1) }); // 切り株にも乗らない
  for (const t of tents) { // テントの奥の壁・両はしの壁・前の壁（入口のところはあける。中は歩ける）
    for (let v = -t.len / 2; v <= t.len / 2 + 1e-6; v += 0.8) if (Math.abs(v) > TENT.door / 2 + 0.3) { const q = tentPoint(t, t.depth / 2 - 0.15, v); solids.push({ x: q.x, z: q.z, r: 0.4 }); }
    for (let v = -t.len / 2; v <= t.len / 2 + 1e-6; v += 0.8) { const q = tentPoint(t, -t.depth / 2 + 0.15, v); solids.push({ x: q.x, z: q.z, r: 0.4 }); }
    for (const s of [-1, 1]) for (let u = -t.depth / 2; u <= t.depth / 2 + 1e-6; u += 0.8) { const q = tentPoint(t, u, s * (t.len / 2 - 0.05)); solids.push({ x: q.x, z: q.z, r: 0.4 }); }
  }
  if (!baseVote) solids.push({ x: camp.x, z: camp.z, r: 1.3 });
  if (world.chest && world.chest.day) solids.push({ x: world.chest.x, z: world.chest.z, r: 0.95 });
  for (const f of world.fields || []) solids.push({ x: f.x, z: f.z, r: 1.9 });
  // 鍛冶屋の金床（world3d.js の anvil）：だれも通りぬけない。鍛冶職人は anvilOf の stand に立って打つ
  for (const b of world.buildings) { const an = anvilOf(b); if (an) solids.push({ x: an.x, z: an.z, r: 0.8, anvil: b.id }); }
  // 歩く道は、体の分だけ広げた円をよける
  const walls = solids.map((o) => ({ x: o.x, z: o.z, r: o.r + 0.8 }));
  if (world.pond) walls.push({ x: world.pond.x, z: world.pond.z, r: world.pond.r + 0.6 }); // 池の中は歩かない（ふちに立つ人の所は外）
  // 道の折れ目が別の木・岩にかかった時は、近くの空いたマスへずらす（行き先はそのまま）
  // 道：まず折れ線（routeAround）。ふさがった所を通る時（出だしが物のそば・テントや木が混んでいる所）は、マス目で道をさがす。
  // 体の横はば分あけた道がなければ（せまいすき間は体が通らない）、折れ線のまま（blocked の印。散歩なら別の行き先にする）
  // テントの中から・中への道は、入口を通る（通り道 → 入口の内がわ → 入口の外。tents.js の tentExit）
  const tentHas = (p) => tents.find((t) => inTent(t, p.x, p.z, -0.05));
  const safeRoute = (a, b) => {
    const ta = tentHas(a), tb = tentHas(b);
    if (!ta && !tb) return safeRoute1(a, b);
    if (ta && ta === tb) return [tentExit(ta, a)[0], tentExit(tb, b)[0], b];
    const pre = ta ? tentExit(ta, a) : [], post = tb ? tentExit(tb, b).reverse() : [];
    const mid = safeRoute1(ta ? pre[2] : a, tb ? post[0] : b);
    const r = [...pre, ...mid, ...post.slice(1), ...(tb ? [b] : [])];
    if (mid.blocked) r.blocked = true;
    return r;
  };
  const safeRoute1 = (a, b) => {
    const r0 = routeAround(a, b, walls);
    if (lineOk(a, r0)) return r0;
    const g = gridRoute(a, b, CLR);
    if (g) return g;
    r0.blocked = true;
    return r0;
  };
  // 歩ける所：陸の上で、池にも、木・岩・切り株・建物・テントにも体（横はば 0.95）がかからない
  const CLR = 1.0;
  const walkable = (x, z, clr = CLR) => onLand(world, x, z, 0.8) && !(world.pond && Math.hypot(x - world.pond.x, z - world.pond.z) < world.pond.r + clr) && isFree(x, z, clr);
  // 海べの釣り場（島の町だけ）：いちばん大きな島のふちを 24 の向きに見て、岸の少し内側に立てる所。橋のたもとはよける。
  //   fx/fz は海の上（うきを投げる向き）。村人ごとに名前で 1 つ選ぶ。isFree などが用意できてから、初めて使う時に作る
  let seaSpots0 = null;
  const seaSpots = () => {
    if (seaSpots0) return seaSpots0;
    seaSpots0 = [];
    const isl = (world.islands || []).find((i) => i.id === MAIN);
    if (isl) for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2, r = radiusAt(isl, ang), cx = Math.cos(ang), cz = Math.sin(ang);
      const x = isl.x + cx * (r - 1.5), z = isl.z + cz * (r - 1.5);
      if (!walkable(x, z) || (world.bridges || []).some((b) => Math.hypot(x - b.a.x, z - b.a.z) < 6)) continue;
      seaSpots0.push({ x, z, fx: isl.x + cx * (r + 3), fz: isl.z + cz * (r + 3), sea: true });
    }
    return seaSpots0;
  };
  const seaSpotOf = (key) => { const l = seaSpots(); return l[hash(key + 'sea') % l.length]; };
  // 物のふちまでのすきま
  const clearAt = (x, z) => { let c = 9; for (const o of solidNear(x, z)) c = Math.min(c, Math.hypot(x - o.x, z - o.z) - o.r); return c; };
  // 折れ線の上をたどって、ふさがった所がないか（出だし・行き先のそばでは、そこより物に近づかなければよい＝物のそばに立っている所から出られるように）
  function lineOk(a, pts, clr = CLR) {
    let p = a;
    const end = pts[pts.length - 1];
    // 出だしのそばで物に近い所は、物から離れていく（すきまがせまくならない）向きだけよい（2 つの物のあいだのせまいすき間には入らない）
    const ce = Math.max(0.2, Math.min(clr, clearAt(end.x, end.z) - 0.03));
    let prevA = clearAt(a.x, a.z), leaving = true;
    for (const q of pts) {
      const d = Math.hypot(q.x - p.x, q.z - p.z), n = Math.ceil(d / 0.25);
      for (let k = 1; k <= n; k++) {
        const x = p.x + ((q.x - p.x) * k) / n, z = p.z + ((q.z - p.z) * k) / n;
        const nearE = Math.hypot(x - end.x, z - end.z) < 1.5;
        if (leaving && !walkable(x, z, clr)) {
          const c = clearAt(x, z);
          if (Math.hypot(x - a.x, z - a.z) < 1.5 && c >= prevA - 0.02 && onLand(world, x, z, 0.8)) { prevA = c; continue; }
          return false;
        }
        leaving = false;
        if (nearE) { if (!isFree(x, z, ce)) return false; continue; }
        if (!walkable(x, z, clr)) return false;
      }
      p = q;
    }
    return true;
  }
  // マス目（はば 0.95）の A*（clr：物からあけるすきま）。見つかったら、まっすぐ行ける所はまとめて折れ目を少なくする
  function gridRoute(a, b, clr = CLR) {
    // 物のそばに立っている時は、まず物から離れる向きに、歩ける所まで出る（そこからマス目で）
    let pre = [];
    if (!walkable(a.x, a.z, clr)) {
      let e = null;
      for (let r = 0.5; r <= 3 && !e; r += 0.5) for (let k = 0; k < 16 && !e; k++) {
        const q = { x: a.x + Math.cos(k * Math.PI / 8) * r, z: a.z + Math.sin(k * Math.PI / 8) * r };
        if (walkable(q.x, q.z, clr) && lineOk(a, [q], clr)) e = q;
      }
      if (!e) return null;
      pre = [e]; a = e;
    }
    const C = 0.95, M = 12;
    const x0 = Math.min(a.x, b.x) - M, z0 = Math.min(a.z, b.z) - M;
    const W = Math.min(100, Math.ceil((Math.max(a.x, b.x) + M - x0) / C)), H = Math.min(100, Math.ceil((Math.max(a.z, b.z) + M - z0) / C));
    const cell = (x, z) => [Math.max(0, Math.min(W - 1, Math.floor((x - x0) / C))), Math.max(0, Math.min(H - 1, Math.floor((z - z0) / C)))];
    const [si, sj] = cell(a.x, a.z), [gi, gj] = cell(b.x, b.z), S0 = sj * W + si, G = gj * W + gi;
    if (S0 === G) return [...pre, { x: b.x, z: b.z }];
    const cb = Math.max(0.3, Math.min(clr, clearAt(b.x, b.z) - 0.03)); // 行き先のそばは、行き先より物に近づかなければよい
    const N = W * H, ok = new Int8Array(N).fill(-1), g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const free = (k) => {
      if (k === S0 || k === G) return true;
      if (ok[k] < 0) {
        const x = x0 + ((k % W) + 0.5) * C, z = z0 + (Math.floor(k / W) + 0.5) * C;
        ok[k] = (Math.hypot(x - b.x, z - b.z) < 1.5 ? onLand(world, x, z, 0.8) && isFree(x, z, cb) : walkable(x, z, clr)) ? 1 : 0;
      }
      return ok[k] === 1;
    };
    // 小さい順に取り出す山（f = g + 残りの見こみ）
    const hk = [], hf = [];
    const push = (k, f) => { let i = hk.length; hk.push(k); hf.push(f); while (i > 0) { const pa = (i - 1) >> 1; if (hf[pa] <= f) break; hk[i] = hk[pa]; hf[i] = hf[pa]; i = pa; } hk[i] = k; hf[i] = f; };
    const pop = () => { const k = hk[0], lk = hk.pop(), lf = hf.pop(); if (hk.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hk.length) break; if (c + 1 < hk.length && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hk[i] = hk[c]; hf[i] = hf[c]; i = c; } hk[i] = lk; hf[i] = lf; } return k; };
    const hh = (k) => Math.hypot((k % W) - gi, Math.floor(k / W) - gj);
    g[S0] = 0; push(S0, hh(S0));
    let found = false;
    for (let it = 0; hk.length && it < 5000; it++) {
      const k = pop();
      if (done[k]) continue; done[k] = 1;
      if (k === G) { found = true; break; }
      const i = k % W, j = Math.floor(k / W);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni; if (done[nk] || !free(nk)) continue;
        if (di && dj && (!free(j * W + ni) || !free(nj * W + i))) continue; // 角をかすめない
        const ng = g[k] + (di && dj ? 1.414 : 1);
        if (ng < g[nk]) { g[nk] = ng; from[nk] = k; push(nk, ng + hh(nk)); }
      }
    }
    if (!found) return null;
    const pts = [];
    for (let k = from[G]; k >= 0 && k !== S0; k = from[k]) pts.unshift({ x: x0 + ((k % W) + 0.5) * C, z: z0 + (Math.floor(k / W) + 0.5) * C });
    pts.push({ x: b.x, z: b.z });
    // まっすぐ見通せる所までとばす（遠くまで見るのは 24 マス先まで）
    const out = []; let cur = a;
    for (let m = 0; m < pts.length;) {
      let far = m;
      for (let n = Math.min(pts.length - 1, m + 24); n > m; n--) if (lineOk(cur, [pts[n]], clr)) { far = n; break; }
      out.push(pts[far]); cur = pts[far]; m = far + 1;
    }
    return [...pre, ...out];
  }
  let solidIx = null;
  const solidNear = (x, z) => { if (!solidIx) solidIx = SpatialHash.of(solids, 4); return solidIx.near(x, z, 9); };
  // 広場をかこむ道（だ円、中心 (0,-1)・半径 12-3.7）からの距離。道の上には寝ない・ベッドを置かない
  const ringD = (x, z) => Math.abs(Math.hypot(x - CTR.x, (z - CTR.z) / 0.92) - 8.3);
  // 体の だ円の、向き yaw の人から (dx, dz) の方への半径
  const bodyR = (yaw, dx, dz) => { const l = Math.hypot(dx, dz) || 1, c = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / l, s = Math.sqrt(Math.max(0, 1 - c * c)); return (BODY_F * BODY_S) / Math.hypot(BODY_S * c, BODY_F * s); };
  // 横になって寝ている人（足もと → 頭の線）。歩く人も、ほかの寝る人も、ここに重ならない
  const lying = [];
  const segD = (x, z, s) => { const vx = s.hx - s.x, vz = s.hz - s.z, L2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((x - s.x) * vx + (z - s.z) * vz) / L2)); return Math.hypot(x - (s.x + vx * u), z - (s.z + vz * u)); };
  // 自分の物（自分のベッド）だけは見ない。持ち主のない物（木・岩・テント）は、self がない時も必ず見る
  const isFree = (x, z, rad, self) => !solidNear(x, z).some((o) => !(self && o.owner === self) && Math.hypot(x - o.x, z - o.z) < o.r + rad) && !lying.some((s) => s.key !== self && segD(x, z, s) < 0.5 + rad);
  // 空いていなければ、いちばん近い空いたマス（1 ブロック）のまん中へずらす
  function freePt(pt, rad = BODY_S, self) {
    if (!pt || isFree(pt.x, pt.z, rad, self)) return pt;
    const i0 = Math.floor(pt.x / TILE), j0 = Math.floor(pt.z / TILE), c = [];
    for (let di = -7; di <= 7; di++) for (let dj = -7; dj <= 7; dj++) { const x = (i0 + di + 0.5) * TILE, z = (j0 + dj + 0.5) * TILE; c.push({ x, z, d: Math.hypot(x - pt.x, z - pt.z) }); }
    c.sort((a, b) => a.d - b.d);
    for (const q of c) if (isFree(q.x, q.z, rad, self)) return { ...pt, x: q.x, z: q.z };
    return pt;
  }

  // ---------- 1 時間ごとの行動（sim.js の L.hours）。ふだんは日本時間の今の時、?hour=N でその時 ----------
  const HC = config.hours || null;
  const ENEMIES_ON = !!(config.enemies && config.enemies.enabled);
  let curHour = Math.floor(hourNow()) % 24;
  const nightAt = (h) => (HC ? isNight(h, HC) : h >= 21 || h < 6);
  const penB = world.buildings.find((b) => b.type === 'pen');
  // 今の時間の行動。L.hours のない古いデータは、その日のおもな行動（夜は寝る）
  function actNow(L, h) {
    const x = hourOf(L, h);
    if (!x) return nightAt(h) ? { action: 'sleep', place: 'ground' } : { action: L.action, target: L.target };
    const a = { action: x.action, target: x.target, place: x.place };
    if (a.action === 'stump') { a.action = 'chop'; a.stump = true; }
    if (a.action === 'fish') a.target = a.target === 'sea' && seaSpots().length ? 'sea' : 'pond'; // 海べ（f:sea）か池
    if (a.action === 'ranch') a.target = penB ? penB.id : null;
    // 遠くの木・岩まで歩く 1 時間：その仕事場へ向かって歩く（着いたらそのまま仕事の形）。寝る前に村へ帰る 1 時間：家・テントへ
    if (a.action === 'walkout') { const o = objById[a.target]; a.action = o && o.hp !== undefined ? 'dig' : 'chop'; a.walking = true; }
    if (a.action === 'walkhome') a.action = 'rest';
    return a;
  }
  const sameAct = (a, b) => a && b && a.action === b.action && a.target === b.target && a.place === b.place && !!a.stump === !!b.stump;
  // 寝る木：今の木（記号の中）か、家・テントにいちばん近い木
  let treeIx = null;
  // 同じテントの人が同じ木に重ならないように、近い 6 本から人ごとに選ぶ
  function nearestTree(at, key = '') {
    if (!treeIx) treeIx = SpatialHash.of(world.trees.filter((t) => !t.gone && t.state === 'tree'), 4);
    const c = treeIx.nearest(at.x, at.z, 6).filter((t) => Math.hypot(t.x - at.x, t.z - at.z) < 30);
    return c.length ? c[hash(key + 'tree') % c.length] : null;
  }
  function sleepSpot(p, a) {
    // 家の中のベッド：家の扉まで歩いて入る（外からは見えない。家の上に「寝ている」の札）。家の外のベッドは、その上で横になる
    if (a.place === 'bed' && p.bedAt) return p.bedAt.inside ? { x: p.home.x, z: p.home.z, yaw: 0, inside: true, bed: true, inBed: p.bedAt } : { ...p.bedAt, inside: false, bed: true };
    if (a.place === 'tree') {
      // 幹にせなかをあずけて座る（幹と反対を向く）。幹は四角（はば 1.3 × 木の大きさ）なので、平らな面に背中をつける
      // 1 本の木には、肩が当たらない 向かい合わせの 2 面まで。いっぱいなら 近くの別の木へ
      const old = lying.findIndex((s) => s.key === p.v.key && s.tree); if (old >= 0) lying.splice(old, 1);
      // 村のまん中から treeR 以内（広場のふちから数マス）の木だけ。遠くの森では寝ない。なければ地面
      const treeR = ((config.hours && config.hours.far) || {}).treeR || 15;
      const nearBase = (t) => Math.hypot(t.x - camp.x, t.z - camp.z) <= treeR + 0.01;
      const t0 = a.target && objById[a.target];
      if (!treeIx) nearestTree(p.home);
      const near = treeIx.nearest(camp.x, camp.z, 16).filter(nearBase);
      const sh = hash(p.v.key + 'tree') % Math.max(1, near.length);
      const cands = [...(t0 && t0.state === 'tree' && !t0.gone && nearBase(t0) ? [t0] : []), ...near.slice(sh), ...near.slice(0, sh)];
      for (const t of cands) {
        const toward = Math.round(Math.atan2(p.home.x - t.x, p.home.z - t.z) / (Math.PI / 2));
        // 幹の半分＋もたれた時に いちばん後ろへ出る所（頭の後ろ）。2 頭身は頭が大きいので もう少し離す
        const r = 0.65 * (t.size || 1) + (chibiOf(p.v) ? 1.05 : 0.82), h0 = hash(p.v.key + 'ta') % 4;
        for (let k = 0; k < 4; k++) {
          const a0 = (toward + h0 + k) * (Math.PI / 2), x = t.x + Math.sin(a0) * r, z = t.z + Math.cos(a0) * r, lx = x + Math.sin(a0) * 1.4, lz = z + Math.cos(a0) * 1.4;
          const ok = !lying.some((s) => s.key !== p.v.key && (segD(x, z, s) < 2.6 || segD(lx, lz, s) < 1.6))
            && solidNear(x, z).every((o) => o.tree === t || (Math.hypot(x - o.x, z - o.z) > o.r + 1.0 && Math.hypot(lx - o.x, lz - o.z) > o.r + 0.6));
          if (ok) { lying.push({ x, z, hx: lx, hz: lz, key: p.v.key, tree: true }); return { x, z, yaw: a0, inside: false, tree: t }; }
        }
      }
    }
    // 地面・床：家があれば家の中の床（外からは見えない）。なければテントの中の自分の敷物（ベッドがあればベッド）。
    //   テントに入れない人は、たき火のそばで横になる
    if (p.homeB) return { x: p.home.x, z: p.home.z, yaw: 0, inside: true };
    if (!p.groundAt) p.groundAt = tentOf[p.v.key] ? (p.bedAt ? { ...p.bedAt, inside: false, bed: true } : matSpot(p)) : campSpot(p);
    return p.groundAt;
  }
  // テントの中の敷物の上（頭は奥の壁の側、足はテントの口の側）
  function matSpot(p) {
    const s = tentOf[p.v.key], f = sleeperOnBed(tentBed(s.t, s.i, tentP.perTent), chibiOf(p.v));
    return { x: f.x, z: f.z, yaw: f.yaw, inside: false, mat: true };
  }
  // たき火のそば：足をたき火に向けて、まわりに輪になって寝る。テント・物・ほかの寝ている人にかからない所。1 回決めたら同じ所
  function campSpot(p) {
    const a0 = (hash(p.v.key + 'cf') % 24) * Math.PI / 12;
    for (const r of [2.5, 3.1, 3.8]) for (let k = 0; k < 24; k++) {
      const a = a0 + k * Math.PI / 12, x = camp.x + Math.cos(a) * r, z = camp.z + Math.sin(a) * r;
      const yaw = Math.atan2(camp.x - x, camp.z - z), hx = x - Math.sin(yaw) * 3.6, hz = z - Math.cos(yaw) * 3.6;
      let ok = true;
      for (let j = 0; j <= 6 && ok; j++) {
        const px = x + (hx - x) * j / 6, pz = z + (hz - z) * j / 6;
        if (!isFree(px, pz, 0.5, p.v.key) || tents.some((t) => inTent(t, px, pz, 0.5)) || (ISLANDS && !onLand(world, px, pz, 1))) ok = false;
      }
      if (ok) { lying.push({ x, z, hx, hz, key: p.v.key }); return { x, z, yaw, inside: false }; }
    }
    return groundSpot(p);
  }
  // テントのそばの、体（足もと→頭 3.6）がテント・たき火・木・ほかの寝ている人にかからない所。1 回決めたら同じ所
  function groundSpot(p) {
    const t = tentAt[p.v.key] || { x: p.home.x, z: p.home.z, a: Math.atan2(p.home.z - camp.z, p.home.x - camp.x) };
    let ringM = 2.2;
    const segOk = (x, z, hx, hz) => {
      for (let k = 0; k <= 6; k++) {
        const u = k / 6, px = x + (hx - x) * u, pz = z + (hz - z) * u;
        if (Math.hypot(px - camp.x, pz - camp.z) < 2.6) return false;
        if (ringD(px, pz) < ringM) return false; // 広場をかこむ道の上では寝ない（どうしても場所がなければ道のはしまで）
        if (!isFree(px, pz, 0.5, p.v.key)) return false;
      }
      return true;
    };
    const flip = hash(p.v.key + 'y') % 2 ? 1 : -1;
    for (ringM of [2.2, 1.2, 0]) for (const d of [2.2, 2.8, 3.4, 4.2, 5.2]) for (let j = 0; j < 12; j++) {
      const da = (j % 2 ? -1 : 1) * Math.PI / 2 + (j >> 1) * (Math.PI / 6) * (j % 2 ? -1 : 1);
      const a = t.a + da * flip, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      for (const ya of [a + Math.PI / 2, a - Math.PI / 2, a]) { // テントのまわりにそって（または外向きに）寝る
        const yaw = Math.atan2(Math.cos(ya), Math.sin(ya)), hx = x - Math.sin(yaw) * 3.6, hz = z - Math.cos(yaw) * 3.6;
        if (segOk(x, z, hx, hz)) { lying.push({ x, z, hx, hz, key: p.v.key }); return { x, z, yaw, inside: false }; }
      }
    }
    return { x: p.home.x, z: p.home.z, yaw: 0, inside: false };
  }
  // ベッドはマイクラのベッドの形（はば 1 マス・長さ 2 マス）を少し小さくしたもの（大きさは js/beds.js の BED）
  const placedBeds = [], bedTiles = new Set();
  // 寝床（ベッド・敷物）の上は、持ち主のほかは入れない（テントの中の寝床どうしの間は、ほかの人が通れるくらい r を小さく）
  function bedBlock(cx, cz, yaw, owner, r) {
    for (const s of [-0.5, 0.5]) {
      const x = cx + Math.sin(yaw) * TILE * s, z = cz + Math.cos(yaw) * TILE * s;
      bedTiles.add(Math.floor(x / TILE) + ',' + Math.floor(z / TILE));
      const o = { x, z, r, owner }; solids.push(o); walls.push({ x, z, r: o.r + 0.8 }); if (solidIx) solidIx.set(o, x, z, o);
    }
  }
  // ベッドの置き場所：家があれば家の中（住む順に横に並べる。家は外から中が見えないので描かない）。
  // なければテントの中の自分の寝床の所（敷物のかわりにベッド）。外には置かない
  function bedSpot(p, slot = 0) {
    let cx, cz, yaw;
    if (p.homeB) {
      const look = config.buildings[p.homeB.type].look || {};
      const bd = bedInHouse(p.homeB, look, slot);
      placedBeds.push({ x: bd.cx, z: bd.cz });
      return { ...sleeperOnBed(bd, chibiOf(p.v)), cx: bd.cx, cz: bd.cz, inside: true };
    } else {
      // 家がなければ、テントの中の自分の寝床（js/tents.js）。テントに入れない人（いっぱい）のベッドは置かない（ベッドは外に置かない）
      const s = tentOf[p.v.key];
      if (!s) return null;
      ({ cx, cz, yaw } = tentBed(s.t, s.i, tentP.perTent));
    }
    // ベッドの 2 マスは、ほかの人が入れない所になる（持ち主だけ入って寝る）
    bedBlock(cx, cz, yaw, p.v.key, 0.6);
    placedBeds.push({ x: cx, z: cz });
    // 村人の足の位置。頭はまくらの側（向きの反対）で、まくら側の板のすぐ内側
    return { ...sleeperOnBed({ cx, cz, yaw }, chibiOf(p.v)), cx, cz };
  }
  // ベッドは 4 つの部品をまとめて描く（人が多くても軽い）。家の中のベッドは見えないので描かない
  function makeBeds(list) {
    list = list.filter((p) => !p.bedAt.inside);
    if (!list.length) return;
    const parts = bedParts().map(([w, h, d, x, y, z, col]) => [new THREE.BoxGeometry(w, h, d).translate(x, y, z), col]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const [g, col] of parts) {
      const im = new THREE.InstancedMesh(g, mat(col), list.length);
      list.forEach((p, k) => { q.setFromAxisAngle(up, p.bedAt.yaw); m4.compose(new THREE.Vector3(p.bedAt.cx, 0, p.bedAt.cz), q, one); im.setMatrixAt(k, m4); });
      im.castShadow = !LITE; im.receiveShadow = true; scene.add(im);
    }
  }
  // 家の中で寝ている人がいる家の上に「寝ている」の札（家は外から中が見えないので、札で分かるようにする）
  const sleepTags = new Map();
  function updateSleepTags() {
    const n = new Map();
    for (const p of people) if (p.mode === 'sleep' && p.sleepAt && p.sleepAt.inside && p.homeB) n.set(p.homeB.id, (n.get(p.homeB.id) || 0) + 1);
    for (const [id, c] of n) {
      let t = sleepTags.get(id);
      if (!t) {
        const b = objById[id], el = document.createElement('div'); el.className = 'btag sleeptag';
        const obj = new CSS2DObject(el); obj.position.set(b.x, ((config.buildings[b.type].look || {}).h || 2) + 0.9, b.z); scene.add(obj);
        t = { el, obj }; sleepTags.set(id, t);
      }
      t.el.textContent = c > 1 ? `Zz ${c} 人が寝ている` : 'Zz 寝ている';
      t.obj.visible = true; t.el.style.display = '';
    }
    for (const [id, t] of sleepTags) if (!n.has(id)) { t.obj.visible = false; t.el.style.display = 'none'; }
  }
  // 仕事のあとの時間の場所（人と時刻から決まる。おしゃべりは 2 人で同じ場所を出して向かい合う）
  const FREE_ACT = new Set(['walk', 'chat', 'view', 'water', 'pet', 'help']);
  const plaza = world.square || camp || CTR; // 拠点が決まる前（0 日目）も島のまん中
  // 散歩の行き先：陸の上で、池・木・岩・建物にかからない所（だめなら別の向きを試す。最後は近くの空いたマス）
  function wanderPt(p, i) {
    let c = null;
    for (let k = 0; k < 8; k++) {
      const s = i + ':' + k, a = ((hash(p.v.key + 'w' + curHour + ':' + s) % 628) / 100), r = 8 + (hash(p.v.key + 'wr' + s) % 120) / 10;
      c = { x: plaza.x + Math.cos(a) * r, z: plaza.z + Math.sin(a) * r };
      if (!onLand(world, c.x, c.z, 2)) continue;
      if (world.pond && Math.hypot(c.x - world.pond.x, c.z - world.pond.z) < world.pond.r + 2) continue;
      if (walls.some((o) => Math.hypot(c.x - o.x, c.z - o.z) < o.r)) continue;
      return freePt(c);
    }
    return freePt({ x: plaza.x + (c.x - plaza.x) * 0.5, z: plaza.z + (c.z - plaza.z) * 0.5 });
  }
  // おしゃべりの場所の候補（開いた時に 1 回だけ作る）：家の入口の前・村に近い木の下（葉の下で幹の外）・池のふち
  let chatSpots = null;
  function chatPlace(hk) {
    if (!chatSpots) {
      chatSpots = [];
      for (const b of world.buildings) if (b.type === 'house' || b.type === 'storehouse') { const r = footR(b) + 3; chatSpots.push({ x: b.x + Math.sin(b.rot || 0) * r, z: b.z + Math.cos(b.rot || 0) * r }); }
      if (!treeIx) nearestTree(plaza);
      for (const t of treeIx.nearest(plaza.x, plaza.z, 6)) { const a0 = Math.atan2(t.x - plaza.x, t.z - plaza.z); chatSpots.push({ x: t.x - Math.sin(a0) * (1.4 * (t.size || 1) + 1.6), z: t.z - Math.cos(a0) * (1.4 * (t.size || 1) + 1.6) }); }
      if (world.pond) for (let k = 0; k < 3; k++) { const a0 = k * 2.1 + 0.4, r = world.pond.r + 2.4; chatSpots.push({ x: world.pond.x + Math.cos(a0) * r, z: world.pond.z + Math.sin(a0) * r }); }
      if (!chatSpots.length) chatSpots.push({ x: plaza.x + 9, z: plaza.z + 9 });
    }
    const c = chatSpots[hk % chatSpots.length];
    return c.ok ? c : Object.assign(c, freePt({ x: c.x, z: c.z }, 1.05 + BODY_S), { ok: true }); // 2 人が並べる広さがある所
  }
  function freeSpot(p, a, ang) {
    const act = a.action;
    if (act === 'chat' && a.target) {
      // 広場のまん中ではなく、家の前・木の下・池のそば のどれか（2 人で同じ所を選ぶ）。2 人のあいだは 2.1（お辞儀しても頭が当たらない）
      const [k1, k2] = [p.v.key, a.target].sort(), hk = hash(k1 + '|' + k2 + curHour), c = chatPlace(hk);
      const da = ((hk >> 3) % 628) / 100, s = p.v.key === k1 ? 1 : -1, hw = 1.05;
      return { x: c.x + Math.cos(da) * hw * s, z: c.z + Math.sin(da) * hw * s, fx: c.x - Math.cos(da) * hw * s, fz: c.z - Math.sin(da) * hw * s };
    }
    if (act === 'view' && world.pond) {
      const r = world.pond.r + 1.4;
      return { x: world.pond.x + Math.cos(ang) * r, z: world.pond.z + Math.sin(ang) * r, fx: world.pond.x, fz: world.pond.z };
    }
    const tg = act === 'water' ? objById[a.target] : act === 'pet' ? penB : null;
    // 畑は作物の外（ふちの外側）に立つ
    if (tg) { const off = act === 'pet' ? 3.4 : 2.7; return { x: tg.x + Math.cos(ang) * off, z: tg.z + Math.sin(ang) * off, fx: tg.x, fz: tg.z }; }
    if (act === 'help') return p.work || { x: p.home.x, z: p.home.z, fx: null };
    return { ...wanderPt(p, 0), fx: null };
  }
  // 行動を人に当てはめる（init：開いた時はその場所から始める）
  function setAct(p, a, init) {
    const L = life[p.v.key] || {};
    p.act = a; p.rest = false; p.stay = false; p.sleepAt = null; p.w0 = null; p.mine = null; p.bobAt = null;
    p.routes = p.routes || {};
    if (a.action === 'sleep') {
      const sp = sleepSpot(p, a);
      p.sleepAt = sp; p.sleepPlace = a.place;
      if (init) { p.mode = 'sleep'; p.pos = { x: sp.x, z: sp.z }; p.ch.rotation.y = sp.yaw; }
      else { p.mode = 'gohome'; p.ri = 0; p.routes = lazyRoutes({ night: [{ ...p.pos }, sp] }); }
      return;
    }
    if (p.guard && (a.action === 'guard' || (ENEMIES_ON && nightAt(curHour)))) { // 敵が出る夜の見張り
      if (init) { p.mode = 'guard'; p.pos = { ...p.guard }; }
      else { p.mode = 'toguard'; p.ri = 0; p.routes = lazyRoutes({ night: [{ ...p.pos }, p.guard] }); }
      return;
    }
    // 敵が出る夜、見張りでない起きている人は家の前にいる（見張りは 1 晩 2〜4 人だけ）
    if (ENEMIES_ON && nightAt(curHour) && !p.guard && p.home) a = { ...a, action: 'rest', target: null };
    p.mode = 'day'; p.ch.visible = true;
    const act = a.action === 'help' ? 'carry' : a.action; // 荷物運びの手伝いは、運ぶ人と同じ動き
    const tg = a.target === 'square' ? world.square : a.target === 'site' ? state.plan && state.plan.site : a.target === 'pond' ? world.pond : a.target && objById[a.target];
    const ang = (hash(p.v.key) % 360) * Math.PI / 180;
    let work;
    p.wander = false;
    if (FREE_ACT.has(act)) {
      // 仕事のあとの時間：散歩（村のまわりを歩きまわる）・おしゃべり（2 人で向かい合う）・海をながめる（池のそばに座る）・
      // 畑に水・動物をなでる（その前でしゃがむ）・荷物運びの手伝い（運ぶ人と同じ動き）
      p.stay = act !== 'help';
      work = freeSpot(p, a, ang);
    } else if (act === 'smith' && tg && tg.type) {
      // 鍛冶：鍛冶屋の金床（world3d.js の anvil）の前に立って、金床を向いて打つ
      const an = anvilOf(tg);
      if (an) { p.stay = true; work = { x: an.stand.x, z: an.stand.z, fx: an.x, fz: an.z }; }
    } else if (act === 'fish' && a.target === 'sea') {
      work = { ...seaSpotOf(p.v.key) }; // 海べの釣り場：岸に立って海を向く
    } else if (act === 'rest' || act === 'eat' || act === 'craft' || act === 'guard') {
      // 休む・食べる：家（テント）の前。道具を作る：チェストのそば。見張り：村のはずれ
      p.stay = true;
      work = act === 'rest' ? { ...p.home, fx: null } : act === 'guard' ? { x: Math.cos(ang) * 22, z: Math.sin(ang) * 20 - 1, fx: null } : { x: p.drop.x, z: p.drop.z, fx: drop.x, fz: drop.z };
    } else {
      // 木を切る人は葉の外に立つ（頭が葉に入らないように）、掘る人は岩の外に立つ
      const off = act === 'fish' ? (world.pond ? world.pond.r + 0.9 : 1.2) : act === 'ranch' ? 3.4 : act === 'level' ? 2 + (hash(p.v.key + 'lv') % 40) / 10 : act && act.startsWith('dig') ? 2.6 : act === 'apple' ? 1.25 * ((tg && tg.size) || 1) + 0.6 : act === 'chop' ? (a.stump ? 1.6 : 1.25 * ((tg && tg.size) || 1) + 0.6) : 1.2;
      work = tg ? { x: tg.x + Math.cos(ang) * off, z: tg.z + Math.sin(ang) * off, fx: tg.x, fz: tg.z } : { x: -12 + (hash(p.v.key) % 9), z: 12 + (hash(p.v.key) % 5), fx: null };
      if (act === 'carry' && p.work && !init) work = p.work; // 運んだら、さっきの仕事場へもどる
    }
    // 立つ所は、物にも寝ている人にもかからない所（かかる時は近くの空いたマスへ）
    if (a.action !== 'chat' && a.action !== 'smith') work = freePt(work, BODY_S, p.v.key); // 鍛冶は金床の前から動かさない
    p.work = work;
    p.pose = { level: 'dig', chop: 'chop', dig: 'dig', dig_last: 'dig', berry: 'gather', apple: 'gather', harvest: 'gather', tend: 'gather', till: 'dig', forage: 'gather', fish: 'fish', ranch: 'gather', craft: 'gather', smith: 'smith', walk: 'walk', chat: 'talk', view: 'sit', water: 'water', pet: 'gather' }[act] || (p.stay ? 'idle' : 'gather');
    let tool = { level: 'hoe', chop: 'axe', dig: 'pick', dig_last: 'pick', till: 'hoe', berry: 'basket', apple: 'basket', harvest: 'basket', tend: 'hoe', forage: 'basket', fish: 'rod', ranch: 'basket', guard: 'torch', water: 'basket', smith: 'hammer' }[act] || null;
    if (act === 'walk') { p.wander = true; p.wi = 0; p.routes.w = null; }
    // 持っている道具の素材（木・石・鉄・金・ダイヤ）で色と形を変える。素手で切る・掘る人は何も持たない
    const tier = L.toolTier || 'hand';
    if ((tool === 'axe' || tool === 'pick') && tier === 'hand') tool = null;
    p.tool = tool; p.toolKey = tool && ['axe', 'pick', 'hoe', 'rod'].includes(tool) ? tool + ':' + (tier === 'hand' ? 'wood' : tier) : tool;
    // 建物・木・岩をよける道（折れ線）。人が多いと重いので、初めて歩く時に作る
    p.routes = lazyRoutes({ 0: [init ? p.home : { ...p.pos }, work], 2: [act === 'carry' && !init ? { ...p.pos } : work, p.drop], 4: [p.drop, work] });
    if (init) { if (p.stay) { p.pos = { x: work.x, z: work.z }; p.phase = 1; } }
    else { p.phase = act === 'carry' ? 2 : 0; p.ri = 0; p.t = 0; setupMine(p); }
  }
  // ベッドは、人の立つ所を決める前に みんなの分を先に置く（あとから置いたベッドが人の立つ所に重ならないように）
  const bedFor = {}, bedSlot = {};
  for (const v of active) {
    const L = life[v.key] || {};
    if (!L.bed) continue;
    const homeB = L.home && objById[L.home];
    const slot = homeB ? (bedSlot[homeB.id] = (bedSlot[homeB.id] ?? -1) + 1) : 0; // 同じ家の人は横に並べる
    bedFor[v.key] = bedSpot({ v, homeB, home: tentPos[v.key] || { x: camp.x, z: camp.z + 2 } }, slot);
  }
  // 敷物：テントの中の、ベッドのない人の寝床（昼もしいたまま）。毛布とまくら（まくらは奥の壁の側）
  for (const [k, s] of Object.entries(tentOf)) {
    if (bedFor[k]) continue;
    const bd = tentBed(s.t, s.i, tentP.perTent), g = new THREE.Group();
    box(MAT.w, MAT.h, MAT.l, [0x5f7f9e, 0x8a5a4a, 0x6a8a5a, 0x9a8a5a][s.i % 4], 0, MAT.h / 2 + 0.04, 0, g);
    box(MAT.w * 0.7, 0.12, 0.55, 0xf0ece2, 0, MAT.h + 0.1, -MAT.l / 2 + 0.4, g);
    g.position.set(bd.cx, 0, bd.cz); g.rotation.y = bd.yaw; scene.add(g);
    bedBlock(bd.cx, bd.cz, bd.yaw, k, 0.6);
  }
  active.forEach((v, i) => {
    const L = life[v.key] || {};
    // 姿（スキンの模型）は、近くでちゃんと描く時に初めて作る（buildModel）。それまでは位置と向きだけの入れ物
    const ch = new THREE.Group(); ch.scale.setScalar(1.9);
    ch.userData.villager = v;
    const homeB = L.home && objById[L.home];
    const home = homeB ? { x: homeB.x + Math.sin(homeB.rot || 0) * (footR(homeB) + 0.6), z: homeB.z + Math.cos(homeB.rot || 0) * (footR(homeB) + 0.6) } : (tentPos[v.key] || { x: camp.x, z: camp.z + 2 });
    const tagEl = document.createElement('div');
    tagEl.className = 'nametag' + (v.hidden ? ' hiddenname' : '');
    // 名前札：かくしていない人は @ユーザー名、かくしている人はあだ名（?video=1 の時は config.nameTags.video に従う）
    tagEl.textContent = tagName(v, { video: IS_VIDEO, cfg: config });
    if ((v.titles || []).length && !IS_VIDEO) { const st = document.createElement('span'); st.className = 'tstar'; st.textContent = '★'; st.title = '称号あり'; tagEl.append(st); } // 称号のある人は名札に小さな★
    tagEl.style.pointerEvents = 'auto';
    tagEl.addEventListener('click', (e) => { e.stopPropagation(); openCard(v); });
    const label = new CSS2DObject(tagEl);
    label.position.set(0, 1.0, 0); // キャラの頭の上（scale 1.9 の中）
    ch.add(label);
    const da = (hash(v.key + 'd') % 360) * Math.PI / 180, dr = 2 + (hash(v.key + 'r') % 30) / 10;
    const myDrop = { x: drop.x + Math.cos(da) * (dr * 0.6 + 0.8), z: drop.z + Math.sin(da) * (dr * 0.6 + 0.8) };
    const p = { v, ch, home, homeB, drop: myDrop, job: L.job, label: tagEl, labelObj: label, idx: i, lod: 'far', acc: 0, phase: 0, ri: 0, t: (hash(v.key) % 1000) / 100, pos: { ...home } };
    p.bedAt = bedFor[v.key] || null;
    setAct(p, actNow(L, curHour), true);
    // 働いている人は、最初はばらばらの所から
    if (p.mode === 'day' && !p.stay) {
      const start = hash(v.key + 's') % 4;
      p.phase = start === 3 ? 0 : start; p.pos = start === 1 || start === 2 ? { x: p.work.x, z: p.work.z } : { ...home };
    }
    ch.position.set(p.pos.x, 0, p.pos.z);
    people.push(p);
  });
  makeBeds(people.filter((p) => p.bedAt));
  window.TOWN.people = people; window.TOWN.solids = solids; window.TOWN.tents = tents; window.TOWN.tentGroups = tentGroups; // 確かめ用（人の位置・行動を見て、その人へカメラを寄せて撮る）

  TM0.people = performance.now();
  // ---------- 人が多い時の軽量化 ----------
  // ちゃんとした姿で描くのは、画面に入っていてカメラに近い FULL_MAX 人まで。
  // それより遠い人は、色の付いた簡単な形（まとめて 1 回で描く）にする。画面の外の人は動きをまばらに進める。
  const FULL_MAX = LITE ? 24 : 60, FULL_DIST = (LITE ? 70 : 95) * VIEW_K;
  // 村人の位置は「マスごとの一覧」（空間ハッシュ、1 マス 8×8 ブロック）にも持つ。動いてマスが変わった時だけ付け替える。
  // 近くの人さがし（話す相手・ぶつからないように避ける・動物がついて行く人・ちゃんと描く人と名札の人）は、周りのマスだけを見る
  const pgrid = new SpatialHash(8 * TILE);
  for (const p of people) { p.x = p.pos.x; p.z = p.pos.z; p.lure = !!(life[p.v.key] || {}).lure; pgrid.set(p, p.x, p.z); }
  const agrid = new SpatialHash(8 * TILE);
  const proxy = (() => {
    const n = Math.max(1, people.length);
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 1.2, 0.36).translate(0, 0.62, 0), new THREE.MeshLambertMaterial(), n);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, 1.5, 0), new THREE.MeshLambertMaterial(), n);
    for (const p of people) {
      // 服の色（決めた色か、名前から）と、肌の色
      p.cBody = new THREE.Color();
      try { p.cBody.set(p.v.profile && p.v.profile.color ? p.v.profile.color : `hsl(${hash(p.v.key + 'c') % 360},45%,45%)`); } catch (e) { p.cBody.set(0x6a7a9a); }
      p.cHead = new THREE.Color().setHSL(0.07, 0.45, 0.62 - (hash(p.v.key + 'k') % 30) / 100);
      body.setColorAt(0, p.cBody); head.setColorAt(0, p.cHead); // 色の入れ物を作っておく
    }
    for (const m of [body, head]) { m.count = 0; m.frustumCulled = false; m.castShadow = false; scene.add(m); }
    return { body, head };
  })();
  const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), sph = new THREE.Sphere(new THREE.Vector3(), 1.6), dummy = new THREE.Object3D();
  // 8 コマに 1 回、だれをちゃんと描くか決める
  const cellBox = new THREE.Box3();
  function pickLod() {
    projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projM);
    // 画面に入っているかは、人ごとではなくマスごとに調べる（マスに入っている人はまとめて同じ）
    for (const [k, set] of pgrid.cells) {
      const any = set.values().next().value; if (!any) continue;
      const cx = Math.floor(any.pos.x / pgrid.cell), cz = Math.floor(any.pos.z / pgrid.cell);
      cellBox.min.set(cx * pgrid.cell - 2, 0, cz * pgrid.cell - 2); cellBox.max.set((cx + 1) * pgrid.cell + 2, 4, (cz + 1) * pgrid.cell + 2);
      const lod = frustum.intersectsBox(cellBox) ? 'far' : 'off';
      for (const p of set) p.lod = lod;
    }
    // ちゃんと描く候補は、カメラの近くのマスにいる人だけ
    const cam = camera.position, cand = [];
    for (const p of pgrid.near(cam.x, cam.z, FULL_DIST)) {
      if (p.lod === 'off') continue;
      sph.center.set(p.pos.x, 1, p.pos.z);
      if (!frustum.intersectsSphere(sph)) continue;
      p.dd = cam.distanceTo(sph.center);
      if (p.dd < FULL_DIST) cand.push(p);
    }
    cand.sort((a, b) => a.dd - b.dd);
    let built = 0;
    for (let i = 0; i < cand.length && i < FULL_MAX; i++) {
      const p = cand[i];
      if (!p.ch.userData.parts) { if (built >= 12) continue; buildModel(p); built++; } // 1 回に作る姿は 12 人まで（かくつかないように）
      p.lod = 'full';
    }
    // ちゃんと描かない人は、場面から外す（毎コマの位置の計算もしない）。札と吹き出しも隠す
    for (const p of people) {
      const want = p.lod === 'full';
      if (want === (p.ch.parent === scene)) continue;
      if (want) scene.add(p.ch);
      else { scene.remove(p.ch); p.label.style.display = 'none'; if (p.bubble) p.bubble.style.display = 'none'; }
    }
  }
  // 姿を作って入れ物に入れる。クリックで村人カードが開くようにする
  function buildModel(p) {
    const v = p.v, m = makeCharacter(skinSrc(v), { scale: 1, slim: skinSlim(v), chibi: chibiOf(v) });
    if (v.profile && v.profile.color) setAccent(m, v.profile.color);
    setArmor(m, armorLook((life[v.key] || {}).gear, config.smithing)); // 鍛冶職人が作った防具（帽子・服・くつ。顔と髪は見える）
    Object.assign(p.ch.userData, m.userData);
    p.ch.userData.smooth = true; // 動きの切りかわりをなめらかに（character.js の animate）
    p.ch.add(m); p.model = m;
    m.traverse((o) => { if (o.isMesh) { o.userData.owner = p.ch; clickables.push(o); } });
  }
  // 見た目の位置と向き：毎コマ、決まった位置（p.pos と体の向き）へなめらかに寄せる。
  // 2 コマに 1 回しか進めない遠くの人も、間を補ってがくつかない。大きく離れた時（家から出る時など）はそのまま移す
  const _sm = { k: 0, kr: 0 };
  function smoothPeople(dt) {
    _sm.k = 1 - Math.exp(-dt * 16); _sm.kr = 1 - Math.exp(-dt * 12);
    for (const p of people) {
      if (p.vx === undefined || Math.hypot(p.pos.x - p.vx, p.pos.z - p.vz) > 3) { p.vx = p.pos.x; p.vz = p.pos.z; p.vyaw = p.ch.rotation.y; }
      p.vx += (p.pos.x - p.vx) * _sm.k; p.vz += (p.pos.z - p.vz) * _sm.k;
      let d = p.ch.rotation.y - p.vyaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      p.vyaw += d * _sm.kr;
      if (p.lod !== 'full') continue;
      p.ch.position.set(p.vx, 0, p.vz);
      if (p.model) p.model.rotation.y = p.vyaw - p.ch.rotation.y; // 体の向きの決まりはそのままで、見た目だけ遅れて回る
    }
  }
  // 遠い人の簡単な形を、今の場所へ
  function placeProxies() {
    let k = 0;
    for (const p of people) {
      if (p.lod !== 'far' || !p.ch.visible) continue;
      dummy.position.set(p.vx ?? p.pos.x, 0, p.vz ?? p.pos.z); dummy.rotation.y = p.vyaw ?? p.ch.rotation.y; dummy.scale.setScalar(1);
      dummy.updateMatrix();
      proxy.body.setMatrixAt(k, dummy.matrix); proxy.head.setMatrixAt(k, dummy.matrix);
      proxy.body.setColorAt(k, p.cBody); proxy.head.setColorAt(k, p.cHead);
      k++;
    }
    proxy.body.count = proxy.head.count = k;
    for (const m of [proxy.body, proxy.head]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // ---------- 掘る・切る：決まった回数たたくと 1 つ落ちる。岩は一段ずつ小さくなり、木は倒れる。拾ってチェストへ ----------
  const fx = makeFx(scene);
  const ITEM_NAME = { cobble: '丸石', coal: '石炭', iron: '鉄鉱石', gold: '金鉱石', diamond: 'ダイヤ', log: '原木', apple: 'りんご', sapling: '苗木' };
  const ITEM_COL = { iron: '#ffc69a', gold: '#ffe25a', diamond: '#7ffff4', coal: '#d0d0d0', apple: '#ff9a92', sapling: '#b8ff9a' };
  const ORE = { c: 'coal', i: 'iron', g: 'gold', d: 'diamond' };
  const RARE = new Set(['iron', 'gold', 'diamond', 'apple', 'sapling']);
  const CHIP_COL = { s: 0x8a8d91, c: 0x3a3a3e, i: 0xd49d74, g: 0xf0cb36, d: 0x45dcd6 };
  const TIERS = config.crafting.tiers;
  const QUOTA = 3; // 1 回で運ぶ数（岩）
  // 今の時間に切る木・掘る岩（時間が変わったら setAct からも呼ぶ）
  function setupMine(p) {
    p.mine = null;
    if (p.mode !== 'day' || p.stay || !p.act || p.act.stump) return;
    const L = life[p.v.key] || {};
    const o = p.act.target && objById[p.act.target];
    if (!o || !o.obj) return;
    const hits = (TIERS[L.toolTier || 'hand'] || TIERS.hand).hits;
    if (p.tool === 'pick' && o.obj.userData.rock) {
      // 今日掘った分をもどして見せ、そこから 1 つずつ（最後の 1 つで消える）
      const H0 = Math.min(o.max, Math.max(1, o.hp + QUOTA));
      p.mine = { kind: 'rock', o, H0, n: Math.min(QUOTA, H0), hits, blocks: o.blocks || '' };
      setRock(o.obj, H0);
    } else if (p.tool === 'axe' && o.obj.userData.tree) {
      setTreeState(o.obj, 'tree');
      p.mine = { kind: 'tree', o, hits, logs: 3 };
    }
  }
  for (const p of people) setupMine(p);
  const animOff = (p) => (hash(p.v.key) % 100) / 10;
  const FALL = 1.3, VAN = FALL * FALL_END + 0.35; // 倒れる時間・倒れ始めてから消えるまで
  function workLen(p) {
    const m = p.mine; if (!m) return 7 + (hash(p.v.key) % 4);
    return m.kind === 'rock' ? breakTime(m.n - 1, DIG, m.hits) + 1.9 : breakTime(0, CHOP, m.hits) + VAN + 2.0;
  }
  // 今の仕事の時刻（振り下ろしと、ひびが入る時を合わせる）
  function workU(p, time) {
    const m = p.mine, r = m.kind === 'rock' ? DIG.rate : CHOP.rate, at = time + animOff(p);
    if (p.w0 == null) p.w0 = Math.ceil(at * r) / r;
    return at - p.w0;
  }
  // 落ちた物：はねて回る → 人の手へ → 頭の上に「+1」
  function itemLife(p, kind, o, seed, age, toward, time) {
    if (age < 0) return 0;
    const head = { x: p.pos.x, y: 4.5, z: p.pos.z }; // 名前の札と顔より上に出す
    if (age < 1.0) {
      const d = dropPos(o, seed, age, toward);
      fx.item(kind, d.x, d.y, d.z, d.rot, 1.4);
      if (RARE.has(kind)) fx.glow(kind, d.x, d.y + 0.05, d.z, 0.9, time, 1.1);
      return 0;
    }
    if (age < 1.3) {
      const d = dropPos(o, seed, 1.0, toward), k = (age - 1.0) / 0.3;
      fx.item(kind, d.x + (p.pos.x - d.x) * k, d.y + (1.4 - d.y) * k + Math.sin(k * Math.PI) * 0.4, d.z + (p.pos.z - d.z) * k, age * 3, 1.4 * (1 - k * 0.5));
      return 0;
    }
    if (age < 2.4) {
      const k = (age - 1.3) / 1.1;
      fx.plus('+1 ' + ITEM_NAME[kind], head.x, head.y + k * 1.0, head.z, k < 0.75 ? 1 : (1 - k) * 4, ITEM_COL[kind] || '#fff6c8', 1.4);
    }
    return 1;
  }
  function updateWork(p, time) {
    const m = p.mine; if (!m || p.mode !== 'day') return;
    const g = m.o.obj;
    const mining = p.phase === 1, done = p.phase === 2 || p.phase === 3;
    if (m.kind === 'rock') {
      if (!mining) { setRock(g, done ? m.H0 - m.n : m.H0); return; }
      const u = workU(p, time), s = strikeAt(u, DIG, m.hits);
      const broken = Math.min(m.n, s.broken);
      const dir = (() => { const dx = p.pos.x - g.position.x, dz = p.pos.z - g.position.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; })();
      const k = rockScale(m.H0 - broken, m.o.max) || 0.35;
      const face = { x: g.position.x + dir.x * 1.1 * k, y: 0.9 * k, z: g.position.z + dir.z * 1.1 * k };
      const last = broken > 0 ? u - breakTime(broken - 1, DIG, m.hits) : 9;
      setRock(g, m.H0 - broken, broken < m.n ? s.stage : -1, last < 0.18 ? 1 - last / 0.18 : 0);
      if (s.n && broken < m.n) fx.chips(chipList(face, dir, p.v.key + s.n, s.since, 7), CHIP_COL.s);
      let got = 0;
      for (let i = 0; i < broken; i++) {
        const a = u - breakTime(i, DIG, m.hits);
        const blk = m.blocks[m.o.max - (m.H0 - i)] || 's';
        fx.chips(chipList(face, dir, p.v.key + 'b' + i, a, 12), CHIP_COL[blk] || CHIP_COL.s);
        if (m.H0 - i - 1 <= 0) fx.chips(chipList({ x: g.position.x, y: 0.5, z: g.position.z }, { x: 0, z: 0 }, p.v.key + 'end', a, 18).map((q) => ({ ...q, s: q.s * 2.4 })), CHIP_COL.s);
        got += itemLife(p, ORE[blk] || 'cobble', face, p.v.key + i, a, dir, time);
      }
      p.carryN = got;
      return;
    }
    // 木：たたき終わると倒れて、原木が落ち、切り株が残る
    const T = g.userData.tree;
    if (!mining) { if (done) setTreeState(g, 'stump'); else setTreeState(g, 'tree'); return; }
    const u = workU(p, time), s = strikeAt(u, CHOP, m.hits);
    const dx = p.pos.x - g.position.x, dz = p.pos.z - g.position.z, dl = Math.hypot(dx, dz) || 1, dir = { x: dx / dl, z: dz / dl };
    const tFell = breakTime(0, CHOP, m.hits);
    const S = T.size;
    if (u < tFell) {
      setTreeState(g, 'tree'); setTreeCrack(g, s.stage);
      if (s.n) fx.chips(chipList({ x: g.position.x + dir.x * 0.3 * S, y: 0.6 * S, z: g.position.z + dir.z * 0.3 * S }, dir, p.v.key + 't' + s.n, s.since, 8), 0x8a6238);
      p.carryN = 0; return;
    }
    const a = u - tFell, fdir = { x: -dir.x, z: -dir.z }; // 打った人と反対へ倒れる
    // 根元を軸にゆっくり傾き始め、だんだん速く倒れ、地面で少し弾んでから消える（葉が散る）。切り株は残る
    setTreeFall(g, a / FALL, fdir, a > VAN - 0.15 ? Math.min(1, (a - VAN + 0.15) / 0.3) : 0);
    setTreeCrack(g, -1);
    let got = 0;
    if (a >= VAN) {
      const ag = a - VAN;
      for (let k = 0; k < 4; k++) fx.chips(chipList({ x: g.position.x + fdir.x * (6.6 + k * 2.0) * S, y: 1.2, z: g.position.z + fdir.z * (6.6 + k * 2.0) * S }, { x: (k % 2 - 0.5) * 0.8, z: 0.4 }, p.v.key + 'leaf' + k, ag * 0.75, 14).map((q) => ({ ...q, s: q.s * 2.6 })), new THREE.Color(T.leafCol).getHex());
      for (let i = 0; i < m.logs; i++) {
        const o = { x: g.position.x + fdir.x * (1.8 + i * 2.2) * S, y: 0.5, z: g.position.z + fdir.z * (1.8 + i * 2.2) * S };
        got += itemLife(p, 'log', o, p.v.key + 'log' + i, ag - i * 0.1, dir, time);
      }
    }
    p.carryN = got;
  }
  // チェスト：置くたびにふたが開いて、「+3」
  let chestPop = null;
  function depositFx(p, time) {
    if (!p.mine || !p.carryN) return;
    chestPop = { t: time, text: '+' + p.carryN };
    p.carryN = 0;
  }
  function updateChest(time) {
    if (!chestObj) return;
    const a = chestPop ? time - chestPop.t : 9;
    setChestOpen(chestObj, a < 1.4 ? Math.min(1, a / 0.2) * Math.min(1, (1.4 - a) / 0.3) : 0);
    if (a < 1.4) fx.plus(chestPop.text, chestObj.position.x, 2.0 + a * 0.8, chestObj.position.z, a < 1 ? 1 : (1.4 - a) / 0.4, '#fff6c8', 1.4);
  }

  // ---------- 夜：見張りと、森の外から来る敵（sim.js で決まった最新の夜） ----------
  const ENEMIES = !!(config.enemies && config.enemies.enabled);
  const N = ENEMIES && state.night && state.night.day >= state.day - 1 ? state.night : null;
  const from = N && N.from ? N.from : { x: 0, z: -52 };
  const fl = Math.hypot(from.x, from.z) || 1, fdir = { x: from.x / fl, z: from.z / fl }, fside = { x: -fdir.z, z: fdir.x };
  const guardKeys = new Set(((N && N.guards) || []).filter((k) => people.some((p) => p.v.key === k)));
  if (ENEMIES && !guardKeys.size && people.length) people.filter((p) => p.mode !== 'sleep' && p.mode !== 'gohome').slice(0, Math.min(2, people.length)).forEach((p) => guardKeys.add(p.v.key));
  // 柵・石壁があれば、見張りはその内側に立ち、敵はその外で止められる
  const ringR = world.buildings.some((b) => b.type === 'wall') ? 33.5 : world.buildings.some((b) => b.type === 'fence') ? 31.5 : null;
  const fa = Math.atan2(fdir.z, fdir.x);
  const onRing = (r, s) => { const a = fa + s / r; return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.92 - 1 }; };
  const postR = ringR ? ringR - 2.4 : 24, mobR = ringR ? ringR + 1.8 : 26.4;
  let gi = 0;
  for (const p of people) {
    if (!guardKeys.has(p.v.key)) continue;
    // 見張りの場所：敵が来る向きの、町のはずれ（柵の内側）
    const s = (gi % 2 ? 1 : -1) * Math.ceil(gi / 2) * 2.6; gi++;
    p.guard = pushOutPt(onRing(postR, s)); p.guardS = s;
    if (nightAt(curHour) && p.act && p.act.action !== 'sleep') setAct(p, p.act, true); // 起きている夜の見張り
  }
  // 見張りの装備：作業台で作った剣（いちばん良い物）、なければたいまつ、なければ今の道具か素手。盾は作ってあれば左腕に
  const TIER_RANK = ['wood', 'stone', 'iron', 'gold', 'diamond'];
  function guardGear(p) {
    if (p.gear) return p.gear;
    const inv = ((life[p.v.key] || {}).inv || []).filter(Boolean);
    const swords = inv.map((s) => /^(\w+)_sword$/.exec(s.item)).filter(Boolean).map((m) => m[1]).filter((t) => TIER_RANK.includes(t));
    const best = swords.sort((a, b) => TIER_RANK.indexOf(b) - TIER_RANK.indexOf(a))[0];
    const has = (k) => inv.some((s) => s.item === k) || ((state.store || {})[k] || 0) > 0;
    p.gear = { tool: best ? 'sword:' + best : has('torch') ? 'torch' : p.toolKey || null, shield: has('shield') };
    return p.gear;
  }
  function pushOutPt(pt) { const q = freePt(pt); pt.x = q.x; pt.z = q.z; return pt; }
  const guards = people.filter((p) => p.guard);
  const mobs = [];
  if (N && !N.quiet) {
    let i = 0;
    for (const g of N.groups || []) for (let k = 0; k < g.n; k++, i++) {
      const m = makeMob(g.type); m.visible = false; scene.add(m);
      const target = guards.length ? guards[i % guards.length] : null;
      const arrows = g.type === 'skeleton' ? [0, 1, 2].map(() => { const a = makeArrow(); a.scale.setScalar(1.6); a.visible = false; scene.add(a); return a; }) : null;
      const fx = makeHitFx(); scene.add(fx); const fx2 = makeHitFx(); scene.add(fx2); // 当たった所の火花と煙（2 つ目は盾・クリティカル用）
      mobs.push({ m, type: g.type, i, target, off: i * 3.1, side: (i % 3 - 1) * 3.2, arrows, fx, fx2 });
    }
  }
  // 夜の戦い：sim の戦い（state.night.fight）をそのまま回ごとに見せる。敵は逃げず、どちらかが全員倒れるまで戦う。
  // 見張りの体力がなくなると「たおれた」と横になり、ほかの見張りが代わる。全員たおれたら、残った敵は柵（なければ町の中）まで来て壊し、
  // 朝日でゾンビ・スケルトンは燃え、クモは森へ戻る。ゾンビははじかれても何度も向かい、クモは飛びかかっては離れ、スケルトンは離れて撃つ
  const MELEE = { zombie: { kb: 1.15, back: 0, sp: 1.4 }, spider: { kb: 0.9, back: 1.9, sp: 2.6 } };
  const Q_SWING = 0.45, Q_HIT = Q_SWING + (1 - Q_SWING) * 0.75, Q_PUNCH = 0.17; // 見張りが振り始める所・当たる所・敵の攻撃が当たる所（1 回の中の割合）
  const RD = 2.6, DIE = 1.8, SHOT_D = 1.4, SHOT_REL = 0.84, ARROW_T = 0.4, RAID_WALK = 4, RAID = 8, PAUSE = 5;
  TM0.ready = performance.now();
  Object.assign(window.TOWN, { mobs, people, timing: Object.fromEntries(Object.entries(TM0).map(([k, v]) => [k, Math.round(v - TM0.start)])) }); // 確かめ用
  const ft = makeFloatText(THREE); // ダメージの数字・クリティカル・ガード・たおした・たおれた
  // 戦いの中身：sim の記録。古いデータ（見張りの体力がない形）は、見張りの装備から決まった乱数でここで戦わせる
  const FT = (() => {
    if (!mobs.length) return null;
    const CB = config.combat;
    let F = N && N.fight && N.fight.guards && N.fight.mobs && N.fight.mobs.length === mobs.length ? N.fight : null;
    if (!F && CB) {
      const gs = guards.map((p) => { const gg = guardGear(p); return { key: p.v.key, weapon: gg.tool && gg.tool.startsWith('sword:') ? gg.tool.slice(6) + '_sword' : gg.tool ? 'tool' : null, shield: gg.shield }; });
      F = fightNight({ mobs: mobs.map((mb) => ({ type: mb.type })), guards: gs, C: CB, rng: seededRng('town:' + state.day) });
    }
    if (!F) return null;
    const T = roundsOf(F);
    T.fate = F.mobs.map((m) => m.fate);
    return T;
  })();
  const gByKey = Object.fromEntries(guards.map((p) => [p.v.key, p]));
  const startOf = (mb) => ({ x: from.x * 0.85 + fside.x * mb.side, z: from.z * 0.85 + fside.z * mb.side });
  // 敵の立つ所：相手の見張りの持ち場から、敵が来た向きへ（柵があれば柵の外）
  function goalFor(mb, key) {
    const G = gByKey[key] || guards[0], st = startOf(mb);
    if (!G) return { x: st.x * 0.4, z: st.z * 0.4, d: { x: fdir.x, z: fdir.z } };
    const H = G.guard, dx = st.x - H.x, dz = st.z - H.z, dl = Math.hypot(dx, dz) || 1, d = { x: dx / dl, z: dz / dl };
    if (ringR) { const p = onRing(mobR + (mb.type === 'skeleton' ? 4 : 0), G.guardS + ((mb.i % 3) - 1) * 1.4); return { x: p.x, z: p.z, d }; }
    const side = ((mb.i % 3) - 1) * 1.4, far = mb.type === 'skeleton' ? 10 : 6;
    return { x: H.x + d.x * far - d.z * side, z: H.z + d.z * far + d.x * side, d };
  }
  const foeAt = (mb, r) => (FT && FT.R ? FT.rounds[Math.max(0, Math.min(FT.R - 1, r))][mb.i].foe : null);
  function posAt(mb, r, q) { // 相手が代わった回は、はじめの 4 割で歩いて移る
    const g1 = goalFor(mb, foeAt(mb, r));
    if (r <= 0) return { ...g1, move: false };
    const g0 = goalFor(mb, foeAt(mb, r - 1));
    if (Math.abs(g0.x - g1.x) + Math.abs(g0.z - g1.z) < 0.01) return { ...g1, move: false };
    const k = Math.min(1, q / 0.4);
    return { x: g0.x + (g1.x - g0.x) * k, z: g0.z + (g1.z - g0.z) * k, d: g1.d, move: k < 1 };
  }
  const walkSp = (mb) => (mb.type === 'skeleton' ? 1.9 : MELEE[mb.type].sp);
  const LOST = !!FT && FT.end === 'lost';
  const TF = FT ? Math.max(...mobs.map((mb) => { const g = goalFor(mb, foeAt(mb, 0)), s = startOf(mb); return mb.i * 0.8 + Math.hypot(g.x - s.x, g.z - s.z) / walkSp(mb); })) + 0.6 : 0;
  const MOB_CYCLE = FT ? TF + FT.R * RD + (LOST ? RAID_WALK + RAID : DIE + 2) + PAUSE : 34; // 近づく → 戦う → 倒れる（→ 柵を壊す）を、夜の間くり返して見せる
  // 見張りがたおれる時刻（1 回りの中の秒）
  for (const p of guards) {
    p.downT = null;
    const r = FT && FT.downAt[p.v.key]; if (r === undefined || r === null) continue;
    const e = N && N.fight && N.fight.log ? N.fight.log.find((x) => x.r === r && x.g === p.v.key && x.down) : null;
    p.downT = TF + r * RD + (e && mobs[e.m] && mobs[e.m].type === 'skeleton' ? SHOT_REL + ARROW_T : Q_PUNCH * RD);
  }
  // 壊しに行く所：柵があれば柵の内側の線、なければ見張りの持ち場より町の中
  const raidAt = (mb) => { const G = gByKey[foeAt(mb, FT.R - 1)] || guards[0], s = (G ? G.guardS : 0) + ((mb.i % 3) - 1) * 1.6; return ringR ? onRing(ringR + 0.9, s) : onRing(postR - 4, s); };
  const chestAt = (mb, m) => ({ x: m.position.x, y: mb.type === 'spider' ? 1.5 : 3.0, z: m.position.z });
  const headAt = (G) => ({ x: G.ch.position.x, y: 4.2, z: G.ch.position.z });
  function hitShow(mb, r, age, at) {
    const X = FT.rounds[r] && FT.rounds[r][mb.i]; if (!X || !X.hit) return;
    const id = mb.i + ':' + r;
    ft.show('h' + id, at, X.hit.dmg, X.hit.crit ? 'crit' : 'dmg', age);
    if (age >= 0 && age < 0.45) { hitFxAt(mb.fx, at.x, at.y - 0.7, at.z, age / 0.45, mb.i + r); if (X.hit.crit) hitFxAt(mb.fx2, at.x + 0.3, at.y - 0.4, at.z, age / 0.45, mb.i + r + 7); }
    if (X.hit.kill) ft.show('k' + id, { x: at.x, y: at.y + 0.9, z: at.z }, 'たおした！', 'kill', age - 0.2);
  }
  function atkShow(G, a, id, age) {
    if (!G || !a) return;
    if (a.guard) { ft.show('g' + id, headAt(G), 'ガード', 'guard', age); if (age >= 0 && age < 0.5) G.guardHit = Math.max(G.guardHit ?? -1, age / 0.5); }
    else if (a.to) { ft.show('d' + id, headAt(G), '-' + a.to, 'hurt', age); if (age >= 0 && age < 0.4) G.flinch = Math.max(G.flinch || 0, Math.sin(age / 0.4 * Math.PI)); }
  }
  let cycU = 0, fightOn = false; // 1 回りの中の秒・夜の戦いを見せているか（見張りがたおれた姿勢に使う）
  const isDown = (p) => fightOn && p.downT !== null && p.downT !== undefined && cycU >= p.downT;
  function updateMobs(time, n, h) {
    const nightOn = n > 0.55, dawn = h < 12 && n > 0.15 && n <= 0.55;
    ft.begin();
    fightOn = nightOn && !!FT;
    cycU = (time % MOB_CYCLE);
    for (const g of guards) { g.duel = null; g.blockA = false; g.dodge = 0; g.faceAt = null; g.want = null; g.guardHit = -1; g.flinch = 0; }
    for (const mb of mobs) {
      const { m } = mb;
      mb.fx.visible = false; mb.fx2.visible = false; mb.fight = false;
      if (mb.arrows) for (const a of mb.arrows) a.visible = false;
      flashMob(m, 0); fadeMob(m, 1);
      if (!FT || (!nightOn && !dawn)) { m.visible = false; continue; }
      const archer = mb.type === 'skeleton', ME = MELEE[mb.type];
      m.scale.setScalar(MOB_SCALE); m.position.y = 0;
      if (dawn) { // 朝日：見張りが全員たおれて残った敵だけ。ゾンビ・スケルトンは燃え、クモは森へ戻る
        if (FT.fate[mb.i] !== 'raid') { m.visible = false; continue; }
        const k = Math.min(1, (0.55 - n) / 0.3), p = raidAt(mb), st = startOf(mb);
        if (mb.type !== 'spider') { m.position.set(p.x, 0, p.z); animateMob(m, 'burn', time, k); m.visible = k < 1; }
        else { const q = Math.min(1, k * 1.2); m.position.set(p.x + (st.x - p.x) * q, 0, p.z + (st.z - p.z) * q); m.rotation.y = Math.atan2(st.x - p.x, st.z - p.z); animateMob(m, 'flee', time); fadeMob(m, (1 - q) / 0.3); }
        continue;
      }
      const u = cycU, st = startOf(mb);
      // 1) 近づいてくる（見張りは見つけたら走って迎え撃つ）
      if (u < TF) {
        const g = goalFor(mb, foeAt(mb, 0)), t = u - mb.i * 0.8, tw = Math.hypot(g.x - st.x, g.z - st.z) / walkSp(mb);
        if (t < 0) { m.visible = false; continue; }
        if (t < tw) { const k = t / tw; m.position.set(st.x + (g.x - st.x) * k, 0, st.z + (g.z - st.z) * k); m.rotation.y = Math.atan2(g.x - st.x, g.z - st.z); animateMob(m, 'walk', time); }
        else { m.position.set(g.x, 0, g.z); m.rotation.y = Math.atan2(-g.d.x, -g.d.z); animateMob(m, archer ? 'shoot' : 'hit', time, archer ? 0.3 : 0); }
        const X0 = FT.R ? FT.rounds[0][mb.i] : null, Hg = X0 && X0.hit ? gByKey[X0.hit.g] : null;
        if (Hg && !Hg.duel && Math.hypot(m.position.x - Hg.guard.x, m.position.z - Hg.guard.z) < 13) { Hg.want = { x: g.x - g.d.x * (archer ? 2.8 : 3), z: g.z - g.d.z * (archer ? 2.8 : 3) }; Hg.faceAt = { x: m.position.x, z: m.position.z }; }
        continue;
      }
      const uf = u - TF, r = Math.floor(uf / RD), c = uf - r * RD, q = c / RD;
      // 2) 倒れた：横へ倒れて、薄くなって消える
      const kr = FT.killAt[mb.i];
      if (kr !== null && (r > kr || (r === kr && q >= Q_HIT))) {
        const tk = uf - (kr + Q_HIT) * RD, g = goalFor(mb, foeAt(mb, kr)), off = archer ? 0 : ME.kb * 0.4 + ME.back;
        m.position.set(g.x + g.d.x * off, 0, g.z + g.d.z * off); m.rotation.y = Math.atan2(-g.d.x, -g.d.z);
        const k = tk / DIE; if (k > 1.05) { m.visible = false; continue; }
        animateMob(m, 'die', time, Math.min(1, k)); fadeMob(m, 1 - Math.max(0, (k - 0.55) / 0.45));
        hitShow(mb, kr, tk, chestAt(mb, m));
        continue;
      }
      // 3) 見張りが全員たおれた後：残った敵が柵（なければ町の中）まで来て壊す
      if (r >= FT.R) {
        if (FT.fate[mb.i] !== 'raid') { m.visible = false; continue; }
        const tr = uf - FT.R * RD, g = goalFor(mb, foeAt(mb, FT.R - 1)), p = raidAt(mb);
        if (tr < RAID_WALK) { const k = tr / RAID_WALK; m.position.set(g.x + (p.x - g.x) * k, 0, g.z + (p.z - g.z) * k); m.rotation.y = Math.atan2(p.x - g.x, p.z - g.z); animateMob(m, 'walk', time); continue; }
        const tp = tr - RAID_WALK;
        m.position.set(p.x, 0, p.z); m.rotation.y = Math.atan2(-fdir.x, -fdir.z);
        if (tp < RAID) animateMob(m, archer ? 'hit' : 'punch', time, archer ? Math.abs(Math.sin(tp * 2.4)) * 0.6 : (tp % 1.3) / 1.3);
        else { m.visible = false; } // 1 回りの終わりの間（朝までは、次の回りでもう一度見せる）
        continue;
      }
      // 4) 打ち合い（r 回目）
      mb.fight = true;
      const X = FT.rounds[r][mb.i], P = posAt(mb, r, q), d = P.d, foe = gByKey[X.foe], Hg = X.hit ? gByKey[X.hit.g] : null;
      const tHit = c - Q_HIT * RD;
      if (r > 0) hitShow(mb, r - 1, tHit + RD, chestAt(mb, m));
      if (archer) {
        m.position.set(P.x, 0, P.z); m.rotation.y = foe ? Math.atan2(foe.ch.position.x - P.x, foe.ch.position.z - P.z) : Math.atan2(-d.x, -d.z);
        if (P.move) animateMob(m, 'walk', time);
        else if (X.hit && tHit >= 0) { animateMob(m, 'hit', time, Math.min(1, tHit * 1.6)); flashMob(m, Math.max(0, 1 - tHit * 2.4)); }
        else animateMob(m, 'shoot', time, c < SHOT_D ? c / SHOT_D : 0.25);
        hitShow(mb, r, tHit, chestAt(mb, m));
        const A2 = X.atk, rel = c - SHOT_REL, a = mb.arrows[r % mb.arrows.length], id = mb.i + ':' + r;
        if (A2 && foe) {
          atkShow(foe, A2, id, rel - ARROW_T);
          if (A2.guard && rel > -0.3 && rel < 0.6) foe.blockA = true;
          if (rel >= 0 && rel < (A2.guard ? 1.6 : ARROW_T)) {
            const gp = foe.ch.position, dx = P.x - gp.x, dz = P.z - gp.z, dl = Math.hypot(dx, dz) || 1;
            if (a.userData.e !== id) { a.userData.e = id; a.userData.to = A2.guard ? { x: gp.x + (dx / dl) * 0.9, y: 1.95, z: gp.z + (dz / dl) * 0.9 } : { x: gp.x, y: 2.3, z: gp.z }; }
            const fr = { x: P.x - d.x * 0.6, y: 2.6, z: P.z - d.z * 0.6 };
            a.visible = true; arrowAt(a, fr, a.userData.to, rel / ARROW_T, 1.4);
            const pf = (rel - ARROW_T) / 0.35;
            if (pf >= 0 && pf < 1 && A2.guard) hitFxAt(mb.fx2, a.userData.to.x, a.userData.to.y, a.userData.to.z, pf, mb.i + 2);
          }
        }
        if (Hg && !Hg.duel) {
          Hg.want = { x: P.x - d.x * 2.8, z: P.z - d.z * 2.8 }; Hg.faceAt = { x: P.x, z: P.z };
          const s = (q - Q_SWING) / (1 - Q_SWING);
          if (s >= 0 && s <= 1) Hg.duel = { strike: s, x: P.x, z: P.z };
        }
        continue;
      }
      const rec = q >= Q_HIT ? (q - Q_HIT) / (1 - Q_HIT) : -1;
      const kbp = rec >= 0 && X.hit ? ME.kb * (X.hit.crit ? 1.9 : 1) * Math.min(1, rec * 7) * (1 - rec) * (1 - rec) : 0; // クリティカルは大きくはじかれる
      const jump = ME.back ? (q < Q_PUNCH ? ME.back * (1 - q / Q_PUNCH) : rec >= 0 ? ME.back * Math.min(1, rec * 2.2) : 0) : 0;
      const hop = ME.back && q < Q_PUNCH ? Math.sin(q / Q_PUNCH * Math.PI) * 0.7 : ME.back && rec >= 0 && rec < 0.45 ? Math.sin(rec / 0.45 * Math.PI) * 0.5 : 0;
      m.position.set(P.x + d.x * (kbp + jump), 0, P.z + d.z * (kbp + jump));
      m.rotation.y = Math.atan2(-d.x, -d.z);
      if (P.move) animateMob(m, 'walk', time);
      else if (q < Q_SWING && X.atk) animateMob(m, 'punch', time, q / Q_SWING);
      else animateMob(m, 'hit', time, rec >= 0 && X.hit ? Math.min(1, rec * 1.6) : 0);
      m.position.y = hop;
      if (rec >= 0 && X.hit) flashMob(m, Math.max(0, 1 - rec * 2.4)); // 当たった瞬間だけ、ほんのり赤く
      hitShow(mb, r, tHit, chestAt(mb, m));
      const tPunch = c - Q_PUNCH * RD;
      if (X.atk && foe) {
        atkShow(foe, X.atk, mb.i + ':' + r, tPunch);
        if (X.atk.guard && tPunch >= 0 && tPunch < 0.3) { const gp = foe.ch.position, dx = P.x - gp.x, dz = P.z - gp.z, dl = Math.hypot(dx, dz) || 1; hitFxAt(mb.fx2, gp.x + (dx / dl) * 1.2, 1.95, gp.z + (dz / dl) * 1.2, tPunch / 0.3 * 0.8, mb.i + 3); }
        if (foe !== Hg && !foe.duel) { foe.faceAt = { x: m.position.x, z: m.position.z }; if (X.atk.guard && q > 0.04 && q < 0.3) foe.blockA = true; }
      }
      if (Hg && !Hg.duel) { Hg.want = { x: P.x - d.x * 3, z: P.z - d.z * 3 }; Hg.duel = { q, x: m.position.x, z: m.position.z, strike: q >= Q_SWING ? (q - Q_SWING) / (1 - Q_SWING) : null, block: !!(X.atk && X.atk.guard && foe === Hg) && q > 0.04 && q < 0.3 }; }
    }
    // 見張りがたおれた：「たおれた」の文字
    if (fightOn) for (const p of guards) if (p.downT !== null && p.downT !== undefined) ft.show('down' + p.v.key, headAt(p), 'たおれた', 'down', cycU - p.downT);
  }
  function updateArrows() {} // 矢は updateMobs の中で、打ち合いの数字といっしょに動かす
  // 寝る・起きるは、決まった就寝時刻ではなく、その人の 1 時間ごとの行動（L.hours）で決まる。
  // 時が変わったら、行動が変わった人だけ歩き出す（夜も起きて働く人がいる）
  let wasNight = null;
  function switchMode(night) {
    for (const p of people) { if (p.talk) { p.talk = null; p.bubble.hidden = true; if (p.mode === 'day' && (p.phase === 5 || p.phase === 6 || p.phase === 7)) { p.phase = 0; p.ri = 0; p.routes[0] = routeAround(p.pos, p.work, walls); } } }
    for (const tk of talks) tk.on = false;
    for (const p of people) endChat(p);
    void night;
  }
  function changeHour(h) {
    for (const p of people) {
      const a = actNow(life[p.v.key] || {}, h);
      const wasGuard = p.mode === 'guard' || p.mode === 'toguard';
      if (sameAct(p.act, a) && !(p.guard && wasGuard !== (ENEMIES_ON && nightAt(h) && a.action !== 'sleep'))) continue;
      if (p.talk) { p.talk.on = false; p.talk = null; p.bubble.hidden = true; }
      endChat(p);
      if (wasGuard) { setShield(p.ch, false); p.ch.userData.block = false; }
      p.ch.visible = true;
      setAct(p, a, false);
    }
  }

  // ---------- 今日の立ち話（sim.js で決まった組と言葉） ----------
  const byKey = Object.fromEntries(people.map((p) => [p.v.key, p]));
  const pushOut = (pt) => freePt(pt);
  const talks = (D.social.talks || []).filter((t) => t.day === state.day && byKey[t.a] && byKey[t.b]).map((t, i) => ({ ...t, A: byKey[t.a], B: byKey[t.b], next: 2 + i * 7 + (hash(t.a) % 4), on: false }));
  for (const p of people) {
    const el = document.createElement('div'); el.className = 'bubble'; el.hidden = true;
    const o = new CSS2DObject(el); o.position.set(0, 1.32, 0); p.ch.add(o); p.bubble = el;
  }
  function startTalk(tk, time) {
    const m = pushOut({ x: (tk.A.pos.x + tk.B.pos.x) / 2, z: (tk.A.pos.z + tk.B.pos.z) / 2 });
    const dx = tk.B.pos.x - tk.A.pos.x, dz = tk.B.pos.z - tk.A.pos.z, d = Math.hypot(dx, dz) || 1;
    const spotA = pushOut({ x: m.x - (dx / d) * 1.05, z: m.z - (dz / d) * 1.05 }), spotB = pushOut({ x: m.x + (dx / d) * 1.05, z: m.z + (dz / d) * 1.05 }); // 2.1 はなれる（お辞儀で頭が当たらない）
    for (const [p, s, other] of [[tk.A, spotA, tk.B], [tk.B, spotB, tk.A]]) { p.w0 = null; p.phase = 5; p.ri = 0; p.routes.talk = routeAround(p.pos, s, walls); p.talk = tk; p.other = other; }
    tk.on = true; tk.t0 = null;
  }
  const free = (p) => p.mode === 'day' && !p.chat && (p.phase === 1 || p.phase === 3 || p.phase === 4);
  // 会話の中身：あいさつ（はじめて会った時）＋ sim.js の言葉＋ js/chat.js の続き（A と B が交互に）。同じ組・同じ時間なら同じ
  function fillConvo(c, base, greet) {
    const a = c.A.v.key, b = c.B.v.key, close = closeOf(D.social.pairs, a, b, base && base.kind);
    c.g = greet ? greetOf(close, curHour, hash([a, b].sort().join('|') + ':' + curHour)) : null;
    if (c.g) c.A.greetKind = c.B.greetKind = c.g.kind;
    const extra = moreLines({ a, b, jobA: (life[a] || {}).job, jobB: (life[b] || {}).job, foodA: (c.A.v.profile || {}).food, foodB: (c.B.v.profile || {}).food,
      hour: curHour, weather: state.weather, today: state.today, close, round: c.round || 0, last: base && base.lines.length ? (base.lines[base.lines.length - 1][0] === a ? 0 : 1) : null }, base ? 2 : 3);
    c.all = [...(base ? base.lines.filter(([w]) => byKey[w]).map(([w, s]) => [byKey[w], s]) : []), ...extra.map(([w, s]) => [w ? c.B : c.A, s])];
  }
  // 進める：向き合う（0.45 秒）→ A があいさつ → B が返す → 交互に話す。終わったら true
  const G_AT = 0.45, G_LEN = 1.5, L_AT = G_AT + 2.6, L_LEN = 2.6;
  const say = (p, s) => { if (p.bubble.textContent !== s) p.bubble.textContent = s; p.bubble.hidden = false; };
  function runConvo(c, time) {
    const e = time - c.t0;
    for (const p of [c.A, c.B]) p.bubble.hidden = true;
    c.A.greetU = c.g ? (e - G_AT) / G_LEN : -1; c.B.greetU = c.g ? (e - G_AT - 1.0) / G_LEN : -1; // B は A の言葉を聞いてから返す
    if (c.g && e >= G_AT && e < G_AT + 1.25) say(c.A, c.g.a);
    else if (c.g && e >= G_AT + 1.25 && e < L_AT - 0.15) say(c.B, c.g.b);
    const k = Math.floor((e - (c.g ? L_AT : 0)) / L_LEN);
    if (k >= 0 && k < c.all.length) say(c.all[k][0], c.all[k][1]);
    return k >= c.all.length;
  }
  function updateTalks(time) {
    for (const tk of talks) {
      if (!tk.on) { if (time > tk.next && free(tk.A) && free(tk.B)) startTalk(tk, time); continue; }
      if (tk.t0 === null) { if (tk.A.phase === 6 && tk.B.phase === 6) { tk.t0 = time; tk.round = (tk.round || 0) + 1; fillConvo(tk, tk, true); } else continue; }
      if (runConvo(tk, time)) {
        for (const p of [tk.A, tk.B]) { p.phase = 7; p.ri = 0; p.routes.back = routeAround(p.pos, p.work, walls); p.talk = null; p.greetU = -1; }
        tk.on = false; tk.next = time + 30 + (hash(tk.a + tk.b) % 20);
      }
    }
    updateChats(time);
  }
  // 「おしゃべり」の時間（life の tk）：2 人とも場所に着いて向き合ったら、あいさつしてから話す。話が終わると少し休んで、また話す
  const chats = new Set();
  function endChat(p) {
    const c = p.chat; if (!c) return;
    chats.delete(c);
    for (const q of [c.A, c.B]) { q.chat = null; q.greetU = -1; q.bubble.hidden = true; }
  }
  function updateChats(time) {
    for (const p of people) {
      if (p.chat || p.talk || p.mode !== 'day' || p.phase !== 1 || !p.act || p.act.action !== 'chat') continue;
      const o = byKey[p.act.target];
      if (!o || o.chat || o.talk || o.mode !== 'day' || o.phase !== 1 || !o.act || o.act.action !== 'chat' || o.act.target !== p.v.key) continue;
      if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) > 3) continue;
      const [A, B] = p.v.key < o.v.key ? [p, o] : [o, p];
      const c = { A, B, t0: time, round: 0 };
      fillConvo(c, null, true);
      A.chat = B.chat = c; chats.add(c);
    }
    for (const c of chats) {
      if (time < c.t0) continue;
      if (runConvo(c, time)) { c.round++; c.t0 = time + 8 + (hash(c.A.v.key + c.round) % 8); fillConvo(c, null, false); }
    }
  }
  // 誕生日の人：名札に印、家の前にケーキと旗
  for (const k of (state.today && state.today.birthdays) || []) {
    const p = byKey[k]; if (!p) continue;
    p.label.classList.add('bday'); p.label.textContent = '誕生日 ' + tagName(p.v, { video: IS_VIDEO, cfg: config });
    const g = new THREE.Group();
    box(0.9, 0.45, 0.9, 0xfaf3e8, 0, 0.6, 0, g); box(0.92, 0.1, 0.92, 0xd9506a, 0, 0.86, 0, g); box(0.08, 0.25, 0.08, 0xfff1a8, 0, 1.03, 0, g);
    box(1.2, 0.55, 1.0, 0x9b6b3d, 0, 0.27, 0, g);
    for (const s of [-1.6, 1.6]) box(0.1, 2.2, 0.1, 0x8a5a33, s, 1.1, -0.6, g);
    for (let i = 0; i < 7; i++) box(0.3, 0.3, 0.05, [0xd9506a, 0xe2c04e, 0x4b9a5e, 0x3f78b8][i % 4], -1.35 + i * 0.45, 1.9 - Math.sin((i / 6) * Math.PI) * 0.3, -0.6, g).rotation.z = Math.PI / 4;
    const at = pushOut({ x: p.home.x + 1.2, z: p.home.z + 0.4 });
    g.position.set(at.x, 0, at.z); g.rotation.y = Math.atan2(-(at.x - CTR.x), -(at.z - CTR.z)); scene.add(g);
  }

  // 0:家→仕事場 1:仕事 2:仕事場→置き場 3:置く 4:置き場→仕事場 5:立ち話へ 6:立ち話 7:仕事場へもどる
  const SPEED = 2.6; // 村人の背 3.8 で、人がふつうに歩く速さ（1 秒に 2 歩ほど・脚の動きと合う）
  // 向きはなめらかに変える（1 秒に TURN ラジアンまで）。返すのは、まだ残っている角度
  const TURN = 7;
  function turnTo(ch, want, dt) {
    let d = want - ch.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const s = Math.max(-TURN * dt, Math.min(TURN * dt, d));
    ch.rotation.y += s;
    return Math.abs(d - s);
  }
  // 歩く：まず進む向きへ体を回してから前へ歩く（後ろ向き・横向きには歩かない）
  function walkTo(p, route, dt) {
    let left = SPEED * dt;
    while (left > 0 && p.ri < route.length) {
      const target = route[p.ri];
      const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { p.ri++; continue; }
      if (turnTo(p.ch, Math.atan2(dx, dz), left === SPEED * dt ? dt : 0) > 0.35) break; // 向きが大きくちがう間は、その場で向きを変える
      const s = Math.min(d, left);
      p.pos.x += (dx / d) * s; p.pos.z += (dz / d) * s; left -= s;
      if (s >= d) p.ri++;
    }
    if (p.ri >= route.length) { p.ri = 0; p.stk = null; return true; }
    // 引っかかり：歩いているのに 2 秒、次の折れ目に近づけない時は、今いる所から マス目で道を作り直す（なければ少し下がって横へ）。
    // 3 回だめなら そこで着いたことにする（散歩なら次の行き先へ）
    const tg = route[p.ri], dNow = Math.hypot(tg.x - p.pos.x, tg.z - p.pos.z);
    const sk = p.stk && p.stk.r === route ? p.stk : (p.stk = { r: route, t: 0, ri: p.ri, d: dNow, n: 0 });
    if (sk.ri !== p.ri || dNow < sk.d - 0.5) { sk.ri = p.ri; sk.d = dNow; sk.t = 0; }
    else if ((sk.t += dt) >= 2) {
      if (++sk.n >= 3) { p.ri = 0; p.stk = null; return true; }
      // 途中の折れ目のすぐそばまで来ているなら（物が近くて その点に立てない）、その点はとばす
      if (dNow < 1.2 && p.ri >= route.length - 1) { p.ri = 0; p.stk = null; return true; } // 行き先のすぐ手前：ここで着いたことにする
      if (dNow < 1.2) { p.ri++; sk.ri = p.ri; sk.t = 0; sk.d = Math.hypot(route[p.ri].x - p.pos.x, route[p.ri].z - p.pos.z); return false; }
      const end = route[route.length - 1];
      let nr = gridRoute(p.pos, end);
      if (!nr) {
        const dx = tg.x - p.pos.x, dz = tg.z - p.pos.z, l = dNow || 1, sd = sk.n % 2 ? 1 : -1;
        const side = freePt({ x: p.pos.x - (dx / l) * 0.8 - (dz / l) * 1.8 * sd, z: p.pos.z - (dz / l) * 0.8 + (dx / l) * 1.8 * sd });
        nr = [side, ...safeRoute(side, end)];
      }
      route.splice(0, route.length, ...nr);
      p.ri = 0; sk.ri = 0; sk.t = 0; sk.d = Math.hypot(route[0].x - p.pos.x, route[0].z - p.pos.z);
    }
    return false;
  }
  // 重ならない：体（だ円）が、物の円・ほかの人の体・横になっている人に入っていたら外へ出す（ちゃんと描いている人だけ、毎こま）
  function keepApart(p, noSolid) {
    if (p.lod !== 'full') return;
    const yaw = p.ch.rotation.y;
    for (const o of pgrid.near(p.pos.x, p.pos.z, 4.2)) {
      if (o === p || !o.ch.visible) continue;
      let dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z;
      if (o.mode === 'sleep') { // 横になっている人は、足もと→頭の線。木にもたれている人は その点
        const sp = o.sleepAt; if (!sp) continue;
        const seg = sp.tree || o.sleepPlace === 'tree' ? { x: o.pos.x, z: o.pos.z, hx: o.pos.x + Math.sin(sp.yaw) * 1.4, hz: o.pos.z + Math.cos(sp.yaw) * 1.4 } : { x: o.pos.x, z: o.pos.z, hx: o.pos.x - Math.sin(sp.yaw) * 3.6, hz: o.pos.z - Math.cos(sp.yaw) * 3.6 };
        const vx = seg.hx - seg.x, vz = seg.hz - seg.z, L2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((p.pos.x - seg.x) * vx + (p.pos.z - seg.z) * vz) / L2));
        dx = p.pos.x - (seg.x + vx * u); dz = p.pos.z - (seg.z + vz * u);
        const d = Math.hypot(dx, dz) || 0.01, need = 0.5 + bodyR(yaw, -dx, -dz);
        if (d < need) { p.pos.x += (dx / d) * (need - d); p.pos.z += (dz / d) * (need - d); }
        continue;
      }
      const d = Math.hypot(dx, dz) || 0.01, need = bodyR(yaw, -dx, -dz) + bodyR(o.ch.rotation.y, dx, dz) + 0.05;
      if (d < need) { const k = (need - d) * 0.5; p.pos.x += (dx / d) * k; p.pos.z += (dz / d) * k; } // 半分ずつ（相手も自分の番で半分よける）
    }
    if (noSolid) return;
    for (const o of solidNear(p.pos.x, p.pos.z)) {
      if (o.owner === p.v.key) continue;
      const dx = p.pos.x - o.x, dz = p.pos.z - o.z, d = Math.hypot(dx, dz) || 0.01, need = o.r + bodyR(yaw, -dx, -dz) + 0.02;
      if (d < need) { p.pos.x += (dx / d) * (need - d); p.pos.z += (dz / d) * (need - d); }
    }
  }
  function updatePerson(p, dt, time) {
    p.t += dt;
    let pose = 'idle';
    if (p.mode === 'gohome' || p.mode === 'sleep') {
      setTool(p.ch, null); setCarry(p.ch, null);
      const sp = p.sleepAt || { ...p.home, yaw: 0 };
      if (p.mode === 'gohome') { pose = 'walk'; if (walkTo(p, p.routes.night, dt)) { p.mode = 'sleep'; p.t = 0; } else if (Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) > 2.4) keepApart(p); }
      else if (turnTo(p.ch, sp.yaw, dt) > 0.05) pose = 'idle'; // 寝る場所に着いたら、向きを変えてから
      else pose = sp.tree ? 'sit' : 'lie'; // ベッド・敷物・地面は横になる、木は幹にもたれて座る
      p.ch.userData.lieY = sp.bed ? BED.h / 1.9 : sp.mat ? (MAT.h + 0.04) / 1.9 : 0;
      p.ch.visible = !(p.mode === 'sleep' && sp.inside); // 家の中の床で寝ている人は外から見えない
      p.ch.position.set(p.pos.x, 0, p.pos.z);
      if (p.lod === 'full') animate(p.ch,pose, time + (hash(p.v.key) % 100) / 10);
      return;
    }
    if (p.mode === 'guard' && isDown(p)) { // 体力がつきてたおれた見張り：その場で横になる（朝に家で目を覚まし、次の日は休む）
      setShield(p.ch, false); setTool(p.ch, null); p.ch.userData.block = false; p.ch.userData.lieY = 0;
      const W = p.fightGo || { x: 0, z: 0 };
      p.ch.position.set(p.pos.x + W.x, 0, p.pos.z + W.z);
      if (p.lod === 'full') animate(p.ch, 'lie', time);
      return;
    }
    if (p.mode === 'toguard' || p.mode === 'guard') {
      const GG = guardGear(p); setTool(p.ch, GG.tool); setCarry(p.ch, null); setShield(p.ch, GG.shield); // 持っている物で戦う（はじめは道具か素手）
      const D = p.duel;
      p.ch.userData.block = !!((D && D.block) || p.blockA || (p.guardHit ?? -1) >= 0); // 敵のこぶし・矢が来たら盾を上げる
      let ox = 0, oz = 0;
      if (p.mode === 'toguard') { pose = 'walk'; if (walkTo(p, p.routes.night, dt)) p.mode = 'guard'; }
      else {
        // 森の方を見張る。敵が来たらその方を向き、なぐり合う間は一歩前へ（打つ時はもう少し踏みこむ）。矢は盾で受けるか、横へよける
        const face = D || p.faceAt;
        const at = { x: p.pos.x + (p.fightGo ? p.fightGo.x : 0), z: p.pos.z + (p.fightGo ? p.fightGo.z : 0) };
        turnTo(p.ch, face ? Math.atan2(face.x - at.x, face.z - at.z) : Math.atan2(fdir.x, fdir.z), dt);
        const fx = Math.sin(p.ch.rotation.y), fz = Math.cos(p.ch.rotation.y);
        // 敵を見つけたら走って打つ所まで行き、終わったら歩いて持ち場へ戻る（持ち場からのずれ W）
        const W = p.fightGo || (p.fightGo = { x: 0, z: 0 }), wx = p.want ? p.want.x - p.pos.x : 0, wz = p.want ? p.want.z - p.pos.z : 0;
        const wd = Math.hypot(wx - W.x, wz - W.z), st = Math.min(wd, (p.want ? 5.2 : 2.2) * dt), moving = wd > 0.08;
        if (moving) { W.x += ((wx - W.x) / wd) * st; W.z += ((wz - W.z) / wd) * st; }
        if (moving && !D && !p.faceAt) turnTo(p.ch, Math.atan2(wx - W.x, wz - W.z), dt);
        const lunge = D && D.strike !== null ? Math.max(0, Math.sin(Math.min(1, D.strike / 0.85) * Math.PI)) * 0.45 : 0;
        const gh = (p.guardHit ?? -1) >= 0 ? Math.sin(Math.min(1, p.guardHit * 1.4) * Math.PI) * 0.35 : 0, push = lunge - gh - (p.flinch || 0) * 0.5; // 受けた勢いで少し後ずさり
        const tx = fx * push + fz * (p.dodge || 0) * 1.1, tz = fz * push - fx * (p.dodge || 0) * 1.1;
        const O = p.fightOff || (p.fightOff = { x: 0, z: 0 }), k = Math.min(1, dt * 10);
        O.x += (tx - O.x) * k; O.z += (tz - O.z) * k; ox = O.x + W.x; oz = O.z + W.z;
        pose = D && D.strike !== null ? 'strike' : moving && !D ? 'walk' : (p.dodge || 0) > 0.2 ? 'walk' : 'idle';
      }
      keepApart(p);
      p.ch.position.set(p.pos.x + ox, 0, p.pos.z + oz);
      if (p.lod === 'full') animate(p.ch, pose, time + (hash(p.v.key) % 100) / 10, D && D.strike !== null ? D.strike : null);
      return;
    }
    if (p.rest) { setTool(p.ch, null); setCarry(p.ch, null); keepApart(p); p.ch.position.set(p.pos.x, 0, p.pos.z); if (p.lod === 'full') animate(p.ch,'idle', time + (hash(p.v.key) % 100) / 10); return; }
    if (p.phase === 0 || p.phase === 4) {
      setTool(p.ch, p.toolKey); setCarry(p.ch, null);
      pose = 'walk';
      if (walkTo(p, p.routes[p.phase], dt)) { p.phase = 1; p.t = 0; }
    } else if (p.phase === 1 && p.wander) {
      // 散歩：村のまわりの点を順に歩く（前を向いて歩く。着いたら次の点）
      setTool(p.ch, null); setCarry(p.ch, null); pose = 'walk';
      if (!p.routes.w) { p.ri = 0; for (let k = 0; k < 4 && !(p.routes.w && !p.routes.w.blocked); k++) p.routes.w = safeRoute(p.pos, wanderPt(p, ++p.wi)); } // 行けない所なら別の行き先
      if (walkTo(p, p.routes.w, dt)) p.routes.w = null;
    } else if (p.phase === 1) {
      setTool(p.ch, p.toolKey); setCarry(p.ch, null);
      pose = p.chat ? talkPose(p) : p.pose;
      if (pose === 'fish') { const sf = fishShowOf(p, time); p.ch.userData.showFish = sf; if (sf) pose = 'showfish'; } // 釣った魚を持ち上げて見せる
      if (p.work.fx !== null) turnTo(p.ch, Math.atan2(p.work.fx - p.pos.x, p.work.fz - p.pos.z), dt); // 作業中だけ、木や岩の方を向く
      if (p.stay) setCarry(p.ch, null); // 休む・食べる・作る・見張りは、その時間のあいだその場で
      else if (p.mine ? workU(p, time) > workLen(p) : p.t > workLen(p)) { p.phase = 2; p.t = 0; p.w0 = null; }
    } else if (p.phase === 2) {
      setTool(p.ch, null); setCarry(p.ch, p.job);
      pose = 'carry';
      if (walkTo(p, p.routes[2], dt)) { p.phase = 3; p.t = 0; depositFx(p, time); }
    } else if (p.phase === 3) {
      setCarry(p.ch, null); pose = 'idle';
      if (p.t > 1.2) { p.phase = 4; p.t = 0; }
    } else if (p.phase === 5) {
      setTool(p.ch, null); setCarry(p.ch, null); pose = 'walk';
      if (walkTo(p, p.routes.talk, dt)) { p.phase = 6; p.t = 0; }
    } else if (p.phase === 6) {
      pose = talkPose(p);
      turnTo(p.ch, Math.atan2(p.other.pos.x - p.pos.x, p.other.pos.z - p.pos.z), dt);
    } else if (p.phase === 7) {
      setTool(p.ch, p.toolKey); pose = 'walk';
      if (walkTo(p, p.routes.back, dt)) { p.phase = 1; p.t = 0; }
    }
    keepApart(p);
    p.ch.position.set(p.pos.x, 0, p.pos.z);
    p.ch.userData.nod = pose === 'walk' && p.lod === 'full' ? passNod(p, time) : 0;
    p.lastPose = pose;
    if (p.lod === 'full') animate(p.ch,pose, time + (hash(p.v.key) % 100) / 10, GREET_POSE.has(pose) ? p.greetU : null);
  }
  // 立ち話の形：あいさつの間はお辞儀・手をふる・会釈、話している間は身ぶり
  const GREET_POSE = new Set(['bow', 'wave', 'nod']);
  function talkPose(p) { return p.greetU > 0 && p.greetU < 1 ? p.greetKind : p.bubble.hidden ? 'idle' : 'talk'; }
  // すれちがう時の会釈：前から歩いてくる人が近くにいたら、1 回だけ小さくうなずく（0.5 秒ごとに見る）
  function passNod(p, time) {
    if (p.nodT !== undefined) { const u = (time - p.nodT) / 1.1; if (u < 1) return u < 0 ? 0 : Math.sin(u * Math.PI); if (u > 14) p.nodWho = null; }
    if (time < (p.nodChk || 0)) return 0;
    p.nodChk = time + 0.5;
    const fx = Math.sin(p.ch.rotation.y), fz = Math.cos(p.ch.rotation.y);
    for (const o of pgrid.near(p.pos.x, p.pos.z, 2.8)) {
      if (o === p || o.lastPose !== 'walk' || !o.ch.visible || p.nodWho === o.v.key) continue;
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
      if ((fx * dx + fz * dz) / d < 0.55 || Math.sin(o.ch.rotation.y) * fx + Math.cos(o.ch.rotation.y) * fz > -0.3) continue; // 前にいて、こちらへ向かってくる人
      p.nodT = time; p.nodWho = o.v.key; return 0;
    }
    return 0;
  }

  // ---------- 釣り：うき・糸・釣れた魚 ----------
  // 釣りをする人は時間で変わるので、うきと糸は初めて釣る時に作る
  const lineMat = new THREE.LineBasicMaterial({ color: 0xf4f4f4 });
  const _tip = new THREE.Vector3(), _fishBox = new THREE.Box3();
  function updateFishing(time) {
    for (const p of people) {
      const on = p.pose === 'fish' && p.phase === 1 && p.mode === 'day' && p.ch.visible;
      if (!on) { if (p.bob) { p.bob.visible = false; p.line.visible = false; } continue; }
      if (!p.bob) { p.bob = makeBobber(); scene.add(p.bob); p.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat); scene.add(p.line); }
      if (!p.bobAt || p.bobFor !== p.work) { // うきは向いている方（池のまん中・海べなら沖）へ。海の面は池より低い
        const sea = !!p.work.sea, tx = p.work.fx ?? (world.pond ? world.pond.x : p.work.x), tz = p.work.fz ?? (world.pond ? world.pond.z : p.work.z + 1);
        const dx = tx - p.work.x, dz = tz - p.work.z, l = Math.hypot(dx, dz) || 1, d = sea ? 3.6 : 2.4;
        p.bobAt = { x: p.work.x + (dx / l) * d, z: p.work.z + (dz / l) * d, y: sea ? -0.2 : 0 }; p.bobFor = p.work;
      }
      const sf = p.ch.userData.showFish;
      if (sf) { // 魚を持ち上げて見せている間：うきと糸はしまい、頭の上に「フナ 23cm」（島の新記録は「新記録！」ときらきら）
        p.bob.visible = false; p.line.visible = false;
        const fo = p.ch.userData.parts && p.ch.userData.parts.fish, top = fo && fo.visible ? _fishBox.setFromObject(fo).max.y : 0; // 大きい魚は頭より上まで来るので、札はその上
        const a = sf.k < 0.1 ? sf.k / 0.1 : sf.k > 0.85 ? (1 - sf.k) / 0.15 : 1, hy = Math.max(4.4, top + 0.45) + Math.min(sf.k, 0.15) * 2;
        fx.plus(`${((config.items || {})[sf.key] || {}).name || ''} ${sf.cm}cm`, p.pos.x, hy, p.pos.z, a, sf.rec ? '#ffe27a' : '#ffffff', 1.4);
        if (sf.rec) {
          fx.plus('新記録！', p.pos.x, hy + 0.75 + Math.sin(time * 6) * 0.05, p.pos.z, a, '#ffcf3a', 1.5 + Math.sin(time * 8) * 0.06);
          fx.glow('gold', p.pos.x, hy + 0.4, p.pos.z, a * 0.9, time, 1.5);
        }
        continue;
      }
      p.bob.visible = true; p.line.visible = true;
      const f = fishCycle(time + (hash(p.v.key) % 100) / 10);
      const y = 0.1 + p.bobAt.y + Math.sin(time * 2.2) * (p.work.sea ? 0.05 : 0.02) - f.sink * 0.16 + f.reel * 0.5;
      const k = f.reel; // 釣り上げる時は、うきが手前へ
      p.bob.position.set(p.bobAt.x + (p.pos.x - p.bobAt.x) * k * 0.5, y, p.bobAt.z + (p.pos.z - p.bobAt.z) * k * 0.5);
      p.bob.userData.ring.scale.setScalar(1 + f.sink * 1.4);
      const tool = p.ch.userData.parts && p.ch.userData.parts.tool;
      if (tool && tool.userData.tip) { tool.userData.tip.getWorldPosition(_tip); p.line.geometry.setFromPoints([_tip.clone(), p.bob.position.clone().setY(y + 0.25)]); }
      if (f.caught) fx.item('fish', p.bob.position.x, y + 0.2 + f.reel * 0.4, p.bob.position.z, time * 4, 1.3);
    }
  }
  // 釣り上げたあと約 2.8 秒（釣りの 1 回 7 秒のうち c が 0.9〜1.3）、その日に釣った魚（life の today.fish：[魚, cm, 新記録なら 1]）を順に持ち上げて見せる
  function fishShowOf(p, time) {
    const fl = ((life[p.v.key] || {}).today || {}).fish;
    if (!fl || !fl.length || p.mode !== 'day') return null;
    const tf = time + (hash(p.v.key) % 100) / 10, c = fishCycle(tf).c;
    if (!(c >= 0.9 || c < 0.3)) return null;
    const n = Math.floor((tf - 0.9 * 7) / 7), e = fl[((n % fl.length) + fl.length) % fl.length];
    return { key: e[0], cm: e[1], rec: !!e[2], k: ((c - 0.9 + 1) % 1) / 0.4 };
  }

  // ---------- 動物：種や作物を持っている村人（life の lure）には、近くの野の動物がついてくる ----------
  const LURE_R = (((config.animals && config.animals.followRange) || 12) * 1.9);
  // 動物が入ってよい所か（木・岩・建物・畑・池に重ならない）
  const animalOk = (x, z) => isFree(x, z, 0.55) && !(world.pond && Math.hypot(x - world.pond.x, z - world.pond.z) < world.pond.r + 0.7) && !tents.some((t) => inTent(t, x, z, 1.2));
  // 歩く輪のまん中がテントにかかる動物は、テントの外（近いほうのふち）へ出しておく（見るだけ。data は変えない）
  let animalsOut = false;
  const moveAnimalsOut = () => {
    animalsOut = true;
    for (const A of animals) for (const t of tents) {
      if (!inTent(t, A.a.x, A.a.z, 4)) continue;
      const s = Math.sin(t.yaw), c = Math.cos(t.yaw), dx = A.a.x - t.x, dz = A.a.z - t.z;
      let u = dx * s + dz * c, v = dx * c - dz * s;
      const mu = t.depth / 2 + 4 - Math.abs(u), mv = t.len / 2 + 4 - Math.abs(v);
      if (mu < mv) u = Math.sign(u || 1) * (t.depth / 2 + 4); else v = Math.sign(v || 1) * (t.len / 2 + 4);
      const p = tentPoint(t, u, v); A.a = { ...A.a, x: p.x, z: p.z }; A.o.userData.cur = null;
    }
  };
  function updateAnimals(time, dt) {
    if (!animalsOut) moveAnimalsOut();
    const taken = new Map();
    for (const { a, o } of animals) {
      const q = animalPos(a, time, !!a.pen);
      const c = o.userData.cur || (o.userData.cur = { x: q.x, z: q.z });
      let tgt = null;
      if (!a.pen && !wasNight) {
        let best = null, bd = LURE_R;
        for (const p of pgrid.near(a.x, a.z, LURE_R, (o) => o.lure)) { // 周りのマスの、種を持っている人だけ
          if (!p.ch.visible || p.mode !== 'day' || (taken.get(p) || 0) >= 2) continue;
          const d = Math.hypot(p.pos.x - a.x, p.pos.z - a.z);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const n = taken.get(best) || 0; taken.set(best, n + 1);
          const yaw = best.ch.rotation.y, side = n ? 1.1 : -1.1; // 村人のうしろ、少し横
          tgt = { x: best.pos.x - Math.sin(yaw) * 2.2 + Math.cos(yaw) * side, z: best.pos.z - Math.cos(yaw) * 2.2 - Math.sin(yaw) * side };
        }
      }
      const goal = tgt || q;
      const dx = goal.x - c.x, dz = goal.z - c.z, d = Math.hypot(dx, dz);
      let face = q.face, move = q.move, graze = q.graze;
      if (tgt ? d > 0.3 : d > 0.4) {
        const s = Math.min(d, 3.2 * dt), nx = c.x + (dx / d) * s, nz = c.z + (dz / d) * s;
        if (animalOk(nx, nz) || !animalOk(c.x, c.z)) { c.x = nx; c.z = nz; face = Math.atan2(-dz, dx); move = 1; graze = 0; } // 動物の頭は +x 向き
        else { move = 0; graze = tgt ? 0 : 1; face = o.rotation.y; } // 木・岩・池の前では止まって草を食べる
      } else if (tgt) { move = 0; graze = 0; face = o.rotation.y; }
      else if (animalOk(q.x, q.z)) { c.x = q.x; c.z = q.z; }
      else { move = 0; graze = 1; face = o.rotation.y; }
      o.position.set(c.x, 0, c.z); o.rotation.y = face; animateAnimal(o, time, move, graze);
      agrid.set(a, c.x, c.z, { x: c.x, z: c.z, a }); // 動物の位置もマスの一覧に
    }
  }

  // ---------- クリック ----------
  const ray = new THREE.Raycaster();
  const down = { x: 0, y: 0, t: 0 };
  renderer.domElement.addEventListener('pointerdown', (e) => { down.x = e.clientX; down.y = e.clientY; down.t = performance.now(); });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 500) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(clickables, false)[0];
    if (hit) openCard(hit.object.userData.owner.userData.villager);
    else {
      const ph = ray.intersectObjects(projPicks, true)[0];
      let o = ph && ph.object; while (o && !o.userData.project) o = o.parent;
      if (o) openProject(o.userData.project); else closeCard();
    }
  });

  // ---------- 大きさ ----------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h); labels.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();
  // 遅い機械では、描く細かさ（画素の倍率）を自動で下げる。速くなったら少しずつ戻す（?res=fixed で止める）
  const PR_MAX = renderer.getPixelRatio(), PR_MIN = Math.min(PR_MAX, 0.6);
  const res = { pr: PR_MAX, t: 0, n: 0, good: 0, off: /[?&]res=fixed/.test(location.search) };
  window.TOWN.res = res;
  function autoRes() {
    if (res.off) return;
    const now = performance.now(); res.t0 = res.t0 || now; res.n++;
    if (now - res.t0 < 1500) return;
    const fps = res.n * 1000 / (now - res.t0); res.t0 = now; res.n = 0; res.fps = +fps.toFixed(1);
    let pr = res.pr;
    // 急に変えると画面がぼやけたり くっきりしたりが目立つので、1 回に 0.1 ずつ
    if (fps < 28 && pr > PR_MIN) { pr = Math.max(PR_MIN, +(pr - 0.1).toFixed(2)); res.good = 0; }
    else if (fps > 55 && pr < PR_MAX && ++res.good >= 3) { pr = Math.min(PR_MAX, +(pr + 0.1).toFixed(2)); res.good = 1; }
    if (pr !== res.pr) { res.pr = pr; renderer.setPixelRatio(pr); resize(); }
  }

  // ---------- 回す ----------
  const clock = new THREE.Clock();
  let puffT = 0;
  const tmp = new THREE.Vector3();
  let frame = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const time = clock.elapsedTime;
    if ((frame & 3) === 0) { // 空と光の色は 4 コマごと（少しずつ変わるので、つぎ目が見えない）
      const h = hourNow();
      sky.set(h, { x: controls.target.x, z: controls.target.z });
      const night = sky.n > 0.6;
      if (night !== wasNight) {
        if (wasNight !== null) switchMode(night); // 夜は立ち話をやめる（寝る・働くは、その人の時間の行動のまま）
        wasNight = night;
      }
      const hi = Math.floor(h) % 24;
      if (hi !== curHour) { curHour = hi; changeHour(hi); renderClock(h); }
      sky.placeLights(camera.position);
      moon.intensity = Math.max(0, sky.n) * 0.55;
      moon.position.set(controls.target.x - 25, 55, controls.target.z - 35); moon.target.position.copy(controls.target);
      if ((frame & 1023) === 0) renderClock(h);
    }
    updateMobs(time, sky.n, sky.h);
    updateArrows(time, sky.n);
    if (!wasNight) updateTalks(time);
    fx.begin();
    if ((frame & 7) === 0) pickLod();
    // 画面の外の人は 4 コマに 1 回だけ進める（その分まとめて）
    for (const p of people) {
      p.acc += dt;
      if (p.lod === 'off' && ((frame + p.idx) & 3) !== 0) continue;
      if (p.lod === 'far' && ((frame + p.idx) & 1) !== 0) continue; // 遠い人は 2 コマに 1 回
      updatePerson(p, p.acc, time); p.acc = 0;
      p.x = p.pos.x; p.z = p.pos.z; pgrid.set(p, p.x, p.z);
    }
    for (const p of people) updateWork(p, time);
    smoothPeople(dt);
    updateChest(time);
    for (const m of markers) m.userData.flag.rotation.y = Math.sin(time * 0.8) * 0.4;
    fx.end();
    for (const b of anim.blades) b.rotation.z += dt * 0.8;
    for (const b of anim.boats) { b.position.y = 0.05 + Math.sin(time * 1.5) * 0.06; b.rotation.z = Math.sin(time * 1.2) * 0.04; }
    anim.cows.forEach((c, i) => { c.rotation.y += Math.sin(time * 0.3 + i) * 0.004; });
    for (const h of anim.hands) h.rotation.z = -time * 0.2;
    for (const p of guards) { const f = p.ch.userData.parts && p.ch.userData.parts.tool && p.ch.userData.parts.tool.userData.flame; if (f) f[0].scale.y = 0.8 + Math.sin(time * 14 + p.t) * 0.25; }
    if (anim.flame) { anim.flame.scale.y = 0.8 + Math.sin(time * 12) * 0.2; }
    if (pondObj) animatePond(pondObj, time);
    updateAnimals(time, dt);
    for (const c of anim.canals) for (const m of c.userData.flow) { const u = (time * 0.25 + m.userData.ph) % 1; m.position.z = -c.userData.len / 2 + u * c.userData.len; }
    updateFishing(time);
    puffT += dt;
    if (puffT > 0.35) { puffT = 0; for (const e of emitters) if (!e.thin || Math.random() < 0.5) addPuff(scene, e); }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const m = puffs[i]; m.userData.life += dt;
      m.position.y += dt * 0.8; m.position.x += dt * 0.2;
      m.scale.setScalar(1 + m.userData.life * 0.8);
      m.material.opacity = Math.max(0, 0.7 - m.userData.life * 0.28);
      if (m.userData.life > 2.5) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); puffs.splice(i, 1); }
    }
    // 名前札は遠いと小さく、とても遠いと消す
    const dist = camera.position.distanceTo(controls.target);
    for (const p of people) {
      if (p.lod !== 'full') { p._far = true; continue; } // 札はちゃんと描く人だけ
      const dd = camera.position.distanceTo(p.ch.getWorldPosition(tmp));
      p._far = dd > 120 * VIEW_K;
      p.label.style.opacity = p._far || p._hidden || !p.ch.visible ? '0' : dd > 80 * VIEW_K ? '0.6' : '1';
      if (!p.ch.visible) p.bubble.hidden = true; // 家の中で寝ている人の札は出さない（CSS2D は親が見えなくても出るため）
      p.label.style.fontSize = dd > 70 * VIEW_K ? '10px' : '11px';
    }
    if ((frame & 7) === 0) updateSleepTags();
    // 名前の札が重ならないように、近い人から置いて、ぶつかる札は上へずらす（それでも無理なら隠す）
    if ((frame++ & 3) === 0) {
      // 画面の上の実際の札の位置で調べる（ずらした分はもどして考える）
      const tags = [];
      for (const p of people) {
        p._hidden = false;
        if (p._far || !p.ch.visible) continue;
        const r = p.label.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
        const depth = camera.position.distanceTo(p.ch.getWorldPosition(tmp));
        tags.push({ p, x: r.left + r.width / 2, y: r.top + r.height / 2 + (p._shift || 0) * (r.height + 2), w: r.width, h: r.height, depth });
      }
      for (const tg of declutter(tags, { step: 2, maxShift: 2 })) {
        tg.p._hidden = tg.shift < 0;
        tg.p._shift = Math.max(0, tg.shift);
        tg.p.label.style.marginTop = tg.shift > 0 ? (-tg.shift * (tg.h + 2)) + 'px' : '0';
        if (tg.p._hidden) tg.p.label.style.opacity = '0';
      }
    }
    for (const bt of btags) {
      const dd = camera.position.distanceTo(bt.position);
      bt.element.style.opacity = dd > 75 * VIEW_K && !bt.element.classList.contains('new') && !bt.element.classList.contains('islandtag') && !bt.element.classList.contains('chesttag') && !bt.element.classList.contains('basetag') ? '0' : '1';
    }
    // 地形はどこまでも続くので、見る場所の左右の制限はなし（高さだけ地面に）
    controls.target.y = 0;
    camStep(dt);
    terrain.update(controls.target);
    sky.follow(camera);
    if ((frame & 3) === 0) { cloudCol.copy(cloudDay).lerp(cloudNight, Math.min(1, Math.max(0, sky.n))); clouds.tint(cloudCol, 0.8 - Math.max(0, sky.n) * 0.15); }
    clouds.update(time, { x: controls.target.x, z: controls.target.z });
    // 霧：描く距離の上限の手前からかすませる（カメラが離れるほど遠くへ）
    // やわらかく：かすみ始めを手前にして、遠くほど空の色（地平線の色）に溶ける
    if (ISLANDS) { scene.fog.far = dist * 0.7 + VIEW_UNITS * 1.05; scene.fog.near = dist * 0.95; } // 島は霧の手前。北の島はうっすら、遠くの大陸はかすんで見える
    else { scene.fog.far = dist * 0.7 + VIEW_UNITS * 0.95; scene.fog.near = Math.min(dist * 0.6, scene.fog.far * 0.22); }
    // 遠い人・画面の外の人は、ちゃんとした姿を描かない（描く間だけ隠して、すぐ戻す）
    placeProxies();
    if (mobs.length) { const R0 = stage.getBoundingClientRect(); ft.end(camera, R0.width, R0.height, R0.left, R0.top); }
    const undoShake = mobs.length ? ft.shake(camera, time) : null; // クリティカルの直後だけ少し画面をゆらす
    updateTents(sky.n, dt);
    renderer.render(scene, camera);
    if (undoShake) undoShake();
    labels.render(scene, camera);
    autoRes();
    // 吹き出しと建物の札が画面の端で切れないように、内側へ寄せる
    const W = stage.clientWidth, sx = stage.getBoundingClientRect().left;
    const clampX = (el) => {
      const r = el.getBoundingClientRect(); if (!r.width) return;
      const cur = parseFloat(el.style.left) || 0, l = r.left - sx - cur, rr = l + r.width;
      const want = l < 6 ? 6 - l : rr > W - 6 ? W - 6 - rr : 0;
      if (Math.abs(want - cur) > 0.5) el.style.left = want + 'px';
    };
    for (const p of people) if (!p.bubble.hidden) clampX(p.bubble);
    for (const bt of btags) if (bt.element.style.opacity !== '0') clampX(bt.element);
  });

  function renderClock(h) {
    const el = document.getElementById('clockchip'); if (!el) return;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    el.textContent = `${phaseName(h)} ${hh}:${String(mm).padStart(2, '0')}`;
    el.classList.toggle('nightchip', sky.n > 0.6);
  }

  // ---------- 村人カード ----------
  const card = document.getElementById('card');
  async function openCard(v) {
    const L = life[v.key] || {};
    card.hidden = false; card.classList.remove('pjcard');
    card.innerHTML = '';
    const face = await faceCanvas(v, 48);
    face.className = 'face pixel';
    const who = document.createElement('div');
    who.className = 'who';
    const now = hourOf(L, curHour);
    const tb = titleBadges(v, config, L);
    who.innerHTML = `<b>${esc(v.display)}</b>${tb ? `<span class="cardtitles">${tb}</span>` : ''}<span class="muted">${esc((now && `${curHour}時・${hourText(now)}`) || ACTION[L.action] || JOB[L.job] || '')}・${esc(homeName(L, world, config, state))}</span><span class="lvline">Lv${L.level || 1}・枠 ${L.slots || config.inventory.base}/${config.inventory.max}</span>${gearNames(L, config.items).length ? `<span class="gearline">装備：${esc(gearNames(L, config.items).join('・'))}</span>` : ''}${bestFishText(L, config) ? `<span class="lvline">${esc(bestFishText(L, config))}</span>` : ''}${mbtiText(v, config) ? `<span class="lvline">${esc(mbtiText(v, config))}</span>` : ''}<span class="gauges">${gaugeHtml('heart', L.hp, (config.needs || {}).max || 20)}${gaugeHtml('food', L.hunger, (config.needs || {}).max || 20)}</span>`;
    const a = document.createElement('a');
    a.className = 'btn'; a.href = villagerUrl(v); a.textContent = 'くわしく';
    const x = document.createElement('button');
    x.className = 'close'; x.setAttribute('aria-label', '閉じる'); x.textContent = '×';
    x.onclick = closeCard;
    const btns = document.createElement('div'); btns.className = 'cardbtns'; btns.append(a);
    const ig = igUrl(v);
    if (ig) { const b = document.createElement('a'); b.className = 'btn ig'; b.href = ig; b.target = '_blank'; b.rel = 'noopener'; b.textContent = 'インスタ'; btns.append(b); }
    card.append(face, who, btns, x);
  }
  function closeCard() { card.hidden = true; card.classList.remove('pjcard'); }
  // 建てている物・橋の札：名前・進み・あと何個（あつまった数 / いる数）・作っている人
  function openProject(id) {
    const p = projectList(state, world, config, hourNow()).find((x) => x.id === id);
    if (!p) return closeCard();
    const nameOf = (k) => { const v = active.find((x) => x.key === k); return v ? v.display : ''; };
    card.hidden = false; card.classList.add('pjcard');
    card.innerHTML = `<div class="pj">${projectCardHtml(p, nameOf)}</div>`;
    const x = document.createElement('button');
    x.className = 'close'; x.setAttribute('aria-label', '閉じる'); x.textContent = '×';
    x.onclick = closeCard;
    card.append(x);
  }
}

// 拠点の場所の投票中の帯（地図の上）。票はコメントを数えた数（15 分ごとの受付で数え直す）
function baseBanner(v, cfg) {
  const n = v.votes || {};
  const tally = v.options.map((o) => `<span class="bv-opt"><i class="bv-k bv-${o.key}">${esc(o.key)}</i>${esc(o.name)} <b>${n[o.key] || 0}</b>票</span>`).join('');
  // 投票の投稿の URL があれば、帯を押すとインスタの投稿（コメント欄）へ。なければ投票のページへ
  // 投稿の URL が空なら、インスタのプロフィール（cfg.profileUrl）へ
  const IG = /^https:\/\/(www\.)?instagram\.com\//;
  const post = !cfg ? '' : IG.test(cfg.votePostUrl || '') ? cfg.votePostUrl : IG.test(cfg.profileUrl || '') ? cfg.profileUrl : '';
  return `<a class="basevote" href="${post ? esc(post) + '" target="_blank" rel="noopener' : 'vote.html'}"><span class="bv-title">拠点の場所を投票中！ コメントに A・B・C のどれかを書いてね</span><span class="bv-tally">${tally}</span></a>`;
}

function renderPanel(D) {
  const { state, history, active, life, config, world } = D;
  const hud = document.getElementById('hud');
  // 上の帯は 日目・時刻・天気・村人の数 だけ（木材・石・食べ物の数は「町のチェスト」へ）
  hud.innerHTML = `<span class="chip day">${state.day}日目</span><span class="chip" id="clockchip"></span><span class="chip">${esc(state.weather)}</span>` +
    `<span class="chip">村人 <b>${active.length}</b></span>`;
  const sn = startNote(state, config); // 0 日目（町が始まる前）の案内
  document.getElementById('dayline').textContent = sn || `${fmtDate(state.date)}（${state.day}日目）`;
  const t = state.today || { jobs: {}, built: [] };
  const builtNames = (t.built || []).map((id) => { const b = world.buildings.find((x) => x.id === id); return b ? config.buildings[b.type].name : ''; }).filter(Boolean);
  document.getElementById('today').innerHTML =
    (sn ? `<li>${esc(sn)}</li>` : `<li>木を切った人 ${(t.jobs || {}).wood || 0} 人・岩を掘った人 ${(t.jobs || {}).stone || 0} 人・食べ物を集めた人 ${(t.jobs || {}).food || 0} 人</li>`) +
    (builtNames.length ? `<li>${esc(builtNames.join('、'))}ができた</li>` : '') +
    history.slice(-5).reverse().map((h) => `<li><span class="muted">${h.day}日目</span> ${esc(h.text)}</li>`).join('');
  const plan = state.plan;
  const nextEl = document.getElementById('next');
  if (plan) {
    nextEl.innerHTML = `<b>${esc(config.buildings[plan.build].name)}</b>` + (plan.site ? `（${esc(plan.site.label)}）` : '（場所は投票中）') + ' <a href="#chestcard">あつまり具合を見る</a>';
  } else nextEl.textContent = (state.votes || []).some((v) => v.kind === 'base') ? 'まず拠点（チェストとたき火を置く所）の場所を投票で決めます。建物は、そのまわりに建てます。' : active.length ? '投票で決めます。' : '村人が来たら、投票で決めます。';
  const hm = (iso) => { const d = new Date(iso); return `${(d.getUTCHours() + 9) % 24}時`; };
  const votes = state.votes || [];
  document.getElementById('votebox').innerHTML = votes.length
    ? votes.map((v) => `<b>${esc(v.question)}</b>（${v.kind === 'base' ? (v.closesAt ? `${((d) => `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時`)(new Date(Date.parse(v.closesAt) + 9 * 3600e3))}まで` : '町が始まる時まで') : `${hm(v.opensAt)}〜${hm(v.closesAt)}`}）<br>` + v.options.map((o) => `${esc(o.key + ' ' + o.name)} <span class="muted">${v.votes[o.key]}票</span>`).join(' / ')).join('<br>') + ' <a href="vote.html">票を見る</a>'
    : active.length ? '次の投票は、今の建物ができたあとに開きます。<a href="vote.html">くわしく</a>' : '村人が来たら「何を建てる？」の投票が始まります。';
  // 町のチェスト
  // 町のチェスト：木材・石・食べ物の量 → 今つくっている物（あつまった数／いる数）→ 中身（材料・部品・食べ物・道具・その他）
  const IT = config.items;
  const totals = '<p class="restot">' + ['wood', 'stone', 'food'].map((r) => `<span class="chip"><i class="dot" style="background:${RES_COLOR[r]}"></i>${RES[r]} <b>${state.resources[r]}</b></span>`).join('') + '</p>';
  document.getElementById('chest').innerHTML = totals +
    '<h3 class="chg">今つくっている物</h3>' + goalHtml(state, config, hourNow()) +
    chestHtml(state.store || {}, config);
  const nt = state.nextTool;
  document.getElementById('nexttool').textContent = nt ? `次に作る道具：${(IT[nt.item] || {}).name || nt.item}（${nt.text}）` : '';
  document.getElementById('join').textContent = joinText(config);
}

main().catch(showError);
