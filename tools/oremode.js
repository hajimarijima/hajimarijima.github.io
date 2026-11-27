'use strict';
// 鉱石を掘った時の持ち方（v.oreMode）：'keep'（自分で持つ。ふつう）／'chest'（島の倉庫＝チェストに入れる）。
//   変え方は 2 つ。新しい方が勝つ（v.oreAt に、使った設定の時刻を残す。同じコメント・古い設定は 2 回使わない）。
//   1) コメント「鉱石 自分」「鉱石 倉庫」「鉱石：チェスト」「鉱石は自分で持つ」（仕事の変更 tools/jobs.js と同じ読み方。「住みたい」のコメントは読まない）
//   2) web の設定（me.html → Worker /me/settings → tools/play.js pull → data/inbox/play.json の settings）。web は 'self' / 'storage' で持つ
//   web の設定の誕生日（birthday 'MM-DD'）もここで入れる（v.profileAt より新しい時だけ。コメントで書いた誕生日と同じ扱い）
const P = require('./people');

const WORDS = ['鉱石', 'こうせき', '鉱物'];
const KEEP_W = ['自分で持つ', '自分', 'じぶん', '持つ', 'もつ', '手持ち', '持ち物'];
const CHEST_W = ['倉庫', 'そうこ', 'チェスト', 'ちぇすと', 'みんな', '島'];
const WEB = { self: 'keep', storage: 'chest' };
const MODE_JA = { keep: '自分で持つ', chest: '島の倉庫に入れる' };
const modeOf = (v) => (v && v.oreMode === 'chest' ? 'chest' : 'keep');

// 1 つのコメントから 'keep' / 'chest' を読む。なければ null
function parseOreMode(text) {
  const t = P.norm(text);
  if (!t) return null;
  for (const w of WORDS) {
    const i = t.indexOf(w);
    if (i < 0) continue;
    const after = t.slice(i + w.length).replace(/^\s*(?:は|を|の|:|=|→|->|ー|、)?\s*/, '').slice(0, 8);
    const hit = (list) => list.some((x) => after.startsWith(x));
    if (hit(KEEP_W)) return 'keep';
    if (hit(CHEST_W)) return 'chest';
  }
  return null;
}

function setMode(S, v, mode, atMs, { day, date, how }) {
  v.oreAt = new Date(atMs).toISOString();
  if (modeOf(v) === mode && v.oreMode) return false;
  const was = v.oreMode ? modeOf(v) : null;
  v.oreMode = mode;
  if (was && S.history) S.history.push({ day, date, type: 'event', kind: 'ore', text: `${v.display}さんが、掘った鉱石を${MODE_JA[mode]}ことにした。`, who: [v.key], how });
  return true;
}

// コメントで変える。戻り値：変えた [{ v, mode }]
function applyOreComments(S, comments, { day = 0, date = '', owners = [] } = {}) {
  const out = [];
  const ex = new Set((owners || []).map((s) => String(s).toLowerCase()));
  const list = (comments || [])
    .filter((c) => c && c.text && !P.isJoin(c.text, S.config && S.config.joinWord))
    .map((c) => ({ c, t: Date.parse(c.timestamp), u: P.commentUser(c), mode: parseOreMode(c.text) }))
    .filter((x) => x.mode && Number.isFinite(x.t) && (x.u.igId || x.u.username) && !ex.has(P.norm(x.u.username).toLowerCase()))
    .sort((a, b) => a.t - b.t);
  for (const x of list) {
    const v = P.findVillager(S.villagers, x.u);
    if (!v || v.left) continue;
    if (v.oreAt && Date.parse(v.oreAt) >= x.t) continue; // もう読んだコメント・もっと新しい設定がある
    if (setMode(S, v, x.mode, x.t, { day, date, how: 'comment' })) out.push({ v, mode: x.mode });
  }
  return out;
}

// play.json の settings（{ 村人の key: { oreMode: 'self'|'storage', oreAt|at, birthday, birthdayAt|at } }）を村人に入れる
function applyPlaySettings(S, settings, { day = 0, date = '' } = {}) {
  const out = { ore: [], birthday: [] };
  for (const [k, s] of Object.entries(settings || {})) {
    const v = (S.villagers || []).find((x) => x.key === k);
    if (!v || v.left || !s) continue;
    const oreT = Date.parse(s.oreAt || s.at);
    if (WEB[s.oreMode] && Number.isFinite(oreT) && !(v.oreAt && Date.parse(v.oreAt) >= oreT)) {
      if (setMode(S, v, WEB[s.oreMode], oreT, { day, date, how: 'web' })) out.ore.push({ v, mode: WEB[s.oreMode] });
    }
    const bdT = Date.parse(s.birthdayAt || s.at);
    if (/^\d{2}-\d{2}$/.test(s.birthday || '') && Number.isFinite(bdT) && !(v.profileAt && Date.parse(v.profileAt) >= bdT)) {
      if (v.birthday !== s.birthday) { v.birthday = s.birthday; out.birthday.push(v); }
      v.profileAt = new Date(bdT).toISOString();
    }
  }
  return out;
}

module.exports = { parseOreMode, applyOreComments, applyPlaySettings, modeOf, MODE_JA, WEB };
