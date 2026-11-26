#!/usr/bin/env node
'use strict';
// 「住みたい」コメントの受付をして、その場で町に迎える（15 分ごとに動かす。日は進めない）。
// 新しい人は「今の日」（state.day）の村人になり、すぐに町に住む（日記の 1 行目・家かテント・最初の道具・町の歴史）。
// 0 日目（町が始まる前）でも同じように住み始める。次の朝からは sim.js でふつうに働く。
// 迎える中身は tools/welcome.js（sim.js と同じ決まり）。
// 使い方: node tools/join.js [--inbox ファイル] [--now 日時]（既定: data/inbox/instagram.json）
const fs = require('fs');
const path = require('path');
const P = require('./people');
const W = require('./welcome');
const ST = require('./store');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const readJ = (f, d) => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d; };
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 1) + '\n');
if (process.env.GITHUB_ACTIONS && P.saltIsDev) { console.error('TOWN_SALT がありません（Secrets を join.yml の env で渡してください）。公開データは書きません'); process.exit(1); }

const inboxFile = opt('--inbox', path.join(DATA, 'inbox', 'instagram.json'));
let inbox = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : null;
if (inbox && inbox.sample) inbox = null; // 見本ファイルは使わない
const nowArg = opt('--now', process.env.TOWN_NOW || null);
const NOW = nowArg ? new Date(nowArg) : new Date();

const config = readJ('config.json');
const S = {
  config, state: readJ('state.json'), villagers: readJ('villagers.json', []), world: ST.readWorld(DATA),
  life: ST.readLife(DATA), history: readJ('history.json', []), social: readJ('social.json', { pairs: {}, talks: [] }),
};
const hidden = P.loadHidden(DATA);
const day = S.state.day;
const date = day >= 1 ? S.state.date : W.jstToday(NOW);
const enemies = !!(config.enemies && config.enemies.enabled);

// 町のアカウントの持ち主は村人にしない（前に入ってしまった分も外す。コメントも受け付けない）
const owners = W.ownerNames(inbox, config);
const removed = W.removeOwners(S, owners);
if (removed) console.log(`持ち主のアカウントを村人から ${removed} 人外しました`);

let registered = 0;
const comments = (inbox && inbox.joinComments) || [];
for (const r of P.registrationsFrom(comments, config.joinWord, config.startTools, { enemies })) {
  if (owners.includes(String(r.username || '').toLowerCase())) continue;
  const v = P.upsertVillager(S.villagers, { igId: r.igId, username: r.username, joined: date, joinedDay: day, source: 'comment', startTool: r.startTool, birthday: r.birthday, food: r.food }, hidden);
  if (v) registered++;
}
for (const v of S.villagers) P.applyPrivacy(v, hidden);
// コメントで書いた誕生日・好きな食べ物・MBTI（「住みたい ピッケル 12/11 りんご INFP」、住んでいる人の「誕生日 12/11」「MBTI ENFP」）。
// 見ている投稿のコメントをぜんぶ見る。あとから書いた値が勝つ。道具・仕事は変えない（config.mbtiOn が false なら MBTI は読まない）
const profComments = [...comments, ...((inbox && inbox.voteComments) || [])].filter((c) => !owners.includes(String(P.commentUser(c).username || '').toLowerCase()));
const profUpdated = P.applyCommentProfiles(S.villagers, profComments, { word: config.joinWord, startTools: config.startTools, mbti: config.mbtiOn !== false, enemies });
if (profUpdated) console.log(`コメントのプロフィール：${profUpdated} 人`);
// 「住みたい」で来た人で、誕生日・好きな食べ物がまだない人には、名前から決まった値を足す（ある値は変えない）
let filled = 0;
for (const v of S.villagers) if (P.fillJoinProfile(v)) filled++;
// 名前（またはコメントの「女の子」「男性」）で女性・男性と分かる人は、そう見えるスキンに（プロフィールで選んだ見た目は変えない）
let fitted = 0;
for (const v of S.villagers) if (P.fitGenderSkin(v)) fitted++;
if (fitted) console.log(`スキンを名前に合わせた人：${fitted} 人`);

// その場で町に迎える（前の受付で「次の朝」にしていた人も、今日来たことにする）
const { added, worldChanged } = W.welcomeNow(S, { now: NOW });
// 称号：いちばん最初に島に住んだ人に「はじまりの村人」（1 回だけ。tools/titles.js）
const titled = require('./titles').awardTitles(S, { day, date });
for (const x of titled) console.log(`${x.v.display} に称号『${x.title.name}』`);

// 拠点の場所の投票（0 日目）：コメントの票をその場で数え直す（町の画面と投票のページに出す）。
//   config の baseVote.until を過ぎていたら、ここで締めて拠点を決める（決めていなければ 1 日目にする朝の sim.js で決まる）
const BASE = require('./base');
let stateChanged = false, baseWorld = false;
const bv = BASE.voteOf(S.state);
if (bv) {
  const due = bv.closesAt && Date.parse(bv.closesAt) <= NOW.getTime();
  if (due) {
    const hist = (type, text, extra) => S.history.push({ day, date, type, text, ...(extra || {}) });
    const r = BASE.decideBase({ ...S, inbox }, { day, now: NOW, hist });
    for (const v of S.villagers) { const L = S.life[v.key], d = L && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += r.diary; }
    stateChanged = baseWorld = true;
    console.log(r.text);
  } else if (inbox && inbox.voteComments) {
    const before = JSON.stringify([bv.votes, bv.voters, bv.commentCount]);
    BASE.tallyBase(bv, { inbox, config, now: NOW });
    stateChanged = before !== JSON.stringify([bv.votes, bv.voters, bv.commentCount]);
  }
}
if (baseWorld) {
  // テントは拠点のそばへ（家はまだない）。区画も拠点のまわりに作り直したので、家の割り当てもし直す
  W.assignHomes(S.villagers.filter((v) => v.joinedDay <= day && S.life[v.key]), S.life, S.world, config);
  ST.writeWorld(DATA, S.world, { clearR: ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
  ST.writeLife(DATA, S.life);
  write('history.json', S.history);
}
// フォロワー数：受付のたびに新しくする（サイトの数が 15 分ごとに変わる。変わった時だけ state.json を書く＝コミットされる）
if (inbox && typeof inbox.followers === 'number' && inbox.followers >= 0 && S.state.followers !== inbox.followers) {
  console.log(`フォロワー ${S.state.followers} → ${inbox.followers} 人`);
  S.state.followers = inbox.followers;
  stateChanged = true;
}
if (stateChanged) write('state.json', S.state);

const changed = removed || registered || added.length || comments.length || filled || profUpdated || fitted;
if (removed || registered || added.length || titled.length) {
  write('villagers.json', S.villagers);
  ST.writeLife(DATA, S.life);
  write('history.json', S.history);
  write('social.json', S.social);
  if (worldChanged) ST.writeWorld(DATA, S.world, { clearR: ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
} else if (changed) write('villagers.json', S.villagers); // 名前が変わった人だけ
console.log(`受付：新しく ${registered} 人・町に来た人 ${added.length} 人（${day} 日目${day === 0 ? '・町が始まる前' : ''}）`);
