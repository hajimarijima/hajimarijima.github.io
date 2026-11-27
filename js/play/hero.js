// 遊びのページの自分の村人：歩く（いつも進む向きを向く。横歩き・後ろ歩きはしない）・働く・釣りざおを振る。
// 体と動きは js/character.js（makeCharacter・animate・setTool）。ここでは釣りの「振る・待つ・引く」の腕だけを足す。
// 働く時に立つ所は、その動きで道具と体がいちばん前へ出る所（reachOf で測る）＋物の半分。道具が木や岩の中へ入らない。
import * as THREE from 'three';
import { makeCharacter, animate, setTool, setAccent, chibiOf } from '../character.js';
import { skinSrc, skinSlim } from '../common.js';

const SPEED = 2.4, TURN = 9; // 歩く速さ（1 秒に何マス）・向きを変える速さ（1 秒に何ラジアン）
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export function makeHero(v) {
  const ch = makeCharacter(skinSrc(v), { scale: 1, slim: skinSlim(v), chibi: chibiOf(v), oneHand: false });
  if (v && v.profile && v.profile.color) setAccent(ch, v.profile.color);
  ch.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { ch, path: [], mode: 'idle', yaw: 0, onArrive: null, work: null, rod: null };
}

// 道具を持ってその動きをした時、体と道具がいちばん前（+z）・上へ出る所（村人の足もとから）
const _box = new THREE.Box3();
export function reachOf(H, pose, tool, secs = 2.2) {
  const ch = H.ch, keep = { p: ch.position.clone(), r: ch.rotation.y };
  ch.position.set(0, 0, 0); ch.rotation.y = 0;
  setTool(ch, tool);
  let front = 0, top = 0;
  for (let i = 0; i <= 90; i++) {
    animate(ch, pose, (i / 90) * secs);
    ch.updateMatrixWorld(true);
    _box.setFromObject(ch.userData.parts.body);
    front = Math.max(front, _box.max.z); top = Math.max(top, _box.max.y);
  }
  ch.position.copy(keep.p); ch.rotation.y = keep.r; ch.updateMatrixWorld(true);
  return { front, top };
}

export function place(H, x, z, yaw) { H.ch.position.set(x, 0, z); H.yaw = yaw; H.ch.rotation.y = yaw; H.path = []; }
// 道を歩く（pts はつぎつぎの点）。着いたら onArrive
export function walkTo(H, pts, onArrive) { H.path = pts.slice(); H.onArrive = onArrive || null; H.mode = 'walk'; }

// 毎コマ。turnTo があれば（着いたあと）その向きへ その場で回る
export function tickHero(H, dt, t) {
  const ch = H.ch;
  if (H.path.length) {
    const p = H.path[0], dx = p.x - ch.position.x, dz = p.z - ch.position.z, d = Math.hypot(dx, dz);
    if (d < 0.04) { H.path.shift(); if (!H.path.length) { H.mode = 'idle'; const f = H.onArrive; H.onArrive = null; if (f) f(); } }
    else {
      const want = Math.atan2(dx, dz), diff = angDiff(H.yaw, want);
      // 向きがずれている間はその場で回る（進む向きと体の向きをいつもそろえる）
      H.yaw += Math.sign(diff) * Math.min(Math.abs(diff), TURN * dt);
      if (Math.abs(diff) < 0.25) { const s = Math.min(d, SPEED * (H.speedMul || 1) * dt); /* speedMul：防具のくらし「歩く速さ」 */ ch.position.x += Math.sin(H.yaw) * s; ch.position.z += Math.cos(H.yaw) * s; }
    }
  } else if (H.turnTo != null) {
    const diff = angDiff(H.yaw, H.turnTo);
    H.yaw += Math.sign(diff) * Math.min(Math.abs(diff), TURN * dt);
    if (Math.abs(diff) < 0.01) { H.yaw = H.turnTo; H.turnTo = null; const f = H.onTurned; H.onTurned = null; if (f) f(); }
  }
  ch.rotation.y = H.yaw;
  const moving = H.path.length > 0;
  const pose = moving ? 'walk' : H.mode === 'work' && H.work ? H.work.pose : H.mode === 'cheer' ? 'wave' : H.mode === 'show' ? 'showfish' : H.mode === 'rod' ? 'fish' : 'idle';
  animate(ch, pose, moving ? t * 1 : t, H.mode === 'cheer' ? ((t - (H.cheerAt || 0)) / 2.4) % 1 : null);
  if (H.mode === 'rod' && !moving) rodPose(H, t);
}
export function faceTo(H, yaw, cb) { H.turnTo = yaw; H.onTurned = cb || null; }

// ---------- 釣り：振りかぶる → 投げる → 待つ → 引く ----------
// rod = { phase: 'ready'|'windup'|'throw'|'wait'|'hook', k: 0..1 }
// 振りかぶる時は右腕を少し外へ開く（z を負に）。腕と竿が頭の横に入らない
function rodPose(H, t) {
  const P = H.ch.userData.parts, R = H.rod || { phase: 'ready', k: 0 };
  const C = H.ch.userData.chibi;
  let ra, rz = 0.18, la = -0.75, lz = -0.42, tool = 0.4, lean = 0.06, head = 0.25;
  const ease = (k) => k * k * (3 - 2 * k);
  if (R.phase === 'windup') { const k = ease(R.k); ra = -0.95 - 1.75 * k; rz = 0.18 - 0.3 * k; la = -0.75 + 0.55 * k; lz = -0.42 + 0.3 * k; tool = 0.4 + 0.1 * k; lean = 0.06 - 0.12 * k; head = 0.25 - 0.3 * k; }
  else if (R.phase === 'throw') { const k = ease(R.k); ra = -2.7 + 1.75 * k; rz = -0.12 + 0.3 * k; la = -0.2 - 0.55 * k; lz = -0.12 - 0.3 * k; tool = 0.5 - 0.1 * k; lean = -0.06 + 0.12 * k; head = -0.05 + 0.3 * k; }
  else if (R.phase === 'hook') { const k = Math.sin(Math.min(1, R.k) * Math.PI * 0.5); ra = -0.95 - 0.8 * k; la = -0.75 - 0.6 * k; tool = 0.4 - 0.5 * k; lean = 0.06 - 0.12 * k; head = 0.25 - 0.2 * k; }
  else { ra = -0.95; if (R.phase === 'wait') { const s = Math.sin(t * 1.3) * 0.03; ra += s; la += s; } }
  P.rarm.rotation.set(ra, 0, rz); P.larm.rotation.set(la, 0, lz);
  if (P.tool) { P.tool.rotation.set(Math.PI / 2 + tool, 0, 0); P.tool.visible = true; }
  P.hand.rotation.set(0, 0, 0); P.hand.position.x = 0;
  P.body.rotation.x = lean * (C ? 0.35 : 1); P.head.rotation.x = head * (C ? 0.5 : 1);
  P.rleg.rotation.x = 0.12; P.lleg.rotation.x = -0.12;
}
// 竿の先（糸を出す所）の世界の座標
const _tip = new THREE.Vector3();
export function rodTip(H) { const tool = H.ch.userData.parts.tool; if (!tool || !tool.userData.tip) return null; H.ch.updateMatrixWorld(true); return tool.userData.tip.getWorldPosition(_tip).clone(); }
