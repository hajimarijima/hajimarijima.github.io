'use strict';
// 村人の登録・名前のかくし・コメント投票の集計（sim.js / instagram.js / import_followers.js / テストで共通）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { skinFor, hashStr } = require('./rand');
const G = require('./gender');

// 名前やインスタの ID から作る印は、秘密の塩（env TOWN_SALT、GitHub Secrets）入りの HMAC-SHA256 にする。
// 塩なしの sha256 だと、ユーザー名を知っている人が同じ計算をして、名前をかくした人まで見つけられてしまうため。
// TOWN_SALT がない時（手元・テスト）は決まった開発用の塩を使い、警告を 1 回だけ出す（開発用の塩はだれでも読めるので本番では使わない）
const DEV_SALT = 'town-dev-salt-NOT-SECRET';
const SALT = process.env.TOWN_SALT || DEV_SALT;
const saltIsDev = !process.env.TOWN_SALT;
if (saltIsDev && !process.env.TOWN_SALT_QUIET) process.stderr.write('[警告] TOWN_SALT がないので開発用の塩で印を作ります（本番の公開データには使わないでください）\n');
const sha = (s) => crypto.createHmac('sha256', SALT).update(s).digest('hex');
const norm = (s) => String(s || '').normalize('NFKC').trim();
// インスタの ID もそのままは公開しない（印にして持つ）
const igHash = (id) => sha('ig:' + String(id)).slice(0, 16);
const userHash = (username) => sha('user:' + norm(username).toLowerCase()).slice(0, 16);
// 公開してよい内部の番号（URL に使う）。インスタの ID や名前そのものは出さない
const keyFor = (src) => sha('key:' + src).slice(0, 10);

// ---------- あだ名 ----------
const ADJ = ['のんびりな', 'げんきな', 'しずかな', 'はたらきものの', 'くいしんぼうの', 'ねぼすけの', 'ものしりな', 'ちからもちの', 'おしゃれな', 'まじめな', 'わくわくの', 'やさしい'];
const ANIMAL = ['タヌキ', 'リス', 'フクロウ', 'カワウソ', 'ハリネズミ', 'キツネ', 'ウサギ', 'アライグマ', 'ペンギン', 'ヒツジ', 'カメ', 'モモンガ'];
function nickname(key) { const h = hashStr('nick:' + key); return ADJ[h % ADJ.length] + ANIMAL[(h >>> 8) % ANIMAL.length]; }

// hidden.json: ["hmac:<userHash>"]（tools/hide.js が書く。塩入りなので公開しても名前はわからない）。
// 名前そのものも読めるが、それは公開しないこと（警告を出す）。名前は Secrets の TOWN_HIDDEN に入れてもよい
function loadHidden(dataDir) {
  const f = path.join(dataDir, 'hidden.json');
  const list = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  const set = new Set();
  let raw = 0;
  for (const e of (Array.isArray(list) ? list : list.names || [])) {
    const s = String(e);
    if (s.startsWith('hmac:')) set.add(s.slice(5));
    else if (s.startsWith('sha256:')) set.add(s.slice(7)); // 古い形（塩なし）。今の印とは合わないので tools/hide.js で入れ直す
    else { set.add(userHash(s)); raw++; }
  }
  // 名前そのものを公開ファイルに書かなくてよいように、Secrets の TOWN_HIDDEN（カンマ・改行区切りの名前）も読む
  for (const n of String(process.env.TOWN_HIDDEN || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)) set.add(userHash(n));
  if (raw && !process.env.TOWN_SALT_QUIET) process.stderr.write('[警告] hidden.json に名前がそのまま入っています。公開する前に tools/hide.js で印に直してください\n');
  return set;
}

// 表示名を決める（かくす人は username を消してあだ名にする）
function applyPrivacy(v, hidden) {
  if (hidden.has(v.userHash)) { v.hidden = true; delete v.name; v.display = nickname(v.key); }
  else { v.hidden = false; v.display = v.name || nickname(v.key); }
  return v;
}

function findVillager(villagers, { igId, username }) {
  // igAlt：同じ人の、ちがう形のインスタの ID の印（コメントの from.id と DM の IGSID がちがう時。upsertVillager が足す）
  if (igId) { const h = igHash(igId), hit = villagers.find((v) => v.igId === h || (v.igAlt || []).includes(h)); if (hit) return hit; }
  if (username) { const h = userHash(username); return villagers.find((v) => v.userHash === h); }
  return null;
}

