// 村人カード（町の画面 js/town.js の openCard）と、くわしくのページ（js/villager.js）に出すプロフィールの値。DOM も three.js も使わない（テストでも読む）
//   本人が書く物：性別・ひとこと・趣味・好きな色（tools/profile_extra.js がコメント・DM から読む）
//   記録から出す物：仲のよい人（data/social.json の pairs。town.js の pairScore と同じ点）・住んで何日目・誕生日まで・星座・今日の気分・宝物

// 好きな色（js/profile-fields.js の FAV_COLORS と同じ 13 色。テストで同じか確かめる）
export const FAV_COLORS = [
  ['赤', '#d9443f'], ['オレンジ', '#ee8a2a'], ['黄色', '#e9bf1f'], ['黄緑', '#86bf35'], ['緑', '#2f9a50'], ['水色', '#3fb4de'], ['青', '#2f6fd6'],
  ['紺', '#283c86'], ['紫', '#8a55c9'], ['ピンク', '#ec6fa6'], ['茶色', '#8b5a33'], ['白', '#f2f2ee'], ['黒', '#2b2b2f'],
];
// 村人の好きな色（#rrggbb。書いていない人は null＝今までどおりの色）
export const favColor = (v) => { const h = v && v.profile && v.profile.color; return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : null; };
export const colorName = (hex) => (FAV_COLORS.find(([, h]) => h === String(hex || '').toLowerCase()) || [''])[0];
// 色の明るさ（0〜1）。白・黄色のような明るい色は、ふちを少し濃くして字は黒のままにする
export function lum(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
// 帯・ふちに使う色：明るすぎる色（白・黄色）は少し暗くして、白い地でも見えるようにする
export function favEdge(hex) {
  if (!hex) return null;
  if (lum(hex) < 0.6) return hex;
  const n = parseInt(hex.slice(1), 16), k = 0.72;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x * k));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}
// 帯の上の字の色（暗い色の帯は白い字、明るい色の帯は黒い字）
export const favInk = (hex) => (hex && lum(hex) > 0.45 ? '#2a2a2a' : '#ffffff');

// 性別のラベル。本人が書いた人だけ（v.gender。名前から決めたスキンの体の種類は使わない）
export const GENDER_LABEL = { f: '女の子', m: '男の子', s: 'ひみつ' };
export const genderText = (v) => (v && GENDER_LABEL[v.gender]) || '';
// ひとこと・趣味（プロフィールの項目 message・hobby）
export const hitokoto = (v) => (v && v.profile && typeof v.profile.message === 'string' ? v.profile.message.trim() : '');
export const hobbyText = (v) => (v && v.profile && typeof v.profile.hobby === 'string' ? v.profile.hobby.trim() : '');

