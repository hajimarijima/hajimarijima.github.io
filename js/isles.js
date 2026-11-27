// 周りの島（海の島々）の決まり（サイト・sim.js・init.js・テストで共通。three.js を使わない）。
//   ここが「周りの島」の元。world.json に前の形（半径 26〜29）が入っていても、読む時（js/tilemap.js の decodeWorld）に
//   まだ橋がかかっていない島はここの形・場所・特徴に置きかえる（data/ は書きかえない。sim が次に保存した時に新しい形で残る）。
//   はじまり島（main）は、外側の海岸だけ一回り広げる（半径 50 → MAIN_R）。家・木・道・拠点の場所はそのまま。
//
//   並び：はじまり島のまわりの輪に 5 つ（近い島・半径 30〜34。1 つは小さい島）、その外に 4 つ（遠い島・半径 36〜40。1 つは小さい島）。
//   島どうし・はじまり島との海は 19 以上あける（橋 1 本の長さ 27〜30）。
//   特徴（traits）は島ごとに 1〜2 個。決まった種（TRAIT_SEED + id）で選ぶので、いつ読んでも同じ。地形（js/terrain_gen.js）に出る。
//   行き先選び・橋の投票は isleList(world) を読めばよい（名前・特徴・本島からの距離・安全か）。
import { bridgeEnds, shoreDist } from './island.js';
export const MAIN_R = 55; // はじまり島の半径（前は 50）

// 特徴：key → { name: 短い名前, desc: 説明, far: 遠い島だけ }
export const TRAITS = {
  ore: { name: '鉱石が多い', desc: '岩山があり、鉱石が見える' },
  fish: { name: '魚が釣りやすい', desc: '入り江と池がある' },
  farm: { name: '作物が育ちやすい', desc: '平らな草地が広い' },
  wood: { name: '木が多い', desc: '丘に森が広がる' },
  treasure: { name: '宝が埋まりやすい', desc: '砂浜と砂地が広い' },
  foe: { name: '敵がちょっと多い', desc: '暗い森と崖。遠い島だけ', far: true },
};
// 一緒に付けない組（平らな草地と森は逆の地形）
const CLASH = [['farm', 'wood']];

// ring 1 = 本島のとなり（近い・安全）、ring 2 = その外（遠い・敵が出る）。from：橋をかける元の島
export const SEA_ISLES = [
  { id: 'iwa', name: 'のはら島', x: 100, z: 53, r: 32, wob: [[0.08, 4, 0.9], [0.05, 7, 2.2]], ring: 1, from: 'main' },
  { id: 'minami', name: 'みなみ島', x: 18, z: 105, r: 30, wob: [[0.1, 2, 0.3], [0.04, 5, 2.6]], ring: 1, from: 'main' },
  { id: 'kame', name: 'かめ島', x: -74, z: 88, r: 34, wob: [[0.06, 3, 1.1], [0.04, 6, 0.2]], ring: 1, from: 'main' },
  { id: 'kujira', name: 'くじら島', x: -109, z: 0, r: 33, wob: [[0.16, 2, 0], [0.04, 3, 0.6]], ring: 1, from: 'main' },
  { id: 'mori', name: 'みさき島', x: -67, z: -74, r: 21, wob: [[0.07, 3, 0.2], [0.05, 5, 1.8]], ring: 1, from: 'main' },
  { id: 'umineko', name: 'うみねこ島', x: 144, z: 136, r: 38, wob: [[0.08, 3, 0.8], [0.05, 5, 0.1]], ring: 2, from: 'iwa' },
  { id: 'takara', name: 'たから島', x: 3, z: 192, r: 40, wob: [[0.09, 3, 2.4], [0.05, 4, 1.0]], ring: 2, from: 'minami' },
  { id: 'yuuhi', name: 'ゆうひ島', x: -155, z: 135, r: 36, wob: [[0.07, 3, 1.5], [0.05, 5, 0.4]], ring: 2, from: 'kame' },
  { id: 'hoshi', name: 'ほし島', x: -131, z: -104, r: 25, wob: [[0.1, 5, 0.3], [0.05, 3, 1.2]], ring: 2, from: 'mori' },
];
// 飾りの小島（橋はかからない。特徴なし）
export const DECOR_ISLES = [
  { id: 'kotori', name: 'ことり島', x: 44, z: -67, r: 6.5, wob: [[0.12, 3, 0.5], [0.06, 5, 1.2]], look: 'small' },
  { id: 'kojima', name: 'こじま', x: 104, z: -5, r: 7, wob: [[0.14, 3, 2.0], [0.06, 5, 0.7]], look: 'rocky' },
];

