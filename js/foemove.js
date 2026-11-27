// 夜の魔物（3 つ目の大きな島＝海の向こうの大陸の上だけ）の、置き場所と歩ける所を決める。three.js も画面も使わない（テストからも読める）。
//   魔物の頭は +x 向き（動物と同じ。animalmove.js の fwd / faceOf）。
//   歩けるのは：その島の岸から margin より内側（海に入らない）、生まれた所と同じ高さ（段をすり抜けない）、
//   見た目の木・岩（terrain_gen の chunkObjects）からはなれた所。体の前のはし・うしろのはしも同じように見る。
import { shoreDist, shorePoint } from './island.js';
import { fwd, quadsOverlap } from './animalmove.js';

export const FOE_KINDS = ['mud', 'wolf', 'shroom'];
export const FOE_JA = { mud: 'どろんこ', wolf: 'かげオオカミ', shroom: 'おばけキノコ' }; // 新しく作った 3 種（前からいる敵の名前は tools/night.js）
// 見た目の大きさの倍率（nightfoes.js もこれを使う）と、体の大きさ（中心から頭の先 f・おしりの先 b・横はば w の半分。倍率をかけたあとの長さ）
//   どろんこは長い腕まで、オオカミは鼻先としっぽまで、キノコは広いかさまで入れる
export const FOE_SCALE = 1.15;
const sc = (o) => ({ f: o.f * FOE_SCALE, b: o.b * FOE_SCALE, w: o.w * FOE_SCALE });
export const FOE_BODY = {
  // 町の画面で模型の箱をはかった大きさ（倍率をかけたあと）に合わせてある
  mud: { f: 1.2, b: 1.0, w: 1.38 }, wolf: { f: 2.52, b: 2.05, w: 0.58 }, shroom: { f: 1.88, b: 1.24, w: 1.3 },
  // 前からいる夜の敵（js/mobs.js の模型。大きさは模型の倍率 2 をかけたあと）。ゾンビは前へのばした腕まで、ガイコツは弓まで、クモは広げた脚まで
  zombie: { f: 1.54, b: 0.9, w: 1.37 }, skeleton: { f: 1.95, b: 1.14, w: 0.82 }, spider: { f: 1.8, b: 1.37, w: 1.78 },
};
export const MOB_KINDS = ['zombie', 'skeleton', 'spider']; // mobs.js の模型を使う種類
// config.nightFoes から、出す魔物の種類の並び（counts：種類ごとの数。なければ kinds を count 体ぶん順に）
export function foeKinds(NF = {}) {
  if (NF.counts && typeof NF.counts === 'object') return Object.entries(NF.counts).filter(([k]) => FOE_BODY[k]).flatMap(([k, n]) => Array(Math.max(0, n | 0)).fill(k));
  const kinds = (NF.kinds || FOE_KINDS).filter((k) => FOE_BODY[k]);
  return Array.from({ length: NF.count ?? 5 }, (_, i) => kinds[i % kinds.length]);
}
// 体の四角（上から見た 4 すみ）。pad だけ大きくする
export function foeQuad(kind, x, z, face, pad = 0) {
  const B = FOE_BODY[kind] || FOE_BODY.mud, v = fwd(face), s = { x: -v.z, z: v.x };
  const f = B.f + pad, b = B.b + pad, w = B.w + pad;
  return [[f, w], [f, -w], [-b, -w], [-b, w]].map(([a, c]) => ({ x: x + v.x * a + s.x * c, z: z + v.z * a + s.z * c }));
}
const TREE_R = 1.3, ROCK_R = 1.9;

const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const u01 = (s) => hashOf(s) / 4294967296;

// 魔物の島：config の island（ふつうは 'far'）。なければ、はじまり島でも北の島でもない、いちばん大きな島
export function foeIsland(world, id = 'far') {
  const list = (world && world.islands) || [];
  return list.find((i) => i.id === id) || list.filter((i) => i.id !== 'main' && i.id !== 'north').sort((a, b) => b.r - a.r)[0] || null;
}

// うろつく場所：魔物の島の、はじまり島に向いた岸から inset だけ内側（村から海ごしに見える所）。半径 roam
export function foeArea(world, isl, S = {}) {
  const main = ((world && world.islands) || []).find((i) => i.id === 'main') || { x: 0, z: 0 };
  const ang = Math.atan2(main.z - isl.z, main.x - isl.x);
  const c = shorePoint(isl, ang, S.inset ?? 12);
  return { x: c.x, z: c.z, r: S.roam ?? 10, ang };
}

