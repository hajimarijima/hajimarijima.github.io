// 村人の見た目（64×64・マイクラと同じ配置のスキン）を、1 つの数（シード）から作る。サイトと node（tools/gen_skins.js）で共通。
// 同じシード・同じ体の種類なら、いつも同じスキンになる。既存のスキンは写さず、すべてここの組み合わせで作る。
// 体の種類：male（男性）/ female（女性）/ none（指定なし）。女性は髪が長めの形が多く、服の形も変わり、腕は細い 3px（slim 型）。
// 色は「合う組み合わせの表」（OUTFITS）から選ぶので、派手すぎたり、にごった色の組み合わせは出ない。
export const BODIES = ['none', 'male', 'female'];
export const BODY_LABEL = { none: '指定なし', male: '男性', female: '女性' };
const W = 64;

// ---------- 乱数（シードつき） ----------
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function makeRng(seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    range: (x, y) => x + r() * (y - x), pick: (arr) => arr[Math.floor(r() * arr.length)], chance: (p) => r() < p,
    weighted(items) { let s = 0; for (const it of items) s += it[1]; let x = r() * s; for (const it of items) { x -= it[1]; if (x < 0) return it[0]; } return items[items.length - 1][0]; },
  };
}

// ---------- 色 ----------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const SKIN_TONES = ['#ffe2c8', '#f6cfae', '#ebbd97', '#dca77c', '#c68c62', '#a8714b', '#86553a', '#64402c'].map(hex);
// 髪の色：自然な色が中心。明るすぎる色はまれ（青・緑・紫は出さない）
const HAIR = [
  ['黒', '#2a2428', 10], ['こげ茶', '#4a3024', 10], ['茶', '#74492c', 9], ['くり色', '#8e5530', 6],
  ['明るい茶', '#a8784a', 5], ['金', '#d9b062', 4], ['白金', '#e6dcbc', 1.5], ['赤毛', '#bb5a2a', 3],
  ['赤茶', '#7f2e26', 3], ['灰', '#8f9096', 1.5], ['白', '#d8d8de', 1], ['桃', '#d88aa8', 0.5],
].map(([n, c, w]) => ({ name: n, c: hex(c), w }));
const C = (name, h) => ({ name, c: hex(h) });
const WHITE = C('白', '#ecebe4'), CREAM = C('生成り', '#d9c9a3'), CHAR = C('炭', '#34343e'), BLACK = C('黒', '#2a2a30'), GRAY = C('灰', '#9aa0a8');
const JEANS = C('ジーンズ', '#46649a'), DJEANS = C('紺のジーンズ', '#324678'), KHAKI = C('カーキ', '#a8966c'), BROWN = C('茶', '#644630');
const NAVY = C('紺', '#2c3e6e'), OLIVE = C('オリーブ', '#5f6e3a'), DGRAY = C('灰', '#62666e'), BEIGE = C('ベージュ', '#c8b896');
// 合う組み合わせの表：シャツ・上着・下・くつ・小物の色。同じ組の中から選ぶ
const OUTFITS = [
  { name: '土の色', shirt: [CREAM, WHITE], shirt2: [C('こげ茶', '#80583a')], top: [C('こげ茶', '#7a5536'), OLIVE], low: [BROWN, KHAKI, DJEANS], shoes: ['#5a3c28', '#3a2a20'], acc: ['#c8a46e', '#7a9c6e'] },
  { name: '紺と白', shirt: [WHITE, C('空色', '#a9c8e6')], shirt2: [NAVY], top: [NAVY, C('紺', '#283c6e')], low: [JEANS, DGRAY, BEIGE], shoes: ['#242226', '#dcdcd6'], acc: ['#c43c3c', '#e0b648'] },
  { name: '森', shirt: [CREAM, C('若草', '#a8c47a')], shirt2: [C('緑', '#3f7a52')], top: [C('緑', '#3f7a52'), C('こげ茶', '#6e4e32')], low: [BROWN, CHAR, KHAKI], shoes: ['#5a3c28', '#242226'], acc: ['#e0b648', '#c8a46e'] },
  { name: 'ベリー', shirt: [WHITE, C('桃', '#e3a0ae')], shirt2: [C('えんじ', '#8e2a3c')], top: [C('えんじ', '#8e2a3c'), CHAR], low: [NAVY, BLACK, DJEANS], shoes: ['#242226', '#8e2a3c'], acc: ['#ecebe4', '#e3a0ae'] },
  { name: 'ひまわり', shirt: [C('黄', '#e8c75a'), WHITE], shirt2: [C('青', '#3c64b4')], top: [C('青', '#3c64b4'), CREAM], low: [JEANS, BEIGE, DJEANS], shoes: ['#dcdcd6', '#5a3c28'], acc: ['#3c64b4', '#c43c3c'] },
  { name: 'モノトーン', shirt: [WHITE, GRAY], shirt2: [BLACK], top: [CHAR, BLACK], low: [BLACK, DGRAY, CHAR], shoes: ['#242226', '#dcdcd6'], acc: ['#c43c3c', '#ecebe4'] },
  { name: '海', shirt: [WHITE, C('青緑', '#5aa8b4')], shirt2: [NAVY], top: [NAVY, C('青緑', '#3f8a96')], low: [BEIGE, JEANS, WHITE], shoes: ['#dcdcd6', '#3c4a6e'], acc: ['#e0b648', '#ecebe4'] },
  { name: '秋', shirt: [C('だいだい', '#d48a3a'), CREAM], shirt2: [C('茶', '#80583a')], top: [C('茶', '#80583a'), OLIVE], low: [OLIVE, NAVY, BROWN], shoes: ['#5a3c28', '#3a2a20'], acc: ['#9c2a3c', '#e0b648'] },
  { name: 'ラベンダー', shirt: [WHITE, C('うす紫', '#b9a6d6')], shirt2: [C('紫', '#6a4f9a')], top: [C('紫', '#6a4f9a'), GRAY], low: [DGRAY, NAVY, BEIGE], shoes: ['#242226', '#dcdcd6'], acc: ['#ecebe4', '#e3a0ae'] },
  { name: '赤と黒', shirt: [WHITE, C('赤', '#c43c3c')], shirt2: [BLACK], top: [BLACK, C('赤', '#b03838')], low: [JEANS, BLACK, DJEANS], shoes: ['#242226', '#a83232'], acc: ['#ecebe4', '#e0b648'] },
  { name: 'パステル', shirt: [C('空色', '#b4d2ec'), C('桃', '#f0c0c8')], shirt2: [CREAM], top: [CREAM, C('うす緑', '#bcd8b0')], low: [BEIGE, GRAY, C('白っぽい', '#e6e2d6')], shoes: ['#dcdcd6', '#c8a46e'], acc: ['#e3a0ae', '#86b8e2'] },
  { name: '畑', shirt: [C('赤', '#b44a3a'), CREAM], shirt2: [C('こげ茶', '#80583a')], top: [C('ジーンズ', '#46649a'), KHAKI], low: [DJEANS, BROWN, KHAKI], shoes: ['#5a3c28', '#3a2a20'], acc: ['#e6c878', '#f0ece0'] },
];
const EYES = ['#5a3c28', '#28202a', '#3c6ebe', '#3c8250', '#6e7882', '#b4782a'].map(hex);
const LEATHER = hex('#5e3e26');
const GOLD = hex('#e0b648');

