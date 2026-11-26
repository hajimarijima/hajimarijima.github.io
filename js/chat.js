// 立ち話の言葉：会ったらまずあいさつ（お辞儀・手をふる・会釈）、それから交互に話す。
// 同じ 2 人・同じ時間なら いつ開いても同じ（hash で選ぶ）。悪い言葉は入れない
import { hash } from './world3d.js';

// 仲のよさ：social.json の pairs（s が高い・家族）か、立ち話の kind が friend / family / crush
export function closeOf(pairs, a, b, kind) {
  if (kind === 'friend' || kind === 'family' || kind === 'crush') return true;
  const r = pairs && pairs[[a, b].sort().join('|')];
  return !!(r && ((r.s || 0) >= 45 || (r.family || 0) > 0 || r.crush));
}

// あいさつ：仲よしは手をふる（ときどき会釈）、ほかはお辞儀（ときどき会釈）。言葉は時間で変わる
export function greetOf(close, hour, seed) {
  seed = seed >>> 0;
  const h = ((hour % 24) + 24) % 24, n = h >= 18 || h < 4;
  const word = n ? 'こんばんは' : h < 10 ? 'おはよう' : 'こんにちは';
  if (close) {
    const kind = seed % 3 === 0 ? 'nod' : 'wave';
    const a = n ? 'こんばんは！' : h < 10 ? 'おはよう！' : 'やあ！';
    const b = ['やあ、元気？', a, 'あ、' + (n ? 'こんばんは' : h < 10 ? 'おはよう' : 'やあ') + '！'][(seed >>> 2) % 3];
    return { kind, a, b };
  }
  const kind = seed % 4 === 0 ? 'nod' : 'bow';
  return { kind, a: word, b: seed % 2 ? word : word + (n ? '。おつかれさま' : '。いい日だね') };
}

const JOB_T = {
  wood: [['木をたくさん切ったよ', 'おつかれさま。腕は平気？'], ['今日の木はかたかったな', '刃をといでおくといいよ'], ['切った木で何を作るんだろう', '新しい家だといいね']],
  stone: [['いい石がとれたよ', 'すごいね、何に使うの？'], ['岩はなかなか割れないね', '少しずつで大丈夫だよ'], ['石を運ぶのは重いなあ', 'あとで手伝うよ']],
  food: [['畑の野菜が育ってきたよ', 'とれたら少し分けてね'], ['きのみをたくさん集めたよ', 'おいしそう！'], ['魚が釣れるといいな', '池のはしがよく釣れるよ']],
};
const WEATHER_T = {
  sun: [['いい天気だね', '洗たく物がよくかわくね'], ['空がきれいだね', 'うん、気持ちいいね']],
  rain: [['雨がやまないね', '畑にはちょうどいいかも'], ['かさがほしいね', '少し家で休もうか']],
  cloud: [['今日は少しくもってるね', '暑くなくて働きやすいね']],
  snow: [['雪がつもってきたね', 'あとで雪だるまを作ろう'], ['手が冷たいね', 'たき火にあたろうか']],
};
const TIME_T = {
  morning: [['よく眠れた？', 'うん、ぐっすり'], ['朝ごはん食べた？', 'パンを食べたよ']],
  noon: [['おなかすいたね', 'お昼は何にしよう'], ['午後もがんばろうね', 'うん、もうひとがんばり']],
  evening: [['夕やけがきれいだね', 'もうすぐ一日が終わるね'], ['今日はよく働いたね', 'ゆっくり休もう']],
  night: [['星がよく見えるね', '明日も晴れるといいな'], ['そろそろ眠くなってきた', 'おやすみの時間だね']],
};
const ANY_T = [['最近どう？', '元気にやってるよ'], ['ちょっと休もうか', 'そうだね、ひと息つこう'], ['島もにぎやかになったね', '人がふえてうれしいね'], ['明日は何をするの？', 'まだ決めてないんだ'], ['今度いっしょに釣りに行こう', 'いいね、行こう！']];
const CLOSE_T = [['いつもありがとう', 'こちらこそ！'], ['また今度ゆっくり話そう', 'うん、楽しみにしてる']];

function weatherKey(w) {
  w = String(w || '');
  return /雪/.test(w) ? 'snow' : /雨/.test(w) ? 'rain' : /くもり|曇/.test(w) ? 'cloud' : 'sun';
}
function timeKey(h) { return h >= 5 && h < 11 ? 'morning' : h < 15 && h >= 11 ? 'noon' : h >= 15 && h < 19 ? 'evening' : 'night'; }

// 話の続き（あいさつと sim.js の言葉のあと）。返すのは [[0 か 1（0 = A・1 = B）, 言葉], ...]
// ctx: { a, b（村人の key）, jobA, jobB, foodA, foodB, hour, weather, today（state.today）, close, round }
export function moreLines(ctx, count = 2) {
  const h = ((ctx.hour % 24) + 24) % 24, t = ctx.today || {};
  const seed = hash([ctx.a, ctx.b].sort().join('|') + ':' + h + ':' + (ctx.round || 0));
  const pool = [];
  const jobs = [[0, ctx.jobA], [1, ctx.jobB]];
  for (const [w, j] of jobs) for (const p of JOB_T[j] || []) pool.push([w, p]);
  if (ctx.jobA && ctx.jobA === ctx.jobB) pool.push([0, ['明日もいっしょにがんばろう', 'うん、よろしくね']]);
  for (const p of WEATHER_T[weatherKey(ctx.weather)]) pool.push([seed % 2, p]);
  if (timeKey(h) !== 'night' || weatherKey(ctx.weather) !== 'sun') for (const p of TIME_T[timeKey(h)]) pool.push([(seed >>> 1) & 1, p]);
  else pool.push([(seed >>> 1) & 1, TIME_T.night[1]]); // 夜は「星」より「眠い」（晴れの日だけ星）
  if (timeKey(h) === 'night' && weatherKey(ctx.weather) === 'sun') pool.push([seed % 2, TIME_T.night[0]]);
  for (const p of ANY_T) pool.push([(seed >>> 3) & 1, p]);
  if (ctx.close) for (const p of CLOSE_T) pool.push([0, p]);
  if (ctx.foodB) pool.push([0, ['好きな食べ物ってある？', ctx.foodB + 'が好きだよ']]);
  if (ctx.foodA) pool.push([1, ['好きな食べ物ってある？', ctx.foodA + 'が好きだよ']]);
  if ((t.built || []).length) pool.push([0, ['新しい建物ができたね', '中を見に行こうよ']]);
  if ((t.birthdays || []).length) pool.push([1, ['今日は誕生日の人がいるね', 'みんなでお祝いしよう']]);
  for (const [w, who] of [[0, ctx.a], [1, ctx.b]]) if ((t.crafted || []).some((c) => c && c.who === who)) pool.push([w, ['新しい道具を作ったんだ', '見せて見せて！']]);
  const out = [], used = new Set();
  for (let k = 0; out.length < count * 2 && k < 40; k++) {
    const j = hash(seed + ':' + k) % pool.length;
    if (used.has(j)) continue;
    const [w, [q, r]] = pool[j];
    // 話が交互になるように：前に話した人（ctx.last）とちがう人から始まる話を先にえらぶ
    const prev = out.length ? out[out.length - 1][0] : ctx.last;
    if (prev !== undefined && prev !== null && w === prev && k < 24) continue;
    used.add(j);
    out.push([w, q], [1 - w, r]);
  }
  return out;
}
