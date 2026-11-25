#!/usr/bin/env node
'use strict';
// インスタの「情報をダウンロード」で届いたフォロワー一覧（followers_1.json など）を村人に足す。
// 使い方: data/import/ に followers_*.json を置いて
//   node tools/import_followers.js
// もういる人は足さない（名前で見分ける）。足した人は次の日から村で働く。
const fs = require('fs');
const path = require('path');
const P = require('./people');

const DATA = process.env.TOWN_DATA || path.join(__dirname, '..', 'data');
const DIR = path.join(DATA, 'import');
const read = (f, d) => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d; };

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^followers.*\.json$/i.test(f)) : [];
if (!files.length) { console.log('data/import/ に followers_1.json などを置いてください'); process.exit(0); }

const villagers = read('villagers.json', []);
const state = read('state.json');
const hidden = P.loadHidden(DATA);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const day = state.day + 1; // 次の日から参加
let added = 0, skipped = 0;
for (const f of files) {
  const list = P.readFollowerExport(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
  for (const u of list) {
    const v = P.upsertVillager(villagers, { username: u.username, joined: addDays(state.startDate, day - 1), joinedDay: day, source: 'followers' }, hidden);
    if (v) added++; else skipped++;
  }
}
fs.writeFileSync(path.join(DATA, 'villagers.json'), JSON.stringify(villagers, null, 1) + '\n');
console.log(`${files.join(', ')} から ${added} 人を足しました（もういた人 ${skipped} 人）。${day}日目から村で働きます。`);
console.log('注意: data/import/ のファイルには全員の名前が入っています。GitHub には上げないでください（.gitignore 済み）。');
