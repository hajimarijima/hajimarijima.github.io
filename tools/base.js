'use strict';
// 拠点（町のチェスト・たき火・広場を置く、村のまん中）の場所を、フォロワーの投票で決める。
//   0 日目：候補 A/B/C（config.json の baseVote.candidates）を地図に出して、投票の投稿のコメントで数える（state.votes の kind: 'base'）。
//   決まる時：1 日目にする朝の実行（sim.js）。config の baseVote.until を決めていれば、その時刻を過ぎた最初の受付（join.js）でも決まる。
//   決まったら、そこにチェスト・たき火・広場（整地する所）を置き、家や建物の区画を拠点のまわりに作り直す。テントも拠点のそばへ。
// sim.js・join.js・init.js とテストで共通。乱数は使わない（同点・票なしは fallback の候補か、A→B→C の順）
const P = require('./people');
const { makeRng } = require('./rand');
const W = require('./welcome');
const TN = require('../js/tents.js'); // テントの場所（拠点が決まったら、そこの木と岩もどける）

const KEYS = ['A', 'B', 'C'];
const QUESTION = '拠点はどこにする？';

const cfgOf = (config) => (config && config.baseVote) || null;
const postSet = (config) => /instagram\.com\//.test(String((config && config.votePostUrl) || ''));
const voteOf = (state) => ((state && state.votes) || []).find((v) => v.kind === 'base') || null;

// 0 日目の投票を作る（init.js）。opensAt：作った日の 0 時（日本時間）。closesAt：until（決めていなければ null ＝ 町が始まる時まで）
function openBaseVote(state, config, now = new Date()) {
  const BC = cfgOf(config);
  if (!BC || !Array.isArray(BC.candidates) || BC.candidates.length !== 3) return null;
  const until = BC.until ? W.parseStartAt(BC.until) : null;
  const v = {
    kind: 'base', question: BC.question || QUESTION, openedDay: 0, closesDay: 1,
    opensAt: W.jstToday(now) + 'T00:00:00+09:00', closesAt: until != null ? new Date(until).toISOString() : null,
    options: BC.candidates.map((c, i) => ({ key: KEYS[i], name: c.name, x: c.x, z: c.z, desc: c.desc || '' })),
    votes: { A: 0, B: 0, C: 0 }, manual: { A: 0, B: 0, C: 0 }, voters: 0, timeline: [],
  };
  state.votes = (state.votes || []).filter((x) => x.kind !== 'base').concat(v);
  return v;
}

// 場所の名前でも投票できるように：{ A: [名前, …words], … }
function wordsOf(vote, config) {
  const BC = cfgOf(config) || {};
  const out = {};
  vote.options.forEach((o, i) => {
    const c = (BC.candidates || [])[i] || {};
    out[o.key] = [o.name, ...(c.words || [])].filter((w) => w && String(w).length >= 1);
  });
  return out;
}

// コメントを数え直す（1 人 1 票・最後のコメント・持ち主は数えない・締め切りのあとは数えない）。
//   締め切りが決まっていない間は「今」まで
function tallyBase(vote, { inbox, config, now = new Date() }) {
  // 候補の名前・説明・場所は config.json に合わせる（投票の途中で config を書きかえた時も、地図の旗と決まる場所がそろう）
  const BC0 = cfgOf(config);
  if (BC0 && Array.isArray(BC0.candidates) && BC0.candidates.length === 3) vote.options.forEach((o, i) => { const c = BC0.candidates[i]; if (c) Object.assign(o, { name: c.name, x: c.x, z: c.z, desc: c.desc || '' }); });
  // baseVote.needPost：投票の投稿の URL（votePostUrl）を貼るまでは数えない（ほかの投稿の A・B・C を拾わない）
  if (BC0 && BC0.needPost && !postSet(config)) { vote.waiting = true; return { votes: vote.counted || { A: 0, B: 0, C: 0 }, voters: 0, comments: 0, timeline: vote.timeline || [], who: [] }; }
  delete vote.waiting;
  const comments = (inbox && inbox.voteComments) || [];
  const close = vote.closesAt && Date.parse(vote.closesAt) < now.getTime() ? vote.closesAt : now.toISOString();
  const t = P.tallyVote(comments, { opensAt: vote.opensAt, closesAt: close, exclude: W.ownerNames(inbox, config), words: wordsOf(vote, config) });
  const manual = vote.manual || {};
  vote.counted = t.votes;
  vote.votes = { A: t.votes.A + (manual.A || 0), B: t.votes.B + (manual.B || 0), C: t.votes.C + (manual.C || 0) };
  vote.voters = t.voters + (manual.A || 0) + (manual.B || 0) + (manual.C || 0);
  vote.timeline = t.timeline; vote.commentCount = t.comments;
  vote.tallied = now.toISOString();
  return t;
}

// 勝った候補：いちばん票の多い 1 つ。同点か票なしは、fallback（config）の候補がその中にあればそれ、なければ A→B→C の順
function winnerOf(vote, config) {
  const BC = cfgOf(config) || {};
  const max = Math.max(...KEYS.map((k) => vote.votes[k] || 0));
  const tops = KEYS.filter((k) => (vote.votes[k] || 0) === max);
  const fb = KEYS.includes(BC.fallback) ? BC.fallback : 'B';
  if (tops.length === 1 && max > 0) return { key: tops[0], how: 'win' };
  const key = tops.includes(fb) ? fb : tops[0];
  return { key, how: max > 0 ? 'tie' : 'none' };
}

