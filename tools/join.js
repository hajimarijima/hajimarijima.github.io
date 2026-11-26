#!/usr/bin/env node
'use strict';
// 「住みたい」コメントの受付だけをする（15 分ごとに動かす。町は進めない）。
// 新しい人は「次の日」（state.day + 1）の村人として villagers.json に入れる。
// 朝 6 時の sim.js は joinedDay がその日の人を「今日来た人」として迎えるので、ここで入れた人もいつもどおり町に来る。
// 使い方: node tools/join.js [--inbox ファイル]（既定: data/inbox/instagram.json）
const fs = require('fs');
const path = require('path');
const P = require('./people');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const inboxFile = opt('--inbox', path.join(DATA, 'inbox', 'instagram.json'));
if (!fs.existsSync(inboxFile)) { console.log('コメントのファイルがないので、何もしません'); process.exit(0); }
const inbox = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
const config = read('config.json');
const state = read('state.json');
let villagers = read('villagers.json');
// 町のアカウントの持ち主は村人にしない（前に入ってしまった分も外す）
const owners = [inbox.owner, ...((config.joinExclude) || [])].filter(Boolean).map((s) => String(s).toLowerCase());
const before = villagers.length;
villagers = villagers.filter((v) => !owners.includes(String(v.name || '').toLowerCase()));
if (villagers.length !== before) { fs.writeFileSync(path.join(DATA, 'villagers.json'), JSON.stringify(villagers, null, 1) + '\n'); console.log(`持ち主のアカウントを村人から ${before - villagers.length} 人外しました`); }
if (!inbox.joinComments || !inbox.joinComments.length) { console.log('「住みたい」コメントはありません'); process.exit(0); }

const hidden = P.loadHidden(DATA);
const day = state.day + 1;
const date = addDays(state.startDate, day - 1);
const enemies = !!(config.enemies && config.enemies.enabled);

let added = 0;
for (const r of P.registrationsFrom(inbox.joinComments, config.joinWord, config.startTools, { enemies })) {
  const v = P.upsertVillager(villagers, { igId: r.igId, username: r.username, joined: date, joinedDay: day, source: 'comment', startTool: r.startTool }, hidden);
  if (v) added++;
}
for (const v of villagers) P.applyPrivacy(v, hidden);
fs.writeFileSync(path.join(DATA, 'villagers.json'), JSON.stringify(villagers, null, 1) + '\n');
console.log(`受付：新しく ${added} 人（${day} 日目の朝に町へ来る）`);
