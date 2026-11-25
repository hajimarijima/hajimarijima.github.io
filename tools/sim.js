#!/usr/bin/env node
'use strict';
// 町を 1 日進める。
// 使い方: node tools/sim.js [--days N] [--demo] [--inbox ファイル]
//   --demo      フォロワー数と投票コメントを見本で作る（インスタにつなぐ前の確かめ用）
//   --inbox     instagram.js が書いた JSON（既定: data/inbox/instagram.json があれば使う）
// 乱数は state.seed と日付で決まるので、同じ入力なら同じ結果になる。
const fs = require('fs');
const path = require('path');
const { makeRng, hashStr } = require('./rand');
const SO = require('./social');
const ST = require('./store'); // world.json は地図の文字、日記は人ごとのファイル
const TM = require('../js/tilemap.js');
const P = require('./people');
const I = require('./inventory');
const N = require('./night');
const O = require('./ores');
const CR = require('./craft');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const read = (f, d) => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d; };
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 1) + '\n');

const RES = ['wood', 'stone', 'food'];
const RES_JA = { wood: '木材', stone: '石', food: '食べ物' };
let ITEMS0 = {};
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const jst = (date, hh = 0) => date + 'T' + String(hh).padStart(2, '0') + ':00:00+09:00';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function area(p) {
  if (p.z > 28) return '海べの';
  if (p.x > 18 && p.z < -18) return '北東の';
  if (p.x < -30) return '西の森の';
  if (p.x > 30) return '東の森の';
  if (p.z < -30) return '北の森の';
  return '村はずれの';
}

// 「どこに建てる？」の 3 つの候補。空いている区画から、海のそば・森の入口・広場の近くを 1 つずつ
function siteOptions(world, state) {
  const used = new Set(world.buildings.map((b) => b.plot));
  const free = world.plots.map((p, i) => ({ x: p.x, z: p.z, plot: i })).filter((p) => !used.has(p.plot));
  const r = (p) => Math.hypot(p.x, p.z + 1);
  const trees = (p) => world.trees.filter((t) => !t.gone && t.state === 'tree' && Math.hypot(t.x - p.x, t.z - p.z) < 9).length;
  const sea = free.slice().sort((a, b) => b.z - a.z || r(a) - r(b))[0];
  const mid = free.filter((p) => p !== sea).sort((a, b) => r(a) - r(b))[0];
  const forest = free.filter((p) => p !== sea && p !== mid && p.z < 10).sort((a, b) => trees(b) - trees(a) || r(b) - r(a))[0] || free.find((p) => p !== sea && p !== mid);
  const dir = (p) => (Math.abs(p.x) > Math.abs(p.z + 1) ? (p.x > 0 ? '東' : '西') : (p.z < -1 ? '北' : '南'));
  return [
    { name: '海のそば', x: sea.x, z: sea.z, plot: sea.plot },
    { name: dir(forest) + 'の森の入口', x: forest.x, z: forest.z, plot: forest.plot },
    { name: '広場の近く', x: mid.x, z: mid.z, plot: mid.plot },
  ];
}

