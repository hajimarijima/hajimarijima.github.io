// 写真モード（町の画面）：上のカード・タブ・札・旗をかくして町だけを全画面にし、ストーリー（9:16）か正方形（1:1）の枠で撮る。
//   入り口：上のカードの「写真」・メニューの「写真をとる」・村人のカードの「この人と写真」・?photo=1
//   選べるもの：時間帯（今・朝・昼・夕方・夜）、名札の表示、枠。指で回す・寄る・動かすで構図を決める
//   シャッター：枠の中だけを 1080×1920（正方形は 1080×1080）で 1 回だけ描き直して書き出す（いつもの描画は軽いまま）。
//   右下に小さく「島の名前 @アカウント」。保存（ダウンロード）と、共有できる端末（スマホ）では共有（インスタのストーリーへ送れる）
//   町の本体（js/town.js）からは window.TOWN の renderer・camera・scene・labels・people・markers・setHour・lookAt だけを使う
import * as THREE from 'three';
import { icon } from './icons.js';
import { TREE_LEN, TREE_LEAF_Y } from './blocks.js';

const TIMES = [['now', '今', null], ['morning', '朝', 7], ['day', '昼', 12.5], ['evening', '夕方', 18.2], ['night', '夜', 21.5]];
const FRAMES = { story: { w: 1080, h: 1920, name: '9:16' }, square: { w: 1080, h: 1080, name: '1:1' } };
const S = { on: false, time: 'now', tags: true, frame: 'story', who: null, url: '', blob: null };
let el = null, frameEl = null;

const T = () => window.TOWN;
const isReady = () => { const t = T(); return !!(t && t.renderer && t.people && t.lookAt); };
function whenReady(cb) { if (isReady()) cb(); else setTimeout(() => whenReady(cb), 200); }

function build() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'photomode'; el.id = 'photomode'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.tabIndex = -1; el.setAttribute('aria-label', '写真モード');
  const chips = (name, list, cur) => list.map(([k, t]) => `<button type="button" data-${name}="${k}" aria-pressed="${k === cur}">${t}</button>`).join('');
  el.innerHTML =
    '<div class="pm-frame" aria-hidden="true"></div>' +
    `<div class="pm-top"><button type="button" class="pm-back">${icon('arrow-left', { size: 20 })}<span>もどる</span></button><span class="pm-who" aria-live="polite"></span></div>` +
    '<div class="pm-bottom">' +
    `<div class="pm-row" role="group" aria-label="時間帯">${chips('time', TIMES, S.time)}</div>` +
    `<div class="pm-row"><button type="button" class="pm-tags" aria-pressed="true">${icon('tag', { size: 16 })}<span>名札</span></button>` +
    `<span class="pm-sep" aria-hidden="true"></span><span class="pm-seg" role="group" aria-label="枠">${chips('frame', Object.entries(FRAMES).map(([k, f]) => [k, f.name]), S.frame)}</span></div>` +
    `<button type="button" class="pm-shutter" aria-label="シャッター（写真を撮る）"><span></span></button>` +
    '</div>' +
    '<div class="pm-flash" aria-hidden="true"></div>' +
    '<div class="pm-result" hidden tabindex="-1"><div class="pm-res-in">' +
    '<p class="pm-res-t">撮れました</p><img class="pm-img" alt="撮った写真">' +
    `<div class="pm-acts"><a class="pm-save" download>${icon('download', { size: 18 })}<span>保存</span></a>` +
    `<button type="button" class="pm-share" hidden>${icon('share-2', { size: 18 })}<span>共有</span></button>` +
    `<button type="button" class="pm-again">${icon('camera', { size: 18 })}<span>もう一枚</span></button></div>` +
    '<p class="pm-res-note muted"></p></div></div>';
  document.body.append(el);
  frameEl = el.querySelector('.pm-frame');
  el.querySelector('.pm-back').addEventListener('click', close);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-time]'); if (t) setTime(t.dataset.time);
    const f = e.target.closest('[data-frame]'); if (f) setFrame(f.dataset.frame);
  });
  el.querySelector('.pm-tags').addEventListener('click', () => setTags(!S.tags));
  el.querySelector('.pm-shutter').addEventListener('click', () => { shoot(); });
  el.querySelector('.pm-again').addEventListener('click', closeResult);
  el.querySelector('.pm-share').addEventListener('click', share);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); if (!el.querySelector('.pm-result').hidden) closeResult(); else close(); } });
  addEventListener('resize', () => { if (S.on) layout(); });
}

// 枠の位置：上のボタンと下の操作のあいだに、縦横の比を守っていちばん大きく
function layout() {
  const W = innerWidth, H = innerHeight;
  const top = el.querySelector('.pm-top').getBoundingClientRect().bottom + 6;
  const bot = el.querySelector('.pm-bottom').getBoundingClientRect().top - 8;
  const F = FRAMES[S.frame], k = F.h / F.w;
  let w = W - 16, h = w * k;
  if (h > bot - top) { h = bot - top; w = h / k; }
  w = Math.floor(w); h = Math.floor(w * k);
  Object.assign(frameEl.style, { width: w + 'px', height: h + 'px', left: Math.round((W - w) / 2) + 'px', top: Math.round(top + (bot - top - h) / 2) + 'px' });
}

