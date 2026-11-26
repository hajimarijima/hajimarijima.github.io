// 地図を「1 マス＝1 文字」で持つ（サイトと sim.js とテストで共通。three.js を使わない）。
//   1 マス = 1 ブロック（TILE = 1.9）。チャンク = 16×16 マス。チャンクごとに 16 行の文字列。
//   文字：g 草（何もない）・t 木・p 苗木・u 切り株・x 掘り出した跡・r 岩・o 掘り切った岩・w 水・s 砂・m 山
//         q 村のまん中・b 建物・f 畑・k 草むら
//   data/world.json には、この文字列をランレングス圧縮（"12g3t" ＝ 草 12 マス・木 3 マス）して入れる。
//   ふつうの木と岩（その場所から決まる形・向き・大きさのまま）は文字だけ。ちがう所がある物だけ objs に残す。
// もう 1 つ、動く物（村人・動物）用の「空間ハッシュ」（SpatialHash）：大きめのマスごとに、そこにいる物の一覧を持つ。
//   近くを探す時は、周りのマスだけを見る（全員を調べない）。
export const TILE = 1.9;
export const CH = 16;
export const tileOf = (v) => Math.floor(v / TILE);

// ---------- ランレングス圧縮（文字は 1 文字、数は 2 以上の時だけ前に付ける） ----------
export function rle(s) {
  let out = '';
  for (let i = 0; i < s.length;) { let j = i; while (j < s.length && s[j] === s[i]) j++; out += (j - i > 1 ? j - i : '') + s[i]; i = j; }
  return out;
}
export function unrle(s) {
  let out = '', n = '';
  for (const c of s) { if (c >= '0' && c <= '9') n += c; else { out += c.repeat(n ? +n : 1); n = ''; } }
  return out;
}

// ---------- 文字の地図 ----------
export class TileMap {
  constructor(fill = 'g') { this.fill = fill; this.chunks = new Map(); }
  static key(ci, cj) { return ci + ',' + cj; }
  _chunk(i, j, make) {
    const ci = Math.floor(i / CH), cj = Math.floor(j / CH), k = TileMap.key(ci, cj);
    let c = this.chunks.get(k);
    if (!c && make) { c = new Array(CH * CH).fill(this.fill); this.chunks.set(k, c); }
    return c ? { c, n: (j - cj * CH) * CH + (i - ci * CH) } : null;
  }
  get(i, j) { const h = this._chunk(i, j, false); return h ? h.c[h.n] : this.fill; }
  set(i, j, ch) { const h = this._chunk(i, j, true); h.c[h.n] = ch; }
  at(x, z) { return this.get(tileOf(x), tileOf(z)); }
  // チャンクの 16 行（上が北）
  rows(ci, cj) { const c = this.chunks.get(TileMap.key(ci, cj)); const a = c || new Array(CH * CH).fill(this.fill); const out = []; for (let r = 0; r < CH; r++) out.push(a.slice(r * CH, r * CH + CH).join('')); return out; }
  // (x, z) から半径 r（ワールド座標）の中のマスだけを見る。fn(i, j, 文字) が true を返したらそこで止めて true
  scan(x, z, r, fn) {
    const i0 = tileOf(x - r), i1 = tileOf(x + r), j0 = tileOf(z - r), j1 = tileOf(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * TILE, cz = (j + 0.5) * TILE;
      if ((cx - x) ** 2 + (cz - z) ** 2 > (r + TILE * 0.71) ** 2) continue;
      if (fn(i, j, this.get(i, j))) return true;
    }
    return false;
  }
  any(x, z, r, chars) { return this.scan(x, z, r, (i, j, c) => chars.includes(c)); }
  encode() {
    const chunks = {};
    for (const [k, c] of this.chunks) { const s = c.join(''); if (s !== this.fill.repeat(CH * CH)) chunks[k] = rle(s); }
    return { tile: TILE, size: CH, fill: this.fill, chunks };
  }
  static decode(o) {
    const m = new TileMap(o.fill || 'g');
    for (const k in o.chunks || {}) m.chunks.set(k, unrle(o.chunks[k]).split(''));
    return m;
  }
}

