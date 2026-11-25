// マイクラ式の地形（洞窟つき）を作る。three.js を使わない。ページでも Web Worker でも使える。
//   - 高さ：continentalness（大陸らしさ）・erosion（削られ方）・peaks & valleys（山と谷）のノイズを重ねて決める。海・平原・丘・高い山・川
//   - 地域：気温と湿り気で 森・草原・砂浜・雪山
//   - 高さ 0〜127 ブロック。海面は 62
//   - 洞窟：3D ノイズでくり抜く。cheese（大きな空洞）と spaghetti（細長いトンネル）。深い所の地底湖と溶岩だまり
//   - 鉱石：深さで出し分け（石炭は浅く、鉄は中ほど、金とダイヤは深く）。かたまり（鉱脈）で出す
//   - 同じシードなら、いつ・どの順で作っても同じ形
//   - メッシュ：16×16×128 のチャンクを、グリーディメッシュ（同じ色の面をまとめる）にする。見えない面は作らない。遠くは粗く（LOD）
// このファイルを Worker として読むと、{ seed, cx, cz, lod, edits } を受けてメッシュを返す
export const CH = 16, HGT = 128, SEA = 62;
export const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, SNOW: 5, LOG: 6, LEAVES: 7, COAL: 8, IRON: 9, GOLD: 10, DIAMOND: 11, LAVA: 12, GRAVEL: 13, BEDROCK: 14, WATER: 15, DEEP: 16 };
export const ORE_NAME = { 8: '石炭', 9: '鉄鉱石', 10: '金鉱石', 11: 'ダイヤ' };
// 面の色（番号は色の表 COLORS の位置）。草の横・丸太の上下などは向きで変える
export const COLORS = [
  [118, 178, 76],  // 0 草の上
  [128, 140, 70],  // 1 草の横
  [134, 98, 66],   // 2 土
  [128, 128, 130], // 3 石
  [220, 206, 142], // 4 砂
  [240, 246, 250], // 5 雪
  [104, 78, 44],   // 6 丸太の横
  [168, 132, 82],  // 7 丸太の上
  [62, 124, 46],   // 8 葉
  [40, 40, 44],    // 9 石炭（石に黒い粒）
  [216, 170, 128], // 10 鉄（石に肌色の粒）
  [246, 210, 64],  // 11 金（石に黄色の粒）
  [92, 236, 226],  // 12 ダイヤ（石に水色の粒）
  [255, 124, 26],  // 13 溶岩
  [146, 136, 130], // 14 砂利
  [70, 70, 74],    // 15 岩盤
  [58, 120, 200],  // 16 水
  [92, 92, 100],   // 17 深い石
];
const ORE_SET = new Set([B.COAL, B.IRON, B.GOLD, B.DIAMOND]);
// 種類 → 不透明か（0 空気、1 不透明、2 水、3 溶岩）
const CAT = new Uint8Array(32); CAT.fill(1); CAT[B.AIR] = 0; CAT[B.WATER] = 2; CAT[B.LAVA] = 3;
// 向き d（0:x 1:y 2:z）と符号で面の色を決める
function faceColor(id, d, s) {
  switch (id) {
    case B.GRASS: return d === 1 ? (s > 0 ? 0 : 2) : 1;
    case B.DIRT: return 2;
    case B.STONE: return 3;
    case B.SAND: return 4;
    case B.SNOW: return d === 1 && s < 0 ? 2 : 5;
    case B.LOG: return d === 1 ? 7 : 6;
    case B.LEAVES: return 8;
    case B.COAL: return 9; case B.IRON: return 10; case B.GOLD: return 11; case B.DIAMOND: return 12;
    case B.LAVA: return 13;
    case B.GRAVEL: return 14;
    case B.BEDROCK: return 15;
    case B.WATER: return 16;
    case B.DEEP: return 17;
  }
  return 3;
}

