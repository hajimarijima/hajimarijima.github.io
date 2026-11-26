// はじまり島：インスタのコメントがついたら、すぐ GitHub Actions の join を動かす受け口（Cloudflare Workers・無料）。
// 中身の説明と、置き方の手順は docs/すぐ反映する手順.md。
//
// すること（コメントの中身や名前はどこにも書かない・残さない）
//   1) Meta の Webhook（comments / live_comments）を受けて、本物か確かめ（X-Hub-Signature-256）、GitHub に「join を動かして」と頼む
//   2) 2 分ごと（Cron）：フォロワー数を読んで KV に置く。GH_DISPATCH_TOKEN があれば、投稿のコメントの数も見て、増えていたら 1) と同じく頼む
//   3) GET /stats：KV のフォロワー数を {"followers": 123, "at": "…"} で返す（サイト https://hajimarijima.github.io だけ読める・60 秒キャッシュ）
//   インスタの API は 2) で 2 分に 1 回（コメントの数も見る時は 1 回で両方読む）
//
// Worker に入れる Secrets（値は持ち主が Cloudflare の画面で入れる。このファイルには書かない）
//   META_VERIFY_TOKEN   Meta の Webhook の「認証トークン（Verify Token）」に入れたのと同じ、自分で決めた合言葉
//   META_APP_SECRET     Meta のアプリの「app secret」（署名の確かめに使う）
//   IG_APP_SECRET       （任意）インスタのログインのアプリの「Instagram app secret」。どちらで署名されても通す
//   GH_DISPATCH_TOKEN   GitHub の fine-grained token（このリポジトリだけ・Contents: Read and write）
//   IG_TOKEN / IG_USER_ID（任意）2)・3) を使う時だけ。GitHub の Secrets と同じ値
// Bindings（任意）
//   TOWN_KV             KV。あると、続けて来たコメントで何度も頼まない（DEBOUNCE_SECONDS 秒に 1 回）。2)・3) には必須
// Variables（任意・ふつうは入れなくてよい）
//   GITHUB_REPO         既定 "hajimarijima/hajimarijima.github.io"
//   SITE_ORIGIN         /stats を読めるサイト。既定 "https://hajimarijima.github.io"
//   DEBOUNCE_SECONDS    既定 30
//   POLL_POSTS          2) で見る最近の投稿の数。既定 10
//   POLL_COMMENTS       "off" にすると 2) でコメントの数は見ない（フォロワー数だけ）

const DEFAULT_REPO = 'hajimarijima/hajimarijima.github.io';
const DEFAULT_SITE = 'https://hajimarijima.github.io';
const STATS_REWRITE = 30 * 60e3; // フォロワー数が同じでも、30 分に 1 回は時刻を書き直す（KV の書きこみは 1 日 1000 回まで）
const enc = new TextEncoder();

// ---------- 署名 ----------
async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a, b) { // 時間で中身がばれない比べ方
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function verifySignature(header, body, secrets) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || '').trim());
  if (!m) return false;
  const want = m[1].toLowerCase();
  for (const s of secrets.filter(Boolean)) if (sameText(await hmacHex(s, body), want)) return true;
  return false;
}

// ---------- 中身：コメントがついた投稿の ID だけ取り出す ----------
// インスタのログイン： entry[].field / entry[].value。Facebook のログイン： entry[].changes[].field / value
export function commentMedia(payload) {
  const out = new Set();
  const list = Array.isArray(payload) ? payload : [payload];
  for (const p of list) {
    if (!p || p.object !== 'instagram') continue;
    for (const e of p.entry || []) {
      const ch = Array.isArray(e.changes) ? e.changes : e.field ? [{ field: e.field, value: e.value }] : [];
      for (const c of ch) {
        if (c.field !== 'comments' && c.field !== 'live_comments') continue;
        const id = c.value && c.value.media && String(c.value.media.id || '');
        out.add(/^\d{1,30}$/.test(id) ? id : '');
      }
    }
  }
  return [...out];
}

// ---------- GitHub に頼む ----------
async function dispatch(env, media, why) {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'town-webhook',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'ig-comment', client_payload: { media: media.filter(Boolean).slice(0, 20).join(','), why } }),
  });
  if (r.status !== 204) console.log('GitHub に頼めませんでした', r.status, (await r.text()).slice(0, 200));
  else console.log('join を動かしました', why);
}

// 続けて来たら、DEBOUNCE_SECONDS 秒に 1 回だけ頼む（KV がない時は毎回頼む。Actions の順番待ちが 1 つにまとめる）
async function dispatchSoon(env, media, why) {
  const kv = env.TOWN_KV;
  const wait = Math.max(0, Number(env.DEBOUNCE_SECONDS || 30)) * 1000;
  if (kv && wait) {
    try {
      const last = Number(await kv.get('lastDispatch')) || 0;
      if (Date.now() - last < wait) { console.log('さっき頼んだばかりなので待つ'); return; }
      await kv.put('lastDispatch', String(Date.now()), { expirationTtl: 3600 });
    } catch (e) { console.log('KV を使えませんでした（そのまま頼む）'); }
  }
  await dispatch(env, media, why);
}

