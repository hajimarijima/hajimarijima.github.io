'use strict';
// 村人の称号バッジ（config.titles）。村人の titles に称号の id を入れる。1 人 1 回だけで、なくならない。
// auto の種類（くわしくは config.json の titles.note）：
//   first … いちばん最初に島に住んだ 1 人だけ / nth … n 人目に住んだ 1 人だけ
//   allFish … 全部の種類の魚を、それぞれ n 匹以上釣った（L.fishedBy）
//   live: true の称号は、条件からはずれると外れる（大物ハンター＝いまの釣りランキング 1 位）
//   count … 村人の記録 stat の数が n に届いた（items.apple、items.fish_* のように * で終わると前が同じ物を全部足す）
//   days … 住んで n 日 / friends … 友だち・親友・家族が n 人 / fishRecord … 釣りランキングで島の 1 位
//   bridge … 橋づくりの係になった / home … 自分の家ができた
//   firstItem … 島ではじめて item を手に入れた 1 人だけ / referrals … 招待リンクから住んだ人が n 人（tools/referral.js）
//   gift: { 物: 数 } があると、称号といっしょにごほうびを持ち物に入れる
// おくった時は町の歴史と本人の日記に 1 回だけ書く。
// join.js（15 分ごとの受付）と sim.js（毎日）から呼ぶ。S = { config, villagers, life, history, state?, social? }
// state・social がない時（受付の時など）は、それを使う称号は飛ばす（次の日の sim でおくる）
const REF = require('./referral');
let INV = null;
let SO = null;
const social = () => SO || (SO = require('./social'));

// いちばん最初に住んだ人：住み始めた日 → 参加した日付 → villagers.json の並び（来た順）
function firstVillager(villagers, life, day) {
  const c = villagers.map((v, i) => ({ v, i })).filter(({ v }) => life[v.key] && v.joinedDay <= day);
  c.sort((a, b) => a.v.joinedDay - b.v.joinedDay || String(a.v.joined || '').localeCompare(String(b.v.joined || '')) || a.i - b.i);
  return c.length ? c[0].v : null;
}

// n 人目に住んだ人（firstVillager と同じ並び。町を出た人も数に入れる）
function nthVillager(villagers, life, day, n) {
  const c = villagers.map((v, i) => ({ v, i })).filter(({ v }) => life[v.key] && v.joinedDay <= day);
  c.sort((a, b) => a.v.joinedDay - b.v.joinedDay || String(a.v.joined || '').localeCompare(String(b.v.joined || '')) || a.i - b.i);
  return c.length >= n ? c[n - 1].v : null;
}

// 村人の記録の数。'items.apple' → L.items.apple。'items.fish_*' → fish_ で始まる物の合計。配列は数
function statCount(L, stat) {
  let v = L;
  const parts = String(stat || '').split('.');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (v == null) return 0;
    if (i === parts.length - 1 && p.endsWith('*')) {
      const pre = p.slice(0, -1);
      return Math.floor(Object.keys(v).filter((k) => k.startsWith(pre)).reduce((s, k) => s + (Number(v[k]) || 0), 0));
    }
    v = v[p];
  }
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') v = v.total;
  return Math.floor(Number(v) || 0);
}

// 友だち・親友・家族の数（social.json の pairs）
function friendCount(soc, key) {
  if (!soc || !soc.pairs) return 0;
  const SOC = social();
  let n = 0;
  for (const [pk, p] of Object.entries(soc.pairs)) {
    const [a, b] = pk.split('|');
    if (a !== key && b !== key) continue;
    const k = SOC.viewOf(p, key);
    if (k === 'friend' || k === 'best' || k === 'family') n++;
  }
  return n;
}

// 釣りランキング（state.fishing.top）で 1 位を持っている人の key
function fishLeaders(state) {
  const out = new Set();
  const top = state && state.fishing && state.fishing.top;
  if (top) for (const list of Object.values(top)) if (list && list[0]) out.add(list[0][1]);
  return out;
}

// 橋づくりの係になった人の key（state.expansion の crew）
function bridgeCrew(state) {
  const out = new Set();
  for (const ex of Object.values((state && state.expansion) || {})) for (const k of (ex && ex.crew) || []) out.add(k);
  return out;
}

// その村人が、いま称号 t の条件に届いているか。調べられない時（state がない等）は null
function meets(t, v, L, S, day, cache) {
  switch (t.auto) {
    case 'count': return statCount(L, t.stat) >= (t.n || 1);
    // 全部の種類の魚（config.items の fish_*）を、それぞれ n 匹以上釣った（釣り名人）
    case 'allFish': { const fs = Object.keys(S.config.items || {}).filter((k) => k.startsWith('fish_')); const by = L.fishedBy || {}; return fs.length > 0 && fs.every((k) => (by[k] || 0) >= (t.n || 1)); }
    case 'days': return day - (v.joinedDay || 0) >= (t.n || 1);
    case 'home': return !!L.home;
    case 'friends': return S.social ? friendCount(S.social, v.key) >= (t.n || 1) : null;
    case 'fishRecord': if (!S.state) return null; return (cache.fish || (cache.fish = fishLeaders(S.state))).has(v.key);
    case 'bridge': if (!S.state) return null; return (cache.bridge || (cache.bridge = bridgeCrew(S.state))).has(v.key);
    // 招待リンクから住んだ人が n 人（町を出た人は数えない。tools/referral.js）
    case 'referrals': return REF.referralCount(S.villagers, v.key) >= (t.n || 1);
    default: return null;
  }
}

