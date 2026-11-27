'use strict';
// コメント・DM で本人が書くプロフィールのうち、名札のある物（性別・ひとこと・趣味・好きな色）を読む（tools/people.js から）。
//   「住みたい 女の子 12/11 りんご」の「女の子」は名札なしでも読む（tools/gender.js の parseGenderWord）。ここは名札ありの書き方：
//   「性別 女の子」「性別 ひみつ」「ひとこと よろしくね」「趣味 釣り」「色 水色」「好きな色は青」
//   ひとこと（20 字まで）と趣味（20 字まで）は、手紙のきまりの禁止語（js/letters.js の hasNg）とプロフィールの禁止語（PF.badWord）を通さない。URL・@ も通さない
//   色は決まった色（js/profile-fields.js の FAV_COLORS）の名前だけ。書き方の揺れ（みずいろ・ライトブルー・空色…）も受け付ける
const PF = require('../js/profile-fields.js');
let LT = null;
const letters = () => { if (!LT) LT = require('../js/letters.js'); return LT; }; // ES モジュール（node 22 から require できる）

const HITO_MAX = 20, HOBBY_MAX = 20;
// 名札（前が区切りの時だけ。「水色」の「色」や「一言で言うと」は読まない）
const LABELS = [
  ['gender', '性別|せいべつ'],
  ['message', 'ひとこと|一言|ヒトコト|自己紹介|じこしょうかい'],
  ['hobby', '趣味|しゅみ'],
  ['color', '好きな色|すきな色|すきないろ|好きないろ|色|いろ|カラー'],
];
const SEP = '(?:^|[\\s、,，。！!？?・/／「」()（）])';
const LABEL_RE = new RegExp(SEP + '(' + LABELS.map(([, w]) => w).join('|') + ')\\s*(?:は|が|:|：|=|＝)?\\s*', 'g');
const kindOf = (w) => (LABELS.find(([, ws]) => new RegExp('^(?:' + ws + ')$').test(w)) || [null])[0];

const S_WORDS = /^(ひみつ|秘密|ヒミツ|ないしょ|内緒|ナイショ|ひ・み・つ|ノーコメント|言わない|いわない)/;
const F_WORDS = /^(女の子|女のこ|おんなのこ|女性|女子|女|おんな|♀|female|girl|f)(?![a-z])/i;
const M_WORDS = /^(男の子|男のこ|おとこのこ|男性|男子|男|おとこ|♂|male|boy|m)(?![a-z])/i;
function genderValue(s) {
  const t = String(s || '').trim();
  if (S_WORDS.test(t)) return 's';
  if (F_WORDS.test(t)) return 'f';
  if (M_WORDS.test(t)) return 'm';
  return null;
}
// 書いてよい文か（禁止語・URL・@・電話番号をはじく）。よければそろえた文、だめなら null
function okText(s, max) {
  let t = PF.cleanText(s).replace(/^[「『"'“]+|[」』"'”]+$/g, '').trim();
  if (!t) return null;
  t = Array.from(t).slice(0, max).join('');
  if (/https?:|www\.|@|\.com\b|\.jp\b/i.test(t) || /\d[\d-]{8,}\d/.test(t)) return null;
  if (PF.badWord(t) || letters().hasNg(t)) return null;
  return t;
}
// 文を名札で分ける。返り値：{ rest（名札の部分を消した残り。ほかの読み取りに使う）, gender, message, hobby, color }
//   ひとことは名札のあと、次の名札（性別・趣味・色）までをぜんぶ（ひとことの中の言葉で誕生日などをまちがえて読まない）
//   趣味・色・性別は名札のあとの 1 語だけ
function splitExtras(text) {
  const t = PF.cleanText(text);
  const out = { rest: t };
  const hits = [];
  LABEL_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_RE.exec(t))) {
    const start = m.index + (m[0].length - m[0].replace(/^[\s、,，。！!？?・/／「」()（）]/, '').length);
    hits.push({ kind: kindOf(m[1]), start, valAt: m.index + m[0].length });
  }
  if (!hits.length) return out;
  const cut = [];
  hits.forEach((h, i) => {
    if (!h.kind) return;
    // ひとことの中にある「色」などの名札は、ひとことの一部として読む
    const prevMain = hits.slice(0, i).filter((p) => p.kind && p.kind !== 'color').pop();
    if (h.kind === 'color' && prevMain && prevMain.kind === 'message') return;
    const nextAt = (hits.slice(i + 1).find((p) => p.kind && p.kind !== 'color') || {}).start;
    const seg = t.slice(h.valAt, h.kind === 'message' ? (nextAt === undefined ? t.length : nextAt) : t.length);
    let used = 0;
    if (h.kind === 'message') {
      used = seg.length;
      const v = okText(seg, HITO_MAX);
      if (v) out.message = v; else if (seg.trim()) out.messageNg = true;
    } else {
      const w = (seg.match(/^[^\s、,，。！!？?]+/) || [''])[0];
      used = w.length;
      if (h.kind === 'gender') { const g = genderValue(w); if (g) out.gender = g; }
      else if (h.kind === 'hobby') { const v = w && okText(w, HOBBY_MAX); if (v) out.hobby = v; else if (w) out.hobbyNg = true; }
      else if (h.kind === 'color') {
        const c = PF.colorOf(w);
        if (!c) return; // 色の名前でない「色」は、ほかの文の一部として残す
        out.color = c.hex;
      }
    }
    cut.push([h.start, h.valAt + used]);
  });
  let rest = '', at = 0;
  for (const c of cut.sort((a, b) => a[0] - b[0])) { if (c[0] < at) continue; rest += t.slice(at, c[0]) + ' '; at = c[1]; }
  out.rest = (rest + t.slice(at)).replace(/\s+/g, ' ').trim();
  return out;
}
const hasExtras = (s) => !!(s.gender || s.message || s.hobby || s.color);

module.exports = { splitExtras, hasExtras, genderValue, okText, HITO_MAX, HOBBY_MAX };