// 村人を足す。もういる人なら名前だけ新しくして null を返す
// startTool は新しく来た人にだけ入れる（もういる人の道具は、プロフィールでだけ変えられる）
function upsertVillager(villagers, { igId, username, joined, joinedDay, source, startTool, birthday, food }, hidden) {
  const hit = findVillager(villagers, { igId, username });
  if (hit) {
    if (birthday || food) fillJoinProfile(hit, { birthday, food });
    if (igId && !hit.igId) hit.igId = igHash(igId);
    else if (igId && hit.igId !== igHash(igId) && !(hit.igAlt || []).includes(igHash(igId))) hit.igAlt = [...(hit.igAlt || []), igHash(igId)].slice(-3); // 名前で見つけた同じ人（DM とコメントで ID の形がちがう）
    if (username && userHash(username) !== hit.userHash) { // 名前が変わった
      hit.userHash = userHash(username);
      hit.name = norm(username);
      hit.renamed = (hit.renamed || 0) + 1;
    }
    applyPrivacy(hit, hidden);
    return null;
  }
  const key = keyFor(igId ? 'ig:' + igId : 'user:' + norm(username).toLowerCase());
  const v = { key, igId: igId ? igHash(igId) : undefined, name: norm(username), userHash: userHash(username), skin: skinFor(key), joined, joinedDay, source };
  if (!v.igId) delete v.igId;
  if (startTool) v.startTool = startTool;
  fillJoinProfile(v, { birthday, food });
  fitGenderSkin(v); // 名前で女性・男性と分かる人は、そう見えるスキンに（名前をかくす前に見る）
  applyPrivacy(v, hidden);
  villagers.push(v);
  return v;
}

// ---------- コメント ----------
// Graph API のコメント: { id, text, timestamp, from: { id, username }, username }
const commentUser = (c) => ({ igId: c.from && c.from.id, username: (c.from && c.from.username) || c.username });
// 「住みたい」「すみたい」「参加したい」「参加します」「参加」を登録として読む（前の言葉「住民登録」も念のため読む）。
// 「参加しない」「参加できない」「不参加」は登録にしない。word は config.joinWord（足したい言葉があれば追加される）
const JOIN_WORDS = ['住みたい', 'すみたい', '参加したい', '参加します', '参加', '住民登録'];
const NOT_JOIN = /参加(し|でき)ない|参加しません|参加できません|不参加|(住|す)みたくない|(住|す)めない/;
const isJoin = (text, word) => {
  const t = norm(text);
  if (NOT_JOIN.test(t)) return false;
  return [...JOIN_WORDS, ...(word ? [norm(word)] : [])].some((w) => t.includes(w));
};

// 「住みたい ピッケル」「参加したい 釣り」から最初の道具を読む（config.startTools）。
// いちばん前に書いてある道具の言葉を使う。敵が出ない間は剣（needsEnemies）は選べない。言葉がなければ null
function parseStartTool(text, startTools, { enemies = false } = {}) {
  const opts = ((startTools && startTools.options) || []).filter((o) => enemies || !o.needsEnemies);
  const t = norm(text);
  let best = null, at = Infinity;
  for (const o of opts) for (const w of o.words || []) {
    const i = t.indexOf(norm(w));
    if (i >= 0 && (i < at || (i === at && best && norm(w).length > best.len))) { at = i; best = { id: o.id, len: norm(w).length }; }
  }
  return best ? best.id : null;
}
// 選べる道具の id → 表示名・仕事（profileFields の「最初の道具」は表示名で持つ）
const startToolByLabel = (startTools, label) => ((startTools && startTools.options) || []).find((o) => o.label === label) || null;
const startToolById = (startTools, id) => ((startTools && startTools.options) || []).find((o) => o.id === id) || null;

function registrationsFrom(comments, word, startTools, opts = {}) {
  // 古い順に見て、1 人 1 回。最後の名前を使う。道具・誕生日・好きな食べ物・MBTI の言葉は、書いてある最後のものを使う。
  // 値ごとに、書いたコメントの時刻（bdAt・foodAt・mbtiAt）も持つ（あとから書き直した値が勝つように。applyCommentProfiles）
  const byUser = new Map();
  for (const c of [...comments].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    if (!isJoin(c.text, word)) continue;
    const u = commentUser(c);
    const id = u.igId ? 'ig:' + u.igId : 'user:' + norm(u.username).toLowerCase();
    const prev = byUser.get(id);
    const tool = startTools ? parseStartTool(c.text, startTools, opts) : null;
    const r = { ...(prev || {}), ...u, firstAt: prev ? prev.firstAt : c.timestamp, lastAt: c.timestamp };
    if (tool) r.startTool = tool;
    const p = parseCommentProfile(c.text, { word, startTools, mbti: opts.mbti !== false, join: true });
    if (p.birthday) { r.birthday = p.birthday; r.bdAt = c.timestamp; }
    if (p.food) { r.food = p.food; r.foodAt = c.timestamp; }
    if (p.mbti) { r.mbti = p.mbti; r.mbtiAT = p.mbtiAT || null; r.mbtiAt = c.timestamp; }
    const g = G.parseGenderWord(c.text); // 「住みたい 女の子」「住みたい 男性」
    if (g) { r.gender = g; r.genderAt = c.timestamp; }
    byUser.set(id, r);
  }
  return [...byUser.values()];
}

