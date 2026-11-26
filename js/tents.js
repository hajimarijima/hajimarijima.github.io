// テント（家がまだない人の寝床）。js/town.js・tools/sim.js・tools/base.js・テストで共通（three は使わない）。
//   ・村人がいれば、たき火のうしろに大きいテントを 1 つ。家のない人が perTent 人をこえたら 2 つ目、3 つ目…（maxTents まで）。
//   ・テントの中に、1 人 1 つの寝床（敷物）を横に並べる。ベッドを作った人は、敷物のかわりにテントの中にベッドを置く。
//     ベッドは外には置かない（家ができたら家の中へ移る）。
//   ・テントに入れない人（いっぱい）は、たき火のそばで横になる。
//   ・形は三角屋根（段々）で、前の面のまん中に入口（村人が立って入れる高さ）。寝床は奥へ寄せて、足の先と前の壁の間は通り道。
import { BED } from './beds.js';

// テントの大きさ：寝床 1 つのはば slotW、奥行き depth、横の壁の高さ wallH、てっぺん ridgeH、壁の厚み wall、入口のはば door・高さ doorH
//   寝床のはばは、横になった人の肩と腕（約 1.9）がとなりの人に重ならない広さ。
//   奥行き＝奥のすき間＋ベッドの長さ＋通り道（体の横はば 1.9 が、寝ている人の足と前の壁の間を通れる）
//   てっぺん・入口は村人の背（約 3.8）より高い
export const TENT = { slotW: BED.w + 0.9, depth: BED.l + 3.3, wallH: 1.4, ridgeH: 5.0, pad: 0.25, wall: 0.3, door: 2.4, doorH: 4.2 };
// 寝床のまん中（奥から 壁＋0.35 あけて置く）と、通り道（足の先と前の壁の間）の u
export const BED_U = -TENT.depth / 2 + TENT.wall + 0.35 + BED.l / 2;
export const AISLE_U = TENT.depth / 2 - TENT.wall - 1.05;
// 敷物（ベッドのない人の寝床）。ベッドと同じ大きさで、うすい
export const MAT = { w: BED.w * 0.92, l: BED.l * 0.94, h: 0.12 };

// config.json の tent（なければ 1 つに 4 人・3 つまで）
export function tentCfg(config) {
  const t = (config && config.tent) || {};
  return { perTent: Math.max(1, Math.floor(t.perTent || 4)), maxTents: Math.max(1, Math.floor(t.maxTents || 3)) };
}
// テントの長さ（寝床の並ぶ向き）
export const tentLen = (perTent) => perTent * TENT.slotW + TENT.pad * 2;

// 家のない人をテントの寝床に割り当てる。ベッドを持っている人が先、あとは来た順（active の順）。
//   戻り値 { tents: テントの数, slot: { key: { tent, i } }, outside: [テントに入れない人の key], perTent }
export function tentPlan(active, life, config) {
  const { perTent, maxTents } = tentCfg(config);
  const L = (v) => (life && life[v.key]) || {};
  const homeless = (active || []).filter((v) => !L(v).home);
  const order = homeless.filter((v) => L(v).bed).concat(homeless.filter((v) => !L(v).bed));
  const tents = Math.min(maxTents, Math.ceil(order.length / perTent));
  const slot = {}, outside = [];
  order.forEach((v, i) => { if (i < tents * perTent) slot[v.key] = { tent: Math.floor(i / perTent), i: i % perTent }; else outside.push(v.key); });
  return { tents, slot, outside, perTent };
}

// テントを置ける場所の候補（村のまん中 sq からの位置）。yaw はテントの口（巻き上げた側）の向き（sin, cos）。
//   1 つ目はたき火のうしろ（北）で入口は南（たき火と町の画面のカメラの側）。2 つ目は西で口は東、3 つ目は東（チェストの先）で口は西、4 つ目は 1 つ目のうしろ
//   （1 つ目の奥の壁と 4 つ目の前の壁の間は 3 ほどあける：4 つ目の前で休む人が 1 つ目の壁にめりこまない）
const SPOTS = [[0.5, -3.4, 0], [-8.2, 4.2, Math.PI / 2], [11.6, 4.0, -Math.PI / 2], [0.5, -13.6, 0]];
export function tentCandidates(sq, perTent) {
  const L = tentLen(perTent);
  return SPOTS.map(([dx, dz, yaw]) => ({ x: +(sq.x + dx).toFixed(2), z: +(sq.z + dz).toFixed(2), yaw, len: L, depth: TENT.depth }));
}
// 点がテントの床（pad だけ広げた四角）の中か
export function inTent(t, x, z, pad = 0) {
  const s = Math.sin(t.yaw), c = Math.cos(t.yaw), dx = x - t.x, dz = z - t.z;
  const u = dx * s + dz * c, v = dx * c - dz * s; // u：口の向き、v：長さの向き
  return Math.abs(u) <= t.depth / 2 + pad && Math.abs(v) <= t.len / 2 + pad;
}
// テントの中の位置（u：口の向き、v：長さの向き）→ 地図の位置
export function tentPoint(t, u, v) {
  const s = Math.sin(t.yaw), c = Math.cos(t.yaw);
  return { x: t.x + u * s + v * c, z: t.z + u * c - v * s };
}
// 置くテント：候補のうち、ふさがっていない所（blocked(x, z, r) が true の物にかからない）を前から n 個
export function tentSites(sq, n, perTent, blocked = () => false) {
  const out = [];
  for (const t of tentCandidates(sq, perTent)) {
    if (out.length >= n) break;
    let ok = true;
    for (let u = -t.depth / 2; u <= t.depth / 2 + 1e-6 && ok; u += t.depth / 4) for (let v = -t.len / 2; v <= t.len / 2 + 1e-6 && ok; v += t.len / 8) {
      const p = tentPoint(t, u, v);
      if (blocked(p.x, p.z)) ok = false;
    }
    if (ok) out.push(t);
  }
  return out;
}
// テントの i 番目の寝床（ベッドか敷物）のまん中と向き（yaw は足の側＝テントの口の側。まくらは奥の壁の側）
export function tentBed(t, i, perTent) {
  const v = (i - (perTent - 1) / 2) * TENT.slotW;
  const p = tentPoint(t, BED_U, v);
  return { cx: p.x, cz: p.z, yaw: t.yaw };
}
// テントの中の点 p から外へ出る道（通り道 → 入口の内がわ → 入口の外）。入る時は、これを逆にたどる
export function tentExit(t, p) {
  const s = Math.sin(t.yaw), c = Math.cos(t.yaw), v = (p.x - t.x) * c - (p.z - t.z) * s;
  return [tentPoint(t, AISLE_U, v), tentPoint(t, AISLE_U, 0), tentPoint(t, t.depth / 2 + 1.4, 0)];
}
// テントの口の前（その寝床の人が休む所）
export function tentFront(t, i, perTent, out = 1.1) {
  const v = (i - (perTent - 1) / 2) * TENT.slotW;
  return tentPoint(t, t.depth / 2 + out, v);
}
