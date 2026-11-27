// 畑の水やりの 3D（tools/sim.js の水やり＝時間の記号 wf:畑）。
//   じょうろを持って畑の列のわきを行ったり来たりし、口から水のしずくが落ちる。水をかけた畑の土は濃い色になる。
//   町の本体（town.js）は updatePerson の始めに window.TOWN.waterStep を呼ぶ。true を返すと、その人は町の本体では動かさない。
import * as THREE from 'three';
import { animate, holdCan } from './character.js';
import { decodeHours } from './hours.js';

const T = () => window.TOWN || {};
const SPEED = 1.1; // 水をまきながら、ゆっくり歩く
const SIDE = 0.95; // 畑のふち（作物の外）から通り道までの間
const _hp = new THREE.Vector3();

// ---------- 畑の土を濃い色に ----------
const DARK = new Map([[0x7a5636, 0x5e3f24], [0x5f412a, 0x4a3019], [0x8c6644, 0x6e4a2c]]);
const wetDone = new Set();
function wetField(fo, k) {
  // k：0〜1（だんだん濃くする）。材料は畑ごとに分けてから色を変える（ほかの畑の色は変えない）
  if (!fo || !fo.obj) return;
  fo.obj.traverse((m) => {
    if (!m.isMesh || !m.material || !m.material.color) return;
    if (m.userData.dry === undefined) {
      const hex = m.material.color.getHex();
      if (!DARK.has(hex)) { m.userData.dry = null; return; }
      m.material = m.material.clone(); m.userData.dry = hex;
    }
    if (m.userData.dry === null) return;
    const a = new THREE.Color(m.userData.dry), b = new THREE.Color(DARK.get(m.userData.dry));
    m.material.color.copy(a.lerp(b, Math.min(1, k)));
  });
}

// ---------- しずく ----------
let drops = null, dropN = 0;
const DMAX = 240, dropData = [];
function ensureDrops() {
  if (drops || !T().scene) return;
  drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), new THREE.MeshLambertMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.85, emissive: 0x1d4a6e }), DMAX);
  drops.frustumCulled = false; drops.count = 0; T().scene.add(drops);
  for (let i = 0; i < DMAX; i++) dropData.push({ on: false });
}
// dir：畑の方（単位ベクトル）。水はじょうろの口から畑の方へ弧をえがいて飛ぶ（ふち越しに畑の土へ落ちる）
function spawnDrop(at, seed, dir) {
  const d = dropData[dropN++ % DMAX];
  const r1 = ((seed * 9301 + 49297) % 233280) / 233280, r2 = ((seed * 4021 + 1013) % 7919) / 7919;
  const sp = 1.5 + r1 * 0.6;
  d.on = true; d.x = at.x + (r1 - 0.5) * 0.1; d.y = at.y; d.z = at.z + (r2 - 0.5) * 0.1; d.vy = 0.2 - r2 * 0.4;
  d.vx = (dir ? dir.x * sp : 0) + (r2 - 0.5) * 0.35; d.vz = (dir ? dir.z * sp : 0) + (r1 - 0.5) * 0.35;
}
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
function stepDrops(dt) {
  if (!drops) return;
  let n = 0;
  for (const d of dropData) {
    if (!d.on) continue;
    d.vy -= 9 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    if (d.y < 0.2) { d.on = false; continue; } // 土に落ちた
    V.set(d.x, d.y, d.z); M.compose(V, Q, S); drops.setMatrixAt(n++, M);
  }
  drops.count = n; drops.instanceMatrix.needsUpdate = true;
}

