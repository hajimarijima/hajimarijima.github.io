#!/usr/bin/env node
'use strict';
// 町を「何もない平地に木と岩だけ」の 0 日目に戻す。
// 使い方: node tools/init.js [--demo] [--seed 文字列] [--start 2026-11-01]
//   --demo を付けると見本の村人 20 人を入れる（参加日はばらばら）。
const fs = require('fs');
const path = require('path');
const { makeRng } = require('./rand');
const { loadHidden, upsertVillager } = require('./people');
const { genBlocks } = require('./ores');

const DATA = process.env.TOWN_DATA || path.join(__dirname, '..', 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const demo = args.includes('--demo');
const seed = opt('--seed', 'machi-12');
const start = opt('--start', '2026-11-01');
const R = makeRng('world:' + seed);

let ORES = null; try { ORES = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).ores; } catch (e) { /* なければ既定の確率 */ }
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 1) + '\n');

// ---------- 地形 ----------
// x: 西(-) 東(+)、z: 北(-) 南(+)。南の z > 24 は海。
const SEA_Z = 34;
const plots = [];
const ring = (r, n, off) => { for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; plots.push({ x: +(Math.cos(a) * r).toFixed(2), z: +(Math.sin(a) * r * 0.92 - 1).toFixed(2) }); } };
ring(12, 8, 0.2);
ring(19, 12, 0.05);
ring(26, 16, 0.3);
const special = {
  center: { x: 0, z: -1 },
  coast: { x: 8, z: 32.5 }, coast2: { x: -7, z: 31 }, coast3: { x: 22, z: 32 },
};
const freePlots = plots.filter((p) => p.z < 28); // 海べは特別な場所用

let GATHER = { rockItems: [6, 10] }; try { GATHER = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).gather || GATHER; } catch (e) { /* 既定 */ }
const SQUARE = { x: 0, z: -1, r: 8 }; // 村のまん中（最初の日に整地する所）
const FIELD = (x, z) => x < -30 && x > -46 && z > -10 && z < 12; // 畑の場所
const BUSH = (x, z) => x > 30 && x < 46 && z > -2 && z < 16;      // 草むら
const near = (list, x, z, d) => list.some((t) => Math.hypot(t.x - x, t.z - z) < d);
const FAR = 44; // まん中からこれより遠い木と岩は、サイトでまとめて描く（far）

// ---------- 木と岩：地図全体にまんべんなく（格子の目ごとに少しずらして置く） ----------
// 一辺がおおよそ 220（x -108〜108、z -108〜海）。村のまん中・畑・草むら・海だけは空ける
const HALF = 108, CELL = 6;
const trees = [], rocks = [];
for (let gz = -HALF; gz < SEA_Z - 5; gz += CELL) {
  for (let gx = -HALF; gx < HALF; gx += CELL) {
    const x = gx + R.range(0.6, CELL - 0.6), z = gz + R.range(0.6, CELL - 0.6);
    const roll = R.next();
    if (z > SEA_Z - 5 || Math.hypot(x - SQUARE.x, z - SQUARE.z) < SQUARE.r + 2.5 || FIELD(x, z) || BUSH(x, z)) continue;
    const far = Math.hypot(x, z + 1) > FAR ? 1 : 0;
    if (roll < 0.12) {
      if (near(rocks, x, z, 4)) continue;
      const max = R.int(GATHER.rockItems[0], GATHER.rockItems[1]);
      const rk = { id: 'r' + rocks.length, x: +x.toFixed(2), z: +z.toFixed(2), hp: max, max, kind: R.int(0, 2) };
      if (far) rk.far = 1;
      rk.blocks = genBlocks(seed, rk, ORES); // 中身（1 つずつ落ちる物：石・石炭・鉄・金・ダイヤ）
      rocks.push(rk);
    } else if (roll < 0.66) {
      const t = { id: 't' + trees.length, x: +x.toFixed(2), z: +z.toFixed(2), state: 'tree', regrow: 0, kind: R.int(0, 2), size: +R.range(0.85, 1.2).toFixed(2) };
      if (far) t.far = 1;
      trees.push(t);
    }
  }
}
// 最初の日に掘る岩が近くにあるように、まん中のそばに 2 つ
for (const [x, z] of [[11.5, -9.5], [-10.5, 7.5]]) {
  if (near(rocks, x, z, 3)) continue;
  for (let i = trees.length - 1; i >= 0; i--) if (Math.hypot(trees[i].x - x, trees[i].z - z) < 3.2) trees.splice(i, 1);
  const max = R.int(GATHER.rockItems[0], GATHER.rockItems[1]);
  const rk = { id: 'r' + rocks.length, x, z, hp: max, max, kind: 0 };
  rk.blocks = genBlocks(seed, rk, ORES);
  rocks.push(rk);
}
trees.forEach((t, i) => { t.id = 't' + i; });

