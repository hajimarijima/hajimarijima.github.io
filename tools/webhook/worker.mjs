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
//
// 4) DM で入居（サイトの data/config.json の dm.enabled が true の時だけ。docs/DMで入居する手順.md）
//   ・Meta の messages の Webhook：入居の言葉（dm.words）が書いてある DM だけ、User Profile API で username と
//     is_user_follow_business を引いて KV（TOWN_KV）に積み（23 時間で消える）、GitHub に ig-dm を頼む（中身は送らない）
//   ・GET /dm/queue（Authorization: Bearer DM_QUEUE_TOKEN）：積んである DM を join.yml（tools/dm.js pull）に渡す
//   ・POST /dm/done（同じ合言葉）：join.yml が作った返事を Send API で送り、KV から消す
//   Secrets：DM_QUEUE_TOKEN（自分で決めた長い合言葉。GitHub の Secrets にも同じ値）・IG_TOKEN（instagram_business_manage_messages の入ったもの）
//   Variables（任意）：DM_SEND_ID（送る時の /{id}/messages。既定 "me"）・DM_CONFIG_URL（既定 SITE_ORIGIN + "/data/config.json"）

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
async function dispatch(env, media, why, type = 'ig-comment') {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const client_payload = type === 'ig-comment' ? { media: media.filter(Boolean).slice(0, 20).join(','), why } : { why }; // DM は中身を送らない（KV から読む）
  const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'town-webhook',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: type, client_payload }),
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

// ---------- 4) DM で入居 ----------
const DM_TTL = 23 * 3600; // KV に置く長さ（秒）。Meta の 24 時間ルール（相手が送ってから 24 時間だけ返事できる）より少し短く
const DM_WORDS = ['住みたい', 'すみたい', '入居', '入村'];
const DM_MAX_TEXT = 500;
const nfkc = (s) => String(s || '').normalize('NFKC').trim();
const igApi = (env) => (/^IG/.test(env.IG_TOKEN || '') ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0');
async function sha256Hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }

// DM の Webhook から、人が送ってきた文の DM だけ取り出す（自分が送った物・消された物・文のない物は見ない）
//   entry[].messaging[]（ふつうの形）と entry[].changes[] の field "messages"（Meta の画面の「テスト送信」の形）の両方を読む
export function dmMessages(payload) {
  const out = [];
  for (const p of Array.isArray(payload) ? payload : [payload]) {
    if (!p || p.object !== 'instagram') continue;
    for (const e of p.entry || []) {
      const own = String(e.id || '');
      const list = [...(Array.isArray(e.messaging) ? e.messaging : []), ...(Array.isArray(e.changes) ? e.changes : []).filter((c) => c && c.field === 'messages' && c.value).map((c) => c.value)];
      for (const m of list) {
        const sid = String((m && m.sender && m.sender.id) || ''), msg = m && m.message;
        if (!/^\d{1,30}$/.test(sid) || sid === own || !msg || msg.is_echo || msg.is_deleted || msg.is_unsupported) continue;
        if (typeof msg.text !== 'string' || !msg.text.trim() || !msg.mid) continue;
        const ts = Number(m.timestamp);
        out.push({ mid: String(msg.mid).slice(0, 300), igsid: sid, text: msg.text.slice(0, DM_MAX_TEXT), at: new Date(ts > 0 ? ts : Date.now()).toISOString() });
      }
    }
  }
  return out;
}
export const dmWordHit = (text, words) => { const t = nfkc(text); return (words && words.length ? words : DM_WORDS).some((w) => nfkc(w) && t.includes(nfkc(w))); };

// サイトの data/config.json の dm（enabled・words）。5 分おぼえておく。読めない時は「積んでおく」（入居するかは join.js が config で決め直す）
let dmCfg = { at: 0, v: null };
export function _resetDmConfig() { dmCfg = { at: 0, v: null }; }
async function dmConfig(env, nowMs = Date.now()) {
  if (dmCfg.v && nowMs - dmCfg.at < 5 * 60e3) return dmCfg.v;
  const url = env.DM_CONFIG_URL || (env.SITE_ORIGIN || DEFAULT_SITE).replace(/\/+$/, '') + '/data/config.json';
  try {
    const r = await fetch(url, { cf: { cacheTtl: 300 } });
    if (r.ok) {
      const d = ((await r.json()) || {}).dm || {};
      dmCfg = { at: nowMs, v: { enabled: d.enabled === true, words: Array.isArray(d.words) && d.words.length ? d.words.map(String) : DM_WORDS } };
      return dmCfg.v;
    }
    console.log('DM：config を読めませんでした', r.status);
  } catch (e) { console.log('DM：config を読めませんでした'); }
  return dmCfg.v || { enabled: true, words: DM_WORDS };
}

// 送り主の username と、町のアカウントをフォローしているか（User Profile API）。読めない時は null
async function igProfile(env, igsid) {
  try {
    const r = await fetch(`${igApi(env)}/${encodeURIComponent(igsid)}?fields=username,name,is_user_follow_business`, { headers: { Authorization: `Bearer ${env.IG_TOKEN}` } });
    if (!r.ok) { console.log('DM：送り主のプロフィールを読めませんでした', r.status); return null; }
    return await r.json();
  } catch (e) { console.log('DM：送り主のプロフィールを読めませんでした'); return null; }
}

