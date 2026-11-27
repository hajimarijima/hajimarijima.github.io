#!/usr/bin/env node
'use strict';
// js/workshop.js の「工房の決まり：ここから〜ここまで」を、受け口（tools/webhook/worker.mjs）に同じ文字のまま写す。
//   受け口は Cloudflare の画面に 1 つのファイルで貼るので、import できない。js/workshop.js を書きかえたら、これを動かしてから貼り直す。
//   使い方: node tools/sync_workshop.js [worker.mjs のパス]
const fs = require('fs');
const path = require('path');
const A = '// ==== 工房の決まり：ここから', B = '// ==== 工房の決まり：ここまで ====';
function block(src) { const i = src.indexOf(A), j = src.indexOf(B); if (i < 0 || j < 0) return null; return src.slice(i, j + B.length); }
function sync(workshopSrc, workerSrc) {
  const b = block(workshopSrc);
  if (!b) throw new Error('js/workshop.js に印がありません');
  const old = block(workerSrc);
  if (old) return workerSrc.replace(old, () => b);
  const at = workerSrc.indexOf('\nexport { poll,');
  if (at < 0) throw new Error('worker.mjs に入れる所がありません');
  return workerSrc.slice(0, at) + '\n' + b + '\n' + workerSrc.slice(at);
}
module.exports = { block, sync };
if (require.main === module) {
  const ROOT = path.join(__dirname, '..');
  const wp = process.argv[2] || path.join(ROOT, 'tools', 'webhook', 'worker.mjs');
  const out = sync(fs.readFileSync(path.join(ROOT, 'js', 'workshop.js'), 'utf8'), fs.readFileSync(wp, 'utf8'));
  fs.writeFileSync(wp, out);
  console.log('写しました：' + path.relative(ROOT, wp));
}
