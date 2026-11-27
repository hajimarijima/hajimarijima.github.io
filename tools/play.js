#!/usr/bin/env node
'use strict';
// 遊びのページ（play.html）と「自分の村人」の設定の記録を、受け口（Cloudflare の Worker・tools/webhook/worker.mjs の 5)）から取り出す口。
//   node tools/play.js pull [--days 3]  … data/inbox/play.json（.gitignore の inbox。公開しない）に置く
// 中身：{ at, settings: { 村人: { oreMode } }, days: { 日付: { 村人: { fish, chores, treasure, catches: [[魚, cm]] } } }, chores: { 日付: { wood, stone, berry, water, total } }, treasure: { 日付: { villager, at } } }
// 設定（鉱石の持ち方・誕生日）は sim.js が play.json を読んで村人に入れる（tools/oremode.js の applyPlaySettings）。
// 宝箱のいちばん乗りの年表とバッジ・釣った魚のランキングは、別の担当が play.json を読んで足す。
// 手紙（mail）と家の飾り（decor）も同じ口で受け取り、sim.js が tools/mail.js・tools/decor.js で data/mail.json・data/decor.json に入れる。
// 遊びに行った分（visits）も同じ口で受け取り、tools/visit.js が data/visits.json（来た人ノート）と郵便受けに入れる。
// env：DM_QUEUE_URL・DM_QUEUE_TOKEN（DM の入居と同じ受け口・同じ合言葉）
const fs = require('fs');
const path = require('path');

