'use strict';
// 役職（仕事）の変更：もう住んでいる人が、あとからのコメントで仕事を変える（config.json の jobChange）。
//   「仕事 釣り」「役職：きこり」「転職 採掘」「釣りに転職」「漁業になりたい」のように書く。
//   道具・仕事の言葉と表記ゆれは「住みたい ピッケル」の受付と同じ（config.startTools の words。剣は敵が出る間だけ）。
//   仕事は最初の道具で決まる（tools/sim.js）ので、v.startTool を変える。木の道具は次に持ち物を見る時に持ちかえる（tools/welcome.js）。
//   1 人 1 日（日本時間）perDay 回まで。それより多い分は使わない。同じコメントは 2 回使わない（v.jobAt より新しいコメントだけ）。
//   変えたら町の歴史に「〇〇さんが△△から□□になった。」、本人の日記にも書く。
//   「住みたい」のコメント（はじめての受付）は読まない（道具は registrationsFrom が読む）。
const P = require('./people');

const DEF_WORDS = ['仕事', '作業', '役職', '職業', '転職', 'ジョブ'];
const cfgOf = (config) => {
  const J = (config && config.jobChange) || {};
  if (J.enabled === false) return null;
  return { perDay: Number(J.perDay) >= 1 ? Math.floor(Number(J.perDay)) : 1, words: (Array.isArray(J.words) && J.words.length ? J.words : DEF_WORDS).map(P.norm).filter(Boolean) };
};
const jstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
// 言葉のあとに続くと「変えたい」の意味になる言い方（「釣りになりたい」「漁業に変える」）
const WANT_AFTER = /^\s*(?:に|へ)\s*(?:転職|なる|なり|かえ|変え|変更|チェンジ)/;

const toolWords = (startTools, enemies) => ((startTools && startTools.options) || [])
  .filter((o) => enemies || !o.needsEnemies)
  .flatMap((o) => (o.words || []).map((w) => ({ id: o.id, w: P.norm(w) })))
  .filter((x) => x.w)
  .sort((a, b) => b.w.length - a.w.length);
// s の中でいちばん前の道具・仕事の言葉 { id, at, end }
function firstTool(s, tw) {
  let best = null;
  for (const x of tw) { const i = s.indexOf(x.w); if (i >= 0 && (!best || i < best.at)) best = { id: x.id, at: i, end: i + x.w.length }; }
  return best;
}
// s の最後で終わる道具・仕事の言葉の id
function endTool(s, tw) {
  const e = s.trimEnd();
  const x = tw.find((y) => e.endsWith(y.w));
  return x ? x.id : null;
}

// 1 つのコメントから、変えたい仕事（startTools の id）を読む。なければ null
function parseJobChange(text, { startTools = null, enemies = false, words = DEF_WORDS } = {}) {
  const t = P.norm(text);
  if (!t || !startTools) return null;
  const tw = toolWords(startTools, enemies);
  if (!tw.length) return null;
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
      // 名札のすぐあと：「仕事 釣り」「役職を漁業に」「転職：きこり」
      const after = t.slice(i + w.length).replace(/^\s*(?:は|を|:|=|→|->|ー|、)?\s*/, '');
      const h = firstTool(after.slice(0, 12), tw);
      if (h && h.at <= 2) return h.id;
      // 名札のすぐ前：「釣りに転職」「漁業へ転職したい」
      const m = t.slice(0, i).match(/\s*(?:に|へ)\s*$/);
      if (m) { const id = endTool(t.slice(0, m.index), tw); if (id) return id; }
    }
  }
  // 名札がなくても、コメントの始めに「釣りになりたい」「漁業に変えたい」
  const h = firstTool(t, tw);
  if (h && h.at <= 1 && WANT_AFTER.test(t.slice(h.end))) return h.id;
  return null;
}

// 住んでいる人の仕事を、コメントで変える。S = { config, villagers, life, history }。
// 戻り値：変えた [{ v, from, to }]（from・to は startTools の仕事の名前）。.rejected：1 日の回数をこえて使わなかった数
//   diary：false なら本人の日記には書かない（sim.js は持ちかえの時に日記へ書くので）
function applyJobChanges(S, comments, { day = 0, date = '', enemies = false, owners = [], diary = true } = {}) {
  const JC = cfgOf(S.config);
  const out = [];
  out.rejected = 0;
  if (!JC) return out;
  const ST = S.config.startTools || { options: [] };
  const opt = (id) => (ST.options || []).find((o) => o.id === id) || null;
  const ex = new Set((owners || []).map((s) => String(s).toLowerCase()));
  const list = (comments || [])
    .filter((c) => c && c.text && !P.isJoin(c.text, S.config.joinWord))
    .map((c) => ({ c, t: Date.parse(c.timestamp), u: P.commentUser(c) }))
    .filter((x) => Number.isFinite(x.t) && (x.u.igId || x.u.username) && !ex.has(P.norm(x.u.username).toLowerCase()))
    .sort((a, b) => a.t - b.t);
  const seen = new Set();
  for (const x of list) {
    const k = x.c.id ? String(x.c.id) : JSON.stringify([x.u.igId, x.c.timestamp, x.c.text]);
    if (seen.has(k)) continue; // 同じコメントが 2 つの投稿の分に入っていても 1 回
    seen.add(k);
    const id = parseJobChange(x.c.text, { startTools: ST, enemies, words: JC.words });
    if (!id) continue;
    const v = P.findVillager(S.villagers, x.u);
    if (!v || v.left) continue;
    if (v.jobAt && Date.parse(v.jobAt) >= x.t) continue; // もう読んだコメント
    v.jobAt = new Date(x.t).toISOString();
    const L = S.life && S.life[v.key];
    const cur = v.startTool || (L && L.startTool) || null;
    if (cur === id) continue; // 今と同じ仕事
    const dk = jstDay(x.t);
    const n = v.jobDay === dk ? (v.jobN || 0) : 0;
    if (n >= JC.perDay) { out.rejected++; continue; } // 1 日の回数をこえた
    const from = (opt(cur) || {}).job || 'なし', to = (opt(id) || {}).job || id;
    v.startTool = id; v.jobDay = dk; v.jobN = n + 1; v.jobChangedTo = id;
    S.history.push({ day, date, type: 'event', kind: 'job', text: `${v.display}さんが${from}から${to}になった。`, who: [v.key] });
    if (L && diary) {
      L.diary = L.diary || [];
      const d = L.diary[L.diary.length - 1], note = `作業を${from}から${to}にかえた。`;
      if (d && d.day === day) d.text += note; else L.diary.push({ day, date, text: note });
    }
    out.push({ v, from, to });
  }
  return out;
}

module.exports = { parseJobChange, applyJobChanges, cfgOf };