// 島ではじめて item（diamond など）を手に入れた人。町の歴史の「見つけた」（type:'find'、出てきた順）でいちばん前の人。
// 歴史にない時（贈り物などで手に入れた）は、持っている人（L.items[item] が 1 以上）のうち先に住んだ人
function firstFinder(S, item, day) {
  if (!item) return null;
  const alive = (k) => S.villagers.find((v) => v.key === k && !v.left && S.life[k] && v.joinedDay <= day);
  for (const h of S.history || []) if (h.type === 'find' && h.item === item) for (const k of h.who || []) { const v = alive(k); if (v) return v; }
  const has = S.villagers.filter((v) => !v.left && S.life[v.key] && v.joinedDay <= day && statCount(S.life[v.key], 'items.' + item) >= 1);
  has.sort((a, b) => a.joinedDay - b.joinedDay || String(a.joined || '').localeCompare(String(b.joined || '')));
  return has[0] || null;
}

// 町の歴史は称号ごとに 1 行（同じ日に何人ももらった時は「A、B、C ほか 4 人」とまとめる）
function historyLine(S, t, vs, { day, date }) {
  if (!vs.length) return;
  const MAX = 5, nm = vs.slice(0, MAX).map((v) => v.display).join('、') + (vs.length > MAX ? ` ほか ${vs.length - MAX} 人` : '');
  S.history.push({ day, date, type: 'title', text: `${nm} に称号『${t.name}』がおくられた。`, who: vs.map((v) => v.key), title: t.id });
}

function give(S, v, t, { day, date }) {
  v.titles = [...(v.titles || []), t.id];
  const L = S.life[v.key];
  if (L) {
    let note = `称号「${t.name}」をもらった（${t.desc || ''}）。`;
    // ごほうび（t.gift = { 物: 数 }）：持ち物に入れる。入りきらない分は町のチェストへ
    if (t.gift && typeof t.gift === 'object') {
      const IC = (S.config && S.config.inventory) || {}, ITEMS = (S.config && S.config.items) || {};
      const got = [];
      for (const [it, n0] of Object.entries(t.gift)) {
        const n = Math.floor(Number(n0) || 0); if (n <= 0 || !ITEMS[it]) continue;
        let left = n;
        if (Array.isArray(L.inv)) { INV = INV || require('./inventory'); left = INV.addItem(L.inv, L.slots || IC.base || 3, it, n, IC.stack); }
        const ch = S.state && S.state.chest;
        if (left > 0 && ch && ch.items && typeof ch.items === 'object' && !Array.isArray(ch.items)) ch.items[it] = (ch.items[it] || 0) + left;
        got.push(`${ITEMS[it].name || it} ${n} こ`);
      }
      if (got.length) note += `ごほうびに ${got.join('・')} をもらった。`;
    }
    L.diary = L.diary || [];
    const d = L.diary[L.diary.length - 1];
    if (d && d.day === day) d.text += note; else L.diary.push({ day, date, text: note });
  }
}

// 自動の称号をおくる。おくった { v, title } の一覧を返す
function awardTitles(S, { day, date }) {
  const list = (S.config.titles && S.config.titles.list) || [];
  const out = [];
  const cache = {};
  for (const t of list) {
    if (!t || !t.id || !t.auto) continue;
    if (t.auto === 'first' || t.auto === 'nth' || t.auto === 'firstItem') {
      if (S.villagers.some((v) => (v.titles || []).includes(t.id))) continue; // もうだれかが持っている（1 人だけ）
      if ((S.history || []).some((h) => h.type === 'title' && h.title === t.id)) continue; // 前におくった（持っていた人が町を出ても、ほかの人にはおくらない）
      const v = t.auto === 'first' ? firstVillager(S.villagers, S.life, day) : t.auto === 'firstItem' ? firstFinder(S, t.item, day) : nthVillager(S.villagers, S.life, day, t.n || 100);
      if (!v) continue;
      give(S, v, t, { day, date });
      historyLine(S, t, [v], { day, date });
      out.push({ v, title: t });
      continue;
    }
    const now = [];
    for (const v of S.villagers) {
      const L = S.life[v.key];
      if (!L || v.joinedDay > day || v.left) continue;
      // live の称号（大物ハンター＝いまの 1 位）は、条件からはずれたら外す（調べられない時はそのまま）
      if (t.live && (v.titles || []).includes(t.id)) { if (meets(t, v, L, S, day, cache) === false) v.titles = v.titles.filter((x) => x !== t.id); continue; }
      if ((v.titles || []).includes(t.id)) continue; // 1 人 1 回だけ
      if (meets(t, v, L, S, day, cache) !== true) continue;
      // live の称号を取りもどした時は、町の歴史・日記に書かない（前にもらったことがある人）
      if (t.live && (S.history || []).some((h) => h.type === 'title' && h.title === t.id && (h.who || []).includes(v.key))) { v.titles = [...(v.titles || []), t.id]; continue; }
      give(S, v, t, { day, date });
      now.push(v);
      out.push({ v, title: t });
    }
    historyLine(S, t, now, { day, date });
  }
  return out;
}

module.exports = { firstVillager, nthVillager, awardTitles, statCount, friendCount, fishLeaders, bridgeCrew };
