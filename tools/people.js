'use strict';
// 村人の登録・名前のかくし・コメント投票の集計（sim.js / instagram.js / import_followers.js / テストで共通）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { skinFor, hashStr } = require('./rand');

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
  if (igId) { const hit = villagers.find((v) => v.igId === igHash(igId)); if (hit) return hit; }
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

function registrationsFrom(comments, word, startTools, opts) {
  // 古い順に見て、1 人 1 回。最後の名前を使う。道具・誕生日・好きな食べ物の言葉は、書いてある最後のものを使う
  const byUser = new Map();
  for (const c of [...comments].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    if (!isJoin(c.text, word)) continue;
    const u = commentUser(c);
    const id = u.igId ? 'ig:' + u.igId : 'user:' + norm(u.username).toLowerCase();
    const prev = byUser.get(id);
    const tool = startTools ? parseStartTool(c.text, startTools, opts) : null;
    const r = { ...u, firstAt: prev ? prev.firstAt : c.timestamp };
    const st = tool || (prev && prev.startTool);
    if (st) r.startTool = st;
    const bd = parseBirthday(c.text) || (prev && prev.birthday);
    if (bd) r.birthday = bd;
    const fd = parseFood(c.text) || (prev && prev.food);
    if (fd) r.food = fd;
    byUser.set(id, r);
  }
  return [...byUser.values()];
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
const autoBirthday = (key) => { const h = hashStr('bday:' + key), m = (h % 12) + 1; return md(m, ((h >>> 5) % (m === 2 ? 28 : MONTH_DAYS[m - 1])) + 1); };
const autoFood = (key) => AUTO_FOODS[hashStr('food:' + key) % AUTO_FOODS.length];
// 「住みたい」で来た人（source: comment）に、誕生日と好きな食べ物を入れる（ある物は変えない＝足すだけ）。
// said：コメントに書いてあった値。今の値がないか自動で入れた値の時だけ、書いてあった値に変える（ログインのプロフィールで入れた値は変えない）
function fillJoinProfile(v, said = {}) {
  if (v.source !== 'comment' && !said.birthday && !said.food) return false;
  let changed = false;
  const prof = v.profile || {};
  if (said.birthday && v.birthday !== said.birthday && (!v.birthday || v.birthday === autoBirthday(v.key))) { v.birthday = said.birthday; changed = true; }
  if (said.food && prof.food !== said.food && (!prof.food || prof.food === autoFood(v.key))) { v.profile = { ...prof, food: said.food }; changed = true; }
  if (v.source === 'comment') {
    if (!v.birthday) { v.birthday = autoBirthday(v.key); changed = true; }
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

module.exports = { saltIsDev, hiddenEntry, norm, igHash, userHash, keyFor, nickname, loadHidden, applyPrivacy, findVillager, upsertVillager, registrationsFrom, isJoin, JOIN_WORDS, parseStartTool, startToolByLabel, startToolById, parseBirthday, parseFood, FOODS, autoBirthday, autoFood, fillJoinProfile, parseChoice, tallyVote, readFollowerExport, commentUser };
