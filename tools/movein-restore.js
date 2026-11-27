#!/usr/bin/env node
'use strict';
// 引っ越した人（tools/moveout.js）を、30 日以内なら元にもどす（家・関係・日記ごと）。管理者だけが Actions の restore で動かす。
// 使い方:
//   node tools/movein-restore.js <ユーザー名> [--dry] [--now 日時]   元にもどす（--dry はもどす物の一覧だけ）
//   node tools/movein-restore.js <ユーザー名> --hash                  保管の名前（塩入りの印）を出す（restore.yml が artifact を探すのに使う）
//   node tools/movein-restore.js --purge [--now 日時]                 30 日を過ぎた保管分を消す
// 保管は tools/vault.js（.vault/ か TOWN_VAULT。Actions では moveout.yml が上げた artifact を restore.yml が置く）。
//   ・家がもう別の人で埋まっていたら、空いている家に入れる（なければテント）
//   ・data/moved.json の印を外す。歴史には「〇〇さんが島にもどってきた。」を足す（引っ越した行は記録として残す）
const fs = require('fs');
const path = require('path');
const P = require('./people');
const ST = require('./store');
const VAULT = require('./vault');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry');
const nowArg = opt('--now', process.env.TOWN_NOW || null);
const NOW = nowArg ? new Date(nowArg) : new Date();
const who = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--now');
if (process.env.GITHUB_ACTIONS && P.saltIsDev) { console.error('TOWN_SALT がありません（Secrets を restore.yml の env で渡してください）'); process.exit(1); }

if (args.includes('--purge')) {
  const n = VAULT.purge(NOW);
  console.log(`${VAULT.KEEP_DAYS} 日を過ぎた保管分を ${n} 件消しました`);
  process.exit(0);
}
if (!who) { console.error('使い方: node tools/movein-restore.js <ユーザー名> [--dry]'); process.exit(2); }
const uname = P.norm(who).replace(/^@/, '');
const uh = P.userHash(uname);
if (args.includes('--hash')) { console.log(uh); process.exit(0); }

const file = VAULT.fileOf(uh);
if (!fs.existsSync(file)) { console.error(`「${uname}」の保管が見つかりません（引っ越していないか、${VAULT.KEEP_DAYS} 日を過ぎて消えました）`); process.exit(1); }
const env = JSON.parse(fs.readFileSync(file, 'utf8'));
if (VAULT.expired(env.at, NOW)) {
  if (!DRY) fs.unlinkSync(file);
  console.error(`「${uname}」は引っ越してから ${VAULT.KEEP_DAYS} 日を過ぎたので、もどせません${DRY ? '' : '（保管を消しました）'}`);
  process.exit(1);
}
let B;
try { B = VAULT.open(env); } catch { console.error('保管を開けませんでした（TOWN_SALT がちがう？）'); process.exit(1); }
const K = B.key;

const pathOf = (f) => path.join(DATA, f);
const readJ = (f, d) => (fs.existsSync(pathOf(f)) ? JSON.parse(fs.readFileSync(pathOf(f), 'utf8')) : d);
const write = (f, o) => fs.writeFileSync(pathOf(f), JSON.stringify(o, null, 1) + '\n');
const config = readJ('config.json', {});
const villagers = readJ('villagers.json', []);
const hidden = P.loadHidden(DATA);
// もう住んでいる（引っ越したあと、新しく「住みたい」で住んだ）人は、もどさない（二重になるため）
if (villagers.some((x) => x.key === K || x.userHash === B.villager.userHash)) { console.error(`「${uname}」はもう島に住んでいます（新しく住み直した人は、もどせません）`); process.exit(1); }

const files = {
  villagers, world: ST.readWorld(DATA), life: ST.readLife(DATA), state: readJ('state.json', {}),
  social: readJ('social.json', { pairs: {}, talks: [] }), history: readJ('history.json', []),
};
for (const f of ['mail.json', 'decor.json', 'visits.json', 'requests.json', 'requests_seen.json']) files[f] = readJ(f, null);
const before = Object.fromEntries(Object.entries(files).map(([f, o]) => [f, JSON.stringify(o)]));

