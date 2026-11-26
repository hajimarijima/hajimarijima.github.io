// 動物の体の大きさ・柵の中・逃げる向き・海のサメの背びれの道（町の画面 town.js とテストで共通。three.js も DOM も使わない）。
//   動物の頭は +x 向き。rotation.y = face の時、前は (cos face, -sin face)、横は (sin face, cos face)。
//   柵（動物の柵 pen）の中は、柵の 1 辺 7.4（farm3d.js の makePen）。中の座標（lx, lz）は柵の回転 rot をもどした座標。
import { islandAt, shoreDist, bridgeDist, shorePoint, MAIN } from './island.js';

// 体の四角：頭の先まで f、しっぽまで b、横はばの半分 w（farm3d.js の makeAnimal の箱から測った）
export const BODY = {
  cow: { f: 1.42, b: 0.86, w: 0.48 },
  sheep: { f: 1.06, b: 0.6, w: 0.53 },
  chicken: { f: 0.5, b: 0.5, w: 0.26 },
  pig: { f: 1.06, b: 0.66, w: 0.37 },
};
export const bodyOf = (kind) => BODY[kind] || BODY.pig;
// 柵：half は柱の線、inner は中の動物が体をはみ出させない線、outer は外の動物・人が近づかない線。
//   props は中の水おけと干し草（中の座標の箱 hx × hz）。門は閉じた戸（gate）でふさがっている
export const PEN = { half: 3.7, inner: 3.5, outer: 3.95, gate: 0.92, props: [{ x: 2.4, z: -3.12, hx: 0.74, hz: 0.3 }, { x: -2.98, z: -2.98, hx: 0.5, hz: 0.5 }] };

export const fwd = (face) => ({ x: Math.cos(face), z: -Math.sin(face) });
// 進む向き (dx, dz) → face
export const faceOf = (dx, dz) => Math.atan2(-dz, dx);
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// 体の 4 隅（ワールド座標）。pad だけ大きく見る
export function bodyQuad(kind, x, z, face, pad = 0) {
  const B = bodyOf(kind), f = fwd(face), s = { x: -f.z, z: f.x };
  const F = B.f + pad, Bk = B.b + pad, Wd = B.w + pad;
  return [[F, Wd], [F, -Wd], [-Bk, -Wd], [-Bk, Wd]].map(([u, v]) => ({ x: x + f.x * u + s.x * v, z: z + f.z * u + s.z * v }));
}
// 柵の座標 ⇄ ワールド座標（world3d.js の建物の回転と同じ：x' = x cos + z sin、z' = -x sin + z cos）
export function toLocal(pen, x, z) {
  const r = pen.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = x - pen.x, dz = z - pen.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export function toWorld(pen, lx, lz) {
  const r = pen.rot || 0, c = Math.cos(r), s = Math.sin(r);
  return { x: pen.x + lx * c + lz * s, z: pen.z - lx * s + lz * c };
}
const boxQuad = (cx, cz, hx, hz) => [{ x: cx - hx, z: cz - hz }, { x: cx + hx, z: cz - hz }, { x: cx + hx, z: cz + hz }, { x: cx - hx, z: cz + hz }];
// 凸 4 角形どうしが重なるか（分離軸）
// 2 つの四角がどれだけ食いこんでいるか（重ならなければ 0）。分ける向きのうち、いちばん浅い食いこみ
export function quadDepth(a, b) {
  let best = Infinity;
  for (const P of [a, b]) for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    let nx = q.z - p.z, nz = -(q.x - p.x); const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a) { const d = v.x * nx + v.z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const v of b) { const d = v.x * nx + v.z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    const o = Math.min(a1 - b0, b1 - a0);
    if (o <= 0) return 0;
    best = Math.min(best, o);
  }
  return best;
}
export function quadsOverlap(a, b) {
  for (const P of [a, b]) for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], nx = q.z - p.z, nz = -(q.x - p.x);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a) { const d = v.x * nx + v.z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const v of b) { const d = v.x * nx + v.z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
// 柵の中の動物の体が、柵・水おけ・干し草にかからずに収まるか（quad はワールド座標）
export function insidePen(pen, quad) {
  const L = quad.map((v) => toLocal(pen, v.x, v.z));
  if (L.some((v) => Math.abs(v.x) > PEN.inner || Math.abs(v.z) > PEN.inner)) return false;
  return !PEN.props.some((p) => quadsOverlap(L, boxQuad(p.x, p.z, p.hx + 0.05, p.hz + 0.05)));
}
// 外の動物の体が、柵（外がわの線）にかからないか
export function clearOfPen(pen, quad) {
  const L = quad.map((v) => toLocal(pen, v.x, v.z));
  return !quadsOverlap(L, boxQuad(0, 0, PEN.outer, PEN.outer));
}
// 柵の中の最初の置き場（重ならない 3 × 3 のます。みんな +x を向いて並ぶ）。i 番目
export function penSlot(i) {
  const xs = [-2.6, -0.28, 2.04], zs = [0.25, 2.45, -1.8], k = ((i % 9) + 9) % 9;
  return { x: xs[k % 3], z: zs[Math.floor(k / 3)], face: 0 };
}
// 柵の外で、中の (lx, lz) にいちばん近い所（人が柵ごしに立つ所）。柵の柱の線から gap 外
export function outsidePen(pen, lx, lz, gap = 1.0) {
  const d = PEN.half + gap;
  const p = Math.abs(lx) > Math.abs(lz) ? { x: Math.sign(lx || 1) * d, z: Math.max(-PEN.half + 0.6, Math.min(PEN.half - 0.6, lz)) } : { x: Math.max(-PEN.half + 0.6, Math.min(PEN.half - 0.6, lx)), z: Math.sign(lz || 1) * d };
  return toWorld(pen, p.x, p.z);
}
// 柵の柱と閉じた戸の線（人が通りぬけないように、step ごとの点。ワールド座標）
export function penFencePoints(pen, step = 0.9) {
  const out = [], H = PEN.half, n = Math.max(1, Math.round((2 * H) / step));
  for (let i = 0; i <= n; i++) {
    const u = -H + (i * 2 * H) / n;
    for (const [x, z] of [[u, -H], [u, H], [-H, u], [H, u]]) out.push(toWorld(pen, x, z));
  }
  return out;
}
// 逃げる向き：おそった人 (from) と反対の向きを中心に、少しずつ左右へずらして ok(face) な向きを探す。
//   cur（今の向き）に近い向きを先に選ぶ（急に横を向かない）。なければ null（追いつめられた）
export function fleeHeading(from, at, cur, ok) {
  const want = faceOf(at.x - from.x, at.z - from.z);
  const tries = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.8, -1.8, 2.2, -2.2, 2.6, -2.6, 3.0, -3.0];
  const sideFirst = cur != null && angDiff(cur, want) < 0 ? -1 : 1;
  for (const d of tries) { const h = want + d * sideFirst; if (ok(h)) return h; }
  return null;
}

