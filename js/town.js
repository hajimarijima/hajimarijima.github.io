// トップの町の 3D 地図
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeCharacter, animate, setTool, setCarry, setAccent, setShield } from './character.js';
import { mat, box, hash, rnd, makeTree, makeRock, makeBush, makeField, makeBuilding, makeHouse, obstaclesFor, routeAround, declutter, makeRoads } from './world3d.js';
import { loadAll, nav, esc, skinUrl, villagerUrl, JOB, ACTION, RES, RES_COLOR, fmtDate, faceCanvas, homeName, buildingLabel, showError, emptyNote } from './common.js';
import { makeSky, jstHour, parseTime, phaseName } from './daynight.js';
import { makeMob, animateMob, makeArrow, arrowAt } from './mobs.js';
import { makeForest, makeRockField, makeFx, makePile, setPile, PILE_MAX, setRockHp, setTreeCut, setCrack, strikeAt, breakTime, dropPos, chipList, DIG, CHOP, HITS, LOGS, LOG, B, SHRINK, STAGES } from './blocks.js';

// 時刻：ふだんは日本時間の今。?time=morning / day / evening / night や ?time=21:30 で切りかえて確かめられる
const FIXED_H = parseTime(new URLSearchParams(location.search).get('time'));
const hourNow = () => (FIXED_H ?? jstHour());