function setTime(k) {
  S.time = k;
  const h = (TIMES.find((x) => x[0] === k) || TIMES[0])[2];
  T().setHour(h);
  el.querySelectorAll('[data-time]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === k)));
}
function setTags(on) {
  S.tags = on;
  document.documentElement.classList.toggle('pm-notags', !on);
  el.querySelector('.pm-tags').setAttribute('aria-pressed', String(on));
}
function setFrame(k) {
  S.frame = k;
  el.querySelectorAll('[data-frame]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.frame === k)));
  layout();
  if (S.on && S.who && S.who.photo && !S.moved) { aim(S.who, bestView(S.who)); faceCamera(); recheck(S.who); } // 枠を変えたら、その人が収まるように寄り直す（自分で動かした後はそのまま）
}

// 選んだ人をカメラの方へ向かせる（回したら向き直す）
function faceCamera() {
  const p = S.who; if (!p || !p.photo) return;
  const c = T().camera.position;
  p.photo.yaw = Math.atan2(c.x - p.pos.x, c.z - p.pos.z);
}
// 木や家にかくれない向きをさがす：今の向きから左右に 30 度ずつ、だめなら少し上から。カメラからその人の頭までの線に物が無い所
const visibleChain = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
// ほかの村人が、カメラとその人のあいだ（手前）に立っていないか（地面の上で、線から 3 以内）
function personInFront(p, cam) {
  const ax = cam.x, az = cam.z, bx = p.pos.x, bz = p.pos.z, L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
  return (T().people || []).some((q) => {
    if (q === p || !q.ch || !q.ch.visible) return false;
    const u = ((q.pos.x - ax) * (bx - ax) + (q.pos.z - az) * (bz - az)) / L2;
    if (u < 0 || u > 0.97) return false; // その人のすぐ前に立つ人も（顔にかぶる）
    return Math.hypot(q.pos.x - (ax + u * (bx - ax)), q.pos.z - (az + u * (bz - az))) < 3;
  });
}
// カメラ位置 pos からその人が見えないか。両方の向きに調べる（カメラが木の葉の中にある時は、カメラ側からの線は内側の面に当たらないので、人の側からも見る）
// 調べる相手：その人の近く（60 以内）に見えている形だけ（空・光・半透明・その人自身は除く）。毎回 町じゅうを調べると重いので 1 度だけ集める
function nearMeshes(p, R = 60) {
  const out = [], c = new THREE.Vector3(p.pos.x, 0, p.pos.z), sp = new THREE.Sphere();
  T().scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || !visibleChain(o)) return;
    for (let x = o; x; x = x.parent) if (x === p.ch) return;
    const m = o.material; if (m && (m.depthWrite === false || (m.transparent && m.opacity < 0.5))) return;
    if (!o.geometry) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sp.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); } else sp.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
    if (sp.center.distanceTo(c) - sp.radius < R) out.push(o);
  });
  return out;
}
function viewBlocked(p, pos, list = nearMeshes(p), cap = Infinity, why = null) { // cap：これ以上悪いと分かったら数えるのをやめる（軽くするため）
  const t = T(), s = p.ch.scale.y || 1, ray = new THREE.Raycaster(), dir = new THREE.Vector3();
  let bad = 0; // かくれ具合の点数（0＝よく見える）
  ray.camera = t.camera; // 札の絵（Sprite）にも当てるのに要る
  const hit = (from, d, far) => { ray.set(from, d); ray.near = 0.3; ray.far = far; return ray.intersectObjects(list, false).some((h) => !willHide(h, p, pos, true)); };
  // 体の何か所か（頭のまん中・頭の左右・胸の左右・腰・足もと）。頭は 1.5〜2.0（×大きさ）。横はカメラから見た左右
  const hx = p.pos.x - pos.x, hz = p.pos.z - pos.z, hl = Math.hypot(hx, hz) || 1, sx = -hz / hl, sz = hx / hl;
  for (const [o, y] of [[0, 1.75], [-0.3, 1.75], [0.3, 1.75], [-0.4, 1.0], [0.4, 1.0], [0, 0.5], [0, 0.15]]) {
    const pt = new THREE.Vector3(p.pos.x + sx * o * s, y * s, p.pos.z + sz * o * s);
    dir.copy(pt).sub(pos); const len = dir.length(); dir.normalize();
    if (hit(pos, dir, len - 0.5) || hit(pt, dir.clone().negate(), len)) { bad += 3; if (why) why.push('body'); if (bad >= cap) return bad; }
  }
  if (personInFront(p, pos)) { bad += 2; if (why) why.push('person'); if (bad >= cap) return bad; }
  // 枠の中（四すみ・ふち・まん中）に、その人より手前の木の葉・幹・家が大きく入らないか（地面と、地面すれすれの草は数えない）
  const d1 = Math.hypot(p.pos.x - pos.x, pos.y - aimY(p), p.pos.z - pos.z), ty = aimY(p) - frameShift({ dist: d1, pol: Math.acos(Math.min(1, Math.max(-1, (pos.y - aimY(p)) / d1))) }); // 本当にねらう高さ（枠のずれの分を下げる）で見る
  const c = t.camera.clone(); c.position.copy(pos); c.lookAt(p.pos.x, ty, p.pos.z); c.updateMatrixWorld();
  const r = frameEl.getBoundingClientRect(), W = innerWidth || 1, H = innerHeight || 1, near = Math.hypot(p.pos.x - pos.x, pos.y - ty, p.pos.z - pos.z) * 0.8; // その人より手前だけ（後ろの木は景色）。全部はさけられない時は、いちばん少ない所を選ぶ
  const ndc = new THREE.Vector2();
  for (const fy of [0.04, 0.5, 0.8, 0.96]) for (const fx of [0.04, 0.5, 0.96]) {
    ndc.set(((r.left + r.width * fx) / W) * 2 - 1, -(((r.top + r.height * fy) / H) * 2 - 1));
    ray.setFromCamera(ndc, c); ray.near = 0.3; ray.far = fy < 0.1 ? near / 0.8 + 6 : near; // 上のふちは、その人のすぐ後ろの木の葉が大きく写るのもさける
    if (ray.intersectObjects(list, false).some((h) => (h.point.y > 0.6 || h.distance < near * 0.5) && !willHide(h, p, pos, false))) { // カメラのすぐ前の低い屋台や柵も、大きく写るので数える（地面はそこまで近くない）
    bad += 1; if (why) why.push('grid'); if (bad >= cap) return bad; }
  }
  // 枠の左右・上下のふちから 1 割内側の線に、その人より手前の大きな物（壁・岩・屋台）がかかる向きはさける（ふちが大きくふさがる）
  for (const [fx, fy] of [[0.1, 0.25], [0.1, 0.5], [0.1, 0.75], [0.9, 0.25], [0.9, 0.5], [0.9, 0.75], [0.3, 0.9], [0.7, 0.9], [0.3, 0.1], [0.7, 0.1]]) {
    ndc.set(((r.left + r.width * fx) / W) * 2 - 1, -(((r.top + r.height * fy) / H) * 2 - 1));
    ray.setFromCamera(ndc, c); ray.near = 0.3; ray.far = near / 0.8 * (fx === 0.1 || fx === 0.9 ? 1.6 : 1.1); // その人と同じくらいの近さまで（横に並ぶ大きな壁もふちをふさぐ。後ろの家は景色なので数えない）
    if (ray.intersectObjects(list, false).some((h) => h.point.y > 0.3 && !willHide(h, p, pos, false))) { bad += 3; if (why) why.push('edge'); if (bad >= cap) return bad; }
  }
  // 頭や体のすぐ後ろ（6 以内）に幹・柱・壁が重なると「頭から棒が生えた」ように見えるのでさける（頭の上の少し先も見る）
  const len = Math.hypot(hx, hz, pos.y - s);
  for (const [o, y] of [[0, 2.5], [0, 3.3], [0, 1.75], [0, 1.0], [-0.8, 1.6], [0.8, 1.6]]) {
    const pt = new THREE.Vector3(p.pos.x + sx * o * s, y * s, p.pos.z + sz * o * s);
    dir.copy(pt).sub(pos).normalize(); ray.set(pos, dir); ray.near = Math.max(0.3, len - 0.8); ray.far = len + (y > 2 ? 15 : 6); // 頭の上は少し遠くの幹も（頭から生えて見える）
    if (ray.intersectObjects(list, false).some((h) => h.point.y > 0.6 && !willHide(h, p, pos, true))) { bad += 2; if (why) why.push('pole'); if (bad >= cap) return bad; }
  }
  return bad;
}
// 後ろの景色の開け具合（0〜9）：枠の上の方を通る線が、遠く（その人より 25 以上先）まで何にも当たらなければ、空・海・遠くの島が写る
function openness(p, pos, far) {
  const t = T(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const d1 = Math.hypot(p.pos.x - pos.x, pos.y - aimY(p), p.pos.z - pos.z), ty = aimY(p) - frameShift({ dist: d1, pol: Math.acos(Math.min(1, Math.max(-1, (pos.y - aimY(p)) / d1))) });
  const c = t.camera.clone(); c.position.copy(pos); c.lookAt(p.pos.x, ty, p.pos.z); c.updateMatrixWorld();
  const r = frameEl.getBoundingClientRect(), W = innerWidth || 1, H = innerHeight || 1;
  ray.camera = t.camera;
  let n = 0;
  for (const fy of [0.06, 0.2, 0.34]) for (const fx of [0.15, 0.5, 0.85]) {
    ndc.set(((r.left + r.width * fx) / W) * 2 - 1, -(((r.top + r.height * fy) / H) * 2 - 1));
    ray.setFromCamera(ndc, c); ray.near = 0.3; ray.far = d1 + 25;
    if (!ray.intersectObjects(far, false).some((h) => !willHide(h, p, pos, false))) n++;
  }
  return n;
}
// 向きの点数（小さいほどよい）：かくれ・ふさがりは重く、開けた景色は少しずつよくする
const viewScore = (p, pos, list, far, cap = Infinity) => {
  const bad = viewBlocked(p, pos, list, cap === Infinity ? Infinity : Math.ceil((cap + 27) / 3));
  return bad * 3 - (bad * 3 - 27 >= cap ? 0 : openness(p, pos, far) * 3);
};
// ねらう高さ＝体のまん中（足から頭まで 2.0 × 大きさ）。体のまん中が枠の縦のまん中に来る
const aimY = (p) => 1.5 * (p.ch.scale.y || 1); // 体のまん中（1.0）より上をねらい、体のまん中が枠の上から 55〜60% に来るようにする（上に景色と空を多めに、下の草を少なく）
// その人の背が枠の高さの 4 割くらいになる距離（見下ろす分だけ大きく写るので 0.36 で計算）（枠の大きさと画角から）。後ろに島の景色が入る
function viewDist(p) {
  const r = frameEl.getBoundingClientRect(), f = Math.max(0.2, r.height / (innerHeight || 1));
  return (2.0 * (p.ch.scale.y || 1)) / (0.36 * 2 * Math.tan((T().camera.fov * Math.PI) / 360) * f);
}
function bestView(p, quick = false) { // quick：立つ所えらび用に、向きを少なく
  const t = T(), cam = t.camera, tg = t.controls.target, ty = aimY(p), d0 = viewDist(p);
  const az0 = Math.atan2(cam.position.x - tg.x, cam.position.z - tg.z);
  const pos = new THREE.Vector3(), list = nearMeshes(p), far = nearMeshes(p, d0 + 40);
  let best = null;
  for (const [dk, pol] of quick ? [[1, 1.15]] : [[1, 1.2], [1, 1.08], [0.92, 1.25], [0.85, 1.15], [1.08, 0.95], [0.85, 0.95]]) { // 横に近い向き（空や海が上に入る）を先に。見下ろすと下が草ばかりになる
    const dist = d0 * dk;
    const n = quick ? 12 : 24;
    for (let i = 0; i < n; i++) { // 15 度ずつ一周（quick は 30 度ずつ）
      const az = az0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * ((2 * Math.PI) / n);
      pos.set(p.pos.x + Math.sin(az) * Math.sin(pol) * dist, ty + Math.cos(pol) * dist, p.pos.z + Math.cos(az) * Math.sin(pol) * dist);
      const score = viewScore(p, pos, list, far, best ? best.score : Infinity);
      if (!best || score < best.score) best = { dist, az, pol, score };
      if (score <= -27) return best; // かくれ無しで上が全部開けている
    }
  }
  return best;
}
// 町はねらう点の高さを毎回 0 にもどすので、体のまん中を通る線が地面に当たる所（その人の少し向こう）をねらう。カメラの位置と向きは同じになる
// 枠は画面のまん中より少し上にあるので、その分だけねらう点を下げて、その人が枠のまん中に来るようにする
function frameShift(v) {
  const r = frameEl.getBoundingClientRect(), H = innerHeight || 1, ndc = (H / 2 - (r.top + r.height / 2)) / (H / 2);
  return ndc * Math.tan((T().camera.fov * Math.PI) / 360) * v.dist / Math.max(0.3, Math.sin(v.pol));
}
const aim = (p, v) => { const ty = aimY(p) - frameShift(v), off = ty * Math.tan(v.pol); T().lookAt(p.pos.x - Math.sin(v.az) * off, p.pos.z - Math.cos(v.az) * off, v.dist + ty / Math.cos(v.pol), v.az, v.pol, 0); };
// 寄った先の木は少しおくれて出てくる（近くの木はあとから作られる）ので、出そろってからもう一度確かめて、かくれていたら向きを変える。自分で動かしたらやめる
function recheck(p) {
  clearTimeout(S.recheckT);
  let n = 0;
  const step = () => {
    if (!S.on || S.who !== p || S.moved) return;
    const now = viewScore(p, T().camera.position, nearMeshes(p), nearMeshes(p, viewDist(p) + 40));
    if (now > -27) { const v = bestView(p); if (v.score < now - 2) { aim(p, v); faceCamera(); } } // 今よりはっきりよく見える所がある時だけ動かす
    if (++n < 4) S.recheckT = setTimeout(step, 500);
  };
  S.recheckT = setTimeout(step, 400);
}
const onMoveStart = () => { S.moved = true; };
// 選んだ人の前を横切る村人・すぐ後ろで重なる村人は、写真モードの間だけ見えなくする（画面でも写真でも同じ）。横に並ぶ人や離れた人はそのまま写る。
//   visible は町が毎回決めるので触らず、カメラに写らない層（layer 1）へ移す（名札も一緒に消える）
function hideLayer(q, on) {
  if (!on && !q.ch.userData.pmHide) return; // 隠す時は毎回かけ直す（町が体の部品を作り直すことがあるので）
  q.ch.userData.pmHide = on;
  q.ch.traverse((o) => { if (on) o.layers.set(1); else o.layers.set(0); });
}
function screenBox(p, cam, w) {
  const s = p.ch.scale.y || 1, v = new THREE.Vector3(), b = { l: 1e9, r: -1e9, t: 1e9, bt: -1e9 };
  const R = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), rl = Math.hypot(R.x, R.z) || 1, rx = R.x / rl, rz = R.z / rl; // カメラから見た横向き
  for (const [o, y] of [[-w, 0], [w, 0], [-w, 2.1], [w, 2.1]]) {
    v.set(p.pos.x + rx * o * s, y * s, p.pos.z + rz * o * s).project(cam);
    b.l = Math.min(b.l, v.x); b.r = Math.max(b.r, v.x); b.t = Math.min(b.t, -v.y); b.bt = Math.max(b.bt, -v.y);
  }
  return b;
}
function clearFront() {
  const p = S.who, t = T();
  clearObjs();
  if (!S.on || !p || !p.photo) { for (const q of t.people || []) if (q.ch) hideLayer(q, false); return; }
  const cam = t.camera, d0 = cam.position.distanceTo(p.ch.position), a = screenBox(p, cam, 0.7);
  const fr = frameEl.getBoundingClientRect(), W = innerWidth || 1, H = innerHeight || 1; // 枠（画面の -1〜1 で）
  const F = { l: fr.left / W * 2 - 1, r: fr.right / W * 2 - 1, t: fr.top / H * 2 - 1, b: fr.bottom / H * 2 - 1 };
  for (const q of t.people || []) {
    if (q === p || !q.ch) continue;
    let hide = false;
    const dq = cam.position.distanceTo(q.ch.position);
    if (q.ch.visible && dq < d0 - 1.5) {
      const b = screenBox(q, cam, 0.5);
      // その人に重なる人と、その人より 3 以上手前で枠に写りこむ人（端で体が切れてじゃまになる）
      hide = (b.l < a.r && b.r > a.l && b.t < a.bt && b.bt > a.t) || (dq < Math.max(d0 * 0.75, d0 - 3) && b.l < F.r && b.r > F.l && b.t < F.b && b.bt > F.t);
    }
    // その人の後ろ（10 以内）で体に重なって見える人も、ごちゃつくので写さない（横に並ぶ人はそのまま）
    if (!hide && q.ch.visible && dq >= d0 - 1.5 && Math.hypot(q.ch.position.x - p.ch.position.x, q.ch.position.z - p.ch.position.z) < 10) {
      const b = screenBox(q, cam, 0.45), c = screenBox(p, cam, 0.7); // 手をふる腕の分だけその人を広めに見る
      hide = b.l < c.r && b.r > c.l && b.t < c.bt && b.bt > c.t;
    }
    // その人に体がめりこむほど近い人（止まっているその人の所を通りぬける人）も写さない
    if (!hide && q.ch.visible && Math.hypot(q.ch.position.x - p.ch.position.x, q.ch.position.z - p.ch.position.z) < 0.75 * (p.ch.scale.x || 1)) hide = true;
    // 近く（20 以内）にいて、枠のふちで体が切れて写る人も写さない（足だけ・半分だけが写るとごちゃつく）
    if (!hide && q.ch.visible && Math.hypot(q.ch.position.x - p.ch.position.x, q.ch.position.z - p.ch.position.z) < 20) {
      const b = screenBox(q, cam, 0.45), inF = b.l < F.r && b.r > F.l && b.t < F.b && b.bt > F.t, all = b.l > F.l && b.r < F.r && b.t > F.t && b.bt < F.b;
      hide = inF && !all;
      // 近く（12 以内）で枠に入る人も写さない（人が固まると体と名札が重なってごちゃつき、選んだ人が目立たない）
      if (!hide && inF && Math.hypot(q.ch.position.x - p.ch.position.x, q.ch.position.z - p.ch.position.z) < 12) hide = true;
    }
    hideLayer(q, hide);
  }
}
// ---------- 写真モードの間だけ消す木・岩・小さな柱 ----------
// 消すもの：カメラとその人のあいだ（その人より手前）で枠に写る木・岩・柱と、その人の後ろ（BEHIND 以内）で頭や体に重なる幹・柱・動物。
//   木・岩は、その人の後ろ CLEAR 以内で枠に写るものも消す（近い木は幹だけが太い棒のように大きく写り、葉が枠の外に出て島の写真に見えないので、まわりを少し開けた所にする）。
// 半透明にはせず、木なら葉・幹・影ごと 1 本まるごと消す（一部だけ欠けて穴に見えないように）。もどる時・人を選び直した時に元にもどす。
//   木と岩は blocks.js の makeChunkObjects がまとめた形（userData.hideObjs で、その木だけ抜いた形にする）。柱は町に 1 つずつ置かれた小さな物（街灯・看板など）
const BEHIND = 15, CLEAR = 12, POLE = 35;
const treeLike = (o) => (o.hp !== undefined ? o.hp > 0 : !o.state || o.state === 'tree');
const objDims = (o) => { const s = o.size || 1; return o.hp !== undefined ? { r: 1.8, h: 2.4, tr: 1.8, clear: true } : { r: TREE_LEN * s * 0.27, h: TREE_LEN * s, tr: TREE_LEN * s * 0.06 + 0.1, clear: true, leaf: TREE_LEAF_Y * s }; };
const V = new THREE.Vector3();
function projBox(cam, x, z, r, y0, y1) { // 箱の 8 すみを画面（-1〜1、上が -1）へ。カメラの後ろにかかる時は null
  const b = { l: 1e9, r: -1e9, t: 1e9, bt: -1e9 };
  for (const dx of [-r, r]) for (const dz of [-r, r]) for (const y of [y0, y1]) {
    V.set(x + dx, y, z + dz).applyMatrix4(cam.matrixWorldInverse);
    if (V.z > -0.1) return null;
    V.applyMatrix4(cam.projectionMatrix);
    b.l = Math.min(b.l, V.x); b.r = Math.max(b.r, V.x); b.t = Math.min(b.t, -V.y); b.bt = Math.max(b.bt, -V.y);
  }
  return b;
}
const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.bt && a.bt > b.t;
// 消すかどうか（x, z：物の所、r：横の半分、h：高さ、tr：後ろにある時に重なりを見る幅）
function shouldHide(p, cam, F, body, x, z, y0, d) {
  const cx = cam.position.x, cz = cam.position.z, L = Math.hypot(p.pos.x - cx, p.pos.z - cz) || 1;
  const u = ((x - cx) * (p.pos.x - cx) + (z - cz) * (p.pos.z - cz)) / L;
  if (u < L - 0.6) { const b = projBox(cam, x, z, d.r, y0, y0 + d.h); return !b ? u > -d.r - 1 : overlap(b, F); }
  const ds = Math.hypot(x - p.pos.x, z - p.pos.z);
  if (d.clear && ds < CLEAR) { const b = projBox(cam, x, z, d.r, y0, y0 + d.h); return !b || overlap(b, F); }
  // 遠くの木でも、葉が枠の上に出て幹だけが写る木は、棒が立っているように見えるので消す（距離に関係なく）
  if (d.clear) { const b = projBox(cam, x, z, d.leaf ? d.tr : d.r, y0, y0 + (d.leaf || d.h)); if (b && overlap(b, F) && ((d.leaf && b.t < F.t) || (b.l < body.r && b.r > body.l) || ((b.l < F.l || b.r > F.r) && b.bt - b.t > (F.bt - F.t) * 0.1))) return true; } // 枠の左右のふちで切れて大きく写る幹・岩と、遠くても頭の真上や体の後ろに縦に重なる幹も（頭から棒が生えて見える）
  if (ds >= (d.clear ? POLE : BEHIND)) return false; // 木・岩は少し遠くても、頭や体に重なれば消す（頭に岩や幹がのって見える）
  const b = projBox(cam, x, z, d.tr, y0, y0 + d.h);
  return !!b && overlap(b, body);
}
// 町に 1 つずつ置かれた小さな物（柱・街灯・看板・動物）。人を選んだ時に 1 度だけ集める（形の箱は置き場からのずれで覚えて、動く物にもついていく）
function propList(p) {
  const out = new Map(), box = new THREE.Box3(), sz = new THREE.Vector3(), ctr = new THREE.Vector3(), t = T();
  const skip = new Set((t.people || []).map((q) => q.ch).filter(Boolean));
  for (const o of t.scene.children) {
    if (skip.has(o) || !o.visible || o.isLight || o.isCamera || o.isCSS2DObject) continue;
    if (Math.hypot(o.position.x - p.pos.x, o.position.z - p.pos.z) > 45) continue;
    let ok = false, merged = false; o.traverse((c) => { if (c.isMesh) { ok = true; if (c.userData.hideObjs) merged = true; } });
    if (!ok || merged) continue;
    box.setFromObject(o); if (box.isEmpty()) continue; box.getSize(sz); box.getCenter(ctr);
    const tree = !!(o.userData.tree || o.userData.rock); // 今日だれかが切る木・掘る岩（1 つずつ作られている）も、まとめた木・岩と同じに消す
    if (!tree && (Math.max(sz.x, sz.z) > 2.6 || sz.y < 0.6 || box.min.y > 1)) continue; // 0.6 より低い草・花・小石は残す（動物は頭に重なれば消す）
    out.set(o, { o, ox: ctr.x - o.position.x, oz: ctr.z - o.position.z, y0: box.min.y, d: { r: Math.max(sz.x, sz.z) / 2, h: sz.y, tr: tree ? 0.6 : Math.max(sz.x, sz.z) / 2, clear: tree, leaf: o.userData.tree ? sz.y * 0.42 : 0 } });
  }
  return out;
}
function propOf(obj) { if (!S.props) return null; for (let o = obj; o; o = o.parent) { const r = S.props.get(o); if (r) return r; } return null; }
function setPropHidden(r, on) {
  if (!!r.hid === on) return;
  r.hid = on; r.o.traverse((c) => c.layers.set(on ? 1 : 0));
}
// 向きを選ぶ時：この当たりは、その向きから撮る時には消える物か（消える物は、かくす物として数えない）。behindToo：すぐ後ろの物も消える方に数える（頭・体の線）
function willHide(h, p, pos, behindToo) {
  const L = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) || 1, u = ((h.point.x - pos.x) * (p.pos.x - pos.x) + (h.point.z - pos.z) * (p.pos.z - pos.z)) / L;
  let x, z, clear = true;
  const objs = h.object.userData.objs;
  if (objs) {
    let o = null, best = 1e9; for (const q of objs) { const d = Math.hypot(q.x - h.point.x, q.z - h.point.z); if (d < best) { best = d; o = q; } }
    if (!o || !treeLike(o) || best > objDims(o).r + 0.6) return false;
    x = o.x; z = o.z;
  } else { const r = propOf(h.object); if (!r) return false; x = r.o.position.x + r.ox; z = r.o.position.z + r.oz; clear = !!r.d.clear; }
  const ds = Math.hypot(x - p.pos.x, z - p.pos.z);
  return u < L - 0.6 || (clear && ds < CLEAR) || (behindToo && ds < (clear ? POLE : BEHIND));
}
function clearObjs() {
  const p = S.who, t = T(), on = S.on && p && p.photo, meshes = [];
  t.scene.traverse((o) => { if (o.isMesh && o.userData.hideObjs) meshes.push(o); });
  if (!on) { for (const m of meshes) m.userData.hideObjs(null); if (S.props) for (const r of S.props.values()) setPropHidden(r, false); return; }
  const cam = t.camera; cam.updateMatrixWorld();
  const fr = frameEl.getBoundingClientRect(), W = innerWidth || 1, H = innerHeight || 1;
  const F = { l: fr.left / W * 2 - 1, r: fr.right / W * 2 - 1, t: fr.top / H * 2 - 1, bt: fr.bottom / H * 2 - 1 };
  const body = screenBox(p, cam, 0.9), reach = 400, sp = new THREE.Sphere(), c = new THREE.Vector3(p.pos.x, 0, p.pos.z);
  for (const m of meshes) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    sp.copy(m.userData.fullSphere || m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
    if (!m.userData.fullSphere) m.userData.fullSphere = m.geometry.boundingSphere.clone();
    if (sp.center.distanceTo(c) - sp.radius > reach) { m.userData.hideObjs(null); continue; }
    const ids = new Set();
    for (const o of m.userData.objs) if (treeLike(o) && shouldHide(p, cam, F, body, o.x, o.z, o.y || 0, objDims(o))) ids.add(o.id);
    m.userData.hideObjs(ids);
  }
  if (S.props) for (const r of S.props.values()) setPropHidden(r, shouldHide(p, cam, F, body, r.o.position.x + r.ox, r.o.position.z + r.oz, r.y0, r.d));
}
// 名札は町ではおなかの高さ。写真では顔や服にかぶるので、写真モードの間だけ頭の上へ上げる
function raiseTags(up) {
  for (const p of T().people || []) {
    let o = null; if (p.ch) p.ch.traverse((c) => { if (c.isCSS2DObject && c.element === p.label) o = c; }); if (!o) continue;
    if (up) { if (o.userData.pmY == null) o.userData.pmY = o.position.y; o.position.y = 2.2; }
    else if (o.userData.pmY != null) { o.position.y = o.userData.pmY; delete o.userData.pmY; }
  }
}
// 選んだ人に寄る：その人が枠のまん中あたりに入る距離と向き
// 写真の間だけ、その人に近く（14 以内）の開けた所へ立ってもらう（木の間・屋台の陰・パーティの人ごみだと、どの向きからもうまく写らない）。もどる時に元の所へ
function release(p) {
  if (!p) return;
  if (p.photo && p.photo.home) { p.pos.x = p.photo.home.x; p.pos.z = p.photo.home.z; if (p.ch) p.ch.position.set(p.pos.x, 0, p.pos.z); }
  delete p.photo;
}
function pickSpot(p) {
  const t = T(), x0 = p.pos.x, z0 = p.pos.z, free = t.spotFree;
  if (!free || p.mode === 'sleep') return;
  let best = null;
  // 木・切り株・岩のすぐそば（足もとに切り株や木くずが重なる所）にも立たせない。元の所も同じに調べる
  //   長いす・丸太・木くずのように solids に入っていない物も、足の高さで 8 方向に短い線を出して調べる
  const list = nearMeshes(p, 24), ray = new THREE.Raycaster(), o = new THREE.Vector3(), dir = new THREE.Vector3();
  ray.camera = t.camera;
  const feetClear = (x, z) => { o.set(x, 3, z); dir.set(0, -1, 0); ray.set(o, dir); ray.near = 0; ray.far = 2.85; if (ray.intersectObjects(list, false).length) return false; for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; o.set(x, 0.4, z); dir.set(Math.sin(a), 0, Math.cos(a)); ray.set(o, dir); ray.near = 0; ray.far = 1.3; if (ray.intersectObjects(list, false).length) return false; } return true; };
  const roomy = (x, z) => !(t.solids || []).some((s) => Math.hypot(s.x - x, s.z - z) < (s.r || 0) + 1.6) && feetClear(x, z);
  const tryAt = (x, z, extra) => {
    if (((x !== x0 || z !== z0) && !free(x, z)) || !roomy(x, z)) return;
    p.pos.x = x; p.pos.z = z;
    const v = bestView(p, true);
    const sc = v.score + extra; // 動く量が少ないほど少しよい
    if (!best || sc < best.sc) best = { x, z, sc };
  };
  tryAt(x0, z0, 0);
  for (const r of [3, 6, 10, 14]) for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + (r % 2 ? 0 : Math.PI / 8); tryAt(x0 + Math.sin(a) * r, z0 + Math.cos(a) * r, r * 0.25); }
  if (!best) best = { x: x0, z: z0 }; // どこも空いていない時は元の所
  p.pos.x = best.x; p.pos.z = best.z; if (p.ch) p.ch.position.set(best.x, 0, best.z);
  S.spot = { p, x: best.x, z: best.z };
}
// 町の方で立つ所が変わった時（時間帯を変えて夕方のパーティの席へ呼ばれた等）は、そこを元の所にして立つ所を選び直す
function keepSpot() {
  const p = S.who; if (!S.on || !p || !p.photo || !S.spot || S.spot.p !== p) return;
  if (Math.hypot(p.pos.x - S.spot.x, p.pos.z - S.spot.z) < 0.01) return;
  p.photo.home = { x: p.pos.x, z: p.pos.z };
  pickSpot(p);
  if (!S.moved) { aim(p, bestView(p)); faceCamera(); }
}
function choose(key) {
  const p = (T().people || []).find((q) => q.v.key === key);
  if (S.who && S.who !== p) release(S.who);
  S.who = p || null;
  const who = el.querySelector('.pm-who');
  if (!p) { who.textContent = ''; return; }
  if (S.props) for (const r of S.props.values()) setPropHidden(r, false);
  if (!p.photo) { p.photo = { yaw: 0, home: { x: p.pos.x, z: p.pos.z } }; pickSpot(p); }
  S.props = propList(p);
  aim(p, bestView(p));
  faceCamera();
  S.moved = false; recheck(p);
  const name = p.label ? p.label.firstChild.textContent : p.v.display;
  who.textContent = p.mode === 'sleep' && p.ch && !p.ch.visible ? `${name}（家の中で寝ています）` : name;
}

