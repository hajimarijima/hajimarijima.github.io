#!/usr/bin/env node
'use strict';
// 名前を出したくない人を data/hidden.json に足す。
// 名前そのものではなく、名前から作った印（sha256:...）を書くので、hidden.json を公開しても名前はわからない。
// 使い方: node tools/hide.js ユーザー名 [ユーザー名 ...]
const fs = require('fs');
const path = require('path');
const P = require('./people');

const DATA = process.env.TOWN_DATA || path.join(__dirname, '..', 'data');
const f = path.join(DATA, 'hidden.json');
const names = process.argv.slice(2);
if (!names.length) { console.log('使い方: node tools/hide.js ユーザー名'); process.exit(0); }
const list = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
for (const n of names) { const h = 'sha256:' + P.userHash(n); if (!list.includes(h)) list.push(h); }
fs.writeFileSync(f, JSON.stringify(list, null, 1) + '\n');

// 今いる村人にもすぐ反映する
const vf = path.join(DATA, 'villagers.json');
if (fs.existsSync(vf)) {
  const hidden = P.loadHidden(DATA);
  const vs = JSON.parse(fs.readFileSync(vf, 'utf8'));
  vs.forEach((v) => P.applyPrivacy(v, hidden));
  fs.writeFileSync(vf, JSON.stringify(vs, null, 1) + '\n');
}
console.log(names.length + ' 人をあだ名で出すようにしました');
