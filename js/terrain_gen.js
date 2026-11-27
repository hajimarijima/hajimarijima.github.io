// どこまでも続く地形の「形」だけを決める（three.js を使わない。サイトとテストで共通）。
// 1 ブロック = BLOCK（村人の背が 2 ブロック）。チャンク = CHUNK × CHUNK ブロック。
// 同じシードなら、いつ・どこから作っても同じ形になる（チャンクの順番に左右されない）。
//   - 町（sim.js が木や岩を置く範囲 zone）の中は平らな草地。南（seaZ より先）は海で、境目は砂浜
//   - 外へ行くほど、ノイズで 丘・山（高いと石・雪）・川（くねった帯）・小さな湖・森の濃い所と薄い所 が出てくる
//   - 建物（予定地も）のまわり keepR ブロックには、木も岩も作らない
import { shoreDist } from './island.js';
export const BLOCK = 1.9;
export const CHUNK = 16;

// ---------- ノイズ（シードつきのパーリンノイズ） ----------
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeNoise(seed) {
  const R = rngFrom(seed), p = new Uint8Array(512), perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
    const g = (ix, iy, dx, dy) => { const v = G[p[p[ix] + iy] & 7]; return v[0] * dx + v[1] * dy; };
    const u = fade(xf), v = fade(yf);
    const a = g(xi, yi, xf, yf) + u * (g(xi + 1, yi, xf - 1, yf) - g(xi, yi, xf, yf));
    const b = g(xi, yi + 1, xf, yf - 1) + u * (g(xi + 1, yi + 1, xf - 1, yf - 1) - g(xi, yi + 1, xf, yf - 1));
    return (a + v * (b - a)) * 1.1; // だいたい -1〜1
  };
}
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// zone：{ x0, x1, z0, z1 }（町の範囲・ワールド座標）。keepOut：[{ x, z, r }]（r はワールド座標の半径。建物と予定地）
// islands：島の形の町（world.islands）。渡すと、島の上だけが平らな陸（ふちは砂浜）で、まわりはぜんぶ海になる。
//   木と岩はぜんぶ world.json の物（島の外の見た目だけの木と岩は作らない）。渡さなければ前のとおり。
export function makeTerrain({ seed = 'town', zone = { x0: -112, x1: 112, z0: -112, z1: 36 }, seaZ = 34, keepOut = [], keepR = 4, islands = null } = {}) {
  if (islands && islands.length) return makeIslandTerrain({ islands, seaZ, zone });
  const S = hash32(String(seed));
  const nC = makeNoise(S ^ 0x1111), nM = makeNoise(S ^ 0x2222), nH = makeNoise(S ^ 0x3333), nR = makeNoise(S ^ 0x4444),
    nL = makeNoise(S ^ 0x5555), nF = makeNoise(S ^ 0x6666), nK = makeNoise(S ^ 0x7777), nW = makeNoise(S ^ 0x8888);
  const fbm = (n, x, y, o = 3) => { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < o; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.03; } return s / t; };
  const cellHash = (i, j, k) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k + 1, 2147483647) + S; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const keep = keepOut.map((o) => ({ x: o.x, z: o.z, r: (o.r || 0) + keepR * BLOCK }));
  const nearBuilding = (x, z) => keep.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r);
  // 町の四角からの距離（中は 0）
  const outside = (x, z) => { const dx = Math.max(zone.x0 - x, 0, x - zone.x1), dz = Math.max(zone.z0 - z, 0, z - zone.z1); return Math.hypot(dx, dz); };
  const cache = new Map();

  // 1 ブロック（i, j）の形：h = 高さ（ブロック。0 が町の地面、-1 以下は水の底）、kind = grass / sand / stone / snow / water
  function cell(i, j) {
    const key = i * 100003 + j;
    const hit = cache.get(key); if (hit) return hit;
    const x = (i + 0.5) * BLOCK, z = (j + 0.5) * BLOCK;
    const d = outside(x, z), w = smooth(0, 70, d); // 町から離れるほど 1
    // 陸と海：南（seaZ より先）は海。ずっと南へ行くと、また陸（島）が出る
    const zz = z + nW(x / 420, 3.7) * 140 * smooth(0, 120, d); // 海岸線は外ほど大きく波打つ
    const ocean = smooth(seaZ - 40, seaZ + 40, zz) * (1 - smooth(seaZ + 320, seaZ + 520, zz));
    const cont = fbm(nC, x / 300, z / 300);
    const eWild = 0.32 + cont * 0.9 - ocean * 1.25;
    const eTown = Math.max(-1, Math.min(0.5, (seaZ + 1.5 - z) / 7)) + (nW(x / 40, 0.5) * 0.4) * smooth(0, 30, d); // 町の海岸はまっすぐ、外へ行くほど波打つ
    const e = eTown + (eWild - eTown) * w;
    let h = 0, kind = 'grass';
    if (e <= 0) { h = e < -0.35 ? -2 : -1; kind = 'water'; }
    else {
      // 山（尾根）と丘
      const ridge = Math.pow(1 - Math.abs(nM(x / 190, z / 190)), 3);
      const mMask = smooth(0.18, 0.5, fbm(nK, x / 700 + 11.3, z / 700 - 7.1, 2));
      const hills = fbm(nH, x / 80, z / 80);
      const raw = Math.max(0, e - 0.2) * 5 + mMask * ridge * 18 + Math.max(0, hills) * 4.2;
      h = Math.round(raw * w);
      // 川（くねった細い帯）：低い所だけを流れる
      const rv = Math.abs(fbm(nR, x / 620 + 40.7, z / 620 - 3.3, 2));
      const lake = fbm(nL, x / 110 + 100.1, z / 110 - 40.4, 2);
      const wk = smooth(0.25, 0.75, w); // 町に近づくと川は細くなって消え、湖は小さくなる
      if (wk > 0 && raw < 4.5) {
        if (rv < 0.018 * wk) { h = -1; kind = 'water'; }
        else if (lake > 0.4 + (1 - wk) * 0.3) { h = lake > 0.44 ? -2 : -1; kind = 'water'; }
        else if (rv < 0.03 * wk || lake > 0.36 + (1 - wk) * 0.3) { h = 0; kind = 'sand'; }
      }
      if (kind === 'grass') {
        if (e < 0.07 && h <= 0) kind = 'sand';            // 砂浜
        else if (h >= 13) kind = 'snow';                  // 高い山は雪
        else if (h >= 7) kind = 'stone';                  // 山の石
      }
    }
    const c = { h, kind, w };
    if (cache.size > 400000) cache.clear();
    cache.set(key, c);
    return c;
  }
  // 森の濃さ（0〜1）：濃い所と薄い所がある
  const forest = (x, z) => Math.max(0, Math.min(1, (fbm(nF, x / 150 - 30.2, z / 150 + 80.9, 2) + 0.12) * 1.9));
  // チャンクの中の木と岩（3 ブロックごとの格子で、ずらして置く）。町の中（sim.js の木と岩がある所）と建物のまわりには置かない
  function chunkObjects(ci, cj) {
    const trees = [], rocks = [];
    const i0 = ci * CHUNK, j0 = cj * CHUNK;
    for (let gi = 0; gi < CHUNK; gi += 3) for (let gj = 0; gj < CHUNK; gj += 3) {
      const i = i0 + gi + Math.floor(cellHash(i0 + gi, j0 + gj, 1) * 3), j = j0 + gj + Math.floor(cellHash(i0 + gi, j0 + gj, 2) * 3);
      if (i >= i0 + CHUNK || j >= j0 + CHUNK) continue;
      const x = (i + 0.5) * BLOCK, z = (j + 0.5) * BLOCK;
      if (outside(x, z) < 6) continue; // 町の中は sim.js の木と岩
      const c = cell(i, j);
      if (c.kind === 'water' || c.kind === 'sand' || c.kind === 'snow') continue;
      if (nearBuilding(x, z)) continue;
      // 4 方向のどれかが水なら置かない（水ぎわ）
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => cell(i + a, j + b).kind === 'water')) continue;
      const r = cellHash(i, j, 3);
      const p = c.kind === 'stone' ? 0.08 : 0.04 + forest(x, z) * 0.78;
      if (r < p && c.kind === 'grass') trees.push({ id: 'w' + i + '_' + j, x, z, y: c.h * BLOCK, state: 'tree', kind: Math.floor(cellHash(i, j, 4) * 3), size: 0.85 + cellHash(i, j, 5) * 0.35 });
      else if (r > (c.kind === 'stone' ? 0.8 : 0.965)) rocks.push({ id: 'wr' + i + '_' + j, x, z, y: c.h * BLOCK, hp: 10, max: 10, kind: Math.floor(cellHash(i, j, 6) * 3), blocks: 'ssssssssss' });
    }
    return { trees, rocks };
  }
  const heightAt = (x, z) => { const c = cell(Math.floor(x / BLOCK), Math.floor(z / BLOCK)); return c.h > 0 ? c.h * BLOCK : 0; };
  return { cell, chunkObjects, heightAt, forest, outside, nearBuilding, zone, seaZ };
}

