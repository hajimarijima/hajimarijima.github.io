'use strict';
// 誰かの家に遊びに行く（毎日の更新の中。tools/sim.js から、手紙のあとに呼ぶ）。決まりは js/visits.js（サイトと共通）。
//   ・web で遊びに行った分：受け口の Worker（/visit/go・/visit/note）に積まれ、tools/play.js pull が data/inbox/play.json の visits に入れる
//     → 相手の家の「来た人ノート」に一言を残し、家の主の郵便受けに「○○さんが遊びに来たよ」を届ける
//   ・村人どうし：仲の良さ（social.pairs）に合わせて、時々仲の良い人の家へ遊びに行く（ノートに一言。年表に小さく 1 行）
//   data/visits.json：{ day, notes: [{ id, day, from, to, home, note, kind: 'web'|'villager' }], seen: [...] }
const VS = require('../js/visits.js');
const SO = require('./social');

const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const diaryAdd = (S, k, day, text) => { const L = S.life[k], d = L && L.diary && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += text; };
// 住んでいる家（家の形の建物だけ。テントの人には遊びに行けない）
function homeOf(S, key) {
  const L = S.life[key], b = L && L.home && (S.world.buildings || []).find((x) => x.id === L.home);
  const def = b && S.config.buildings[b.type];
  return def && def.look && def.look.kind === 'house' ? b.id : null;
}

function stepVisit(S, { day, play = null, R = Math.random, hist = null }) {
  const C = VS.visitCfg(S.config);
  S.visits = S.visits && Array.isArray(S.visits.notes) ? S.visits : { notes: [], seen: [] };
  S.visits.seen = S.visits.seen || [];
  S.mail = S.mail && Array.isArray(S.mail.letters) ? S.mail : { letters: [], seen: [] };
  const seen = new Set(S.visits.seen), active = S.villagers.filter((v) => v.joinedDay <= day && !v.gone), byKey = Object.fromEntries(active.map((v) => [v.key, v]));
  const residents = (home) => active.filter((v) => (S.life[v.key] || {}).home === home).map((v) => v.key);
  const notes = [], count = {}, letters = [];
  for (const n of S.visits.notes) if (n.day === day && n.kind === 'web') count[n.from] = (count[n.from] || 0) + 1; // 同じ日にもう一度回しても、数え直さない
  // 行けるか：相手が島にいて家がある・自分の家ではない
  const target = (from, to) => {
    if (!byKey[from] || !byKey[to] || from === to) return null;
    const home = homeOf(S, to);
    if (!home || (S.life[from] || {}).home === home) return null;
    return home;
  };
  // 1) web（受け口が 1 日の数を数えた分。何日分か来るので、id で 1 回だけ。あとから一言が付いたら書き足す）
  for (const m of Object.values((play && play.visits) || {})) {
    for (const [k, list] of Object.entries(m || {})) {
      for (const x of list || []) {
        const id = 'w' + String(x.id || '').slice(0, 24), note = VS.noteOk(x.note) ? x.note : null;
        if (!x.id || !KEY.test(String(x.to || ''))) continue;
        if (seen.has(id)) {
          const old = S.visits.notes.find((n) => n.id === id);
          if (old && old.note == null && note != null) old.note = note;
          continue;
        }
        const home = target(k, x.to);
        if (!home || (count[k] || 0) >= C.perDay) continue;
        seen.add(id); count[k] = (count[k] || 0) + 1;
        notes.push({ id, day, from: k, to: x.to, home, note, kind: 'web' });
        for (const r of residents(home)) letters.push({ id: `z${day}-${notes.length}-${r}`.slice(0, 40), day, from: k, to: r, text: VS.visitLetter(byKey[k].display, note), kind: 'visit' });
      }
    }
  }
  // 2) 村人どうし（仲の良さに合わせて。1 日 villagerPerDay 組まで。同じ人は 1 日 1 回）
  const pairs = Object.entries((S.social && S.social.pairs) || {}).map(([k, p]) => { const [a, b] = k.split('|'); return { a, b, p, kind: SO.kindOf(p) }; })
    .filter((x) => x.kind && byKey[x.a] && byKey[x.b]).sort((x, y) => y.p.s - x.p.s);
  const went = new Set(Object.keys(count)), vlist = [];
  for (const x of pairs) {
    if (vlist.length >= C.villagerPerDay) break;
    if (R() >= C.villagerP * Math.max(0.3, Math.min(2, (x.p.s || 0) / 40))) continue;
    const [from, to] = R() < 0.5 ? [x.a, x.b] : [x.b, x.a];
    const home = target(from, to);
    if (!home || went.has(from)) continue;
    went.add(from);
    const note = Math.floor(R() * VS.NOTE_WORDS.length);
    notes.push({ id: `v${day}-${notes.length}`, day, from, to, home, note, kind: 'villager' });
    vlist.push({ from: byKey[from].display, to: byKey[to].display, keys: [from, to] });
  }
  // 日記・年表
  for (const n of notes) {
    diaryAdd(S, n.from, day, `${byKey[n.to].display}の家へ遊びに行った。`);
    diaryAdd(S, n.to, day, `${byKey[n.from].display}が遊びに来た。`);
  }
  if (hist && vlist.length) hist('visit', VS.visitHistText(vlist), { who: [...new Set(vlist.flatMap((x) => x.keys))], small: true });
  // 郵便受け（手紙と同じ data/mail.json。ためる数は次の手紙の更新でそろえる）
  S.mail.letters.push(...letters);
  // ためる数（家ごとに keep 件まで）
  const all = [...S.visits.notes.filter((n) => byKey[n.from] || S.life[n.from]), ...notes], per = {}, keepIx = new Set();
  for (let i = all.length - 1; i >= 0; i--) { const h = all[i].home; per[h] = (per[h] || 0) + 1; if (per[h] <= C.keep) keepIx.add(i); }
  S.visits.notes = all.filter((_, i) => keepIx.has(i));
  S.visits.seen = [...seen].slice(-800);
  S.visits.day = day;
  return { notes, letters };
}

module.exports = { stepVisit, homeOf };
