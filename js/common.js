// どのページでも使うもの
import { makeSkin } from './skingen.js';
import { decodeWorld } from './tilemap.js';
import { diaryPath } from './datafiles.js';
import { versusTitles } from './versus.js';
export const JOB = { wood: '木を切る', stone: '岩を掘る', food: '食べ物を集める', smith: '鍛冶（道具や防具を作る）' };
export const RES = { wood: '木材', stone: '石', food: '食べ物' };
export const RES_COLOR = { wood: '#b07a45', stone: '#8d939b', food: '#6aa84f' };
export const ACTION = { level: '村のまん中を整地している', chop: '木を切っている', dig: '岩を掘っている', dig_last: '岩を掘り終えた', berry: '木の実を集めている', apple: 'りんごをもいでいる', till: '畑を耕している', tend: '畑の世話をしている', harvest: '畑で収穫している', forage: '草や実を集めている', fish: '池で釣りをしている', ranch: '柵の動物の世話をしている', rest: 'ケガで休んでいる', smith: '鍛冶屋で金づちをふるっている' };

// 関係の名前と色（tools/social.js の KIND と同じ）
export const KIND = { family: '家族', best: '親友', friend: '友だち', rival: 'ライバル', crush: '片思い', known: '知り合い' };
export const KIND_COLOR = { family: '#c58b2b', best: '#d9506a', friend: '#4b9a5e', rival: '#3f78b8', crush: '#b05cc4', known: '#9a9488' };
export const MBTI = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];
export const LETTER = { E: 'よくしゃべる', I: 'ひとりで働くのが好き', N: '新しいものの話が好き', S: '目の前の仕事を大事にする', T: '段取りを考える', F: '仲間思い', J: '計画どおりに進めたい', P: '気まぐれ' };
export const mdText = (md) => { if (!md) return ''; const [m, d] = md.split('-'); return `${+m}月${+d}日`; };