// Send API で DM を返す（相手が送ってから 24 時間の中だけ）
async function sendDm(env, igsid, text) {
  const r = await fetch(`${igApi(env)}/${encodeURIComponent(env.DM_SEND_ID || 'me')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.IG_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text: String(text).slice(0, 1000) } }),
  });
  if (!r.ok) console.log('DM：返事を送れませんでした', r.status);
  return r.ok;
}

// Webhook で来た DM を KV に積み、join を動かす。積んだ数を返す
async function handleDm(env, msgs) {
  const kv = env.TOWN_KV;
  if (!kv || !env.IG_TOKEN) { console.log('DM：TOWN_KV か IG_TOKEN がないので受けられません'); return 0; }
  const cfg = await dmConfig(env);
  if (!cfg.enabled) return 0;
  let queued = 0;
  for (const m of msgs) {
    if (!dmWordHit(m.text, cfg.words)) continue; // ふつうの話の DM は積まない
    const key = 'dmq:' + (await sha256Hex(m.mid)).slice(0, 32);
    if (await kv.get(key)) continue; // Meta の送り直し
    const prof = await igProfile(env, m.igsid);
    const item = {
      igsid: m.igsid,
      username: prof && typeof prof.username === 'string' ? prof.username.slice(0, 60) : null,
      follows: prof && typeof prof.is_user_follow_business === 'boolean' ? prof.is_user_follow_business : null,
      text: m.text, at: m.at,
    };
    await kv.put(key, JSON.stringify(item), { expirationTtl: DM_TTL });
    queued++;
  }
  if (queued) console.log('DM：積みました', queued);
  if (queued && env.GH_DISPATCH_TOKEN) await dispatch(env, [], 'dm', 'ig-dm'); // 間をあけずに頼む（積んであるので、まとめて読まれても困らない）
  return queued;
}

const dmAuth = (request, env) => {
  const tok = String(env.DM_QUEUE_TOKEN || '');
  return tok.length >= 16 && sameText(String(request.headers.get('Authorization') || ''), 'Bearer ' + tok);
};
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// GET /dm/queue：積んである DM（100 件まで）
async function dmQueue(request, env) {
  if (!dmAuth(request, env)) return jsonRes({ error: 'forbidden' }, 403);
  const kv = env.TOWN_KV;
  if (!kv) return jsonRes({ items: [] });
  const list = await kv.list({ prefix: 'dmq:', limit: 100 });
  const items = [];
  for (const k of list.keys || []) {
    let v = null;
    try { v = JSON.parse((await kv.get(k.name)) || 'null'); } catch (e) { v = null; }
    if (v && v.igsid) items.push({ id: k.name.slice(4), igsid: v.igsid, username: v.username || null, follows: typeof v.follows === 'boolean' ? v.follows : null, text: v.text || '', at: v.at || null });
  }
  return jsonRes({ items });
}

// POST /dm/done：{ items: [{ ids: [...], text }] }。ids の DM の送り主に text を送り（text が null なら送らない）、KV から消す
async function dmDone(request, env, nowMs = Date.now()) {
  if (!dmAuth(request, env)) return jsonRes({ error: 'forbidden' }, 403);
  const kv = env.TOWN_KV;
  if (!kv) return jsonRes({ sent: 0, removed: 0 });
  let body = null;
  try { body = await request.json(); } catch (e) { return jsonRes({ error: 'bad json' }, 400); }
  let sent = 0, removed = 0;
  for (const it of ((body && body.items) || []).slice(0, 100)) {
    const ids = (Array.isArray(it.ids) ? it.ids : []).map(String).filter((s) => /^[0-9a-f]{32}$/.test(s)).slice(0, 20);
    let to = null;
    for (const id of ids) {
      let v = null;
      try { v = JSON.parse((await kv.get('dmq:' + id)) || 'null'); } catch (e) { v = null; }
      if (v && v.igsid && !to) to = v;
      if (v) { await kv.delete('dmq:' + id); removed++; }
    }
    if (!to || typeof it.text !== 'string' || !it.text.trim()) continue;
    if (to.at && nowMs - Date.parse(to.at) > 24 * 3600e3) { console.log('DM：24 時間を過ぎたので返事しません'); continue; }
    if (await sendDm(env, to.igsid, it.text)) sent++;
  }
  return jsonRes({ sent, removed });
}

export { poll, stats, handleDm, dmQueue, dmDone };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Meta の確かめ（Webhook を登録した時に 1 回来る）
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && env.META_VERIFY_TOKEN && sameText(token || '', env.META_VERIFY_TOKEN)) return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      if (!mode && url.pathname === '/stats') return stats(env);
      if (!mode && url.pathname === '/dm/queue') return dmQueue(request, env);
      if (!mode) return new Response('はじまり島の受け口です（動いています）', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return new Response('forbidden', { status: 403 });
    }
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    if (url.pathname === '/dm/done') return dmDone(request, env); // join.yml から（合言葉で確かめる）
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
    const dms = dmMessages(payload); // DM（messages）。積むのはサイトの config の dm.enabled が true の時だけ
    if (dms.length) ctx.waitUntil(handleDm(env, dms).catch((e) => console.log('DM', String(e && e.message || e).slice(0, 200))));
    return new Response('ok', { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env).catch((e) => console.log('poll', String(e && e.message || e).slice(0, 200))));
  },
};
