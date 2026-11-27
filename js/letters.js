// 手紙の決まり（tools/mail.js・サイト・テストで共通。three.js も DOM も使わない）。
//   ・自分の村人から、ほかの村人へ。短い文に、持ち物を 1 つ添えられる。送り方は web（mail.html）とコメント「手紙 @相手 本文」
//   ・1 日に送れる数は mail.perDay（web は受け口の Worker が数える。コメントは毎日の更新が数える）
//   ・本文は mail.maxLen 字まで。悪口などは禁止語（NG_WORDS と config.mail.ngWords）ではじく。URL・電話番号も送れない
//   ・村人どうしも、仲の良さに合わせて時々書き合う（文は決まった型の組み合わせ。villagerLetter）
// 受け口（tools/webhook/worker.mjs）は 1 つのファイルで置けるように同じ決まりを持っている（テストで同じか確かめる）
export const MAIL_DEFAULTS = { perDay: 3, maxLen: 80, keep: 15, villagerPerDay: 4, villagerP: 0.08, thanksP: 0.6 };
export const mailCfg = (config) => ({ ...MAIL_DEFAULTS, ...((config && config.mail) || {}) });

// 禁止語（ひらがな・小文字にそろえてから探す）。ふつうの言葉にまぎれにくい物だけ
export const NG_WORDS = ['しね', '死ね', 'しんでしまえ', 'ころす', '殺す', 'ころして', 'きえろ', '消えろ', 'きもい', 'きしょい', 'うざい', 'うぜえ', 'ぶす', 'でぶ', 'ぶさいく', 'くず', 'ごみくず', 'ばか', '馬鹿', 'あほ', 'まぬけ', 'だまれ', '黙れ', 'くたばれ', 'ざこ', '雑魚', 'いんきゃ', '陰キャ', 'きちがい', 'がいじ', 'ふぁっく', 'fuck', 'shit', 'bitch'];
// 禁止語をふくむけれど、ふつうの言葉（先に消してから探す）
export const NG_OK = ['ばかり', 'ばかし', 'ばかでかい', 'くずもち', 'くずれ', 'くずし', 'くずゆ', 'ぶすっと', 'しねん', 'ざこね', 'あほうどり', 'でぶね'];
// 文をそろえる：NFKC・小文字・カタカナ → ひらがな・空白や記号を消す
export function foldText(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　・.,、。!！?？~〜ー\-_*＊/／\\|｜'"`()（）「」『』【】[\]{}<>＜＞♪☆★♡♥]/g, '');
}
export function hasNg(text, extra = []) {
  let f = foldText(text);
  for (const w of NG_OK) f = f.split(w).join('');
  return [...NG_WORDS, ...(extra || [])].some((w) => { const k = foldText(w); return k && f.includes(k); });
}
const URL_RE = /(https?:|www\.|\.com\b|\.jp\b|\.net\b|line\.me|@[a-z0-9_.]{2,})/i;
const TEL_RE = /\d[\d-]{8,}\d/;
// 本文を確かめる。{ ok, text, error }（text はそろえた本文：前後の空白を消し、改行は 2 つまで）
export function checkLetter(raw, config) {
  const M = mailCfg(config);
  const text = String(raw == null ? '' : raw).normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ 　]{2,}/g, ' ').trim();
  if (!text) return { ok: false, error: 'empty', text };
  if (Array.from(text).length > M.maxLen) return { ok: false, error: 'long', text };
  if ((text.match(/\n/g) || []).length > 4) return { ok: false, error: 'lines', text };
  if (URL_RE.test(text.normalize('NFKC')) || TEL_RE.test(text.normalize('NFKC'))) return { ok: false, error: 'url', text };
  if (hasNg(text, M.ngWords)) return { ok: false, error: 'ng', text };
  return { ok: true, text };
}
export const LETTER_ERR = { empty: '本文を書いてね', long: '本文が長すぎます', lines: '改行が多すぎます', url: 'URL や ID・電話番号は書けません', ng: 'とげのある言葉は送れません。やさしい言葉で書いてね', self: '自分には送れません', to: '送る相手を選んでね', limit: 'きょう送れる数はおしまいです', gift: 'その持ち物は添えられません', terms: '手紙のきまりに同意してから送れます' };

// コメント「手紙 @相手 本文」（「てがみ」も。@ のない「手紙 相手 本文」も読む）。{ to, body } か null
export function parseLetterComment(text) {
  const s = String(text || '').trim();
  const m = /^(?:手紙|てがみ)[\s:：]+[@＠]?([^\s@＠:：]{1,30})[\s:：]+([\s\S]+)$/.exec(s);
  if (!m) return null;
  return { to: m[1].normalize('NFKC'), body: m[2].trim() }; // 本文はそのまま（名前だけ半角にそろえる）
}

