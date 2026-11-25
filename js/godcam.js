// 神視点（スペクテーター）カメラ。ブロックをすり抜けて自由に飛ぶ・透かし・定点めぐり。
// demo/caves.html と、町のリール（video/reel.js）から使う。three.js の THREE を引数で受け取るので、どの版の three でも使える。
//   makeTour(points)            … 決めたカメラ位置をなめらかにつなぐ道順。sample(t) で t 秒目の { pos, look } を返す（動画のカメラにそのまま使える）
//   applyTour(camera, tour, t)  … カメラを道順の t 秒目に置く
//   XRAY / xrayGLSL             … 透かし（0 なし・1 カメラの近くを丸く切る・2 ある高さより上を切る＝断面）。シェーダーに足して使う
//   patchXray(material)         … three の標準のマテリアルに透かしを足す（村人や木など）
//   makeSpectator(THREE, camera, dom, opt) … 操作（PC：WASD・Space 上・Shift 下・マウスで向き／スマホ：左のスティック・右をドラッグ・上下ボタン）

// ---------- 定点めぐり ----------
// points：[{ pos: [x, y, z], look: [x, y, z], move: 移る秒, hold: 止まる秒, name }]
export function makeTour(points) {
  const segs = []; let t = 0;
  points.forEach((p, i) => {
    if (i > 0) { const mv = p.move ?? 4; segs.push({ kind: 'move', a: i - 1, b: i, t0: t, t1: t + mv }); t += mv; }
    const hd = p.hold ?? 1.5; segs.push({ kind: 'hold', a: i, t0: t, t1: t + hd }); t += hd;
  });
  const P = points.map((p) => p.pos), L = points.map((p) => p.look);
  // カトマル・ロム曲線（点を通るなめらかな線）
  const cr = (A, i, u) => {
    const p0 = A[Math.max(0, i - 1)], p1 = A[i], p2 = A[Math.min(A.length - 1, i + 1)], p3 = A[Math.min(A.length - 1, i + 2)];
    const u2 = u * u, u3 = u2 * u;
    return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3));
  };
  const ease = (x) => x * x * (3 - 2 * x);
  return {
    points, duration: t,
    // t 秒目の位置と見る点。name は今いる（向かっている）定点の名前
    sample(tt) {
      tt = Math.max(0, Math.min(t, tt));
      const s = segs.find((g) => tt <= g.t1) || segs[segs.length - 1];
      if (s.kind === 'hold') return { pos: P[s.a].slice(), look: L[s.a].slice(), name: points[s.a].name, holding: true };
      const u = ease((tt - s.t0) / (s.t1 - s.t0));
      return { pos: cr(P, s.a, u), look: cr(L, s.a, u), name: points[s.b].name, holding: false };
    },
  };
}
export function applyTour(camera, tour, t) {
  const s = tour.sample(t);
  camera.position.set(s.pos[0], s.pos[1], s.pos[2]);
  camera.lookAt(s.look[0], s.look[1], s.look[2]);
  return s;
}

// ---------- 透かし ----------
// uniform の値（three の uniform の形）。mode：0 なし・1 丸く切る（center のまわり r）・2 断面（y より上を切る）
export const XRAY = { uXMode: { value: 0 }, uXCenter: { value: [0, 0, 0] }, uXR: { value: 10 }, uXY: { value: 64 } };
export const xrayGLSL = {
  pars: 'uniform int uXMode; uniform vec3 uXCenter; uniform float uXR; uniform float uXY;',
  // 世界座標 w の点を消すか
  test: 'if (uXMode == 1 && distance(W_POS, uXCenter) < uXR) discard; if (uXMode == 2 && W_POS.y > uXY) discard;',
};
// three の標準マテリアル（Lambert など）に透かしを足す。村人・道具・たいまつにも同じ切り方を
export function patchXray(material) {
  if (material.userData.xray) return material; // 同じマテリアルを何度も渡されても 1 回だけ
  material.userData.xray = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, XRAY);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vXW;').replace('#include <project_vertex>', '#include <project_vertex>\nvXW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vXW;\n' + xrayGLSL.pars).replace('void main() {', 'void main() {\n' + xrayGLSL.test.replace(/W_POS/g, 'vXW'));
  };
  material.needsUpdate = true;
  return material;
}

