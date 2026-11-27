#!/usr/bin/env node
'use strict';
// 管理者が住人を「引っ越し」させる（町から消す）。
// 使い方: node tools/moveout.js <ユーザー名 または 村人の id> [--dry] [--now 日時]
//   --dry  消すものの一覧だけ出して、何も書かない
// すること：
//   ・data/villagers.json から外す。暮らし（life.json）と、その人の日記（data/diary/*.json）も消す
//   ・家・畑・土地など world.json の持ち物は、空き地・空き家にもどす（建てた人の名簿などから外す。建物は残す）
//   ・関係（social.json：仲のよさ・おしゃべり・つながり）、ほかの人の今日の行動（おしゃべり・手伝いの相手）、state.json、
//     手紙（mail.json）・来た人ノート（visits.json）・家の飾り（decor.json）・お願い（requests.json）から、その人の id を消す
//   ・町の歴史（history.json）は過去の記録として残し（村人へのつながり who だけ外す）、「〇〇さんが島を引っ越した。」の 1 行を足す。
//     名前をかくしている人（hidden.json・TOWN_HIDDEN）は、ほかの所と同じであだ名で書く（people.js の applyPrivacy）
//   ・data/moved.json に、塩入りの印と引っ越した時刻を残す（前の「住みたい」コメントで、すぐ住み直さないため。
//     引っ越したあとに新しく「住みたい」と書けば、ふつうに新しく住める。people.js の movedBefore）
//   Cloudflare の KV（?me= の専用リンクなど）はさわらない
const fs = require('fs');
const path = require('path');
const P = require('./people');
const ST = require('./store');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry');
const who = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--now');
if (!who) { console.error('使い方: node tools/moveout.js <ユーザー名 または 村人の id> [--dry]'); process.exit(2); }
if (process.env.GITHUB_ACTIONS && P.saltIsDev) { console.error('TOWN_SALT がありません（Secrets を moveout.yml の env で渡してください）。公開データは書きません'); process.exit(1); }
const nowArg = opt('--now', process.env.TOWN_NOW || null);
const NOW = nowArg ? new Date(nowArg) : new Date();

const pathOf = (f) => path.join(DATA, f);
const readJ = (f, d) => (fs.existsSync(pathOf(f)) ? JSON.parse(fs.readFileSync(pathOf(f), 'utf8')) : d);
const write = (f, o) => fs.writeFileSync(pathOf(f), JSON.stringify(o, null, 1) + '\n');

const config = readJ('config.json', {});
const villagers = readJ('villagers.json', []);
const hidden = P.loadHidden(DATA);

// ---------- だれを引っ越させるか ----------
function findTarget(q) {
  const s = P.norm(q).replace(/^@/, '');
  return villagers.find((v) => v.key === s)
    || P.findVillager(villagers, { username: s })
    || villagers.find((v) => (v.name || '').toLowerCase() === s.toLowerCase());
}
const v = findTarget(who);
if (!v) { console.error(`「${who}」という住人は見つかりませんでした（ユーザー名か村人の id を入れてください）`); process.exit(1); }
const K = v.key;
P.applyPrivacy(v, hidden);
const label = v.hidden ? `${v.display}（名前をかくしている人）` : v.display;

// ---------- その人の id を消す（どこにあっても） ----------
const removed = []; // 一覧に出すもの
const note = (where, what) => removed.push(`${where}：${what}`);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const pairHas = (name) => name === K || String(name).split('|').includes(K);
// ある物がその人を指しているか（{ a: K } や [[K, '…']] のおしゃべりの行など、すぐ下の値だけを見る）
const refers = (o) => Object.values(o).some((x) => x === K || (Array.isArray(x) && x.some((y) => y === K || (Array.isArray(y) && y[0] === K))));
// o の中から K を消す。drop：その人を指す物（おしゃべり・手紙など）は、一覧から物ごと消す。drop でなければ、その欄だけ消す（建物などは残す）
function scrub(o, where, { drop = false } = {}) {
  if (Array.isArray(o)) {
    for (let i = o.length - 1; i >= 0; i--) {
      const x = o[i];
      if (x === K || (Array.isArray(x) && x[0] === K) || (drop && isObj(x) && refers(x))) { o.splice(i, 1); note(where, isObj(x) ? '1 件' : 'id'); continue; }
      scrub(x, where, { drop });
    }
  } else if (isObj(o)) {
    for (const k of Object.keys(o)) {
      if (pairHas(k) || o[k] === K) { delete o[k]; note(`${where}.${k.includes(K) ? '(その人の欄)' : k}`, '消す'); continue; }
      scrub(o[k], `${where}.${k}`, { drop });
    }
  }
}
// 24 時間の行動（L.hours）の「tk:K」（おしゃべり）・「hk:K」（荷物運びを手伝う）は、散歩（sp）にする
const HOURS_RE = new RegExp(`\\b[a-z]+:${K}\\b`, 'g');
const fixHours = (s) => (typeof s === 'string' ? s.replace(HOURS_RE, 'sp') : s);