// ---------- 通り道：畑の 4 つのふちのうち、通れる所 ----------
// 町の当たり（solids）では畑は丸（半径 1.9）なので、ふちのすぐ外は「通れない」になる。
// ここでは畑を本当の四角で見て、ほかの物（柵の杭・木・家）は丸の当たりで見る。
const HW = 1.05, HD = 1.15; // 畑（farm3d.js の makeField：2.1 × 2.3）の半分
const BODY = 0.32; // 村人の体の半分
function inField(x, z, f, pad) {
  const rot = f.rot || 0, c = Math.cos(rot), s = Math.sin(rot), dx = x - f.x, dz = z - f.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < HW + pad && Math.abs(lz) < HD + pad;
}
// 畑の建物（farm3d.js の makeFarm）の低い木のふち 7.6 × 5.6。ふちの上・内側のすき間は歩かない（外を歩いて、ふち越しに水をかける）
function inFarm(x, z, b) {
  const rot = b.rot || 0, c = Math.cos(rot), s = Math.sin(rot), dx = x - b.x, dz = z - b.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < 3.8 + 0.09 + BODY && Math.abs(lz) < 2.8 + 0.09 + BODY;
}
function walkFree(x, z) {
  const TW = T(), fields = (TW.world && TW.world.fields) || [];
  if (fields.some((f) => inField(x, z, f, BODY))) return false;
  if (((TW.world && TW.world.buildings) || []).some((b) => b.type === 'farm' && inFarm(x, z, b))) return false;
  const isField = (o) => o.r === 1.9 && fields.some((f) => Math.abs(f.x - o.x) < 1e-6 && Math.abs(f.z - o.z) < 1e-6);
  return !(TW.solids || []).some((o) => !isField(o) && Math.hypot(o.x - x, o.z - z) < o.r + BODY);
}
function pathOf(fo) {
  const f = fo, rot = f.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
  const hw = HW, hd = HD;
  const W = (lx, lz) => ({ x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c });
  const hash = (fo.id || '').split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  // 列（うね）は x の向き。列にそった長いふちを先に試す。通り道は畑に近い順（0.45→0.95）
  for (const sideD of [0.45, 0.7, SIDE]) {
    const sides = [
      { a: W(-hw + 0.15, hd + sideD), b: W(hw - 0.15, hd + sideD), toward: W(0, hd - 0.4) },
      { a: W(hw - 0.15, -hd - sideD), b: W(-hw + 0.15, -hd - sideD), toward: W(0, -hd + 0.4) },
      { a: W(hw + sideD, -hd + 0.2), b: W(hw + sideD, hd - 0.2), toward: W(hw - 0.4, 0) },
      { a: W(-hw - sideD, hd - 0.2), b: W(-hw - sideD, -hd + 0.2), toward: W(-hw + 0.4, 0) },
    ];
    for (let i = 0; i < 4; i++) {
      const sd = sides[(i + hash) % 4];
      let ok = true;
      for (let k = 0; k <= 6 && ok; k++) ok = walkFree(sd.a.x + (sd.b.x - sd.a.x) * k / 6, sd.a.z + (sd.b.z - sd.a.z) * k / 6);
      if (ok) return sd;
    }
  }
  return null;
}