// ---------- 操作 ----------
// opt：{ speed, ui: 操作ボタンを入れる要素（スマホ） }。update(dt) を毎フレーム呼ぶ。enabled=false の間は動かない（定点めぐり中など）
export function makeSpectator(THREE, camera, dom, opt = {}) {
  const st = { yaw: 0, pitch: 0, keys: new Set(), move: [0, 0], up: 0, speed: opt.speed || 12, enabled: true, locked: false };
  const fromCamera = () => { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); st.yaw = e.y; st.pitch = e.x; };
  fromCamera();
  const apply = () => { st.pitch = Math.max(-1.55, Math.min(1.55, st.pitch)); camera.quaternion.setFromEuler(new THREE.Euler(st.pitch, st.yaw, 0, 'YXZ')); };
  // PC：クリックでマウスを捕まえる（捕まえられない時はドラッグで向きを変える）
  addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; st.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
  addEventListener('keyup', (e) => st.keys.delete(e.code));
  addEventListener('blur', () => st.keys.clear());
  dom.addEventListener('click', () => { if (!opt.touch && dom.requestPointerLock) try { dom.requestPointerLock(); } catch (e) { /* なし */ } });
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === dom; });
  addEventListener('mousemove', (e) => { if (!st.enabled || !st.locked) return; st.yaw -= e.movementX * 0.0024; st.pitch -= e.movementY * 0.0024; apply(); });
  let drag = null;
  dom.addEventListener('pointerdown', (e) => { if (st.locked) return; if (opt.touch && e.clientX < innerWidth * 0.45 && e.pointerType === 'touch') return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id || !st.enabled) return; st.yaw -= (e.clientX - drag.x) * 0.005; st.pitch -= (e.clientY - drag.y) * 0.005; drag.x = e.clientX; drag.y = e.clientY; apply(); });
  addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });
  // スマホ：左下のスティックと、右の上下ボタン
  if (opt.ui) {
    const stick = document.createElement('div'); stick.className = 'gc-stick'; stick.innerHTML = '<div class="gc-knob"></div>';
    const up = document.createElement('button'); up.className = 'gc-up'; up.textContent = '上';
    const dn = document.createElement('button'); dn.className = 'gc-dn'; dn.textContent = '下';
    opt.ui.append(stick, up, dn);
    const knob = stick.firstChild; let sid = null, c0 = null;
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; const r = stick.getBoundingClientRect(); c0 = [r.left + r.width / 2, r.top + r.height / 2]; stick.setPointerCapture(sid); e.stopPropagation(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId !== sid) return; let dx = e.clientX - c0[0], dy = e.clientY - c0[1]; const l = Math.hypot(dx, dy), m = 46; if (l > m) { dx *= m / l; dy *= m / l; } knob.style.transform = `translate(${dx}px, ${dy}px)`; st.move = [dx / m, -dy / m]; });
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; st.move = [0, 0]; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    for (const [b, v] of [[up, 1], [dn, -1]]) {
      b.addEventListener('pointerdown', (e) => { st.up = v; e.stopPropagation(); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { if (st.up === v) st.up = 0; });
    }
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  return {
    state: st,
    sync: fromCamera, // 定点めぐりなどでカメラを動かした後、その向きから操作を続ける
    update(dt) {
      if (!st.enabled) return;
      const k = st.keys;
      let f = st.move[1] + (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      let s = st.move[0] + (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const u = st.up + (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0);
      const sp = st.speed * (k.has('ControlLeft') || k.has('KeyR') ? 3 : 1) * dt;
      camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize();
      camera.position.addScaledVector(fwd, f * sp).addScaledVector(right, s * sp);
      camera.position.y += u * sp;
    },
  };
}
