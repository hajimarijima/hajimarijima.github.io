// 宝探しの金属探知機：手に持つ道具の形と、持たせ方・「ピッ」の音（Web Audio で作る短い電子音。音のファイルは使わない）。
// 形：黒い握り → 手の少し前に操作箱（画面とランプ） → 銀の柄 → 先に地面と平らな丸い輪（探る所）。
//   持たせ方は毎コマ holdDetector：握りを右手の位置に置き、柄は前下へ。輪の下が地面の少し上（y = HOVER）に来る角度を毎コマ求める
//   （腕の長さ・2 頭身でも輪が地面に入らない）。体の右外を通るので、脚・胴に入らない。
import * as THREE from 'three';

const SC = 1.2, L = 1.2, HOVER = 0.07, COIL_R = 0.21, COIL_H = 0.05, YOKE = 0.07;
const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
function box(w, h, d, m, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o; }

export function makeDetector() {
  const M = { grip: lam(0x26282c), foam: lam(0x3a3d42), body: lam(0x2f4f86), bodyD: lam(0x223a66), silver: lam(0xc9ced4), silverD: lam(0x8e959d), coil: lam(0x1f2226), coilRim: lam(0xf0b429), screen: new THREE.MeshBasicMaterial({ color: 0x9fd88a }), lamp: new THREE.MeshBasicMaterial({ color: 0x3a1410 }) };
  const root = new THREE.Group();
  const arm = new THREE.Group(); root.add(arm); // 柄の向き（+z が先。rotation.x で前下へ）
  // 握り（手の中）と、手の前の操作箱（画面は上・ランプは箱の上の前）
  arm.add(box(0.075, 0.075, 0.2, M.grip, 0, 0, 0));
  for (const z of [-0.06, 0.0, 0.06]) arm.add(box(0.085, 0.085, 0.022, M.foam, 0, 0, z)); // 握りのみぞ
  const ctl = new THREE.Group(); ctl.position.set(0, 0.07, 0.24); arm.add(ctl);
  ctl.add(box(0.2, 0.09, 0.2, M.body, 0, 0, 0));
  ctl.add(box(0.21, 0.025, 0.21, M.bodyD, 0, -0.05, 0)); // 下のふち（暗い）
  const screen = box(0.14, 0.012, 0.1, M.screen, 0, 0.05, -0.02); screen.castShadow = false; ctl.add(screen);
  const lamp = box(0.055, 0.045, 0.055, M.lamp, 0, 0.065, 0.065); lamp.castShadow = false; ctl.add(lamp);
  ctl.add(box(0.07, 0.03, 0.07, M.bodyD, 0, 0.05, 0.065)); // ランプの台
  ctl.add(box(0.05, 0.09, 0.05, M.bodyD, 0, -0.06, -0.08)); // 握りとつなぐ所
  // 柄（太い上の柄 → 止め輪 → 細い下の柄）
  arm.add(box(0.05, 0.05, 0.5, M.silver, 0, 0, 0.36));
  arm.add(box(0.065, 0.065, 0.05, M.silverD, 0, 0, 0.62));
  arm.add(box(0.038, 0.038, L - 0.64, M.silver, 0, 0, (0.64 + L) / 2));
  // 先：輪は地面と平ら（tip.rotation.x で柄の傾きを打ち消す）。輪と柄は小さな腕木でつなぐ
  const tip = new THREE.Group(); tip.position.set(0, 0, L); arm.add(tip);
  tip.add(box(0.05, YOKE, 0.05, M.silverD, 0, -YOKE / 2, 0));
  const coil = new THREE.Group(); coil.position.y = -YOKE - COIL_H / 2; tip.add(coil);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(COIL_R, COIL_R, COIL_H, 20), M.coil); ring.castShadow = true; coil.add(ring);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(COIL_R + 0.012, COIL_R + 0.012, COIL_H * 0.45, 20), M.coilRim); coil.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(COIL_R * 0.45, COIL_R * 0.45, COIL_H + 0.012, 14), M.foam); coil.add(hub);
  root.scale.setScalar(SC); // 遠くのカメラからも形がわかる大きさ
  root.userData = { arm, tip, coil, lamp, screen, M, flash: 0 };
  return root;
}