// ---------- 描く道具 ----------
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// 明るさを変える。暗い所は青み、明るい所は黄みへ少し寄せる（のっぺり防止）
function tone(c, f) {
  if (f >= 1) { const k = f - 1; return [c[0] * f + k * 40, c[1] * f + k * 26, c[2] * f + k * 2]; }
  const k = 1 - f;
  return [c[0] * f - k * 10, c[1] * f - k * 6, c[2] * f + k * 26];
}
const FACE_LIGHT = { top: 1.1, front: 1.0, left: 0.9, right: 0.86, back: 0.8, bottom: 0.68 };
function faceRects(px, py, w, h, d) {
  return {
    top: [px + d, py, w, d], bottom: [px + d + w, py, w, d],
    right: [px, py + d, d, h], front: [px + d, py + d, w, h],
    left: [px + d + w, py + d, d, h], back: [px + 2 * d + w, py + d, w, h],
  };
}
class Canvas {
  constructor(seed) { this.px = new Uint8Array(W * W * 4); this.seed = seed; }
  noise(x, y) { return ((hashStr(this.seed + ':' + x + ',' + y) % 1000) / 1000) * 2 - 1; }
  put(x, y, c, amp = 0.03) {
    const n = 1 + this.noise(x, y) * amp, i = (y * W + x) * 4;
    this.px[i] = clamp(c[0] * n); this.px[i + 1] = clamp(c[1] * n); this.px[i + 2] = clamp(c[2] * n); this.px[i + 3] = 255;
  }
  // 箱の 6 面を塗る。fn(面, u, v, 幅, 高さ) が色か null を返す
  paint(origin, dims, fn, light = true) {
    const rects = faceRects(origin[0], origin[1], dims[0], dims[1], dims[2]);
    for (const face in rects) {
      const [x0, y0, fw, fh] = rects[face];
      for (let v = 0; v < fh; v++) for (let u = 0; u < fw; u++) {
        const r = fn(face, u, v, fw, fh);
        if (!r) continue;
        const c = Array.isArray(r) ? r : r.c, amp = Array.isArray(r) ? 0.03 : (r.amp ?? 0.03);
        let f = light ? FACE_LIGHT[face] : 1;
        if (light && face !== 'top' && face !== 'bottom') f *= 1.04 - 0.08 * (v / Math.max(1, fh - 1)); // 側面は上が明るく下が暗い
        this.put(x0 + u, y0 + v, tone(c, f), amp);
      }
    }
  }
}
// 部位の場所（64x64 の配置）
const P = {
  head: [0, 0], hat: [32, 0], body: [16, 16], jacket: [16, 32],
  rarm: [40, 16], rsleeve: [40, 32], larm: [32, 48], lsleeve: [48, 48],
  rleg: [0, 16], rpants: [0, 32], lleg: [16, 48], lpants: [0, 48],
  // ツインテールの房（2×8×2 の小さな箱。マイクラのスキンで使われていない x56〜63・y16〜25。js/character.js が胸の両横に置く）
  tails: [56, 16],
};
const HEAD = [8, 8, 8], BODY = [8, 12, 4], LIMB = [4, 12, 4], LIMB_SLIM = [3, 12, 4];

// ---------- 髪型（fr: 正面の列ごとの髪の深さ、sf: 横の前側、bk: うしろ）。w は [指定なし, 男性, 女性] の出やすさ ----------
const HAIR_STYLES = [
  { id: 'short', name: 'ショート', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 2, bk: 4, w: [10, 10, 1.5] },
  { id: 'bangs', name: 'ぱっつん', fr: [3, 3, 3, 3, 3, 3, 3, 3], sf: 5, bk: 6, w: [6, 1.5, 5] },
  { id: 'sidepart', name: '七三', fr: [3, 3, 2, 1, 1, 1, 1, 2], sf: 3, bk: 5, w: [8, 8, 2] },
  { id: 'swept', name: '流し前髪', fr: [1, 1, 1, 2, 2, 3, 3, 3], sf: 3, bk: 5, w: [7, 7, 3] },
  { id: 'long', name: 'ロング', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 8, bk: 8, body: 5, w: [6, 0.4, 8] },
  { id: 'longbangs', name: 'ロング前髪', fr: [3, 3, 3, 2, 2, 3, 3, 3], sf: 8, bk: 8, body: 6, w: [5, 0.2, 7] },
  { id: 'bob', name: 'ボブ', fr: [2, 2, 2, 2, 2, 2, 2, 2], sf: 6, bk: 6, w: [6, 0.6, 7] },
  { id: 'ponytail', name: 'ポニーテール', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 3, bk: 5, tail: true, w: [6, 0.6, 7] },
  { id: 'spiky', name: 'つんつん', fr: [2, 1, 2, 1, 2, 1, 2, 1], sf: 2, bk: 3, tufts: true, w: [6, 7, 0.6] },
  { id: 'curly', name: 'くせ毛', fr: [2, 2, 3, 2, 2, 3, 2, 2], sf: 4, bk: 6, curly: true, w: [5, 4, 4] },
  { id: 'bun', name: 'おだんご', fr: [2, 1, 1, 1, 1, 1, 1, 2], sf: 3, bk: 5, bun: true, w: [4, 0.5, 5] },
  { id: 'buzz', name: 'ぼうず', fr: [1, 1, 1, 1, 1, 1, 1, 1], sf: 1, bk: 2, buzz: true, w: [3, 4, 0.2] },
  { id: 'bald', name: 'つるつる', fr: [0, 0, 0, 0, 0, 0, 0, 0], sf: 0, bk: 0, bald: true, w: [1, 1.5, 0] },
];