// ---------- 1 人分の 1 コマ ----------
function waterStep(p, dt, time) {
  const TW = T(), a = p.act;
  const on = a && a.action === 'water' && p.mode === 'day' && !p.party && p.ch.visible;
  if (!on) { if (p.wat) { p.wat = null; } return false; }
  const fo = TW.objById && TW.objById[a.target];
  if (!fo) return false;
  let w = p.wat;
  if (!w || w.id !== a.target) {
    const sd = pathOf(fo);
    if (!sd) { p.wat = null; return false; } // 通れるふちがない時は、町の本体の水やり（その場でまく）
    const W = TW.walk;
    w = p.wat = { id: a.target, sd, leg: 0, route: W.safeRoute ? W.safeRoute({ ...p.pos }, sd.a) : [sd.a], ri: 0, there: false, wet: 0, fo };
  }
  const W = TW.walk;
  W.setCarry && W.setCarry(p.ch, null);
  W.setTool && W.setTool(p.ch, 'can');
  let pose = 'walk';
  if (!w.there) { // 畑のふちまで歩く（町の本体と同じ歩き方：向きをかえてから進む）
    const ri = p.ri; p.ri = w.ri;
    const done = !w.route.length || W.walkTo(p, w.route, dt);
    w.ri = p.ri; p.ri = ri;
    if (done || Math.hypot(p.pos.x - w.sd.a.x, p.pos.z - w.sd.a.z) < 0.12) { w.there = true; w.leg = 1; }
    else { W.keepApart && W.keepApart(p); }
    p.ch.position.set(p.pos.x, 0, p.pos.z);
    if (p.lod === 'full') animate(p.ch, 'walk', time, null);
    return true;
  }
  // ふちにそって 3 か所で止まり、畑の方を向いて正面へ水をまく → 次の所へ（進む向きを向いてから歩く。横歩き・後ろ歩きはしない）
  const mx = (w.sd.a.x + w.sd.b.x) / 2, mz = (w.sd.a.z + w.sd.b.z) / 2, tw = w.sd.toward;
  const faceYaw = Math.atan2(tw.x - mx, tw.z - mz); // 畑の方（ふちに直角）
  if (w.si === undefined) { w.si = 0; w.dirS = 1; w.phase = 'face'; w.t = 0; }
  const stop = (i) => ({ x: w.sd.a.x + (w.sd.b.x - w.sd.a.x) * i / 2, z: w.sd.a.z + (w.sd.b.z - w.sd.a.z) * i / 2 });
  let pour = false;
  if (w.phase === 'walk') {
    const to = stop(w.si), dx = to.x - p.pos.x, dz = to.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { w.phase = 'face'; pose = 'idle'; }
    else { const left = W.turnTo(p.ch, Math.atan2(dx, dz), dt); if (left < 0.15) { const st = Math.min(d, SPEED * dt); p.pos.x += dx / d * st; p.pos.z += dz / d * st; } else pose = 'idle'; }
  } else if (w.phase === 'face') {
    pose = 'idle';
    if (W.turnTo(p.ch, faceYaw, dt) < 0.04) { w.phase = 'pour'; w.t = 0; }
  } else { // pour：正面の畑へ水をまく
    pose = 'idle'; pour = true; W.turnTo(p.ch, faceYaw, dt);
    w.t += dt;
    if (w.t > 3.2) { if (w.si + w.dirS > 2 || w.si + w.dirS < 0) w.dirS = -w.dirS; w.si += w.dirS; w.phase = 'walk'; }
  }
  w.pour = pour;
  p.ch.position.set(p.pos.x, 0, p.pos.z);
  if (p.lod === 'full') {
    animate(p.ch, pose, time, null);
    const P = p.ch.userData.parts;
    if (P) {
      // じょうろは右手で前へ出して持つ。口は村人の正面（顔と同じ向き）、胴はほぼ水平で口の先だけ少し下がる
      if (pour) { P.rarm.rotation.set(-1.15 + Math.sin(time * 1.6) * 0.04, 0, 0); holdCan(p.ch, p.ch.rotation.y); }
      else holdCan(p.ch, p.ch.rotation.y, 0); // 歩く間は下げて持つ（胴は水平のまま、口は前）
    }
  }
  // しずく：じょうろの口から、正面の畑へ（水をまいている間だけ）
  const P = p.ch.userData.parts, sp = P && P.tool && P.tool.userData.spout;
  if (sp && p.lod === 'full' && pour) {
    ensureDrops();
    w.dropT = (w.dropT || 0) + dt;
    const dir = { x: Math.sin(p.ch.rotation.y), z: Math.cos(p.ch.rotation.y) };
    while (w.dropT > 0.04) { w.dropT -= 0.04; const at = new THREE.Vector3(); sp.getWorldPosition(at); spawnDrop(at, Math.floor(time * 1000) + (w.n = (w.n || 0) + 1), dir); }
  }
  // 水をかけるほど、その畑の土が濃くなる（20 秒ほどで濃くなりきる）
  if (pour && !wetDone.has(fo.id)) { w.wet = Math.min(1, w.wet + dt / 12); wetField(fo, w.wet); if (w.wet >= 1) wetDone.add(fo.id); }
  return true;
}

// 今日もう水をやった畑（sim の f.wet が今日。水をやった時刻をすぎていれば）は、はじめから濃い色
function wetAtLoad() {
  const TW = T(), st = TW.state || {}, day = st.day, h = TW.hourNow ? TW.hourNow() : 12;
  const life = TW.life || st.life || {};
  for (const f of (TW.world && TW.world.fields) || []) {
    if (f.wet !== day) continue;
    // 水をやった人の時間の記号（wf:畑）の時刻で、もうすぎたかを見る
    let at = 24;
    for (const L of Object.values(life)) {
      decodeHours(L && L.hours).forEach((c, i) => { if (c === 'wf:' + f.id && i < at) at = i; });
    }
    if (at === 24) at = 10; // 時刻が分からない時は朝の 10 時
    if (h >= at + 1) { wetField(TW.objById[f.id], 1); wetDone.add(f.id); }
  }
}

let last = performance.now();
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  stepDrops(dt);
}
(function wait(n = 0) {
  const TW = T();
  if (TW && TW.walk && TW.people && TW.objById && TW.scene) { TW.waterStep = waterStep; wetAtLoad(); requestAnimationFrame(tick); return; }
  if (n < 600) setTimeout(() => wait(n + 1), 100);
})();
window.TOWN_WATER = { wetField, pathOf };
