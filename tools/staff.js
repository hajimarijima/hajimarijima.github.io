'use strict';
// 管理者用の村人（本番の島でテストプレイをするための村人）。みんなには見せない。
//   ・TOWN_STAFF（GitHub の secret。インスタのユーザー名をカンマ区切り）の人が DM で「住みたい」と送ると、村人に staff: true が付く
//     （tools/join.js。返事の DM には、ふつうの村人と同じ専用のリンク ?me= が入る）
//   ・staff の村人は：毎日の島の動き（sim）に出ない・ほかの村人と仲よくならない・称号をもらわない・町の歴史に書かない
//     サイトの一覧・町の画面・村人の数に出ない（js/common.js の load('villagers') が外す）
//   ・遊ぶページ（専用のリンク）では、ふつうの村人と同じように遊べる（js/mine.js は外す前の一覧で自分を探す）
const staffNames = (env = process.env) => String((env && env.TOWN_STAFF) || '').split(/[\s,]+/).map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
const isStaff = (v) => !!(v && v.staff);
const staffKeys = (villagers) => new Set((villagers || []).filter(isStaff).map((v) => v.key));

// TOWN_STAFF の人に staff: true を付ける（一度付いたら外さない）。付けた数を返す
function markStaff(villagers, env = process.env) {
  const ns = new Set(staffNames(env));
  let n = 0;
  if (!ns.size) return 0;
  for (const v of villagers || []) if (v && !v.staff && ns.has(String(v.name || '').toLowerCase())) { v.staff = true; n++; }
  return n;
}

// 町の歴史から staff が出てくる行を消す（その場で消す。消した数を返す）
function scrubHistory(history, villagers) {
  const ks = staffKeys(villagers);
  if (!ks.size || !Array.isArray(history)) return 0;
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) if (((history[i] && history[i].who) || []).some((k) => ks.has(k))) { history.splice(i, 1); n++; }
  return n;
}

module.exports = { staffNames, isStaff, staffKeys, markStaff, scrubHistory };