// 女の子らしい髪型の変わり種。もとの髪型（ロング・ポニーテール・ぱっつん）から、番号で決まる（乱数を使わない）。
//   body：胴の重ね層の背中に垂れる段数（ロング 5〜6＝肩甲骨、セミロング 2＝肩）。braid：三つ編み（back＝背中、front＝右肩の前）。twin：ツインテール
const HAIR_VARIANTS = {
  semilong: { id: 'semilong', name: 'セミロング', sf: 8, bk: 8, body: 2 },
  braid: { id: 'braid', name: '三つ編み', sf: 6, bk: 8, body: 0, braid: 'back' },
  braidf: { id: 'braid', name: '三つ編み（肩の前）', sf: 6, bk: 8, body: 0, braid: 'front' },
  twintail: { id: 'twintail', name: 'ツインテール', sf: 3, bk: 5, tail: false, twin: true },
  // 姫カット：前髪は 2 段（まゆとの間に肌が 1 段見える＝肌の濃い子でも顔が暗くならない）。顔の横の房はあごの上まで
  hime: { id: 'hime', name: '姫カット', fr: [2, 2, 2, 2, 2, 2, 2, 2], sf: 8, bk: 8, body: 4 },
  // 女の子のショート：耳が出る短さ。前髪はまん中が少し長く丸い、えり足もまん中が長い丸み（bkr：うしろの列ごとの深さ）
  fshort: { id: 'fshort', name: 'ショート', fr: [2, 2, 3, 3, 3, 3, 2, 2], sf: 2, bk: 5, bkr: [4, 5, 6, 6, 6, 6, 5, 4], tufts: false, curly: false, buzz: false, round: true },
};
const LONGISH = ['long', 'longbangs', 'semilong', 'hime', 'braid'];
const GIRLISH = ['long', 'longbangs', 'semilong', 'hime', 'braid', 'bob', 'ponytail', 'twintail', 'bun', 'bangs'];
const SIDE_LEN = { long: 8, longbangs: 8, hime: 6, semilong: 8, braid: 6, bob: 6, bangs: 6, twintail: 8, fshort: 3 };
// 若い女の子の明るい髪色（白・灰の代わり）
const YOUNG_HAIR = [['薄い金', '#ecd08a'], ['薄い桃', '#eba0bd'], ['薄い水色', '#8fcbe8'], ['薄い紫', '#b69ce0']].map(([n, c]) => ({ name: n, c: hex(c) }));
function hairVariant(s, body, seed) {
  if (body === 'male') return s;
  const h = hashStr('hairvar:' + body + ':' + seed);
  let k = '';
  if (s.id === 'long' || s.id === 'longbangs') k = ['', '', 'semilong', 'braid', 'braidf'][h % 5];
  else if (s.id === 'ponytail') k = ['', 'twintail'][h % 2];
  else if (s.id === 'bangs' && body === 'female') k = ['', 'hime'][h % 2];
  else if (body === 'female' && ['short', 'sidepart', 'swept', 'spiky', 'buzz'].includes(s.id)) k = 'fshort'; // 男の子の短髪は女の子には使わない
  return k ? { ...s, ...HAIR_VARIANTS[k] } : s;
}

