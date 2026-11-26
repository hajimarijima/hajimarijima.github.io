#!/usr/bin/env node
'use strict';
// インスタ公式の Graph API から、フォロワー数とコメントを読んで data/inbox/instagram.json に書く。
// sim.js はこのファイルがあれば読む（参加の登録・投票・フォロワー数）。
//
// 要るもの（GitHub の Secrets に入れる。README 参照）
//   IG_TOKEN        長期アクセストークン（instagram_basic, instagram_manage_comments など）
//   IG_USER_ID      インスタのビジネス／クリエイターアカウントの ID
//   IG_JOIN_MEDIA   「参加したい」を集める投稿の ID（カンマ区切りで複数可）。config.json の joinPostUrl があればそちらを使う
//   IG_VOTE_MEDIA   今の投票の投稿の ID（投票がない時は空）。config.json の votePostUrl があればそちらを使う
// 「住みたい」と誕生日・好きな食べ物・MBTI は、最近の投稿（config.joinScanPosts・joinScanDays）のどれに書いてもよい。投票は投票の投稿だけ。
//   join.yml は --cache を付けて、コメントの数が前と同じ投稿を読まない（API の節約。Webhook の IG_HINT_MEDIA の投稿は必ず読む）。
// 投稿は URL で決めるのがかんたん：config.json の votePostUrl / joinPostUrl（Actions の「投稿の URL を変える」で書ける）。
//   URL から ID は、アカウントの投稿の一覧（permalink）と比べて自動で探す。見つからない時は上の Secrets を使う。
//
// DM（Private Replies）で招待リンクを送る部分は、形だけ作ってある（sendPrivateReply）。
//   要る権限：instagram_manage_comments・instagram_manage_messages（Meta のアプリ審査が要る）。
//   コメントから 7 日以内に、1 つのコメントへ 1 回だけ送れる。審査が済むまでは送らない（dmReady() が false）。
//
// まだ API にはつないでいない。--sample を付けると tests/sample_comments.json を API の代わりに使う。
//   node tools/instagram.js --sample
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'inbox', 'instagram.json');
const CACHE = path.join(ROOT, 'data', 'inbox', 'ig_cache.json'); // 公開しない（data/inbox/ は .gitignore）。名前やコメントは入れない
// 鍵の種類で窓口を変える：インスタのログインで出した鍵（IG…）は graph.instagram.com、Facebook の鍵は graph.facebook.com
const API = /^IG/.test(String(process.env.IG_TOKEN || '')) ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
const args = process.argv.slice(2);

// テストで Graph API の代わりを入れられるように（本番はそのまま fetch）
let fetchFn = (...a) => fetch(...a);
const _setFetch = (f) => { fetchFn = f || ((...a) => fetch(...a)); };