// ---------- 消した所を、逆の順でもどす ----------
let back = 0, skipped = 0;
const walk = (o, p) => { for (const s of p) { if (o == null || typeof o !== 'object') return null; o = o[s]; } return o; };
for (const op of [...B.ops].reverse()) {
  if (files[op.f] == null) { // 消したあとにファイルがなくなった（手紙など）
    if (op.p.length || op.k == null) { skipped++; continue; }
    files[op.f] = {};
  }
  const parent = op.p.length ? walk(files[op.f], op.p) : files[op.f];
  if (op.i != null && Array.isArray(parent)) {
    if (typeof op.x === 'string' && parent.includes(op.x)) continue; // 名簿にもう入っている
    parent.splice(Math.min(op.i, parent.length), 0, op.x); back++;
  } else if (op.k != null && parent && typeof parent === 'object' && !Array.isArray(parent)) {
    if (!(op.k in parent)) { parent[op.k] = op.x; back++; }
  } else skipped++; // その場所がもうない（日が進んで作り直された予定など）
}
// ほかの人の今日の行動（散歩にした所）：そのあと日が進んで変わっていなければもどす
for (const h of B.hours || []) { const O = files.life[h.k]; if (O && O.hours === h.to) O.hours = h.from; }
// 村人の行と暮らし（日記もいっしょ）
const v = B.villager;
files.villagers.splice(Math.min(B.vIndex, files.villagers.length), 0, v);
P.applyPrivacy(v, hidden);
let homeNote = 'テント';
if (B.life) {
  const L = files.life[K] = B.life;
  // 家：前の家に空きがあればそこへ。埋まっていたら、空いている家（なければテント）
  const cap = (b) => (config.buildings && config.buildings[b.type] && config.buildings[b.type].cap) || 0;
  const used = (id) => Object.entries(files.life).filter(([k, O]) => k !== K && O && O.home === id).length;
  const bs = (files.world.buildings || []).filter((b) => cap(b) > 0);
  const old = L.home && bs.find((b) => b.id === L.home);
  if (!L.home) homeNote = 'テント（前もテント。家は次の入居の時に割り当て直す）';
  else if (old && used(old.id) < cap(old)) homeNote = `元の家 ${old.id}`;
  else {
    const free = bs.find((b) => used(b.id) < cap(b));
    homeNote = free ? `空いている家 ${free.id}（元の家 ${L.home} は埋まっていた）` : `テント（空いている家がない）`;
    L.home = free ? free.id : null;
  }
}
const st = files.state;
const day = st.day ?? 0;
const date = day >= 1 ? st.date : new Date(NOW.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const time = new Date(NOW.getTime() + 9 * 3600e3).toISOString().slice(11, 16);
const line = { day, date, time, type: 'movein', text: `${v.display}さんが島にもどってきた。`, who: [K] };
files.history.push(line);
const moved = P.loadMoved(DATA).filter((m) => m.u !== v.userHash);

const label = v.hidden ? `${v.display}（名前をかくしている人）` : v.display;
console.log(`${DRY ? '［ためし］' : ''}${label}（村人の id ${K}、${B.at} に引っ越し）を元にもどします`);
console.log(`  + 村人の行・暮らし・日記 ${((B.life && B.life.diary) || []).length} 日分`);
console.log(`  + 家：${homeNote}`);
console.log(`  + 関係・名簿など：${back} か所もどす${skipped ? `（${skipped} か所は、もう場所がないのでもどさない）` : ''}`);
console.log(`  + history.json：「${line.text}」を足す・moved.json の印を外す・保管を消す`);
if (DRY) { console.log('--dry なので、何も書きませんでした'); process.exit(0); }

write('villagers.json', files.villagers);
ST.writeLife(DATA, files.life);
if (JSON.stringify(files.world) !== before.world) ST.writeWorld(DATA, files.world, { clearR: ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
for (const f of ['state', 'social', 'history']) if (JSON.stringify(files[f]) !== before[f]) write(`${f}.json`, files[f]);
for (const f of ['mail.json', 'decor.json', 'visits.json', 'requests.json', 'requests_seen.json']) if (files[f] != null && JSON.stringify(files[f]) !== before[f]) write(f, files[f]);
write('moved.json', moved);
fs.unlinkSync(file);
console.log(`${label} は島にもどりました`);