// seed：数（0 以上の整数）か文字列。body：'none' / 'male' / 'female'
export function makeSkin(seed, body = 'none') {
  if (!BODIES.includes(body)) body = 'none';
  const bi = BODIES.indexOf(body);
  const R = makeRng('town-skin-' + body + '-' + seed);
  const S = new Canvas('s' + body + seed);
  const traits = [];
  const female = body === 'female', male = body === 'male';
  const slim = female; // 女性は細い腕（3px）

  const skin = R.pick(SKIN_TONES);
  const hairDef0 = R.weighted(HAIR.map((h) => [h, h.w]));
  const baseStyle = R.weighted(HAIR_STYLES.map((s) => [s, s.w[bi]]));
  const style = hairVariant(baseStyle, body, seed); // 女性・長い髪の人は、セミロング・三つ編み・ツインテール・姫カット・女の子のショートにもなる（乱数は使わない＝ほかの見た目は変わらない）
  // 若い女の子に白・灰の髪はおばあさんに見えるので、薄い金・薄い桃・薄い水色・薄い紫（色味のはっきりした明るい色）に置きかえる（番号で決まる）
  const girlish = female || (body === 'none' && GIRLISH.includes(style.id));
  const hairDef = girlish && (hairDef0.name === '白' || hairDef0.name === '灰') ? YOUNG_HAIR[hashStr('haircol:' + body + ':' + seed) % YOUNG_HAIR.length] : hairDef0;
  const hair = hairDef.c;
  const eye = R.pick(EYES);
  traits.push('体: ' + BODY_LABEL[body]);
  traits.push('髪: ' + style.name + '・' + hairDef.name);
  const strand = Array.from({ length: 32 }, () => R.range(0.9, 1.08)); // 列ごとの髪の色むら（毛の束）
  const hairDark = tone(hair, 0.62);

  // 服：合う組み合わせの表から 1 組を選び、その中から色を選ぶ
  const O = R.pick(OUTFITS);
  const shirt = R.pick(O.shirt), shirt2 = R.pick(O.shirt2);
  const pattern = R.weighted([['plain', 6], ['stripe', 2], ['twotone', 2], ['buttons', 2]]);
  const longSleeve = R.chance(0.55);
  const bottom = R.weighted(female ? [['pants', 3], ['shorts', 1], ['skirt', 6]] : male ? [['pants', 8], ['shorts', 2.5]] : [['pants', 7], ['shorts', 2], ['skirt', 2]]);
  const dress = female && bottom === 'skirt' && R.chance(0.35); // ワンピース（上と下が同じ色）
  let top = dress ? 'none' : R.weighted(female ? [['none', 5], ['jacket', 2], ['vest', 1], ['hoodie', 2], ['cardigan', 3]] : [['none', 5], ['jacket', 3], ['vest', 2], ['hoodie', 2], ['cardigan', 1]]);
  let topColor = R.pick(O.top); if (topColor === shirt) topColor = O.top[(O.top.indexOf(topColor) + 1) % O.top.length];
  const pants = R.pick(O.low);
  const skirtDef = dress ? shirt : R.pick(O.low.concat(O.top));
  const skirtColor = skirtDef.c;
  const overalls = !female && top === 'none' && R.chance(0.16);
  const apron = !overalls && !dress && R.chance(0.14);
  const apronColor = hex(R.pick(O.acc.concat(['#f0ece0'])));
  const belt = !overalls && !apron && !dress && top !== 'hoodie' && R.chance(female ? 0.6 : 0.5);
  const shoes = hex(R.pick(O.shoes));
  const boots = R.chance(female ? 0.35 : 0.3);
  const scarf = R.chance(0.1);
  const scarfColor = hex(R.pick(O.acc));
  const neckV = R.chance(0.4);
  const topName = { none: '', jacket: '上着', vest: 'ベスト', hoodie: 'パーカー', cardigan: 'カーディガン' }[top];
  traits.push('服: ' + (dress ? shirt.name + 'のワンピース' : shirt.name + 'のシャツ' + (topName ? '・' + topColor.name + 'の' + topName : '') + (overalls ? '・つなぎ' : '')) + '（' + O.name + '）');
  if (!dress) traits.push((bottom === 'skirt' ? 'スカート' : bottom === 'shorts' ? '半ズボン' : 'ズボン') + ': ' + (bottom === 'skirt' ? skirtDef.name : pants.name));

  // 顔
  const eyeStyle = R.weighted(female ? [['white', 3], ['big', 5], ['dot', 1]] : [['white', 5], ['big', 3], ['dot', 2]]);
  const mouth = R.weighted([['line', 4], ['smile', 3], ['small', 2], ['open', 1]]);
  const blush = R.chance(female ? 0.5 : 0.25);
  const freckles = R.chance(0.1);
  const lashes = female && R.chance(0.8);
  const facial = male && (style.bald || style.buzz || R.chance(0.25)) ? R.weighted([['none', 2], ['mustache', 1], ['beard', 1.2]]) : body === 'none' && R.chance(0.06) ? 'mustache' : 'none';

  // 小物（重ねる層）
  const hat = R.weighted(female ? [['none', 10], ['beanie', 2], ['straw', 1.5], ['headband', 2.5], ['bandana', 1], ['flower', 2.5], ['ribbon', 2.5]] : male ? [['none', 10], ['cap', 3], ['beanie', 2], ['straw', 1.5], ['headband', 1], ['bandana', 1.5]] : [['none', 10], ['cap', 2], ['beanie', 2], ['straw', 1.5], ['headband', 1.5], ['bandana', 1.2], ['flower', 1]]);
  const hatColor = R.chance(0.5) ? hex(R.pick(O.acc)) : R.pick(O.top).c;
  const glasses = R.chance(0.15);
  const glassColor = R.pick([hex('#2a2a2e'), hex('#7a4a2a'), hex('#b0b4bc'), hex('#a83a3a')]);
  const watch = R.chance(0.12);
  const hatName = { none: '', cap: '帽子', beanie: 'ニット帽', straw: '麦わら帽子', headband: 'ヘアバンド', bandana: 'バンダナ', flower: '花かざり', ribbon: 'リボン' }[hat];
  const extras = [hatName, glasses ? 'めがね' : '', apron ? 'エプロン' : '', scarf ? 'マフラー' : '', watch ? 'うで時計' : ''].filter(Boolean);
  if (extras.length) traits.push('小物: ' + extras.join('・'));

  // ---------- 頭 ----------
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  function hairDepth(face, u) {
    if (style.bald) return 0;
    if (face === 'front') return style.fr[u];
    if (face === 'right') return lerp(style.bk, Math.max(style.sf, style.fr[0]), u / 7);
    if (face === 'left') return lerp(Math.max(style.sf, style.fr[7]), style.bk, u / 7);
    if (face === 'back') return style.bkr ? style.bkr[u] : style.bk;
    return 0;
  }
  function hairPx(face, u, v, depth) {
    let f = strand[(face.length * 7 + u * 3) % 32];
    if (depth > 0 && v === depth - 1) f *= 0.8;
    if (v === 0 && face !== 'top') f *= 1.06;
    if (style.curly && ((u + v * 3) % 4 === 0)) f *= 0.82;
    if (style.buzz) return { c: mix(tone(hair, f * 0.9), skin, 0.35), amp: 0.08 };
    return { c: tone(hair, f), amp: style.curly ? 0.07 : 0.04 };
  }
  const seedNum = hashStr(String(seed)) % 997;
  // 肌の濃い女の子：まゆは肌になじむ色、前髪の下の影は薄く（顔が暗く沈まないように）
  const darkGirl = girlish && (skin[0] + skin[1] + skin[2]) / 3 < 130;
  // 長い髪とボブは、顔の両はしにも髪がかかる（正面から見ても長い髪と分かる）
  //   女性はどの髪型でも、顔の両横に少し髪がかかる（目の列はかくさない）
  let sideLen = SIDE_LEN[style.id] || ((style.tail || style.bun) && female ? 5 : 0);
  if (female && !sideLen && !style.bald && !style.buzz) sideLen = 4;
  // 三つ編み・ツインテールの結び目（リボンか花かざりの人はその色、ほかは赤いゴム）
  const tieC = hat === 'ribbon' || hat === 'flower' ? hatColor : hex('#c8404e');
  // 三つ編みの編み目（明暗が斜めに互い違い）
  const braidPx = (u, v) => ({ c: tone(hair, strand[(v * 3 + u) % 32] * ((u + v) % 2 ? 0.8 : 1.1)), amp: 0.04 });
  S.paint(P.head, HEAD, (face, u, v) => {
    if (face === 'top') {
      if (style.bald) return tone(skin, 1.05);
      let f = strand[(u * 5 + v) % 32];
      if (u + v >= 2 && u + v <= 4) f *= 1.12;
      if (style.id === 'sidepart' && u === 5) f *= 0.75;
      if (style.buzz) return { c: mix(tone(hair, f * 0.9), skin, 0.35), amp: 0.08 };
      return { c: tone(hair, f), amp: 0.05 };
    }
    if (face === 'bottom') return tone(skin, 0.85);
    const d = hairDepth(face, u);
    if (v < d) return hairPx(face, u, v, d);
    let c = skin, f = 1;
    if (face === 'front' && sideLen && (u === 0 || u === 7) && v < sideLen) return hairPx(face, u, v, sideLen);
    if (v === d && d > 0) f *= darkGirl ? 0.96 : 0.86; // 前髪の下の影（肌の濃い女の子は薄く＝顔が暗くならない）
    if (face === 'front') {
      if (v === 4) {
        if (eyeStyle === 'white') { if (u === 1 || u === 6) return [244, 244, 246]; if (u === 2 || u === 5) return tone(eye, 0.9); }
        else if (eyeStyle === 'big') { if (u === 1 || u === 6) return tone(eye, 1.15); if (u === 2 || u === 5) return tone(eye, 0.75); }
        else if (u === 2 || u === 5) return [36, 30, 36];
      }
      if (v === 3 && (u === 1 || u === 2 || u === 5 || u === 6)) return darkGirl ? tone(mix(hairDark, skin, 0.35), 1.05) : eyeStyle === 'big' || lashes ? hairDark : tone(mix(hairDark, skin, style.bald ? 0.5 : 0.15), 1);
      if (lashes && v === 4 && (u === 0 || u === 7) && d <= 4) return tone(hairDark, 0.9); // まつ毛（目じり）
      if (facial === 'mustache' && v === 5 && u >= 2 && u <= 5) return tone(hair, 0.85);
      if (facial === 'beard' && v >= 6 && !(v === 6 && (u === 3 || u === 4))) return { c: tone(hair, 0.85 + (v === 7 ? -0.1 : 0)), amp: 0.06 };
      if (facial === 'beard' && v === 5 && (u === 0 || u === 7)) return tone(hair, 0.85);
      if (v === 5 && u === 4 && facial !== 'mustache') f *= 0.9;
      if (v === 5 && u === 3 && facial !== 'mustache') f *= 1.03;
      const lip = mix(tone(skin, 0.7), female ? [196, 82, 96] : [170, 70, 70], female ? 0.5 : 0.35);
      if (mouth === 'line' && v === 6 && (u === 3 || u === 4)) return lip;
      if (mouth === 'small' && v === 6 && u === 4) return lip;
      if (mouth === 'smile') { if (v === 6 && u >= 3 && u <= 4) return lip; if (v === 5 && (u === 2 || u === 5) && facial === 'none') return mix(lip, skin, 0.4); }
      if (mouth === 'open' && v === 6 && (u === 3 || u === 4)) return u === 3 ? [110, 40, 46] : [150, 60, 64];
      if (blush && v === 5 && (u === 1 || u === 6)) c = mix(skin, [236, 120, 120], 0.35);
      if (freckles && v === 5 && (u === 1 || u === 2 || u === 5 || u === 6) && ((u + seedNum) % 2 === 0)) f *= 0.84;
      if (v === 7) f *= 0.94;
      if (u === 0 || u === 7) f *= 0.95;
    } else {
      const earU = face === 'right' ? 4 : 3;
      if ((v === 4 || v === 5) && u === earU) f *= 0.88;
      if (v === 4 && u === earU + (face === 'right' ? 1 : -1)) f *= 0.94;
      if (v >= 6) f *= 0.95;
      if (face === 'back' && style.tail && (u === 3 || u === 4) && v >= d) return hairPx('back', u, v, 9);
    }
    return { c: tone(c, f), amp: 0.025 };
  });
  // 頭の重ね層：帽子・めがね・髪のボリューム
  S.paint(P.hat, HEAD, (face, u, v) => {
    if (face === 'bottom') return null;
    if (hat === 'cap') {
      if (face === 'top') return tone(hatColor, (u + v) % 5 === 0 ? 0.9 : 1);
      if (v <= 1) return face === 'back' && v === 1 && (u === 3 || u === 4) ? null : tone(hatColor, v === 1 ? 0.9 : 1);
      if (face === 'front' && v === 2) return tone(hatColor, 0.65);
    } else if (hat === 'beanie') {
      if (face === 'top') return (u === 3 || u === 4) && (v === 3 || v === 4) ? tone(hatColor, 1.25) : { c: tone(hatColor, u % 2 ? 0.94 : 1), amp: 0.05 };
      if (v <= 2) return tone(hatColor, v === 2 ? 1.12 : (u % 2 ? 0.9 : 1));
    } else if (hat === 'straw') {
      const straw = hex('#e6c878');
      if (face === 'top') return { c: tone(straw, (u + v) % 2 ? 0.94 : 1.02), amp: 0.06 };
      if (v === 0) return tone(straw, 0.98);
      if (v === 1) return tone(hatColor, 0.9);
      if (v === 2) return { c: tone(straw, 0.86), amp: 0.06 };
    } else if (hat === 'headband' && female) {
      // カチューシャ：頭の上を耳から耳へ渡る細い輪（前髪と顔は見える）
      if (face === 'top' && v === 3) return tone(hatColor, u % 3 === 1 ? 1.12 : 1);
      if ((face === 'right' && u === 5) || (face === 'left' && u === 2)) { if (v <= 3) return tone(hatColor, v === 3 ? 0.85 : 0.95); }
    } else if (hat === 'headband') {
      if (face !== 'top' && v === 1) return tone(hatColor, 1);
    } else if (hat === 'bandana') {
      if (face === 'top') return tone(hatColor, (u * v) % 3 === 0 ? 1.1 : 1);
      if (v === 0) return tone(hatColor, 1);
      if (face === 'back' && (u === 3 || u === 4) && v <= 3) return tone(hatColor, 0.85);
    } else if (hat === 'flower') {
      if (face === 'left' && v === 1 && u === 1) return [250, 250, 250];
      if (face === 'left' && ((v === 0 && u === 1) || (v === 2 && u === 1) || (v === 1 && (u === 0 || u === 2)))) return tone(hatColor, 1.15);
    } else if (hat === 'ribbon') { // 頭の横のリボン
      if (face === 'left' && v <= 2 && (u === 1 || u === 3)) return tone(hatColor, v === 1 ? 1.1 : 0.95);
      if (face === 'left' && v === 1 && u === 2) return tone(hatColor, 0.8);
      if (face === 'top' && u === 7 && (v === 3 || v === 4)) return tone(hatColor, 1);
    }
    if (glasses && face === 'front') {
      if (v === 3 && (u === 1 || u === 2 || u === 5 || u === 6)) return glassColor;
      if (v === 4 && (u === 0 || u === 3 || u === 4 || u === 7)) return glassColor;
    }
    if (glasses && (face === 'left' || face === 'right') && v === 4) { const nearFront = face === 'right' ? u >= 5 : u <= 2; if (nearFront) return tone(glassColor, 0.9); }
    return overHair(face, u, v);
  }, true);
  // 重ね層の髪（マイクラの上手なスキンのように、頭の外側にもう 1 枚の髪をかぶせて厚みを出す）。
  //   下の頭にも同じ所に髪があるので、浮いた点はできない。毛先は 1 マスおきに抜いて、下の髪が影のように見える。
  //   正面は前髪だけ（上から 3 段まで。まゆ・目・口は見える）。帽子の所は帽子が先（帽子の下からのぞく髪だけ）。
  //   色は 明（つや）・中・暗（毛先）の 3〜4 段と、列ごとの毛の束のむら
  function overHair(face, u, v) {
    if (style.bald || style.buzz) return null;
    const capped = hat !== 'none' && hat !== 'ribbon' && hat !== 'flower' && hat !== 'headband';
    const amp = style.curly ? 0.08 : 0.05;
    const H = (f) => ({ c: tone(hair, f), amp });
    const tipSkip = (k) => ((k + seedNum) % 2) === 0; // 毛先を抜くか（1 マスおき）
    const long = LONGISH.includes(style.id);
    if (face === 'top') {
      if (capped) return null;
      if (style.bun && u >= 3 && u <= 4 && v >= 2 && v <= 4) return tone(hair, v === 2 ? 1.12 : 0.92);
      let f = strand[(u * 3 + v * 5) % 32];
      if (u + v >= 3 && u + v <= 5 && v <= 4) f *= 1.16; // つや（前寄りの斜めの帯）
      else if (u === 0 || u === 7 || v === 7) f *= 0.9;
      if (style.id === 'sidepart' && u === 5) f *= 0.72; // 分け目
      if (style.curly && (u + v) % 2) f *= 0.86;
      if (style.tufts && (u + v) % 3 === 0) f *= 1.1;
      return H(f);
    }
    if (face === 'front') {
      // 顔の両はしにかかる長い髪
      if (sideLen && (u === 0 || u === 7) && v < sideLen) {
        if (v === sideLen - 1 && tipSkip(u)) return null;
        return H(strand[u + 3] * (v === 0 ? 1.08 : v >= sideLen - 1 ? 0.76 : v >= sideLen - 3 ? 0.9 : 1));
      }
      if (capped) return null;
      const d = Math.min(3, style.fr[u]);
      if (v >= d) return null;
      if (d >= 2 && v === d - 1 && tipSkip(u + v)) return null; // 前髪の毛先はぎざぎざ
      return H(strand[(u * 5 + 2) % 32] * (v === 0 ? 1.1 : v === d - 1 ? 0.78 : 0.95));
    }
    if (face === 'bottom') return null;
    // 横とうしろ
    let d = hairDepth(face, u);
    if (long) d = 8;
    const k = face === 'back' ? u : u + 11;
    // 三つ編み（うしろ）：うしろの下 3 段のまん中は編み目。胴の重ね層へ続く
    if (face === 'back' && style.braid === 'back' && (u === 3 || u === 4) && v >= 5) return braidPx(u, v);
    // 三つ編み（肩の前）：右横の前寄りの下を通って、胴の前へ
    if (face === 'right' && style.braid === 'front' && u >= 6 && v >= 4) return braidPx(u, v);
    // ツインテール：横の前寄り（耳の前）に結び目と束。下は胸の両横の房の箱（tails）へ続く
    if (style.twin && ((face === 'right' && (u === 5 || u === 6)) || (face === 'left' && (u === 1 || u === 2))) && v >= 2) {
      if (v === 2) return tone(tieC, 1);
      return H(strand[u + 24] * (v === 3 ? 1.12 : 1));
    }
    // 背中まで続く長い髪は、うしろの下で切らない（胴の重ね層の髪と、首のうしろでつながる）
    const flows = face === 'back' && (style.body || style.braid === 'back');
    if (v < d) {
      if (!flows && d >= 3 && v === d - 1 && tipSkip(k)) return null;
      let f = strand[(k * 3 + face.length) % 32];
      if (v === 1 && (u + seedNum) % 3 !== 0) f *= 1.13; // つやの段
      else if (v === 0) f *= 1.04;
      if (flows) { /* 毛先は胴の重ね層で */ }
      else if (v === d - 1) f *= 0.76; // 毛先は暗く
      else if (v >= d - 3 && d >= 5) f *= 0.9;
      if (style.curly && (u + v * 3) % 4 === 0) f *= 0.82;
      if (style.tufts && v === 0 && u % 2 === 0) f *= 1.1;
      return H(f);
    }
    if (face === 'back' && !capped && style.bun && u >= 3 && u <= 4 && v <= 1) return tone(hair, 0.9);
    // ポニーテール：うしろの結び目と、下へたれる束
    if (face === 'back' && style.tail && (u === 3 || u === 4)) {
      if (v === d) return tone(hairDark, 0.9);
      return H(strand[u + 20] * (u === 3 ? 1.08 : 0.96)); // 毛先は胴の重ね層で
    }
    return null;
  }

  // ---------- 胴 ----------
  const shirtAt = (u, v, face) => {
    let c = shirt.c;
    if (pattern === 'stripe' && v % 3 === 1) c = mix(shirt.c, shirt2.c, 0.75);
    if (pattern === 'twotone' && v <= 3) c = shirt2.c;
    if (pattern === 'buttons' && face === 'front' && u === 3 && (v === 2 || v === 5 || v === 8)) return tone(shirt.c, 0.65);
    if (pattern === 'buttons' && face === 'front' && v === 0 && (u === 2 || u === 5)) c = mix(shirt.c, [255, 255, 255], 0.5);
    return c;
  };
  const torsoColor = (face, u, v) => {
    const lower = bottom === 'skirt' ? skirtColor : pants.c;
    if (v >= 10) return { c: tone(lower, v === 11 ? 0.92 : 1), amp: 0.04 };
    if (dress) { // ワンピース：腰に細いしぼり
      if (v === 7) return tone(shirt.c, 0.82);
      if (face === 'front' && v === 0 && (u === 3 || u === 4)) return tone(skin, 0.88);
      return { c: tone(shirt.c, face === 'front' && (u === 0 || u === 7) ? 0.92 : 1), amp: 0.03 };
    }
    if (overalls) {
      const bib = face === 'front' ? (u >= 1 && u <= 6 && v >= 5) || ((u === 1 || u === 6) && v < 5) : face === 'back' ? (v >= 8 || ((u === 2 || u === 5) && v < 8)) : v >= 8;
      if (bib) {
        if (face === 'front' && v === 5 && (u === 1 || u === 6)) return GOLD;
        if (face === 'front' && v >= 6 && v <= 7 && u >= 3 && u <= 4) return tone(pants.c, 0.85);
        return { c: pants.c, amp: 0.04 };
      }
    }
    if (belt && v === (female ? 8 : 9)) { if (face === 'front' && (u === 3 || u === 4)) return u === 3 ? GOLD : tone(GOLD, 0.8); return tone(LEATHER, 1); }
    if (scarf && v <= 1) return tone(scarfColor, (u + v) % 3 === 0 ? 0.85 : 1);
    if (scarf && face === 'front' && u === 5 && v <= 5) return tone(scarfColor, v === 5 ? 0.85 : 0.95);
    if (apron) {
      if (face === 'front' && u >= 1 && u <= 6 && v >= 2) { if (v >= 6 && v <= 7 && u >= 2 && u <= 5) return tone(apronColor, v === 6 ? 0.85 : 0.92); return { c: apronColor, amp: 0.03 }; }
      if (face === 'front' && (u === 2 || u === 5) && v < 2) return apronColor;
      if (face === 'back' && v === 6 && u >= 2 && u <= 5) return tone(apronColor, 0.95);
      if (face === 'back' && v === 7 && (u === 3 || u === 4)) return tone(apronColor, 0.85);
      if ((face === 'left' || face === 'right') && v === 6) return tone(apronColor, 0.9);
    }
    if (top === 'hoodie') {
      let f = 1;
      if (face === 'front' && (u === 3 || u === 4) && v >= 1 && v <= 3) return v === 3 ? [236, 236, 236] : [214, 214, 214];
      if (face === 'front' && v >= 6 && v <= 8 && u >= 2 && u <= 5) f = (v === 6 || u === 2 || u === 5) ? 0.82 : 0.92;
      if (face === 'back' && v <= 2 && u >= 1 && u <= 6) f = v === 2 ? 0.78 : 0.9;
      if (v === 9) f = 0.84;
      return { c: tone(topColor.c, f), amp: 0.04 };
    }
    if (top === 'jacket' || top === 'cardigan' || top === 'vest') {
      const open = face === 'front' && u >= 2 && u <= 5;
      if (!open) {
        let f = 1;
        if (face === 'front' && (u === 1 || u === 6)) f = 0.84;
        if (face === 'front' && (u === 2 || u === 5) && v <= 1) return tone(topColor.c, 1.15);
        if (top === 'cardigan' && face === 'front' && u === 1 && v % 3 === 2) return tone(topColor.c, 1.3);
        if (top === 'jacket' && face === 'front' && v === 6 && (u === 0 || u === 7)) f = 0.8;
        return { c: tone(topColor.c, f), amp: 0.035 };
      }
      if (face === 'front' && (u === 2 || u === 5) && v <= 1) return tone(topColor.c, 1.15);
    }
    if (face === 'front' && neckV && v === 0 && (u === 3 || u === 4)) return tone(skin, 0.88);
    let f = 1;
    if (face === 'front' && (u === 0 || u === 7)) f *= 0.93;
    if (female && face === 'front' && v === 3 && u >= 1 && u <= 6) f *= 0.92; // 胸の下の影（女性）
    if (v === 8 && !belt) f *= 0.92;
    if (hashStr('fold' + seed + body + face + u + ',' + v) % 100 < 6) f *= 0.9;
    return { c: tone(shirtAt(u, v, face), f), amp: 0.03 };
  };
  S.paint(P.body, BODY, (face, u, v) => {
    if (face === 'top') return tone(top === 'none' || top === 'vest' ? shirt.c : topColor.c, 1);
    if (face === 'bottom') return tone(bottom === 'skirt' ? skirtColor : pants.c, 1);
    if (face === 'back' && style.body && v < style.body && u >= 1 && u <= 6) {
      const ends = (u + seedNum) % 2 === 0 ? style.body - 1 : style.body;
      if (v < ends) return { c: tone(hair, strand[u] * (v === ends - 1 ? 0.82 : 1)), amp: 0.04 };
    }
    if (face === 'back' && style.tail && (u === 3 || u === 4) && v <= 4) return { c: tone(hair, strand[u] * (v === 4 ? 0.8 : 1)), amp: 0.04 };
    if (face === 'back' && style.braid === 'back' && (u === 3 || u === 4) && v <= 9) return v === 8 ? tieC : braidPx(u, v);
    return torsoColor(face, u, v);
  });

  // 胴の重ね層の髪：背中へ垂れる長い髪・三つ編み・ツインテール・ポニーテール、肩の前にかかる髪。
  //   頭の重ね層のうしろの下の段と、列ごとのむら・明るさをそろえて、首のうしろで切れずにつながって見えるようにする
  //   （paint の側面の明暗は上 1.04〜下 0.96 なので、頭の下の段 0.96 から続くように割り戻す）
  const backF = (u) => strand[(u * 3 + 4) % 32]; // 頭のうしろ（overHair の k=u, 'back'.length=4）と同じ列のむら
  const grad = (v) => (0.96 - 0.035 * v) / (1.04 - 0.08 * v / 11);
  S.paint(P.jacket, BODY, (face, u, v) => {
    if (style.bald || style.buzz || face === 'top' || face === 'bottom') return null;
    const HP = (f) => ({ c: tone(hair, f), amp: 0.04 });
    if (style.body) {
      const L = style.body;
      if (face === 'back') {
        const ends = (u + seedNum) % 2 ? L : Math.max(1, L - 1); // 毛先はぎざぎざ
        if (v < ends) return HP(backF(u) * grad(v) * (v === ends - 1 ? 0.78 : v === ends - 2 ? 0.9 : 1));
      }
      // 肩の前にかかる髪：ロング・姫カットは胸の上まで 2 列、セミロングは鎖骨まで（前から見てボブと違いが分かる）
      if (face === 'front') {
        const fl = (u === 0 || u === 7) ? (L >= 4 ? 5 : 3) : (u === 1 || u === 6) ? (L >= 4 ? 3 : 2) : 0;
        if (v < fl) {
          if (fl >= 3 && v === fl - 1 && (u + seedNum) % 2 === 1 && (u === 1 || u === 6)) return null;
          return HP(strand[u + 3] * (v === fl - 1 ? 0.78 : v === 0 ? 1.06 : 0.97));
        }
      }
    }
    if (style.braid === 'back' && face === 'back' && (u === 3 || u === 4)) {
      if (v <= 7) { const b = braidPx(u, v); b.c = tone(b.c, grad(v)); return b; }
      if (v === 8) return tone(tieC, 1);
      if (v === 9) return HP(0.78);
    }
    if (style.braid === 'front' && face === 'front' && (u === 0 || u === 1)) {
      if (v <= 6) return braidPx(u, v);
      if (v === 7) return tone(tieC, 1);
      if (v === 8 && u === 0) return HP(0.8);
    }
    if (style.tail && face === 'back' && (u === 3 || u === 4) && v <= 4) return HP(strand[u + 20] * grad(v) * (v === 4 ? 0.8 : u === 3 ? 1.08 : 0.96));
    return null;
  }, true);
  // ツインテールの房の箱（2×8×2）：胸の両横に縦に垂れる。厚みがあるので、前・斜め・真横（腕の前に出る）から見える。
  //   腕には付けない（歩いても腕と一緒にゆれない）。上は頭の下に隠れる。上から明→中→暗（毛先）、前は明るく横は少し暗い
  if (style.twin) {
    S.paint(P.tails, [2, 8, 2], (face, u, v) => {
      if (face === 'top') return tone(hair, 1);
      if (face === 'bottom') return tone(hair, 0.7);
      let f = strand[(u * 7 + face.length * 3) % 32] * (v === 0 ? 1.1 : v >= 7 ? 0.74 : v >= 5 ? 0.88 : 1);
      if ((u + v) % 3 === 0) f *= 0.93; // 毛の束のすじ
      return { c: tone(hair, f), amp: 0.05 };
    }, true);
  }
  // ---------- 腕（女性は 3px の細い腕） ----------
  const sleeveColor = top === 'jacket' || top === 'hoodie' || top === 'cardigan' ? topColor.c : shirt.c;
  const longArm = top === 'jacket' || top === 'hoodie' || top === 'cardigan' ? true : longSleeve && !dress;
  const armFn = (isLeft) => (face, u, v) => {
    const inner = isLeft ? face === 'right' : face === 'left';
    let f = inner ? 0.86 : 1;
    if (face === 'top') return tone(sleeveColor, 1);
    if (face === 'bottom') return tone(skin, 0.9);
    const sleeveEnd = longArm ? 9 : dress ? 1 : 3;
    if (v <= sleeveEnd) {
      if (v === sleeveEnd) f *= longArm ? 0.85 : 0.82;
      if (longArm && v === 5 && face === 'front') f *= 0.92;
      let c = sleeveColor;
      if (pattern === 'stripe' && sleeveColor === shirt.c && v % 3 === 1) c = mix(shirt.c, shirt2.c, 0.75);
      if (pattern === 'twotone' && sleeveColor === shirt.c) c = shirt2.c;
      return { c: tone(c, f), amp: 0.035 };
    }
    if (watch && isLeft && v === 9) return face === 'front' ? [230, 230, 236] : [60, 60, 70];
    if (v >= 10) f *= v === 11 ? 0.9 : 0.97;
    if (!longArm && v === sleeveEnd + 1) f *= 0.9;
    return { c: tone(skin, f), amp: 0.025 };
  };
  S.paint(P.rarm, slim ? LIMB_SLIM : LIMB, armFn(false));
  S.paint(P.larm, slim ? LIMB_SLIM : LIMB, armFn(true));

  // ---------- 脚 ----------
  const legFn = (isLeft) => (face, u, v) => {
    const inner = isLeft ? face === 'right' : face === 'left';
    let f = inner ? 0.82 : 1;
    if (face === 'top') return tone(bottom === 'skirt' ? skirtColor : pants.c, 1);
    if (face === 'bottom') return tone(shoes, 0.45);
    const shoeTop = boots ? 8 : 10;
    if (v >= shoeTop) {
      if (v === 11) return tone(shoes, 0.55);
      if (v === shoeTop) f *= 1.08;
      if (face === 'front' && v === 10 && u === 1) f *= 1.15;
      return { c: tone(shoes, f), amp: 0.04 };
    }
    if (apron && face === 'front' && v <= 5) return tone(apronColor, v === 5 ? 0.88 : 0.97);
    if (bottom === 'skirt') {
      const len = dress ? 5 : 4;
      if (v <= len) return { c: tone(skirtColor, f * (v === len ? 0.82 : 1)), amp: 0.04 };
      if (v === shoeTop - 1) return tone(female ? [238, 232, 232] : [238, 238, 232], f);
      return { c: tone(skin, f * (v === len + 1 ? 0.86 : 1)), amp: 0.025 };
    }
    if (bottom === 'shorts') {
      if (v <= 4) return { c: tone(pants.c, f * (v === 4 ? 0.82 : 1)), amp: 0.04 };
      if (v === shoeTop - 1) return tone([238, 238, 232], f);
      return { c: tone(skin, f * (v === 5 ? 0.86 : 1)), amp: 0.025 };
    }
    if (face === 'front' && u === (isLeft ? 1 : 2) && v >= 1 && v <= 8) f *= 0.9;
    if (v === 6 && face === 'front') f *= 1.05;
    if (v === shoeTop - 1) f *= 0.84;
    if (face === 'front' && v === 1 && u === (isLeft ? 2 : 1) && pants.name.includes('ジーンズ')) f *= 0.8;
    return { c: tone(pants.c, f), amp: 0.05 };
  };
  S.paint(P.rleg, LIMB, legFn(false));
  S.paint(P.lleg, LIMB, legFn(true));

  // bottom・dress・hat・facial は、見た目が男性・女性のどちらに見えるかの仕分け（tools/skin_gender.js）に使う
  // style はもとの髪型（男性・女性っぽさの仕分けはこれで決める）、hair は描いた髪型
  return { px: S.px, traits, style: baseStyle.id, hair: style.id, slim, body, seed, bottom, dress, hat, facial };
}
// プロフィールに入れる値（"female:12345"）を読む。だめなら null
export function parseLook(s) {
  const m = String(s || '').match(/^(none|male|female):(\d{1,10})$/);
  return m && +m[2] <= 2147483647 ? { body: m[1], seed: +m[2] } : null;
}
export const lookText = (look) => look.body + ':' + look.seed;
