// プロフィールの項目の確かめ（ブラウザと node の両方で使う）。
// 項目の定義は data/config.json の profileFields。種類: select / text / number / monthday / date / color
(function (root) {
  'use strict';
  // よくない言葉（ひらがな・小文字にそろえてから、間の記号や空白をぬいて探す）
  const BAD = ['しね', 'ころす', 'ころしてやる', 'きもい', 'きしょい', 'ぶす', 'ばかやろ', 'ばーか', 'あほんだら', 'ごみくず', 'くそ', 'うざい', 'きえろ', 'ちね', 'がいじ', 'ちんこ', 'まんこ', 'せっくす', 'fuck', 'shit', 'bitch', 'dick', 'pussy', 'nigger', 'kill yourself', 'kys', '死ね', '氏ね', '殺す', '殺して', '消えろ', '馬鹿', '阿呆', '糞', '基地外', 'キチガイ'];
  const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const squash = (s) => toHira(String(s).normalize('NFKC').toLowerCase()).replace(/[\s\-_.・,、。!！?？~〜*＊/\\|'"`]/g, '');
  function badWord(s) {
    const t = squash(s);
    return BAD.some((w) => t.includes(squash(w)));
  }
  // 見えない文字・改行・URL・@ はとりのぞくか、だめにする
  function cleanText(s, max) {
    let t = String(s == null ? '' : s).normalize('NFKC').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
    if (max) t = Array.from(t).slice(0, max).join('');
    return t;
  }
  const DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function check(field, raw) {
    if (raw === undefined || raw === null || raw === '') return { value: null };
    const f = field;
    switch (f.type) {
      case 'select': return (f.options || []).includes(raw) ? { value: raw } : { error: '選べる中から選んでください' };
      case 'text': {
        const t = cleanText(raw, f.max || 30);
        if (!t) return { value: null };
        if (/https?:|www\.|@/i.test(t)) return { error: 'リンクや @ は書けません' };
        if (badWord(t)) return { error: 'その言葉は使えません' };
        return { value: t };
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) return { error: '数を入れてください' };
        if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return { error: `${f.min}〜${f.max} の数にしてください` };
        return { value: Math.round(n) };
      }
      case 'monthday': {
        const m = String(raw).match(/^(\d{1,2})-(\d{1,2})$/);
        if (!m || !(+m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= DAYS[+m[1]])) return { error: '月と日を選んでください' };
        return { value: String(+m[1]).padStart(2, '0') + '-' + String(+m[2]).padStart(2, '0') };
      }
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !isNaN(Date.parse(raw)) ? { value: raw } : { error: '日付を選んでください' };
      case 'color': return /^#[0-9a-f]{6}$/i.test(raw) ? { value: raw.toLowerCase() } : { error: '色を選んでください' };
      default: return { error: '知らない種類の項目です' };
    }
  }
  function validate(fields, input) {
    const ok = {}, errors = {};
    for (const f of fields) {
      const r = check(f, input ? input[f.id] : undefined);
      if (r.error) errors[f.id] = r.error; else if (r.value !== null) ok[f.id] = r.value;
    }
    return { ok, errors };
  }
  const publicOnly = (fields, values) => Object.fromEntries(fields.filter((f) => f.public && values[f.id] !== undefined).map((f) => [f.id, values[f.id]]));
  const privateOnly = (fields, values) => Object.fromEntries(fields.filter((f) => !f.public && values[f.id] !== undefined).map((f) => [f.id, values[f.id]]));
  const api = { badWord, cleanText, check, validate, publicOnly, privateOnly };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProfileFields = api;
})(typeof self !== 'undefined' ? self : this);
