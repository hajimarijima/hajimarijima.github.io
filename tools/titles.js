'use strict';
// 村人の称号（config.titles）。村人の titles に称号の id を入れる。
// auto: "first" の称号は、いちばん最初に島に住んだ 1 人だけに自動でおくる（町の歴史と本人の日記に 1 回だけ書く）。
// join.js（15 分ごとの受付）と sim.js（毎朝）から呼ぶ。S = { config, villagers, life, history }

// いちばん最初に住んだ人：住み始めた日 → 参加した日付 → villagers.json の並び（来た順）
function firstVillager(villagers, life, day) {
  const c = villagers.map((v, i) => ({ v, i })).filter(({ v }) => life[v.key] && v.joinedDay <= day);
  c.sort((a, b) => a.v.joinedDay - b.v.joinedDay || String(a.v.joined || '').localeCompare(String(b.v.joined || '')) || a.i - b.i);
  return c.length ? c[0].v : null;
}

// 自動の称号をおくる。おくった { v, title } の一覧を返す
function awardTitles(S, { day, date }) {
  const list = (S.config.titles && S.config.titles.list) || [];
  const out = [];
  for (const t of list) {
    if (t.auto !== 'first') continue;
    if (S.villagers.some((v) => (v.titles || []).includes(t.id))) continue; // もうだれかが持っている（1 人だけ）
    if ((S.history || []).some((h) => h.type === 'title' && h.title === t.id)) continue; // 前におくった（持っていた人が町を出ても、ほかの人にはおくらない）
    const v = firstVillager(S.villagers, S.life, day);
    if (!v) continue;
    v.titles = [...(v.titles || []), t.id];
    S.history.push({ day, date, type: 'title', text: `${v.display} に称号『${t.name}』がおくられた。`, who: [v.key], title: t.id });
    const L = S.life[v.key], note = `称号「${t.name}」をもらった（${t.desc || ''}）。`;
    const d = L.diary[L.diary.length - 1];
    if (d && d.day === day) d.text += note; else L.diary.push({ day, date, text: note });
    out.push({ v, title: t });
  }
  return out;
}

module.exports = { firstVillager, awardTitles };