function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rngOf(s) { let a = hash32(s); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 島の特徴（1〜2 個）。遠い島（ring 2）だけ「敵がちょっと多い」が出る
export const TRAIT_SEED = 'isle-trait:v58:';
export function traitsOf(spec, seed = TRAIT_SEED) {
  const R = rngOf(seed + spec.id);
  const pool = Object.keys(TRAITS).filter((k) => !TRAITS[k].far || spec.ring >= 2);
  const n = R() < 0.5 ? 1 : 2, out = [];
  for (let tries = 0; out.length < n && tries < 40; tries++) {
    const k = pool[Math.floor(R() * pool.length)];
    if (out.includes(k) || CLASH.some(([a, b]) => (k === a && out.includes(b)) || (k === b && out.includes(a)))) continue;
    out.push(k);
  }
  return out;
}
// 地形の見た目の元（いちばん目立つ特徴）。古い look（rocky・forest・beach…）の代わり
const LOOK_OF = { ore: 'rocky', wood: 'forest', treasure: 'beach', fish: 'cove', farm: 'meadow', foe: 'dark' };
const lookOf = (traits) => LOOK_OF[traits.includes('foe') ? 'foe' : traits[0]] || 'forest';

// world.islands に入れる形（open は 0）
export function seaIslandsNew() {
  return SEA_ISLES.map(({ from, ...s }) => { const traits = traitsOf(s); return { ...s, wob: s.wob.map((w) => w.slice()), look: lookOf(traits), traits, safe: s.ring < 2, open: 0 }; })
    .concat(DECOR_ISLES.map((d) => ({ ...d, wob: d.wob.map((w) => w.slice()), open: 0 })));
}

// 読んだ world を今の決まりに合わせる（何度呼んでも同じ）。
//   - はじまり島の半径を MAIN_R まで広げる（中の物は動かさない）
//   - 周りの島：まだ開いていない島は、ここの形・場所・特徴に置きかえる。開いた島は場所と形はそのまま（特徴だけ足す）
//   - まだかかっていない橋の両はしを、新しい岸に合わせる
export function applyIsles(world) {
  if (!world || !Array.isArray(world.islands) || !world.islands.length) return world;
  const main = world.islands.find((i) => i.id === 'main');
  if (main && main.r < MAIN_R) main.r = MAIN_R;
  const fresh = Object.fromEntries(seaIslandsNew().map((i) => [i.id, i]));
  const has = new Set(world.islands.map((i) => i.id));
  world.islands = world.islands.map((isl) => {
    const f = fresh[isl.id];
    if (!f) return isl;
    if (isl.open) return { ...isl, traits: f.traits, ring: f.ring, safe: f.safe };
    return { ...f };
  });
  // world.json にまだない周りの島は足す（橋はかけない。古い町のため）
  for (const f of Object.values(fresh)) if (!has.has(f.id) && f.traits && world.layout === 'island') world.islands.push(f);
  if (Array.isArray(world.bridges)) {
    const by = Object.fromEntries(world.islands.map((i) => [i.id, i]));
    for (const br of world.bridges) {
      if (br.built) continue;
      const a = by[br.from || 'main'], b = by[br.to];
      if (!a || !b) continue;
      const e = bridgeEnds(a, b, 2.5);
      br.a = { x: +e.a.x.toFixed(2), z: +e.a.z.toFixed(2) }; br.b = { x: +e.b.x.toFixed(2), z: +e.b.z.toFixed(2) };
      if (b.name) br.name = b.name + 'への橋';
    }
  }
  return world;
}

// 行き先選び・橋の投票の元：周りの島（橋のかかる島）の一覧
//   [{ id, name, r, traits: [key], traitNames: [名前], ring, safe, from, gap: 本島の岸からの海の幅, dist: 本島の中心からの距離, hops: 橋の数, open }]
export function isleList(world) {
  const isl = (world && world.islands) || [];
  const main = isl.find((i) => i.id === 'main') || { x: 0, z: 0, r: MAIN_R };
  const spec = Object.fromEntries(SEA_ISLES.map((s) => [s.id, s]));
  const hops = (id) => { let n = 0; for (let k = id; k && k !== 'main' && n < 9; k = (spec[k] || {}).from) n++; return n; };
  return isl.filter((i) => spec[i.id]).map((i) => {
    const traits = i.traits || traitsOf(spec[i.id]);
    let gap = Infinity;
    { for (let k = 0; k < 120; k++) { const a = (k / 120) * Math.PI * 2, R0 = i.r * (1 + (i.wob || []).reduce((s, w) => s + w[0] * Math.sin(w[1] * a + w[2]), 0)); gap = Math.min(gap, -shoreDist(main, i.x + Math.cos(a) * R0, i.z + Math.sin(a) * R0)); } }
    return { id: i.id, name: i.name, r: i.r, traits, traitNames: traits.map((t) => TRAITS[t].name), ring: spec[i.id].ring, safe: spec[i.id].ring < 2, from: spec[i.id].from, gap: Math.round(gap), dist: Math.round(Math.hypot(i.x - main.x, i.z - main.z)), hops: hops(i.id), open: i.open || 0 };
  });
}
