'use strict';
// 0 日目の島を作る（tools/init.js から使う）。
//   はじまり島：半径およそ 50（約 26 ブロック）の小さな島。町の画面を開いた時の 1 画面に、ちょうど島ぜんぶが入る広さ。
//     村のまん中（広場の予定地・チェスト・たき火）は島のまん中で、どの向きも岸まで 40 以上ある。
//   北の島：北の海の向こう（はじまり島の岸から約 20 先）。はじめは行けない。橋がかかると（sim.js・config.json の expansion）
//     村人がそこで木を切り、岩を掘り、家を建てられるようになる。
const { makeRng } = require('./rand');
const { genBlocks } = require('./ores');
const TM = require('../js/tilemap.js');
const IS = require('../js/island.js');
const TN = require('../js/tents.js');

const MAIN = { id: 'main', name: 'はじまり島', x: 0, z: 0, r: 50, wob: [[0.05, 3, 0.7], [0.035, 5, 2.1], [0.02, 7, 4.0]] };
const NORTH = { id: 'north', name: '北の島', x: 6, z: -104, r: 32, wob: [[0.06, 3, 1.9], [0.04, 4, 0.3]], open: 0 };
// 遠くの大陸：北東の海の向こう（いちばん近い岸まで、はじまり島の岸から 50〜100）。山と森がある大きな陸。
//   見えるだけで、今は行けない（wild：木と岩は見た目だけ。村人は使わない）。町の画面を開くと右上にかすんで見える
const FARLAND = { id: 'far', x: 310, z: -190, r: 235, wob: [[0.05, 3, 0.4], [0.035, 5, 1.7], [0.02, 9, 2.9]], wild: true, open: 0 };

// 海の島々：はじまり島のまわりの海に、大きさも形もいろいろな島（はじめはどれも行けない）。
//   look：small（小島）・rocky（岩の多い島。まわりの海に岩の柱）・long（細長い島）・forest（森の島）・beach（砂浜の広い島）
//   from：橋をかける元の島（その島が開いてから、こちらへの橋を作り始める。config.json の expansion.bridges に開く条件）
//   開くまでは、地形（js/terrain_gen.js）が見た目だけの木と岩を少しだけ出す。橋ができた日に sim.js が populateIsland で本物の木・岩・区画を置く
//   開く島はどれも北の島（半径 32）に近い大きさ（半径 26〜29）で、家が何軒も建つ。from のない小島（ことり島・こじま）は飾りで、開かない
//   並び：はじまり島のまわりの輪（中心から約 100）に 5 つ、その外の輪（約 157）に 4 つ。橋はどれも 25〜33
const SEA_ISLES = [
  { id: 'iwa', name: 'いわ島', x: 87, z: 50, r: 27, wob: [[0.08, 4, 0.9], [0.04, 7, 2.2]], look: 'rocky', from: 'main' },
  { id: 'minami', name: 'みなみ島', x: 19, z: 99, r: 28, wob: [[0.1, 2, 0.3], [0.04, 5, 2.6]], look: 'beach', from: 'main' },
  { id: 'kame', name: 'かめ島', x: -62, z: 80, r: 28, wob: [[0.05, 3, 1.1], [0.03, 6, 0.2]], look: 'forest', from: 'main' },
  { id: 'kujira', name: 'くじら島', x: -104, z: 5, r: 29, wob: [[0.18, 2, 0], [0.04, 3, 0.6]], look: 'long', from: 'main' },
  { id: 'mori', name: 'もり島', x: -70, z: -73, r: 29, wob: [[0.06, 3, 0.2], [0.04, 5, 1.8]], look: 'forest', from: 'main' },
  { id: 'umineko', name: 'うみねこ島', x: 89, z: 128, r: 26, wob: [[0.09, 3, 0.8], [0.04, 5, 0.1]], look: 'rocky', from: 'iwa' },
  { id: 'takara', name: 'たから島', x: -38, z: 151, r: 27, wob: [[0.08, 3, 2.4], [0.04, 4, 1.0]], look: 'beach', from: 'minami' },
  { id: 'yuuhi', name: 'ゆうひ島', x: -141, z: 72, r: 29, wob: [[0.06, 3, 1.5], [0.04, 5, 0.4]], look: 'forest', from: 'kame' },
  { id: 'hoshi', name: 'ほし島', x: -146, z: -59, r: 26, wob: [[0.09, 5, 0.3], [0.04, 3, 1.2]], look: 'rocky', from: 'mori' },
  // 飾りの小島（橋はかからない）
  { id: 'kotori', name: 'ことり島', x: 44, z: -67, r: 6.5, wob: [[0.12, 3, 0.5], [0.06, 5, 1.2]], look: 'small' },
  { id: 'kojima', name: 'こじま', x: 104, z: -5, r: 7, wob: [[0.14, 3, 2.0], [0.06, 5, 0.7]], look: 'rocky' },
];
// world.islands に足す形（from は橋のほうに持たせる）と、その橋（まだかかっていない）
function seaIslands() { return SEA_ISLES.map(({ from, ...i }) => ({ ...i, wob: i.wob.map((w) => w.slice()), open: 0 })); }
function seaBridges(islands) {
  const by = Object.fromEntries(islands.map((i) => [i.id, i]));
  return SEA_ISLES.filter((s) => by[s.from] && by[s.id]).map((s) => {
    const e = IS.bridgeEnds(by[s.from], by[s.id], 2.5);
    return { id: s.id, to: s.id, from: s.from, name: (by[s.id].name || '島') + 'への橋', a: r2p(e.a), b: r2p(e.b), w: 3.4, built: 0 };
  });
}