nav('index.html');

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
  const D = await loadAll();
  const { config, state, world, life, active } = D;
  if (!active.length) document.querySelector('.map').insertAdjacentHTML('beforeend', emptyNote(config));
  renderPanel(D);

  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const small = Math.min(innerWidth, innerHeight) < 700;
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.75 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  stage.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd9ea);
  scene.fog = new THREE.Fog(0xbcd9ea, 150, 330);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 700);
  const far = innerWidth < 600 ? 1.35 : 1;
  camera.position.set(0, 46 * far, 54 * far);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 2);
  controls.enableDamping = true;
  controls.zoomSpeed = 1.6;
  controls.minDistance = 8; controls.maxDistance = 190;
  controls.maxPolarAngle = 1.3; controls.minPolarAngle = 0.25;
  controls.screenSpacePanning = false;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  window.TOWN = { camera, controls }; // 確かめ用（カメラを動かして撮る）

  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x6a7a4a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
  scene.add(sun.target);
  sun.position.set(-30, 50, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 200 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // 地面・海・砂浜
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), mat(0x86b85a));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(360, 6), mat(0xe8d6a0));
  beach.rotation.x = -Math.PI / 2; beach.position.set(0, 0.01, world.seaZ - 1); beach.receiveShadow = true; scene.add(beach);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(360, 120), new THREE.MeshLambertMaterial({ color: 0x4a9fd0, transparent: true, opacity: 0.92 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.05, world.seaZ + 60); scene.add(sea);
  // 草花（見た目だけ）
  {
    const R = rnd('flowers');
    const geo = new THREE.BoxGeometry(0.18, 0.25, 0.18);
    const cols = [0xf2f2f2, 0xf2d24a, 0xe2507a, 0x6a9cd8];
    cols.forEach((c, ci) => {
      const inst = new THREE.InstancedMesh(geo, mat(c), 60);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 60; i++) { const x = (R() - 0.5) * 140, z = (R() - 0.5) * 120 - 10; m4.makeTranslation(x, 0.12, Math.min(z, world.seaZ - 4)); inst.setMatrixAt(i, m4); }
      scene.add(inst);
    });
    const tufts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), mat(0x76a84c), 260);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 260; i++) { m4.makeTranslation((R() - 0.5) * 150, 0.07, Math.min((R() - 0.5) * 130 - 10, world.seaZ - 4)); tufts.setMatrixAt(i, m4); }
    scene.add(tufts);
  }
  // 道（広場があれば石畳、なければ土）
  const hasPlaza = world.buildings.some((b) => b.type === 'plaza');
  for (const b of world.buildings) {
    if (b.type === 'plaza' || b.plot === 'coast' || b.plot === 'coast2' || b.plot === 'coast3') continue;
    const len = Math.hypot(b.x, b.z + 1);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.2, len), mat(hasPlaza ? 0xc2b59a : 0xb59a72));
    path.rotation.x = -Math.PI / 2; path.rotation.z = Math.atan2(b.x, b.z + 1);
    path.position.set(b.x / 2, 0.02, (b.z - 1) / 2); path.receiveShadow = true; scene.add(path);
  }

  const objById = {};
  // 今日だれかが切る木・掘る岩だけは 1 本ずつ作る（ブロックを 1 つずつ減らせるように）。ほかはまとめて描く
  const workIds = new Set(active.map((v) => (life[v.key] || {}).target).filter(Boolean));
  const loneTrees = [], loneRocks = [];
  for (const t of world.trees) {
    if (t.state === 'tree' && !workIds.has(t.id)) { loneTrees.push(t); objById[t.id] = { ...t, obj: null }; continue; }
    const o = makeTree(t); scene.add(o); objById[t.id] = { ...t, obj: o };
  }
  for (const r of world.rocks) {
    if (r.hp === r.max && !workIds.has(r.id)) { loneRocks.push(r); objById[r.id] = { ...r, obj: null }; continue; }
    const o = makeRock(r); scene.add(o); objById[r.id] = { ...r, obj: o };
  }
  scene.add(makeForest(loneTrees)); scene.add(makeRockField(loneRocks));
  for (const b of world.bushes) { const o = makeBush(b); scene.add(o); objById[b.id] = { ...b, obj: o }; }
  for (const f of world.fields) { const o = makeField(f); scene.add(o); objById[f.id] = { ...f, obj: o }; }
  const emitters = [];
  const btags = [];
  const lightAnchors = [];
  const anim = { blades: [], boats: [], cows: [], lamps: [], hands: [] };
  for (const b of world.buildings) {
    const o = makeBuilding(b, config); scene.add(o);
    objById[b.id] = { ...b, obj: o };
    o.updateMatrixWorld(true);
    if (o.userData.steam) { const s = o.userData.steam; const p = new THREE.Vector3(s.x, s.y, s.z).applyMatrix4(o.matrixWorld); emitters.push({ ...s, wx: p.x, wy: p.y, wz: p.z, t: 0 }); }
    if (o.userData.blades) anim.blades.push(o.userData.blades);
    if (o.userData.boat) anim.boats.push(o.userData.boat);
    if (o.userData.cows) anim.cows.push(...o.userData.cows);
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
  scene.add(makeRoads(world.buildings, world.plots, config));
  // たき火とテント（家がない人の寝床）
  const camp = world.campfire;
  if (!hasPlaza && active.length) { // だれもいない間は、木と岩だけ
    const fire = new THREE.Group();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; box(0.35, 0.25, 0.35, 0x7d7a74, Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7, fire); }
    box(0.6, 0.15, 0.15, 0x6b4628, 0, 0.12, 0, fire); box(0.15, 0.15, 0.6, 0x6b4628, 0, 0.18, 0, fire);
    const flame = box(0.4, 0.6, 0.4, 0xff9a2a, 0, 0.5, 0, fire); flame.castShadow = false; anim.flame = flame;
    fire.position.set(camp.x, 0, camp.z); scene.add(fire);
    emitters.push({ wx: camp.x, wy: 1.2, wz: camp.z, dark: true, thin: true, t: 0 });
    lightAnchors.push({ x: camp.x, y: 1.4, z: camp.z });
  }
  // 昼と夜
  const sky = makeSky(scene, { hemi, sun, sunDist: 60, lightAnchors, maxLights: small ? 4 : 8 });
  sky.set(hourNow(), { x: 0, z: 0 });
  const homeless = active.filter((v) => !(life[v.key] || {}).home);
  const tentPos = [];
  homeless.forEach((v, i) => {
    const a = (i / Math.max(6, homeless.length)) * Math.PI * 2 + 0.4;
    const r = 4 + (i % 2) * 1.6;
    const x = camp.x + Math.cos(a) * r, z = camp.z + Math.sin(a) * r;
    const t = new THREE.Group();
    const m = new THREE.Mesh(new THREE.ConeGeometry(1, 1.4, 4), mat([0xe0c89a, 0xc9a777, 0xb8c9a0][i % 3]));
    m.rotation.y = Math.PI / 4; m.position.y = 0.7; m.castShadow = true; t.add(m);
    t.position.set(x, 0, z); t.rotation.y = -a; scene.add(t);
    tentPos[v.key] = { x: x + Math.cos(a) * -1.2, z: z + Math.sin(a) * -1.2 };
  });

  // ---------- 村人 ----------
  const store = world.buildings.find((b) => b.type === 'storehouse') || world.buildings.find((b) => b.type === 'plaza');
  const drop = store ? { x: store.x * 0.86, z: store.z * 0.86 } : { x: camp.x + 1.5, z: camp.z + 1.5 };
  const people = [];
  const clickables = [];
  const obstacles = obstaclesFor(world, config).concat(Object.values(tentPos).map((p) => ({ x: p.x, z: p.z, r: 0 })));
  const footR = (b) => { const o = obstacles.find((q) => q.x === b.x && q.z === b.z); return o ? o.r : 2.2; };
  active.forEach((v, i) => {
    const L = life[v.key] || {};
    const ch = makeCharacter(skinUrl(v.skin), { scale: 1.9 });
    if (v.profile && v.profile.color) setAccent(ch, v.profile.color);
    ch.userData.villager = v;
    scene.add(ch);
    ch.traverse((o) => { if (o.isMesh) { o.userData.owner = ch; clickables.push(o); } });
    const homeB = L.home && objById[L.home];
    const home = homeB ? { x: homeB.x + Math.sin(homeB.rot || 0) * (footR(homeB) + 0.6), z: homeB.z + Math.cos(homeB.rot || 0) * (footR(homeB) + 0.6) } : (tentPos[v.key] || { x: camp.x, z: camp.z + 2 });
    const tg = L.target && objById[L.target];
    const ang = (hash(v.key) % 360) * Math.PI / 180;
    // 木を切る人は葉の外に立つ（頭が葉に入らないように）、掘る人は岩の外に立つ
    const off = L.action && L.action.startsWith('dig') ? 2.3 : L.action === 'chop' ? 1.25 * ((tg && tg.size) || 1) + 0.6 : 1.2;
    const work = tg ? { x: tg.x + Math.cos(ang) * off, z: tg.z + Math.sin(ang) * off, fx: tg.x, fz: tg.z } : { x: -12 + (hash(v.key) % 9), z: 12 + (hash(v.key) % 5), fx: null };
    const pose = { chop: 'chop', dig: 'dig', dig_last: 'dig', berry: 'gather', harvest: 'gather', tend: 'gather', till: 'dig', forage: 'gather' }[L.action] || 'gather';
    const tool = { chop: 'axe', dig: 'pick', dig_last: 'pick', till: 'hoe', berry: 'basket', harvest: 'basket', tend: 'hoe', forage: 'basket' }[L.action] || null;
    const tagEl = document.createElement('div');
    tagEl.className = 'nametag' + (v.hidden ? ' hiddenname' : '');
    tagEl.textContent = v.display;
    tagEl.style.pointerEvents = 'auto';
    tagEl.addEventListener('click', (e) => { e.stopPropagation(); openCard(v); });
    const label = new CSS2DObject(tagEl);
    label.position.set(0, 1.0, 0); // キャラの頭の上（scale 1.9 の中）
    ch.add(label);
    const da = (hash(v.key + 'd') % 360) * Math.PI / 180, dr = 2 + (hash(v.key + 'r') % 30) / 10;
    const myDrop = { x: drop.x + Math.cos(da) * dr, z: drop.z + Math.sin(da) * dr };
    const p = { v, ch, home, work, drop: myDrop, pose, tool, job: L.job, label: tagEl, phase: 0, ri: 0, t: (hash(v.key) % 1000) / 100, pos: { ...home } };
    // 建物・木・岩をよける道（折れ線）を先に作っておく
    p.routes = { 0: routeAround(home, work, obstacles), 2: routeAround(work, myDrop, obstacles), 4: routeAround(myDrop, work, obstacles) };
    // 最初はばらばらの所から
    const start = hash(v.key + 's') % 4;
    p.phase = start === 3 ? 0 : start; p.pos = start === 1 || start === 2 ? { x: work.x, z: work.z } : { ...home };
    ch.position.set(p.pos.x, 0, p.pos.z);
    p.rest = L.action === 'rest'; // ゆうべのケガで休んでいる人は家の前にいる
    if (p.rest) { p.pos = { ...home }; p.phase = 1; p.work = { ...home, fx: null }; p.pose = 'idle'; p.tool = null; }
    people.push(p);
  });

  // ---------- 掘る・切る：ブロックを 1 つずつ壊し、落ちた物を拾って、倉庫の山へ運ぶ ----------
  const fx = makeFx(scene);
  const ITEM_NAME = { cobble: '丸石', coal: '石炭', iron: '鉄鉱石', gold: '金鉱石', diamond: 'ダイヤ', log: '原木', apple: 'りんご', sapling: '苗木' };
  const ITEM_COL = { iron: '#ffc69a', gold: '#ffe25a', diamond: '#7ffff4', coal: '#d0d0d0', apple: '#ff9a92', sapling: '#b8ff9a' };
  const ORE = { c: 'coal', i: 'iron', g: 'gold', d: 'diamond' };
  const RARE = new Set(['iron', 'gold', 'diamond', 'apple', 'sapling']);
  const CHIP_COL = { s: 0x8a8d91, c: 0x3a3a3e, i: 0xd49d74, g: 0xf0cb36, d: 0x45dcd6 };
  const rockPlans = {}, treePlans = {};
  for (const p of people) {
    if (p.rest) continue;
    const L = life[p.v.key] || {};
    const o = L.target && objById[L.target];
    if (!o) continue;
    if (p.tool === 'pick' && o.obj && o.obj.userData.rock) (rockPlans[L.target] = rockPlans[L.target] || { o, miners: [] }).miners.push(p);
    if (p.tool === 'axe' && o.obj && o.obj.userData.tree) (treePlans[L.target] = treePlans[L.target] || { o, cutters: [] }).cutters.push(p);
  }
  for (const id in rockPlans) {
    // 今日掘った分（1 人 2 ブロック）をもどして見せ、そこから 1 つずつ掘る
    const P = rockPlans[id], R = P.o.obj.userData.rock;
    P.shown = Math.min(R.max, Math.max(0, P.o.hp) + 2 * P.miners.length);
    const gone0 = R.max - P.shown;
    P.miners.forEach((p, j) => { p.mine = { kind: 'rock', P, idx: [gone0 + 2 * j, gone0 + 2 * j + 1].filter((i) => i < R.max) }; });
    setRockHp(P.o.obj, P.shown);
  }
  for (const id in treePlans) {
    // 今日切った木は、切る前の姿から下の幹を 1 つずつ切って見せる
    const P = treePlans[id];
    scene.remove(P.o.obj); P.o.obj = makeTree({ ...P.o, state: 'tree' }); scene.add(P.o.obj);
    P.cutters.forEach((p, j) => { p.mine = { kind: 'tree', P, lead: j === 0 }; });
  }
  // 倉庫（なければたき火）の前の山。置くたびに 1 つずつ高くなる
  const piles = {};
  {
    const res = state.resources || {};
    const l = Math.hypot(drop.x, drop.z) || 1, side = { x: -drop.z / l, z: drop.x / l };
    [['log', 'wood', -1.1], ['cobble', 'stone', 1.1]].forEach(([k, rk, s]) => {
      const g = makePile(k); g.position.set(drop.x + side.x * s, 0, drop.z + side.z * s); scene.add(g);
      piles[k] = { g, n: active.length ? Math.min(PILE_MAX - 12, Math.floor((res[rk] || 0) / 25)) : 0, pop: null };
      setPile(g, piles[k].n);
    });
  }
  const wpos = new THREE.Vector3();
  const animOff = (p) => (hash(p.v.key) % 100) / 10;
  function workLen(p) {
    const m = p.mine; if (!m) return 7 + (hash(p.v.key) % 4);
    return m.kind === 'rock' ? breakTime(m.idx.length - 1, DIG) + 1.9 : breakTime(LOGS - 1, CHOP) + 2.1;
  }
  // 今の仕事の時刻（振り下ろしと、ひびが入る時を合わせる）
  function workU(p, time) {
    const m = p.mine, r = m.kind === 'rock' ? DIG.rate : CHOP.rate, at = time + animOff(p);
    if (p.w0 == null) p.w0 = Math.ceil(at * r) / r;
    return at - p.w0;
  }
  // 落ちた物を拾う：壊れてから少しはねて、人の手へ吸いこまれる
  function itemLife(p, kind, o, seed, age, toward, time) {
    if (age < 0) return;
    const head = { x: p.pos.x, y: 2.6, z: p.pos.z };
    if (age < 1.0) {
      const d = dropPos(o, seed, age, toward);
      fx.item(kind, d.x, d.y, d.z, d.rot);
      if (RARE.has(kind)) fx.glow(kind, d.x, d.y + 0.05, d.z, 0.9, time, 1.1);
    } else if (age < 1.3) {
      const d = dropPos(o, seed, 1.0, toward), k = (age - 1.0) / 0.3;
      fx.item(kind, d.x + (p.pos.x - d.x) * k, d.y + (1.4 - d.y) * k + Math.sin(k * Math.PI) * 0.4, d.z + (p.pos.z - d.z) * k, age * 3, 1 - k * 0.5);
    } else if (age < 2.4) {
      const k = (age - 1.3) / 1.1;
      fx.plus('+1 ' + ITEM_NAME[kind], head.x, head.y + k * 1.0, head.z, k < 0.75 ? 1 : (1 - k) * 4, ITEM_COL[kind] || '#fff6c8', 1.4);
      if (RARE.has(kind)) fx.glow(kind, head.x, 1.9, head.z, (1 - k) * 0.8, time, 0.9);
    }
  }
  function updateWork(p, time) {
    const m = p.mine; if (!m || p.mode !== 'day') return;
    if (m.kind === 'rock') {
      const R = m.P.o.obj.userData.rock;
      const mining = p.phase === 1, done = p.phase === 2 || p.phase === 3;
      const u = mining ? workU(p, time) : 0;
      const s = mining ? strikeAt(u, DIG) : null;
      m.idx.forEach((bi, i) => {
        const mesh = R.meshes[bi];
        if (done) { mesh.visible = false; return; }
        if (!mining) { mesh.visible = true; mesh.scale.setScalar(1); setCrack(mesh, -1); return; }
        mesh.getWorldPosition(wpos);
        const o = { x: wpos.x, y: wpos.y, z: wpos.z };
        const dx = p.pos.x - o.x, dz = p.pos.z - o.z, dl = Math.hypot(dx, dz) || 1, dir = { x: dx / dl, z: dz / dl };
        const kind = R.kinds[bi];
        if (i < s.broken) {
          const tb = breakTime(i, DIG), a = u - tb;
          if (a < SHRINK) { mesh.visible = true; mesh.scale.setScalar(1 - 0.28 * (a / SHRINK)); setCrack(mesh, STAGES - 1); }
          else { mesh.visible = false; setCrack(mesh, -1); }
          fx.chips(chipList({ x: o.x + dir.x * B * 0.5, y: o.y, z: o.z + dir.z * B * 0.5 }, dir, p.v.key + 'b' + bi, a, 12), CHIP_COL[kind] || CHIP_COL.s);
          itemLife(p, ORE[kind] || 'cobble', o, p.v.key + bi, a - SHRINK, dir, time);
        } else {
          mesh.visible = true; mesh.scale.setScalar(1);
          if (i === s.broken) {
            setCrack(mesh, s.stage);
            if (s.n) fx.chips(chipList({ x: o.x + dir.x * B * 0.5, y: o.y, z: o.z + dir.z * B * 0.5 }, dir, p.v.key + s.n, s.since), CHIP_COL[kind] || CHIP_COL.s);
          } else setCrack(mesh, -1);
        }
      });
      if (mining) p.carryN = m.idx.filter((bi, i) => u - breakTime(i, DIG) - SHRINK >= 1.3).length;
      return;
    }
    // 木：下の幹から 1 つずつ切る。切ると上が 1 段落ちる。最後は葉が散る
    const g = m.P.o.obj, T = g.userData.tree;
    if (!m.lead) return;
    const mining = p.phase === 1, done = p.phase === 2 || p.phase === 3;
    if (!mining) { setTreeCut(g, done ? LOGS : 0); if (!done) for (const l of T.logs) setCrack(l, -1); return; }
    const u = workU(p, time), s = strikeAt(u, CHOP);
    const n = Math.min(LOGS, s.broken);
    let fall = 0;
    if (n > 0 && n < LOGS) { const a = u - breakTime(n - 1, CHOP); fall = a < 0.24 ? 1 - (a / 0.24) * (a / 0.24) : 0; }
    setTreeCut(g, n, fall);
    T.logs.forEach((l, i) => setCrack(l, i === n && n < LOGS ? s.stage : -1));
    const S = T.size;
    const dx = p.pos.x - g.position.x, dz = p.pos.z - g.position.z, dl = Math.hypot(dx, dz) || 1, dir = { x: dx / dl, z: dz / dl };
    const base = { x: g.position.x, y: (0.3 + LOG / 2) * S, z: g.position.z };
    if (n < LOGS && s.n) fx.chips(chipList({ x: base.x + dir.x * LOG * 0.5 * S, y: base.y, z: base.z + dir.z * LOG * 0.5 * S }, dir, p.v.key + 't' + s.n, s.since), 0x7a5230);
    let got = 0;
    for (let i = 0; i < n; i++) {
      const a = u - breakTime(i, CHOP) - SHRINK;
      itemLife(p, 'log', base, p.v.key + 'log' + i, a, dir, time);
      if (a >= 1.3) got++;
    }
    if (n >= LOGS) { // 葉が散る。たまにりんごか苗木
      const a = u - breakTime(LOGS - 1, CHOP);
      const top = { x: g.position.x, y: (0.3 + LOG * 0.5 + 0.3) * S, z: g.position.z };
      for (let k = 0; k < 3; k++) fx.chips(chipList(top, { x: (k - 1) * 0.6, z: 0.3 }, p.v.key + 'leaf' + k, a * 0.8, 10).map((q) => ({ ...q, s: q.s * 2.2 })), new THREE.Color(T.leafCol).getHex());
      const bonus = hash(p.v.key + state.day) % 6 === 0 ? 'apple' : hash(p.v.key + state.day) % 9 === 1 ? 'sapling' : null;
      if (bonus) { itemLife(p, bonus, top, p.v.key + bonus, a - 0.2, dir, time); if (a - 0.2 >= 1.3) got++; }
    }
    p.carryN = got;
  }
  function depositFx(p, time) {
    const m = p.mine; if (!m || !p.carryN) return;
    const pile = piles[m.kind === 'rock' ? 'cobble' : 'log'];
    pile.n = Math.min(PILE_MAX, pile.n + p.carryN);
    if (pile.n >= PILE_MAX) pile.n = PILE_MAX - 9; // いっぱいになったら倉庫へしまった分だけ減る
    setPile(pile.g, pile.n);
    pile.pop = { t: time, text: '+' + p.carryN };
    p.carryN = 0;
  }
  function updatePiles(time) {
    for (const k in piles) {
      const P = piles[k]; if (!P.pop) continue;
      const a = time - P.pop.t; if (a > 1.4) { P.pop = null; continue; }
      fx.plus(P.pop.text, P.g.position.x, 2.2 + a * 0.8, P.g.position.z, a < 1 ? 1 : (1.4 - a) / 0.4, '#fff6c8', 1.4);
    }
  }

  // ---------- 夜：見張りと、森の外から来る敵（sim.js で決まった最新の夜） ----------
  const N = state.night && state.night.day >= state.day - 1 ? state.night : null;
  const from = N && N.from ? N.from : { x: 0, z: -52 };
  const fl = Math.hypot(from.x, from.z) || 1, fdir = { x: from.x / fl, z: from.z / fl }, fside = { x: -fdir.z, z: fdir.x };
  const guardKeys = new Set(((N && N.guards) || []).filter((k) => people.some((p) => p.v.key === k)));
  if (!guardKeys.size && people.length) people.filter((p) => !p.rest).slice(0, Math.min(2, people.length)).forEach((p) => guardKeys.add(p.v.key));
  // 柵・石壁があれば、見張りはその内側に立ち、敵はその外で止められる
  const ringR = world.buildings.some((b) => b.type === 'wall') ? 33.5 : world.buildings.some((b) => b.type === 'fence') ? 31.5 : null;
  const fa = Math.atan2(fdir.z, fdir.x);
  const onRing = (r, s) => { const a = fa + s / r; return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.92 - 1 }; };
  const postR = ringR ? ringR - 2.4 : 24, mobR = ringR ? ringR + 1.8 : 26.4;
  let gi = 0;
  for (const p of people) {
    p.mode = 'day';
    if (!guardKeys.has(p.v.key)) continue;
    // 見張りの場所：敵が来る向きの、町のはずれ（柵の内側）
    const s = (gi % 2 ? 1 : -1) * Math.ceil(gi / 2) * 2.6; gi++;
    p.guard = pushOutPt(onRing(postR, s)); p.guardS = s;
  }
  function pushOutPt(pt) { for (const o of obstacles) { const d = Math.hypot(pt.x - o.x, pt.z - o.z); if (d < o.r + 0.6) { const k = (o.r + 0.8) / (d || 1); pt.x = o.x + (pt.x - o.x) * k; pt.z = o.z + (pt.z - o.z) * k; } } return pt; }
  const guards = people.filter((p) => p.guard);
  const mobs = [];
  if (N && !N.quiet) {
    let i = 0;
    for (const g of N.groups || []) for (let k = 0; k < g.n; k++, i++) {
      const m = makeMob(g.type); m.visible = false; scene.add(m);
      const target = guards.length ? guards[i % guards.length] : null;
      const arrows = g.type === 'skeleton' ? [0, 1, 2].map(() => { const a = makeArrow(); a.scale.setScalar(1.6); a.visible = false; scene.add(a); return a; }) : null;
      mobs.push({ m, type: g.type, i, target, off: i * 3.1, side: (i % 3 - 1) * 3.2, arrows });
    }
  }
  Object.assign(window.TOWN, { mobs, people }); // 確かめ用
  const MOB_CYCLE = 34; // 近づく → 戦う → 逃げる を、夜の間くり返して見せる
  function updateMobs(time, n, h) {
    const nightOn = n > 0.55, dawn = h < 12 && n > 0.15 && n <= 0.55;
    for (const mb of mobs) {
      const { m } = mb;
      if (!nightOn && !dawn) { m.visible = false; continue; }
      const start = { x: from.x * 0.85 + fside.x * mb.side, z: from.z * 0.85 + fside.z * mb.side };
      const archer = mb.type === 'skeleton';
      const goal = onRing(archer ? mobR + 9 : mobR, (mb.target ? mb.target.guardS : 0) + (mb.i % 2 ? 1.3 : -1.3));
      const L = Math.hypot(goal.x - start.x, goal.z - start.z);
      const sp = mb.type === 'spider' ? 2.6 : mb.type === 'skeleton' ? 1.9 : 1.4;
      const tw = L / sp, tf = archer ? 6.6 : 4.5, SHOT = 2.2;
      if (mb.arrows) for (const a of mb.arrows) a.visible = false;
      mb.shoot = false;
      if (dawn) { // 朝日：ゾンビは燃え、ほかは森へ帰る
        const k = Math.min(1, (0.55 - n) / 0.3);
        if (mb.type === 'zombie') { m.position.set(goal.x, 0, goal.z); animateMob(m, 'burn', time, k); m.visible = k < 1; }
        else { const q = Math.min(1, k * 1.2); m.position.set(goal.x + (start.x - goal.x) * q, 0, goal.z + (start.z - goal.z) * q); m.rotation.y = Math.atan2(start.x - goal.x, start.z - goal.z); animateMob(m, 'flee', time); m.visible = q < 1; }
        continue;
      }
      m.scale.setScalar(1.7); m.position.y = 0;
      const u = (time + mb.off) % MOB_CYCLE;
      mb.fight = false;
      if (u < tw) { const k = u / tw; m.position.set(start.x + (goal.x - start.x) * k, 0, start.z + (goal.z - start.z) * k); m.rotation.y = Math.atan2(goal.x - start.x, goal.z - start.z); animateMob(m, 'walk', time); }
      else if (u < tw + tf && archer) {
        const k = ((u - tw) % SHOT) / SHOT;
        m.position.set(goal.x, 0, goal.z);
        const tg = mb.target ? mb.target.pos : { x: 0, z: 0 };
        m.rotation.y = Math.atan2(tg.x - goal.x, tg.z - goal.z);
        animateMob(m, 'shoot', time, k); mb.shoot = true;
      }
      else if (u < tw + tf) { const k = ((u - tw) % 1.5) / 1.5; m.position.set(goal.x, 0, goal.z); animateMob(m, 'hit', time, k); mb.fight = true; }
      else { const k = Math.min(1, (u - tw - tf) / (tw * 0.6)); if (archer) mb.shoot = false; m.position.set(goal.x + (start.x - goal.x) * k, 0, goal.z + (start.z - goal.z) * k); m.rotation.y = Math.atan2(start.x - goal.x, start.z - goal.z); animateMob(m, 'flee', time); if (k >= 1) m.visible = false; }
    }
  }
  function updateArrows(time, n) {
    if (n <= 0.55) return;
    for (const mb of mobs) {
      if (!mb.arrows) continue;
      const start = { x: from.x * 0.85 + fside.x * mb.side, z: from.z * 0.85 + fside.z * mb.side };
      const goal = onRing(mobR + 9, (mb.target ? mb.target.guardS : 0) + (mb.i % 2 ? 1.3 : -1.3));
      const tw = Math.hypot(goal.x - start.x, goal.z - start.z) / 1.9, u = (time + mb.off) % MOB_CYCLE;
      const tg = mb.target ? mb.target.guard || mb.target.pos : { x: 0, z: 0 };
      mb.arrows.forEach((a, j) => {
        const rel = u - tw - j * 2.2 - 0.6 * 2.2; // 弦を放った時から
        if (rel < 0 || u > tw + 6.6 + tw * 0.6) return;
        const dx = goal.x - tg.x, dz = goal.z - tg.z, dl = Math.hypot(dx, dz) || 1;
        // 柵があれば柵の横木に、なければ見張りの少し手前の地面に刺さる
        const to = ringR ? { ...onRing(ringR, (mb.target ? mb.target.guardS : 0) + (j - 1) * 1.1), y: 0.95 } : { x: tg.x + (dx / dl) * (1.6 + j * 0.7) + (j - 1) * 0.8 * (-dz / dl), y: 0.12, z: tg.z + (dz / dl) * (1.6 + j * 0.7) + (j - 1) * 0.8 * (dx / dl) };
        const fr = { x: goal.x - (dx / dl) * 0.6, y: 2.6, z: goal.z - (dz / dl) * 0.6 };
        a.visible = true;
        arrowAt(a, fr, to, rel / 0.5, 1.4);
      });
    }
  }
  // 昼 → 夜：見張り以外は家（テント）へ帰って寝る。夜 → 朝：家から出て仕事へ
  let wasNight = null;
  function switchMode(night) {
    for (const p of people) {
      if (night) {
        p.talk = null; p.bubble.hidden = true;
        if (p.guard) { p.mode = 'toguard'; p.routes.night = routeAround(p.pos, p.guard, obstacles); }
        else { p.mode = 'gohome'; p.routes.night = routeAround(p.pos, p.home, obstacles); }
        p.ri = 0;
      } else {
        p.mode = 'day'; p.ch.visible = true; setShield(p.ch, false); p.ch.userData.block = false;
        if (!p.rest) { p.pos = { ...p.home }; p.phase = 0; p.ri = 0; }
      }
    }
    for (const tk of talks) tk.on = false;
  }

  // ---------- 今日の立ち話（sim.js で決まった組と言葉） ----------
  const byKey = Object.fromEntries(people.map((p) => [p.v.key, p]));
  const pushOut = (pt) => { for (const o of obstacles) { const d = Math.hypot(pt.x - o.x, pt.z - o.z); if (d < o.r + 0.6) { const k = (o.r + 0.7) / (d || 1); pt.x = o.x + (pt.x - o.x) * k; pt.z = o.z + (pt.z - o.z) * k; } } return pt; };
  const talks = (D.social.talks || []).filter((t) => t.day === state.day && byKey[t.a] && byKey[t.b]).map((t, i) => ({ ...t, A: byKey[t.a], B: byKey[t.b], next: 2 + i * 7 + (hash(t.a) % 4), on: false }));
  for (const p of people) {
    const el = document.createElement('div'); el.className = 'bubble'; el.hidden = true;
    const o = new CSS2DObject(el); o.position.set(0, 1.32, 0); p.ch.add(o); p.bubble = el;
  }
  function startTalk(tk, time) {
    const m = pushOut({ x: (tk.A.pos.x + tk.B.pos.x) / 2, z: (tk.A.pos.z + tk.B.pos.z) / 2 });
    const dx = tk.B.pos.x - tk.A.pos.x, dz = tk.B.pos.z - tk.A.pos.z, d = Math.hypot(dx, dz) || 1;
    const spotA = pushOut({ x: m.x - (dx / d) * 0.85, z: m.z - (dz / d) * 0.85 }), spotB = pushOut({ x: m.x + (dx / d) * 0.85, z: m.z + (dz / d) * 0.85 });
    for (const [p, s, other] of [[tk.A, spotA, tk.B], [tk.B, spotB, tk.A]]) { p.w0 = null; p.phase = 5; p.ri = 0; p.routes.talk = routeAround(p.pos, s, obstacles); p.talk = tk; p.other = other; }
    tk.on = true; tk.t0 = null;
  }
  const free = (p) => p.phase === 1 || p.phase === 3 || p.phase === 4;
  function updateTalks(time) {
    for (const tk of talks) {
      if (!tk.on) { if (time > tk.next && free(tk.A) && free(tk.B)) startTalk(tk, time); continue; }
      if (tk.t0 === null) { if (tk.A.phase === 6 && tk.B.phase === 6) tk.t0 = time; else continue; }
      const k = Math.floor((time - tk.t0) / 2.6);
      for (const p of [tk.A, tk.B]) p.bubble.hidden = true;
      if (k < tk.lines.length) { const [w, s] = tk.lines[k]; const p = byKey[w]; p.bubble.textContent = s; p.bubble.hidden = false; }
      else {
        for (const p of [tk.A, tk.B]) { p.phase = 7; p.ri = 0; p.routes.back = routeAround(p.pos, p.work, obstacles); p.talk = null; }
        tk.on = false; tk.next = time + 30 + (hash(tk.a + tk.b) % 20);
      }
    }
  }
  // 誕生日の人：名札に印、家の前にケーキと旗
  for (const k of (state.today && state.today.birthdays) || []) {
    const p = byKey[k]; if (!p) continue;
    p.label.classList.add('bday'); p.label.textContent = '誕生日 ' + p.v.display;
    const g = new THREE.Group();
    box(0.9, 0.45, 0.9, 0xfaf3e8, 0, 0.6, 0, g); box(0.92, 0.1, 0.92, 0xd9506a, 0, 0.86, 0, g); box(0.08, 0.25, 0.08, 0xfff1a8, 0, 1.03, 0, g);
    box(1.2, 0.55, 1.0, 0x9b6b3d, 0, 0.27, 0, g);
    for (const s of [-1.6, 1.6]) box(0.1, 2.2, 0.1, 0x8a5a33, s, 1.1, -0.6, g);
    for (let i = 0; i < 7; i++) box(0.3, 0.3, 0.05, [0xd9506a, 0xe2c04e, 0x4b9a5e, 0x3f78b8][i % 4], -1.35 + i * 0.45, 1.9 - Math.sin((i / 6) * Math.PI) * 0.3, -0.6, g).rotation.z = Math.PI / 4;
    const at = pushOut({ x: p.home.x + 1.2, z: p.home.z + 0.4 });
    g.position.set(at.x, 0, at.z); g.rotation.y = Math.atan2(-at.x, -(at.z + 1)); scene.add(g);
  }

  // 0:家→仕事場 1:仕事 2:仕事場→置き場 3:置く 4:置き場→仕事場 5:立ち話へ 6:立ち話 7:仕事場へもどる
  const SPEED = 2.4;
  function walkTo(p, route, dt) {
    let left = SPEED * dt;
    while (left > 0 && p.ri < route.length) {
      const target = route[p.ri];
      const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { p.ri++; continue; }
      const s = Math.min(d, left);
      p.pos.x += (dx / d) * s; p.pos.z += (dz / d) * s; left -= s;
      p.ch.rotation.y = Math.atan2(dx, dz);
      if (s >= d) p.ri++;
    }
    if (p.ri >= route.length) { p.ri = 0; return true; }
    return false;
  }
  function updatePerson(p, dt, time) {
    p.t += dt;
    let pose = 'idle';
    if (p.mode === 'gohome' || p.mode === 'sleep') {
      setTool(p.ch, null); setCarry(p.ch, null);
      if (p.mode === 'gohome') { pose = 'walk'; if (walkTo(p, p.routes.night, dt)) { p.mode = 'sleep'; } }
      p.ch.visible = p.mode !== 'sleep'; // 家の中で寝ている
      p.ch.position.set(p.pos.x, 0, p.pos.z);
      animate(p.ch, pose, time + (hash(p.v.key) % 100) / 10);
      return;
    }
    if (p.mode === 'toguard' || p.mode === 'guard') {
      setTool(p.ch, 'torch'); setCarry(p.ch, null); setShield(p.ch, true);
      p.ch.userData.block = mobs.some((mb) => mb.shoot && mb.target === p); // 矢が来たら盾を上げる
      if (p.mode === 'toguard') { pose = 'walk'; if (walkTo(p, p.routes.night, dt)) p.mode = 'guard'; }
      else {
        p.ch.rotation.y = Math.atan2(fdir.x, fdir.z); // 森の方を見張る
        pose = mobs.some((mb) => mb.fight && mb.target === p) ? 'chop' : 'idle'; // 敵が来たらたいまつを振って追い払う
      }
      p.ch.position.set(p.pos.x, 0, p.pos.z);
      animate(p.ch, pose, time + (hash(p.v.key) % 100) / 10);
      return;
    }
    if (p.rest) { setTool(p.ch, null); setCarry(p.ch, null); p.ch.position.set(p.pos.x, 0, p.pos.z); animate(p.ch, 'idle', time + (hash(p.v.key) % 100) / 10); return; }
    if (p.phase === 0 || p.phase === 4) {
      setTool(p.ch, p.tool); setCarry(p.ch, null);
      pose = 'walk';
      if (walkTo(p, p.routes[p.phase], dt)) { p.phase = 1; p.t = 0; }
    } else if (p.phase === 1) {
      setTool(p.ch, p.tool); setCarry(p.ch, null);
      pose = p.pose;
      if (p.work.fx !== null) p.ch.rotation.y = Math.atan2(p.work.fx - p.pos.x, p.work.fz - p.pos.z);
      if (p.mine ? workU(p, time) > workLen(p) : p.t > workLen(p)) { p.phase = 2; p.t = 0; p.w0 = null; }
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
      pose = p.bubble.hidden ? 'idle' : 'talk';
      p.ch.rotation.y = Math.atan2(p.other.pos.x - p.pos.x, p.other.pos.z - p.pos.z);
    } else if (p.phase === 7) {
      setTool(p.ch, p.tool); pose = 'walk';
      if (walkTo(p, p.routes.back, dt)) { p.phase = 1; p.t = 0; }
    }
    p.ch.position.set(p.pos.x, 0, p.pos.z);
    animate(p.ch, pose, time + (hash(p.v.key) % 100) / 10);
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
    else closeCard();
  });

  // ---------- 大きさ ----------
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h); labels.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  // ---------- 回す ----------
  const clock = new THREE.Clock();
  let puffT = 0;
  const tmp = new THREE.Vector3();
  let frame = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const time = clock.elapsedTime;
    if ((frame & 15) === 0) {
      const h = hourNow();
      sky.set(h, { x: controls.target.x, z: controls.target.z });
      const night = sky.n > 0.6;
      if (night !== wasNight) {
        if (wasNight !== null || night) switchMode(night);
        if (wasNight === null && night) for (const p of people) { p.mode = p.guard ? 'guard' : 'sleep'; p.pos = { ...(p.guard || p.home) }; } // 開いた時がもう夜なら、はじめから寝ている
        wasNight = night;
      }
      sky.placeLights(camera.position);
      if ((frame & 1023) === 0) renderClock(h);
    }
    updateMobs(time, sky.n, sky.h);
    updateArrows(time, sky.n);
    if (!wasNight) updateTalks(time);
    fx.begin();
    for (const p of people) updatePerson(p, dt, time);
    for (const p of people) updateWork(p, time);
    updatePiles(time);
    fx.end();
    for (const b of anim.blades) b.rotation.z += dt * 0.8;
    for (const b of anim.boats) { b.position.y = 0.05 + Math.sin(time * 1.5) * 0.06; b.rotation.z = Math.sin(time * 1.2) * 0.04; }
    anim.cows.forEach((c, i) => { c.rotation.y += Math.sin(time * 0.3 + i) * 0.004; });
    for (const h of anim.hands) h.rotation.z = -time * 0.2;
    for (const p of guards) { const f = p.ch.userData.parts.tool && p.ch.userData.parts.tool.userData.flame; if (f) f[0].scale.y = 0.8 + Math.sin(time * 14 + p.t) * 0.25; }
    if (anim.flame) { anim.flame.scale.y = 0.8 + Math.sin(time * 12) * 0.2; }
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
      const dd = camera.position.distanceTo(p.ch.getWorldPosition(tmp));
      p._far = dd > 120;
      p.label.style.opacity = p._far || p._hidden || !p.ch.visible ? '0' : dd > 80 ? '0.6' : '1';
      if (!p.ch.visible) p.bubble.hidden = true; // 家の中で寝ている人の札は出さない（CSS2D は親が見えなくても出るため）
      p.label.style.fontSize = dd > 70 ? '10px' : '11px';
    }
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
      bt.element.style.opacity = dd > 75 && !bt.element.classList.contains('new') ? '0' : '1';
    }
    // 見る場所が町の外へ行きすぎないように
    controls.target.x = Math.max(-100, Math.min(100, controls.target.x));
    controls.target.z = Math.max(-100, Math.min(38, controls.target.z));
    controls.target.y = 0;
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
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
    card.hidden = false;
    card.innerHTML = '';
    const face = await faceCanvas(v.skin, 48);
    face.className = 'face pixel';
    const who = document.createElement('div');
    who.className = 'who';
    who.innerHTML = `<b>${esc(v.display)}</b><span class="muted">${esc(ACTION[L.action] || JOB[L.job] || '')}・${esc(homeName(L, world, config))}</span><span class="lvline">Lv${L.level || 1}・枠 ${L.slots || config.inventory.base}/${config.inventory.max}</span>`;
    const a = document.createElement('a');
    a.className = 'btn'; a.href = villagerUrl(v); a.textContent = 'くわしく';
    const x = document.createElement('button');
    x.className = 'close'; x.setAttribute('aria-label', '閉じる'); x.textContent = '×';
    x.onclick = closeCard;
    card.append(face, who, a, x);
  }
  function closeCard() { card.hidden = true; }
}

