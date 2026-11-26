'use strict';
// 新しく来た村人を「今の日」のまま町に迎える（日を進めない・時間も動かさない）。
// 15 分ごとの受付（tools/join.js）と、0 日目の待ち（sim.js --gate）で使う。
// sim.js も、ここの決まり（最初の道具・持ち物とレベルの枠・住む家・朝型夜型）を同じ関数で使う。
const I = require('./inventory');
const { hashStr } = require('./rand');
const HR = require('../js/hours.js');

const NE_DEFAULT = { max: 20, hungerBase: 4, hungerWork: 5, eat: 10, starve: 2, regenAt: 14, regen: 2, restBelow: 8, restHeal: 8, restHunger: 2 };
const jstToday = (now = new Date()) => new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const jstTime = (now = new Date()) => new Date(now.getTime() + 9 * 3600e3).toISOString().slice(11, 16); // "14:05"

function newLife() {
  return { job: null, target: null, home: null, gathered: { wood: 0, stone: 0, food: 0 }, built: [], contrib: { wood: 0, stone: 0, food: 0 }, diary: [] };
}

// 最初の道具：参加した時に選んだ木の道具を 1 つ持たせる（持ち物 3 つのうち 1 つ）。
// 選んでいない人は、それまでに選ばれた数がいちばん少ない仕事の道具（同じ数なら名前から決まる順）。乱数は使わない。
// 戻り値は日記に足す文（なければ ''）
function giveStartTool(L, v, { life, config }) {
  const ST = config.startTools || { options: [] };
  if (!ST.options.length) return '';
  const ITEMS = config.items, CC = config.crafting;
  const stOpts = ST.options.filter((o) => !o.needsEnemies || (config.enemies && config.enemies.enabled));
  const autoOpts = ST.options.filter((o) => !o.needsEnemies);
  const want = v.startTool && stOpts.find((o) => o.id === v.startTool);
  if (L.startTool && (!want || want.id === L.startTool)) return '';
  const dur = CC.tiers.wood.durability;
  if (L.startTool) { // プロフィールで道具を変えた（参加した日の間に 1 回だけ。確かめは profiles.js）か、コメントで仕事を変えた（tools/jobs.js）
    const old = ST.options.find((o) => o.id === L.startTool);
    const cur = old && I.getTool(L.inv, old.id);
    if (cur && I.toolTier(cur.item) === 'wood') I.removeTool(L.inv, old.id);
    const byJob = v.jobChangedTo === want.id; // コメントで仕事を変えた
    const has = byJob && !!I.getTool(L.inv, want.id); // 同じ種類の道具（石・鉄なども）をもう持っている
    if (has || I.addTool(L.inv, L.slots, want.item, dur)) {
      L.startTool = want.id; L.startAuto = false;
      return byJob ? (has ? '' : `仕事が${want.job}になったので、${ITEMS[want.item].name}を持った。`) : `最初の道具を${ITEMS[want.item].name}にかえた。`;
    }
    // 持ち物がいっぱいでも、コメントで変えた仕事は変える（道具はあとで作る）
    if (byJob) { L.startTool = want.id; L.startAuto = false; return `仕事が${want.job}になった（持ち物がいっぱいで、${ITEMS[want.item].name}は持てなかった）。`; }
    return '';
  }
  let pick = want;
  if (!pick) {
    const n = Object.fromEntries(autoOpts.map((o) => [o.id, 0]));
    for (const k in life) { const t = life[k] && life[k].startTool; if (t in n) n[t]++; }
    const h = hashStr('start:' + v.key);
    pick = autoOpts.map((o, i) => ({ o, n: n[o.id], r: (i + h) % autoOpts.length })).sort((a, b) => a.n - b.n || a.r - b.r)[0].o;
  }
  L.startTool = pick.id; L.startAuto = !want;
  if (!I.getTool(L.inv, pick.id)) I.addTool(L.inv, L.slots, pick.item, dur);
  return `${ITEMS[pick.item].name}を持ってきた。`;
}