function open(key) {
  build();
  whenReady(() => {
    if (window.TOWN_MENU) window.TOWN_MENU.close(false);
    if (!S.on) { const t = T(); S.prevScroll = scrollY; S.cam0 = { pos: t.camera.position.clone(), tg: t.controls.target.clone() }; } // もどる時に元の見え方へ
    S.on = true;
    const card = document.getElementById('card'); if (card) card.hidden = true; // 村人のカードは閉じる（もどった時に残らないように）
    document.documentElement.classList.add('photo-on');
    el.hidden = false;
    for (const m of T().markers || []) m.visible = false;
    raiseTags(true);
    setTime(S.time); setTags(S.tags);
    dispatchEvent(new Event('resize')); // 町を全画面の大きさで描き直す
    layout();
    if (key) choose(key);
    else { // 人を選ばない時は、少し上から寄って、縦長の枠に島が大きく入るように（空ともやばかりにならない）
      const t = T(), tg = t.controls.target, c = t.camera.position;
      const d = c.distanceTo(tg), az = Math.atan2(c.x - tg.x, c.z - tg.z);
      t.lookAt(tg.x, tg.z, Math.max(30, d * 0.82), az, 0.4);
    }
    T().controls.addEventListener('change', faceCamera);
    T().controls.addEventListener('start', onMoveStart);
    clearInterval(S.frontT); S.frontT = setInterval(() => { keepSpot(); clearFront(); }, 150);
    el.focus({ preventScroll: true }); // 画面そのものに（シャッターに枠線を出さない）
  });
}
function close() {
  if (!S.on) return;
  S.on = false;
  closeResult();
  el.hidden = true;
  document.documentElement.classList.remove('photo-on', 'pm-notags');
  for (const m of T().markers || []) m.visible = true;
  raiseTags(false);
  T().setHour(null);
  if (S.who) { release(S.who); S.who = null; }
  el.querySelector('.pm-who').textContent = '';
  T().controls.removeEventListener('change', faceCamera);
  T().controls.removeEventListener('start', onMoveStart);
  clearTimeout(S.recheckT);
  clearInterval(S.frontT); clearFront(); S.props = null; // 見えなくしていた人・木・岩・柱をもどす
  if (S.cam0) { const t = T(); t.camera.position.copy(S.cam0.pos); t.controls.target.copy(S.cam0.tg); t.controls.update(); S.cam0 = null; }
  const card = document.getElementById('card'); if (card) card.hidden = true; // 写真モードの間に町を押して開いたカードは出さない
  dispatchEvent(new Event('resize'));
  scrollTo(0, S.prevScroll || 0);
}