function renderPanel(D) {
  const { state, history, active, life, config, world } = D;
  const hud = document.getElementById('hud');
  hud.innerHTML = `<span class="chip day">${state.day}日目</span><span class="chip" id="clockchip"></span><span class="chip">${esc(state.weather)}</span>` +
    ['wood', 'stone', 'food'].map((r) => `<span class="chip"><i class="dot" style="background:${RES_COLOR[r]}"></i>${RES[r]} <b>${state.resources[r]}</b></span>`).join('') +
    `<span class="chip">村人 <b>${active.length}</b></span>`;
  document.getElementById('dayline').textContent = `${fmtDate(state.date)}（${state.day}日目）`;
  const t = state.today || { jobs: {}, built: [] };
  const builtNames = (t.built || []).map((id) => { const b = world.buildings.find((x) => x.id === id); return b ? config.buildings[b.type].name : ''; }).filter(Boolean);
  document.getElementById('today').innerHTML =
    `<li>木を切った人 ${t.jobs.wood || 0} 人・岩を掘った人 ${t.jobs.stone || 0} 人・食べ物を集めた人 ${t.jobs.food || 0} 人</li>` +
    (builtNames.length ? `<li>${esc(builtNames.join('、'))}ができた</li>` : '') +
    history.slice(-5).reverse().map((h) => `<li><span class="muted">${h.day}日目</span> ${esc(h.text)}</li>`).join('');
  const next = state.queue && state.queue[0];
  if (next) {
    const c = config.buildings[next].cost;
    document.getElementById('next').innerHTML = `<b>${esc(config.buildings[next].name)}</b>（` +
      Object.entries(c).map(([r, n]) => `${RES[r]} ${Math.min(state.resources[r], n)}/${n}`).join('・') + '）';
  }
  const vote = state.vote;
  const nextMs = config.milestones.find((m) => !state.reached.includes(m.at));
  document.getElementById('votebox').innerHTML = vote
    ? `<b>投票中</b>：フォロワー ${vote.milestone} 人の節目。${vote.options.map((o) => esc(o.key + ' ' + o.name)).join(' / ')} <a href="vote.html">票を見る</a>`
    : nextMs ? `次の投票はフォロワー <b>${nextMs.at}</b> 人で開きます（今 ${state.followers} 人）。<a href="vote.html">くわしく</a>` : 'すべての節目に届きました。';
  document.getElementById('join').innerHTML = `インスタの投稿に「<b>${esc(config.joinWord)}</b>」とコメントすると、次の日から村人になります。`;
}

main().catch(showError);
