#!/usr/bin/env node
'use strict';
// 「今日の村人」の動画を作る：村人を 1 人選んで video/villager.html で 1 日を描き、tools/render_video.js で mp4 にする。
//   node tools/villager_video.js                 … くじ引き（seed は今の時刻）
//   node tools/villager_video.js --seed 7        … seed 7 のくじ引き（同じ seed なら同じ人・同じ仲間）
//   node tools/villager_video.js --key 51dd020030 … この人に決める
//   --list … 選べる人の一覧を出すだけ。--no-render … 選ぶだけ（書き出さない）
// 書き出す物：video/villager_<key>.mp4・villager_<key>_720p.mp4・villager_<key>_コマ一覧.jpg
// data/ は読むだけ（書きかえない）。sim.js・join.js は動かさない。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const villagers = read('villagers.json'), state = read('state.json'), life = read('life.json');
const active = villagers.filter((v) => (v.joinedDay ?? 0) <= state.day);
if (!active.length) { console.error('村人がまだいません'); process.exit(1); }

if (process.argv.includes('--list')) {
  for (const v of active) { const L = life[v.key] || {}; console.log(`${v.key}  ${v.hidden ? v.display : '@' + v.name}  ${L.startTool || v.startTool || ''}  ${L.chrono || ''}`); }
  process.exit(0);
}
const seed = (Number(arg('--seed')) || (Date.now() % 1000000007)) >>> 0;
// くじ引き：ページと同じ乱数（seed から 1 回目）
let rs = seed;
const rnd = () => { rs = (rs + 0x6D2B79F5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const key = arg('--key') || null;
let hero = key ? active.find((v) => v.key === key) : null;
if (key && !hero) { console.error('その key の村人はいません: ' + key + '（--list で一覧）'); process.exit(1); }
if (!hero) {
  // ページの並び（来た順）と同じ順でくじを引く
  const order = active.map((v, i) => ({ v, i })).sort((a, b) => (a.v.joinedDay ?? 0) - (b.v.joinedDay ?? 0) || String(a.v.joinedAt || '').localeCompare(String(b.v.joinedAt || '')) || a.i - b.i).map((o) => o.v);
  hero = order[Math.floor(rnd() * order.length)];
}
const name = 'villager_' + hero.key;
console.log(`今日の村人：${hero.hidden ? hero.display : '@' + hero.name}（key ${hero.key}・seed ${seed}）`);
if (process.argv.includes('--no-render')) process.exit(0);

const page = `video/villager.html?key=${hero.key}&seed=${seed}`;
const render = (extra) => execFileSync(process.execPath, [path.join(__dirname, 'render_video.js'), '--page', page, '--name', name, '--maxmb', '9.5', '--gpu', ...extra], { stdio: 'inherit', cwd: ROOT });
render([]);
render(['--sheet', '40']);
console.log(`できました：video/${name}.mp4・${name}_720p.mp4・${name}_コマ一覧.jpg`);
