'use strict';
// 一週間の対決投票（config.json の versus）。数え直し・始める・締め切る・ごほうび。表示と読み取りは js/versus.js（共通）。
//   state.versus = { current: 投票中のお題（なければ無い）, done: [締め切ったお題の結果…] }
//   ・お題は topics の順。前のお題が終わっていて、投稿の URL（postUrl）を貼ってあり、start（あれば）を過ぎたら始まる。
//     始まる時刻＝start（なければ始めた時）。締め切り＝そこから days 日（既定 7 日）。
//   ・票：その投稿のコメント（instagram.js が inbox.versusComments に入れる）。1 人 1 票、何度か書いたら最後の票。
//     住人でない人の票も数える。町のアカウントの持ち主は数えない。締め切りのあとのコメントは数えない。
//   ・締め切り：票の多い側の勝ち。勝った側に投票した住人に経験値（xp）と称号（js/versus.js の versusTitles）。
//     引き分け（同じ票）は、どちらかに投票した住人みんなに tieXp の経験値（称号はなし）。票がなければごほうびなし。
//   ・締め切りの時にコメントが読めなかった時は、graceHours（既定 24 時間）まで待つ。それでも読めなければ、最後に数えた票で決め、ごほうびはなし
// join.js（15 分ごと）から呼ぶ。S = { config, state, villagers, life, history }
const P = require('./people');
const W = require('./welcome');
let VS = null;
const shared = () => VS || (VS = require('../js/versus.js'));