// 名札：画面に出ている札（CSS2D）を、写真の上に同じ見た目で描く
// その人の頭が木や家のかげにかくれているか（かくれた人の札だけが葉の上に浮いて写らないように）
function headHidden(q) {
  const t = T(), cam = t.camera, s = q.ch.scale.y || 1, ray = new THREE.Raycaster();
  const head = new THREE.Vector3(q.pos.x, 1.75 * s, q.pos.z), d = head.clone().sub(cam.position), len = d.length();
  ray.set(cam.position, d.normalize()); ray.near = 0.3; ray.far = len - 0.6 * s; ray.camera = cam; // 札の絵（Sprite）にも当てるのに要る
  return ray.intersectObjects(t.scene.children, true).some((h) => {
    for (let x = h.object; x; x = x.parent) if (x === q.ch || !x.visible) return false;
    const m = h.object.material; return !h.object.isSprite && !(m && (m.depthWrite === false || (m.transparent && m.opacity < 0.5)));
  });
}
function drawTags(g, fr, k) {
  const root = T().labels && T().labels.domElement; if (!root) return;
  const owner = new Map((T().people || []).filter((q) => q.label && q.ch).map((q) => [q.label, q]));
  for (const tag of root.querySelectorAll('.nametag')) {
    const cs = getComputedStyle(tag);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || +(tag.parentElement && getComputedStyle(tag.parentElement).opacity) === 0) continue;
    const r = tag.getBoundingClientRect();
    if (!r.width || r.left < fr.left - 1 || r.right > fr.right + 1 || r.top < fr.top - 1 || r.bottom > fr.bottom + 1) continue; // 枠からはみ出す札は、切れて写るので出さない
    const q = owner.get(tag); if (q && q !== S.who && headHidden(q)) continue;
    const x = (r.left - fr.left) * k, y = (r.top - fr.top) * k, w = r.width * k, h = r.height * k;
    g.globalAlpha = +cs.opacity || 1;
    g.fillStyle = cs.backgroundColor;
    g.beginPath(); g.roundRect(x, y, w, h, 5 * k); g.fill();
    g.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * k}px ${cs.fontFamily}`;
    g.textBaseline = 'middle'; g.fillStyle = '#fff';
    let name = tag.firstChild ? tag.firstChild.textContent : tag.textContent;
    const px = parseFloat(cs.paddingLeft) * k, st = tag.querySelector('.tstar');
    // 画面の札は長い名前を「…」で切っているので、写真でも同じように切る
    const room = w - px * 2 - (st ? 11 * k : 0) + 3 * k; // 星（9px＋すき間 2px）の分。少しの差では切らない
    if (g.measureText(name).width > room) { while (name.length > 1 && g.measureText(name + '…').width > room) name = name.slice(0, -1); name += '…'; }
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillText(name, x + px, y + h / 2 + 0.5 * k);
    if (st) { const nw = g.measureText(name).width; g.fillStyle = '#ffd34d'; g.font = `${9 * k}px ${cs.fontFamily}`; g.fillText('★', x + px + nw + 2 * k, y + h / 2); }
    g.restore();
    g.globalAlpha = 1;
  }
}
// 入れ文字：右下に小さく「島の名前 @アカウント」
function drawMark(g, W, H) {
  const cfg = T().config || {};
  const text = `${cfg.title || 'はじまり島'} ${cfg.account || '@comment_de_sodatsu'}`.trim();
  const fs = Math.round(W * 0.026), pad = Math.round(W * 0.034);
  g.font = `700 ${fs}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`;
  const tw = g.measureText(text).width, bh = fs * 1.75, bw = tw + fs * 1.3;
  const x = W - pad - bw, y = H - pad - bh;
  g.fillStyle = 'rgba(20,24,30,.42)';
  g.beginPath(); g.roundRect(x, y, bw, bh, bh / 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.95)'; g.textBaseline = 'middle';
  g.fillText(text, x + fs * 0.65, y + bh / 2 + fs * 0.04);
}

// シャッター：枠の中だけを、書き出す大きさで 1 回だけ描く（setViewOffset で枠の部分を切り出す）。すぐ元の大きさへ戻す
function render(F) {
  clearFront(); // 撮る直前の並びで、前を横切る人を外す
  faceCamera(); if (S.who && S.who.photo) S.who.ch.rotation.y = S.who.photo.yaw; // 向き直る途中でも、写真ではこちらを向いた姿にする
  const t = T(), r = t.renderer, cam = t.camera;
  const sr = t.stage.getBoundingClientRect(), fr = frameEl.getBoundingClientRect();
  const pr = r.getPixelRatio();
  cam.aspect = sr.width / sr.height;
  cam.setViewOffset(sr.width, sr.height, fr.left - sr.left, fr.top - sr.top, fr.width, fr.height);
  r.setPixelRatio(1); r.setSize(F.w, F.h, false);
  r.render(t.scene, cam);
  const c = document.createElement('canvas'); c.width = F.w; c.height = F.h;
  const g = c.getContext('2d');
  g.drawImage(r.domElement, 0, 0, F.w, F.h); // 描いた直後（同じ処理の中）なら preserveDrawingBuffer なしで読める
  cam.clearViewOffset(); cam.aspect = sr.width / sr.height; cam.updateProjectionMatrix();
  r.setPixelRatio(pr); r.setSize(sr.width, sr.height);
  if (S.tags) drawTags(g, fr, F.w / fr.width);
  drawMark(g, F.w, F.h);
  return c;
}
async function shoot() {
  if (!S.on) return null;
  const F = FRAMES[S.frame];
  const c = render(F);
  const fl = el.querySelector('.pm-flash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) return null;
  S.blob = blob;
  if (S.url) URL.revokeObjectURL(S.url);
  S.url = URL.createObjectURL(blob);
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  const fname = `hajimari-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.jpg`;
  S.file = typeof File === 'function' ? new File([blob], fname, { type: 'image/jpeg' }) : null;
  const res = el.querySelector('.pm-result');
  res.querySelector('.pm-img').src = S.url;
  res.querySelector('.pm-img').classList.toggle('sq', S.frame === 'square');
  const save = res.querySelector('.pm-save'); save.href = S.url; save.download = fname;
  const canShare = !!(S.file && navigator.canShare && navigator.share && navigator.canShare({ files: [S.file] }));
  res.querySelector('.pm-share').hidden = !canShare;
  res.querySelector('.pm-res-note').textContent = canShare ? '「共有」からインスタのストーリーに送れます。' : '「保存」で画像を保存して、インスタのストーリーで選んでください。';
  res.hidden = false;
  res.focus({ preventScroll: true });
  return blob;
}
async function share() {
  if (!S.file) return;
  try { await navigator.share({ files: [S.file], title: (T().config || {}).title || 'はじまり島' }); } catch (e) { /* やめた時は何もしない */ }
}
function closeResult() {
  if (!el) return;
  el.querySelector('.pm-result').hidden = true;
  if (S.on) el.focus({ preventScroll: true });
}

// 村人のカード（さがして飛んだ時）に「この人と写真」
function watchCard() {
  const card = document.getElementById('card'); if (!card) return;
  const add = () => {
    const btns = card.querySelector('.cardbtns');
    if (card.hidden || !card.dataset.key || card.classList.contains('pjcard') || !btns || btns.querySelector('.pm-cardbtn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn pm-cardbtn';
    b.innerHTML = icon('camera', { size: 16 }) + '<span>この人と写真</span>';
    b.addEventListener('click', () => open(card.dataset.key));
    btns.append(b);
  };
  new MutationObserver(add).observe(card, { childList: true, attributes: true, attributeFilter: ['hidden'] });
}

function setup() {
  const b = document.getElementById('photobtn');
  if (b) b.addEventListener('click', () => open());
  watchCard();
  window.TOWN_PHOTO = { open, close, shoot, state: S, choose: (k) => choose(k), dbg: { bestView, viewBlocked, openness, nearMeshes, viewDist } }; // 確かめ用
  if (new URLSearchParams(location.search).get('photo') === '1') open();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
}