// ---------- 空間ハッシュ（動く物・たくさんある物の「近く」をすぐ探す） ----------
// cell：マスの一辺（ワールド座標）。物は { x, z } を持つ。id には物そのものでも文字でもよい
export class SpatialHash {
  constructor(cell = 8 * TILE) { this.cell = cell; this.cells = new Map(); this.where = new Map(); this.obj = new Map(); this.b = [Infinity, -Infinity, Infinity, -Infinity]; }
  _k(cx, cz) { return cx * 1000003 + cz; }
  _cell(x, z) { return [Math.floor(x / this.cell), Math.floor(z / this.cell)]; }
  get size() { return this.obj.size; }
  // 入れる・動かす（入っているマスが変わった時だけ付け替える）
  set(id, x, z, o = id) {
    const [cx, cz] = this._cell(x, z), k = this._k(cx, cz), old = this.where.get(id);
    this.obj.set(id, o);
    if (old === k) return;
    if (old !== undefined) { const s = this.cells.get(old); if (s) { s.delete(id); if (!s.size) this.cells.delete(old); } }
    let s = this.cells.get(k); if (!s) { s = new Set(); this.cells.set(k, s); }
    const b = this.b; if (cx < b[0]) b[0] = cx; if (cx > b[1]) b[1] = cx; if (cz < b[2]) b[2] = cz; if (cz > b[3]) b[3] = cz;
    s.add(id); this.where.set(id, k);
  }
  remove(id) { const old = this.where.get(id); if (old === undefined) return; const s = this.cells.get(old); if (s) { s.delete(id); if (!s.size) this.cells.delete(old); } this.where.delete(id); this.obj.delete(id); }
  // 半径 r の中の物（距離は物の今の x, z で測る）
  near(x, z, r, filter) {
    const out = [], [c0x, c0z] = this._cell(x - r, z - r), [c1x, c1z] = this._cell(x + r, z + r);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const s = this.cells.get(this._k(cx, cz)); if (!s) continue;
      for (const id of s) { const o = this.obj.get(id); if ((o.x - x) ** 2 + (o.z - z) ** 2 <= r * r && (!filter || filter(o))) out.push(o); }
    }
    return out;
  }
  any(x, z, r, filter) {
    const [c0x, c0z] = this._cell(x - r, z - r), [c1x, c1z] = this._cell(x + r, z + r);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const s = this.cells.get(this._k(cx, cz)); if (!s) continue;
      for (const id of s) { const o = this.obj.get(id); if ((o.x - x) ** 2 + (o.z - z) ** 2 < r * r && (!filter || filter(o))) return true; }
    }
    return false;
  }
  // 近い順に k 個（周りのマスから輪を広げて探す。全部の距離の順と同じ結果）
  nearest(x, z, k, filter, maxR = Infinity) {
    if (!this.obj.size) return [];
    const [ox, oz] = this._cell(x, z);
    const found = [];
    let ring = 0;
    const b = this.b, span = Math.max(ox - b[0], b[1] - ox, oz - b[2], b[3] - oz);
    const visit = (cx, cz) => {
      const s = this.cells.get(this._k(cx, cz)); if (!s) return;
      for (const id of s) { const o = this.obj.get(id); if (!filter || filter(o)) found.push([(o.x - x) ** 2 + (o.z - z) ** 2, o]); }
    };
    for (;;) {
      // 輪のふちのマスだけを見る（内側は前の輪で見た）
      if (ring === 0) visit(ox, oz);
      else {
        for (let cx = ox - ring; cx <= ox + ring; cx++) { visit(cx, oz - ring); visit(cx, oz + ring); }
        for (let cz = oz - ring + 1; cz <= oz + ring - 1; cz++) { visit(ox - ring, cz); visit(ox + ring, cz); }
      }
      // この輪までで、ring * cell より近い物は全部見つかっている
      const sure = ring * this.cell, s2 = sure * sure;
      let okN = 0;
      if (found.length >= k) for (const f of found) if (f[0] <= s2 && ++okN >= k) break;
      if (okN >= k || sure > maxR || ring > span) break;
      ring++;
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.filter(([d]) => d <= maxR * maxR).slice(0, k).map(([, o]) => o);
  }
  // 物の一覧から作る（id は物そのもの）
  static of(list, cell) { const h = new SpatialHash(cell); for (const o of list) h.set(o, o.x, o.z, o); return h; }
}

// ---------- 木と岩の「ふつうの形」（その場所から決まる） ----------
const h32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const fr = (i, j, k) => (h32(i + ',' + j + ',' + k) % 10007) / 10007;
const r2 = (v) => Math.round(v * 100) / 100;
const FAR = 44;
// マスの中の少しずれた所（同じマスなら毎回同じ）
export const spotIn = (i, j) => ({ x: r2((i + 0.18 + fr(i, j, 1) * 0.64) * TILE), z: r2((j + 0.18 + fr(i, j, 2) * 0.64) * TILE) });
// りんごの木：木のおよそ 10 本に 1 本（マスの場所から決まる。保存した町も、読むだけでりんごの木になる）
export const APPLE_SHARE = 0.1;
export const isAppleTile = (i, j) => fr(i, j, 6) < APPLE_SHARE;
export function plainTree(i, j) {
  const { x, z } = spotIn(i, j);
  const t = { id: `t${i}_${j}`, x, z, state: 'tree', regrow: 0, kind: Math.floor(fr(i, j, 3) * 3), size: r2(0.85 + fr(i, j, 4) * 0.35) };
  if (isAppleTile(i, j)) t.fruit = 'apple';
  if (Math.hypot(x, z + 1) > FAR) t.far = 1;
  return t;
}
export function plainRock(i, j) {
  const { x, z } = spotIn(i, j);
  const r = { id: `r${i}_${j}`, x, z, kind: Math.floor(fr(i, j, 5) * 3) };
  if (Math.hypot(x, z + 1) > FAR) r.far = 1;
  return r;
}
// (x, z) のあるマスの、ふつうの木（苗木・木を新しく置く時に使う）
export const treeAt = (x, z) => plainTree(tileOf(x), tileOf(z));
export const rockAt = (x, z) => plainRock(tileOf(x), tileOf(z));

