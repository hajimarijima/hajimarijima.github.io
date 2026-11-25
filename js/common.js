// どのページでも使うもの
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
  return { config, state, villagers, active, world, life, history, social };
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
export function drawFigure(ctx, img, back = false, scale = 1, ox = 0, oy = 0) {
  ctx.imageSmoothingEnabled = false;
  for (const list of back ? [BACK, BACK_OV] : [FRONT, FRONT_OV]) {
    for (const [sx, sy, w, h, dx, dy] of list) ctx.drawImage(img, sx, sy, w, h, ox + dx * scale, oy + dy * scale, w * scale, h * scale);
  }
}
export function drawFace(ctx, img, size) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
  ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
}
export async function faceCanvas(skin, size = 32) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size; c.className = 'pixel';
  loadImage(skinUrl(skin)).then((img) => drawFace(c.getContext('2d'), img, size));
  return c;
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