function queueEnv(env = process.env) {
  const url = String(env.DM_QUEUE_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.DM_QUEUE_TOKEN || '').trim();
  if (!url || !token) return null;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error('DM_QUEUE_URL は https:// の URL にしてください');
  return { url, token };
}
// 受け取った中身の形をととのえる（変な値は捨てる）
const KEY = /^[A-Za-z0-9_-]{1,40}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
function clean(j) {
  const out = { settings: {}, days: {}, chores: {}, treasure: {} };
  // 設定：鉱石の持ち方（self / storage）と誕生日（MM-DD）。いつ変えたか（oreAt・birthdayAt・at）も持つ（sim の tools/oremode.js が、コメントと新しい方を使う）
  const ISO = (x) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? new Date(Date.parse(x)).toISOString() : null);
  for (const [k, s] of Object.entries((j && j.settings) || {})) {
    if (!KEY.test(k) || !s) continue;
    const o = {};
    if (['self', 'storage'].includes(s.oreMode)) { o.oreMode = s.oreMode; const t = ISO(s.oreAt) || ISO(s.at); if (t) o.oreAt = t; }
    if (typeof s.birthday === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s.birthday)) { o.birthday = s.birthday; const t = ISO(s.birthdayAt) || ISO(s.at); if (t) o.birthdayAt = t; }
    if (Object.keys(o).length) out.settings[k] = o;
  }
  for (const [d, m] of Object.entries((j && j.days) || {})) {
    if (!DATE.test(d)) continue;
    out.days[d] = {};
    for (const [k, r] of Object.entries(m || {})) {
      if (!KEY.test(k) || !r) continue;
      out.days[d][k] = { fish: +r.fish || 0, chores: +r.chores || 0, treasure: !!r.treasure, catches: (Array.isArray(r.catches) ? r.catches : []).filter((c) => Array.isArray(c) && typeof c[0] === 'string').map(([it, cm]) => [it, +cm || 0]) };
    }
  }
  for (const [d, c] of Object.entries((j && j.chores) || {})) if (DATE.test(d) && c) out.chores[d] = { wood: +c.wood || 0, stone: +c.stone || 0, berry: +c.berry || 0, water: +c.water || 0, total: +c.total || 0 };
  for (const [d, t] of Object.entries((j && j.treasure) || {})) if (DATE.test(d) && t && KEY.test(t.villager)) out.treasure[d] = { villager: t.villager, at: t.at || null };
  if (j && (j.mail || j.decor)) Object.assign(out, cleanHome(j));
  if (j && j.visits) out.visits = cleanVisits(j.visits);
  return out;
}
// 遊びに行った分（visits：{ 日付: { 村人: [{ id, to, at, note? }] } }）。行けるかどうかは sim の tools/visit.js がもう一度確かめる
function cleanVisits(V) {
  const out = {}, ID = /^[A-Za-z0-9]{4,24}$/;
  for (const [d, m] of Object.entries(V || {})) {
    if (!DATE.test(d)) continue;
    out[d] = {};
    for (const [k, list] of Object.entries(m || {})) {
      if (!KEY.test(k) || !Array.isArray(list)) continue;
      out[d][k] = list.filter((x) => x && ID.test(String(x.id)) && KEY.test(String(x.to))).slice(0, 10)
        .map((x) => ({ id: x.id, to: x.to, at: x.at || null, ...(Number.isInteger(x.note) && x.note >= 0 && x.note < 20 ? { note: x.note } : {}) }));
    }
  }
  return out;
}
// 手紙（mail：{ 日付: { 村人: [{ id, to, text, gift, at }] } }）と家の飾り（decor：{ 村人: { out, in, at } }）。本文と並べ方は sim の tools/mail.js・tools/decor.js がもう一度確かめる
function cleanHome(j) {
  const out = { mail: {}, decor: {} }, ID = /^[A-Za-z0-9]{4,24}$/, IT = /^[a-z_]{2,30}$/;
  for (const [d, m] of Object.entries(j.mail || {})) {
    if (!DATE.test(d)) continue;
    out.mail[d] = {};
    for (const [k, list] of Object.entries(m || {})) {
      if (!KEY.test(k) || !Array.isArray(list)) continue;
      out.mail[d][k] = list.filter((L) => L && ID.test(String(L.id)) && KEY.test(String(L.to)) && typeof L.text === 'string').slice(0, 10)
        .map((L) => ({ id: L.id, to: L.to, text: L.text.slice(0, 200), gift: IT.test(String(L.gift || '')) ? L.gift : null, at: L.at || null }));
    }
  }
  const lay = (x) => (Array.isArray(x) ? x.filter((e) => Array.isArray(e) && IT.test(String(e[0])) && [1, 2, 3].every((i) => Number.isInteger(e[i]))).slice(0, 40).map((e) => e.slice(0, 4)) : []);
  for (const [k, x] of Object.entries(j.decor || {})) if (KEY.test(k) && x) out.decor[k] = { out: lay(x.out), in: lay(x.in), at: typeof x.at === 'string' ? x.at : null };
  // 手紙のきまりへの同意（村人ごとの版と日時）と、通報の数（手紙ごと）
  if (j.terms) { out.terms = {}; for (const [k, x] of Object.entries(j.terms)) if (KEY.test(k) && x && Number.isInteger(x.version)) out.terms[k] = { version: x.version, at: typeof x.at === 'string' ? x.at : null }; }
  if (j.reports) { out.reports = {}; for (const [id, n] of Object.entries(j.reports)) if (/^[A-Za-z0-9_-]{1,40}$/.test(id) && Number.isInteger(n) && n > 0) out.reports[id] = n; }
  return out;
}
async function pull({ env = process.env, fetchFn = globalThis.fetch, days = 3 } = {}) {
  const q = queueEnv(env);
  if (!q) return null;
  const r = await fetchFn(`${q.url}/play/pull?days=${Math.max(1, Math.min(8, days | 0))}`, { headers: { Authorization: 'Bearer ' + q.token, 'User-Agent': 'town-play' } });
  if (!r.ok) throw new Error('受け口から遊びの記録を読めませんでした（' + r.status + '）');
  return clean(await r.json());
}

module.exports = { pull, clean, queueEnv };

if (require.main === module) {
  const DATA = process.env.TOWN_DATA || path.join(__dirname, '..', 'data');
  const cmd = process.argv[2];
  const i = process.argv.indexOf('--days');
  (async () => {
    if (cmd !== 'pull') { console.error('使い方: node tools/play.js pull [--days 3]'); process.exit(2); }
    if (!queueEnv()) { console.log('DM_QUEUE_URL / DM_QUEUE_TOKEN がないので、遊びの記録は読みません'); return; }
    const j = await pull({ days: i > 0 ? Number(process.argv[i + 1]) : 3 });
    const inbox = path.join(DATA, 'inbox');
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, 'play.json'), JSON.stringify({ at: new Date().toISOString(), ...j }) + '\n');
    console.log(`遊びの記録：設定 ${Object.keys(j.settings).length} 人・${Object.keys(j.days).length} 日分`);
  })().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
