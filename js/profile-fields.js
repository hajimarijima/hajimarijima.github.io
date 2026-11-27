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
      // 見た目：「体の種類:シード」（例 female:123）
      // 3 つ目は引き直しを使った回数（0 か 1）。例 female:123:1
      case 'skin': return /^(none|male|female):\d{1,10}(:[01])?$/.test(raw) && +raw.split(':')[1] <= 4294967295 ? { value: raw } : { error: '見た目を選び直してください' };
      // 体型：normal（通常）か chibi（2 頭身）。何度でも変えられる
      case 'shape': return (f.options || ['normal', 'chibi']).includes(raw) ? { value: raw } : { error: '体型を選んでください' };
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
  // 見た目の引き直し：体の種類を選んだ（変えた）時に、1 回だけ。used は使った回数（村人の記録と、保存したプロフィールの大きい方）
  const parseLookValue = (s) => { const m = /^(none|male|female):(\d{1,10})(?::([01]))?$/.exec(String(s || '')); return m ? { body: m[1], seed: +m[2], used: +(m[3] || 0) } : null; };
  const rerollAllowed = ({ used = 0, bodyChanged = false } = {}) => used < 1 && !!bodyChanged;
  // 好きな色（コメント・DM の「色 水色」で選べる 12 色。js/common.js の FAV_COLORS と同じ）。words は書き方の揺れ
  const FAV_COLORS = [
    { name: '赤', hex: '#d9443f', words: ['赤', 'あか', 'アカ', '赤色', 'あかいろ', 'レッド', 'red', '真っ赤', 'まっか'] },
    { name: 'オレンジ', hex: '#ee8a2a', words: ['オレンジ', 'おれんじ', 'オレンジ色', 'だいだい', '橙', '橙色', 'だいだいいろ', 'orange'] },
    { name: '黄色', hex: '#e9bf1f', words: ['黄色', 'きいろ', 'キイロ', '黄', 'き', 'イエロー', 'yellow'] },
    { name: '黄緑', hex: '#86bf35', words: ['黄緑', 'きみどり', 'キミドリ', '黄緑色', 'きみどりいろ', 'ライム', 'ライムグリーン', 'lime'] },
    { name: '緑', hex: '#2f9a50', words: ['緑', 'みどり', 'ミドリ', '緑色', 'みどりいろ', 'グリーン', 'green'] },
    { name: '水色', hex: '#3fb4de', words: ['水色', 'みずいろ', 'ミズイロ', '空色', 'そらいろ', 'ライトブルー', 'スカイブルー', 'lightblue', 'skyblue', 'シアン', 'ターコイズ'] },
    { name: '青', hex: '#2f6fd6', words: ['青', 'あお', 'アオ', '青色', 'あおいろ', 'ブルー', 'blue'] },
    { name: '紺', hex: '#283c86', words: ['紺', 'こん', '紺色', 'こんいろ', 'ネイビー', 'navy', '藍色', 'あいいろ'] },
    { name: '紫', hex: '#8a55c9', words: ['紫', 'むらさき', 'ムラサキ', '紫色', 'むらさきいろ', 'パープル', 'purple', 'すみれ色', 'ラベンダー'] },
    { name: 'ピンク', hex: '#ec6fa6', words: ['ピンク', 'ぴんく', 'ピンク色', '桃色', 'ももいろ', 'モモイロ', 'pink'] },
    { name: '茶色', hex: '#8b5a33', words: ['茶色', 'ちゃいろ', 'チャイロ', '茶', 'ちゃ', 'ブラウン', 'brown'] },
    { name: '白', hex: '#f2f2ee', words: ['白', 'しろ', 'シロ', '白色', 'しろいろ', 'ホワイト', 'white', '真っ白', 'まっしろ'] },
    { name: '黒', hex: '#2b2b2f', words: ['黒', 'くろ', 'クロ', '黒色', 'くろいろ', 'ブラック', 'black', '真っ黒', 'まっくろ'] },
  ];
  const fold = (s) => toHira(String(s || '').normalize('NFKC').toLowerCase()).replace(/[\s・]/g, '').replace(/(です|だよ|かな|が好き|がすき|すき|好き)$/, '');
  // 色の名前（揺れも受け付ける）→ { name, hex }。ちょうど同じ言葉の時だけ（「青空」などは読まない）。知らない名前は null
  function colorOf(s) {
    const t = fold(s);
    if (!t) return null;
    return FAV_COLORS.find((c) => c.words.some((w) => fold(w) === t)) || null;
  }
  const api = { FAV_COLORS, colorOf, badWord, cleanText, check, validate, publicOnly, privateOnly, parseLookValue, rerollAllowed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ProfileFields = api;
})(typeof self !== 'undefined' ? self : this);