const jstMd = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600e3); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時`; };
const voterKey = (u) => (u.igId ? 'ig:' + u.igId : 'user:' + P.norm(u.username).toLowerCase());

// コメントを数える（1 人 1 票・最後の票・持ち主は数えない・締め切りのあとは数えない）
function tallyDuel(comments, topic, { closesAt = null, exclude = [] } = {}) {
  const { pickOf } = shared();
  const close = closesAt ? Date.parse(closesAt) : Infinity;
  const ex = new Set((exclude || []).map((s) => String(s).toLowerCase()));
  const list = (comments || [])
    .map((c) => ({ c, t: Date.parse(c && c.timestamp), u: P.commentUser(c || {}) }))
    .filter((x) => x.c && Number.isFinite(x.t) && x.t <= close && (x.u.igId || x.u.username) && !ex.has(P.norm(x.u.username).toLowerCase()))
    .map((x) => ({ ...x, pick: pickOf(x.c.text, topic) }))
    .filter((x) => x.pick)
    .sort((a, b) => a.t - b.t);
  const cur = new Map();
  for (const x of list) cur.set(voterKey(x.u), { pick: x.pick, u: x.u });
  const votes = { A: 0, B: 0 };
  for (const x of cur.values()) votes[x.pick]++;
  return { votes, voters: cur.size, comments: list.length, who: [...cur.values()] };
}

// 投票の中身（state に書く形。名前・色は config から）
function snapshot(t) {
  return { id: t.id, question: t.question, A: { name: t.A.name, color: t.A.color }, B: { name: t.B.name, color: t.B.color }, postUrl: t.postUrl };
}
// inbox の対決のコメント（{ id, comments } か、配列）。お題がちがえば null
function commentsFor(inbox, id) {
  const vc = inbox && inbox.versusComments;
  if (!vc) return null;
  if (Array.isArray(vc)) return vc;
  return vc.id === id && Array.isArray(vc.comments) ? vc.comments : null;
}

// 次に始めるお題（終わったお題と今のお題をとばして、topics の順で最初の 1 つ）
function nextTopic(config, state) {
  const { topicList } = shared();
  const V = (state && state.versus) || {};
  const used = new Set([...(V.done || []).map((d) => d.id), ...(V.current ? [V.current.id] : [])]);
  return topicList(config).find((t) => !used.has(t.id)) || null;
}
// instagram.js が読む投稿：投票中のお題、なければ次に始められるお題（URL を貼ったもの）。なければ null
function targetTopic(config, state) {
  const { topicById, postReady, versusCfg } = shared();
  if (!versusCfg(config)) return null;
  const V = (state && state.versus) || {};
  if (V.current) { const t = topicById(config, V.current.id); const url = (t && t.postUrl) || V.current.postUrl; return postReady(url) ? { id: V.current.id, postUrl: url } : null; }
  const t = nextTopic(config, state);
  return t && postReady(t.postUrl) ? { id: t.id, postUrl: t.postUrl } : null;
}

// ごほうび：住人だけ（住んでいて、町を出ていない人）。同じ人には 1 回だけ
function residentsOf(S, who, day) {
  const out = new Map();
  for (const x of who) {
    const v = P.findVillager(S.villagers, x.u);
    if (!v || v.left || !(v.joinedDay <= day) || !S.life[v.key]) continue;
    out.set(v.key, { v, pick: x.pick });
  }
  return [...out.values()];
}
const addDiary = (L, day, date, text) => {
  L.diary = L.diary || [];
  const d = L.diary[L.diary.length - 1];
  if (d && d.day === day) d.text += text; else L.diary.push({ day, date, text });
};
function giveXp(S, v, n, day) {
  const L = S.life[v.key];
  if (!L || !(n > 0)) return;
  L.xp = (L.xp || 0) + n;
  const IC = S.config.inventory;
  if (IC) { L.inv = L.inv || []; W.refreshLevel(L, day - (v.joinedDay || 0) + 1, IC); } // レベル・持ち物の枠も上がる
}

// 締める。結果（done に入れる形）を返す
function closeDuel(S, cur, { day, date, now, tl }) {
  const { shares, titleId, versusTitles } = shared();
  const VC = S.config.versus || {};
  const votes = cur.votes || { A: 0, B: 0 };
  const s = shares(votes);
  const winner = votes.A > votes.B ? 'A' : votes.B > votes.A ? 'B' : null;
  const xp = Number(VC.xp) >= 0 ? Number(VC.xp) : 30, tieXp = Number(VC.tieXp) >= 0 ? Number(VC.tieXp) : 10;
  const res = tl ? residentsOf(S, tl.who, day) : [];
  const q = cur.question, nA = cur.A.name, nB = cur.B.name;
  const tally = `${nA} ${votes.A}票（${s.A}%）・${nB} ${votes.B}票（${s.B}%）、${cur.voters || 0} 人が投票`;
  let rewarded = [], text;
  if (winner) {
    const wn = cur[winner].name;
    const title = versusTitles(S.config).find((x) => x.id === titleId(cur, winner)) || { id: titleId(cur, winner), name: `${wn}の勝者`, desc: '' };
    rewarded = res.filter((r) => r.pick === winner).map((r) => r.v);
    for (const v of rewarded) {
      giveXp(S, v, xp, day);
      const got = (v.titles || []).includes(title.id);
      if (!got) v.titles = [...(v.titles || []), title.id];
      addDiary(S.life[v.key], day, date, `対決「${q}」で、投票した${wn}が勝った。経験値 +${xp}${got ? '' : `、称号「${title.name}」をもらった`}。`);
    }
    text = `対決「${q}」は ${wn}の勝ち！（${tally}）` + (rewarded.length ? `${wn}に投票した住人 ${rewarded.length} 人に、経験値 ${xp} と称号『${title.name}』。` : `${wn}に投票した住人はいなかった。`) + (tl ? '' : 'コメントが読めなかったので、最後に数えた票で決めた（ごほうびはなし）。');
    S.history.push({ day, date, type: 'vote_result', kind: 'versus', versus: cur.id, winner, text, votes, who: rewarded.map((v) => v.key) });
    if (rewarded.length) {
      const MAX = 5, nm = rewarded.slice(0, MAX).map((v) => v.display).join('、') + (rewarded.length > MAX ? ` ほか ${rewarded.length - MAX} 人` : '');
      S.history.push({ day, date, type: 'title', text: `${nm} に称号『${title.name}』がおくられた。`, who: rewarded.map((v) => v.key), title: title.id });
    }
  } else if (s.total) {
    rewarded = res.map((r) => r.v);
    for (const v of rewarded) { giveXp(S, v, tieXp, day); addDiary(S.life[v.key], day, date, `対決「${q}」は引き分けだった。経験値 +${tieXp}。`); }
    text = `対決「${q}」は引き分け（${tally}）。` + (rewarded.length && tieXp ? `投票した住人 ${rewarded.length} 人に、経験値 ${tieXp}（称号はなし）。` : '');
    S.history.push({ day, date, type: 'vote_result', kind: 'versus', versus: cur.id, winner: null, tie: true, text, votes, who: rewarded.map((v) => v.key) });
  } else {
    text = `対決「${q}」は票が入らなかった。`;
    S.history.push({ day, date, type: 'vote_result', kind: 'versus', versus: cur.id, winner: null, text, votes });
  }
  return { ...cur, votes, pct: { A: s.A, B: s.B }, winner, tie: !winner && s.total > 0, closedAt: now.toISOString(), closedDay: day, rewarded: rewarded.length, xp: winner ? xp : tieXp };
}

// 15 分ごと：始める・数え直す・締める。戻り値 { changed, opened: [id], closed: [結果], rewarded: [村人] }
function stepVersus(S, { inbox = null, now = new Date(), day = 0, date = '' } = {}) {
  const { versusCfg, topicById, postReady } = shared();
  const out = { changed: false, opened: [], closed: [], rewarded: [] };
  if (!versusCfg(S.config)) return out;
  const state = S.state;
  const before = JSON.stringify(state.versus || null);
  const V = state.versus = state.versus || { done: [] };
  V.done = V.done || [];
  const exclude = W.ownerNames(inbox, S.config);
  const grace = (Number((S.config.versus || {}).graceHours) >= 0 ? Number(S.config.versus.graceHours) : 24) * 3600e3;
  for (let guard = 0; guard < 50; guard++) {
    if (V.current) {
      const cur = V.current;
      const t = topicById(S.config, cur.id);
      if (t) Object.assign(cur, snapshot(t), { opensAt: cur.opensAt, closesAt: cur.closesAt }); // 名前・色・URL は config に合わせる
      // URL を消した（始める前にもどす）：まだ締め切りの前なら、取りやめて始まっていない扱いに
      if (t && !postReady(t.postUrl) && Date.parse(cur.closesAt) > now.getTime()) { delete V.current; break; }
      const cs = commentsFor(inbox, cur.id);
      const due = Date.parse(cur.closesAt) <= now.getTime();
      const tl = cs ? tallyDuel(cs, t || { A: { words: [cur.A.name] }, B: { words: [cur.B.name] } }, { closesAt: cur.closesAt, exclude }) : null;
      if (tl) { cur.votes = tl.votes; cur.voters = tl.voters; cur.commentCount = tl.comments; cur.tallied = now.toISOString(); }
      if (!due) break;
      if (!tl && now.getTime() - Date.parse(cur.closesAt) < grace) { cur.closing = true; break; } // コメントを読めるまで待つ
      const r = closeDuel(S, cur, { day, date, now, tl });
      delete r.closing; delete r.tallied;
      V.done.push(r); delete V.current;
      out.closed.push(r);
      continue; // 次のお題へ
    }
    const t = nextTopic(S.config, state);
    if (!t || !postReady(t.postUrl)) break;
    const lastClose = V.done.length ? Date.parse(V.done[V.done.length - 1].closedAt) : -Infinity;
    const st = t.start ? W.parseStartAt(t.start) : null;
    let open = st != null ? Math.max(st, lastClose) : now.getTime();
    if (!Number.isFinite(open)) open = now.getTime();
    if (open > now.getTime()) break; // まだ始まる日の前
    const closesAt = new Date(open + t.days * 86400e3).toISOString();
    V.current = { ...snapshot(t), opensAt: new Date(open).toISOString(), closesAt, votes: { A: 0, B: 0 }, voters: 0 };
    S.history.push({ day, date, type: 'vote_open', kind: 'versus', versus: t.id, text: `対決投票「${t.question}」が始まった。${t.A.name} と ${t.B.name}、どっちが勝つ？（${jstMd(closesAt)}まで）` });
    out.opened.push(t.id);
  }
  if (!V.current && !V.done.length && before === 'null') delete state.versus;
  out.changed = before !== JSON.stringify(state.versus || null);
  return out;
}

module.exports = { tallyDuel, stepVersus, closeDuel, nextTopic, targetTopic, commentsFor };