const TREE_CH = { tree: 't', sapling: 'p', stump: 'u', removed: 'x' };
const CH_TREE = { t: 'tree', p: 'sapling', u: 'stump', x: 'removed' };
const diffOf = (o, base, skip) => { const d = {}; for (const k in o) if (!skip.includes(k) && o[k] !== base[k]) d[k] = o[k]; for (const k in base) if (!(k in o) && !skip.includes(k)) d[k] = null; return d; };

// 町の文字の地図を作る（木・岩・水・村のまん中・建物・畑・草むら）。木と岩より、あとの物を上に書かない
export function townTiles(world, { clearR = 0 } = {}) {
  const m = new TileMap('g');
  const disc = (x, z, r, ch, only) => { const i0 = tileOf(x - r), i1 = tileOf(x + r), j0 = tileOf(z - r), j1 = tileOf(z + r); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (((i + 0.5) * TILE - x) ** 2 + ((j + 0.5) * TILE - z) ** 2 <= r * r && (!only || only.includes(m.get(i, j)))) m.set(i, j, ch); };
  const half = (world.size || 220) / 2;
  // 海と砂浜（前の形だけ。島の形の時は、海と岸は js/island.js が決める）
  if (!world.islands) for (let j = tileOf(world.seaZ - 3); j <= tileOf(world.seaZ + 6); j++) for (let i = tileOf(-half); i <= tileOf(half); i++) m.set(i, j, (j + 0.5) * TILE > world.seaZ ? 'w' : 's');
  if (world.square) disc(world.square.x, world.square.z, world.square.r, 'q');
  if (world.pond) disc(world.pond.x, world.pond.z, world.pond.r, 'w');
  for (const b of world.buildings || []) disc(b.x, b.z, Math.max(1.5, clearR * 0.45), 'b');
  for (const f of world.fields || []) m.set(tileOf(f.x), tileOf(f.z), 'f');
  for (const b of world.bushes || []) m.set(tileOf(b.x), tileOf(b.z), 'k');
  return m;
}

// world（いつもの形：trees と rocks の一覧）→ 保存する形（文字の地図 ＋ ちがう所だけ）
export function encodeWorld(world, opt = {}) {
  const m = townTiles(world, opt);
  const objs = {}, extra = [];
  const put = (o, ch, base) => {
    const i = tileOf(o.x), j = tileOf(o.z), c = m.get(i, j);
    if ('tpuxro'.includes(c)) { extra.push(ch === 'r' || ch === 'o' ? { rock: 1, ...o } : o); return; }
    m.set(i, j, ch);
    const d = diffOf(o, base, ch === 'r' || ch === 'o' ? [] : ['state']);
    if (Object.keys(d).length) objs[i + ',' + j] = d;
  };
  for (const t of world.trees || []) { const i = tileOf(t.x), j = tileOf(t.z); put(t, TREE_CH[t.state] || 't', plainTree(i, j)); }
  for (const r of world.rocks || []) { const i = tileOf(r.x), j = tileOf(r.z); put(r, r.hp > 0 ? 'r' : 'o', plainRock(i, j)); }
  const out = { ...world, tiles: m.encode(), objs };
  if (extra.length) out.extra = extra; else delete out.extra;
  delete out.trees; delete out.rocks;
  return out;
}
// 保存した形 → いつもの形（木と岩の一覧は id の順にそろえる）
export function decodeWorld(w) {
  if (!w || !w.tiles) return w;
  const m = TileMap.decode(w.tiles);
  const trees = [], rocks = [];
  for (const [k, c] of m.chunks) {
    const [ci, cj] = k.split(',').map(Number);
    c.forEach((ch, n) => {
      if (!'tpuxro'.includes(ch)) return;
      const i = ci * CH + (n % CH), j = cj * CH + Math.floor(n / CH), d = (w.objs || {})[i + ',' + j] || {};
      const isRock = ch === 'r' || ch === 'o';
      const o = isRock ? plainRock(i, j) : { ...plainTree(i, j), state: CH_TREE[ch] };
      for (const f in d) { if (d[f] === null) delete o[f]; else o[f] = d[f]; }
      (isRock ? rocks : trees).push(o);
    });
  }
  for (const e of w.extra || []) { if (e.rock) { const { rock, ...r } = e; rocks.push(r); } else trees.push(e); }
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  trees.sort(byId); rocks.sort(byId);
  const out = { ...w, trees, rocks };
  delete out.tiles; delete out.objs; delete out.extra;
  return out;
}
