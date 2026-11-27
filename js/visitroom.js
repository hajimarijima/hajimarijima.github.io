// 遊びに行った家の中（町の画面の上に開く）。自分の村人がマス目の上を歩き回り、いすに座る・本だなを見るなどの小さな動きをする。
//   帰る時に「来た人ノート」の一言を選ぶ。openRoom(...) は選んだ一言の番号（書かない時は null）で終わる Promise を返す
//   ・歩く時は、必ず進む向きへ体を回してから進む（後ろ歩き・横歩きはしない）
//   ・いすに座る時は、前のマスで向きを変えてから、腰を下ろしながら少し下がる。脚は前へまっすぐ（座面より上）、背中は背もたれの手前（体が入らない）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeCharacter, animate, chibiOf } from './character.js';
import { esc, skinSrc, skinSlim } from './common.js';
import { icon } from './icons.js';
import { buildRoom } from './decor3d.js';
import { ROOM_ACTS, NOTE_WORDS, roomGrid, roomPath, standCell, seatOf, cellPos, cellAt, SEAT } from './visits.js';
import { notebookHtml, addNoteFaces } from './visitlink.js';

const SPEED = 1.5, TURN = 7, PX = 1 / 16;
const angTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function openRoom({ me, hostName, look, list, seed = '', notes = [], byKey = {} }) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'vroom'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', hostName + 'さんの家の中');
    const R = roomGrid(look, list);
    const kinds = [...new Set(R.items.map((it) => it.id))].filter((id) => ROOM_ACTS[id]);
    box.innerHTML = `<div class="vr-top"><b>${esc(hostName)}さんの家</b><span>床を押すと歩きます。家具を押すと、さわってみます</span></div>` +
      '<div class="vr-view"></div><div class="vr-bubble" hidden></div>' +
      `<div class="vr-acts">${kinds.map((id) => `<button type="button" class="btn sub" data-act="${id}">${esc(id === 'lamp' ? 'ランプ' : ROOM_ACTS[id].label)}</button>`).join('')}<button type="button" class="btn vr-leave">${icon('door-open', { size: 18 })}<span>帰る</span></button></div>` +
      '<div class="vr-sheet" hidden><div class="vr-card card"><h2>来た人ノートに一言</h2>' +
      `<div class="vr-notes">${notebookHtml(notes, byKey, { max: 3, empty: 'まだだれも書いていません。最初の一言を残そう。' })}</div>` +
      `<div class="vr-words">${NOTE_WORDS.map((w, i) => `<button type="button" class="vr-word" data-n="${i}">${esc(w)}</button>`).join('')}</div>` +
      '<div class="vr-sbtns"><button type="button" class="btn sub" data-n="-1">書かずに帰る</button><button type="button" class="btn sub" data-back>もう少しいる</button></div></div></div>';
    document.body.append(box);
    addNoteFaces(box, byKey);
    document.documentElement.classList.add('vroom-open');
    const view = box.querySelector('.vr-view'), bubble = box.querySelector('.vr-bubble');

    // ---------- 3D ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x2b2f3a);
    view.append(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x5a4a3a, 1.05));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.5); sun.position.set(4, 8, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); sun.shadow.bias = -0.0008;
    scene.add(sun);
    const room = new THREE.Group(); scene.add(room);
    const objs = buildRoom(room, look, list, seed);
    room.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    objs.forEach((o, k) => { o.userData.item = R.items[k]; });
    // ランプのあかり（押すとつく）
    const lamps = objs.filter((o) => o.userData.decor === 'lamp').map((o) => { const L = new THREE.PointLight(0xffd28a, 0, 4.5, 1.6); const p = o.userData.light; L.position.set(p.x, p.y, p.z); o.add(L); return L; });
    const ch = makeCharacter(skinSrc(me), { slim: skinSlim(me), chibi: chibiOf(me) });
    ch.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(ch);
    const d0 = cellPos(R, R.door[0], R.door[1]);
    const S = { x: d0.x, z: d0.z + 0.2, yaw: Math.PI, pose: 'idle', pts: [], then: null, sit: 0, seat: null, act: null, actT: 0, t: 0 };
    ch.position.set(S.x, 0, S.z); ch.rotation.y = S.yaw;
    const orbit = new OrbitControls(cam, renderer.domElement);
    orbit.enablePan = false; orbit.enableDamping = true; orbit.minPolarAngle = 0.45; orbit.maxPolarAngle = 1.2; orbit.minAzimuthAngle = -0.15; orbit.maxAzimuthAngle = 1.25;
    orbit.minDistance = 4; orbit.maxDistance = 11;
    const w = look.w || 4, d = look.d || 3.4;
    cam.position.set(w * 0.6, 3.4 + d * 0.3, d * 1.2 + 2.6); orbit.target.set(0, 0.8, 0); orbit.update();
    const size = () => { const W = view.clientWidth || 300, H = view.clientHeight || 300; renderer.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); const far = Math.max(1, 0.9 / Math.min(1, cam.aspect)); cam.position.sub(orbit.target).setLength(Math.min(orbit.maxDistance, 6.2 * far)).add(orbit.target); };
    const ro = new ResizeObserver(size); ro.observe(view); size();

    // ---------- 何かをする時のカメラ：その人の全身と、まわりの家具・部屋が入るように、少し引いて高めから ----------
    let camGo = null;
    const sph = new THREE.Spherical();
    function frameMe() {
      // 見る所は、その人と部屋のまん中の間（部屋の様子も入る）。向きは、その人の顔の側から（回せる範囲の中で）
      const tgt = new THREE.Vector3(S.x * 0.65, 0.85, S.z * 0.65);
      const az = Math.max(orbit.minAzimuthAngle, Math.min(orbit.maxAzimuthAngle, angTo(0, S.yaw) * 0.7 + 0.2));
      const dist = Math.min(orbit.maxDistance, Math.max(7, 4.6 / Math.min(1, cam.aspect))); // たて長の画面は横がせまいので、もっと引く
      const pos = new THREE.Vector3().setFromSpherical(new THREE.Spherical(dist, 0.98, az)).add(tgt);
      camGo = { t: 0, p0: cam.position.clone(), t0: orbit.target.clone(), p1: pos, t1: tgt };
    }
    function camStep(dt) {
      if (!camGo) return;
      camGo.t = Math.min(1, camGo.t + dt / 0.8);
      const e = camGo.t * camGo.t * (3 - 2 * camGo.t);
      cam.position.lerpVectors(camGo.p0, camGo.p1, e); orbit.target.lerpVectors(camGo.t0, camGo.t1, e);
      if (camGo.t >= 1) camGo = null;
    }
    renderer.domElement.addEventListener('pointerdown', () => { camGo = null; }); // 自分で回し始めたら、合わせるのをやめる

    // ---------- 言う ----------
    let sayT = 0;
    const say = (t) => { bubble.textContent = t; bubble.hidden = false; sayT = 3.2; };
    const headV = new THREE.Vector3();
    const placeBubble = () => {
      headV.set(S.x, 2.25 - (S.sit ? 0.1 : 0), S.z).project(cam);
      const r = view.getBoundingClientRect();
      const bw = Math.min(r.width - 16, bubble.offsetWidth || 160) / 2 + 8; // 画面の外へはみ出さない
      bubble.style.left = r.left + Math.max(bw, Math.min(r.width - bw, (headV.x * 0.5 + 0.5) * r.width)) + 'px';
      bubble.style.top = r.top + Math.max(bubble.offsetHeight + 14, (-headV.y * 0.5 + 0.5) * r.height - 8) + 'px';
    };

    // ---------- 歩く・座る ----------
    const here = () => cellAt(R, S.x, S.z);
    // 立ち上がってから次のことをする
    const standUp = (next) => { if (S.seat) { S.then = null; S.act = { kind: 'stand', next }; S.actT = 0; } else next(); };
    function goCells(cells, extra, then) {
      S.pts = cells.slice(1).map(([i, j]) => cellPos(R, i, j)).concat(extra || []);
      S.then = then || null; S.act = null;
    }
    function walkTo(cell, then) {
      standUp(() => {
        const p = roomPath(R, here(), cell);
        if (!p) { say('そこへは行けないみたい。'); return; }
        goCells(p, [], then);
      });
    }
    function faceAnd(item, after) {
      const want = Math.atan2(item.x - S.x, item.z - S.z);
      S.act = { kind: 'turn', yaw: want, next: after };
    }
    function doItem(item) {
      const A = ROOM_ACTS[item.id];
      if (!A) return;
      if (item.id === 'chair') {
        const st = seatOf(R, item);
        if (!st.ok) { say('いすの前がふさがっていて、座れないみたい。'); return; }
        standUp(() => {
          const p = roomPath(R, here(), st.front);
          if (!p) { say('いすのところへ行けないみたい。'); return; }
          const s = Math.sin(item.yaw), c = Math.cos(item.yaw);
          const near = { x: item.x + s * 0.56, z: item.z + c * 0.56 };
          goCells(p, [near], () => { S.act = { kind: 'turn', yaw: item.yaw, next: () => { S.act = { kind: 'sit', from: { x: S.x, z: S.z }, to: st }; S.actT = 0; } }; });
        });
        return;
      }
      standUp(() => {
        const sc = standCell(R, item, here());
        const after = () => faceAnd(item, () => {
          const t = Array.isArray(A.say) ? A.say[Math.floor(Math.random() * A.say.length)] : A.say;
          if (item.id === 'lamp') { const on = !(lamps[0] && lamps[0].intensity > 0); for (const L of lamps) L.intensity = on ? 1.8 : 0; say(on ? 'あかりがともった。' : 'あかりを消した。'); }
          else say(t);
          S.act = { kind: 'pose', pose: item.id, until: 3 }; S.actT = 0; frameMe();
        });
        if (!sc) { after(); return; }
        goCells(sc.path, [], after);
      });
    }
    box.querySelector('.vr-acts').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('vr-leave')) { box.querySelector('.vr-sheet').hidden = false; return; }
      const id = b.dataset.act, cand = R.items.filter((it) => it.id === id);
      if (!cand.length) return;
      // いちばん近いもの（いすは座れるものを先に）
      cand.sort((a, c) => (id === 'chair' ? (seatOf(R, c).ok - seatOf(R, a).ok) : 0) || (Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(c.x - S.x, c.z - S.z)));
      doItem(cand[0]);
    });
    // 押す（ドラッグで回すのとは分ける）
    const ray = new THREE.Raycaster(), mv = new THREE.Vector2();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      mv.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mv, cam);
      const hit = ray.intersectObjects(room.children, true)[0];
      if (!hit) return;
      let o = hit.object; while (o && !o.userData.item && o.parent !== room) o = o.parent;
      if (o && o.userData.item && o.userData.item.id !== 'rug') { doItem(o.userData.item); return; }
      const c = cellAt(R, hit.point.x, hit.point.z);
      if (R.free.has(c.join(','))) walkTo(c);
    });

    // ---------- 1 コマ ----------
    const clock = new THREE.Clock();
    function step(dt) {
      S.t += dt;
      let pose = 'idle';
      if (S.pts.length) {
        const p = S.pts[0], dx = p.x - S.x, dz = p.z - S.z, dd = Math.hypot(dx, dz);
        if (dd < 0.02) { S.pts.shift(); if (!S.pts.length && S.then) { const f = S.then; S.then = null; f(); } }
        else {
          const want = Math.atan2(dx, dz), da = angTo(S.yaw, want);
          S.yaw += Math.max(-TURN * dt, Math.min(TURN * dt, da));
          if (Math.abs(da) < 0.35) { const s = Math.min(dd, SPEED * dt); S.x += (dx / dd) * s; S.z += (dz / dd) * s; }
          pose = 'walk';
        }
      } else if (S.act && S.act.kind === 'turn') {
        const da = angTo(S.yaw, S.act.yaw);
        S.yaw += Math.max(-TURN * dt, Math.min(TURN * dt, da));
        if (Math.abs(da) < 0.03) { S.yaw = S.act.yaw; const f = S.act.next; S.act = null; f && f(); }
      } else if (S.act && S.act.kind === 'sit') {
        S.actT += dt;
        const k = Math.min(1, S.actT / 0.9), a = Math.min(1, k * 2), b = Math.max(0, k * 2 - 1);
        // 前半：その場で腰を落として脚を前へ。後半：脚を上げたまま、座面の上へ下がる
        S.sit = a; const e = b * b * (3 - 2 * b);
        S.x = S.act.from.x + (S.act.to.x - S.act.from.x) * e; S.z = S.act.from.z + (S.act.to.z - S.act.from.z) * e;
        if (k >= 1) { S.seat = S.act.to; S.act = null; say(ROOM_ACTS.chair.say); frameMe(); } // 座ったところで、全身といすが入るように
      } else if (S.act && S.act.kind === 'stand') {
        S.actT += dt;
        const st = S.seat, s = Math.sin(st.yaw), c = Math.cos(st.yaw), k = Math.min(1, S.actT / 0.8), a = Math.min(1, k * 2), b = Math.max(0, k * 2 - 1);
        const from = { x: st.x, z: st.z }, to = { x: st.x + s * (0.56 - SEAT.fwd), z: st.z + c * (0.56 - SEAT.fwd) }, e = a * a * (3 - 2 * a);
        S.x = from.x + (to.x - from.x) * e; S.z = from.z + (to.z - from.z) * e; S.sit = 1 - b;
        if (k >= 1) { S.seat = null; S.sit = 0; const n = S.act.next; S.act = null; const f = cellPos(R, ...st.front); S.pts = [f]; S.then = n; }
      } else if (S.act && S.act.kind === 'pose') {
        S.actT += dt; pose = S.act.pose;
        if (S.actT > S.act.until) S.act = null;
      }
      ch.position.set(S.x, 0, S.z); ch.rotation.y = S.yaw;
      const P = ch.userData.parts;
      animate(ch, pose === 'walk' ? 'walk' : pose === 'plant' ? 'water' : (pose === 'lamp' || pose === 'desk' || pose === 'bed') ? 'talk' : 'idle', S.t);
      if (pose === 'shelf') { P.rarm.rotation.set(-1.0, 0, 0.25); P.larm.rotation.set(-1.0, 0, -0.25); P.head.rotation.x = 0.35; } // 本を開いて読む
      if (pose === 'picture') { P.head.rotation.x = -0.18; P.rarm.rotation.x = 0.05; }
      if (S.sit > 0) sitPose(ch, S.sit);
      if (sayT > 0) { sayT -= dt; placeBubble(); if (sayT <= 0) bubble.hidden = true; }
    }
    renderer.setAnimationLoop(() => { const dt = Math.min(0.05, clock.getDelta()); step(dt); camStep(dt); orbit.update(); renderer.render(scene, cam); });
    say('おじゃまします！');

    // ---------- 帰る ----------
    const sheet = box.querySelector('.vr-sheet');
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) { sheet.hidden = true; return; }
      const b = e.target.closest('[data-n]'); if (!b) return;
      const n = Number(b.dataset.n);
      renderer.setAnimationLoop(null); ro.disconnect(); orbit.dispose(); renderer.dispose();
      box.remove(); document.documentElement.classList.remove('vroom-open');
      resolve(n >= 0 ? n : null);
    });
    if (typeof window !== 'undefined') window.VISIT_ROOM = { S, R, doItem, ch, cam, orbit }; // 確かめ用
  });
}

// いすに座る形（k：0 立つ → 1 座る）。腰は座面の上（脚の太さの半分だけ上）、脚は前へ水平、手はひざの上
export function sitPose(ch, k) {
  const P = ch.userData.parts;
  const hip = P.rleg.position.y, half = 2 * PX * (P.rleg.scale.z || 1) + 0.006;
  const want = SEAT.top + half - hip; // 座った時の体の下げ幅（負）
  P.body.position.y = P.body.position.y * (1 - k) + want * k;
  for (const L of [P.rleg, P.lleg]) { L.rotation.x = -Math.PI / 2 * k; L.rotation.z = 0; }
  P.rarm.rotation.x = P.rarm.rotation.x * (1 - k) - 0.55 * k; P.larm.rotation.x = P.larm.rotation.x * (1 - k) - 0.55 * k;
  P.body.rotation.x = 0;
}