// 体力・おなか・持ち物・レベルの枠をそろえて、最初の道具を持たせる。戻り値は日記に足す文
function ensureLife(L, v, { day, life, config }) {
  const NE = config.needs || NE_DEFAULT, IC = config.inventory;
  L.hp = L.hp ?? NE.max; L.hunger = L.hunger ?? NE.max;
  L.inv = L.inv || []; L.xp = L.xp || 0; L.trips = L.trips || 0; L.items = L.items || {}; L.debt = L.debt || 0;
  L.level = I.levelFor(L.xp, IC); L.slots = I.slotCount(L.level, day - v.joinedDay + 1, IC);
  I.ensureSize(L.inv, L.slots);
  // 前の形の道具（axe / pickaxe / hoe）は木の道具として読む
  for (const s of L.inv) if (s && (s.item === 'axe' || s.item === 'pickaxe' || s.item === 'hoe')) s.item = 'wood_' + s.item;
  return giveStartTool(L, v, { life, config });
}

// レベル・持ち物の枠・次の枠の案内（daysIn ＝ 住んだ日数）
function refreshLevel(L, daysIn, IC) {
  L.level = I.levelFor(L.xp, IC);
  L.slots = I.slotCount(L.level, daysIn, IC);
  I.ensureSize(L.inv, L.slots);
  L.xpNext = I.xpForLevel(L.level + 1, IC); L.xpBase = I.xpForLevel(L.level, IC);
  const perDay = L.xp / Math.max(1, daysIn);
  L.locks = I.lockList(L.level, L.xp, daysIn, perDay, IC);
  const nx = L.locks[0];
  L.next = !nx ? '枠はぜんぶ開いた' : nx.type === 'level' ? `次の枠：Lv${nx.at} まであと ${I.xpForLevel(nx.at, IC) - L.xp} 経験値` : `次の枠：在籍 ${nx.at} 日まであと ${nx.at - daysIn} 日`;
}

// 住む家：家のある建物の空きに、来た順に入る。なければ null（たき火のそばのテント）。active は来た順に並べかえる
function assignHomes(active, life, world, config) {
  const B = (t) => config.buildings[t];
  const homes = world.buildings.filter((b) => B(b.type).cap).flatMap((b) => Array(B(b.type).cap).fill(b.id));
  active.sort((a, b) => a.joinedDay - b.joinedDay).forEach((v, i) => { life[v.key].home = homes[i] || null; });
}

// 朝型・夜型（プロフィールで選べる。なければ名前から決まる）
function chronoOf(v, H) {
  const pc = (v.profile && v.profile.chrono) || (v._priv && v._priv.chrono);
  return ['朝型', '夜型'].includes(pc) ? pc : (hashStr('chrono:' + v.key) % 100) < (H.nightShare ?? 0.3) * 100 ? '夜型' : '朝型';
}

// 町のアカウントの持ち主（instagram.js の inbox.owner と config.joinExclude）。小文字の名前の一覧
function ownerNames(inbox, config) {
  return [inbox && inbox.owner, ...((config && config.joinExclude) || [])].filter(Boolean).map((s) => String(s).toLowerCase());
}
// 持ち主を村人から外す（life も消す）。外した人数を返す
function removeOwners(S, owners) {
  let n = 0;
  for (let i = S.villagers.length - 1; i >= 0; i--) {
    if (!owners.includes(String(S.villagers[i].name || '').toLowerCase())) continue;
    delete S.life[S.villagers[i].key]; S.villagers.splice(i, 1); n++;
  }
  return n;
}