// ---------- ノイズ（シードつきのパーリンノイズ 2D・3D） ----------
function hash32(s) { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function perm(seed) { const R = rng(seed), p = new Uint8Array(512), a = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } for (let i = 0; i < 512; i++) p[i] = a[i & 255]; return p; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const G3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
function noise2(seed) {
  const p = perm(seed);
  return (x, y) => {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
    const g = (ix, iy, dx, dy) => { const v = G2[p[p[ix] + iy] & 7]; return v[0] * dx + v[1] * dy; };
    const u = fade(xf), v = fade(yf);
    const a = g(xi, yi, xf, yf), b = g(xi + 1, yi, xf - 1, yf), c = g(xi, yi + 1, xf, yf - 1), d = g(xi + 1, yi + 1, xf - 1, yf - 1);
    return (a + u * (b - a) + v * (c + u * (d - c) - a - u * (b - a))) * 1.1;
  };
}
function noise3(seed) {
  const p = perm(seed);
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), xf = x - X, yf = y - Y, zf = z - Z, xi = X & 255, yi = Y & 255, zi = Z & 255;
    const g = (ix, iy, iz, dx, dy, dz) => { const v = G3[p[p[p[ix] + iy] + iz] % 12]; return v[0] * dx + v[1] * dy + v[2] * dz; };
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u), l(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u), v),
      l(l(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u), l(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u), v), w);
  };
}
const fbm2 = (n, x, y, o) => { let s = 0, a = 1, f = 1, t = 0; for (let i = 0; i < o; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.01; } return s / t; };
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
// 折れ線（[x, y] の点）で値を写す。マイクラの「スプライン」と同じ考え方
const spline = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * smooth(0, 1, (x - x0) / (x1 - x0)); } return pts[pts.length - 1][1]; };

