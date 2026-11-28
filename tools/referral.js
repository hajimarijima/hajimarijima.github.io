'use strict';
// 招待（紹介）：村人の招待リンク（サイトの ?ref=村人の key）から来た人は、DM が「住みたい 紹介 村人の key」になる。
//   dm.js が入居の時にこの印を読み、新しい村人に referredBy（招待した村人の key）を付ける。
//   招待した人は、招待で住んだ人の数で称号とごほうびがもらえる（config.titles の auto: "referrals"。tools/titles.js）。
// 入出力なし（dm.js・titles.js・テストで使う）
const KEY = '[A-Za-z0-9_-]{1,40}';
const RE = new RegExp(`(?:招待|紹介)\\s*[:：]?\\s*(${KEY})`);

// 文から招待の印を取り出す。{ ref: 村人の key か null, rest: 印を消した文 }
function parseRef(text) {
  const s = String(text || '');
  const m = s.match(RE);
  if (!m) return { ref: null, rest: s };
  return { ref: m[1], rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
}

// 招待で住んだ人の数（町を出た人は数えない）
function referralCount(villagers, key) {
  return (villagers || []).filter((x) => x && x.referredBy === key && !x.left).length;
}

// 新しく住んだ人 v に、招待した人を付ける（自分自身・いない人・町を出た人・もう付いている人には付けない）。付けた人を返す
function setReferrer(villagers, v, ref) {
  if (!v || !ref || v.referredBy || ref === v.key) return null;
  const by = (villagers || []).find((x) => x && x.key === ref && !x.left);
  if (!by) return null;
  v.referredBy = by.key;
  return by;
}

module.exports = { parseRef, referralCount, setReferrer };