// 島の形の地形：島の中は平らな草地、岸から BEACH までは砂浜、外は海（岸から 8 より先は深い）
const BEACH = 3.8;

// ---------- 周りの島（traits のある島）の地形 ----------
//   まん中（半径の 0.5 まで）は家の区画のために平ら（高さ 0）。その外に特徴ごとの地形：
//   ore 岩山（石の段と鉱石のブロック）・fish 入り江と池・farm 平らな草地・wood 森の丘・treasure 広い砂浜と砂丘・foe 暗い草と崖
//   崖・入り江・岩山は、橋の来る向き（となりの島の向き）からはずす
const NI = makeNoise(0x1a5e), NJ = makeNoise(0x2b6f), NK = makeNoise(0x3c70);
const mix32 = (i, j) => { let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j + 0x9e37, 0x165667b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const angGap0 = (p, q) => Math.abs(((p - q + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const HILL = { wood: 5, foe: 5, ore: 3, fish: 2.4, treasure: 2, farm: 1 };
function isleFeatures(isl, toward, main) {
  const T = isl.traits || [], has = (k) => T.includes(k);
  const R = rngFrom(hash32('isle-shape:' + isl.id));
  const out = Math.atan2(isl.z - main.z, isl.x - main.x); // 本島と反対の向き
  const used = [];
  // 橋の向き・ほかの地形から離れた向きを 1 つ選ぶ
  const pick = (w, must = false) => {
    const cands = [0, 0.9, -0.9, 1.7, -1.7, 2.4, -2.4].map((d) => out + d + (R() - 0.5) * 0.3);
    for (const a of cands) if (toward.every((t) => angGap0(t, a) > w + 0.55) && used.every(([b, wb]) => angGap0(a, b) > w + wb + 0.15)) { used.push([a, w]); return a; }
    if (!must) return null;
    // どこも空いていない時（となりの島が多い小さな島）は、橋の向きからいちばん離れた向き
    let best = out, bd = -1;
    for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2, d = Math.min(...toward.map((t) => angGap0(t, a)), ...used.map(([b]) => angGap0(a, b))); if (d > bd) { bd = d; best = a; } }
    used.push([best, w]); return best;
  };
  const f = { isl, T, rc: isl.r * 0.5 };
  if (has('ore')) { const a = pick(0.7, true); if (a !== null) f.mtn = { x: isl.x + Math.cos(a) * isl.r * 0.52, z: isl.z + Math.sin(a) * isl.r * 0.52, r: isl.r * (isl.r < 26 ? 0.34 : 0.4), h: isl.r > 28 ? 7 : 5 }; }
  if (has('fish')) {
    const a = pick(0.4);
    if (a !== null) f.inlet = { a, w: 0.4, d: isl.r * 0.55 };
    const b = (a === null ? out : a) + Math.PI + (R() - 0.5) * 0.8, rq = isl.r < 26 ? 4 : Math.max(5.5, isl.r * 0.17); // 小さい島は池も小さく（家の場所を残す）
    f.pond = { x: isl.x + Math.cos(b) * isl.r * (isl.r < 26 ? 0.5 : 0.36), z: isl.z + Math.sin(b) * isl.r * (isl.r < 26 ? 0.5 : 0.36), r: rq };
  }
  if (has('foe') || has('ore') || has('wood')) { const a = pick(0.55); if (a !== null) f.cliff = { a, w: 0.55, h: has('foe') ? 4 : 3 }; }
  f.amp = has('farm') ? Math.max(1, Math.max(...T.map((k) => HILL[k])) * 0.45) : Math.max(...T.map((k) => HILL[k])); // 作物の島はふちに低い段だけ
  f.beach = has('treasure') ? 7.5 : BEACH;
  return f;
}
function isleCell(f, x, z, sd, i, j) {
  const { isl, T } = f;
  const dx = x - isl.x, dz = z - isl.z, dc = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
  const ch = (k) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k + 1, 2147483647) + 0x77; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // 入り江：岸を内側へ引っこめる
  let s = sd;
  if (f.inlet) { const g = angGap0(ang, f.inlet.a); if (g < f.inlet.w) { const u = g / f.inlet.w; s = sd - f.inlet.d * (1 - u * u) * (0.85 + NI(x / 9, z / 9) * 0.15); } }
  if (s < 0) return { h: s < -3.5 ? -2 : -1, kind: 'water', w: 0, inner: 1 };
  if (f.pond) { const dq = Math.hypot(x - f.pond.x, z - f.pond.z) - NI(x / 6, z / 6) * 1.8; /* ふちをゆらして四角に見せない */ if (dq < f.pond.r) return { h: dq < f.pond.r * 0.5 ? -2 : -1, kind: 'water', w: 0, inner: 1 }; if (dq < f.pond.r + 1.7) return { h: 0, kind: 'sand', w: 0 }; }
  // 崖：その向きの岸は砂浜がなく、海からすぐ高い
  let cliff = 0;
  if (f.cliff) { const g = angGap0(ang, f.cliff.a); if (g < f.cliff.w) { const u = g / f.cliff.w; cliff = (1 - u * u) * (1 - smooth(isl.r * 0.18, isl.r * 0.42, s)); } }
  const beach = cliff > 0.25 ? 0 : f.beach;
  let h = 0, kind = s < beach ? 'sand' : 'grass';
  // 丘：まん中の平らな所の外だけ
  if (f.amp > 0) {
    const m = smooth(f.rc, f.rc + 6, dc) * smooth(beach, beach + 5, s);
    const hv = NJ(x / 26, z / 26) * 1.7 + NJ(x / 11 + 9.1, z / 11 - 3.3) * 0.25 + 0.12; // 大きめの丘（1 マスだけ飛び出さない）
    h = Math.max(0, Math.floor(hv * f.amp * m));
  }
  if (cliff > 0) { const hc = Math.round(f.cliff.h * Math.min(1, cliff * 1.6)); if (hc > h) h = hc; if (h > 0 && kind === 'sand') kind = 'grass'; if (s < 2.2 && h >= 2 && NK(x / 4, z / 4) > -0.1) kind = 'stone'; }
  // 岩山：段になった石。ところどころ鉱石のブロック
  if (f.mtn) {
    const dm = Math.hypot(x - f.mtn.x, z - f.mtn.z), u = 1 - dm / f.mtn.r + NK(x / 6, z / 6) * 0.12;
    if (u > 0) { const hm = Math.round(Math.min(1, u * 1.5) * f.mtn.h); if (hm >= h) { h = hm; if (h >= 1) kind = 'stone'; } }
  }
  if (kind === 'stone' && h >= 1 && ch(9) < 0.13) { const r = ch(10); kind = r < 0.5 ? 'ore_c' : r < 0.85 ? 'ore_i' : 'ore_g'; }
  // 宝の島：砂丘と、草地の中の砂地
  if (T.includes('treasure')) {
    if (kind === 'sand' && s > 2 && NK(x / 13 + 2.7, z / 13 + 8.1) > 0.25) h = Math.max(h, 1); // 砂丘：大きめのかたまり
    else if (kind === 'grass' && h === 0 && dc > f.rc * 0.6 && NI(x / 20 + 4.2, z / 20 - 7.7) > 0.4) kind = 'sand';
  }
  // 敵の多い島：暗い草と暗い石
  if (T.includes('foe')) { if (kind === 'grass') kind = 'dgrass'; else if (kind === 'stone') kind = 'dstone'; }
  return { h, kind, w: 0 };
}
// 周りの島の見た目だけの木と岩の多さ [木, 岩]（3 ブロックに 1 つの格子の目ごと）
const TRAIT_OBJ = { wood: [0.85, 0.02], foe: [0.55, 0.03], ore: [0.12, 0.08], fish: [0.2, 0.02], treasure: [0.12, 0.02], farm: [0.07, 0.015] };
// まだ行けない海の島（look）の見た目だけの木と岩の多さ [木, 岩]（3 ブロックに 1 つの格子の目ごと）
const ISLE_OBJ = { forest: [0.55, 0.02], long: [0.3, 0.04], small: [0.35, 0.04], rocky: [0.12, 0.22], beach: [0.18, 0.03] };
//   wild の島（遠くの大陸）だけは、内側へ行くほど丘と山（高い所は石と雪）になり、見た目だけの森がある
function makeIslandTerrain({ islands, seaZ, zone }) {
  const cache = new Map();
  const nH = makeNoise(0x51a7), nM = makeNoise(0x77e1), nF = makeNoise(0x3c3c);
  const fbm = (n, x, y, o = 3) => { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < o; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.03; } return s / t; };
  const cellHash = (i, j, k) => { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k + 1, 2147483647) + 0x2545; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // 島ごとの外わく（遠い島は shoreDist を計算しない）と、となりの島の向き（rocky の岩の柱を橋の通り道に立てない）
  const reach = islands.map((isl) => isl.r * (1 + (isl.wob || []).reduce((s, w) => s + Math.abs(w[0]), 0)) + 12);
  const toward = islands.map((a) => islands.filter((b) => b !== a && !b.wild && Math.hypot(b.x - a.x, b.z - a.z) < a.r + b.r + 60).map((b) => Math.atan2(b.z - a.z, b.x - a.x)));
  const angGap = (p, q) => Math.abs(((p - q + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const main0 = islands.find((i) => i.id === 'main') || { x: 0, z: 0 };
  // 周りの島（特徴 traits のある島）の地形の元：岩山・入り江・池・崖の場所。橋の来る向き（toward）にはかけない
  const feat = islands.map((isl, k) => isl.traits ? isleFeatures(isl, toward[k], main0) : null);
  function cell(i, j) {
    const key = i * 100003 + j;
    const hit = cache.get(key); if (hit) return hit;
    const x = (i + 0.5) * BLOCK, z = (j + 0.5) * BLOCK;
    let sd = -Infinity, best = null, bi = -1;
    for (let k = 0; k < islands.length; k++) {
      const isl = islands[k];
      if (Math.abs(x - isl.x) > reach[k] || Math.abs(z - isl.z) > reach[k]) continue;
      const d = shoreDist(isl, x, z); if (d > sd) { sd = d; best = isl; bi = k; }
    }
    if (!best) sd = -99;
    let c;
    const look = best && best.look, closed = look && !best.open;
    if (best && feat[bi] && sd >= 0) {
      c = isleCell(feat[bi], x, z, sd, i, j);
      c.k = bi; if (closed) c.isle = 1;
      if (cache.size > 400000) cache.clear();
      cache.set(key, c);
      return c;
    }
    if (sd < 0) {
      c = { h: sd < -8 ? -2 : -1, kind: 'water', w: 0 };
      // 岩の多い島（rocky）：まわりの浅い海に岩の柱（陸ではないので歩かない）。となりの島の向き（橋が通る所）にはない
      if ((look === 'rocky' || (best && (best.traits || []).includes('ore'))) && sd > -7 && sd < -0.8) {
        const ang = Math.atan2(z - best.z, x - best.x);
        if (!toward[bi].some((t) => angGap(t, ang) < 0.45) && nH(x / 7, z / 7) > 0.32) {
          const r = cellHash(i, j, 8);
          if (r < 0.55) c = { h: 1 + Math.floor(r * 5.5), kind: 'stone', w: 0, stack: 1 };
        }
      }
    } else if (look) {
      // 海の島：岸から beach までは砂浜（beach の島は広い）。rocky の島は砂浜と草地に岩肌がまじる。陸の上はどこも高さ 0（村人が歩く）
      const beach = look === 'beach' ? 7.5 : look === 'small' ? 2.6 : BEACH;
      const rough = look === 'rocky' && nM(x / 9, z / 9) > 0.18;
      c = { h: 0, kind: rough ? 'stone' : sd < beach ? 'sand' : 'grass', w: 0, isle: closed ? look : '' };
    } else if (best && best.wild && sd >= BEACH) {
      const ridge = Math.pow(1 - Math.abs(nM(x / 140, z / 140)), 3);
      const raw = smooth(BEACH, 70, sd) * (2 + Math.max(0, fbm(nH, x / 90, z / 90) + 0.25) * 9 + ridge * 16 * smooth(30, 120, sd));
      const h = Math.round(raw);
      c = { h, kind: h >= 13 ? 'snow' : h >= 8 ? 'stone' : 'grass', w: 0, wild: 1 };
    } else c = { h: 0, kind: sd < BEACH ? 'sand' : 'grass', w: 0 };
    if (cache.size > 400000) cache.clear();
    cache.set(key, c);
    return c;
  }
  // 見た目だけの木と岩（wild の島の上だけ）
  function chunkObjects(ci, cj) {
    const trees = [], rocks = [];
    const i0 = ci * CHUNK, j0 = cj * CHUNK;
    for (let gi = 0; gi < CHUNK; gi += 3) for (let gj = 0; gj < CHUNK; gj += 3) {
      const i = i0 + gi + Math.floor(cellHash(i0 + gi, j0 + gj, 1) * 3), j = j0 + gj + Math.floor(cellHash(i0 + gi, j0 + gj, 2) * 3);
      if (i >= i0 + CHUNK || j >= j0 + CHUNK) continue;
      const c = cell(i, j);
      const x = (i + 0.5) * BLOCK, z = (j + 0.5) * BLOCK, r = cellHash(i, j, 3);
      // 周りの島（traits）：まだ行けない間は見た目だけの木と岩。段の上の物はその高さに置く。
      //   木は段の上にも立つ（幹はそのマスの中）。葉が崖に入らないように、まわり 2 マスに 3 段以上高い所がない所だけ。
      //   岩はまわり 8 マスが同じ高さの所だけ（ふちから浮かない）
      if (c.k !== undefined && feat[c.k]) {
        if (!c.isle || c.kind === 'water') continue;
        const T = feat[c.k].T, farm = T.includes('farm');
        const r = mix32(i, j); // 格子の目の選び方と相関のない 0〜1
        const pt0 = T.reduce((p, k) => (farm ? Math.min(p, TRAIT_OBJ[k][0]) : Math.max(p, TRAIT_OBJ[k][0])), farm ? 1 : 0);
        // 木の少ない島は、ばらばらに置かず小さな林にまとめる
        const pt = pt0 >= 0.15 ? pt0 : NK(x / 16 + 5.5, z / 16 - 2.2) > 0.3 ? 0.5 : pt0 * 0.25;
        const pr = Math.max(...T.map((k) => TRAIT_OBJ[k][1])) + (c.kind !== 'grass' && c.kind !== 'dgrass' && c.kind !== 'sand' ? 0.12 : 0);
        const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => cell(i + a, j + b));
        const y = c.h * BLOCK;
        if ((c.kind === 'grass' || c.kind === 'dgrass') && r < pt) {
          // 木（幹は 1 マスの中・葉は地面から 3 ブロックほど上で、まわり 2 マスに広がる）：まわり 2 マスに 3 段以上高い所がなく、となりに水がない
          let ok = !n4.some((n) => n.kind === 'water');
          for (let a = -2; ok && a <= 2; a++) for (let b = -2; ok && b <= 2; b++) { const n = cell(i + a, j + b); if (n.h > c.h + 2 || (Math.abs(a) + Math.abs(b) <= 1 && n.kind === 'sand' && n.h >= c.h)) ok = false; }
          if (ok) trees.push({ id: 'w' + i + '_' + j, x, z, y, state: 'tree', kind: Math.floor(cellHash(i, j, 4) * 3), size: 0.8 + cellHash(i, j, 5) * 0.4 });
        } else if (r > 1 - pr && c.kind !== 'sand') {
          // 岩（1 マスより広い）：まわり 8 マスが同じ高さの所だけ（ふちから浮かない・段に埋まらない）
          let flat = true;
          for (let a = -1; flat && a <= 1; a++) for (let b = -1; flat && b <= 1; b++) { const n = cell(i + a, j + b); if (n.h !== c.h || n.kind === 'water') flat = false; }
          if (!flat) continue;
          const ore = T.includes('ore') && cellHash(i, j, 7) < 0.6 ? 'ciig'[Math.floor(cellHash(i, j, 8) * 4)] : 's';
          rocks.push({ id: 'wr' + i + '_' + j, x, z, y, hp: 10, max: 10, kind: Math.floor(cellHash(i, j, 6) * 3), blocks: ore === 's' ? 'ssssssssss' : 'ssssss' + ore + ore + 'ss' });
        }
        continue;
      }
      // まだ行けない海の島：見た目だけの木と岩を少しだけ（開くと sim.js が本物の木と岩を置き、これは出なくなる）
      if (c.isle) {
        const [pt, pr] = ISLE_OBJ[c.isle] || [0.1, 0.03];
        if (c.kind === 'grass' && r < pt) trees.push({ id: 'w' + i + '_' + j, x, z, y: 0, state: 'tree', kind: Math.floor(cellHash(i, j, 4) * 3), size: 0.8 + cellHash(i, j, 5) * 0.4 });
        else if (c.kind !== 'water' && r > 1 - pr) rocks.push({ id: 'wr' + i + '_' + j, x, z, y: 0, hp: 10, max: 10, kind: Math.floor(cellHash(i, j, 6) * 3), blocks: 'ssssssssss' });
        continue;
      }
      if (!c.wild || c.kind === 'snow') continue;
      const forest = Math.max(0, Math.min(1, (fbm(nF, x / 120, z / 120, 2) + 0.15) * 1.8));
      if (c.kind === 'grass' && r < 0.1 + forest * 0.6) trees.push({ id: 'w' + i + '_' + j, x, z, y: c.h * BLOCK, state: 'tree', kind: Math.floor(cellHash(i, j, 4) * 3), size: 0.85 + cellHash(i, j, 5) * 0.35 });
      else if (r > (c.kind === 'stone' ? 0.85 : 0.97)) rocks.push({ id: 'wr' + i + '_' + j, x, z, y: c.h * BLOCK, hp: 10, max: 10, kind: Math.floor(cellHash(i, j, 6) * 3), blocks: 'ssssssssss' });
    }
    return { trees, rocks };
  }
  const heightAt = (x, z) => { const c = cell(Math.floor(x / BLOCK), Math.floor(z / BLOCK)); return c.h > 0 ? c.h * BLOCK : 0; };
  return {
    cell, chunkObjects, heightAt, forest: () => 0,
    outside: () => 0, nearBuilding: () => false, zone, seaZ, islands,
  };
}