// 星座（誕生日「MM-DD」から）
const ZODIAC = [[1, 20, 'やぎ座'], [2, 19, 'みずがめ座'], [3, 21, 'うお座'], [4, 20, 'おひつじ座'], [5, 21, 'おうし座'], [6, 22, 'ふたご座'], [7, 23, 'かに座'], [8, 23, 'しし座'], [9, 23, 'おとめ座'], [10, 24, 'てんびん座'], [11, 23, 'さそり座'], [12, 22, 'いて座'], [13, 0, 'やぎ座']];
const parseMd = (md) => { const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(md || '')); return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31 ? [+m[1], +m[2]] : null; };
export function zodiac(md) {
  const p = parseMd(md); if (!p) return '';
  const [m, d] = p;
  // その月の「次の星座が始まる日」より前ならその月の前の星座
  return d < ZODIAC[m - 1][1] ? ZODIAC[m - 1][2] : ZODIAC[m][2];
}
// 日本時間の今日（年・月・日）
export function jstToday(now = new Date()) { const t = new Date(now.getTime() + 9 * 3600e3); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; }
// 誕生日まであと何日（今日なら 0。2/29 は、うるう年でない年は 3/1 として数える）。誕生日がなければ null
export function daysToBirthday(md, now = new Date()) {
  const p = parseMd(md); if (!p) return null;
  const [y, m, d] = jstToday(now);
  const today = Date.UTC(y, m - 1, d);
  let b = Date.UTC(y, p[0] - 1, p[1]);
  if (b < today) b = Date.UTC(y + 1, p[0] - 1, p[1]);
  return Math.round((b - today) / 86400e3);
}
export const birthdayRest = (md, now) => { const n = daysToBirthday(md, now); return n === null ? '' : n === 0 ? 'きょうが誕生日' : `誕生日まであと ${n} 日`; };
// 住んで何日目（島の何日目から住んだか v.joinedDay と、今の島の日 state.day から）。分からなければ 0
export function livedDays(v, state) {
  const j = Number(v && v.joinedDay), d = Number(state && state.day);
  if (!Number.isFinite(j) || !Number.isFinite(d) || d < 1) return 0;
  return Math.max(1, Math.floor(d - Math.max(1, j)) + 1);
}
// 今日の気分（体力 L.hp・おなか L.hunger のゲージから。max は config.needs.max）
export function moodText(L, config) {
  if (!L) return '';
  const max = (config && config.needs && config.needs.max) || 20;
  const hp = Number.isFinite(L.hp) ? L.hp / max : 1, food = Number.isFinite(L.hunger) ? L.hunger / max : 1;
  if (L.restWhy === 'weak' || hp <= 0.25) return 'へとへと';
  if (food <= 0.25) return 'おなかペコペコ';
  if (hp <= 0.5) return 'ちょっとおつかれ';
  if (food <= 0.5) return '小腹がすいた';
  if (hp >= 0.9 && food >= 0.9) return 'ごきげん';
  return 'まあまあ';
}
// 宝物：持ち物と装備の中で、いちばん良い物。rarity: "legend"（激レア）の物がいちばん。
//   次に防具・道具、そのあとは作るのに使う物の多さ（items の value の合計）。何もなければ null
const sumVal = (it) => Object.values((it && it.value) || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const RANK = { legend: 1e6, epic: 1e5, rare: 1e4 };
export function treasureOf(L, config) {
  const items = (config && config.items) || {};
  if (!L) return null;
  const ids = [];
  const inv = (L.held && L.held.length ? L.held : L.inv) || [];
  for (const s of inv) if (s && s.item) ids.push(s.item);
  for (const k of Object.keys(L.gear || {})) if (L.gear[k]) ids.push(L.gear[k]);
  let best = null, bs = -1;
  for (const id of ids) {
    const it = items[id]; if (!it || !it.name) continue;
    const sc = (RANK[it.rarity] || 0) + (it.armor ? 300 : 0) + (it.tool ? 200 : 0) + sumVal(it) * 10 + (it.part ? 0 : 1);
    if (sc > bs) { bs = sc; best = { id, name: it.name, legend: it.rarity === 'legend' }; }
  }
  return best;
}
// 仲のよい人（data/social.json の pairs「a|b」。点は town.js の pairScore と同じ：仲のよさ s ＋ 家族 50 ＋ 好きな人 60）。
//   今住んでいる人だけ、点の高い順に n 人。点が 0 の人は出さない
export const pairPoints = (r) => (r ? (r.s || 0) + ((r.family || 0) > 0 ? 50 : 0) + (r.crush ? 60 : 0) : 0);
export function bestFriends(v, social, villagers, n = 3) {
  if (!v) return [];
  const byKey = new Map((villagers || []).map((x) => [x.key, x]));
  const out = [];
  for (const [k, r] of Object.entries((social && social.pairs) || {})) {
    const [a, b] = k.split('|');
    if (a !== v.key && b !== v.key) continue;
    const o = byKey.get(a === v.key ? b : a);
    const s = pairPoints(r);
    if (o && o.key !== v.key && s > 0) out.push({ v: o, s });
  }
  return out.sort((x, y) => y.s - x.s || String(x.v.key).localeCompare(String(y.v.key))).slice(0, n);
}