function stepDay(S) {
  const { config, villagers, world, state, life, history, inbox, demo, hidden } = S;
  ITEMS0 = config.items;
  const day = state.day + 1;
  const date = addDays(state.startDate, day - 1);
  const R = makeRng(state.seed + ':day:' + day);
  const hist = (type, text, extra) => history.push({ day, date, type, text, ...(extra || {}) });
  const B = (t) => config.buildings[t];
  // 前の形のデータ（フォロワーの節目で投票・建てる順番の列）から、毎回投票で決める形へ
  if (!Array.isArray(state.votes)) state.votes = [];
  if (!state.pool) state.pool = config.firstChoices.concat(config.choicePool);
  if (!('plan' in state)) state.plan = null;
  delete state.queue; delete state.repeatIdx;
  if (!world.square) world.square = { x: 0, z: -1, r: 8, leveled: day > 1 ? 1 : 0 };
  if (!world.debris) world.debris = [];
  if (!world.chest) world.chest = { x: 5.2, z: 0.6, day: 0 };
  if (!world.animals) world.animals = [];
  if (!state.firsts) state.firsts = {};
  // 釣り・畑・動物は別の乱数（ここが増えても、木・岩・投票の流れは変わらない）
  const R2 = makeRng(state.seed + ':farm:' + day);
  // 「はじめて」の出来事は、町の歴史に 1 回だけ書く
  const first = (key, text, extra) => { if (state.firsts[key]) return false; state.firsts[key] = day; hist('first', text, extra); return true; };
  // 切り株・新しい木・草の畑・体力とおなかは、また別の乱数（ほかの流れを変えない）
  const R3 = makeRng(state.seed + ':needs:' + day);
  if (!world.treeSeq) world.treeSeq = world.trees.reduce((m, t) => Math.max(m, (+String(t.id).slice(1) || 0) + 1), 0);
  // 掘り出した・朽ちた切り株は次の日に消す。その場所は noGrow に残して、もう木を生やさない（新しい順に 600 か所まで）
  if (!world.noGrow) world.noGrow = [];
  for (const t of world.trees) if (t.state === 'removed' && t.removedDay < day && t.cutDay) world.noGrow.push([t.x, t.z]);
  if (world.noGrow.length > 600) world.noGrow.splice(0, world.noGrow.length - 600);
  world.trees = world.trees.filter((t) => !(t.state === 'removed' && t.removedDay < day));
  world.trees.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // 保存した地図から読んだ時と同じ順（何日まとめて進めても同じ結果）
  world.rocks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 近くを探すための「マスごとの一覧」（空間ハッシュ）。全部の木や岩を調べずに、周りのマスだけを見る
  const IX = {
    trees: TM.SpatialHash.of(world.trees, 4), rocks: TM.SpatialHash.of(world.rocks, 4),
    fields: TM.SpatialHash.of(world.fields, 4), slots: TM.SpatialHash.of(world.fieldSlots || [], 4),
    noGrow: TM.SpatialHash.of(world.noGrow.map(([x, z]) => ({ x, z })), 4),
  };
  const addTree = (t) => { world.trees.push(t); IX.trees.set(t, t.x, t.z); return t; };
  // 建物（建てる場所も）のまわり clearBlocks ブロックには、木も岩も置かない・生やさない（無限の地形と同じ決まり）
  const clearR = ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5;
  const nearBuilding = (x, z, extra = 0) => world.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < clearR + extra)
    || !!(state.plan && state.plan.site && state.plan.site.plot !== 'ring' && Math.hypot(state.plan.site.x - x, state.plan.site.z - z) < clearR + extra);
  // 空いている場所（建物のまわり・村のまん中・池・海・木・岩・畑を避ける）。木の生えかわりと草の畑で使う
  const freeSpot = (r0, r1, what) => {
    for (let k = 0; k < 60; k++) {
      let x, z;
      if (r1) { const a = R3.range(0, Math.PI * 2), r = R3.range(r0, r1); x = world.square.x + Math.cos(a) * r; z = world.square.z + Math.sin(a) * r; }
      else { x = R3.range(-100, 100); z = R3.range(-100, world.seaZ - 6); }
      if (z > world.seaZ - 4 || nearBuilding(x, z, what === 'field' ? -clearR + 5 : 0)) continue;
      if (Math.hypot(x - world.square.x, z - world.square.z) < world.square.r + (what === 'field' ? 3 : 2.5)) continue;
      if (world.pond && Math.hypot(x - world.pond.x, z - world.pond.z) < world.pond.r + 3) continue;
      if (IX.trees.any(x, z, 3, (t) => !t.gone || t.state === 'removed')) continue;
      if (what === 'tree' && IX.noGrow.any(x, z, 2)) continue; // 切り株があった場所
      if (IX.rocks.any(x, z, 3.5, (r) => r.hp > 0)) continue;
      if (IX.fields.any(x, z, what === 'field' ? 2.4 : 3.5)) continue;
      if (IX.slots.any(x, z, 3)) continue;
      return { x: +x.toFixed(2), z: +z.toFixed(2) };
    }
    return null;
  };
  const clearAround = (x, z) => {
    for (const t of IX.trees.near(x, z, clearR - 1e-9, (t) => !t.gone)) { t.gone = 1; t.state = 'removed'; t.removedDay = day; }
    for (const r of IX.rocks.near(x, z, clearR - 1e-9, (r) => !r.gone && r.hp > 0)) { r.hp = 0; r.back = day + config.respawn.rockDays[0]; }
  };

  // ---- 1. 参加の登録（「参加したい」コメント） ----
  if (inbox && inbox.joinComments) {
    const enemiesOn = !!(config.enemies && config.enemies.enabled);
    for (const r of P.registrationsFrom(inbox.joinComments, config.joinWord, config.startTools, { enemies: enemiesOn })) {
      const v = P.upsertVillager(villagers, { igId: r.igId, username: r.username, joined: date, joinedDay: day, source: 'comment', startTool: r.startTool }, hidden);
      if (v) v._new = true;
    }
  }
  for (const v of villagers) P.applyPrivacy(v, hidden);
  // 公開しない項目（firestore_sync.js が data/inbox/ に書く）は、書き出さない形で持つ
  for (const v of villagers) if (S.priv && S.priv[v.key]) Object.defineProperty(v, '_priv', { value: S.priv[v.key], enumerable: false, configurable: true });
  const active = villagers.filter((v) => v.joinedDay <= day);
  for (const v of active) {
    if (!life[v.key]) life[v.key] = { job: null, target: null, home: null, gathered: { wood: 0, stone: 0, food: 0 }, built: [], contrib: { wood: 0, stone: 0, food: 0 }, diary: [] };
  }
  // ---- 1.5 プロフィール（MBTI と誕生日）。本人の確かめは from.id で行う。年は受け取らない ----
  const RS = makeRng(state.seed + ':social:' + day); // 関係まわりは別の乱数（ほかの結果を変えない）
  const profComments = inbox && (inbox.profileComments || inbox.joinComments);
  if (profComments) {
    for (const p of SO.profilesFrom(profComments, config.profileWord || 'プロフ')) {
      const v = villagers.find((x) => x.igId && x.igId === P.igHash(p.igId));
      if (!v || (v.mbti === p.mbti && v.birthday === p.birthday)) continue;
      v.mbti = p.mbti; v.birthday = p.birthday; v.profileDay = day;
    }
  } else if (demo) {
    for (const v of active) {
      if (v.mbti || day < 2 || (hashStr('prof:' + v.key) % 9) !== day % 9) continue;
      v.mbti = RS.pick(SO.MBTI);
      v.birthday = RS.chance(0.45) ? addDays(state.startDate, RS.int(day + 1, 29)).slice(5) : String(RS.int(1, 12)).padStart(2, '0') + '-' + String(RS.int(1, 28)).padStart(2, '0');
      v.profileDay = day;
      // 見本：ほかの項目も、名前から決まった値で入れる（乱数の流れは変えない）
      const h = hashStr('prof2:' + v.key);
      if (h % 10 < 7) {
        const pf = {};
        pf.food = ['カレー', 'おにぎり', 'りんご', 'たまご焼き', 'パン', 'やきいも', 'シチュー', 'みかん'][h % 8];
        pf.color = ['#d9534f', '#3f78b8', '#e0b030', '#8e5bb5', '#2e9a8a', '#e07a3a', '#c2457a', '#5a8f3a'][(h >> 3) % 8];
        if ((h >> 6) % 3) pf.hobby = ['昼寝', '釣り', '星を見る', '歌', '木彫り', '散歩'][(h >> 8) % 6];
        if ((h >> 11) % 4 === 0) pf.wantJob = ['伐採', '採掘', '農業', '漁業', '牧場', '建築'][(h >> 13) % 6];
        if ((h >> 15) % 3 === 0) pf.message = ['よろしくね', 'みんなで大きな町にしよう', '朝が苦手です', '畑をひろげたい'][(h >> 17) % 4];
        v.profile = pf;
      }
    }
  }
  const newcomers = active.filter((v) => v.joinedDay === day || v._new);
  if (newcomers.length) hist('join', newcomers.map((v) => v.display).join('、') + ' が村に住むことになった。', { who: newcomers.map((v) => v.key) });
  for (const v of villagers) delete v._new;

  // ---- 2. フォロワー数 ----
  if (inbox && typeof inbox.followers === 'number') state.followers = inbox.followers;
  else if (demo) {
    const f = Math.round(5 + 1.8 * day + 0.05 * day * day + R.range(-2, 2));
    state.followers = Math.max(state.followers, f);
  }
  state.followerLog.push({ day, followers: state.followers });

  // ---- 3. 投票（建てる物・建てる場所・ときどき道具。どれも A/B/C） ----
  // 何を建てるかと、どこに建てるかは同じ日に、時間を分けて開く（同じ A/B/C でも、コメントの時刻で区別できる）
  const BV = config.buildVote;
  const diaryExtra = {}; // key -> 文
  let closedVoters = [];
  const KIND_Q = { what: '何を建てる？', where: 'どこに建てる？', tool: 'どの道具を作る？' };
  const genDemo = (vote) => { // 見本の投票コメントを作る（締め切り後のコメントも混ぜて、数えないことを確かめる）
    vote.demoComments = vote.demoComments || [];
    const bias = vote.demoBias || (vote.demoBias = [R.range(0.6, 1.4), R.range(0.6, 1.4), R.range(0.6, 1.4)]);
    const t0 = Date.parse(vote.opensAt), t1 = Date.parse(vote.closesAt);
    const n = R.int(5, 10);
    for (let i = 0; i < n + 2; i++) {
      const named = active.filter((x) => x.name);
      const who = named.length && R.chance(0.45) ? R.pick(named).name : 'voter_' + R.int(1, 40);
      const ch = R.weighted([['A', bias[0]], ['B', bias[1]], ['C', bias[2]]]);
      const word = R.pick([ch, ch.toLowerCase(), String.fromCharCode(0xFF21 + ch.charCodeAt(0) - 65), ch + 'がいい', ch + '案で!', '断然' + ch]);
      const late = i >= n; // 締め切りのあとに来たコメント（数えない）
      const t = late ? t1 + R.range(60e3, 3 * 3600e3) : t0 + R.range(0, t1 - t0 - 60e3);
      vote.demoComments.push({ id: 'd' + day + '_' + vote.kind + '_' + i, text: word, timestamp: new Date(t).toISOString(), from: { id: 'demo-' + who, username: who } });
    }
  };
  const retally = (vote) => {
    const comments = (inbox && inbox.voteComments) || vote.demoComments || [];
    const tally = P.tallyVote(comments, { opensAt: vote.opensAt, closesAt: vote.closesAt });
    const manual = vote.manual || { A: 0, B: 0, C: 0 }; // 手で書いた票（data/state.json の votes[].manual）
    vote.counted = tally.votes;
    vote.votes = { A: tally.votes.A + (manual.A || 0), B: tally.votes.B + (manual.B || 0), C: tally.votes.C + (manual.C || 0) };
    vote.voters = tally.voters + (manual.A || 0) + (manual.B || 0) + (manual.C || 0);
    vote.timeline = tally.timeline;
    vote.commentCount = tally.comments;
    return tally;
  };
  // 節目：フォロワーが届くと、特別な建物が候補に入る
  for (const m of config.milestones) {
    if (state.followers < m.at || state.reached.includes(m.at)) continue;
    state.reached.push(m.at);
    const adds = m.adds.filter((b) => !state.pool.includes(b));
    state.pool.unshift(...adds);
    if (adds.length) hist('event', `フォロワーが ${m.at} 人に届いた。${adds.map((b) => B(b).name).join('・')}が投票の候補に入った。`, { milestone: m.at });
  }
  // 締め切った投票を決める（何を → どこに の順）
  const ORDER = { what: 0, where: 1, tool: 2 };
  for (const vote of state.votes.filter((v) => day >= v.closesDay).sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
    closedVoters = closedVoters.concat(retally(vote).who);
    const max = Math.max(vote.votes.A, vote.votes.B, vote.votes.C);
    const tops = ['A', 'B', 'C'].filter((k) => vote.votes[k] === max);
    const win = tops.length === 1 ? tops[0] : R.pick(tops);
    const opt = vote.options.find((o) => o.key === win);
    const total = vote.votes.A + vote.votes.B + vote.votes.C;
    const result = {
      kind: vote.kind, question: KIND_Q[vote.kind], key: win, name: opt.name, day, openedDay: vote.openedDay,
      votes: vote.votes, voters: vote.voters, tie: tops.length > 1,
      pct: Object.fromEntries(['A', 'B', 'C'].map((k) => [k, total ? Math.round((vote.votes[k] / total) * 1000) / 10 : 0])),
      options: vote.options, opensAt: vote.opensAt, closesAt: vote.closesAt, timeline: vote.timeline,
    };
    const tail = `（A ${vote.votes.A} 票・B ${vote.votes.B} 票・C ${vote.votes.C} 票、${vote.voters} 人が投票${tops.length > 1 ? '、同点のためくじ引き' : ''}）`;
    if (vote.kind === 'what') {
      result.build = opt.build;
      state.plan = { build: opt.build, day, site: null, leveled: 0 };
      const i = state.pool.indexOf(opt.build);
      if (i >= 0) { state.pool.splice(i, 1); if (!B(opt.build).unique) state.pool.push(opt.build); } // 何度も建つ物は列の後ろへ
      hist('vote_result', `「何を建てる？」の投票で「${win} ${opt.name}」に決まった${tail}。`, { kind: 'what', key: win, votes: vote.votes, voters: vote.voters });
      for (const v of active) diaryExtra[v.key] = (diaryExtra[v.key] || '') + `投票で${opt.name}を建てることに決まった。`;
    } else if (vote.kind === 'where') {
      const def = state.plan && B(state.plan.build);
      if (state.plan && !state.plan.site) {
        const farm = world.buildings.find((b) => b.type === 'farm');
        if (def.plot === 'ring') state.plan.site = { x: 0, z: -1, plot: 'ring', label: '町のまわり' };
        else if (def.plot === 'farm' && farm) state.plan.site = { x: +(farm.x + Math.cos(farm.rot) * 4.4).toFixed(2), z: +(farm.z - Math.sin(farm.rot) * 4.4).toFixed(2), plot: 'farm', label: '畑のとなり', rot: farm.rot };
        else if (def.plot && world.special[def.plot]) state.plan.site = { ...world.special[def.plot], plot: def.plot, label: def.plot === 'center' ? '町のまん中' : '海べ' };
        else state.plan.site = { x: opt.x, z: opt.z, plot: opt.plot, label: opt.name };
      }
      result.site = state.plan ? state.plan.site : null;
      const fixed = state.plan && state.plan.site && state.plan.site.label !== opt.name;
      hist('vote_result', `「どこに建てる？」の投票で「${win} ${opt.name}」に決まった${tail}。${fixed ? `${def.name}は${state.plan.site.label}にしか建てられないので、${state.plan.site.label}に建てる。` : ''}`, { kind: 'where', key: win, votes: vote.votes, voters: vote.voters });
    } else {
      result.recipe = opt.recipe;
      state.toolGoal = opt.recipe;
      hist('vote_result', `「どの道具を作る？」の投票で「${win} ${opt.name}」に決まった${tail}。`, { kind: 'tool', key: win, votes: vote.votes, voters: vote.voters });
    }
    state.decisions.push(result);
  }
  state.votes = state.votes.filter((v) => day < v.closesDay);
  // 新しい投票を開く（村人がいる時だけ）
  const builtTypes = world.buildings.map((b) => b.type);
  const choices = () => {
    const out = [];
    for (const b of state.pool) {
      if (out.includes(b) || (B(b).unique && (builtTypes.includes(b) || (state.plan && state.plan.build === b)))) continue;
      if (B(b).needs && !builtTypes.includes(B(b).needs)) continue; // 水路は畑ができてから
      out.push(b); if (out.length === 3) break;
    }
    return out;
  };
  const openVote = (kind, options, h0, h1) => {
    const v = {
      kind, question: KIND_Q[kind], openedDay: day, closesDay: day + 1,
      opensAt: jst(date, h0), closesAt: h1 >= 24 ? jst(addDays(date, 1), h1 - 24) : jst(date, h1),
      options: options.map((o, i) => ({ key: 'ABC'[i], ...o })),
      votes: { A: 0, B: 0, C: 0 }, manual: { A: 0, B: 0, C: 0 }, voters: 0, timeline: [],
    };
    state.votes.push(v);
    return v;
  };
  if (!state.votes.length && active.length) {
    if (!state.plan) {
      const what = choices();
      if (what.length === 3) {
        const sites = siteOptions(world, state);
        const v1 = openVote('what', what.map((b) => ({ build: b, name: B(b).name })), BV.whatHours[0], BV.whatHours[1]);
        const v2 = openVote('where', sites, BV.whereHours[0], BV.whereHours[1]);
        hist('vote_open', `投票が始まった。「何を建てる？」（${v1.options.map((o) => o.key + ' ' + o.name).join(' / ')}、${BV.whatHours[0]}時〜${BV.whatHours[1]}時）と「どこに建てる？」（${v2.options.map((o) => o.key + ' ' + o.name).join(' / ')}、${BV.whereHours[0]}時〜${BV.whereHours[1]}時）。`, { kind: 'build' });
      }
    } else if (state.plan.site && builtTypes.includes(config.crafting.tiers.stone.needs) && day - (state.lastToolVote || 0) >= config.crafting.toolVoteEvery) {
      // 作業台がある時だけ、ときどき「どの道具を作る？」
      const recs = Object.entries(config.crafting.recipes).filter(([k, r]) => r.tier !== 'wood' && k !== state.toolGoal).slice(0, 3);
      if (recs.length === 3) {
        const v = openVote('tool', recs.map(([k, r]) => ({ recipe: k, name: ITEMS0[k].name, from: r.from })), BV.toolHours[0], BV.toolHours[1]);
        state.lastToolVote = day;
        hist('vote_open', `「どの道具を作る？」の投票が始まった（${v.options.map((o) => o.key + ' ' + o.name).join(' / ')}）。`, { kind: 'tool' });
      }
    }
  }
  for (const v of state.votes) { if (demo && !(inbox && inbox.voteComments)) genDemo(v); retally(v); }
  state.vote = state.votes[0] || null; // 前の形で読む画面のため

  // ---- 4. 天気 ----
  state.weather = R.weighted([['晴れ', 55], ['くもり', 25], ['雨', 20]]);
  const rain = state.weather === '雨';

  // ---- 5. 仕事を決める ----
  const built = builtTypes;
  const has = (t) => built.includes(t);
  const mult = { wood: 1 + state.bonus.wood, stone: 1 + state.bonus.stone, food: 1 + state.bonus.food };
  for (const t of built) { const bo = B(t).bonus; if (bo) for (const r of RES) mult[r] += bo[r] || 0; }
  const plan = state.plan;
  const cost = plan ? B(plan.build).cost : { wood: 20, stone: 8 }; // 何を建てるか決まる前は、木を多めに
  const IC = config.inventory;
  const ITEMS = config.items;
  const CC = config.crafting, GA = config.gather, RS2 = config.respawn;
  const NE = config.needs || { max: 20, hungerBase: 4, hungerWork: 5, eat: 10, starve: 2, regenAt: 14, regen: 2, restBelow: 8, restHeal: 8, restHunger: 2 };
  const GR = config.grass || { maxFields: 8, near: [12, 30] };
  if (!state.store) state.store = {};
  // チェスト（state.store）がそのまま町の持ち物。資源の数はチェストの中身から数える
  const VAL = (it) => (ITEMS[it] && ITEMS[it].value) || {};
  const syncRes = () => {
    state.res = { wood: 0, stone: 0, food: 0 };
    for (const r of RES) for (const it of config.spendOrder[r]) state.res[r] += (state.store[it] || 0) * (VAL(it)[r] || 0);
    for (const r of RES) state.resources[r] = Math.floor(state.res[r] + 1e-9);
  };
  const valueOf = (items) => { const v = { wood: 0, stone: 0, food: 0 }; for (const [it, n] of Object.entries(items)) { const val = VAL(it); for (const r of RES) v[r] += (val[r] || 0) * n; } return v; };
  const deposit = (items) => { for (const [it, n] of Object.entries(items)) if (n) state.store[it] = (state.store[it] || 0) + n; const v = valueOf(items); for (const r of RES) state.totals[r] = Math.round((state.totals[r] + v[r]) * 100) / 100; syncRes(); return v; };
  // チェストから使う（建てる・食べる）。足りた分だけ使って、足りなければ false
  const spend = (r, amount) => {
    let left = amount;
    for (const it of config.spendOrder[r]) {
      const per = VAL(it)[r]; if (!per || left <= 1e-9) continue;
      const k = Math.min(state.store[it] || 0, Math.ceil(left / per - 1e-9));
      state.store[it] = (state.store[it] || 0) - k; left -= k * per;
      if (!state.store[it]) delete state.store[it];
    }
    syncRes();
    return left <= 1e-9;
  };
  syncRes();
  const need = {};
  for (const r of RES) need[r] = Math.max(0, (cost[r] || 0) - state.resources[r]);
  need.food += Math.max(0, active.length * 4 - state.resources.food);
  const takenTrees = new Set(), takenFields = new Set(), takenBushes = new Set(), takenRocks = new Set();
  let ranchTaken = null; // 動物の世話は 1 日 1 人（もらえる物はその人がまとめて受け取る）
  const center = world.campfire;

  const daysIn = (v) => day - v.joinedDay + 1;
  const ensureLife = (L, v) => {
    L.hp = L.hp ?? NE.max; L.hunger = L.hunger ?? NE.max;
    L.inv = L.inv || []; L.xp = L.xp || 0; L.trips = L.trips || 0; L.items = L.items || {}; L.debt = L.debt || 0;
    L.level = I.levelFor(L.xp, IC); L.slots = I.slotCount(L.level, daysIn(v), IC);
    I.ensureSize(L.inv, L.slots);
    // 前の形の道具（axe / pickaxe / hoe）は木の道具として読む
    for (const s of L.inv) if (s && (s.item === 'axe' || s.item === 'pickaxe' || s.item === 'hoe')) s.item = 'wood_' + s.item;
    giveStartTool(L, v);
  };
  // 最初の道具：参加した時に選んだ木の道具を 1 つ持たせる（持ち物 3 つのうち 1 つ）。
  // 選んでいない人は、それまでに選ばれた数がいちばん少ない仕事の道具（同じ数なら名前から決まる順）。乱数は使わない
  const ST = config.startTools || { options: [] };
  const stOpts = ST.options.filter((o) => !o.needsEnemies || (config.enemies && config.enemies.enabled));
  const autoOpts = ST.options.filter((o) => !o.needsEnemies);
  const startCount = () => { const n = Object.fromEntries(autoOpts.map((o) => [o.id, 0])); for (const k in life) { const t = life[k] && life[k].startTool; if (t in n) n[t]++; } return n; };
  const giveStartTool = (L, v) => {
    if (!ST.options.length) return;
    const want = v.startTool && stOpts.find((o) => o.id === v.startTool);
    if (L.startTool && (!want || want.id === L.startTool)) return;
    const dur = CC.tiers.wood.durability;
    if (L.startTool) { // プロフィールで道具を変えた（参加した日の間に 1 回だけ。確かめは profiles.js）
      const old = ST.options.find((o) => o.id === L.startTool);
      const cur = old && I.getTool(L.inv, old.id);
      if (cur && I.toolTier(cur.item) === 'wood') I.removeTool(L.inv, old.id);
      if (I.addTool(L.inv, L.slots, want.item, dur)) { L.startTool = want.id; L.startAuto = false; diaryExtra[v.key] = (diaryExtra[v.key] || '') + `最初の道具を${ITEMS[want.item].name}にかえた。`; }
      return;
    }
    let pick = want;
    if (!pick) {
      const n = startCount(), h = hashStr('start:' + v.key);
      pick = autoOpts.map((o, i) => ({ o, n: n[o.id], r: (i + h) % autoOpts.length })).sort((a, b) => a.n - b.n || a.r - b.r)[0].o;
    }
    L.startTool = pick.id; L.startAuto = !want;
    if (!I.getTool(L.inv, pick.id)) I.addTool(L.inv, L.slots, pick.item, dur);
    diaryExtra[v.key] = (diaryExtra[v.key] || '') + `${ITEMS[pick.item].name}を持ってきた。`;
  };
  const startJob = (L) => { const o = ST.options.find((x) => x.id === L.startTool); return o ? o.job : null; };
  const haulText = (got) => Object.entries(got).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([it, n]) => `${ITEMS[it].name}${n}`).join('・');

  // 整地：最初の日は村のまん中、建てる場所が決まったらその場所。2 人までがする
  const levelJobs = [];
  if (active.length && !world.square.leveled) levelJobs.push({ target: 'square', at: world.square, r: world.square.r, what: '村のまん中' });
  if (plan && plan.site && !plan.leveled && plan.site.plot !== 'ring' && plan.site.plot !== 'farm') levelJobs.push({ target: 'site', at: plan.site, r: 4.2, what: `${B(plan.build).name}を建てる場所` });
  let leveler = 0;
  // チェストは最初の村人が来た日に置く
  if (active.length && !world.chest.day) { world.chest.day = day; hist('event', '村のまん中にチェストを置いた。集めた物は、ここに入れる。'); }

  const today = { weather: state.weather, jobs: { wood: 0, stone: 0, food: 0 }, gained: { wood: 0, stone: 0, food: 0 }, built: [], trips: 0, crafted: [], leveled: [] };
  for (const v of active) {
    const L = life[v.key];
    ensureLife(L, v);
    L.targets = [];
    // 夜の見張りでケガをした人は、この日だけ休む（乱数は使わないので、ほかの人の結果の流れはそのまま）
    if (L.hurt && L.hurt >= day) {
      L.job = 'rest'; L.action = 'rest'; L.target = null; L.amount = 0; L.today = { got: {}, trips: 0, actions: 0 };
      L.diary.push({ day, date, text: (v.joinedDay === day ? '' : 'ゆうべのケガで、今日は家で休んだ。') + (diaryExtra[v.key] || '') });
      continue;
    }
    // 体力が少ない人は休む（おなかがすいて体力が減った時など。休むと戻る）
    if (L.hp <= NE.restBelow) {
      L.job = 'rest'; L.action = 'rest'; L.restWhy = 'weak'; L.target = null; L.amount = 0; L.today = { got: {}, trips: 0, actions: 0 };
      L.diary.push({ day, date, text: '体に力が入らないので、今日は家で休んだ。' + (diaryExtra[v.key] || '') });
      continue;
    }
    delete L.restWhy;
    // 整地をする人
    const lv = levelJobs.length ? levelJobs[Math.min(levelJobs.length - 1, Math.floor(leveler / 2))] : null;
    if (lv && leveler < levelJobs.length * 2) {
      leveler++;
      L.job = 'level'; L.action = 'level'; L.target = lv.target; L.amount = 0; L.today = { got: {}, trips: 0, actions: IC.actionsPerDay };
      L.xp += IC.actionsPerDay * IC.xp.gather;
      L.diary.push({ day, date, text: (v.joinedDay === day ? '今日から村に住むことになった。よろしく。' : '') + `${lv.what}の草をぬいて、石をどけて、地面をならした。` + (diaryExtra[v.key] || '') });
      continue;
    }
    const pref = RES[(P.userHash(v.key).charCodeAt(0)) % 3];
    // プロフィールの「やりたい仕事」を少し優先する（建築は今いちばん足りない材料へ。商いはまだ店がないので影響なし）
    // 最初の道具の仕事（得意な仕事）。プロフィールの「やりたい仕事」があれば、そちらを先にする
    // 役割は、選んだ道具で決まる。道具に仕事がない時（見張りなど）だけ、プロフィールの「やりたい仕事」を使う
    const toolJob = startJob(L);
    const toolRes = { '伐採': 'wood', '採掘': 'stone', '農業': 'food', '漁業': 'food', '牧場': 'food' }[toolJob];
    const want = toolRes ? toolJob : ((v.profile && v.profile.wantJob) || (v._priv && v._priv.wantJob) || toolJob);
    const wantRes = { '伐採': 'wood', '採掘': 'stone', '農業': 'food', '漁業': 'food', '牧場': 'food' }[want] || (want === '建築' ? RES.slice().sort((a, b) => need[b] - need[a])[0] : null);
    const wantK = toolRes ? 4 : 2.2; // 道具の仕事に決める
    const w = RES.map((r) => [r, (1 + need[r] / 8) * (r === pref ? 1.6 : 1) * (r === wantRes ? wantK : 1)]);
    let job = R.weighted(w);
    // 最初の道具の仕事（得意な仕事）は先にする（乱数の流れは変えない。木や岩がなければ、いつもの順で別の仕事）
    if (wantK === 4 && wantRes) job = wantRes;
    let target = null, action = null, place = '', harvestCrop = null;
    // 木：近い木から。1 本ずつ、原木が落ち終わるまで（treeLogs 本）。倒れたら切り株になって、次の木へ
    const nextTree = (from) => {
      const cand = IX.trees.nearest(from.x, from.z, from === center ? 8 : 2, (t) => t.state === 'tree' && !t.gone && !takenTrees.has(t.id));
      if (!cand.length) return null;
      const t = from === center ? R.pick(cand) : cand[0]; takenTrees.add(t.id);
      if (!t.logs) t.logs = R.int(GA.treeLogs[0], GA.treeLogs[1]);
      return t;
    };
    const nextRock = (from) => {
      const cand = IX.rocks.nearest(from.x, from.z, from === center ? 4 : 2, (r) => r.hp > 0 && !r.gone && !takenRocks.has(r.id));
      if (!cand.length) return null;
      const r = from === center ? R.pick(cand) : cand[0]; takenRocks.add(r.id);
      O.ensureBlocks(state.seed, r, config.ores);
      return r;
    };
    let curTree = null, curRock = null;
    const tryWood = () => { curTree = nextTree(center); if (!curTree) return false; target = curTree.id; action = 'chop'; place = area(curTree); return true; };
    const tryStone = () => { curRock = nextRock(center); if (!curRock) return false; target = curRock.id; action = 'dig'; place = area(curRock); return true; };
    const tryFood = () => {
      // 食べ物の仕事の中身：畑（農業）・釣り（漁業）・動物の世話（牧場）・野原で集める。「やりたい仕事」を優先
      const FA = config.farming, AN = config.animals;
      const tamed = world.animals.filter((a) => a.pen);
      const rodOK = I.getTool(L.inv, 'fishing_rod') || CR.choose(state.store, 'fishing_rod', CC, { built, have: 'hand' }).key;
      const subs = [['wild', 1.2]];
      // 草の畑：くわを持っていて、チェストに種があれば、草を耕して畑にできる（farm の区画がなくても）
      const wildN = world.fields.filter((f) => f.wild).length;
      const canPlant = !!I.getTool(L.inv, 'hoe') && (state.store.seeds || 0) > 0 && wildN < GR.maxFields;
      if (world.fieldSlots.length || canPlant || world.fields.length) subs.push(['farm', want === '農業' ? 5 : 1.8]);
      if (world.pond && rodOK) subs.push(['fish', want === '漁業' ? 5 : 1.0]);
      if (tamed.length && !ranchTaken) subs.push(['ranch', want === '牧場' ? 5 : 2.5]);
      let sub = R2.weighted(subs);
      // 釣りざお・くわを選んだ人は、その仕事に決まる（できる時だけ。乱数の流れは変えない）
      const forced = { '漁業': 'fish', '牧場': 'ranch' }[want];
      if (forced && subs.some(([s]) => s === forced)) sub = forced;
      if (sub === 'fish') { target = 'pond'; action = 'fish'; place = '池で'; return true; }
      if (sub === 'ranch') { ranchTaken = v.key; target = (world.buildings.find((b) => b.type === 'pen') || {}).id || null; action = 'ranch'; return true; }
      if (sub === 'farm') {
        const ripe = world.fields.filter((f) => f.stage >= (f.max || 3) && !takenFields.has(f.id));
        if (ripe.length) { const f = R2.pick(ripe); takenFields.add(f.id); f.stage = 0; f.harvested = (f.harvested || 0) + 1; target = f.id; action = 'harvest'; harvestCrop = f.crop || 'wheat'; return true; }
        const slotN = world.fields.filter((f) => !f.wild).length;
        if (slotN < world.fieldSlots.length) {
          const slot = world.fieldSlots[slotN];
          const crops = Object.keys(FA.crops);
          const crop = crops[world.fields.length % crops.length];
          const f = { id: 'f' + world.fields.length, x: slot.x, z: slot.z, rot: slot.rot || 0, stage: 0, day, crop, max: FA.crops[crop].days };
          world.fields.push(f); IX.fields.set(f, f.x, f.z); takenFields.add(f.id); target = f.id; action = 'till'; harvestCrop = crop; return true;
        }
        if (canPlant) {
          const spot = freeSpot(GR.near[0], GR.near[1], 'field');
          if (spot) {
            const crop = 'wheat';
            const f = { id: 'f' + world.fields.length, x: spot.x, z: spot.z, rot: 0, stage: 0, day, crop, max: FA.crops[crop].days, wild: 1 };
            state.store.seeds--; if (!state.store.seeds) delete state.store.seeds;
            world.fields.push(f); IX.fields.set(f, f.x, f.z); takenFields.add(f.id); target = f.id; action = 'till'; harvestCrop = crop;
            first('wild_field', `${v.display}が、くわで草を耕して畑にし、種をまいた。`, { who: [v.key] });
            return true;
          }
        }
        const grow = world.fields.filter((f) => !takenFields.has(f.id) && f.stage < (f.max || 3));
        if (grow.length) { const f = R2.pick(grow); takenFields.add(f.id); f.stage = Math.min(f.max || 3, f.stage + 1); target = f.id; action = 'tend'; return true; }
      }
      void AN;
      const bush = world.bushes.filter((b) => b.ready && !takenBushes.has(b.id));
      if (bush.length && R.chance(0.6)) { const b = R.pick(bush); takenBushes.add(b.id); b.ready = false; b.regrow = 3; target = b.id; action = 'berry'; return true; }
      if (bush.length) { const b = R.pick(bush); takenBushes.add(b.id); b.ready = false; b.regrow = 3; target = b.id; action = 'berry'; return true; }
      target = null; action = 'forage'; return true; // 野原で草を摘む
    };
    const order = { wood: [tryWood, tryStone, tryFood], stone: [tryStone, tryWood, tryFood], food: [tryFood] }[job];
    for (const f of order) if (f()) break;
    job = { chop: 'wood', dig: 'stone' }[action] || 'food';
    const notes = [];

    // ---- 道具：チェストの材料で、今より良い物を作る（作業台があれば石・鉄も）。材料が足りなければ素手 ----
    const kind = { chop: 'axe', dig: 'pickaxe', till: 'hoe', tend: 'hoe', harvest: 'hoe', fish: 'fishing_rod' }[action] || null;
    let budget = IC.actionsPerDay - L.debt; L.debt = 0;
    let trips = 0;
    const onUnload = (items) => { const val = deposit(items); for (const r of RES) L.contrib[r] += val[r]; trips++; };
    const tryCraft = (again) => {
      const cur = I.getTool(L.inv, kind);
      const have = cur ? I.toolTier(cur.item) : 'hand';
      const ch = CR.choose(state.store, kind, CC, { built, have, goal: state.toolGoal });
      if (ch.key) {
        if (!cur && !L.inv.slice(0, L.slots).some((s) => !s)) { onUnload(I.unload(L.inv)); budget -= IC.tripCost; }
        I.removeTool(L.inv, kind);
        const dur = CC.tiers[ch.recipe.tier].durability;
        if (I.addTool(L.inv, L.slots, ch.key, dur)) {
          for (const k of Object.keys(state.store)) delete state.store[k];
          Object.assign(state.store, ch.store); syncRes();
          notes.push(again ? `${ITEMS[ch.key].name}を作り直した。` : `チェストの材料で${ITEMS[ch.key].name}を作った。`);
          today.crafted.push({ who: v.key, item: ch.key });
          if (state.toolGoal === ch.key) { hist('craft', `投票で決まった${ITEMS[ch.key].name}ができた。`, { item: ch.key }); state.toolGoal = null; }
          return true;
        }
      } else if (!cur && ch.want) {
        notes.push(`${ITEMS[ch.want.key].name}を作りたかったが、材料が足りない（${CR.missingText(ch.want.missing, ITEMS)}）。素手でがんばった。`);
        today.craftNeed = { item: ch.want.key, missing: ch.want.missing };
      }
      return false;
    };
    if (kind) tryCraft(false);
    const tierNow = () => { const cur = kind && I.getTool(L.inv, kind); return cur ? I.toolTier(cur.item) : 'hand'; };
    const usedTier = tierNow();
    let acc = 0, extra = 0, ranchGot = false, harvestDone = false;
    if (action === 'till') first('till', `${v.display}が、村ではじめて畑を耕して${config.farming.crops[harvestCrop].name}の種をまいた。`, { who: [v.key] });
    let curT = curTree, curR = curRock, curS = null;
    // 1 回の作業：道具が良いほどたたく回数が少ないので、たくさん落ちる（素手 8 回・木 6 回・石 4 回・鉄 3 回で 1 つ）
    const produce = () => {
      const st = CR.stats(kind ? tierNow() : 'wood', CC);
      const before = kind && I.getTool(L.inv, kind);
      if (before && st.durability && I.useTool(L.inv, kind)) { const nm = ITEMS[before.item].name; if (!tryCraft(true)) notes.push(`${nm}がこわれた。`); }
      if (action === 'fish') { // うきが沈んだら釣り上げる。良い釣りざおほど、よく沈む
        const FC = config.fishing;
        const out = {};
        if (R2.chance(Math.min(0.95, FC.biteChance * CC.tiers.wood.hits / st.hits))) {
          const it = R2.chance(FC.treasure.p) ? R2.weighted(FC.treasure.items) : R2.chance(FC.junk.p) ? R2.weighted(FC.junk.items) : R2.weighted(FC.fish);
          out[it] = 1;
          if (it.startsWith('fish_')) first('fish', `${v.display}が、村ではじめて魚を釣った（${ITEMS[it].name}）。`, { who: [v.key], item: it });
          else if (FC.treasure.items.some(([k]) => k === it)) { first('treasure', `${v.display}が池から${ITEMS[it].name}を釣り上げた。村ではじめての宝物。`, { who: [v.key], item: it }); notes.push(`${ITEMS[it].name}が釣れた。`); }
        }
        return Object.entries(out);
      }
      if (action === 'ranch') { // 柵の中の動物の世話。もらえる物は 1 日 1 回（最初の作業でまとめて）
        if (ranchGot) return [];
        ranchGot = true;
        const AN = config.animals, out = {};
        for (const a of world.animals.filter((x) => x.pen)) {
          const k = AN.kinds[a.kind];
          if ((day - a.tamedDay) % k.every !== 0 || !R2.chance(k.p)) continue;
          out[k.gives] = (out[k.gives] || 0) + 1;
          first('give_' + k.gives, `はじめて${k.name}から${ITEMS[k.gives].name}をもらった。`, { who: [v.key], item: k.gives });
        }
        return Object.entries(out);
      }
      acc += CC.tiers.wood.hits / st.hits;
      let n = Math.floor(acc + 1e-9); acc -= n;
      if (job === 'wood') {
        const out = [['log', 0], ['apple', 0], ['sapling', 0], ['stump', 0]];
        while (n > 0 && (curT || curS)) {
          if (curS) { // 切り株をたたいて掘り出す：原木 1 本か「切り株」が 1 つ落ちる
            const k = Math.min(n, curS.stumpHp); curS.stumpHp -= k; n -= k; L.targets.push(curS.id);
            if (curS.stumpHp <= 0) { if (R3.chance(0.5)) out[0][1]++; else out[3][1]++; curS.state = 'removed'; curS.gone = 1; curS.removedDay = day; delete curS.stumpHp; curS = null; }
            continue;
          }
          const k = Math.min(n, curT.logs); curT.logs -= k; n -= k; out[0][1] += k;
          extra += k * (st.drop - 1); if (extra >= 1) { out[0][1] += Math.floor(extra); extra -= Math.floor(extra); }
          L.targets.push(curT.id);
          if (curT.logs <= 0) { // 倒れて、切り株が残る
            curT.state = 'stump'; curT.regrow = RS2.stumpDays; curT.cutDay = day; curT.logs = 0;
            if (R.chance(0.12)) out[1][1]++; if (R.chance(0.1)) out[2][1]++;
            if (R3.chance(RS2.stumpDig ?? 0.5)) { curT.stumpHp = RS2.stumpHits || 2; curS = curT; } // 切り株も掘る
            curT = nextTree(curT);
          }
        }
        out[0][1] = Math.round(out[0][1] * mult.wood);
        return out;
      }
      if (job === 'stone') {
        const got = {};
        while (n > 0 && curR) {
          const blk = curR.blocks[curR.max - curR.hp] || 's';
          const item = O.ORE_ITEM[blk] || 'cobble';
          got[item] = (got[item] || 0) + 1; n--;
          if (item === 'cobble') { extra += st.drop - 1; if (extra >= 1) { got.cobble += Math.floor(extra); extra -= Math.floor(extra); } }
          if (O.RARE.has(blk) && !history.some((h) => h.day === day && h.type === 'find' && h.item === item)) { hist('find', `${v.display}が${ITEMS[item].name}を見つけた。`, { who: [v.key], item, rock: curR.id }); notes.push(`岩の中から${ITEMS[item].name}が出てきた。`); }
          L.targets.push(curR.id);
          curR.hp -= 1;
          if (curR.hp <= 0) { curR.back = day + R.int(RS2.rockDays[0], RS2.rockDays[1]); curR = nextRock(curR); } // 壊れて消える。何日かでまた出る
        }
        if (got.cobble) got.cobble = Math.round(got.cobble * mult.stone);
        return Object.entries(got);
      }
      const q = (a, b, m) => Math.max(0, Math.round(R.int(a, b) * m * (n > 0 ? 1 : 0.5)));
      if (action === 'harvest') {
        const cp = config.farming.crops[harvestCrop] || config.farming.crops.wheat;
        if (!harvestDone) { harvestDone = true; first('harvest_' + harvestCrop, `畑ではじめて${cp.name}がとれた。`, { who: [v.key], item: harvestCrop }); }
        const got = [[harvestCrop, Math.max(0, Math.round(R2.int(cp.yield[0], cp.yield[1]) * mult.food * (n > 0 ? 1 : 0.5)))]];
        got.push([cp.seed || 'seeds', R2.int(1, 2)]); // 収穫すると種も取れる
        return got;
      }
      if (action === 'berry') return [['berry', q(1, 3, mult.food)], ['flower_r', R.chance(0.08) ? 1 : 0]];
      if (action === 'till' || action === 'tend') return [['wheat', R.chance(0.35) ? q(1, 2, mult.food) : 0], ['seeds', R.int(0, 1)]];
      return [['berry', q(1, 2, mult.food)], [R.chance(0.5) ? 'flower_r' : 'flower_y', R.chance(0.25) ? 1 : 0], ['seeds', R.int(0, 1)]];
    };
    const res = I.workDay({ inv: L.inv, slots: L.slots, budget, produce, onUnload, cfg: IC });
    // 夕方、持っている物をぜんぶチェストへ入れる（往復には数えない）
    { const rest = I.unload(L.inv); if (Object.keys(rest).length) { const val = deposit(rest); for (const r of RES) L.contrib[r] += val[r]; } }
    L.targets = [...new Set(L.targets)];
    L.tool = kind ? (I.getTool(L.inv, kind) || {}).item || null : null; L.toolTier = usedTier;
    const gotVal = valueOf(res.got);
    for (const [it, n] of Object.entries(res.got)) L.items[it] = (L.items[it] || 0) + n;
    for (const r of RES) L.gathered[r] = Math.round((L.gathered[r] + gotVal[r]) * 100) / 100;
    L.trips += trips; today.trips += trips;
    const xpType = { wood: 'chop', stone: 'dig', food: 'gather' }[job];
    L.xp += res.actions * IC.xp[xpType] + trips * IC.xp.carry;
    L.job = job; L.action = action; L.target = target; L.amount = Math.round(gotVal[job] * 10) / 10; L.today = { got: res.got, trips, actions: res.actions };
    today.jobs[job]++; for (const r of RES) today.gained[r] = Math.round((today.gained[r] + gotVal[r]) * 10) / 10;

    // 日記
    const haul = haulText(res.got) || '少し';
    const fell = job === 'wood' ? L.targets.length : 0;
    const T = {
      chop: fell > 1 ? [`${place}木を${fell}本たおした。${haul}。`] : [`${place}木を切った。${haul}。`, `朝から斧をふって、${place}木を1本たおした。${haul}。`],
      dig: [`${place}岩をたたいて掘った。${haul}。`, `つるはしで岩をくだいた。${haul}。`, `岩を何回もたたいて、かけらを掘り出した。${haul}。`],
      berry: [`草むらで木の実を集めた。${haul}。`, `赤い実をかごいっぱいにつんだ。${haul}。`],
      till: [`新しい畑を耕した。${haul}。`, `くわで土を起こして、畑をひとつ作った。${haul}。`],
      tend: [`畑の世話をした。芽がのびてきた。${haul}。`, `畑に水をまいた。${haul}。`],
      harvest: [`畑で収穫した。${haul}。`, `畑の作物をかりとった。${haul}。`],
      forage: [`野原で草や実を集めた。${haul}。`],
      fish: res.got && Object.keys(res.got).length ? [`池で釣りをした。うきが沈むのを待って、${haul}を釣り上げた。`, `釣りざおを持って池へ行った。${haul}。`] : ['池で一日釣りをしたが、何もかからなかった。'],
      ranch: Object.keys(res.got).length ? [`柵の中の動物に、えさと水をやった。${haul}をもらった。`, `動物の世話をした。${haul}をもらった。`] : ['柵の中の動物に、えさと水をやった。'],
    }[action];
    if (action === 'harvest' || action === 'till') T.unshift(...(action === 'harvest' ? [`畑で${config.farming.crops[harvestCrop].name}を収穫した。${haul}。`] : [`くわで土を起こして、${config.farming.crops[harvestCrop].name}の種をまいた。${haul}。`]));
    let text = R.pick(T);
    if (rain && R.chance(0.6)) text = '雨の中、' + text;
    else if (state.weather === '晴れ' && R.chance(0.25)) text = 'いい天気。' + text;
    if (v.joinedDay === day) text = '今日から村に住むことになった。よろしく。' + text;
    text += notes.join('');
    if (trips) text += `持ち物がいっぱいになって、チェストまで${trips}回往復した。`;
    if (diaryExtra[v.key]) text += diaryExtra[v.key];
    L.diary.push({ day, date, text });
  }
  // 整地のできあがり：草と石がなくなる。建てる場所の木と岩はどける
  if (leveler) {
    for (const lv of levelJobs) {
      if (lv.target === 'square') { world.square.leveled = day; today.leveled.push('square'); hist('level', '村のまん中の草をぬいて、石をどけて、地面をならした（整地）。'); }
      else {
        plan.leveled = day; today.leveled.push('site');
        clearAround(plan.site.x, plan.site.z); // 建てる場所のまわり（clearBlocks）の木と岩をどける
        hist('level', `${plan.site.label}の、${B(plan.build).name}を建てる場所をならした。建て始めた。`);
      }
    }
  }
  if (plan && plan.site && (plan.site.plot === 'ring' || plan.site.plot === 'farm') && !plan.leveled) plan.leveled = day;

  // ---- 6. 食べる（チェストの食べ物、足りなければ自分の持ち物から） ----
  const foodBefore = state.res.food;
  const fedChest = spend('food', active.length);
  const ate = new Set();
  if (!fedChest) {
    const FOOD = ['apple', 'berry', 'wheat'];
    let need2 = active.length * 0.5; // チェストが空になった分の半分を、持ち物から
    for (const v of active) {
      if (need2 <= 0) break;
      const inv = life[v.key].inv;
      for (let i = 0; i < inv.length && need2 > 0; i++) {
        const s = inv[i];
        if (s && FOOD.includes(s.item)) { const per = ITEMS[s.item].value.food; const k = Math.min(s.n, Math.ceil(need2 / per)); s.n -= k; need2 -= k * per; if (s.n <= 0) inv[i] = null; ate.add(v.key); }
      }
    }
    if (need2 > 0) {
      for (const v of active) life[v.key].diary[life[v.key].diary.length - 1].text += '食べ物が足りなくて、おなかがすいた。';
      hist('event', '食べ物が足りなくなった。みんなおなかをすかせている。');
    }
  }
  syncRes();
  // 体力とおなか（どちらも 0〜max。ハート・肉のアイコン 1 つで 2）。働くほど・時間がたつほどおなかがへり、食べると戻る。
  // おなかが 0 だと体力が少しずつ減る（死なない。体力が restBelow 以下になったら次の日は休んで戻す）
  {
    const frac = fedChest ? 1 : Math.max(0, Math.min(1, foodBefore / Math.max(1, active.length)));
    for (const v of active) {
      const L = life[v.key];
      const work = ((L.today && L.today.actions) || 0) / IC.actionsPerDay;
      const resting = L.action === 'rest';
      L.hunger = Math.max(0, L.hunger - (resting ? NE.restHunger : NE.hungerBase + NE.hungerWork * work));
      L.hunger = Math.min(NE.max, Math.round(L.hunger + (ate.has(v.key) ? NE.eat : NE.eat * frac)));
      const d = L.diary[L.diary.length - 1];
      if (resting) L.hp = Math.max(1, Math.min(NE.max, L.hp + NE.restHeal - (L.hunger <= 0 ? NE.starve : 0))); // 休むと戻る（おなかが 0 でも少しは）
      else if (L.hunger <= 0) { L.hp = Math.max(1, L.hp - NE.starve); if (d) d.text += 'おなかがすいて、体力が減った。'; }
      else if (L.hunger >= NE.regenAt) L.hp = Math.min(NE.max, L.hp + NE.regen);
    }
  }

  // ---- 7. 生える・育つ・また出てくる（日数は config.json の respawn） ----
  // 切り株：その場所にはもう生えない。stumpDays たつと、別の空いた場所に苗木が出て、saplingDays で木になる。
  // 切り株は stumpRotDays で朽ちて消える（たたいて掘り出すこともできる）
  for (const t of world.trees.slice()) {
    if (t.gone) continue;
    if (t.state === 'stump') {
      if (t.cutDay === day) continue;
      t.regrow -= 1;
      if (t.regrow <= 0 && !t.spawned) {
        t.spawned = day;
        const spot = freeSpot(0, 0, 'tree');
        // 苗木はそのマスの決まった所に（保存は地図の文字だけで済む）。同じマスにもう何かあれば置かない
        if (spot) { R3.int(0, 2); R3.range(0.85, 1.2); world.treeSeq++; }
        const nt = spot && TM.treeAt(spot.x, spot.z);
        if (nt && !nearBuilding(nt.x, nt.z) && !world.trees.some((o) => o.id === nt.id) && !IX.trees.any(nt.x, nt.z, 2.6, (o) => !o.gone || o.state === 'removed')) addTree({ ...nt, state: 'sapling', regrow: RS2.saplingDays, born: day });
      }
      if (t.cutDay && day - t.cutDay >= (RS2.stumpRotDays || 40)) { t.state = 'removed'; t.gone = 1; t.removedDay = day; }
    } else if (t.state === 'sapling') {
      if (t.born === day) continue;
      t.regrow -= 1;
      if (t.regrow <= 0) { t.state = 'tree'; t.logs = 0; }
    }
  }
  // 岩：同じ場所か、別の場所に新しく出る（建物や建てる場所の上には出ない）
  const busy = (x, z) => nearBuilding(x, z)
    || Math.hypot(x - world.square.x, z - world.square.z) < world.square.r + 2 || IX.trees.any(x, z, 2.6, (t) => !t.gone && t.state === 'tree')
    || IX.rocks.any(x, z, 4, (r) => r.hp > 0);
  for (const r of world.rocks) {
    if (r.hp > 0 || !r.back || day < r.back) continue;
    let x = r.x, z = r.z;
    if (!R.chance(RS2.sameSpot) || busy(x, z)) {
      let ok = false;
      for (let k = 0; k < 40 && !ok; k++) {
        x = R.range(-100, 100); z = R.range(-100, world.seaZ - 6);
        ok = !busy(x, z) && !(x < -30 && x > -46 && z > -10 && z < 12);
      }
      if (!ok) continue;
    }
    r.gen = (r.gen || 0) + 1;
    r.x = +x.toFixed(2); r.z = +z.toFixed(2); IX.rocks.set(r, r.x, r.z);
    r.max = R.int(GA.rockItems[0], GA.rockItems[1]); r.hp = r.max;
    r.blocks = O.genBlocks(state.seed, { id: r.id + '#' + r.gen, max: r.max }, config.ores);
    if (Math.hypot(r.x, r.z + 1) > 44) r.far = 1; else delete r.far;
    delete r.back; delete r.gone;
  }
  for (const b of world.bushes) if (!b.ready) { b.regrow -= 1; if (b.regrow <= 0) b.ready = true; }
  // 畑：毎日 1 段育つ。雨の日と、水路のそば（確率）はもう 1 段
  {
    const FA = config.farming;
    const canal = world.buildings.find((b) => b.type === 'canal');
    for (const f of world.fields) {
      const max = f.max || 3;
      if (f.day === day && f.stage === 0 && takenFields.has(f.id)) continue; // 今日まいた種は明日から
      let g = 1;
      if (rain) g++;
      if (canal && Math.hypot(f.x - canal.x, f.z - canal.z) < FA.canalRange && R2.chance(FA.canalBoost)) { g++; f.water = 1; }
      f.stage = Math.min(max, f.stage + g);
    }
  }
  // 種や作物を持っている村人には、近くの動物がついてくる。柵があれば、その人が柵まで連れて入れる（動物は減らない）
  const LURE = ['seeds', 'wheat', 'carrot', 'potato'];
  const leaders = active.filter((v) => { const g = (life[v.key].today && life[v.key].today.got) || {}; const it = LURE.find((k) => g[k] > 0); life[v.key].lure = it || null; return !!it; });
  {
    const AN = config.animals;
    let li = 0;
    for (const pen of world.buildings.filter((b) => b.type === 'pen')) {
      const inPen = world.animals.filter((a) => a.pen === pen.id);
      const wild = world.animals.filter((a) => !a.pen && Math.hypot(a.x - pen.x, a.z - pen.z) < AN.tameRange)
        .sort((a, b) => Math.hypot(a.x - pen.x, a.z - pen.z) - Math.hypot(b.x - pen.x, b.z - pen.z) || (a.id < b.id ? -1 : 1));
      // 種類がかたよらないように、まだいない種類を先に
      wild.sort((a, b) => inPen.some((x) => x.kind === a.kind) - inPen.some((x) => x.kind === b.kind));
      for (const a of wild.slice(0, Math.max(0, Math.min(AN.tamePerDay, AN.penCap - inPen.length, leaders.length - li)))) {
        const i = inPen.length;
        const ld = leaders[li++], Ll = life[ld.key];
        a.pen = pen.id; a.tamedDay = day; a.wildX = a.x; a.wildZ = a.z; a.ledBy = ld.key;
        Ll.diary[Ll.diary.length - 1].text += `${ITEMS[Ll.lure].name}を持っていたら${AN.kinds[a.kind].name}がついてきたので、柵に入れた。`;
        a.x = +(pen.x + ((i % 4) - 1.5) * 1.6 + R2.range(-0.3, 0.3)).toFixed(2); a.z = +(pen.z + (Math.floor(i / 4) - 0.5) * 1.8 + R2.range(-0.3, 0.3)).toFixed(2);
        inPen.push(a);
        first('tame', `野の${AN.kinds[a.kind].name}を、はじめて柵の中に入れて飼い始めた。`, { animal: a.id });
      }
    }
  }

  // ---- 8. 建てる（投票で決まった物を、決まった場所に。整地が終わって、チェストの材料が足りたら） ----
  // チェストだけで足りなければ、材料を持っている人が持ち寄る（その人は明日の仕事が往復ぶん減る）
  const lacking = () => RES.filter((r) => state.res[r] + 1e-9 < (cost[r] || 0));
  if (plan && plan.site && plan.leveled && lacking().length) {
    const pooled = { ...state.res };
    const carriers = active.map((v) => ({ v, val: valueOf(Object.fromEntries(life[v.key].inv.filter((s) => s && !I.isTool(s) && config.spendOrder.wood.concat(config.spendOrder.stone, config.spendOrder.food).includes(s.item)).map((s) => [s.item, s.n]))) }));
    for (const c of carriers) for (const r of RES) pooled[r] += c.val[r];
    if (RES.every((r) => pooled[r] + 1e-9 >= (cost[r] || 0))) {
      carriers.sort((a, b) => RES.reduce((s, r) => s + (lacking().includes(r) ? b.val[r] - a.val[r] : 0), 0));
      for (const c of carriers) {
        const lk = lacking();
        if (!lk.length) break;
        if (!lk.some((r) => c.val[r] > 0)) continue;
        const L = life[c.v.key];
        const val = deposit(I.unload(L.inv));
        for (const r of RES) L.contrib[r] += val[r];
        L.trips++; today.trips++; L.debt += IC.tripCost; L.xp += IC.xp.carry;
        L.diary[L.diary.length - 1].text += '建てる材料をチェストへ運んだ。';
      }
    }
  }
  if (plan && plan.site && plan.leveled && !lacking().length) {
    for (const r of RES) if (cost[r]) spend(r, cost[r]);
    const def = B(plan.build);
    const pos = plan.site;
    const id = plan.build + '_' + world.buildings.length;
    const builders = active.filter((v) => RES.some((r) => (cost[r] || 0) > 0 && life[v.key].contrib[r] > 0)).map((v) => v.key);
    const b = { id, type: plan.build, x: pos.x, z: pos.z, plot: pos.plot, rot: +Math.atan2(-pos.x, -(pos.z + 1)).toFixed(3), day, builders, variant: R.int(0, 3), voted: true };
    if (pos.plot === 'coast' || pos.plot === 'coast2' || pos.plot === 'coast3') b.rot = Math.PI;
    if (pos.rot !== undefined) b.rot = pos.rot;
    world.buildings.push(b);
    clearAround(b.x, b.z); // 建物のまわりの木と岩をどける（そこにはもう生えない）
    if (plan.build === 'farm') { // 畑の区画（3 × 2）。建った場所の向きにそろえる
      const n = config.farming.plotsPerFarm, c = Math.cos(b.rot), s = Math.sin(b.rot);
      for (let i = 0; i < n; i++) {
        const lx = ((i % 3) - 1) * 2.3, lz = (Math.floor(i / 3) - 0.5) * 2.5;
        { const fs0 = { x: +(b.x + lx * c + lz * s).toFixed(2), z: +(b.z - lx * s + lz * c).toFixed(2), farm: b.id, rot: b.rot }; world.fieldSlots.push(fs0); IX.slots.set(fs0, fs0.x, fs0.z); }
      }
    }
    for (const k of builders) { life[k].built.push(id); life[k].xp += IC.xp.build; for (const r of RES) life[k].contrib[r] = 0; life[k].diary[life[k].diary.length - 1].text += `${def.name}ができた。自分の運んだ材料も使われている。`; }
    today.built.push(id);
    hist('build', `投票で決まった${def.name}が${pos.label}に建った。${builders.length} 人が材料を集めた。`, { building: id, buildingType: plan.build });
    state.plan = null;
  }
  // 次に作れる道具（サイトの「町のチェスト」に出す）
  {
    const best = (kind) => active.reduce((m, v) => { const t = I.getTool(life[v.key].inv || [], kind); const tier = t ? I.toolTier(t.item) : 'hand'; return CR.tierRank(tier) > CR.tierRank(m) ? tier : m; }, 'hand');
    const ch = CR.choose(state.store, 'pickaxe', CC, { built: world.buildings.map((x) => x.type), have: best('pickaxe'), goal: state.toolGoal });
    let nt = ch.key ? { item: ch.key, ok: true, text: "作れる" } : ch.want ? { item: ch.want.key, ok: false, missing: ch.want.missing, text: `材料が足りない（${CR.missingText(ch.want.missing, ITEMS)}）` } : null;
    if (!nt) { // 次の段階に作業台が要る時
      const have = best("pickaxe"), nx = Object.entries(CC.recipes).find(([, r]) => r.tool === "pickaxe" && CR.tierRank(r.tier) === CR.tierRank(have) + 1);
      if (nx) nt = { item: nx[0], ok: false, text: `${B(CC.tiers[nx[1].tier].needs).name}がいる` };
    }
    state.nextTool = nt;
  }

  // ---- 8.5 コメントで参加した人にも少し経験値 ----
  const bonusXp = (users, amount, note) => {
    const seen = new Set();
    for (const u of users) {
      const v = P.findVillager(active, u);
      if (!v || seen.has(v.key) || !life[v.key]) continue;
      seen.add(v.key); life[v.key].xp += amount;
      if (note) life[v.key].diary[life[v.key].diary.length - 1].text += note;
    }
  };
  if (inbox && inbox.joinComments) bonusXp(inbox.joinComments.filter((c) => Date.parse(c.timestamp) >= Date.parse(jst(addDays(date, -1), 0))).map(P.commentUser), IC.xp.comment);
  if (closedVoters.length) bonusXp(closedVoters, IC.xp.vote, '投票に参加した。');

  // ---- レベルと枠 ----
  for (const v of active) {
    const L = life[v.key];
    const before = { level: L.level, slots: L.slots };
    L.level = I.levelFor(L.xp, IC);
    L.slots = I.slotCount(L.level, daysIn(v), IC);
    I.ensureSize(L.inv, L.slots);
    L.xpNext = I.xpForLevel(L.level + 1, IC); L.xpBase = I.xpForLevel(L.level, IC);
    const perDay = L.xp / Math.max(1, daysIn(v));
    L.locks = I.lockList(L.level, L.xp, daysIn(v), perDay, IC);
    const nx = L.locks[0];
    L.next = !nx ? '枠はぜんぶ開いた' : nx.type === 'level' ? `次の枠：Lv${nx.at} まであと ${I.xpForLevel(nx.at, IC) - L.xp} 経験値` : `次の枠：在籍 ${nx.at} 日まであと ${nx.at - daysIn(v)} 日`;
    const d = L.diary[L.diary.length - 1];
    if (L.level > before.level) d.text += `レベルが${L.level}になった。`;
    if (L.slots > before.slots) d.text += `持ち物の枠がふえた（${L.slots}枠）。`;
  }

  // ---- 9. 住む家 ----
  const homes = world.buildings.filter((b) => B(b.type).cap).flatMap((b) => Array(B(b.type).cap).fill(b.id));
  active.sort((a, b) => a.joinedDay - b.joinedDay).forEach((v, i) => { life[v.key].home = homes[i] || null; });

  // ---- 10. 誕生日（月日だけ） ----
  const md = date.slice(5);
  today.birthdays = active.filter((v) => v.birthday === md).map((v) => v.key);
  for (const k of today.birthdays) {
    const v = active.find((x) => x.key === k);
    hist('birthday', `今日は${v.display}の誕生日。町のみんなでささやかにお祝いした。`, { who: [k] });
    life[k].diary[life[k].diary.length - 1].text += '今日は誕生日。みんながお祝いしてくれた。';
  }

  // ---- 11. 関係と立ち話 ----
  const objAt = {};
  for (const arr of [world.trees, world.rocks, world.fields || [], world.bushes || [], world.buildings]) for (const o of arr) objAt[o.id] = o;
  const soc = SO.stepSocial(S.social, {
    day, R: RS, active, life, weather: state.weather, hist, birthdays: today.birthdays,
    posOf: (k) => objAt[life[k].target] || objAt[life[k].home] || null,
    homePos: (id) => (id && objAt[id]) || null,
    built: today.built.length ? B(world.buildings.find((b) => b.id === today.built[0]).type).name : '',
    queueNext: state.plan ? B(state.plan.build).name : '',
    vote: state.votes.find((v) => v.kind !== 'where') || null,
  });
  today.talks = soc.talks.length;
  for (const t of soc.talks) for (const k of [t.a, t.b]) {
    const other = active.find((x) => x.key === (k === t.a ? t.b : t.a));
    life[k].diary[life[k].diary.length - 1].text += `${other.display}と立ち話をした。`;
  }

  // ---- 12. 夜（敵が来る・見張りが追い払う）。別の乱数なので、ここまでの結果は変わらない ----
  state.night = config.enemies && config.enemies.enabled ? N.stepNight({ day, seed: state.seed, active, life, world, state, config, hist }) : null;
  syncRes();
  if (state.night) {
    state.nightLog = (state.nightLog || []).concat({ day, count: state.night.count, result: state.night.result, defense: state.night.defense }).slice(-60);
    today.night = { count: state.night.count, result: state.night.result };
  }

  for (const k in life) if (life[k].diary.length > 90) life[k].diary.splice(0, life[k].diary.length - 90);
  state.day = day; state.date = date; state.today = today; state.updated = new Date().toISOString();
}