// candidates（拠点の投票の候補 [{ key, x, z }]）を渡すと、候補の場所のまわり（半径 6）を少し空けておく（旗と札が見えるように）。
//   その時は、まん中のそばの「最初の日に掘る岩」は置かない（拠点が決まってから、そのまわりをならす）
function buildIslandWorld({ seed, ores, gather, debris, candidates = null }) {
  const nearCand = (x, z, d) => !!candidates && candidates.some((c) => Math.hypot(c.x - x, c.z - z) < d);
  const R = makeRng('island:' + seed);
  const GA = gather || { rockItems: [6, 10] };
  const main = { ...MAIN }, north = { ...NORTH };
  const islands = [main, north, { ...FARLAND }, ...seaIslands()];
  const ends = IS.bridgeEnds(main, north, 2.5);
  const bridge = { id: 'north', to: 'north', name: '北の島への橋', a: r2p(ends.a), b: r2p(ends.b), w: 3.4, built: 0 };
  const SQUARE = { x: 0, z: -1, r: 8 };
  const TENTS = TN.tentCandidates(SQUARE, TN.tentCfg(null).perTent); // 0 日目のテントは島のまん中のたき火のそば
  const POND = { x: -20, z: 15, r: 4.2 };
  const MEADOW = { x0: -42, x1: -29, z0: -10, z1: 10 }; // 木を置かない野原（西）
  const inMeadow = (x, z) => x > MEADOW.x0 && x < MEADOW.x1 && z > MEADOW.z0 && z < MEADOW.z1;
  const bridges = [bridge, ...seaBridges(islands)];
  const nearBridge = (x, z, d) => bridges.some((b) => IS.bridgeDist(b, x, z) < d); // 海の島への橋のたもとも空けておく
  const near = (list, x, z, d) => list.some((t) => Math.hypot(t.x - x, t.z - z) < d);

  // ---------- 草むら（東）：先に場所を決める ----------
  const bushes = [];
  for (let tries = 0; bushes.length < 12 && tries < 2000; tries++) {
    const a = R.range(-0.4, 0.4), r = R.range(31, 39);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (IS.shoreDist(main, x, z) < 6 || near(bushes, x, z, 2.2)) continue;
    bushes.push({ id: 'b' + bushes.length, x: +x.toFixed(2), z: +z.toFixed(2), ready: true, regrow: 0 });
  }

  // ---------- 木と岩：島ごとに、格子の目ごとに少しずらして置く ----------
  const trees = [], rocks = [];
  const addRock = (x, z, kind) => {
    const max = R.int(GA.rockItems[0], GA.rockItems[1]);
    const rk = { ...TM.rockAt(x, z), hp: max, max };
    if (kind !== undefined) rk.kind = kind;
    rk.blocks = genBlocks(seed, rk, ores);
    rocks.push(rk);
  };
  const scatter = (isl, cell, pRock, pTree) => {
    const span = isl.r * 1.12;
    for (let gz = isl.z - span; gz < isl.z + span; gz += cell) for (let gx = isl.x - span; gx < isl.x + span; gx += cell) {
      const sp = TM.spotIn(TM.tileOf(gx + R.range(0.6, cell - 0.6)), TM.tileOf(gz + R.range(0.6, cell - 0.6)));
      const x = sp.x, z = sp.z, roll = R.next();
      if (IS.shoreDist(isl, x, z) < 5.5) continue; // 砂浜と岸には置かない
      if (Math.hypot(x - SQUARE.x, z - SQUARE.z) < SQUARE.r + 2.5 || inMeadow(x, z) || nearBridge(x, z, 6)) continue;
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 3) continue;
      if (near(bushes, x, z, 2.6) || nearCand(x, z, 6)) continue;
      if (TENTS.some((t) => TN.inTent(t, x, z, 1.6))) continue; // テントを置く所（js/tents.js）
      if (roll < pRock) { if (!near(rocks, x, z, 4)) addRock(x, z); }
      else if (roll < pTree) trees.push(TM.treeAt(x, z));
    }
  };
  scatter(main, 5, 0.12, 0.64);
  scatter(north, 4.6, 0.2, 0.78); // 北の島は森が深く、岩も多い
  // 最初の日に掘る岩が近くにあるように、まん中のそばに 2 つ
  for (const [x0, z0] of candidates ? [] : [[11.5, -9.5], [-10.5, 7.5]]) {
    const { x, z } = TM.spotIn(TM.tileOf(x0), TM.tileOf(z0));
    if (near(rocks, x, z, 3)) continue;
    for (let i = trees.length - 1; i >= 0; i--) if (Math.hypot(trees[i].x - x, trees[i].z - z) < 3.2) trees.splice(i, 1);
    addRock(x, z, 0);
  }
  // 同じマスに 2 つ置かない（地図の文字は 1 マス 1 つ）
  const seen = new Set();
  const uniq = (list) => list.filter((o) => { const k = TM.tileOf(o.x) + ',' + TM.tileOf(o.z); if (seen.has(k)) return false; seen.add(k); return true; });
  const rocksU = uniq(rocks), treesU = uniq(trees);

  // ---------- 建てる区画：村のまん中のまわりの輪（半径 12・19・26。道もこの輪にそう）と、北の島の輪 ----------
  const plots = [];
  const ring = (cx, cz, r, n, off, island) => { for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; const p = { x: +(cx + Math.cos(a) * r).toFixed(2), z: +(cz + Math.sin(a) * r * 0.92 - (island ? 0 : 1)).toFixed(2) }; if (island) p.island = island; plots.push(p); } };
  ring(0, 0, 12, 8, 0.2);
  ring(0, 0, 19, 12, 0.05);
  ring(0, 0, 26, 16, 0.3);
  ring(north.x, north.z, 10, 6, 0.4, 'north');
  ring(north.x, north.z, 18, 10, 0.15, 'north');
  // 海べの特別な場所（港・漁師小屋・灯台）：南の岸から少し内側
  const sp = (ang, inset) => r2p(IS.shorePoint(main, ang, inset));
  const special = { center: { x: 0, z: -1 }, coast: sp(Math.PI / 2, 9), coast2: sp(Math.PI / 2 + 0.45, 9), coast3: sp(Math.PI / 2 - 0.5, 8) };
  const coastPts = [special.coast, special.coast2, special.coast3];
  const okPlot = (p) => {
    const isl = p.island === 'north' ? north : main;
    if (IS.shoreDist(isl, p.x, p.z) < 12) return false;
    if (Math.hypot(p.x - POND.x, p.z - POND.z) < POND.r + 3.5) return false;
    if (near(coastPts, p.x, p.z, 9) || nearBridge(p.x, p.z, 7)) return false;
    return true;
  };

  // ---------- 野の動物（森と野原を歩く。歩く輪が海に入らないように、岸から 9 以上内側） ----------
  const RW = makeRng('wild:' + seed);
  const animals = [];
  const KINDS = ['cow', 'sheep', 'chicken', 'pig'];
  const MEADOWS = [[-33, 0, 4, main], [32, 9, 5, main], [-6, -28, 7, main], [22, -22, 6, main]];
  const NORTH_M = [[north.x, north.z, 12, north]];
  const place = (i, [mx, mz, mr, isl]) => {
    let x = mx, z = mz;
    for (let k = 0; k < 40; k++) {
      const a = RW.range(0, Math.PI * 2), r = Math.sqrt(RW.next()) * mr;
      const tx = mx + Math.cos(a) * r, tz = mz + Math.sin(a) * r;
      if (IS.shoreDist(isl, tx, tz) < 9) continue;
      x = tx; z = tz;
      if (!near(treesU, x, z, 1.4) && !near(rocksU, x, z, 2) && !near(animals, x, z, 1.6)) break;
    }
    animals.push({ id: 'a' + i, kind: KINDS[(i + Math.floor(i / 4)) % 4], x: +x.toFixed(2), z: +z.toFixed(2), pen: null });
  };
  for (let i = 0; i < 16; i++) place(i, MEADOWS[i % MEADOWS.length]);
  for (let i = 16; i < 21; i++) place(i, NORTH_M[0]);

  const south = IS.shorePoint(main, Math.PI / 2, 0);
  return {
    layout: 'island',
    size: 2 * Math.ceil(main.r * 1.15), seaZ: +south.z.toFixed(2), // seaZ・size は前の形の画面のため（島の南の岸）
    islands, bridges, meadow: MEADOW,
    trees: treesU, rocks: rocksU, bushes,
    fields: [], fieldSlots: [],
    buildings: [],
    plots: plots.filter(okPlot), special,
    pond: POND, animals,
    campfire: { x: 2.5, z: 3 },
    square: { ...SQUARE, leveled: 0 }, debris,
    chest: { x: 5.2, z: 0.6, day: 0 },
  };
}
function r2p(p) { return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }; }

