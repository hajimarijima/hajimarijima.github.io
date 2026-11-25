// どのページでも使うもの
import { makeSkin } from './skingen.js';
import { decodeWorld } from './tilemap.js';
import { diaryPath } from './datafiles.js';
export const JOB = { wood: '木を切る', stone: '岩を掘る', food: '食べ物を集める' };
export const RES = { wood: '木材', stone: '石', food: '食べ物' };
export const RES_COLOR = { wood: '#b07a45', stone: '#8d939b', food: '#6aa84f' };
export const ACTION = { level: '村のまん中を整地している', chop: '木を切っている', dig: '岩を掘っている', dig_last: '岩を掘り終えた', berry: '木の実を集めている', till: '畑を耕している', tend: '畑の世話をしている', harvest: '畑で収穫している', forage: '草や実を集めている', fish: '池で釣りをしている', ranch: '柵の動物の世話をしている', rest: 'ケガで休んでいる' };

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
  const items = [['index.html', '町'], ['history.html', '歴史'], ['vote.html', '投票'], ['people.html', '村人'], ['relations.html', '関係'], ['skins.html', 'スキン']];
  const el = document.createElement('header');
  el.className = 'site-head';
  el.innerHTML = '<a class="brand" href="index.html"><span class="brand-pre">みんなで</span>町づくり</a><nav>' +
    items.map(([h, t]) => `<a href="${h}"${h === current ? ' class="on"' : ''}>${t}</a>`).join('') + '</nav>';
  document.body.prepend(el);
}

// 村人が 0 人の時の案内（どの画面でも同じ言葉）
export const emptyText = (config) => `まだだれもいません。コメントに『${(config && config.joinWord) || '参加したい'}』で最初の村人に`;
export function emptyNote(config) { return `<p class="empty">${esc(emptyText(config))}</p>`; }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
export const skinSrc = (v) => (v && typeof v === 'object' ? (v.look ? lookDataUrl(v.look).url : skinUrl(v.skin)) : skinUrl(v));
export const skinSlim = (v) => !!(v && typeof v === 'object' && v.look && lookDataUrl(v.look).slim);
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

export function homeName(life, world, config) {
  if (!life.home) return 'たき火のそばのテント';
  const b = world.buildings.find((x) => x.id === life.home);
  if (!b) return 'たき火のそばのテント';
  const same = world.buildings.filter((x) => x.type === b.type);
  return config.buildings[b.type].name + (same.length > 1 ? ' ' + (same.indexOf(b) + 1) + '号' : '');
}
export function buildingLabel(b, world, config) {
  const same = world.buildings.filter((x) => x.type === b.type);
  return config.buildings[b.type].name + (same.length > 1 ? ' ' + (same.indexOf(b) + 1) + '号' : '');
}