const cache = {};
export async function load(name) {
  if (!cache[name]) cache[name] = fetch('data/' + name + '.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(name + '.json を読めません'); return r.json(); });
  return cache[name];
}
export async function loadAll() {
  const [config, state, villagers, world, life, history, social] = await Promise.all([...['config', 'state', 'villagers', 'world', 'life', 'history'].map(load), load('social').catch(() => ({ pairs: {}, talks: [], view: {}, edges: [] }))]);
  const active = villagers.filter((v) => v.joinedDay <= state.day);
  // world.json の木と岩は地図の文字で入っているので、いつもの一覧に戻す
  return { config, state, villagers, active, world: decodeWorld(world), life, history, social };
}
// 日記は人ごとのファイル（開いた時だけ読む）。古い形（life.json の中）ならそれを使う
export async function loadDiary(key, L) {
  if (L && Array.isArray(L.diary)) return L.diary;
  // 日記は 64 組のファイルに分けてある。{ key: {diary, locks} }。locks（持ち物の枠がいつ開くか）は L にも入れる
  try {
    const r = await fetch('data/' + diaryPath(key), { cache: 'no-cache' });
    if (r.ok) {
      const d = await r.json();
      const e = (d && d[key]) || {};
      if (L && e.locks) L.locks = e.locks;
      if (Array.isArray(e.diary)) return e.diary;
    }
  } catch (e) { /* 読めない時は今日の分だけ */ }
  return L && L.diaryLast ? [L.diaryLast] : [];
}

export function nav(current) {
  const items = [['index.html', '町'], ['history.html', '歴史'], ['vote.html', '投票'], ['people.html', '村人'], ['relations.html', '関係'], ['fish.html', '釣り'], ['badges.html', 'バッジ']];
  const el = document.createElement('header');
  el.className = 'site-head';
  // 町のページは「./」で開く（URL の末尾に index.html が付かないように）
  const link = (h) => (h === 'index.html' ? './' : h);
  el.innerHTML = '<a class="brand" href="./">はじまり島</a><nav>' +
    items.map(([h, t]) => `<a href="${link(h)}"${h === current ? ' class="on"' : ''}>${t}</a>`).join('') + '</nav>';
  document.body.prepend(el);
}

// 村人が 0 人の時の案内（どの画面でも同じ言葉）
export const emptyText = (config) => `まだだれもいません。フォローしてコメントに『${(config && config.joinWord) || '住みたい'}』で、すぐ村人に`;
export function emptyNote(config) { return `<p class="empty">${esc(emptyText(config))}</p>`; }

// 0 日目（町が始まる前）の案内。config.startAt（日本時間）が決まっていれば、その日時も出す。1 日目より後は ''
export function startAtMs(s) {
  if (!s) return null;
  let t = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += 'T06:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) t += ':00';
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(t)) t += '+09:00';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}
export function startNote(state, config) {
  if (!state || state.day >= 1) return '';
  const ms = startAtMs(config && config.startAt);
  if (ms == null) return '町はまだ始まっていません（0日目）。始まる日は、町のアカウントでお知らせします。';
  const d = new Date(ms + 9 * 3600e3);
  const when = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時${d.getUTCMinutes() ? String(d.getUTCMinutes()).padStart(2, '0') + '分' : ''}`;
  return `町はまだ始まっていません（0日目）。${when}から1日目が始まります。`;
}
// 「住みたい」の案内（どの画面でも同じ言葉）
export const joinText = (config) => `フォローして、インスタの投稿に「${(config && config.joinWord) || '住みたい'}」とコメントすると、すぐ町に住めます（15 分ほどで入居）。` +
  `道具・誕生日・好きな食べ物${mbtiOn(config) ? '・MBTI' : ''}もいっしょに書けます（例「${(config && config.joinWord) || '住みたい'} ピッケル 12/11 りんご${mbtiOn(config) ? ' INFP' : ''}」）。住んだあとも「誕生日 12/11」のようにコメントすれば変えられます。` +
  (config && config.jobChange && config.jobChange.enabled === false ? '' : `仕事も「仕事 釣り」のようにコメントすると変えられます（1 日 ${(config && config.jobChange && config.jobChange.perDay) || 1} 回まで）。`) +
  dmJoinText(config);
// DM で入居（config.dm.enabled の時だけ config.dm.howTo を出す。docs/DMで入居する手順.md）
export const dmJoinText = (config) => (config && config.dm && config.dm.enabled === true && config.dm.howTo ? String(config.dm.howTo) : '');
// MBTI を出すか（config.mbtiOn）。村人の MBTI の文（書いていない人は ''）。例「MBTI：INFP-T」
export const mbtiOn = (config) => !config || config.mbtiOn !== false;
export const mbtiText = (v, config) => (mbtiOn(config) && v && v.mbti ? `MBTI：${v.mbti}${v.mbtiAT ? '-' + v.mbtiAT : ''}` : '');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 称号（v.titles の id → config.titles.list の名前と説明）。バッジの HTML（説明は title 属性）
// 対決投票の称号（js/versus.js の versusTitles。お題ごとに config.versus から作る）も同じように並べる
export const allTitles = (config) => [...((config && config.titles && config.titles.list) || []), ...versusTitles(config)];
export const titlesOf = (v, config) => { const all = allTitles(config); return ((v && v.titles) || []).map((id) => all.find((t) => t.id === id)).filter(Boolean); };
// 村人が持っているバッジを全部（称号バッジ → 技能バッジ config.badges の順）。{ kind, id, name, desc, src, icon }
// 称号の絵は config の img（icons/title_<id>.png）、技能バッジは icons/badge_<id>_<段>.png（はじまりの住人は icons/badge_founder.png）
export function badgeList(v, config, L) {
  const out = titlesOf(v, config).map((t) => ({ kind: 'title', id: t.id, name: t.name, desc: t.desc || '', src: t.img || '', icon: t.icon || '★' }));
  const BG = config && config.badges, got = (L && L.badges) || {};
  if (BG && BG.list) for (const [id, B] of Object.entries(BG.list)) {
    const tr = got[id]; if (tr == null || tr < 0) continue;
    out.push({ kind: 'skill', id, tier: tr, founder: !!B.founder, name: B.founder ? B.name : `${B.name}（${(BG.tierNames || [])[tr] || ''}）`, desc: B.note || '', src: B.founder ? `icons/badge_${id}.png` : `icons/badge_${id}_${tr}.png`, icon: '●' });
  }
  return out;
}
// バッジの絵 1 つ（絵がない称号は印の文字）
export const badgeIcon = (b, size = 24) => (b.src ? `<img class="bdgimg pixel" src="${esc(b.src)}" alt="${esc(b.name)}" width="${size}" height="${size}" loading="lazy" decoding="async">` : `<span class="bdgtxt">${esc(b.icon || '★')}</span>`);
// 小さなバッジの並び（町のカード・住人一覧）。称号が 2 つまでなら名前も出す。それより多い時と技能バッジは絵だけ（名前と説明は title に）
export const titleBadges = (v, config, L) => {
  let list = badgeList(v, config, L);
  // はじまりの称号（金のバッジ）がある人は、同じ意味の「はじまりの住人」バッジは重ねて出さない
  if (list.some((b) => b.kind === 'title' && /はじまり/.test(b.name))) list = list.filter((b) => !b.founder);
  if (!list.length) return '';
  // カードはバッジの絵だけ（名前は押した時・長押しの説明で出す）
  return '<span class="bdgrow">' + list.map((b) => {
    const tip = esc(b.name + (b.desc ? '：' + b.desc : ''));
    return `<span class="bdgi" title="${tip}">${badgeIcon(b, 24)}</span>`;
  }).join('') + '</span>';
};
// いちばん大きい魚（life の fishBest）。「いちばんの大物：コイ 59cm」。釣っていなければ ''
export function bestFishText(L, config) {
  const fb = Object.entries((L && L.fishBest) || {}).sort((a, b) => b[1][0] - a[1][0])[0];
  return fb ? `いちばんの大物：${((config && config.items && config.items[fb[0]]) || {}).name || fb[0]} ${fb[1][0]}cm` : '';
}
export const skinUrl = (n) => 'skins/skin_' + String(n).padStart(3, '0') + '.png';
// 村人のスキンの画像：プロフィールで見た目を決めた人（v.look = { body, seed }）はその場で作る。ほかは番号の画像
const lookCache = {};
export function lookDataUrl(look) {
  const k = look.body + ':' + look.seed;
  if (!lookCache[k]) {
    const s = makeSkin(look.seed, look.body);
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d'), img = g.createImageData(64, 64); img.data.set(s.px); g.putImageData(img, 0, 0);
    lookCache[k] = { url: c.toDataURL('image/png'), slim: s.slim, traits: s.traits };
  }
  return lookCache[k];
}
// 名前やコメントで女性・男性に合わせた人（v.skinBody = 'female' / 'male'）は、同じ番号をシードにしてその体の種類で作る（tools/people.js の fitGenderSkin）
const autoLook = (v) => v.look || (v.skinBody ? { body: v.skinBody, seed: v.skin } : null);
export const skinSrc = (v) => (v && typeof v === 'object' ? (autoLook(v) ? lookDataUrl(autoLook(v)).url : skinUrl(v.skin)) : skinUrl(v));
export const skinSlim = (v) => !!(v && typeof v === 'object' && autoLook(v) && lookDataUrl(autoLook(v)).slim);
export const villagerUrl = (v) => 'villager.html?k=' + encodeURIComponent(v.key);
export const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${y}年${+m}月${+d}日`; };
export const shortDate = (iso) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${+m}/${+d}`; };

const imgCache = {};
export function loadImage(src) {
  if (!imgCache[src]) imgCache[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  return imgCache[src];
}

// スキンを正面・背面の 2D で描く（16x32 ピクセル）
const FRONT = [
  // [sx, sy, w, h, dx, dy]  base
  [8, 8, 8, 8, 4, 0], [20, 20, 8, 12, 4, 8], [44, 20, 4, 12, 0, 8], [36, 52, 4, 12, 12, 8], [4, 20, 4, 12, 4, 20], [20, 52, 4, 12, 8, 20],
];
const FRONT_OV = [[40, 8, 8, 8, 4, 0], [20, 36, 8, 12, 4, 8], [44, 36, 4, 12, 0, 8], [52, 52, 4, 12, 12, 8], [4, 36, 4, 12, 4, 20], [4, 52, 4, 12, 8, 20]];
const BACK = [[24, 8, 8, 8, 4, 0], [32, 20, 8, 12, 4, 8], [44, 52, 4, 12, 0, 8], [52, 20, 4, 12, 12, 8], [28, 52, 4, 12, 4, 20], [12, 20, 4, 12, 8, 20]];
const BACK_OV = [[56, 8, 8, 8, 4, 0], [32, 36, 8, 12, 4, 8], [60, 52, 4, 12, 0, 8], [52, 36, 4, 12, 12, 8], [12, 52, 4, 12, 4, 20], [12, 36, 4, 12, 8, 20]];
// slim：細い腕（3px）のスキン。腕は幅 3 で、背面は元の位置が 1 つ左
export function drawFigure(ctx, img, back = false, scale = 1, ox = 0, oy = 0, slim = false) {
  ctx.imageSmoothingEnabled = false;
  for (const list of back ? [BACK, BACK_OV] : [FRONT, FRONT_OV]) {
    for (let [sx, sy, w, h, dx, dy] of list) {
      if (slim && dy === 8 && w === 4) { w = 3; if (back) sx -= 1; if (dx === 0) dx = 1; }
      ctx.drawImage(img, sx, sy, w, h, ox + dx * scale, oy + dy * scale, w * scale, h * scale);
    }
  }
}
export function drawFace(ctx, img, size) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
  ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
}
// skin：スキンの番号か、村人（見た目を決めた人はその見た目）
export async function faceCanvas(skin, size = 32) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size; c.className = 'pixel';
  loadImage(skinSrc(skin)).then((img) => drawFace(c.getContext('2d'), img, size));
  return c;
}

// 体力（ハート）とおなか（肉）のゲージ。マイクラのように 10 個のアイコン、1 つで 2。半分も描く
const ICON_PX = {
  heart: ['.KK...KK.', 'KRRK.KRRK', 'KRWRKRRRK', 'KRRRRRRRK', '.KRRRRRK.', '..KRRRK..', '...KRK...', '....K....'],
  food: ['....KKKK.', '...KBLLBK', '..KBLBBBK', '..KBBBBBK', '..KBBBBK.', '.KWKKKK..', 'KWWK.....', '.KK......'],
};
const ICON_COL = { heart: { K: '#3a0d0d', R: '#d8232a', W: '#ffd4d4', E: '#4a3a3a' }, food: { K: '#3d2410', B: '#b5652a', L: '#e09a5c', W: '#efe6d2', E: '#4a4038' } };
const iconCache = {};
function gaugeIcon(kind, fill) { // fill: 2 ぜんぶ・1 半分（左）・0 から
  const k = kind + fill;
  if (iconCache[k]) return iconCache[k];
  const C = ICON_COL[kind]; let r = '';
  ICON_PX[kind].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const on = ch === 'K' || fill === 2 || (fill === 1 && x <= 4);
    r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${on ? C[ch] : C.E}"/>`;
  }));
  return (iconCache[k] = `<svg viewBox="0 0 9 8" width="16" height="14" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`);
}
export function gaugeHtml(kind, val, max = 20) {
  const v = Math.max(0, Math.min(max, Math.round(val ?? max)));
  let s = '';
  for (let i = 0; i < max / 2; i++) s += gaugeIcon(kind, v >= i * 2 + 2 ? 2 : v === i * 2 + 1 ? 1 : 0);
  return `<span class="gauge" role="img" aria-label="${kind === 'heart' ? '体力' : 'おなか'} ${v}/${max}">${s}</span>`;
}

export function showError(e) {
  const d = document.createElement('div');
  d.className = 'wrap';
  d.innerHTML = '<p class="err">読み込みでつまずきました: ' + esc(e.message || e) + '</p>';
  document.body.append(d);
  console.error(e);
}

export function homeName(life, world, config, state) {
  // 拠点の場所の投票中（0 日目）は、たき火もチェストもまだ無い（テントは島のまん中）
  const tent = state && (state.votes || []).some((v) => v.kind === 'base') ? '島のまん中のテント' : 'たき火のそばのテント';
  if (!life.home) return tent;
  const b = world.buildings.find((x) => x.id === life.home);
  if (!b) return tent;
  const same = world.buildings.filter((x) => x.type === b.type);
  return config.buildings[b.type].name + (same.length > 1 ? ' ' + (same.indexOf(b) + 1) + '号' : '');
}
export function buildingLabel(b, world, config) {
  const same = world.buildings.filter((x) => x.type === b.type);
  return config.buildings[b.type].name + (same.length > 1 ? ' ' + (same.indexOf(b) + 1) + '号' : '');
}