// 整地する前の村のまん中：草と小石
const debris = [];
for (let i = 0; i < 22; i++) {
  const a = R.range(0, Math.PI * 2), r = Math.sqrt(R.next()) * (SQUARE.r - 0.8);
  debris.push({ x: +(SQUARE.x + Math.cos(a) * r).toFixed(2), z: +(SQUARE.z + Math.sin(a) * r).toFixed(2), k: R.chance(0.6) ? 'grass' : 'stone', s: +R.range(0.7, 1.3).toFixed(2) });
}

const bushes = [];
let tries = 0;
while (bushes.length < 12 && tries++ < 2000) {
  const x = R.range(32, 44), z = R.range(0, 14);
  if (near(bushes, x, z, 2.2)) continue;
  bushes.push({ id: 'b' + bushes.length, x: +x.toFixed(2), z: +z.toFixed(2), ready: true, regrow: 0 });
}

// 畑の区画（耕されると使われる）
const fieldSlots = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) fieldSlots.push({ x: -43 + i * 3.6 + 1.5, z: -7 + j * 3.6 + 1.5 });

const world = {
  size: 220, seaZ: SEA_Z,
  trees, rocks, bushes,
  fields: [], fieldSlots,
  buildings: [],
  plots: freePlots, special,
  campfire: { x: 2.5, z: 3 },
  square: { ...SQUARE, leveled: 0 }, debris,
  chest: { x: 5.2, z: 0.6, day: 0 }, // 集めた物を入れるチェスト（最初の村人が来た日に置く）
};

// ---------- 村人 ----------
// 見本の名前は「村人1」の形（Instagram の ID には日本語が使えないので、実在の人と重ならない）
const NAMES = Array.from({ length: 20 }, (_, i) => '村人' + (i + 1));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const villagers = [];
const hidden = loadHidden(DATA);
if (demo) NAMES.forEach((name, i) => {
  const joinedDay = i < 5 ? 1 : Math.min(24, 1 + Math.round((i - 4) * 1.3 + R.range(0, 1.5)));
  upsertVillager(villagers, { username: name, joined: addDays(start, joinedDay - 1), joinedDay, source: 'demo' }, hidden);
});

const state = {
  title: 'みんなで町づくり',
  seed, startDate: start, day: 0, date: addDays(start, -1),
  demo,
  resources: { wood: 0, stone: 0, food: 10 },
  totals: { wood: 0, stone: 0, food: 0 },
  followers: demo ? 4 : 0,
  followerLog: [],
  reached: [], vote: null, votes: [], decisions: [], plan: null, pool: null, toolGoal: null,
  store: { berry: 30 }, // チェストの中身（はじめは持ってきた木の実だけ）
  bonus: { wood: 0, stone: 0, food: 0 },
  weather: '晴れ', updated: null,
};

write('world.json', world);
write('villagers.json', villagers);
write('state.json', state);
write('life.json', {});
write('social.json', { pairs: {}, talks: [] });
write('history.json', [{ day: 0, date: state.date, type: 'start', text: '何もない平地に、木と岩だけがある。ここから町づくりが始まる。' }]);
console.log('0 日目にしました（' + (demo ? '見本の村人 ' + villagers.length + ' 人' : '村人なし') + '）');