// ---------- 海のサメ：背びれが沖をゆっくり進む（島のふちから near〜far 沖。ときどき水面に出る） ----------
// どの陸・橋・桟橋からも、どれだけはなれているか（陸の中は負）
export function seaClear(world, x, z) {
  let c = Infinity;
  for (const isl of (world && world.islands) || []) c = Math.min(c, -shoreDist(isl, x, z));
  for (const br of (world && world.bridges) || []) c = Math.min(c, bridgeDist(br, x, z) - (br.w || 3) / 2);
  for (const b of (world && world.buildings) || []) if (b.type === 'dock') c = Math.min(c, Math.hypot(x - b.x, z - b.z) - 9);
  return c;
}
const smooth = (u) => { const k = Math.max(0, Math.min(1, u)); return k * k * (3 - 2 * k); };
// k 番目のサメの、時刻 t（秒）の背びれ。{ x, z, face, rise（0 は水の下・1 は水面に出ている） }。島の町でなければ null
//   S = config.sea（count・speed・near・far・every・show・margin）
export function sharkPos(world, k, t, S = {}) {
  const isl = ((world && world.islands) || []).find((i) => i.id === MAIN);
  if (!isl) return null;
  const near = S.near ?? 12, far = S.far ?? 24, dir = k % 2 ? -1 : 1;
  const w = (S.speed ?? 1.8) / (isl.r + (near + far) / 2); // 1 秒に進む角度
  const at = (tt) => {
    const off = near + (far - near) * (0.5 + 0.5 * Math.sin(tt * 0.031 + k * 1.7));
    return shorePoint(isl, k * 2.399 + 0.6 + dir * w * tt, -off);
  };
  const p = at(t), q = at(t + 0.25);
  const every = S.every ?? 46, show = S.show ?? 0.5, u = ((t / every + k * 0.383) % 1 + 1) % 1;
  const win = u < show ? smooth(u / 0.08) * smooth((show - u) / 0.08) : 0;
  const margin = S.margin ?? 7;
  const safe = Math.min(smooth((seaClear(world, p.x, p.z) - margin) / 3), smooth((seaClear(world, q.x, q.z) - margin) / 3));
  return { x: p.x, z: p.z, face: faceOf(q.x - p.x, q.z - p.z), rise: win * safe };
}
// 陸かどうか（テスト用：島のどこか margin 内）
export const nearLand = (world, x, z, margin) => !!islandAt(world, x, z, -margin);