// ---------- 読む ----------
const world = ST.readWorld(DATA);
const life = ST.readLife(DATA);
const state = readJ('state.json', {});
const social = readJ('social.json', { pairs: {}, talks: [] });
const history = readJ('history.json', []);
const extra = {}; // 町によってはない（手紙・飾り・来た人ノート・お願い）
for (const f of ['mail.json', 'decor.json', 'visits.json', 'requests.json', 'requests_seen.json']) if (fs.existsSync(pathOf(f))) extra[f] = readJ(f);
const before = (o) => JSON.stringify(o);
const worldBefore = before(world), stateBefore = before(state), extraBefore = Object.fromEntries(Object.entries(extra).map(([f, o]) => [f, before(o)]));

// ---------- 消す ----------
villagers.splice(villagers.indexOf(v), 1);
note('villagers.json', label);
const L = life[K];
if (L) {
  note('life.json', `暮らし（家：${L.home || 'テント'}・日記 ${(L.diary || []).length} 日分）`);
  delete life[K];
}
// ほかの人の暮らし・日記（行動の相手・贈り物の送り主など）
for (const k of Object.keys(life)) {
  const O = life[k];
  if (typeof O.hours === 'string' && HOURS_RE.test(O.hours)) { O.hours = fixHours(O.hours); note(`life.json(${k}).hours`, 'おしゃべり・手伝いの相手 → 散歩'); }
  HOURS_RE.lastIndex = 0;
  scrub(O, `life.json(${k})`);
}
// ほかの村人の欄（だれかを指す欄があれば）
scrub(villagers, 'villagers.json');
// 地図：建物は残して、建てた人の名簿・持ち主・その人の印だけ外す（空き地・空き家にもどる。家は次の入居の時に割り当て直す）
scrub(world, 'world.json');
scrub(state, 'state.json');
// 関係：その人の組・おしゃべり・つながり・見え方は、物ごと消す
scrub(social, 'social.json', { drop: true });
if (extra['mail.json']) scrub(extra['mail.json'], 'mail.json', { drop: true });
if (extra['visits.json']) scrub(extra['visits.json'], 'visits.json', { drop: true });
if (extra['decor.json']) scrub(extra['decor.json'], 'decor.json');
if (extra['requests.json']) scrub(extra['requests.json'], 'requests.json', { drop: true });
if (extra['requests_seen.json']) scrub(extra['requests_seen.json'], 'requests_seen.json');
// 歴史：行は残す（過去の記録）。村人へのつながり（who など）だけ外す
let histRefs = 0;
for (const h of history) {
  if (Array.isArray(h.who) && h.who.includes(K)) { h.who = h.who.filter((x) => x !== K); histRefs++; if (!h.who.length) delete h.who; }
  const n = removed.length; scrub(h, 'history.json'); histRefs += removed.length - n; removed.length = n;
}
if (histRefs) note('history.json', `村人へのつながり ${histRefs} か所（文はそのまま）`);
const day = state.day ?? 0;
const date = day >= 1 ? state.date : new Date(NOW.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const time = new Date(NOW.getTime() + 9 * 3600e3).toISOString().slice(11, 16);
const line = { day, date, time, type: 'moveout', text: `${v.display}さんが島を引っ越した。` };
history.push(line);
// 引っ越した印（前のコメントで住み直さない）
const moved = P.loadMoved(DATA).filter((m) => m.u !== v.userHash);
moved.push({ u: v.userHash, ig: [v.igId, ...(v.igAlt || [])].filter(Boolean), at: NOW.toISOString() });

// ---------- 残っていないか確かめる ----------
const left = [];
const find = (o, where) => {
  if (typeof o === 'string') { if (o.includes(K)) left.push(where); return; }
  if (o && typeof o === 'object') for (const [k, x] of Object.entries(o)) { if (k.includes(K)) left.push(`${where}.{${k}}`); find(x, `${where}.${k}`); }
};
find(villagers, 'villagers'); find(world, 'world'); find(state, 'state'); find(social, 'social'); find(life, 'life'); find(history, 'history');
for (const [f, o] of Object.entries(extra)) find(o, f);

// ---------- 出す・書く ----------
const counts = new Map();
for (const r of removed) counts.set(r, (counts.get(r) || 0) + 1);
console.log(`${DRY ? '［ためし］' : ''}${label}（村人の id ${K}）を引っ越しさせます`);
for (const [r, n] of counts) console.log(`  - ${r}${n > 1 ? ` ×${n}` : ''}`);
console.log(`  + history.json：「${line.text}」を足す`);
console.log(`  + moved.json：引っ越した時刻（${NOW.toISOString()}）より前の「住みたい」では住み直さない`);
if (left.length) { console.error(`まだ id が残っています：\n  ${left.join('\n  ')}`); process.exit(1); }
if (DRY) { console.log('--dry なので、何も書きませんでした'); process.exit(0); }

write('villagers.json', villagers);
ST.writeLife(DATA, life); // その人の日記も、日記の組のファイルから消える
if (before(world) !== worldBefore) ST.writeWorld(DATA, world, { clearR: ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
if (before(state) !== stateBefore) write('state.json', state);
write('social.json', social);
write('history.json', history);
for (const [f, o] of Object.entries(extra)) if (before(o) !== extraBefore[f]) write(f, o);
write('moved.json', moved);
console.log(`${label} は島を引っ越しました`);
