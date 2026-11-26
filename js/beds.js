// ベッドの大きさと置き場所（js/town.js とテストで共通。three は使わない）
import { TILE } from './tilemap.js';

// マイクラのベッド（はば 1 マス・長さ 2 マス）より少し小さくする。はばと高さは 75%、長さは 80%
export const BED_SCALE = { w: 0.75, l: 1.0, h: 0.75 }; // 長さは元のまま（短くすると寝ている人の足がはみ出す）
export const BED = { w: TILE * BED_SCALE.w, l: 2 * TILE * BED_SCALE.l, h: 0.6 * BED_SCALE.h };
// 横になった体の長さ（足のうら → 頭のてっぺん。村人は 32px＝2 ブロック、2 頭身は 26.2px。scale 1.9）
export const BODY_LEN = { normal: (32 / 16) * 1.9, chibi: (26.2 / 16) * 1.9 };
// まくら側の板の内側（板の厚み＋少しのすき間）。頭はここまで
const HEAD_GAP = 0.16 * BED_SCALE.l + 0.06;

// ベッドの部品（中心からの位置と大きさ。town.js がこのまま箱にする）。[w, h, d, x, y, z, 色]
export function bedParts() {
  const { w, l } = BED, k = BED_SCALE.h;
  return [
    [w, 0.32 * k, l, 0, 0.26 * k, 0, 0xa87040],                                     // 木の台
    [w - 0.06, 0.16 * k, l * 0.7, 0, 0.5 * k, l * 0.14, 0xcc3c3c],                   // 掛けぶとん（足の側）
    [w * 0.72, 0.18 * k, 0.7 * BED_SCALE.l, 0, 0.5 * k, -l / 2 + 0.6 * BED_SCALE.l, 0xf2efe6], // まくら
    [w, 1.1 * k, 0.16 * BED_SCALE.l, 0, 0.55 * k, -l / 2 + 0.08 * BED_SCALE.l, 0x6e4524],   // まくら側の板
  ];
}

// ベッドの上で寝る人の足の位置。頭がまくら側の板のすぐ内側に来るようにする（体が長い人は足がベッドの先から少し出る）。
// bed = { cx, cz, yaw }（yaw の向きが足の側）
export function sleeperOnBed(bed, chibi = false) {
  const zf = -BED.l / 2 + HEAD_GAP + (chibi ? BODY_LEN.chibi : BODY_LEN.normal);
  return { x: bed.cx + Math.sin(bed.yaw) * zf, z: bed.cz + Math.cos(bed.yaw) * zf, yaw: bed.yaw };
}

// 家の中のベッド：家の床（look.w × look.d、向き b.rot）の中に、住む順（slot）で横に並べる。
// 長い向きにそろえ、入る数より多い人は同じ並びにもう一度置く（家は外から中が見えないので、重なっても見えない）。
// 戻り値 { cx, cz, yaw, inside: true }
export function bedInHouse(b, look, slot = 0) {
  const rot = b.rot || 0, w = look.w || 3, d = look.d || 3;
  const alongD = d >= w; // ベッドの長さを家の長い辺にそろえる
  const across = alongD ? w : d;
  const n = Math.max(1, Math.floor((across - 0.2) / (BED.w + 0.1)));
  const i = slot % n;
  const off = (i - (n - 1) / 2) * (across / n); // 家の中で横にずらす（家の向きの x か z）
  const lx = alongD ? off : 0, lz = alongD ? 0 : off;
  const yaw = rot + (alongD ? Math.PI : Math.PI / 2); // 足は家の奥（扉と反対）の側。まくらは扉の側
  // 家の向きでまわす（three の rotation.y と同じ：x' = x cos + z sin、z' = -x sin + z cos）
  const cx = b.x + lx * Math.cos(rot) + lz * Math.sin(rot), cz = b.z - lx * Math.sin(rot) + lz * Math.cos(rot);
  return { cx, cz, yaw, inside: true };
}

// 点が家の床の中か（margin だけ内側）
export function insideHouse(p, b, look, margin = 0) {
  const rot = b.rot || 0, dx = p.x - b.x, dz = p.z - b.z;
  const lx = dx * Math.cos(rot) - dz * Math.sin(rot), lz = dx * Math.sin(rot) + dz * Math.cos(rot);
  return Math.abs(lx) <= look.w / 2 - margin && Math.abs(lz) <= look.d / 2 - margin;
}
// ベッドの 4 つの角
export function bedCorners(bed) {
  const s = Math.sin(bed.yaw), c = Math.cos(bed.yaw), out = [];
  for (const a of [-1, 1]) for (const e of [-1, 1]) { const u = a * BED.w / 2, v = e * BED.l / 2; out.push({ x: bed.cx + u * c + v * s, z: bed.cz - u * s + v * c }); }
  return out;
}