// ---------- 地形 ----------
export function createWorldGen(seed = 'town') {
  const S = hash32(seed);
  const nC = noise2(S ^ 0x101), nE = noise2(S ^ 0x202), nW = noise2(S ^ 0x303), nR = noise2(S ^ 0x404), nT = noise2(S ^ 0x505), nH = noise2(S ^ 0x606), nD = noise2(S ^ 0x707), nL = noise2(S ^ 0x808);
  const nCh = noise3(S ^ 0x111), nCh2 = noise3(S ^ 0x222), nS1 = noise3(S ^ 0x333), nS2 = noise3(S ^ 0x444);
  // 1 本の柱（x, z）の、地面の高さ・地域・川
  function column(x, z) {
    const c = fbm2(nC, x / 620, z / 620, 4);               // 大陸らしさ：低いと海、高いと内陸
    const e = fbm2(nE, x / 380, z / 380, 3);               // 削られ方：低いほど山がけわしい
    const w = fbm2(nW, x / 210, z / 210, 3);               // 山と谷
    const pv = Math.pow(1 - Math.abs(w) * 1.6, 2) * (w > -0.62 && w < 0.62 ? 1 : 0);
    const base = spline([[-0.6, 34], [-0.32, 44], [-0.16, 58], [-0.08, 63], [0.05, 66], [0.3, 72], [0.6, 80]], c);
    const rough = Math.pow(1 - (e + 1) / 2, 1.6);
    const mountain = smooth(-0.1, 0.25, c) * rough * pv * 70;
    let h = base + mountain + fbm2(nD, x / 40, z / 40, 3) * (3 + rough * 4);
    // 川：くねった帯の中を、海面より少し下まで削る（両岸はなだらか）
    const rv = Math.abs(fbm2(nR, x / 340, z / 340, 2));
    let river = 0;
    if (h > SEA - 2 && h < 100) { const k = 1 - smooth(0.018, 0.06, rv); river = k; h = h + (SEA - 4 - h) * k; }
    h = Math.max(3, Math.min(HGT - 3, Math.round(h)));
    const temp = fbm2(nT, x / 520, z / 520, 2) - Math.max(0, h - 72) / 60;
    const hum = fbm2(nH, x / 460, z / 460, 2);
    let biome = 'plains';
    if (h <= SEA + 1 && (c < -0.06 || river > 0.4)) biome = 'beach';
    if (h < SEA - 3) biome = 'ocean';
    else if (temp < -0.32 || h > 98) biome = 'snow';
    else if (h > 88) biome = 'stone';
    else if (biome !== 'beach' && hum > 0.04) biome = 'forest';
    return { h, biome, river, c };
  }
  const heightAt = (x, z) => column(x, z).h;

  // チャンク（cx, cz）を作る。pad：まわりに何マス足すか（となりのチャンクとの境の面を正しく消すため）。
  // caves=false なら洞窟・鉱石・木を作らない（遠くの粗いチャンク用）
  function generate(cx, cz, { pad = 1, caves = true } = {}) {
    const P = CH + pad * 2, X0 = cx * CH - pad, Z0 = cz * CH - pad;
    const vol = new Uint8Array(P * P * HGT);
    const idx = (x, y, z) => (y * P + z) * P + x;
    const cols = new Array(P * P);
    for (let z = 0; z < P; z++) for (let x = 0; x < P; x++) {
      const col = column(X0 + x, Z0 + z); cols[z * P + x] = col;
      const h = col.h, bio = col.biome;
      for (let y = 0; y <= h; y++) {
        let id = B.STONE;
        if (y === 0) id = B.BEDROCK;
        else if (y < 18) id = B.DEEP;
        if (y >= h - 3 && y > 0) {
          if (bio === 'beach' || bio === 'ocean') id = (bio === 'ocean' && h < SEA - 8) ? B.GRAVEL : B.SAND;
          else if (bio === 'stone') id = B.STONE;
          else id = y === h ? (bio === 'snow' ? B.SNOW : B.GRASS) : B.DIRT;
          if (bio === 'snow' && h > 98 && y < h) id = B.STONE;
        }
        vol[idx(x, y, z)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) vol[idx(x, y, z)] = B.WATER;
    }
    if (caves) {
      // 洞窟：4 マスおきにノイズを取って、間はなめらかにつなぐ（速くするため。マイクラも同じ）
      const GS = 4, NX = Math.ceil(P / GS) + 1, NY = HGT / GS + 1;
      const cheese = new Float32Array(NX * NX * NY), spa = new Float32Array(NX * NX * NY);
      for (let gy = 0; gy < NY; gy++) for (let gz = 0; gz < NX; gz++) for (let gx = 0; gx < NX; gx++) {
        const x = X0 + gx * GS, y = gy * GS, z = Z0 + gz * GS, i = (gy * NX + gz) * NX + gx;
        cheese[i] = nCh(x / 52, y / 30, z / 52) + 0.35 * nCh2(x / 18, y / 14, z / 18) + (y < 40 ? (40 - y) / 160 : 0);
        const a = nS1(x / 70, y / 42, z / 70), b = nS2(x / 70, y / 42, z / 70);
        spa[i] = a * a + b * b;
      }
      const tri = (arr, x, y, z) => {
        const fx = x / GS, fy = y / GS, fz = z / GS, ix = Math.floor(fx), iy = Math.min(NY - 2, Math.floor(fy)), iz = Math.floor(fz), tx = fx - ix, ty = fy - iy, tz = fz - iz;
        const g = (a, b, c) => arr[((iy + b) * NX + (iz + c)) * NX + ix + a];
        const l = (a, b, t) => a + (b - a) * t;
        return l(l(l(g(0, 0, 0), g(1, 0, 0), tx), l(g(0, 0, 1), g(1, 0, 1), tx), tz), l(l(g(0, 1, 0), g(1, 1, 0), tx), l(g(0, 1, 1), g(1, 1, 1), tx), tz), ty);
      };
      for (let z = 0; z < P; z++) for (let x = 0; x < P; x++) {
        const col = cols[z * P + x], h = col.h;
        const lake = fbm2(nL, (X0 + x) / 90, (Z0 + z) / 90, 2) > 0.06; // この辺りの深い空洞は地底湖になる
        const lavaPool = fbm2(nL, (X0 + x) / 36 + 50, (Z0 + z) / 36 - 50, 2) > 0.12; // 溶岩だまりは所々だけ（一面の溶岩にしない）
        const wet = h < SEA + 2; // 海や川の底はくり抜かない（水が入るので）
        for (let y = 1; y < h + 1; y++) {
          const ch = tri(cheese, x, y, z), sp = tri(spa, x, y, z);
          const deep = h - y;
          const isCheese = ch > 0.42 && deep > 7;
          const isSpa = sp < 0.0042 && (deep > 2 || !wet) && !(wet && deep < 6);
          if (!isCheese && !isSpa) continue;
          let id = B.AIR;
          if (lake && y <= 30 && isCheese) id = B.WATER; // 地底湖（この辺りは溶岩の代わりに水がたまる）
          else if (y <= 8 && lavaPool) id = B.LAVA;     // 深い所の、所々に溶岩だまり
          vol[idx(x, y, z)] = id;
        }
      }
      // 鉱石：チャンクごとの種で、深さに合った所へ鉱脈（3〜8 個のかたまり）を置く。石の中だけ。チャンクの中（pad の外）だけに置く
      const R = rng(hash32(S + ':' + cx + ',' + cz));
      const ORES = [[B.COAL, 24, 30, 120, 7], [B.IRON, 18, 8, 64, 6], [B.GOLD, 6, 4, 32, 5], [B.DIAMOND, 4, 2, 16, 4]];
      for (const [ore, n, y0, y1, size] of ORES) for (let k = 0; k < n; k++) {
        let x = pad + Math.floor(R() * CH), y = y0 + Math.floor(R() * (y1 - y0)), z = pad + Math.floor(R() * CH);
        const m = 3 + Math.floor(R() * size);
        for (let j = 0; j < m; j++) {
          if (x >= pad && x < pad + CH && z >= pad && z < pad + CH && y > 0 && y < HGT) { const i = idx(x, y, z); if (vol[i] === B.STONE || vol[i] === B.DEEP) vol[i] = ore; }
          const r = R(); if (r < 0.33) x += R() < 0.5 ? 1 : -1; else if (r < 0.66) z += R() < 0.5 ? 1 : -1; else y += R() < 0.5 ? 1 : -1;
        }
      }
      // 木：森は多く、草原は少し。幹と葉がチャンクの中に収まる所だけ
      for (let z = pad + 2; z < pad + CH - 2; z++) for (let x = pad + 2; x < pad + CH - 2; x++) {
        const col = cols[z * P + x];
        const rate = col.biome === 'forest' ? 0.045 : col.biome === 'plains' ? 0.006 : col.biome === 'snow' && col.h < 96 ? 0.01 : 0;
        if (!rate || col.river > 0.1) continue;
        const hv = (hash32(S + 't' + (X0 + x) + ',' + (Z0 + z)) % 10000) / 10000;
        if (hv > rate || vol[idx(x, col.h, z)] !== B.GRASS && vol[idx(x, col.h, z)] !== B.SNOW) continue;
        const th = 4 + (hash32('h' + X0 + x + z) % 3), top = col.h + th;
        if (top + 2 >= HGT) continue;
        for (let y = col.h + 1; y <= top; y++) vol[idx(x, y, z)] = B.LOG;
        for (let dy = -2; dy <= 1; dy++) {
          const r = dy >= 0 ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || (hash32('c' + x + dx + z + dz + dy) & 1))) continue;
            const i = idx(x + dx, top + dy, z + dz); if (vol[i] === B.AIR) vol[i] = B.LEAVES;
          }
        }
        vol[idx(x, top + 2, z)] = B.LEAVES;
      }
    }
    return { vol, P, pad, X0, Z0, cols };
  }

  // 中身だけ（16×16×128）を取り出す。並び：(y * 16 + z) * 16 + x
  function blocksOf(g) {
    const out = new Uint8Array(CH * CH * HGT);
    for (let y = 0; y < HGT; y++) for (let z = 0; z < CH; z++) for (let x = 0; x < CH; x++) out[(y * CH + z) * CH + x] = g.vol[(y * g.P + z + g.pad) * g.P + x + g.pad];
    return out;
  }
  return { seed, column, heightAt, generate, blocksOf };
}

