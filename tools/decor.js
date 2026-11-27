'use strict';
// 家を飾る（毎日の更新の中。tools/sim.js から呼ぶ）。決まりは js/decor.js（サイトと共通）。
//   ・島での活動で飾りを手に入れる：遊びのページの釣り・おてつだい・宝探し（data/inbox/play.json の days）、島の行事（今日の年表）、手紙のお礼（tools/mail.js）
//   ・web で置いた並べ方（play.json の decor。受け口の Worker の /me/decor）を、持っている数・家のマスで確かめて data/decor.json に入れる
//   data/decor.json：{ 村人: { own: { 飾り: 数 }, out: [[飾り, i, j, 向き]], in: [...], got: [[日, 飾り, わけ]], earned: ['日付:わけ'], at } }
const DC = require('../js/decor.js');
const { hashStr } = require('./rand');

const chance = (seed) => (hashStr(seed) % 10000) / 10000;
const lookOf = (config, life, world, key) => {
  const L = life && life[key], b = L && L.home && world && (world.buildings || []).find((x) => x.id === L.home);
  const def = b && config.buildings && config.buildings[b.type];
  if (def && def.look && def.look.kind === 'house') return def.look;
  return (config.buildings && config.buildings.house && config.buildings.house.look) || { w: 4, d: 3.4 };
};
const entry = (decor, k) => (decor[k] = decor[k] || { own: {}, out: [], in: [], got: [], earned: [] });

// 1 つ手に入れる（同じわけ・同じ日には 1 回。持てる数は maxOwn まで）。手に入れた飾りか null
function earn(S, k, why, day, onceKey, { item = null, diary = true } = {}) {
  if (!DC.decorOn(S.config)) return null; // 家を飾るが「近日公開」の間は手に入れない（お礼の手紙の飾りも）
  const C = DC.decorCfg(S.config), E = entry(S.decor, k);
  if (onceKey && E.earned.includes(onceKey)) return null;
  const pool = DC.poolOf(why === 'gift' ? 'thanks' : why).filter((id) => (E.own[id] || 0) < C.maxOwn);
  const id = item && DC.isDecor(item) ? item : pool.length ? pool[hashStr(`${k}:${onceKey || day}:${why}`) % pool.length] : null;
  if (!id || (E.own[id] || 0) >= C.maxOwn) return null;
  E.own[id] = (E.own[id] || 0) + 1;
  E.got.push([day, id, why]); if (E.got.length > C.keepGot) E.got.splice(0, E.got.length - C.keepGot);
  if (onceKey) { E.earned.push(onceKey); if (E.earned.length > 60) E.earned.splice(0, E.earned.length - 60); }
  const L = S.life[k], d = L && L.diary && L.diary[L.diary.length - 1];
  if (diary && d && d.day === day) d.text += `${DC.EARN[why] || ''}で飾りの「${DC.DECOR[id].name}」を手に入れた。`;
  return id;
}

// 飾りを人にあげる（手紙に添えた時）。あげられたら true
function give(S, from, to, id, day) {
  if (!DC.decorOn(S.config)) return false;
  const A = entry(S.decor, from);
  if (!DC.isDecor(id) || DC.leftOf(A.own, A.out, A.in, id) <= 0) return false;
  A.own[id]--; if (!A.own[id]) delete A.own[id];
  return !!earn(S, to, 'gift', day, null, { item: id, diary: false });
}

// 毎日の分。play：data/inbox/play.json（なければ null）
function stepDecor(S, { day, play }) {
  S.decor = S.decor || {};
  if (!DC.decorOn(S.config)) return; // 「近日公開」の間は何もしない（data/decor.json はそのまま残す。true にすれば続きから）
  const C = DC.decorCfg(S.config), active = new Set(S.villagers.filter((v) => v.joinedDay <= day).map((v) => v.key));
  // 遊びのページの釣り・おてつだい・宝探し（何日分か来るので、日付とわけで 1 回だけ）
  for (const [date, m] of Object.entries((play && play.days) || {})) {
    for (const [k, r] of Object.entries(m || {})) {
      if (!active.has(k) || !r) continue;
      if ((r.catches || []).length && chance(`fish:${k}:${date}`) < C.fishP) earn(S, k, 'fish', day, date + ':fish');
      if ((r.chores || 0) >= C.choreMin && chance(`chore:${k}:${date}`) < C.choreP) earn(S, k, 'chore', day, date + ':chore');
      if (r.treasure) earn(S, k, 'treasure', day, date + ':treasure');
    }
  }
  // 島の行事（js/islandevents.js。今日の年表の kind 'festival'・event の印がある行）：名前の出た人、だれも出ていなければ今日いる人みんな
  const evs = (S.history || []).filter((h) => h.day === day && (h.kind === 'festival' || (h.event && typeof h.event === 'string')));
  for (const h of evs) {
    const who = Array.isArray(h.who) && h.who.length ? h.who : [...active];
    for (const k of who) if (active.has(k)) earn(S, k, 'event', day, `${S.state.date || day}:event`);
  }
  // web で置いた並べ方（新しい方だけ）
  for (const [k, lay] of Object.entries((play && play.decor) || {})) {
    if (!S.life[k] || !lay) continue;
    const E = entry(S.decor, k);
    if (E.at && lay.at && String(lay.at) <= String(E.at)) continue;
    const look = lookOf(S.config, S.life, S.world, k);
    E.out = DC.cleanLayout('out', lay.out, look, E.own);
    E.in = DC.cleanLayout('in', lay.in, look, E.own);
    E.at = lay.at || null;
  }
  // 持っている数より多く置いてある物は外す（あげた時など）
  for (const k of Object.keys(S.decor)) {
    if (!S.life[k]) { delete S.decor[k]; continue; }
    const E = S.decor[k], look = lookOf(S.config, S.life, S.world, k);
    E.out = DC.cleanLayout('out', E.out, look, E.own);
    E.in = DC.cleanLayout('in', E.in, look, E.own);
  }
}

module.exports = { stepDecor, earn, give, lookOf };
