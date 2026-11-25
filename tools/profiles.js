'use strict';
// Google ログインで入れたプロフィールを村人に反映する部分（入出力なし。firestore_sync.js とテストで使う）
const PF = require('../js/profile-fields.js');
const P = require('./people');

const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXY34679'; // 見まちがえやすい字はぬく
// 「つなぐ 7K3Q」を読む（全角・小文字・空白なしでもよい）
function parseLink(text, word = 'つなぐ') {
  const s = P.norm(text).toUpperCase();
  const i = s.indexOf(P.norm(word).toUpperCase());
  if (i < 0) return null;
  const m = s.slice(i + word.length).match(/^\s*([A-Z0-9]{4})(?![A-Z0-9])/);
  return m && [...m[1]].every((c) => CODE_CHARS.includes(c)) ? m[1] : null;
}
// コメントから、from.id のついたつなぐコードだけを集める（あとのコメントが勝つ）
function linksFrom(comments, word) {
  const out = new Map();
  for (const c of (comments || []).slice().sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0))) {
    const id = c.from && c.from.id;
    const code = id && parseLink(c.text, word);
    if (code) out.set(code, String(id));
  }
  return [...out].map(([code, igId]) => ({ code, igId }));
}
// Firestore の profiles / private の中身を、項目の定義で確かめてから村人に入れる。
// docs: { 村人の key: { 項目: 値 } }。公開する項目だけを villagers.json に入れ、公開しない項目は別に返す。
// 「最初の道具」（startTool）は、参加した日（day <= joinedDay）に 1 回だけ変えられる。それ以外は前の道具のまま
function applyProfiles(villagers, pubDocs, privDocs, fields, { day = null, startTools = null } = {}) {
  const report = { updated: [], rejected: [] };
  const priv = {};
  const byKey = Object.fromEntries(villagers.map((v) => [v.key, v]));
  for (const [key, doc] of Object.entries(pubDocs || {})) {
    const v = byKey[key];
    if (!v) continue;
    const { ok, errors } = PF.validate(fields.filter((f) => f.public), doc);
    for (const id in errors) report.rejected.push({ key, field: id, reason: errors[id] });
    const prof = {};
    for (const f of fields.filter((x) => x.public)) {
      if (ok[f.id] === undefined) continue;
      if (f.id === 'mbti') v.mbti = ok.mbti;
      else if (f.id === 'birthday') v.birthday = ok.birthday;
      else if (f.id === 'startTool') {
        const o = P.startToolByLabel(startTools, ok.startTool);
        if (!o || o.id === v.startTool) continue;
        if (v.startToolChanged || (day != null && day > v.joinedDay)) { report.rejected.push({ key, field: 'startTool', reason: '最初の道具は、参加した日に 1 回だけ変えられます' }); continue; }
        v.startTool = o.id; v.startToolChanged = day != null ? day : true;
      }
      else prof[f.id] = ok[f.id];
    }
    v.profile = prof;
    report.updated.push(key);
  }
  for (const [key, doc] of Object.entries(privDocs || {})) {
    if (!byKey[key]) continue;
    const { ok } = PF.validate(fields.filter((f) => !f.public), doc);
    if (Object.keys(ok).length) priv[key] = ok;
  }
  return { report, priv };
}
module.exports = { CODE_CHARS, parseLink, linksFrom, applyProfiles };
