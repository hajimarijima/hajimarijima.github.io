#!/usr/bin/env node
'use strict';
// 動画用に、0 日目から 2 日目までの町のようすを 1 日ずつ記録して video/days.json に書く。
// 動画は「だれもいない → 参加 → 整地 → 何を建てる？ → どこに建てる？ → 木を切る・掘る → 道具を作る → 建て始める → チェスト」を
// この記録のとおりに見せる（投票の結果・チェストの中身・道具の段階は sim.js が出したまま）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DAYS = Number(process.argv[2]) || 2;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-video-'));
fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
if (fs.existsSync(path.join(ROOT, 'data', 'hidden.json'))) fs.copyFileSync(path.join(ROOT, 'data', 'hidden.json'), path.join(dir, 'hidden.json'));
const env = { ...process.env, TOWN_DATA: dir };
const run = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, 'tools', f), ...a], { env });
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

run('init.js', '--demo');
// 動画の最初の人は「参加したい ピッケル」とコメントしたつもりで、つるはしを選ぶ（1 日目の 3 人目。1・2 人目は整地をする）。
// 4・5 人目は「斧」「釣り」と書いたつもり。1・2 人目は道具の言葉なし（人の少ない仕事の道具が自動で決まる）
{
  const vs = read('villagers.json');
  const d1 = vs.filter((v) => v.joinedDay <= 1);
  if (d1[2]) d1[2].startTool = 'pickaxe'; // 「参加したい ピッケル」
  if (d1[3]) d1[3].startTool = 'axe';     // 「参加したい 斧」
  if (d1[4]) d1[4].startTool = 'fishing_rod'; // 「参加したい 釣り」
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify(vs, null, 2));
}
const base = require('./store').readWorld(dir);
const out = {
  trees: base.trees.map(({ id, x, z, kind, size, far }) => ({ id, x, z, kind, size, far })),
  bushes: base.bushes.map(({ id, x, z }) => ({ id, x, z })),
  seaZ: base.seaZ, campfire: base.campfire, square: base.square, debris: base.debris, chest: base.chest, pond: base.pond, animals: base.animals, days: [],
};
const snap = () => {
  const w = require('./store').readWorld(dir), s = read('state.json'), life = require('./store').readLife(dir), vs = read('villagers.json');
  out.days.push({
    day: s.day, followers: s.followers, resources: s.resources, store: s.store,
    trees: w.trees.map((t) => (t.gone ? 'g' : t.state[0])).join(''),
    rocks: w.rocks.map(({ id, x, z, hp, max, kind, blocks, far, gen }) => ({ id, x, z, hp, max, kind, blocks, far, gen })),
    fields: w.fields.map(({ id, x, z, stage }) => ({ id, x, z, stage })),
    square: w.square, chest: w.chest,
    votes: (s.votes || []).map(({ kind, question, options, votes, voters, opensAt, closesAt }) => ({ kind, question, options, votes, voters, opensAt, closesAt })),
    plan: s.plan, nextTool: s.nextTool,
    active: vs.filter((v) => v.joinedDay <= s.day).map((v) => v.key),
    // [仕事, 相手, 家, 仕事の種類, 道具の段階, 今日の日記, 持ち物, 最初の道具, 自動で決まったか]
    life: Object.fromEntries(Object.entries(life).map(([k, L]) => [k, [L.action, L.target, L.home, L.job, L.toolTier || 'hand', (L.diary[L.diary.length - 1] || {}).text || '', (L.inv || []).filter(Boolean).map((x) => x.item), L.startTool || null, !!L.startAuto]])),
  });
  return { w, s, vs };
};
snap();
let last;
for (let d = 1; d <= DAYS; d++) { run('sim.js', '--demo'); last = snap(); }
out.buildings = last.w.buildings;
out.decisions = last.s.decisions;
out.history = read('history.json').filter((h) => h.day <= DAYS).map(({ day, type, text }) => ({ day, type, text }));
out.villagers = last.vs.map(({ key, hidden, skin, joinedDay, profile, startTool }) => ({ key, hidden, skin, joinedDay, startTool, profile: profile && profile.color ? { color: profile.color } : undefined }));
fs.mkdirSync(path.join(ROOT, 'video'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'video', 'days.json'), JSON.stringify(out));
fs.rmSync(dir, { recursive: true, force: true });
console.log('video/days.json に ' + out.days.length + ' 日ぶん書きました（決まった投票 ' + out.decisions.length + '）');