// 拠点を置く：チェスト・たき火・広場（まだ整地していない）・区画。まわり（広場の半径 + 2.5）の木と岩はどける
function applyBase(world, c, { seed = 'town', key = null, name = '', day = 0, config = null } = {}) {
  const x = +(+c.x).toFixed(2), z = +(+c.z).toFixed(2);
  const r = (world.square && world.square.r) || 8;
  world.square = { x, z, r, leveled: 0 };
  world.special = { ...(world.special || {}), center: { x, z } };
  world.chest = { x: +(x + 5.2).toFixed(2), z: +(z + 1.6).toFixed(2), day: (world.chest && world.chest.day) || 0 };
  world.campfire = { x: +(x + 2.5).toFixed(2), z: +(z + 4).toFixed(2) };
  const clear = r + 2.5;
  // テントを置く所（js/tents.js の候補。広場の外にはみ出す分も）も空ける
  const tents = TN.tentCandidates({ x, z }, TN.tentCfg(config).perTent);
  const free = (o) => Math.hypot(o.x - x, o.z - z) >= clear && !tents.some((t) => TN.inTent(t, o.x, o.z, 1.6));
  world.trees = (world.trees || []).filter(free);
  world.rocks = (world.rocks || []).filter(free);
  // 整地する前の草と小石（1 日目にならす）
  const R = makeRng('base:' + seed + ':' + key);
  world.debris = [];
  for (let i = 0; i < 22; i++) {
    const a = R.range(0, Math.PI * 2), rr = Math.sqrt(R.next()) * (r - 0.8);
    world.debris.push({ x: +(x + Math.cos(a) * rr).toFixed(2), z: +(z + Math.sin(a) * rr).toFixed(2), k: R.chance(0.6) ? 'grass' : 'stone', s: +R.range(0.7, 1.3).toFixed(2) });
  }
  if (world.islands) world.plots = require('./island_layout').basePlots(world, { x, z });
  world.base = { key, name, x, z, day };
  return world;
}

// 投票を締めて拠点を決める。決まったら { text, diary, result }、投票がなければ null。
//   S = { config, state, world, inbox }、hist(type, text, extra) で町の歴史に書く
function decideBase(S, { day, now = new Date(), hist }) {
  const { config, state, world } = S;
  const vote = voteOf(state);
  if (!vote) return null;
  const tl = tallyBase(vote, { inbox: S.inbox, config, now });
  // 1 票も入っていない時は決めない（投票を開けたまま、次の朝にまた数える）。0 票で勝手に決まらないように
  if (!(vote.voters > 0) && !KEYS.some((k) => vote.votes[k] > 0)) { vote.closesAt = null; vote.closesDay = (day || 0) + 1; return null; }
  vote.closedAt = vote.closesAt && Date.parse(vote.closesAt) < now.getTime() ? vote.closesAt : now.toISOString();
  const w = winnerOf(vote, config);
  const opt = vote.options.find((o) => o.key === w.key);
  applyBase(world, opt, { seed: state.seed, key: opt.key, name: opt.name, day, config });
  state.votes = state.votes.filter((v) => v !== vote);
  const total = KEYS.reduce((s, k) => s + vote.votes[k], 0);
  const tally = vote.options.map((o) => `${o.key} ${vote.votes[o.key]}票`).join('・');
  const label = `${opt.key} ${opt.name}`;
  const text = w.how === 'win' ? `拠点が「${label}」に決まった（${tally}、${vote.voters} 人が投票）。ここにチェストとたき火を置き、まわりに家や建物を建てていく。`
    : w.how === 'tie' ? `拠点の投票は同点だった（${tally}）。いちばん票の多い場所のうち「${label}」を拠点にした。ここにチェストとたき火を置き、まわりに家や建物を建てていく。`
      : `拠点の投票に票が入らなかった（${tally}）。拠点は「${label}」にした。ここにチェストとたき火を置き、まわりに家や建物を建てていく。`;
  const result = {
    kind: 'base', question: vote.question, key: opt.key, name: opt.name, x: opt.x, z: opt.z, day, openedDay: vote.openedDay,
    votes: vote.votes, voters: vote.voters, tie: w.how === 'tie', none: w.how === 'none',
    pct: Object.fromEntries(KEYS.map((k) => [k, total ? Math.round((vote.votes[k] / total) * 1000) / 10 : 0])),
    options: vote.options, opensAt: vote.opensAt, closesAt: vote.closedAt, timeline: vote.timeline,
  };
  state.base = result;
  if (hist) hist('base', text, { kind: 'base', key: opt.key, votes: vote.votes, voters: vote.voters });
  return { text, diary: `拠点が${opt.name}に決まった。テントを${opt.name}へ移した。`, result, who: tl.who };
}

module.exports = { QUESTION, voteOf, openBaseVote, tallyBase, winnerOf, applyBase, decideBase, wordsOf };