// API を呼んだ回数（ログに出す。1 時間に約 200 回までなので、むだに呼ばない）
let apiCalls = 0;
async function get(url) {
  apiCalls++;
  const r = await fetchFn(url);
  if (!r.ok) throw new Error('Graph API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}

// 投稿のコメントを全部読む（次のページもたどる）。返事のコメントは数えない。1 ページ 50 件 = 1 回
async function comments(mediaId, token, maxPages = 40) {
  const out = [];
  let url = `${API}/${mediaId}/comments?fields=id,text,timestamp,username,from{id,username}&limit=50&access_token=${encodeURIComponent(token)}`;
  for (let p = 0; url && p < maxPages; p++) {
    const j = await get(url);
    out.push(...(j.data || []));
    url = j.paging && j.paging.next;
  }
  return out;
}

// アカウントの投稿の一覧（新しい順）。ページは要る時だけ読み、読んだ分は何度でも使う（URL 探し・最近の投稿・コメントの数で同じ一覧を使う）
function mediaList(userId, token) {
  const items = [];
  let next = `${API}/${userId}/media?fields=id,permalink,timestamp,comments_count&limit=50&access_token=${encodeURIComponent(token)}`;
  return {
    items,
    get done() { return !next; },
    async more() {
      if (!next) return false;
      const j = await get(next);
      items.push(...(j.data || []));
      next = j.paging && j.paging.next;
      return true;
    },
    async atLeast(n) { while (items.length < n && (await this.more())); return items.slice(0, n); },
  };
}

// 最近の投稿の ID（新しい順）。IG_JOIN_MEDIA / IG_VOTE_MEDIA を入れなくても動くように
async function recentMedia(userId, token, n = 5, list = mediaList(userId, token)) {
  return (await list.atLeast(n)).map((m) => String(m.id));
}

// ---------- 投稿の URL → 投稿の ID ----------
// config.json の votePostUrl / joinPostUrl に貼った URL から、投稿の ID を自動で探す。
// URL の形はいろいろ（www あり・なし、/p/ と /reel/、?igsh=… 付き、/ユーザー名/p/… など）なので、
// 「短いコード」（/p/ の次の文字）だけを比べる。
function postCode(url) {
  let s = String(url || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  if (host !== 'instagram.com' && host !== 'instagr.am') return null;
  const seg = u.pathname.split('/').filter(Boolean);
  const i = seg.findIndex((x) => /^(p|reel|reels|tv)$/i.test(x));
  if (i < 0 || !seg[i + 1] || !/^[A-Za-z0-9_-]+$/.test(seg[i + 1])) return null;
  return seg[i + 1];
}
// 比べる形にそろえる（クエリ・最後の / ・www を落とし、/reel/ も /p/ にする）
function normPostUrl(url) { const c = postCode(url); return c ? `instagram.com/p/${c}` : null; }
const sameMedia = (a, b) => { const x = normPostUrl(a); return !!x && x === normPostUrl(b); };
// 文字でも配列でも、URL のならびにする
const urlList = (v) => (Array.isArray(v) ? v : [v]).map((s) => String(s || '').trim()).filter(Boolean);

// アカウントの投稿を新しい順にたどって、URL に合う投稿の ID を探す（見つかったら止める）
async function findMediaIds(urls, userId, token, maxPages = 10, list = mediaList(userId, token)) {
  const want = new Map(); // 短いコード → URL
  for (const u of urls) { const c = postCode(u); if (c) want.set(c, u); }
  const found = new Map(); // URL → ID
  const look = (m) => { const c = postCode(m.permalink); if (c && want.has(c)) found.set(want.get(c), String(m.id)); };
  if (!want.size) return found;
  let seen = 0;
  for (let page = 0; ; page++) {
    for (; seen < list.items.length; seen++) look(list.items[seen]);
    if (found.size >= want.size || list.done || page >= maxPages || !(await list.more())) break;
  }
  for (; seen < list.items.length; seen++) look(list.items[seen]);
  return found;
}

// どの投稿を読むか決める。URL（config.json）→ Secrets（IG_*_MEDIA）→ 最近の投稿 の順
async function resolveMedia(cfg, env, userId, token, log = console.log, list = mediaList(userId, token)) {
  const voteUrls = urlList(cfg && cfg.votePostUrl).slice(0, 1);
  const joinUrls = urlList(cfg && cfg.joinPostUrl);
  for (const u of [...voteUrls, ...joinUrls]) if (!postCode(u)) log(`インスタの投稿の URL に見えません（使いません）：${u}`);
  let found = new Map();
  const ask = [...voteUrls, ...joinUrls].filter((u) => postCode(u));
  if (ask.length) {
    try { found = await findMediaIds(ask, userId, token, 10, list); } catch (e) { log('投稿の一覧を読めませんでした：' + e.message.slice(0, 120)); }
  }
  let recent = null;
  const getRecent = async () => (recent = recent || await recentMedia(userId, token, 5, list));
  const out = { join: [], vote: '', source: {} };

  // 投票
  const vu = voteUrls[0];
  if (vu && found.has(vu)) { out.vote = found.get(vu); out.source.vote = 'url'; log(`投票の投稿：config.json の votePostUrl（${vu}）→ ID ${out.vote}`); }
  else {
    if (vu) log(`投票の投稿：votePostUrl（${vu}）が最近の投稿に見つかりません。代わりを使います`);
    const sec = String(env.IG_VOTE_MEDIA || '').trim();
    if (sec) { out.vote = sec; out.source.vote = 'secret'; log('投票の投稿：Secrets の IG_VOTE_MEDIA'); }
    else { out.vote = (await getRecent())[0] || ''; out.source.vote = 'recent'; log('投票の投稿：いちばん新しい投稿（URL も IG_VOTE_MEDIA もないため）'); }
  }

  // 住みたい（いくつでも）
  for (const u of joinUrls) {
    if (found.has(u)) { if (!out.join.includes(found.get(u))) out.join.push(found.get(u)); log(`住みたいの投稿：config.json の joinPostUrl（${u}）→ ID ${found.get(u)}`); }
    else if (postCode(u)) log(`住みたいの投稿：joinPostUrl（${u}）が最近の投稿に見つかりません`);
  }
  if (out.join.length) out.source.join = 'url';
  else {
    const sec = String(env.IG_JOIN_MEDIA || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (sec.length) { out.join = sec; out.source.join = 'secret'; log(`住みたいの投稿：Secrets の IG_JOIN_MEDIA（${sec.length} 件）`); }
    else { out.join = await getRecent(); out.source.join = 'recent'; log(`住みたいの投稿：最近の ${out.join.length} 投稿（URL も IG_JOIN_MEDIA もないため）`); }
  }
  return out;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')); } catch (e) { return {}; }
}

// インスタのログインの鍵は 60 日で切れるので、毎日のばす。新しい文字が返ってきた時だけ Secrets の貼りかえが要る
async function refreshToken(token) {
  if (!/^IG/.test(String(token || ''))) return;
  try {
    const j = await get(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    const days = Math.floor((j.expires_in || 0) / 86400);
    console.log(j.access_token && j.access_token !== token ? `鍵が新しくなりました。GitHub の Secrets の IG_TOKEN を貼りかえてください（あと ${days} 日）` : `鍵をのばしました（あと ${days} 日）`);
  } catch (e) { console.log('鍵をのばせませんでした：' + e.message.slice(0, 120)); }
}

// ---------- 最近の投稿をまとめて読む（どの投稿の「住みたい」も受け付ける） ----------
// config.joinScanPosts（最近の何投稿か。既定 25・上限 100）と joinScanDays（何日前までか。既定 60・0 なら切らない）
function scanOpts(cfg) {
  const num = (v, d, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : d; };
  return { posts: num(cfg && cfg.joinScanPosts, 25, 100), days: num(cfg && cfg.joinScanDays, 60, 3650) };
}
// 小さな覚え書き（data/inbox/ig_cache.json。公開しない。Actions のキャッシュに置く）：
//   media: { 投稿の ID: そのとき読んだコメントの数 }、fullAt: 全部読み直した時刻、followers・followersAt・owner（読めない時の代わり）、refreshedAt
// コメントの数が前と同じ投稿は読まない（もう受け付けた分なので）。6 時間に 1 回は全部読み直す（消して足して同じ数、を拾う）
const FULL_EVERY = 6 * 3600e3, REFRESH_EVERY = 20 * 3600e3;
// Webhook から渡される「コメントがついた投稿」の ID（数字だけ・カンマ区切り）
const hintIds = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => /^\d{1,30}$/.test(x)).slice(0, 20);

// インスタから読む（ファイルは書かない。テストでにせの fetch を入れて確かめる）
//   戻り値 { data（inbox に書く中身）, cache（次の覚え書き）, calls（API を呼んだ回数）, stats }
async function collect({ cfg = {}, env = {}, userId, token, cache = null, now = new Date(), log = console.log, hint = '' } = {}) {
  const start = apiCalls;
  const t = now.getTime();
  const old = cache && cache.v === 1 ? cache : null;
  const full = !old || !(t - Date.parse(old.fullAt || 0) < FULL_EVERY);
  const hints = new Set(hintIds(hint));
  const next = { v: 1, media: {}, fullAt: full ? now.toISOString() : old.fullAt, refreshedAt: old && old.refreshedAt, followers: old && old.followers, followersAt: old && old.followersAt, owner: old && old.owner };

  if (!old || !(t - Date.parse(old.refreshedAt || 0) < REFRESH_EVERY)) { await refreshToken(token); next.refreshedAt = now.toISOString(); }

  const list = mediaList(userId, token);
  const sc = scanOpts(cfg);
  const res = await resolveMedia(cfg, env, userId, token, log, list);
  const vote = res.vote;
  // 住みたいの投稿：URL か Secrets で決めた投稿（「最近の 5 投稿」の代わりは、下の最近の投稿で読むので使わない）
  const join = res.source.join === 'recent' && sc.posts > 0 ? [] : res.join;
  // 最近の投稿（数と日にちで切る）
  let recent = [];
  if (sc.posts > 0) {
    try { recent = await list.atLeast(sc.posts); } catch (e) { log('最近の投稿を読めませんでした：' + e.message.slice(0, 120)); }
    if (sc.days > 0) recent = recent.filter((m) => !m.timestamp || t - Date.parse(String(m.timestamp).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) <= sc.days * 86400e3);
  }
  const count = new Map(list.items.map((m) => [String(m.id), m.comments_count]));
  // 投票の投稿に書いた「住みたい」も受け付ける（投票のために読むので、API は増えない）
  const joinIds = [...new Set([...join.map(String), ...recent.map((m) => String(m.id)), ...(vote ? [String(vote)] : [])])];

  // フォロワー数と町のアカウントの名前（1 回で読む。毎回読んで、サイトのフォロワー数を 15 分ごとに新しくする。読めない時は前の値）
  try {
    const me = await get(`${API}/${userId}?fields=followers_count,username&access_token=${encodeURIComponent(token)}`);
    if (typeof me.followers_count === 'number') { next.followers = me.followers_count; next.followersAt = now.toISOString(); }
    if (me.username) next.owner = String(me.username).toLowerCase();
  } catch (e) { log('フォロワー数を読めませんでした：' + e.message.slice(0, 120)); }
  const owner = next.owner || '';
  // 町のアカウント自身のコメントは、村人の受付にも投票にも数えない（持ち主は村人にしない）
  const notOwner = (c) => { const u = c.from || {}; return !(String(u.id || '') === String(userId) || (owner && String(u.username || c.username || '').toLowerCase() === owner)); };

  const stats = { posts: joinIds.length, read: 0, skipped: 0, empty: 0 };
  const byPost = new Map();
  const readPost = async (id) => {
    if (!byPost.has(id)) { byPost.set(id, await comments(id, token)); }
    return byPost.get(id);
  };
  // 投票：投票の投稿だけ。毎回ぜんぶ読む（数え直すので）
  let voteComments = null;
  if (vote) {
    const n = count.get(String(vote));
    voteComments = n === 0 ? [] : (await readPost(String(vote))).filter(notOwner);
    if (n != null) next.media[String(vote)] = n;
  }
  const joinComments = [];
  const seenComment = new Set();
  for (const id of joinIds) {
    const n = count.get(id);
    if (n === 0) { stats.empty++; next.media[id] = 0; continue; } // コメントがない投稿は呼ばない
    const same = !full && !hints.has(id) && n != null && old.media && old.media[id] === n;
    if (same && id !== String(vote)) { stats.skipped++; next.media[id] = n; continue; }
    let cs;
    try { cs = await readPost(id); } catch (e) { log(`投稿 ${id} のコメントを読めませんでした：` + e.message.slice(0, 120)); continue; } // 覚え書きに入れない（次にまた読む）
    stats.read++;
    if (n != null) next.media[id] = n;
    for (const c of cs) {
      if (!notOwner(c)) continue;
      const k = c.id ? String(c.id) : JSON.stringify([c.from && c.from.id, c.timestamp, c.text]);
      if (seenComment.has(k)) continue; // 同じコメントは 1 回だけ（同じ人の何回かのコメントは registrationsFrom が 1 人にまとめる）
      seenComment.add(k); joinComments.push(c);
    }
  }
  const data = { fetchedAt: now.toISOString(), followers: next.followers, joinComments, voteComments, scan: { ...stats, full } };
  if (owner) data.owner = owner;
  return { data, cache: next, calls: apiCalls - start, stats: { ...stats, full } };
}

// ---------- Webhook（コメントがついたら知らせてもらう）をこのアカウントでオンにする ----------
// Actions の ig-check で「webhook をオンにする」を選んだ時だけ。鍵は出さない。docs/すぐ反映する手順.md
async function subscribeWebhook(userId, token, log = console.log) {
  const post = async (url) => {
    const r = await fetchFn(url, { method: 'POST' });
    const txt = await r.text();
    if (!r.ok) throw new Error(r.status + ': ' + txt.slice(0, 300));
    return txt;
  };
  if (/^IG/.test(String(token))) { // インスタのログイン：アカウントそのものに付ける
    const t = await post(`https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=comments&access_token=${encodeURIComponent(token)}`);
    log('Webhook（comments）をオンにしました：' + t.slice(0, 80));
    return true;
  }
  // Facebook のログイン：インスタとつないだ Facebook ページに付ける（ページの鍵は API から受け取り、出さない）
  const j = await get(`${API}/me/accounts?fields=id,name,access_token,instagram_business_account&limit=100&access_token=${encodeURIComponent(token)}`);
  const page = (j.data || []).find((p) => p.instagram_business_account && String(p.instagram_business_account.id) === String(userId));
  if (!page) { log('インスタとつないだ Facebook ページが見つかりません（鍵に pages_show_list と pages_manage_metadata の権限があるか見る）'); return false; }
  const t = await post(`${API}/${page.id}/subscribed_apps?subscribed_fields=feed&access_token=${encodeURIComponent(page.access_token)}`);
  log(`Facebook ページ「${page.name || page.id}」で Webhook をオンにしました：` + t.slice(0, 80));
  return true;
}

// ---------- DM（Private Replies）：形だけ ----------
// 本物にするには：審査が済んだら DM_READY を true にし、下の fetch の行の // を外す。キーは GitHub の Secrets（IG_TOKEN）から。
const DM_READY = false;
const dmReady = () => DM_READY && !!process.env.IG_TOKEN && !!process.env.IG_USER_ID;
// POST /{IG_USER_ID}/messages  { recipient: { comment_id }, message: { text } }
async function sendPrivateReply(commentId, text, env = process.env) {
  const request = {
    url: `${API}/${env.IG_USER_ID || '{IG_USER_ID}'}/messages`,
    body: { recipient: { comment_id: String(commentId) }, message: { text: String(text).slice(0, 1000) } },
  };
  if (!dmReady()) return { sent: false, dry: true, request: { url: request.url, body: { recipient: request.body.recipient, message: { text: '(省略)' } } } };
  // const r = await fetch(request.url + '?access_token=' + encodeURIComponent(env.IG_TOKEN), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) });
  // if (!r.ok) throw new Error('Private Reply ' + r.status + ': ' + (await r.text()).slice(0, 300));
  // return { sent: true, id: (await r.json()).message_id };
  return { sent: false, dry: true };
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (args.includes('--sample')) {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'sample_comments.json'), 'utf8'));
    const data = { fetchedAt: new Date().toISOString(), followers: s.followers, joinComments: s.joinComments, voteComments: s.voteComments, sample: true };
    fs.writeFileSync(OUT.replace('.json', '.sample.json'), JSON.stringify(data, null, 1) + '\n');
    console.log('見本を data/inbox/instagram.sample.json に書きました（sim.js は sample を使いません。確かめは npm test）');
    return;
  }
  const token = process.env.IG_TOKEN, userId = process.env.IG_USER_ID;
  if (!token || !userId) { console.log('IG_TOKEN / IG_USER_ID がないので、インスタは読みません（町は見本のまま進みます）'); return; }
  if (args.includes('--subscribe')) { if (!(await subscribeWebhook(userId, token))) process.exit(1); return; }
  if (args.includes('--check')) { // つながるかだけ確かめる（何も書かない・鍵の中身は出さない）
    const j = await get(`${API}/${userId}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(token)}`);
    const recent = await recentMedia(userId, token);
    console.log(`つながりました：@${j.username}・フォロワー ${j.followers_count} 人・投稿 ${j.media_count} 件・窓口 ${API.split('/')[2]}`);
    for (const m of recent.slice(0, 2)) console.log(`投稿 ${m} のコメント ${(await comments(m, token)).length} 件`);
    await resolveMedia(readConfig(), process.env, userId, token); // 貼った URL の投稿が見つかるか
    return;
  }
  // 読む投稿：住みたい＝最近の投稿（joinScanPosts）＋ joinPostUrl（なければ Secrets）。投票＝votePostUrl → Secrets → いちばん新しい投稿
  // --cache を付けた時だけ覚え書き（data/inbox/ig_cache.json）を使う。join.yml だけが付ける（daily は毎回ぜんぶ読む）
  const useCache = args.includes('--cache');
  let cache = null;
  if (useCache) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { cache = null; } }
  const r = await collect({ cfg: readConfig(), env: process.env, userId, token, cache, hint: process.env.IG_HINT_MEDIA });
  fs.writeFileSync(OUT, JSON.stringify(r.data, null, 1) + '\n');
  if (useCache) fs.writeFileSync(CACHE, JSON.stringify(r.cache) + '\n');
  const s = r.stats;
  console.log(`フォロワー ${r.data.followers} 人・住みたいのコメント ${r.data.joinComments.length} 件・投票のコメント ${r.data.voteComments ? r.data.voteComments.length : 0} 件を読みました`);
  console.log(`投稿 ${s.posts} 件を見て、読んだ ${s.read}・前と同じで読まない ${s.skipped}・コメントなし ${s.empty}${s.full ? '（全部読み直し）' : ''}。API ${r.calls} 回`);
}
module.exports = { sendPrivateReply, dmReady, postCode, normPostUrl, sameMedia, urlList, findMediaIds, resolveMedia, scanOpts, hintIds, collect, subscribeWebhook, _setFetch };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