// ---------- グリーディメッシュ ----------
// g：generate の結果。lod：1（1 マスずつ）・2・4（粗く。s マスを 1 つにまとめる）。edits：Map('x,y,z' → id)（中身の座標。掘った所など）
// 返す：{ opaque, water, lava }。それぞれ { pos: Float32Array, nor: Int8Array, col: Uint8Array（RGB）, sky: Uint8Array（明るさ 0〜4 × 60 ＋ 鉱石の粒もようなら 1）, idx: Uint32Array }
export function meshChunk(g, lod = 1, edits = null) {
  const s = lod, P = g.P, pad = g.pad, vol = g.vol;
  const N = CH / s, NY = HGT / s;
  const raw = (x, y, z) => { // 中身の座標（-pad〜CH+pad-1）
    if (y < 0) return B.BEDROCK; if (y >= HGT) return B.AIR;
    if (edits) { const e = edits.get(x + ',' + y + ',' + z); if (e !== undefined) return e; }
    return vol[(y * P + z + pad) * P + x + pad];
  };
  // 粗いマス：まん中の 1 マスで中身を決める（空気でなければ、そのマスの中のいちばん上の物の色）
  const at = s === 1 ? raw : (X, Y, Z) => {
    const x0 = X * s, y0 = Y * s, z0 = Z * s, m = s >> 1;
    if (x0 + m < -pad || x0 + m >= CH + pad || z0 + m < -pad || z0 + m >= CH + pad) return B.AIR;
    const c = raw(x0 + m, y0 + m, z0 + m);
    if (CAT[c] !== 1) return c;
    for (let y = y0 + s - 1; y >= y0; y--) { const v = raw(x0 + m, y, z0 + m); if (CAT[v] === 1) return v; }
    return c;
  };
  // 空が見えるか：柱のいちばん上の不透明なマスより上なら明るい。下は深さで暗く（入口の近くは少し明るい）
  const tops = new Int16Array(P * P).fill(-1);
  for (let z = 0; z < P; z++) for (let x = 0; x < P; x++) for (let y = HGT - 1; y >= 0; y--) { const v = vol[(y * P + z) * P + x]; if (CAT[v] === 1 && v !== B.LEAVES) { tops[z * P + x] = y; break; } }
  const skyAt = (X, Y, Z) => { // 粗いマスの座標の、空気のマスの明るさ 0〜4
    const x = Math.max(-pad, Math.min(CH + pad - 1, X * s + (s >> 1))), z = Math.max(-pad, Math.min(CH + pad - 1, Z * s + (s >> 1))), y = Y * s;
    const t = tops[(z + pad) * P + x + pad];
    if (y > t) return 4;
    return Math.max(0, 4 - Math.ceil((t - y) / 3));
  };
  const out = { opaque: newBuf(), water: newBuf(), lava: newBuf() };
  const dims = [N, NY, N];
  const mask = new Int32Array(Math.max(N * NY, N * N));
  const x = [0, 0, 0], q = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    q[0] = q[1] = q[2] = 0; q[d] = 1;
    for (x[d] = -1; x[d] < dims[d];) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) for (x[u] = 0; x[u] < dims[u]; x[u]++) {
        const a = at(x[0], x[1], x[2]), b = at(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
        const ca = CAT[a], cb = CAT[b];
        let k = 0;
        // a → +d の面（a が中身の中にある時だけ）。b → -d の面（b が中身の中にある時だけ）
        const aIn = x[d] >= 0, bIn = x[d] + 1 < dims[d];
        if (ca !== cb) {
          if (aIn && vis(ca, cb)) k = key(ca, faceColor(a, d, 1), skyAt(x[0] + q[0], x[1] + q[1], x[2] + q[2]), ORE_SET.has(a));
          else if (bIn && vis(cb, ca)) k = -key(cb, faceColor(b, d, -1), skyAt(x[0], x[1], x[2]), ORE_SET.has(b));
        }
        mask[n++] = k;
      }
      x[d]++;
      // まとめる
      n = 0;
      for (let j = 0; j < dims[v]; j++) for (let i = 0; i < dims[u];) {
        const k = mask[n];
        if (!k) { i++; n++; continue; }
        let w = 1; while (i + w < dims[u] && mask[n + w] === k) w++;
        let h = 1, done = false;
        for (; j + h < dims[v]; h++) { for (let t = 0; t < w; t++) if (mask[n + t + h * dims[u]] !== k) { done = true; break; } if (done) break; }
        x[u] = i; x[v] = j;
        const du = [0, 0, 0], dv = [0, 0, 0]; du[u] = w; dv[v] = h;
        quad(out, x, du, dv, d, k, s);
        for (let l = 0; l < h; l++) for (let t = 0; t < w; t++) mask[n + t + l * dims[u]] = 0;
        i += w; n += w;
      }
    }
  }
  return { opaque: pack(out.opaque), water: pack(out.water), lava: pack(out.lava) };
}
// 面を作るか：不透明 → 空気・水・溶岩（溶岩の中は見えないが、ふちの壁は見える）、水 → 空気、溶岩 → 空気・水
function vis(c, o) { if (c === 1) return o === 0 || o === 2; if (c === 2) return o === 0; if (c === 3) return o === 0 || o === 2; return false; }
// 面の印：群れ（0 不透明・1 水・2 溶岩）・色・明るさ・粒もよう を 1 つの数に
const key = (cat, color, sky, ore) => 1 + (cat - 1) + color * 4 + sky * 256 + (ore ? 4096 : 0);
function newBuf() { return { pos: [], nor: [], col: [], sky: [], idx: [] }; }
function quad(out, x, du, dv, d, k, s) {
  const neg = k < 0; k = Math.abs(k) - 1;
  const grp = k & 3, color = (k >> 2) & 63, sky = (k >> 8) & 15, ore = (k >> 12) & 1;
  const buf = grp === 0 ? out.opaque : grp === 1 ? out.water : out.lava;
  const base = buf.pos.length / 3;
  const p = [x[0] * s, x[1] * s, x[2] * s], U = du.map((t) => t * s), V = dv.map((t) => t * s);
  const pts = [p, [p[0] + U[0], p[1] + U[1], p[2] + U[2]], [p[0] + U[0] + V[0], p[1] + U[1] + V[1], p[2] + U[2] + V[2]], [p[0] + V[0], p[1] + V[1], p[2] + V[2]]];
  // 水の上の面は少しだけ下げる（岸と同じ高さだと、ちらつく）
  const drop = grp === 1 && d === 1 && !neg ? 0.12 : 0;
  for (const q of pts) buf.pos.push(q[0], q[1] - drop, q[2]);
  const nn = [0, 0, 0]; nn[d] = neg ? -1 : 1;
  const c = COLORS[color];
  for (let i = 0; i < 4; i++) { buf.nor.push(nn[0], nn[1], nn[2]); buf.col.push(c[0], c[1], c[2]); buf.sky.push(sky * 60 + ore); }
  if (neg) buf.idx.push(base, base + 3, base + 2, base, base + 2, base + 1); else buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function pack(b) { return { pos: new Float32Array(b.pos), nor: new Int8Array(b.nor), col: new Uint8Array(b.col), sky: new Uint8Array(b.sky), idx: new Uint32Array(b.idx) }; }

// 溶岩の上の面の場所（光を置く候補）。中身の座標
export function lavaSpots(g) {
  const out = [];
  for (let z = 0; z < CH; z += 2) for (let x = 0; x < CH; x += 2) for (let y = 1; y < 12; y++) {
    const i = (y * g.P + z + g.pad) * g.P + x + g.pad;
    if (g.vol[i] === B.LAVA && g.vol[i + g.P * g.P] === B.AIR) { out.push([x, y, z]); break; }
  }
  return out;
}

// ---------- Worker ----------
// メッセージ：{ id, seed, cx, cz, lod, edits: [[x, y, z, id], ...] } → { id, cx, cz, lod, mesh, blocks?, lava? }
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof self.postMessage === 'function') {
  const gens = {};
  self.onmessage = (ev) => {
    const { id, seed, cx, cz, lod, edits } = ev.data;
    const G = gens[seed] || (gens[seed] = createWorldGen(seed));
    const g = G.generate(cx, cz, { pad: lod, caves: lod === 1 });
    const em = edits && edits.length ? new Map(edits.map(([x, y, z, b]) => [x + ',' + y + ',' + z, b])) : null;
    const mesh = meshChunk(g, lod, em);
    const res = { id, cx, cz, lod, mesh };
    const tr = [];
    for (const k of ['opaque', 'water', 'lava']) for (const a of Object.values(mesh[k])) tr.push(a.buffer);
    if (lod === 1) { res.blocks = G.blocksOf(g); if (em) for (const [k, b] of em) { const [x, y, z] = k.split(',').map(Number); res.blocks[(y * CH + z) * CH + x] = b; } tr.push(res.blocks.buffer); res.lava = lavaSpots(g); }
    self.postMessage(res, tr);
  };
}
