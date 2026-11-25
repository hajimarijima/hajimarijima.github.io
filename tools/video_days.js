#!/usr/bin/env node
'use strict';
// 動画用に、0 日目から 30 日目までの町のようすを 1 日ずつ記録して video/days.json に書く。
// data/ と同じ種・同じ手順なので、30 日目は data/ と同じ町になる。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DAYS = Number(process.argv[2]) || 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-video-'));
fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
if (fs.existsSync(path.join(ROOT, 'data', 'hidden.json'))) fs.copyFileSync(path.join(ROOT, 'data', 'hidden.json'), path.join(dir, 'hidden.json'));
const env = { ...process.env, TOWN_DATA: dir };
const run = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, 'tools', f), ...a], { env });
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

run('init.js', '--demo');
const base = read('world.json');
const out = { trees: base.trees.map(({ id, x, z, kind, size, far }) => ({ id, x, z, kind, size, far })), bushes: base.bushes.map(({ id, x, z }) => ({ id, x, z })), seaZ: base.seaZ, campfire: base.campfire, days: [], nights: {} };
const snap = () => {
  const w = read('world.json'), s = read('state.json'), life = read('life.json'), vs = read('villagers.json');
  out.days.push({
    day: s.day, followers: s.followers, resources: s.resources,
    trees: w.trees.map((t) => t.state[0]).join(''),
    bushes: w.bushes.map((b) => (b.ready ? 1 : 0)).join(''),
    rocks: w.rocks.map(({ id, x, z, hp, max, kind, blocks, far }) => ({ id, x, z, hp, max, kind, blocks, far })),
    fields: w.fields.map(({ id, x, z, stage }) => ({ id, x, z, stage })),
    active: vs.filter((v) => v.joinedDay <= s.day).map((v) => v.key),
    life: Object.fromEntries(Object.entries(life).map(([k, L]) => [k, [L.action, L.target, L.home, L.job]])),
  });
  if (s.night) { const { hid, ...n } = s.night; out.nights[s.day] = n; } // その日の夜（敵・見張り・結果）
  return { w, s, vs };
};
snap();
let last;
for (let d = 1; d <= DAYS; d++) { run('sim.js', '--demo'); last = snap(); }
out.buildings = last.w.buildings;
out.villagers = last.vs.map(({ key, display, hidden, skin, joinedDay }) => ({ key, display, hidden, skin, joinedDay }));
out.decisions = last.s.decisions;
const soc = read('social.json');
out.pairs = soc.pairs;
out.talks = soc.talks || [];
out.edges = soc.edges || [];
out.plots = last.w.plots;
out.history = read('history.json').filter((h) => h.type === 'social' || h.type === 'birthday' || h.type === 'night' || h.type === 'find');
out.villagers = last.vs.map(({ key, display, hidden, skin, joinedDay, mbti, birthday, profile }) => ({ key, display, hidden, skin, joinedDay, mbti, birthday, profile }));
fs.mkdirSync(path.join(ROOT, 'video'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'video', 'days.json'), JSON.stringify(out));
fs.rmSync(dir, { recursive: true, force: true });
console.log('video/days.json に ' + out.days.length + ' 日ぶん書きました（建物 ' + out.buildings.length + '）');