// 歩けるかを見る関数を作る。heightAt(x, z)：地面の高さ。obstacles：[{ x, z, r }]（木・岩）
export function makeFoeFits({ isl, heightAt, obstacles = [], margin = 3, area = null }) {
  return (kind, x, z, face, h0) => {
    const B = FOE_BODY[kind] || FOE_BODY.mud, v = fwd(face);
    const pts = [[x, z], [x + v.x * B.f, z + v.z * B.f], [x - v.x * B.b, z - v.z * B.b]];
    for (const [px, pz] of pts) {
      if (shoreDist(isl, px, pz) < margin) return false; // 海・浜のきわには入らない
      if (heightAt && Math.abs(heightAt(px, pz) - h0) > 0.01) return false; // 段の上・下へは行かない（めり込まない）
      for (const o of obstacles) if (Math.hypot(px - o.x, pz - o.z) < o.r + B.w) return false;
    }
    if (heightAt) { // 体のはし（四すみ・横）も同じ高さの地面の上（足が段の壁に入らない）
      const sx = -v.z, sz = v.x, W = B.w + 0.15;
      for (const [a, s] of [[B.f, 1], [B.f, -1], [0, 1], [0, -1], [-B.b, 1], [-B.b, -1]]) {
        if (Math.abs(heightAt(x + v.x * a + sx * W * s, z + v.z * a + sz * W * s) - h0) > 0.01) return false;
      }
    }
    if (area && Math.hypot(x - area.x, z - area.z) > area.r + 3) return false; // うろつく場所から遠くへは行かない
    return true;
  };
}

// 木・岩のリスト（chunkObjects(ci, cj) から、area のまわりのチャンクだけ）
export function foeObstacles(chunkObjects, area, BLOCK, CHUNK) {
  if (!chunkObjects) return [];
  const CH = BLOCK * CHUNK, R = area.r + 8, out = [];
  for (let ci = Math.floor((area.x - R) / CH); ci <= Math.floor((area.x + R) / CH); ci++) {
    for (let cj = Math.floor((area.z - R) / CH); cj <= Math.floor((area.z + R) / CH); cj++) {
      const o = chunkObjects(ci, cj) || {};
      for (const t of o.trees || []) if (Math.hypot(t.x - area.x, t.z - area.z) < R + 3) out.push({ x: t.x, z: t.z, r: TREE_R * (t.size || 1) });
      for (const r of o.rocks || []) if (Math.hypot(r.x - area.x, r.z - area.z) < R + 3) out.push({ x: r.x, z: r.z, r: ROCK_R });
    }
  }
  return out;
}

// n 体の魔物を、area の中の歩ける所に置く（毎晩同じ並びにならないよう seed に日を入れる）。体どうしも重ならない
//   list：種類の並び（foeKinds）。なければ kinds を n 体ぶん順に
//   level：この高さの地面だけに置く（ふつうは 0＝浜ぞいの低い所。段の上の森には置かない。村から海ごしに見える所）
//   gap：ほかの魔物から、少なくともこれだけはなす（かたまって出ないように。置けない時は少しずつ近くてもよくする）
export function spawnFoes({ n, kinds = FOE_KINDS, list = null, area, fits, heightAt, seed = 'foes', level = null, gap = 0 }) {
  const out = [], L = list || Array.from({ length: n }, (_, i) => kinds[i % kinds.length]);
  for (let i = 0; i < L.length; i++) {
    const kind = L[i];
    for (let t = 0; t < 1200; t++) {
      const g = gap * Math.max(0, 1 - t / 900); // 900 回目までに、だんだん gap を小さくする
      if (g > 0 && out.length) {
        const a0 = u01(seed + ':a:' + i + ':' + t) * Math.PI * 2, r0 = Math.sqrt(u01(seed + ':r:' + i + ':' + t)) * area.r;
        const x0 = area.x + Math.cos(a0) * r0, z0 = area.z + Math.sin(a0) * r0;
        if (out.some((f) => Math.hypot(f.x - x0, f.z - z0) < g)) continue;
      }
      const a = u01(seed + ':a:' + i + ':' + t) * Math.PI * 2, r = Math.sqrt(u01(seed + ':r:' + i + ':' + t)) * area.r;
      const x = area.x + Math.cos(a) * r, z = area.z + Math.sin(a) * r, face = u01(seed + ':f:' + i + ':' + t) * Math.PI * 2;
      const h0 = heightAt ? heightAt(x, z) : 0;
      if (level != null && Math.abs(h0 - level) > 0.01) continue;
      if (!fits(kind, x, z, face, h0)) continue;
      if (out.some((f) => foesTouch(f.kind, f.x, f.z, f.face, kind, x, z, face, 0.35))) continue;
      out.push({ i, kind, x, z, face, h0 });
      break;
    }
  }
  return out;
}

// 2 体の体がふれるか（pad だけすき間を見る）
export function foesTouch(k1, x1, z1, f1, k2, x2, z2, f2, pad = 0.15) {
  if (Math.hypot(x1 - x2, z1 - z2) > 6) return false;
  return quadsOverlap(foeQuad(k1, x1, z1, f1, pad / 2), foeQuad(k2, x2, z2, f2, pad / 2));
}

// 次に行く所（slot ごとに変わる）。area の中で、同じ高さの所
export function foeGoal(area, id, slot) {
  const a = u01(id + ':ga:' + slot) * Math.PI * 2, r = (0.25 + 0.75 * Math.sqrt(u01(id + ':gr:' + slot))) * area.r;
  return { x: area.x + Math.cos(a) * r, z: area.z + Math.sin(a) * r };
}