// 橋がかかった海の島（look のある島）に、本物の木・岩・区画を置く（tools/sim.js が橋のできた日に 1 回だけ呼ぶ）。
//   look ごとに森の濃さと岩の多さを変える。岸・橋のたもと・ほかの木と岩のそばには置かない。決まった種なので何度呼んでも同じ所
//   [岩の割合, 岩＋木の割合, 格子の目の大きさ, 岸から空ける幅（砂浜の上には置かない）]。開く前の見た目（js/terrain_gen.js の ISLE_OBJ）と同じくらいの濃さ
const LOOK = { small: [0.1, 0.65, 3, 2.6], rocky: [0.32, 0.55, 4.4, 4.4], long: [0.12, 0.62, 4, 4.4], forest: [0.08, 0.85, 4.1, 4.4], beach: [0.06, 0.45, 4.4, 8] };
function populateIsland(world, isl, { seed, ores, gather } = {}) {
  const R = makeRng('isle:' + seed + ':' + isl.id);
  const GA = gather || { rockItems: [6, 10] };
  const [pRock, pTree, cell, shore] = LOOK[isl.look] || [0.15, 0.65, 4.4, 4.4];
  const nearBridge = (x, z, d) => (world.bridges || []).some((b) => IS.bridgeDist(b, x, z) < d);
  const taken = new Set([...world.trees, ...world.rocks].map((o) => TM.tileOf(o.x) + ',' + TM.tileOf(o.z)));
  const near = (list, x, z, d) => list.some((t) => Math.hypot(t.x - x, t.z - z) < d);
  const trees = [], rocks = [], plots = [];
  const span = isl.r * 1.5;
  for (let gz = isl.z - span; gz < isl.z + span; gz += cell) for (let gx = isl.x - span; gx < isl.x + span; gx += cell) {
    const sp = TM.spotIn(TM.tileOf(gx + R.range(0.6, cell - 0.6)), TM.tileOf(gz + R.range(0.6, cell - 0.6)));
    const x = sp.x, z = sp.z, roll = R.next();
    if (IS.shoreDist(isl, x, z) < shore || nearBridge(x, z, roll < pRock ? 4 : 5.5)) continue; // 木は葉が橋にかからないように少し広く空ける
    const k = TM.tileOf(x) + ',' + TM.tileOf(z);
    if (taken.has(k)) continue;
    if (roll < pRock) {
      if (near(rocks, x, z, 4)) continue;
      const max = R.int(GA.rockItems[0], GA.rockItems[1]);
      const rk = { ...TM.rockAt(x, z), hp: max, max };
      rk.blocks = genBlocks(seed, rk, ores);
      rocks.push(rk); taken.add(k);
    } else if (roll < pTree) { trees.push(TM.treeAt(x, z)); taken.add(k); }
  }
  // 小さな島で木が 1 本も出なかった時は、まん中のそばに少しだけ（はだかの島にしない）
  for (let k = 0; k < 8 && trees.length < 2; k++) {
    const a = k * 2.4, rr = k ? Math.min(3, isl.r * 0.35) : 0;
    const sp = TM.spotIn(TM.tileOf(isl.x + Math.cos(a) * rr), TM.tileOf(isl.z + Math.sin(a) * rr));
    const kk = TM.tileOf(sp.x) + ',' + TM.tileOf(sp.z);
    if (taken.has(kk) || IS.shoreDist(isl, sp.x, sp.z) < 2.6 || nearBridge(sp.x, sp.z, 4) || near(rocks, sp.x, sp.z, 2) || near(trees, sp.x, sp.z, 2.5)) continue;
    trees.push(TM.treeAt(sp.x, sp.z)); taken.add(kk);
  }
  // 家を建てる区画：島のまん中のまわりの輪（岸から 10 以上・橋のたもとの外）。小さな島はなし
  //   北の島（半径 32 に 10 と 18 の輪）と同じ形で、島の大きさに合わせて輪を縮める
  if (isl.r >= 15) {
    const rings = [[isl.r * 0.33, 6, 0.3], [isl.r * 0.6, 10, 0.1]];
    for (const [rr, n, off] of rings) for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2, p = { x: +(isl.x + Math.cos(a) * rr).toFixed(2), z: +(isl.z + Math.sin(a) * rr).toFixed(2), island: isl.id };
      if (IS.shoreDist(isl, p.x, p.z) >= 8.5 && !nearBridge(p.x, p.z, 7)) plots.push(p);
    }
  }
  // 区画の上の木と岩はよける
  const free = (o) => !plots.some((p) => Math.hypot(p.x - o.x, p.z - o.z) < 3.2);
  const T = trees.filter(free), K = rocks.filter(free);
  world.trees.push(...T); world.rocks.push(...K); world.plots.push(...plots);
  return { trees: T, rocks: K, plots };
}