// まだ町に来ていない村人を、今の日（state.day）のまま迎える。
//   S = { config, villagers, world, state, life, history, social }
//   ・life の入れ物・体力とおなか・持ち物の枠・最初の道具
//   ・その日の日記の 1 行目（「今日から村に住むことになった。よろしく。」）と、町の歴史の 1 行
//   ・住む家（なければテント）・その日の 24 時間の行動（起きている間は村を見て回る、夜は寝る）
//   ・1 日目より後なら、まだなければ町のチェストを置く（0 日目は 1 日目の朝に置く）
// 前の受付（次の朝に来る形）で joinedDay が「次の日」になっている人も、今の日に来たことにする。
// 戻り値 { added: [村人], worldChanged }
function welcomeNow(S, { now = new Date() } = {}) {
  const { config, villagers, world, state, life, history } = S;
  const day = state.day;
  const date = day >= 1 ? state.date : jstToday(now);
  const H = config.hours || {};
  const IC = config.inventory;
  const added = [];
  for (const v of villagers) {
    if (life[v.key]) continue;
    if (v.joinedDay === day + 1 && v.source === 'comment') { v.joinedDay = day; v.joined = date; } // 前の受付で「次の朝」にしていた人
    if (!(v.joinedDay <= day)) continue;
    added.push(v);
  }
  if (!added.length) return { added, worldChanged: false };
  const time = jstTime(now); // 島に来た時刻（日本時間の 時:分）
  for (const v of added) {
    if (!v.joinedAt) v.joinedAt = time;
    const L = life[v.key] = newLife();
    const note = ensureLife(L, v, { day, life, config });
    refreshLevel(L, day - v.joinedDay + 1, IC);
    L.chrono = chronoOf(v, H);
    // 今日の 24 時間：起きている間は村のまわりを見て回る（散歩）、夜は地面で寝る。次の朝からはふつうに働く
    L.hours = HR.encodeHours(Array.from({ length: 24 }, (_, h) => (H.night && HR.isNight(h, H) ? 'sg' : 'sp')));
    L.job = null; L.action = null; L.target = null; L.targets = [];
    L.held = L.inv.slice(0, L.slots).map((s) => (s ? { ...s } : null));
    while (L.held.length && L.held[L.held.length - 1] === null) L.held.pop();
    L.today = { got: {}, trips: 0, actions: 0 }; L.amount = 0;
    L.diary.push({ day, date, text: '今日から村に住むことになった。よろしく。' + note + (day === 0 ? 'まだ町は始まっていない。始まる日まで、島を見て回る。' : '') });
    if (S.social) { S.social.view = S.social.view || {}; if (!S.social.view[v.key]) S.social.view[v.key] = []; }
  }
  history.push({ day, date, time, type: 'join', text: added.map((v) => v.display).join('、') + ' が村に住むことになった。', who: added.map((v) => v.key) });
  let worldChanged = false;
  if (day >= 1 && world.chest && !world.chest.day) {
    world.chest.day = day; worldChanged = true;
    history.push({ day, date, type: 'event', text: '村のまん中にチェストを置いた。集めた物は、ここに入れる。' });
  }
  const active = villagers.filter((v) => v.joinedDay <= day && life[v.key]);
  assignHomes(active, life, world, config);
  return { added, worldChanged };
}

// ---------- 町を始める（0 日目 → 1 日目）の決まり ----------
// config.startAt：始める日時（日本時間）。"2026-11-28 06:00" や "2026-11-28T06:00:00+09:00"。null なら まだ決めていない
function parseStartAt(s) {
  if (!s) return null;
  let t = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += 'T06:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) t += ':00';
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) t += '+09:00';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}
// 今の実行で 1 日進めてよいか。gate なし（手で動かす・見本・テスト）はいつも進める。
// gate あり（daily.yml）：もう 1 日目より後なら進める。0 日目なら、start（Actions の「start」）か startAt を過ぎた時だけ
function shouldAdvance(state, config, { gate = false, start = false, now = new Date() } = {}) {
  if (!gate || state.day >= 1 || start) return true;
  const at = parseStartAt(config.startAt);
  return at != null && now.getTime() >= at;
}

module.exports = { newLife, giveStartTool, ensureLife, refreshLevel, assignHomes, chronoOf, ownerNames, removeOwners, welcomeNow, parseStartAt, shouldAdvance, jstToday };
