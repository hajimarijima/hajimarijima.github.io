// 島の行事と誕生日パーティ（sim.js・町の画面・テストで共通。three.js も DOM も使わない）。
//   島の暦（日本時間の月日）で開く行事：冬祭り・花火大会・収穫祭・釣り大会。config.islandEvents で上書きできる（[{ id, name, from: 'MM-DD', to: 'MM-DD', ... }]）。
//   誕生日パーティは、その日が誕生日の人が何人いても 1 回にまとめる（id: 'birthday'）。
//   sim.js は state.today.events に [{ id, name, who?, day? }] を書き、町の画面（js/party3d.js）は夕方に広場で飾りと村人の集まりを見せる。

export const EVENTS = [
  { id: 'winter', name: '冬祭り', from: '11-26', to: '11-30', icon: 'snowflake', text: '広場に雪の飾りと屋台が出て、みんなで温かいスープを飲んだ。' },
  { id: 'fireworks', name: '花火大会', from: '08-13', to: '08-15', icon: 'sparkles', text: '夜の空に花火が上がって、みんなで広場から見上げた。' },
  { id: 'harvest', name: '収穫祭', from: '10-10', to: '10-12', icon: 'wheat', text: '畑の実りを広場に積んで、みんなで分けあった。' },
  { id: 'fishing', name: '釣り大会', from: '07-20', to: '07-22', icon: 'fish', text: 'だれがいちばん大きな魚を釣るか、みんなで競った。' },
];
// パーティ・行事を広場で見せる時間（日本時間。夕方）
export const PARTY_HOURS = [17, 19];

const MD = /^\d{2}-\d{2}$/;
// md（'MM-DD'）が from〜to の中か（年をまたぐ「12-30〜01-02」も）
export function inWindow(md, from, to) {
  if (!MD.test(md) || !MD.test(from) || !MD.test(to || from)) return false;
  const t = to || from;
  return from <= t ? md >= from && md <= t : md >= from || md <= t;
}
export function eventList(config) {
  const c = config && config.islandEvents;
  return Array.isArray(c) && c.length ? c.filter((e) => e && e.id && e.name && MD.test(e.from)) : EVENTS;
}
// その日（'YYYY-MM-DD'）に開く行事。何日目か（day）も付ける
export function seasonalOn(date, config) {
  const md = String(date || '').slice(5, 10);
  const out = [];
  for (const e of eventList(config)) {
    if (!inWindow(md, e.from, e.to)) continue;
    // 始まりの日からの日数（年をまたぐ時も）
    const y = +String(date).slice(0, 4), d0 = Date.parse(date + 'T00:00:00Z');
    let start = Date.parse(`${y}-${e.from}T00:00:00Z`);
    if (start > d0) start = Date.parse(`${y - 1}-${e.from}T00:00:00Z`);
    out.push({ id: e.id, name: e.name, day: Math.round((d0 - start) / 86400e3) + 1, icon: e.icon || 'party-popper' });
  }
  return out;
}
// その日のぜんぶの行事。誕生日の人（keys）がいれば、先頭に 1 つの誕生日パーティ
export function eventsOn(date, birthdayKeys, config) {
  const ev = [];
  if (birthdayKeys && birthdayKeys.length) ev.push({ id: 'birthday', name: '誕生日パーティ', who: [...birthdayKeys], icon: 'cake' });
  return ev.concat(seasonalOn(date, config));
}
// 「Aさん・Bさん」
export const sanList = (names) => names.map((n) => n + 'さん').join('・');
// 年表の行の名前「○○さんの誕生日パーティ」
export function partyTitle(names) { return `${sanList(names)}の誕生日パーティ`; }
// トップのカード・島のいまの一行「今日は ○○ さんの誕生日」「今日は冬祭り（2日目）」
export function todayLine(ev, nameOf) {
  if (ev.id === 'birthday') return `今日は ${(ev.who || []).map((k) => nameOf(k) + ' さん').join('・')}の誕生日`;
  return `今日は${ev.name}${ev.day > 1 ? `（${ev.day}日目）` : ''}`;
}
// 誕生日の贈り物：好きな食べ物があればそれ、なければ名前の印から（同じ人はいつも同じ）
const FOOD_ITEM = { 'りんご': 'apple', '魚': 'fish_funa', '木の実': 'berry', 'にんじん': 'carrot', 'じゃがいも': 'potato', 'たまご': 'egg', 'ミルク': 'milk', 'きのこ': 'mushroom' };
const GIFTS = ['apple', 'berry', 'flower_r', 'flower_y', 'egg'];
export function giftFor(v, items, hashStr) {
  const f = v && v.profile && FOOD_ITEM[v.profile.food];
  if (f && (!items || items[f])) return f;
  const list = GIFTS.filter((g) => !items || items[g]);
  return list.length ? list[hashStr('gift:' + (v && v.key)) % list.length] : null;
}
