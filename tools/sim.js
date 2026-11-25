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

function stepDay(S) {
  const { config, villagers, world, state, life, history, inbox, demo, hidden } = S;
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

  // ---- 1. 参加の登録（「参加したい」コメント） ----
  if (inbox && inbox.joinComments) {
    for (const r of P.registrationsFrom(inbox.joinComments, config.joinWord)) {
      const v = P.upsertVillager(villagers, { igId: r.igId, username: r.username, joined: date, joinedDay: day, source: 'comment' }, hidden);
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
        if ((h >> 11) % 4 === 0) pf.wantJob = ['伐採', '採掘', '農業', '建築'][(h >> 13) % 4];
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

  // ---- 3. 投票 ----
  const diaryExtra = {}; // key -> 文
  let closedVoters = null;
  const genDemo = (vote) => { // 見本の投票コメントを作る（締め切り後のコメントも混ぜて、数えないことを確かめる）
    vote.demoComments = vote.demoComments || [];
    const bias = vote.demoBias || (vote.demoBias = [R.range(0.6, 1.4), R.range(0.6, 1.4), R.range(0.6, 1.4)]);
    const base = Date.parse(vote.opensAt) + (day - vote.openedDay) * 24 * 3600e3;
    const n = R.int(4, 9);
    for (let i = 0; i < n + (day === vote.closesDay - 1 ? 2 : 0); i++) {
      const named = active.filter((x) => x.name);
      const who = named.length && R.chance(0.45) ? R.pick(named).name : 'voter_' + R.int(1, 40);
      const ch = R.weighted([['A', bias[0]], ['B', bias[1]], ['C', bias[2]]]);
      const word = R.pick([ch, ch.toLowerCase(), String.fromCharCode(0xFF21 + ch.charCodeAt(0) - 65), ch + 'がいい', ch + '案で!', '断然' + ch]);
      const late = i >= n; // 締め切りのあとに来たコメント
      const t = late ? Date.parse(vote.closesAt) + R.range(60e3, 6 * 3600e3) : Math.min(base + R.range(0, 24 * 3600e3), Date.parse(vote.closesAt) - 60e3);
      vote.demoComments.push({ id: 'd' + day + '_' + i, text: word, timestamp: new Date(t).toISOString(), from: { id: 'demo-' + who, username: who } });
    }
  };
  const retally = (vote) => {
    const comments = (inbox && inbox.voteComments) || vote.demoComments || [];
    const tally = P.tallyVote(comments, { opensAt: vote.opensAt, closesAt: vote.closesAt });
    const manual = vote.manual || { A: 0, B: 0, C: 0 }; // 手で書いた票（data/state.json の vote.manual）
    vote.counted = tally.votes;
    vote.votes = { A: tally.votes.A + (manual.A || 0), B: tally.votes.B + (manual.B || 0), C: tally.votes.C + (manual.C || 0) };
    vote.voters = tally.voters + (manual.A || 0) + (manual.B || 0) + (manual.C || 0);
    vote.timeline = tally.timeline;
    vote.commentCount = tally.comments;
    return tally;
  };
  if (state.vote && day >= state.vote.closesDay) {
    const vote = state.vote;
    closedVoters = retally(vote).who;
    const max = Math.max(vote.votes.A, vote.votes.B, vote.votes.C);
    const tops = ['A', 'B', 'C'].filter((k) => vote.votes[k] === max);
    const win = tops.length === 1 ? tops[0] : R.pick(tops);
    const ms = config.milestones.find((m) => m.at === vote.milestone);
    const opt = ms.options.find((o) => o.key === win);
    const total = vote.votes.A + vote.votes.B + vote.votes.C;
    const result = {
      milestone: vote.milestone, key: win, build: opt.build, name: B(opt.build).name, day,
      votes: vote.votes, voters: vote.voters, tie: tops.length > 1,
      pct: Object.fromEntries(['A', 'B', 'C'].map((k) => [k, total ? Math.round((vote.votes[k] / total) * 1000) / 10 : 0])),
      options: vote.options, opensAt: vote.opensAt, closesAt: vote.closesAt, timeline: vote.timeline,
    };
    state.decisions.push(result);
    state.queue.unshift(opt.build);
    (opt.unlocks || []).forEach((u, i) => state.queue.splice(Math.min(state.queue.length, 2 + i * 2), 0, u));
    hist('vote_result', `フォロワー ${vote.milestone} 人の投票で「${win} ${B(opt.build).name}」に決まった（A ${vote.votes.A} 票・B ${vote.votes.B} 票・C ${vote.votes.C} 票、${vote.voters} 人が投票${tops.length > 1 ? '、同点のためくじ引き' : ''}）。`, { milestone: vote.milestone, key: win, votes: vote.votes, voters: vote.voters });
    for (const v of active) diaryExtra[v.key] = `投票で${B(opt.build).name}を建てることに決まった。楽しみだ。`;
    state.vote = null;
  }
  const nextMs = config.milestones.find((m) => !state.reached.includes(m.at));
  if (!state.vote && nextMs && state.followers >= nextMs.at) {
    state.reached.push(nextMs.at);
    state.vote = {
      milestone: nextMs.at, openedDay: day, closesDay: day + config.voteDays,
      opensAt: jst(date, 9), closesAt: jst(addDays(date, config.voteDays), 0),
      options: nextMs.options.map((o) => ({ key: o.key, build: o.build, name: B(o.build).name, desc: o.desc })),
      votes: { A: 0, B: 0, C: 0 }, manual: { A: 0, B: 0, C: 0 }, voters: 0, timeline: [],
    };
    hist('vote_open', `フォロワーが ${nextMs.at} 人に届いた。「次に何を作る？」の投票が始まった（${state.vote.options.map((o) => o.key + ' ' + o.name).join(' / ')}）。`, { milestone: nextMs.at });
  }
  if (state.vote) { if (demo && !(inbox && inbox.voteComments)) genDemo(state.vote); retally(state.vote); }

  // ---- 4. 天気 ----
  state.weather = R.weighted([['晴れ', 55], ['くもり', 25], ['雨', 20]]);
  const rain = state.weather === '雨';

  // ---- 5. 仕事を決める ----
  const built = world.buildings.map((b) => b.type);
  const has = (t) => built.includes(t);
  const mult = { wood: 1 + state.bonus.wood, stone: 1 + state.bonus.stone, food: 1 + state.bonus.food };
  for (const t of built) { const bo = B(t).bonus; if (bo) for (const r of RES) mult[r] += bo[r] || 0; }
  // 次の建物に足りない分を見て、仕事の重みを決める
  while (state.queue.length && B(state.queue[0]).unique && has(state.queue[0])) state.queue.shift();
  if (!state.queue.length) state.queue.push(config.repeat[state.repeatIdx++ % config.repeat.length]);
  const next = state.queue[0];
  const cost = B(next).cost;
  const IC = config.inventory;
  const ITEMS = config.items;
  if (!state.res) state.res = { ...state.resources };
  if (!state.store) state.store = {};
  const syncRes = () => { for (const r of RES) state.resources[r] = Math.max(0, Math.floor(state.res[r] + 1e-9)); };
  const valueOf = (items) => { const v = { wood: 0, stone: 0, food: 0 }; for (const [it, n] of Object.entries(items)) { const val = (ITEMS[it] && ITEMS[it].value) || {}; for (const r of RES) v[r] += (val[r] || 0) * n; } return v; };
  const deposit = (items) => { for (const [it, n] of Object.entries(items)) state.store[it] = (state.store[it] || 0) + n; const v = valueOf(items); for (const r of RES) { state.res[r] += v[r]; state.totals[r] = Math.round((state.totals[r] + v[r]) * 100) / 100; } syncRes(); return v; };
  const need = {};
  for (const r of RES) need[r] = Math.max(0, (cost[r] || 0) - state.resources[r]);
  need.food += Math.max(0, active.length * 4 - state.resources.food);
  const takenTrees = new Set(), takenFields = new Set(), takenBushes = new Set();
  const center = world.campfire;

  // 石が少なくなったら新しい岩場が見つかる
  if (world.rocks.filter((r) => r.hp > 0 && !r.far).length < 4) { // 町の外の岩場（far）は数えない
    for (let k = 0; k < 3; k++) {
      const x = R.range(20, 46), z = R.range(-50, -22);
      if (world.rocks.some((r) => Math.hypot(r.x - x, r.z - z) < 3.4)) continue;
      const max = R.int(8, 12);
      const rk = { id: 'r' + world.rocks.length, x: +x.toFixed(2), z: +z.toFixed(2), hp: max, max, kind: R.int(0, 2) };
      O.ensureBlocks(state.seed, rk, config.ores); world.rocks.push(rk);
    }
    hist('event', '北東で新しい岩場が見つかった。');
  }

  const daysIn = (v) => day - v.joinedDay + 1;
  const ensureLife = (L, v) => {
    L.inv = L.inv || []; L.xp = L.xp || 0; L.trips = L.trips || 0; L.items = L.items || {}; L.debt = L.debt || 0;
    L.level = I.levelFor(L.xp, IC); L.slots = I.slotCount(L.level, daysIn(v), IC);
    I.ensureSize(L.inv, L.slots);
  };
  const haulText = (got) => Object.entries(got).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([it, n]) => `${ITEMS[it].name}${n}`).join('・');

  const today = { weather: state.weather, jobs: { wood: 0, stone: 0, food: 0 }, gained: { wood: 0, stone: 0, food: 0 }, built: [], trips: 0 };
  for (const v of active) {
    const L = life[v.key];
    ensureLife(L, v);
    // 夜の見張りでケガをした人は、この日だけ休む（乱数は使わないので、ほかの人の結果の流れはそのまま）
    if (L.hurt && L.hurt >= day) {
      L.job = 'rest'; L.action = 'rest'; L.target = null; L.amount = 0; L.today = { got: {}, trips: 0, actions: 0 };
      L.diary.push({ day, date, text: (v.joinedDay === day ? '' : 'ゆうべのケガで、今日は家で休んだ。') + (diaryExtra[v.key] || '') });
      continue;
    }
    const pref = RES[(P.userHash(v.key).charCodeAt(0)) % 3];
    // プロフィールの「やりたい仕事」を少し優先する（建築は今いちばん足りない材料へ。商いはまだ店がないので影響なし）
    const want = (v.profile && v.profile.wantJob) || (v._priv && v._priv.wantJob);
    const wantRes = { '伐採': 'wood', '採掘': 'stone', '農業': 'food' }[want] || (want === '建築' ? RES.slice().sort((a, b) => need[b] - need[a])[0] : null);
    const w = RES.map((r) => [r, (1 + need[r] / 8) * (r === pref ? 1.6 : 1) * (r === wantRes ? 2.2 : 1)]);
    let job = R.weighted(w);
    let target = null, action = null, place = '', mined = null;
    const tryWood = () => {
      const cand = world.trees.filter((t) => t.state === 'tree' && !takenTrees.has(t.id)).sort((a, b) => dist(a, center) - dist(b, center)).slice(0, 8);
      if (!cand.length) return false;
      const t = R.pick(cand); takenTrees.add(t.id);
      t.state = 'stump'; t.regrow = R.int(5, 8); t.cutDay = day;
      target = t.id; action = 'chop'; place = area(t);
      return true;
    };
    const tryStone = () => {
      const cand = world.rocks.filter((r) => r.hp > 0).sort((a, b) => dist(a, center) - dist(b, center)).slice(0, 4);
      if (!cand.length) return false;
      const r = R.pick(cand);
      O.ensureBlocks(state.seed, r, config.ores);
      mined = r.blocks[r.max - r.hp] || 's'; // 今日掘るブロック（上から順）
      r.hp -= 1;
      target = r.id; action = r.hp === 0 ? 'dig_last' : 'dig'; place = area(r);
      return true;
    };
    const tryFood = () => {
      const maxFields = Math.min(world.fieldSlots.length, has('hut') ? 2 + 2 * built.filter((t) => t === 'house').length : 0);
      const ripe = world.fields.filter((f) => f.stage >= 3 && !takenFields.has(f.id));
      if (ripe.length) { const f = R.pick(ripe); takenFields.add(f.id); f.stage = 0; target = f.id; action = 'harvest'; return true; }
      if (world.fields.length < maxFields && R.chance(0.5)) {
        const slot = world.fieldSlots[world.fields.length];
        const f = { id: 'f' + world.fields.length, x: slot.x, z: slot.z, stage: 0, day };
        world.fields.push(f); takenFields.add(f.id); target = f.id; action = 'till'; return true;
      }
      const bush = world.bushes.filter((b) => b.ready && !takenBushes.has(b.id));
      if (bush.length && R.chance(0.6)) { const b = R.pick(bush); takenBushes.add(b.id); b.ready = false; b.regrow = 3; target = b.id; action = 'berry'; return true; }
      const grow = world.fields.filter((f) => !takenFields.has(f.id));
      if (grow.length) { const f = R.pick(grow); takenFields.add(f.id); f.stage = Math.min(3, f.stage + 1); target = f.id; action = 'tend'; return true; }
      if (bush.length) { const b = R.pick(bush); takenBushes.add(b.id); b.ready = false; b.regrow = 3; target = b.id; action = 'berry'; return true; }
      target = null; action = 'forage'; return true; // 野原で草を摘む
    };
    const order = { wood: [tryWood, tryStone, tryFood], stone: [tryStone, tryWood, tryFood], food: [tryFood] }[job];
    for (const f of order) if (f()) break;
    job = { chop: 'wood', dig: 'stone', dig_last: 'stone' }[action] || 'food';
    const notes = [];

    // 道具（1 枠使う）。なければ村の材料で作ってもらう。材料もなければ素手（とれる量が半分）
    const tool = { chop: 'axe', dig: 'pickaxe', dig_last: 'pickaxe', till: 'hoe', tend: 'hoe', harvest: 'hoe' }[action] || null;
    let budget = IC.actionsPerDay - L.debt; L.debt = 0;
    let trips = 0;
    const onUnload = (items) => { const val = deposit(items); for (const r of RES) L.contrib[r] += val[r]; trips++; };
    if (tool && !I.hasTool(L.inv, tool)) {
      const tc = IC.toolCost;
      if (state.res.wood >= tc.wood && state.res.stone >= tc.stone) {
        if (!L.inv.slice(0, L.slots).some((s) => !s)) { onUnload(I.unload(L.inv)); budget -= IC.tripCost; }
        if (I.addTool(L.inv, L.slots, tool, IC.toolDurability)) {
          state.res.wood -= tc.wood; state.res.stone -= tc.stone; syncRes();
          notes.push(`新しい${ITEMS[tool].name}を作った。`);
        }
      }
    }
    let hand = tool && !I.hasTool(L.inv, tool) ? 0.5 : 1;
    let broke = false;
    const q = (a, b, m) => Math.max(0, Math.round(R.int(a, b) * m * hand));
    const produce = () => {
      if (tool && hand === 1 && I.useTool(L.inv, tool)) { broke = true; hand = 0.5; }
      if (job === 'wood') return [['log', q(2, 4, mult.wood)], ['apple', R.chance(0.12) ? 1 : 0], ['sapling', R.chance(0.1) ? 1 : 0]];
      if (job === 'stone') { R.chance(0.2) && R.int(1, 2); R.chance(0.08); return [['cobble', q(2, 4, mult.stone)]]; } // 鉱石は岩のブロックから（乱数の流れは前と同じにしておく）
      if (action === 'harvest') return [['wheat', q(2, 4, mult.food)], ['seeds', R.int(0, 2)]];
      if (action === 'berry') return [['berry', q(1, 3, mult.food)], ['flower_r', R.chance(0.08) ? 1 : 0]];
      if (action === 'till' || action === 'tend') return [['wheat', R.chance(0.35) ? q(1, 2, mult.food) : 0], ['seeds', R.int(0, 1)]];
      return [['berry', q(1, 2, mult.food)], [R.chance(0.5) ? 'flower_r' : 'flower_y', R.chance(0.25) ? 1 : 0], ['seeds', R.int(0, 1)]];
    };
    const res = I.workDay({ inv: L.inv, slots: L.slots, budget, produce, onUnload, cfg: IC });
    // 掘ったブロックが鉱石なら、その鉱石が 1 つ手に入る（めずらしい物は履歴に残す）
    const oreItem = job === 'stone' && mined && O.ORE_ITEM[mined];
    if (oreItem) {
      res.got[oreItem] = (res.got[oreItem] || 0) + 1;
      const val = deposit({ [oreItem]: 1 }); for (const r of RES) L.contrib[r] += val[r];
      if (O.RARE.has(mined)) { hist('find', `${v.display}が${ITEMS[oreItem].name}を見つけた。`, { who: [v.key], item: oreItem, rock: target }); notes.push(`岩の中から${ITEMS[oreItem].name}が出てきた。`); }
    }
    L.mined = mined;
    if (broke) notes.push(`${ITEMS[tool].name}がこわれた。`);
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
    const T = {
      chop: [`${place}木を切った。${haul}。`, `朝から斧をふって、${place}木を1本たおした。${haul}。`, `切り株がまたひとつ。${haul}。`],
      dig: [`${place}岩場で掘った。${haul}。`, `つるはしで岩をくだいた。${haul}。`, `岩がだいぶ小さくなってきた。${haul}。`],
      dig_last: [`掘っていた岩がなくなって、石切り場の跡になった。${haul}。`],
      berry: [`草むらで木の実を集めた。${haul}。`, `赤い実をかごいっぱいにつんだ。${haul}。`],
      till: [`新しい畑を耕した。${haul}。`, `くわで土を起こして、畑をひとつ作った。${haul}。`],
      tend: [`畑の世話をした。芽がのびてきた。${haul}。`, `畑に水をまいた。${haul}。`],
      harvest: [`畑で収穫した。${haul}。`, `畑の作物をかりとった。${haul}。`],
      forage: [`野原で草や実を集めた。${haul}。`],
    }[action];
    let text = R.pick(T);
    if (rain && R.chance(0.6)) text = '雨の中、' + text;
    else if (state.weather === '晴れ' && R.chance(0.25)) text = 'いい天気。' + text;
    if (v.joinedDay === day) text = '今日から村に住むことになった。よろしく。' + text;
    text += notes.join('');
    if (trips) text += `持ち物がいっぱいになって、倉庫まで${trips}回往復した。`;
    if (diaryExtra[v.key]) text += diaryExtra[v.key];
    L.diary.push({ day, date, text });
  }

  // ---- 6. 食べる（倉庫の食べ物、足りなければ自分の持ち物から） ----
  state.res.food -= active.length;
  if (state.res.food < 0) {
    let short = -state.res.food;
    state.res.food = 0;
    const FOOD = ['apple', 'berry', 'wheat'];
    for (const v of active) {
      if (short <= 0) break;
      const inv = life[v.key].inv;
      for (let i = 0; i < inv.length && short > 0; i++) {
        const s = inv[i];
        if (s && FOOD.includes(s.item)) { const per = ITEMS[s.item].value.food; const k = Math.min(s.n, Math.ceil(short / per)); s.n -= k; short -= k * per; if (s.n <= 0) inv[i] = null; }
      }
    }
    if (short > 0) {
      for (const v of active) life[v.key].diary[life[v.key].diary.length - 1].text += '食べ物が足りなくて、おなかがすいた。';
      hist('event', '食べ物が足りなくなった。みんなおなかをすかせている。');
    }
  }
  syncRes();

  // ---- 7. 生える・育つ ----
  for (const t of world.trees) {
    if (t.state === 'stump' || t.state === 'sapling') {
      if (t.cutDay === day) continue;
      t.regrow -= 1;
      t.state = t.regrow <= 0 ? 'tree' : t.regrow <= 2 ? 'sapling' : 'stump';
    }
  }
  for (const b of world.bushes) if (!b.ready) { b.regrow -= 1; if (b.regrow <= 0) b.ready = true; }
  if (rain) for (const f of world.fields) if (!takenFields.has(f.id)) f.stage = Math.min(3, f.stage + 1);

  // ---- 8. 建てる（1 日 1 つまで） ----
  // 倉庫だけで足りなければ、材料を持っている人が持ち寄る（その人は明日の仕事が往復ぶん減る）
  const lacking = () => RES.filter((r) => state.resources[r] < (cost[r] || 0));
  if (lacking().length) {
    const pooled = { wood: state.res.wood, stone: state.res.stone, food: state.res.food };
    const carriers = active.map((v) => ({ v, val: valueOf(Object.fromEntries(life[v.key].inv.filter((s) => s && !I.isTool(s)).map((s) => [s.item, s.n]))) }));
    for (const c of carriers) for (const r of RES) pooled[r] += c.val[r];
    if (RES.every((r) => Math.floor(pooled[r] + 1e-9) >= (cost[r] || 0))) {
      carriers.sort((a, b) => RES.reduce((s, r) => s + (lacking().includes(r) ? b.val[r] - a.val[r] : 0), 0));
      for (const c of carriers) {
        const lk = lacking();
        if (!lk.length) break;
        if (!lk.some((r) => c.val[r] > 0)) continue;
        const L = life[c.v.key];
        const val = deposit(I.unload(L.inv));
        for (const r of RES) L.contrib[r] += val[r];
        L.trips++; today.trips++; L.debt += IC.tripCost; L.xp += IC.xp.carry;
        L.diary[L.diary.length - 1].text += '建てる材料を倉庫へ運んだ。';
      }
    }
  }
  if (!lacking().length) {
    for (const r of RES) state.res[r] -= cost[r] || 0;
    syncRes();
    const def = B(next);
    let pos;
    if (def.plot === 'ring') pos = { x: 0, z: -1, plot: 'ring' }; // 町をぐるりと囲むもの（柵・石壁・街灯）
    else if (def.plot && world.special[def.plot]) pos = world.special[def.plot];
    else {
      const used = new Set(world.buildings.map((b) => b.plot));
      const idx = world.plots.findIndex((p, i) => !used.has(i));
      pos = { ...world.plots[idx], plot: idx };
    }
    const id = next + '_' + world.buildings.length;
    const builders = active.filter((v) => RES.some((r) => (cost[r] || 0) > 0 && life[v.key].contrib[r] > 0)).map((v) => v.key);
    const b = { id, type: next, x: pos.x, z: pos.z, plot: pos.plot ?? def.plot, rot: +Math.atan2(-pos.x, -(pos.z + 1)).toFixed(3), day, builders, variant: R.int(0, 3) };
    if (def.plot === 'coast' || def.plot === 'coast2' || def.plot === 'coast3') b.rot = Math.PI;
    world.buildings.push(b);
    for (const k of builders) { life[k].built.push(id); life[k].xp += IC.xp.build; for (const r of RES) life[k].contrib[r] = 0; life[k].diary[life[k].diary.length - 1].text += `${def.name}ができた。自分の運んだ材料も使われている。`; }
    state.queue.shift();
    today.built.push(id);
    hist('build', `${def.name}が建った。${builders.length} 人が材料を集めた。`, { building: id, buildingType: next });
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
  if (closedVoters) bonusXp(closedVoters, IC.xp.vote, '投票に参加した。');

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
    queueNext: state.queue[0] ? B(state.queue[0]).name : '',
    vote: state.vote,
  });
  today.talks = soc.talks.length;
  for (const t of soc.talks) for (const k of [t.a, t.b]) {
    const other = active.find((x) => x.key === (k === t.a ? t.b : t.a));
    life[k].diary[life[k].diary.length - 1].text += `${other.display}と立ち話をした。`;
  }

  // ---- 12. 夜（敵が来る・見張りが追い払う）。別の乱数なので、ここまでの結果は変わらない ----
  state.night = N.stepNight({ day, seed: state.seed, active, life, world, state, config, hist });
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
  config, villagers: read('villagers.json', []), world: read('world.json'), state: read('state.json'),
  life: read('life.json', {}), history: read('history.json', []), hidden: P.loadHidden(DATA),
  social: read('social.json', { pairs: {}, talks: [] }),
  priv: read('inbox/profiles_private.json', null),
};
S.demo = args.includes('--demo') || S.state.demo;
const inboxFile = opt('--inbox', path.join(DATA, 'inbox', 'instagram.json'));
S.inbox = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : null;
if (S.inbox && S.inbox.sample) S.inbox = null; // 見本ファイルは使わない
for (let i = 0; i < days; i++) { stepDay(S); if (i === 0 && S.inbox) S.inbox = { ...S.inbox, joinComments: null }; }
write('villagers.json', S.villagers);
write('world.json', S.world);
write('state.json', S.state);
write('life.json', S.life);
write('history.json', S.history);
write('social.json', S.social);
console.log(`${S.state.day} 日目まで進めました（村人 ${S.villagers.filter((v) => v.joinedDay <= S.state.day).length} 人・建物 ${S.world.buildings.length}・フォロワー ${S.state.followers}）`);