// ---------- 女性・男性に見えるスキン ----------
// skins/gender.json（tools/skin_gender.js が作る）
//   f / m：ふだんのスキン（体の種類「指定なし」）が、もう女性 / 男性に見える番号
//   ff / mm：makeSkin(番号, 'female' / 'male') がはっきり女性 / 男性に見える番号（体の種類を変える時のシード）
let SKIN_TAGS = null;
function skinTags() {
  if (!SKIN_TAGS) {
    let j = {};
    try { j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'skins', 'gender.json'), 'utf8')); } catch { /* ないなら何もしない */ }
    SKIN_TAGS = { f: new Set(j.f || []), m: new Set(j.m || []), ff: j.ff || [], mm: j.mm || [] };
  }
  return SKIN_TAGS;
}
const skinTag = (n) => (skinTags().f.has(n) ? 'f' : skinTags().m.has(n) ? 'm' : null);
// コメントで書いた性別（v.gender）か、名前から確かに分かる性別に合わせて、スキンの体の種類（v.skinBody：'female' / 'male'）を決める。
// 今のスキンがもうそう見える人はそのまま。そうでなければ、今の番号をシードにして体の種類を変える（js/skingen.js の makeSkin(v.skin, v.skinBody)）。
// その体の種類でもはっきりそう見えない番号なら、ff / mm の中から名前の印（key）で決まった番号に変える（同じ人はいつも同じ）。
// プロフィールで見た目を選んだ人（v.look）・分からない人は変えない。変えたら true
function fitGenderSkin(v) {
  if (!v || v.look) return false;
  const g = v.gender || (v.name ? G.confidentGender(v.name) : null);
  if (!g) return false;
  const body = g === 'f' ? 'female' : 'male';
  if (v.skinBody === body) return false;
  if (!v.skinBody && skinTag(v.skin) === g) return false;
  const ok = skinTags()[g === 'f' ? 'ff' : 'mm'];
  if (!ok.length) return false;
  if (!ok.includes(v.skin)) v.skin = ok[hashStr('gskin:' + v.key) % ok.length];
  v.skinBody = body;
  return true;
}

// ---------- ユーザー名の数字から誕生日（「mayu_0312」→ 3/12、「20001018」→ 10/18、「28514」→ 5/14） ----------
// 数字のかたまりを後ろから見て、読めた最初の日付。8 けた 19xx/20xx は YYYYMMDD、6 けたは YYMMDD、4 けたは MMDD。
// それ以外（と読めなかった時）は後ろ 4 けたの MMDD、だめなら後ろ 3 けたの M+DD。1〜2 けた・年っぽい 4 けた（1990〜2030）は使わない
function digitsBirthday(d) {
  const n = d.length, mmdd = (s) => md(+s.slice(0, 2), +s.slice(2, 4)), mdd = (s) => md(+s[0], +s.slice(1, 3));
  if (n < 3) return null;
  if (n === 3) return mdd(d);
  if (n === 4) return mmdd(d) || (+d >= 1990 && +d <= 2030 ? null : mdd(d.slice(1)));
  if (n === 8 && /^(19|20)/.test(d)) { const r = mmdd(d.slice(4)); if (r) return r; }
  if (n === 6) { const r = mmdd(d.slice(2)); if (r) return r; }
  return mmdd(d.slice(-4)) || mdd(d.slice(-3));
}
function nameBirthday(name) {
  const chunks = norm(name).match(/\d+/g) || [];
  for (let i = chunks.length - 1; i >= 0; i--) { const r = digitsBirthday(chunks[i]); if (r) return r; }
  return null;
}

