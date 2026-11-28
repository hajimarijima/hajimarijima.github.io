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
const moved = P.loadMoved(DATA); // 引っ越した人（tools/moveout.js）：引っ越す前の「住みたい」では住み直さない
for (const r of P.registrationsFrom(comments, config.joinWord, config.startTools, { enemies })) {
  if (owners.includes(String(r.username || '').toLowerCase())) continue;
  if (P.movedBefore(moved, r) && !P.findVillager(S.villagers, r)) continue;
  const v = P.upsertVillager(S.villagers, { igId: r.igId, username: r.username, joined: date, joinedDay: day, source: 'comment', startTool: r.startTool, birthday: r.birthday, food: r.food }, hidden);
  if (v) registered++;
}
// DM の「住みたい」（config.dm.enabled の時だけ。tools/dm.js pull が置いた data/inbox/dm.json）。コメントと同じ関数で入居（同じ人は二重にしない）
const DM = require('./dm');
const dmFile = opt('--dm', path.join(DATA, 'inbox', 'dm.json'));
const dmRepliesFile = path.join(path.dirname(dmFile), 'dm_replies.json');
const dmItems = fs.existsSync(dmFile) ? (JSON.parse(fs.readFileSync(dmFile, 'utf8')).items || []) : [];
const dmRes = DM.dmJoins(S, dmItems, { config, owners, hidden, date, day, enemies, moved });
registered += dmRes.registered.length;
if (dmItems.length) console.log(`DM：${dmItems.length} 件・新しく住んだ人 ${dmRes.registered.length} 人・もう住んでいた人 ${dmRes.known.length} 人`);
for (const v of S.villagers) P.applyPrivacy(v, hidden);
// コメントで書いた誕生日・好きな食べ物・MBTI（「住みたい ピッケル 12/11 りんご INFP」、住んでいる人の「誕生日 12/11」「MBTI ENFP」）。
// 見ている投稿のコメントをぜんぶ見る。あとから書いた値が勝つ。道具・仕事は変えない（config.mbtiOn が false なら MBTI は読まない）
const profComments = [...comments, ...((inbox && inbox.voteComments) || [])].filter((c) => !owners.includes(String(P.commentUser(c).username || '').toLowerCase()));
const profUpdated = P.applyCommentProfiles(S.villagers, profComments, { word: config.joinWord, startTools: config.startTools, mbti: config.mbtiOn !== false, enemies }) + dmRes.profUpdated;
if (profUpdated) console.log(`コメントのプロフィール：${profUpdated} 人`);
// 役職（仕事）の変更：住んでいる人の「仕事 釣り」「転職 きこり」など（config.jobChange。1 人 1 日 perDay 回まで。tools/jobs.js）
const jobChanges = require('./jobs').applyJobChanges(S, profComments, { day, date, enemies, owners });
for (const x of jobChanges) console.log(`${x.v.display} の仕事：${x.from} → ${x.to}`);
if (jobChanges.rejected) console.log(`仕事の変更：1 日の回数をこえたので使わなかったコメント ${jobChanges.rejected} 件`);
// 「住みたい」で来た人で、誕生日・好きな食べ物がまだない人には、名前から決まった値を足す（ある値は変えない）
let filled = 0;
for (const v of S.villagers) if (P.fillJoinProfile(v)) filled++;
// 名前（またはコメントの「女の子」「男性」）で女性・男性と分かる人は、そう見えるスキンに（プロフィールで選んだ見た目は変えない）
let fitted = 0;
for (const v of S.villagers) if (P.fitGenderSkin(v)) fitted++;
if (fitted) console.log(`スキンを名前に合わせた人：${fitted} 人`);

// その場で町に迎える（前の受付で「次の朝」にしていた人も、今日来たことにする）
const { added, worldChanged } = W.welcomeNow(S, { now: NOW });
// 仕事を変えた人（もう町にいる人）は、その場で木の道具を持ちかえる（tools/welcome.js の giveStartTool）
for (const x of jobChanges) {
  const L = S.life[x.v.key];
  if (!L || added.includes(x.v)) continue;
  const note = W.ensureLife(L, x.v, { day, life: S.life, config });
  W.refreshLevel(L, day - x.v.joinedDay + 1, config.inventory);
  const d = L.diary[L.diary.length - 1];
  if (note && d && d.day === day) d.text += note;
}
// 招待リンクから来た人（DM の「紹介 村人の key」）：町の歴史と、招待した人の日記に書く（tools/referral.js）
for (const x of dmRes.referred || []) {
  const nm = (v) => v.display || v.name || '';
  S.history.push({ day, date, type: 'event', text: `${nm(x.v)}が、${nm(x.by)}の招待で島に来た。`, who: [x.v.key, x.by.key], referral: true });
  const L = S.life[x.by.key];
  if (L) { L.diary = L.diary || []; const d = L.diary[L.diary.length - 1], t = `招待した${nm(x.v)}が島に来てくれた。`; if (d && d.day === day) d.text += t; else L.diary.push({ day, date, text: t }); }
  console.log(`${nm(x.v)} は ${nm(x.by)} の招待`);
}
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
    if (r) {
      for (const v of S.villagers) { const L = S.life[v.key], d = L && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += r.diary; }
      baseWorld = true;
      console.log(r.text);
    } else console.log('拠点の投票はまだ 0 票なので、決めずに続ける');
    stateChanged = true;
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
// 一週間の対決投票（config.versus）：始める・数え直す・締めて、勝った側に投票した住人に経験値と称号（tools/versus.js）
const duel = require('./versus').stepVersus(S, { inbox, now: NOW, day, date });
for (const id of duel.opened) console.log(`対決投票を始めました：${id}`);
for (const r of duel.closed) console.log(`対決投票を締めました：${r.id}（${r.winner ? r.winner + ' の勝ち' : '引き分け・票なし'}、ごほうび ${r.rewarded} 人）`);
if (duel.changed) stateChanged = true;
if (stateChanged) write('state.json', S.state);

const changed = removed || registered || added.length || comments.length || filled || profUpdated || fitted;
if (removed || registered || added.length || titled.length || jobChanges.length || duel.opened.length || duel.closed.length) {
  write('villagers.json', S.villagers);
  ST.writeLife(DATA, S.life);
  write('history.json', S.history);
  write('social.json', S.social);
  if (worldChanged) ST.writeWorld(DATA, S.world, { clearR: ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
} else if (changed) write('villagers.json', S.villagers); // 名前が変わった人だけ
// DM の返事（町に迎えて表示名が決まったあとで作る）。コミットのあと tools/dm.js done が受け口に渡す（公開しない inbox/ に置く）
if (dmItems.length) {
  fs.writeFileSync(dmRepliesFile, JSON.stringify({ items: DM.replyTexts(dmRes, config) }) + '\n');
} else if (fs.existsSync(dmRepliesFile)) fs.unlinkSync(dmRepliesFile);
console.log(`受付：新しく ${registered} 人・町に来た人 ${added.length} 人（${day} 日目${day === 0 ? '・町が始まる前' : ''}）`);
