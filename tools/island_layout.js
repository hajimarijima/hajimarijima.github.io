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

const MAIN = { id: 'main', name: 'はじまり島', x: 0, z: 0, r: 50, wob: [[0.05, 3, 0.7], [0.035, 5, 2.1], [0.02, 7, 4.0]] };
const NORTH = { id: 'north', name: '北の島', x: 6, z: -104, r: 32, wob: [[0.06, 3, 1.9], [0.04, 4, 0.3]], open: 0 };
// 遠くの大陸：北東の海の向こう（いちばん近い岸まで、はじまり島の岸から 50〜100）。山と森がある大きな陸。
//   見えるだけで、今は行けない（wild：木と岩は見た目だけ。村人は使わない）。町の画面を開くと右上にかすんで見える
const FARLAND = { id: 'far', x: 310, z: -190, r: 235, wob: [[0.05, 3, 0.4], [0.035, 5, 1.7], [0.02, 9, 2.9]], wild: true, open: 0 };

// candidates（拠点の投票の候補 [{ key, x, z }]）を渡すと、候補の場所のまわり（半径 6）を少し空けておく（旗と札が見えるように）。
//   その時は、まん中のそばの「最初の日に掘る岩」は置かない（拠点が決まってから、そのまわりをならす）
function buildIslandWorld({ seed, ores, gather, debris, candidates = null }) {
  const nearCand = (x, z, d) => !!candidates && candidates.some((c) => Math.hypot(c.x - x, c.z - z) < d);
  const R = makeRng('island:' + seed);
  const GA = gather || { rockItems: [6, 10] };
  const main = { ...MAIN }, north = { ...NORTH };
  const islands = [main, north, { ...FARLAND }];
  const ends = IS.bridgeEnds(main, north, 2.5);
  const bridge = { id: 'north', to: 'north', name: '北の島への橋', a: r2p(ends.a), b: r2p(ends.b), w: 3.4, built: 0 };
  const SQUARE = { x: 0, z: -1, r: 8 };
  const POND = { x: -20, z: 15, r: 4.2 };
  const MEADOW = { x0: -42, x1: -29, z0: -10, z1: 10 }; // 木を置かない野原（西）
  const inMeadow = (x, z) => x > MEADOW.x0 && x < MEADOW.x1 && z > MEADOW.z0 && z < MEADOW.z1;
  const nearBridge = (x, z, d) => IS.bridgeDist(bridge, x, z) < d;
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
    islands, bridges: [bridge], meadow: MEADOW,
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

module.exports = { buildIslandWorld, basePlots, MAIN, NORTH, FARLAND };