// ---------- 誕生日と好きな食べ物（「住みたい 誕生日3月14日 好きな食べ物りんご」「住みたい 3/14 りんご」） ----------
// 書いていない人には、名前の印（key）から決まった値を入れる（乱数は使わない。同じ人はいつも同じ）
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const md = (m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= MONTH_DAYS[m - 1] ? String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0') : null);
// 「3月14日」「3月14」「3/14」「03/14」「3-14」「3.14」「0314」「誕生日は3月14日」「3/14生まれ」（全角の数字・空白のあるなしも）。
// 「誕生日」「たんじょうび」「誕生日は」はあってもなくてもよい。年は読まない（「2000/3/14」は 3/14）。ありえない日（13/40 など）は読まない。なければ null
const BDAY_RES = [
  /(\d{1,2})\s*月\s*(\d{1,2})/g,                         // 3月14日・3月14
  /(?<![\d.])(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?![\d.])/g,   // 3/14・03/14・3-14・3.14
  /(?<![\d.\-/])(\d{2})(\d{2})(?![\d.\-/])/g,             // 0314
];
function parseBirthday(text) {
  const t = norm(text);
  for (const re of BDAY_RES) for (const m of t.matchAll(re)) { const r = md(+m[1], +m[2]); if (r) return r; }
  return null;
}
// 町にある食べ物（config.items の食べ物）と、よく使う言い方。auto: 書いていない人に入れてよい物
const FOODS = [
  { name: 'りんご', auto: true, words: ['りんご', 'リンゴ', '林檎', 'アップル'] },
  { name: '魚', auto: true, words: ['焼き魚', '焼魚', 'お魚', '魚', 'さかな', 'サカナ', '刺身', 'さしみ', 'お寿司', '寿司', '鮭', 'フナ', 'ニジマス', 'ナマズ', '鯉'] },
  { name: '木の実', auto: true, words: ['木の実', 'きのみ', 'ベリー', 'ナッツ', 'どんぐり', 'くるみ'] },
  { name: 'にんじん', auto: true, words: ['にんじん', 'ニンジン', '人参', 'キャロット'] },
  { name: 'じゃがいも', auto: true, words: ['じゃがいも', 'ジャガイモ', 'じゃが芋', 'ポテト'] },
  { name: 'たまご', auto: true, words: ['たまご', 'タマゴ', '玉子', '卵', '目玉焼き', 'オムレツ'] },
  { name: 'ミルク', auto: true, words: ['ミルク', '牛乳', 'ぎゅうにゅう'] },
  { name: 'きのこ', auto: true, words: ['きのこ', 'キノコ', '茸', 'しいたけ', 'マッシュルーム'] },
  { name: 'パン', words: ['食パン', 'パン', 'トースト'] },
  { name: '小麦', words: ['小麦', 'こむぎ'] },
];
const AUTO_FOODS = FOODS.filter((f) => f.auto).map((f) => f.name);
// 文の中の、いちばん前に書いてある知っている食べ物（同じ所なら長い言葉）
function knownFood(s) {
  const t = norm(s);
  let best = null, at = Infinity, len = 0;
  for (const f of FOODS) for (const w of f.words) {
    const i = t.indexOf(norm(w));
    if (i >= 0 && (i < at || (i === at && w.length > len))) { best = f.name; at = i; len = w.length; }
  }
  return best;
}
const FOOD_LABEL = /(?:好きな食べ物|好きなたべもの|すきなたべもの|好きな食べもの|好物|こうぶつ)\s*(?:は|が|:|=)?\s*([^\s、。,.!?「」()]+)/;
let PF = null; // 悪い言葉の確かめ（js/profile-fields.js）。使う時に読む
// 好きな食べ物を読む。知っている食べ物はその名前に。「好きな食べ物カレー」のように書いてあれば、短くて安全な言葉はそのまま使う。
// 「好きな食べ物」と書かずに知らない言葉だけなら読まない（ふつうのあいさつを食べ物にしないため）。なければ null
function parseFood(text) {
  const t = norm(text);
  const m = t.match(FOOD_LABEL);
  if (m) {
    const w = m[1].replace(/(です|だよ|かな|が好き|がすき|大好き|だいすき)+$/, '');
    const k = knownFood(w);
    if (k) return k;
    if (!PF) PF = require('../js/profile-fields.js');
    if (w && Array.from(w).length <= 10 && /^[\p{L}ー・々]+$/u.test(w) && !PF.badWord(w)) return w;
    return null;
  }
  return knownFood(t);
}

// ---------- 1 つのコメントにまとめて書いたプロフィール ----------
// 「住みたい ピッケル 12月11日 リンゴ」「住みたい\nピッケル\n12/11\nりんご\nINFP」「誕生日 12/11」「好きな食べ物 りんご」「MBTI INFP」
// URL・@名前・#タグ・絵文字は読まない（URL の中の「ENTJ」や「3/14」を拾わないため）
const cleanText = (text) => norm(text)
  .replace(/https?:\/\/\S+|www\.\S+|\S+\.(?:com|jp|net|org|io|me|co|ly|app|dev)(?:\/\S*)?/gi, ' ')
  .replace(/[@#＃][^\s、,]+/g, ' ');
// MBTI（16 タイプ。大文字小文字・全角は問わない）。「INFP-T」「infp-a」「INFPT」の A/T も読む。なければ null
const MBTI_RE = /(?<![A-Za-z0-9_])([EI][NS][TF][JP])(?:[-_]?([AT]))?(?![A-Za-z0-9_])/i;
function parseMbti(text) {
  const m = cleanText(text).match(MBTI_RE);
  if (!m) return null;
  return { mbti: m[1].toUpperCase(), mbtiAT: m[2] ? m[2].toUpperCase() : null };
}
const BDAY_LABEL = /(?:誕生日|たんじょうび|誕生|生年月日|birthday)/i;
const MBTI_LABEL = /MBTI|エムビーティーアイ/i;
// 食べ物にしない言葉（あいさつ・気持ち）。まとめて書いたコメントの「残った 1 語」を食べ物にする時だけ使う
// あいさつ・気持ち・わたし・よく使う言葉・「〇〇さん」の呼びかけ・文の終わり（です・ます・た・を…）
const NOT_FOOD = new RegExp([
  'よろしく|宜しく|お願い|おねがい|楽しみ|たのしみ|楽し|たのし|ありがと|かわいい|可愛い|すごい|すてき|素敵|いいね|最高|さいこう|はじめまして|初めまして|こんにち|こんばん|おはよう',
  'フォロー|コメント|参加|プロフ|誕生|食べ物|たべもの|好物|好き|すき|大好き|わたし|あたし|私|僕|ぼく|俺|おれ|自分|ぜひ|是非|絶対|ぜったい|めっちゃ|とても|すごく|ほんと|本当|みんな|一緒|いっしょ|今日|明日',
  '^(島|町|村|ここ|そこ|この|その|また|まだ|もう|あと|これ|それ|うち)(に|で|へ|も|は)?$',
  '(さん|ちゃん|くん|君|様|さま|氏|殿)$',
  '(です|ます|でした|でーす|たい|した|する|って|けど|よね|かな|そう|ね|よ|な|を|は|の|た|だ|!|\\?)$',
].join('|'));
// 1 つのコメントから、誕生日・好きな食べ物・MBTI を読む。
//   join: 「住みたい」のコメントなら、名札（誕生日・好きな食べ物・MBTI）なしの「12/11」「りんご」「INFP」も読む。
//         false（住んでいる人のあとからのコメント）なら、名札のある値と、MBTI だけのコメント（「ENFP」）だけを読む
function parseCommentProfile(text, { word = null, startTools = null, mbti = true, join = true } = {}) {
  const t = cleanText(text);
  const out = {};
  if (join) {
    const bd = parseBirthday(t); if (bd) out.birthday = bd;
  } else {
    // 名札のすぐあと（14 文字まで）の日付だけ。「誕生日おめでとう」は人へのお祝いなので読まない
    const m = !/おめでと/.test(t) && t.match(BDAY_LABEL);
    if (m) { const bd = parseBirthday(t.slice(m.index + m[0].length, m.index + m[0].length + 14)); if (bd) out.birthday = bd; }
  }
  if (mbti) {
    const lm = t.match(MBTI_LABEL);
    const mb = lm ? parseMbti(t.slice(lm.index + lm[0].length)) : (join || /^\s*[A-Za-z_-]{4,6}\s*(です|だよ|でした)?[!！。]*\s*$/.test(t) ? parseMbti(t) : null);
    if (mb) { out.mbti = mb.mbti; if (mb.mbtiAT) out.mbtiAT = mb.mbtiAT; }
  }
  const fl = t.match(FOOD_LABEL);
  if (fl || join) {
    const fd = parseFood(t);
    if (fd) out.food = fd;
    else if (join && !fl) { const lf = looseFood(t, { word, startTools }); if (lf) out.food = lf; }
  }
  return out;
}
// 名札なしで書いた知らない食べ物（「住みたい ピッケル 12/11 カレー」「住みたい12/11カレー」のカレー）。町にない物もそのまま使う（あとで町に足せる）。
// 住みたい・道具・日付・MBTI・名札の言葉を区切りにして分け（続けて書いてもよい）、あいさつや呼びかけを除いて、残りがちょうど 1 語の時だけ使う
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function looseFood(t, { word = null, startTools = null } = {}) {
  const words = [...JOIN_WORDS, ...G.GENDER_WORDS, ...(word ? [norm(word)] : []), ...((startTools && startTools.options) || []).flatMap((o) => o.words || []).map(norm)]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  let s = t
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日?/g, ' ')
    .replace(/\d{1,4}\s*[/.\-]\s*\d{1,2}(?:\s*[/.\-]\s*\d{1,2})?/g, ' ')
    .replace(new RegExp(MBTI_RE.source, 'gi'), ' ')
    .replace(/\d+/g, ' ')
    .replace(/誕生日|たんじょうび|誕生|生年月日|生まれ|MBTI|エムビーティーアイ/gi, ' ');
  if (words.length) s = s.replace(new RegExp(words.map(escRe).join('|'), 'g'), ' ');
  const rest = [];
  for (const raw of s.split(/[\s、,，。・/／!！?？~〜]+/)) {
    const w = raw.replace(/[^\p{L}\p{N}ー々]/gu, '');
    if (!w || /^(月|日|は|に|で|の|と|も|が|を|です|ます|女|男)$/.test(w) || NOT_FOOD.test(w)) continue;
    rest.push(w);
  }
  if (rest.length !== 1) return null;
  const w = rest[0];
  if (Array.from(w).length > 10 || !/^[\p{L}ー・々]+$/u.test(w) || NOT_FOOD.test(w)) return null;
  if (!PF) PF = require('../js/profile-fields.js');
  return PF.badWord(w) ? null : w;
}
// 住んでいる人の、あとからのプロフィールのコメント（「誕生日 12/11」「MBTI ENFP」「好きな食べ物 りんご」）。
// 「住みたい」のコメントは registrationsFrom で読むので、ここでは読まない。1 人ずつ、値ごとに最後のコメントが勝つ
function profileUpdatesFrom(comments, word, { mbti = true } = {}) {
  const byUser = new Map();
  for (const c of [...(comments || [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    if (!c || isJoin(c.text, word)) continue;
    const p = parseCommentProfile(c.text, { word, mbti, join: false });
    const g = G.parseGenderWord(c.text, { strict: true }); // あとからは「女の子です」「男性」のような、ほぼその言葉だけのコメントだけ
    if (!p.birthday && !p.food && !p.mbti && !g) continue;
    const u = commentUser(c);
    if (!u.igId && !u.username) continue;
    const id = u.igId ? 'ig:' + u.igId : 'user:' + norm(u.username).toLowerCase();
    const r = { ...(byUser.get(id) || {}), ...u };
    if (p.birthday) { r.birthday = p.birthday; r.bdAt = c.timestamp; }
    if (p.food) { r.food = p.food; r.foodAt = c.timestamp; }
    if (p.mbti) { r.mbti = p.mbti; r.mbtiAT = p.mbtiAT || null; r.mbtiAt = c.timestamp; }
    if (g) { r.gender = g; r.genderAt = c.timestamp; }
    byUser.set(id, r);
  }
  return [...byUser.values()];
}
// コメントで書いたプロフィールを、もう住んでいる村人に入れる（道具・仕事は変えない。住んでいない人は何もしない）。
// 値ごとに「前に入れたコメントの時刻」（v.profileAt）より新しいコメントだけを使う。
// こうすると、毎回同じコメントを読み直しても、ログインのプロフィールで直した値を古いコメントで戻さない
// joinComments・voteComments など、見ている投稿のコメントをまとめて渡す。返り値：変わった人数
function applyCommentProfiles(villagers, comments, { word = null, startTools = null, mbti = true, enemies = false } = {}) {
  const all = [...registrationsFrom(comments || [], word, startTools, { enemies, mbti }), ...profileUpdatesFrom(comments, word, { mbti })];
  const latest = new Map(); // 村人ごとに、値ごとの最後
  for (const r of all) {
    const v = findVillager(villagers, r);
    if (!v) continue;
    const cur = latest.get(v) || {};
    for (const [f, at] of [['birthday', 'bdAt'], ['food', 'foodAt'], ['mbti', 'mbtiAt'], ['gender', 'genderAt']]) {
      if (r[f] && r[at] && (!cur[at] || Date.parse(r[at]) >= Date.parse(cur[at]))) { cur[f] = r[f]; cur[at] = r[at]; if (f === 'mbti') cur.mbtiAT = r.mbtiAT; }
    }
    latest.set(v, cur);
  }
  let changed = 0;
  for (const [v, s] of latest) {
    const since = v.profileAt ? Date.parse(v.profileAt) : -Infinity;
    let newest = since, ch = false;
    const fresh = (at) => at && Date.parse(at) > since;
    if (fresh(s.bdAt)) { if (v.birthday !== s.birthday) { v.birthday = s.birthday; ch = true; } newest = Math.max(newest, Date.parse(s.bdAt)); }
    if (fresh(s.foodAt)) { if (!v.profile || v.profile.food !== s.food) { v.profile = { ...(v.profile || {}), food: s.food }; ch = true; } newest = Math.max(newest, Date.parse(s.foodAt)); }
    if (fresh(s.mbtiAt)) {
      if (v.mbti !== s.mbti || (v.mbtiAT || null) !== (s.mbtiAT || null)) { v.mbti = s.mbti; if (s.mbtiAT) v.mbtiAT = s.mbtiAT; else delete v.mbtiAT; ch = true; }
      newest = Math.max(newest, Date.parse(s.mbtiAt));
    }
    if (fresh(s.genderAt)) { // 「女の子」「男性」：スキンの体の種類も合わせる（プロフィールで選んだ見た目は変えない）
      if (v.gender !== s.gender) { v.gender = s.gender; ch = true; }
      if (fitGenderSkin(v)) ch = true;
      newest = Math.max(newest, Date.parse(s.genderAt));
    }
    if (newest > since) { v.profileAt = new Date(newest).toISOString(); ch = true; } // 時刻も書き残す（次から古いコメントを使わない）
    if (ch) changed++;
  }
  return changed;
}
const autoBirthday = (key) => { const h = hashStr('bday:' + key), m = (h % 12) + 1; return md(m, ((h >>> 5) % (m === 2 ? 28 : MONTH_DAYS[m - 1])) + 1); };
const autoFood = (key) => AUTO_FOODS[hashStr('food:' + key) % AUTO_FOODS.length];
// 「住みたい」で来た人（source: comment）に、誕生日と好きな食べ物を入れる（ある物は変えない＝足すだけ）。
// said：コメントに書いてあった値。今の値がないか自動で入れた値の時だけ、書いてあった値に変える（ログインのプロフィールで入れた値は変えない）
function fillJoinProfile(v, said = {}) {
  if (v.source !== 'comment' && !said.birthday && !said.food) return false;
  let changed = false;
  const prof = v.profile || {};
  // 自動で入れた誕生日：ユーザー名の数字から読んだ日（nameBirthday）か、それがなければ名前の印から決めた日（autoBirthday）
  const nameBd = v.name ? nameBirthday(v.name) : null;
  const autoBd = (b) => b === autoBirthday(v.key) || (nameBd && b === nameBd);
  if (said.birthday && v.birthday !== said.birthday && (!v.birthday || autoBd(v.birthday))) { v.birthday = said.birthday; changed = true; }
  if (said.food && prof.food !== said.food && (!prof.food || prof.food === autoFood(v.key))) { v.profile = { ...prof, food: said.food }; changed = true; }
  if (v.source === 'comment') {
    if (!v.birthday) { v.birthday = nameBd || autoBirthday(v.key); changed = true; }
    else if (nameBd && v.birthday !== nameBd && v.birthday === autoBirthday(v.key)) { v.birthday = nameBd; changed = true; } // 前に印から決めた人も、名前の数字の日に
    if (!(v.profile && v.profile.food)) { v.profile = { ...(v.profile || {}), food: autoFood(v.key) }; changed = true; }
  }
  return changed;
}

// 「A」「ａ」「Aがいい」「Ｂ案」などから 1 文字を読む。2 つ以上書いてあれば数えない
// words（{ A: ['浜辺', …], B: [...] }）を渡すと、「浜辺がいい」のような場所の名前でも読む
function parseChoice(text, words) {
  const t = norm(text).toUpperCase();
  const found = new Set();
  const re = /(^|[^A-Z])([ABC])(?=[^A-Z]|$)/g;
  let m;
  while ((m = re.exec(t))) { found.add(m[2]); re.lastIndex = m.index + m[0].length; }
  if (words) for (const [k, list] of Object.entries(words)) if ((list || []).some((w) => w && t.includes(norm(w).toUpperCase()))) found.add(k);
  return found.size === 1 ? [...found][0] : null;
}

// 1 人 1 票（最後のコメントが有効）、締め切り後は数えない。時間ごとの伸びも返す
//   exclude：数えない人の名前（町のアカウントの持ち主など。小文字）、words：場所の名前でも読む時の言葉（parseChoice）
function tallyVote(comments, { opensAt, closesAt, stepHours = 3, exclude = null, words = null }) {
  const open = Date.parse(opensAt), close = Date.parse(closesAt);
  const ex = new Set((exclude || []).map((s) => String(s).toLowerCase()));
  const list = comments
    .filter((c) => !ex.size || !ex.has(norm(commentUser(c).username).toLowerCase()))
    .map((c) => ({ c, t: Date.parse(c.timestamp), choice: parseChoice(c.text, words) }))
    .filter((x) => x.choice && x.t >= open && x.t <= close)
    .sort((a, b) => a.t - b.t);
  const current = new Map();
  const timeline = [];
  const counts = () => { const r = { A: 0, B: 0, C: 0 }; for (const v of current.values()) r[v.choice]++; return r; };
  let i = 0;
  const end = Math.min(close, Math.max(open, list.length ? list[list.length - 1].t : open));
  for (let t = open; t <= end + stepHours * 3600e3; t += stepHours * 3600e3) {
    const stop = Math.min(t, close);
    while (i < list.length && list[i].t <= stop) {
      const u = commentUser(list[i].c);
      current.set(u.igId ? 'ig:' + u.igId : 'user:' + norm(u.username).toLowerCase(), { choice: list[i].choice, u });
      i++;
    }
    timeline.push({ t: new Date(stop).toISOString(), ...counts() });
    if (stop >= close) break;
  }
  while (i < list.length) { const u = commentUser(list[i].c); current.set(u.igId ? 'ig:' + u.igId : 'user:' + norm(u.username).toLowerCase(), { choice: list[i].choice, u }); i++; }
  const votes = counts();
  return { votes, voters: current.size, comments: list.length, timeline, who: [...current.values()].map((x) => x.u) };
}

// ---------- フォロワー一覧（インスタの「情報をダウンロード」） ----------
// followers_1.json の形: [{ string_list_data: [{ href, value: "username", timestamp }] }, ...]
function readFollowerExport(json) {
  const arr = Array.isArray(json) ? json : (json.relationships_followers || json.followers || []);
  const out = [];
  for (const item of arr) {
    for (const s of item.string_list_data || []) {
      const username = s.value || (s.href || '').split('/').filter(Boolean).pop();
      if (username) out.push({ username, timestamp: s.timestamp ? new Date(s.timestamp * 1000).toISOString() : null });
    }
  }
  return out;
}

// hidden.json に書く印（hmac:...）
const hiddenEntry = (username) => 'hmac:' + userHash(username);

// ---------- 引っ越した人（tools/moveout.js が data/moved.json に書く） ----------
// [{ u: userHash, ig: [igHash…], at: 引っ越した時刻 }]（塩入りの印だけ。名前・村人の番号は入れない）。
// 前に書いた「住みたい」コメントはインスタに残るので、引っ越した時刻より前のコメント・DM では住み直さない。
// 引っ越したあとに新しく「住みたい」と書けば、ふつうに新しく住める
function loadMoved(dataDir) {
  const f = path.join(dataDir, 'moved.json');
  try { const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; return Array.isArray(j) ? j : []; } catch { return []; }
}
// r = { igId, username, lastAt }（registrationsFrom の 1 人分）。引っ越す前の申しこみなら true
function movedBefore(moved, r) {
  if (!moved || !moved.length || !r) return false;
  const u = r.username ? userHash(r.username) : null, ig = r.igId ? igHash(r.igId) : null;
  const at = Date.parse(r.lastAt || 0) || 0;
  return moved.some((m) => ((u && m.u === u) || (ig && (m.ig || []).includes(ig))) && at <= Date.parse(m.at));
}

module.exports = { loadMoved, movedBefore, saltIsDev, hiddenEntry, norm, igHash, userHash, keyFor, nickname, loadHidden, applyPrivacy, findVillager, upsertVillager, registrationsFrom, isJoin, JOIN_WORDS, parseStartTool, startToolByLabel, startToolById, parseBirthday, parseFood, parseMbti, parseCommentProfile, profileUpdatesFrom, applyCommentProfiles, FOODS, autoBirthday, autoFood, fillJoinProfile, nameBirthday, fitGenderSkin, skinTag, parseChoice, tallyVote, readFollowerExport, commentUser };