// 添えられる持ち物：道具・防具・部品はだめ（手で渡せる小さな物）
export const GIFT_OK = /^(log|cobble|berry|apple|flower_r|flower_y|sapling|wheat|seeds|carrot|potato|egg|milk|wool|mushroom|pearl|old_coin|driftwood|bone|string|leather|coal|iron|gold|diamond|fish_[a-z]+)$/;
export const giftOk = (item) => typeof item === 'string' && GIFT_OK.test(item);

// ---------- 村人どうしの手紙（型の組み合わせ） ----------
const OPEN = {
  family: ['いつもありがとう。', '家族のみんなへ。', '元気にしてる？'],
  best: ['親友の{to}へ。', 'ねえ{to}、聞いて。', 'いつもいっしょにいてくれてありがとう。'],
  friend: ['{to}さん、こんにちは。', 'この前はありがとう。', '{to}さんへ。'],
  crush: ['{to}さんへ。少しだけ勇気を出して書きます。', 'なんとなく、{to}さんのことを考えていました。'],
  rival: ['{to}へ。負けないからね。', 'ライバルの{to}へ。'],
  known: ['{to}さん、はじめて手紙を書きます。', 'こんにちは、{from}です。'],
};
const TOPIC = {
  wood: ['きょうは木をたくさん切ったよ。', '斧の音が島にひびいていたね。'],
  stone: ['岩を掘っていたら、手がまめだらけ。', 'きょうはいい石がとれたよ。'],
  food: ['木の実をつんだから、こんど分けるね。', '畑の野菜がよく育ってるよ。'],
  smith: ['鍛冶屋で、新しい道具を打ったよ。', '金づちの音、聞こえた？'],
  rain: ['雨の日は、家で手紙を書くのにちょうどいいね。', '雨の音を聞きながら書いています。'],
  sun: ['いい天気で、海がきらきらしてたね。', 'お日さまがあったかい一日だったね。'],
  built: ['{built}ができたね。いっしょに見に行こう。', '{built}、すてきだね。'],
  any: ['島の暮らしにも、だいぶ慣れてきたよ。', 'きょうも一日おつかれさま。', '夕やけがきれいだったね。'],
};
const CLOSE = {
  family: ['また夕ごはんを食べようね。', 'からだに気をつけてね。'],
  best: ['あしたも遊ぼう！', 'これからもよろしくね。'],
  friend: ['また広場で話そうね。', 'こんど釣りに行こう。'],
  crush: ['……また話しかけてもいいかな。', 'お返事、待ってます。'],
  rival: ['あしたは負けないぞ。', 'でも、ちょっとだけ感謝してる。'],
  known: ['よかったら仲よくしてね。', 'また会ったら声をかけてね。'],
};
const pick = (arr, R) => arr[Math.floor(R() * arr.length) % arr.length];
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] == null ? '' : o[k]));
// kind：関係（family・best・friend・crush・rival・known）。ctx：{ from, to（名前）, job, weather, built }。R：0〜1 の乱数
export function villagerLetter(kind, ctx, R) {
  const k = OPEN[kind] ? kind : 'known';
  const topics = [];
  if (ctx.built) topics.push(...TOPIC.built);
  if (ctx.weather === '雨') topics.push(...TOPIC.rain);
  else if (ctx.weather === '晴れ') topics.push(...TOPIC.sun);
  if (TOPIC[ctx.job]) topics.push(...TOPIC[ctx.job]);
  topics.push(...TOPIC.any);
  return fill(pick(OPEN[k], R) + pick(topics, R) + pick(CLOSE[k], R), ctx);
}
const THANKS = ['お手紙ありがとう！', 'お手紙、うれしかったよ。', '手紙をもらって、思わずにっこりしたよ。'];
const THANKS_GIFT = ['{gift}もありがとう。大事にするね。', '{gift}まで、ありがとう！'];
const THANKS_BACK = ['お礼に{decor}を送るね。家に飾ってね。', 'お礼のしるしに{decor}をどうぞ。'];
export function thanksLetter(ctx, R) {
  return fill(pick(THANKS, R) + (ctx.gift ? pick(THANKS_GIFT, R) : '') + (ctx.decor ? pick(THANKS_BACK, R) : pick(CLOSE.friend, R)), ctx);
}