// ---------- 実行 ----------
const days = Number(opt('--days', 1));
const config = read('config.json');
const S = {
  config, villagers: read('villagers.json', []), world: ST.readWorld(DATA), state: read('state.json'),
  life: ST.readLife(DATA), history: read('history.json', []), hidden: P.loadHidden(DATA),
  social: read('social.json', { pairs: {}, talks: [] }),
  priv: read('inbox/profiles_private.json', null),
};
S.demo = args.includes('--demo') || S.state.demo;
const inboxFile = opt('--inbox', path.join(DATA, 'inbox', 'instagram.json'));
S.inbox = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : null;
if (S.inbox && S.inbox.sample) S.inbox = null; // 見本ファイルは使わない
for (let i = 0; i < days; i++) { stepDay(S); if (i === 0 && S.inbox) S.inbox = { ...S.inbox, joinComments: null }; }
write('villagers.json', S.villagers);
ST.writeWorld(DATA, S.world, { clearR: ((S.config.terrain && S.config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
write('state.json', S.state);
ST.writeLife(DATA, S.life);
write('history.json', S.history);
write('social.json', S.social);
console.log(`${S.state.day} 日目まで進めました（村人 ${S.villagers.filter((v) => v.joinedDay <= S.state.day).length} 人・建物 ${S.world.buildings.length}・フォロワー ${S.state.followers}）`);
