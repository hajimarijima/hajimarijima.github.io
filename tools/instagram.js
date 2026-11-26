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
// 鍵の種類で窓口を変える：インスタのログインで出した鍵（IG…）は graph.instagram.com、Facebook の鍵は graph.facebook.com
const API = /^IG/.test(String(process.env.IG_TOKEN || '')) ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
const args = process.argv.slice(2);

// テストで Graph API の代わりを入れられるように（本番はそのまま fetch）
let fetchFn = (...a) => fetch(...a);
const _setFetch = (f) => { fetchFn = f || ((...a) => fetch(...a)); };

async function get(url) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error('Graph API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}

// 投稿のコメントを全部読む（次のページもたどる）。返事のコメントは数えない
async function comments(mediaId, token) {
  const out = [];
  let url = `${API}/${mediaId}/comments?fields=id,text,timestamp,username,from{id,username}&limit=50&access_token=${encodeURIComponent(token)}`;
  while (url) {
    const j = await get(url);
    out.push(...(j.data || []));
    url = j.paging && j.paging.next;
  }
  return out;
}

// 最近の投稿の ID（新しい順）。IG_JOIN_MEDIA / IG_VOTE_MEDIA を入れなくても動くように
async function recentMedia(userId, token, n = 5) {
  const j = await get(`${API}/${userId}/media?fields=id,timestamp&limit=${n}&access_token=${encodeURIComponent(token)}`);
  return (j.data || []).map((m) => m.id);
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
async function findMediaIds(urls, userId, token, maxPages = 10) {
  const want = new Map(); // 短いコード → URL
  for (const u of urls) { const c = postCode(u); if (c) want.set(c, u); }
  const found = new Map(); // URL → ID
  let url = want.size ? `${API}/${userId}/media?fields=id,permalink,timestamp&limit=50&access_token=${encodeURIComponent(token)}` : null;
  for (let page = 0; url && page < maxPages && found.size < want.size; page++) {
    const j = await get(url);
    for (const m of j.data || []) {
      const c = postCode(m.permalink);
      if (c && want.has(c)) found.set(want.get(c), String(m.id));
    }
    url = j.paging && j.paging.next;
  }
  return found;
}

// どの投稿を読むか決める。URL（config.json）→ Secrets（IG_*_MEDIA）→ 最近の投稿 の順
async function resolveMedia(cfg, env, userId, token, log = console.log) {
  const voteUrls = urlList(cfg && cfg.votePostUrl).slice(0, 1);
  const joinUrls = urlList(cfg && cfg.joinPostUrl);
  for (const u of [...voteUrls, ...joinUrls]) if (!postCode(u)) log(`インスタの投稿の URL に見えません（使いません）：${u}`);
  let found = new Map();
  const ask = [...voteUrls, ...joinUrls].filter((u) => postCode(u));
  if (ask.length) {
    try { found = await findMediaIds(ask, userId, token); } catch (e) { log('投稿の一覧を読めませんでした：' + e.message.slice(0, 120)); }
  }
  let recent = null;
  const getRecent = async () => (recent = recent || await recentMedia(userId, token));
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

async function followers(userId, token) {
  const j = await get(`${API}/${userId}?fields=followers_count,username&access_token=${encodeURIComponent(token)}`);
  return j.followers_count;
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
  if (args.includes('--check')) { // つながるかだけ確かめる（何も書かない・鍵の中身は出さない）
    const j = await get(`${API}/${userId}?fields=username,followers_count,media_count&access_token=${encodeURIComponent(token)}`);
    const recent = await recentMedia(userId, token);
    console.log(`つながりました：@${j.username}・フォロワー ${j.followers_count} 人・投稿 ${j.media_count} 件・窓口 ${API.split('/')[2]}`);
    for (const m of recent.slice(0, 2)) console.log(`投稿 ${m} のコメント ${(await comments(m, token)).length} 件`);
    await resolveMedia(readConfig(), process.env, userId, token); // 貼った URL の投稿が見つかるか
    return;
  }
  await refreshToken(token);
  // 読む投稿：config.json の URL → Secrets の ID → 最近の 5 投稿（投票はいちばん新しい投稿）
  const { join, vote } = await resolveMedia(readConfig(), process.env, userId, token);
  const data = { fetchedAt: new Date().toISOString() };
  data.followers = await followers(userId, token);
  // 町のアカウント自身のコメントは、村人の受付にも投票にも数えない（持ち主は村人にしない）
  const me = await get(`${API}/${userId}?fields=username&access_token=${encodeURIComponent(token)}`).catch(() => ({}));
  const owner = String(me.username || '').toLowerCase();
  const notOwner = (c) => { const u = c.from || {}; return !(String(u.id || '') === String(userId) || (owner && String(u.username || c.username || '').toLowerCase() === owner)); };
  if (owner) data.owner = owner;
  data.joinComments = [];
  for (const m of join) data.joinComments.push(...(await comments(m, token)).filter(notOwner));
  data.voteComments = vote ? (await comments(vote, token)).filter(notOwner) : null;
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`フォロワー ${data.followers} 人・登録コメント ${data.joinComments.length} 件・投票コメント ${data.voteComments ? data.voteComments.length : 0} 件を読みました`);
}
module.exports = { sendPrivateReply, dmReady, postCode, normPostUrl, sameMedia, urlList, findMediaIds, resolveMedia, _setFetch };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
