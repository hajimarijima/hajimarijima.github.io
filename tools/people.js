'use strict';
// 村人の登録・名前のかくし・コメント投票の集計（sim.js / instagram.js / import_followers.js / テストで共通）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { skinFor, hashStr } = require('./rand');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
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

// hidden.json: ["名前", "sha256:<userHash>"] のどちらでも書ける
function loadHidden(dataDir) {
  const f = path.join(dataDir, 'hidden.json');
  if (!fs.existsSync(f)) return new Set();
  const list = JSON.parse(fs.readFileSync(f, 'utf8'));
  const set = new Set();
  for (const e of (Array.isArray(list) ? list : list.names || [])) {
    const s = String(e);
    set.add(s.startsWith('sha256:') ? s.slice(7) : userHash(s));
  }
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
function upsertVillager(villagers, { igId, username, joined, joinedDay, source, startTool }, hidden) {
  const hit = findVillager(villagers, { igId, username });
  if (hit) {
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
  // 古い順に見て、1 人 1 回。最後の名前を使う。道具の言葉は、書いてある最後のものを使う
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
    byUser.set(id, r);
  }
  return [...byUser.values()];
}

// 「A」「ａ」「Aがいい」「Ｂ案」などから 1 文字を読む。2 つ以上書いてあれば数えない
function parseChoice(text) {
  const t = norm(text).toUpperCase();
  const found = new Set();
  const re = /(^|[^A-Z])([ABC])(?=[^A-Z]|$)/g;
  let m;
  while ((m = re.exec(t))) { found.add(m[2]); re.lastIndex = m.index + m[0].length; }
  return found.size === 1 ? [...found][0] : null;
}

// 1 人 1 票（最後のコメントが有効）、締め切り後は数えない。時間ごとの伸びも返す
function tallyVote(comments, { opensAt, closesAt, stepHours = 3 }) {
  const open = Date.parse(opensAt), close = Date.parse(closesAt);
  const list = comments
    .map((c) => ({ c, t: Date.parse(c.timestamp), choice: parseChoice(c.text) }))
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

module.exports = { norm, igHash, userHash, keyFor, nickname, loadHidden, applyPrivacy, findVillager, upsertVillager, registrationsFrom, isJoin, JOIN_WORDS, parseStartTool, startToolByLabel, startToolById, parseChoice, tallyVote, readFollowerExport, commentUser };