// ---------- 2) 2 分ごとに、コメントの数だけ見る（Webhook が届かない時の代わり） ----------
// インスタを読む：フォロワー数と（要る時）最近の投稿のコメントの数。できれば 1 回で（だめなら分けて読む）
async function readInsta(env, withMedia) {
  const api = /^IG/.test(env.IG_TOKEN) ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';
  const id = encodeURIComponent(env.IG_USER_ID), tok = encodeURIComponent(env.IG_TOKEN);
  const n = Math.min(50, Math.max(1, Number(env.POLL_POSTS || 10)));
  const toMap = (list) => { const o = {}; for (const m of list || []) o[String(m.id)] = Number(m.comments_count) || 0; return o; };
  if (withMedia) {
    const r = await fetch(`${api}/${id}?fields=followers_count,media.limit(${n}){id,comments_count}&access_token=${tok}`);
    if (r.ok) { const j = await r.json(); return { followers: j.followers_count, media: toMap(j.media && j.media.data) }; }
  }
  const r = await fetch(`${api}/${id}?fields=followers_count&access_token=${tok}`);
  if (!r.ok) { console.log('インスタを読めませんでした', r.status); return null; }
  const out = { followers: (await r.json()).followers_count, media: null };
  if (withMedia) {
    const m = await fetch(`${api}/${id}/media?fields=id,comments_count&limit=${n}&access_token=${tok}`);
    if (m.ok) out.media = toMap((await m.json()).data);
  }
  return out;
}

async function poll(env, nowMs = Date.now()) {
  if (!env.IG_TOKEN || !env.IG_USER_ID || !env.TOWN_KV) return;
  const withMedia = !!env.GH_DISPATCH_TOKEN && env.POLL_COMMENTS !== 'off';
  const got = await readInsta(env, withMedia);
  if (!got) return;
  // フォロワー数（変わった時か、30 分たった時だけ KV に書く）
  if (typeof got.followers === 'number') {
    let st = null;
    try { st = JSON.parse((await env.TOWN_KV.get('stats')) || 'null'); } catch (e) { st = null; }
    if (!st || st.followers !== got.followers || !(nowMs - Date.parse(st.at || 0) < STATS_REWRITE)) {
      await env.TOWN_KV.put('stats', JSON.stringify({ followers: got.followers, at: new Date(nowMs).toISOString() }));
    }
  }
  if (!withMedia || !got.media) return;
  const now = got.media;
  let before = null;
  try { before = JSON.parse((await env.TOWN_KV.get('counts')) || 'null'); } catch (e) { before = null; }
  const changed = before ? Object.keys(now).filter((id) => before[id] !== undefined ? before[id] !== now[id] : now[id] > 0) : [];
  if (JSON.stringify(before) !== JSON.stringify(now)) await env.TOWN_KV.put('counts', JSON.stringify(now));
  if (changed.length) await dispatchSoon(env, changed, 'poll');
}

// ---------- 3) GET /stats：サイトがフォロワー数を読む ----------
async function stats(env) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': env.SITE_ORIGIN || DEFAULT_SITE, // このサイトのページからだけ読める
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=60',
  };
  let st = null;
  try { st = env.TOWN_KV ? JSON.parse((await env.TOWN_KV.get('stats')) || 'null') : null; } catch (e) { st = null; }
  if (!st || typeof st.followers !== 'number') return new Response('{}', { status: 404, headers });
  return new Response(JSON.stringify({ followers: st.followers, at: st.at }), { status: 200, headers });
}

export { poll, stats };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Meta の確かめ（Webhook を登録した時に 1 回来る）
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && env.META_VERIFY_TOKEN && sameText(token || '', env.META_VERIFY_TOKEN)) return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      if (!mode && url.pathname === '/stats') return stats(env);
      if (!mode) return new Response('はじまり島の受け口です（動いています）', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return new Response('forbidden', { status: 403 });
    }
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = await request.arrayBuffer();
    if (body.byteLength > 1024 * 1024) return new Response('too large', { status: 413 });
    if (!(await verifySignature(request.headers.get('X-Hub-Signature-256'), body, [env.META_APP_SECRET, env.IG_APP_SECRET]))) {
      console.log('署名が合いません（META_APP_SECRET / IG_APP_SECRET を確かめる）');
      return new Response('bad signature', { status: 401 });
    }
    let payload = null;
    try { payload = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return new Response('ok', { status: 200 }); }
    const media = commentMedia(payload);
    // すぐ 200 を返す（Meta は遅いと送り直す）。GitHub に頼むのはそのあと
    if (media.length && env.GH_DISPATCH_TOKEN) ctx.waitUntil(dispatchSoon(env, media, 'webhook'));
    return new Response('ok', { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env).catch((e) => console.log('poll', String(e && e.message || e).slice(0, 200))));
  },
};
