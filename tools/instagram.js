#!/usr/bin/env node
'use strict';
// インスタ公式の Graph API から、フォロワー数とコメントを読んで data/inbox/instagram.json に書く。
// sim.js はこのファイルがあれば読む（参加の登録・投票・フォロワー数）。
//
// 要るもの（GitHub の Secrets に入れる。README 参照）
//   IG_TOKEN        長期アクセストークン（instagram_basic, instagram_manage_comments など）
//   IG_USER_ID      インスタのビジネス／クリエイターアカウントの ID
//   IG_JOIN_MEDIA   「参加したい」を集める投稿の ID（カンマ区切りで複数可）
//   IG_VOTE_MEDIA   今の投票の投稿の ID（投票がない時は空）
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
const API = 'https://graph.facebook.com/v21.0';
const args = process.argv.slice(2);

async function get(url) {
  const r = await fetch(url);
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
  const join = (process.env.IG_JOIN_MEDIA || '').split(',').map((s) => s.trim()).filter(Boolean);
  const vote = (process.env.IG_VOTE_MEDIA || '').trim();
  const data = { fetchedAt: new Date().toISOString() };
  data.followers = await followers(userId, token);
  data.joinComments = [];
  for (const m of join) data.joinComments.push(...(await comments(m, token)));
  data.voteComments = vote ? await comments(vote, token) : null;
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`フォロワー ${data.followers} 人・登録コメント ${data.joinComments.length} 件・投票コメント ${data.voteComments ? data.voteComments.length : 0} 件を読みました`);
}
module.exports = { sendPrivateReply, dmReady };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