// 拠点（村のまん中）が決まった時の、はじまり島の区画：拠点のまわりの輪（半径 12・19・26）。
//   岸から 12 未満・池・海べの特別な場所・橋のたもと・草むらにかかる区画は使わない。北の島の区画は今のまま
function basePlots(world, c) {
  const main = world.islands[0];
  const out = [];
  const ring = (r, n, off) => { for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; out.push({ x: +(c.x + Math.cos(a) * r).toFixed(2), z: +(c.z + Math.sin(a) * r * 0.92).toFixed(2) }); } };
  ring(12, 8, 0.2); ring(19, 12, 0.05); ring(26, 16, 0.3);
  const sp = world.special || {};
  const coastPts = [sp.coast, sp.coast2, sp.coast3].filter(Boolean);
  const pond = world.pond;
  const ok = (p) => IS.shoreDist(main, p.x, p.z) >= 12
    && !(pond && Math.hypot(p.x - pond.x, p.z - pond.z) < pond.r + 3.5)
    && !coastPts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 9)
    && !(world.bridges || []).some((b) => IS.bridgeDist(b, p.x, p.z) < 7)
    && !(world.bushes || []).some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 3.5);
  return out.filter(ok).concat((world.plots || []).filter((p) => p.island));
}

module.exports = { buildIslandWorld, basePlots, populateIsland, seaIslands, seaBridges, SEA_ISLES, MAIN, NORTH, FARLAND };