// 毎コマ：右手で前下へ構える。sweep は左右にふる角度（ラジアン）。ランプは flash（0〜1）で光る
const _hp = new THREE.Vector3(), _cw = new THREE.Vector3();
export function holdDetector(det, H, t, walking, dt, solidAt) {
  const P = H.ch.userData.parts;
  P.rarm.rotation.set(-0.5, 0, -0.06); P.hand.rotation.set(0, 0, 0); P.hand.position.x = 0; // 右腕を少し前へ（外へ少し開いて胴に入らない）
  if (!walking && P.larm.rotation.x < -0.6) P.larm.rotation.set(-0.1, 0, 0.05); // 立っている時の伸びは、探知機を持つ間はしない
  H.ch.updateMatrixWorld(true);
  P.hand.getWorldPosition(_hp);
  const U = det.userData;
  det.position.copy(_hp);
  const sweep = Math.sin(t * (walking ? 2.6 : 1.8)) * (walking ? 0.12 : 0.24);
  const drop = _hp.y - HOVER - (YOKE + COIL_H) * SC; // 柄の先が下がる量
  const a = Math.asin(Math.max(0.1, Math.min(0.95, drop / (L * SC))));
  // 前に岩・しげみ・木・畑があると輪や柄が入ってしまうので、入らない向き（右へ、だめなら左へ・うしろへ）へ よける。
  //   どこもだめなら、柄を上へ立てて持つ。solidAt(x, y, z, pad)：その点が物の中か
  const hits = (off, aa) => {
    if (!solidAt) return false;
    const yw = H.yaw + off, s = Math.sin(yw), c = Math.cos(yw);
    // 柄にそって 9 か所（手の近くは操作箱の幅の分も見る）と、先の輪
    for (let i = 0; i <= 8; i++) { const q = i / 8, f = L * SC * Math.cos(aa) * q, y = _hp.y - L * SC * Math.sin(aa) * q; if (solidAt(_hp.x + s * f, y - (i === 8 ? (YOKE + COIL_H) * SC : 0), _hp.z + c * f, i === 8 ? COIL_R * SC + 0.05 : i <= 3 ? 0.17 : 0.06)) return true; }
    return false;
  };
  let want = { off: sweep, a };
  if (hits(sweep, a)) want = [[-0.5, a], [-0.9, a], [0.5, a], [-1.3, a], [0.9, a], [-1.7, a], [-2.1, a], [-0.9, -0.7], [0, -0.7], [-2.6, a], [0, -1.45], [-1.57, -1.45]].map(([o, aa]) => ({ off: o, a: aa })).find((w) => !hits(w.off, w.a)) || { off: -1.57, a: -1.45 }; // 最後は柄をほぼまっすぐ上へ立てる（体の右外。葉より下）
  // なめらかに向きを変える。ただし途中の向きが物に入るなら、すぐ よけた向きへ
  let k = Math.min(1, (dt || 0.016) * 14);
  if (U.off != null && hits(U.off + (want.off - U.off) * k, U.a + (want.a - U.a) * k)) k = 1;
  U.off = U.off == null ? want.off : U.off + (want.off - U.off) * k;
  U.a = U.a == null ? want.a : U.a + (want.a - U.a) * k;
  det.rotation.set(0, H.yaw + U.off, 0);
  U.arm.rotation.x = U.a; U.tip.rotation.x = -U.a;
  const f = U.flash;
  U.M.lamp.color.setRGB(0.23 + 0.77 * f, 0.08 + 0.32 * f * f, 0.06 + 0.1 * f);
  U.M.screen.color.setRGB(0.55 + 0.35 * f, 0.8 + 0.15 * f, 0.5 + 0.2 * f);
}
// 輪のまん中（探る所）の世界の座標
export function coilPos(det) { det.updateMatrixWorld(true); return det.userData.coil.getWorldPosition(_cw); }

// ---------- 音 ----------
// 最初の 1 回は、ボタンを押した時に start()（ブラウザの決まりで、操作の前には音を出せない）
export function makeBeeper() {
  let ac = null, out = null;
  const B = {
    on: false,
    get ready() { return !!ac; },
    start() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        if (!ac) { ac = new AC(); out = ac.createGain(); out.gain.value = 0.5; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; out.connect(lp).connect(ac.destination); }
        if (ac.state === 'suspended') ac.resume();
        B.on = true; return true;
      } catch (e) { return false; }
    },
    stop() { B.on = false; },
    beep(hz, ms = 45, vib = true) {
      if (!B.on) return;
      if (ac) {
        const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), len = ms / 1000;
        o.type = 'square'; o.frequency.setValueAtTime(hz, t);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.004); g.gain.setValueAtTime(0.16, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.02);
      }
      if (vib && navigator.vibrate) { try { navigator.vibrate(Math.min(40, Math.max(15, ms - 10))); } catch (e) { /* 震えない端末 */ } }
    },
  };
  return B;
}
