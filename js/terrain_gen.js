// どこまでも続く地形の「形」だけを決める（three.js を使わない。サイトとテストで共通）。
// 1 ブロック = BLOCK（村人の背が 2 ブロック）。チャンク = CHUNK × CHUNK ブロック。
// 同じシードなら、いつ・どこから作っても同じ形になる（チャンクの順番に左右されない）。
//   - 町（sim.js が木や岩を置く範囲 zone）の中は平らな草地。南（seaZ より先）は海で、境目は砂浜
//   - 外へ行くほど、ノイズで 丘・山（高いと石・雪）・川（くねった帯）・小さな湖・森の濃い所と薄い所 が出てくる
//   - 建物（予定地も）のまわり keepR ブロックには、木も岩も作らない
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
export function makeTerrain({ seed = 'town', zone = { x0: -112, x1: 112, z0: -112, z1: 36 }, seaZ = 34, keepOut = [], keepR = 4 } = {}) {
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
