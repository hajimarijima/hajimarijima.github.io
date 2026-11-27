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
//
// 5) 自分の村人（DM の返事に入れる専用のリンク ?me=印）と、遊びのページ（play.html）の記録。下の「5)」と docs/遊びとログインの手順.md
//   Bindings：TOWN_KV（必須）。Variables（任意）：ME_LINKS（"off" で専用のリンクを入れない）
//
// 6) 手紙と家の飾り（5) と同じ印で。1 日に送れる手紙の数はここで数える）。下の「6)」
// 7) 誰かの家に遊びに行く（5) と同じ印で。1 日に行ける回数はここで数える）。下の「7)」
// 8) 工房（チェストへ送る・道具を作る・交換所・宝箱。5) と同じ印で。確かめと抽選はここ、持ち物を動かすのは毎日の更新）。下の「8)」

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
// 住んでいる人がプロフィールを書き直す DM（「性別 女の子」「ひとこと よろしく」「趣味 釣り」「色 水色」「誕生日 12/11」「MBTI ENFP」「好きな食べ物 りんご」）。
// 名札で始まる DM だけ（どの村人かは join.js の tools/dm.js が決める。住んでいない人の DM は消すだけ）
const DM_PROFILE_RE = /^\s*(性別|せいべつ|ひとこと|一言|自己紹介|趣味|しゅみ|好きな色|すきな色|色|いろ|カラー|誕生日|たんじょうび|mbti|好きな食べ物|好物)/i;
export const dmProfileHit = (text) => DM_PROFILE_RE.test(nfkc(text));
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
    if (!dmWordHit(m.text, cfg.words) && !dmProfileHit(m.text)) continue; // ふつうの話の DM は積まない（住んでいる人のプロフィールの書き直しは積む）
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

// POST /dm/done：{ items: [{ ids: [...], text, villager? }] }。ids の DM の送り主に text を送り（text が null なら送らない）、KV から消す。
//   villager（村人の key）があれば、その人専用のリンクの印（?me=）を作って文に入れる（5) を参照。前の印は使えなくなる）
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
    if (await sendDm(env, to.igsid, await replyText(env, it, nowMs))) sent++;
  }
  return jsonRes({ sent, removed });
}

// ---------- 5) 自分の村人（DM で届く専用のリンク ?me=印）と遊びの記録 ----------
// 印は推測できない 32 字。KV には印のハッシュだけを置く（me:<ハッシュ> → { v: 村人, at }）。村人ごとに今の印は 1 つ（mev:<村人> → ハッシュ）。
// もう一度 DM すると新しい印を作り、前の印は消す（別の端末でつなぎ直す時）。公開リポジトリ・GitHub には印を渡さない。
// サイトは印を Authorization: Bearer <印> で送る：
//   GET  /me                 … { villager, date, day: { fish, chores, treasure }, settings: { oreMode }, choreTotal, treasure: { villager } | null, limits }
//   POST /me/settings        … { oreMode: 'self' | 'storage', birthday: 'MM-DD' }（鉱石：自分で持つ／倉庫に入れる・誕生日。片方だけでもよい）
//   POST /play/fish          … { item, cm } 釣れた・{ miss: true } 逃げた。1 日 fishPerDay 回まで（Worker が数える）。魚と大きさは config.fishing の範囲か確かめる
//   POST /play/chore         … { kind: 'tree' | 'rock' | 'bush' | 'field' } 1 日 chorePerDay 回まで。みんなの合計（chore:<日付>）に 1 足す
//   POST /play/treasure      … その日の宝箱。まだだれも見つけていなければ、いちばん乗りとして記録（trs:<日付>）
// join.yml・sim 側が読む口（合言葉 DM_QUEUE_TOKEN）：
//   GET  /play/pull?days=3   … { settings: { 村人: {oreMode} }, days: { 日付: { 村人: {fish, chores, treasure, catches} } }, chores: { 日付: {...} }, treasure: { 日付: {villager, at} } }
// KV の書きこみ（無料は 1 日 1000 回）：遊び 1 回で 1〜2 回。1 日の記録は 8 日、宝の記録は 40 日で消える
const ME_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PLAY_DEF = { fishPerDay: 5, chorePerDay: 5, choreGoal: 300 };
const DAY_TTL = 8 * 86400, TRS_TTL = 40 * 86400;
const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(k);
const validMe = (t) => typeof t === 'string' && /^[A-Za-z0-9]{32}$/.test(t);
// 誕生日 'MM-DD'（ありえない日は受け取らない。2/29 はよい）
const BD_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const validBirthday = (s) => { const m = typeof s === 'string' && /^(\d{2})-(\d{2})$/.exec(s); return !!m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= BD_DAYS[+m[1] - 1]; };
export const jstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
export function newMeToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => ME_CHARS[b % ME_CHARS.length]).join(''); }
const siteOf = (env) => (env.SITE_ORIGIN || DEFAULT_SITE).replace(/\/+$/, '');
// 専用のリンク。?v=村人 も付けて、開くとその人の家にカメラが寄ってカードが開く（js/town.js の ?v=）。印は js/mine.js が覚えて URL から消す
const meUrl = (env, tok, villager) => siteOf(env) + '/?' + (validKey(villager) ? 'v=' + encodeURIComponent(villager) + '&' : '') + 'me=' + tok;
// 返事の文に専用のリンクを入れる（{me} があればそこ（2 つ目からは消す）、なければ最後の行に足す）
export function meText(text, url) {
  const s = String(text || '');
  if (!s.includes('{me}')) return `${s}\nあなた専用のリンク（開いた端末で、自分の村人として遊べます。人に教えないでね）→ ${url}`;
  const [a, ...b] = s.split('{me}');
  return a + url + b.join('');
}
// 専用のリンクを作れない時（ME_LINKS が off・KV の失敗）の家のリンク。tools/dm.js が送る house（https の URL）か、村人の ?v=
const okHouse = (u) => typeof u === 'string' && u.length <= 300 && /^https:\/\/[^\s{}<>"]+$/.test(u);
export function houseLink(env, it) {
  if (okHouse(it && it.house)) return it.house;
  return validKey(it && it.villager) ? siteOf(env) + '/?v=' + encodeURIComponent(it.villager) : '';
}
// 送る文：リンクは必ず 1 つ。専用のリンクが作れればそれ、作れなければ家のリンク（{me} は文に残さない）
export async function replyText(env, it, nowMs = Date.now()) {
  const text = String(it.text);
  let url = '';
  if (validKey(it.villager) && env.ME_LINKS !== 'off') {
    try { url = meUrl(env, await issueMe(env, it.villager, nowMs), it.villager); } catch (e) { console.log('DM：専用のリンクを作れませんでした（家のリンクにします）'); }
  }
  if (url) return meText(text, url);
  if (!text.includes('{me}')) return text;
  const [a, ...b] = text.split('{me}');
  return a + houseLink(env, it) + b.join('');
}
// 村人に新しい印を作る（前の印は消す）
export async function issueMe(env, villager, nowMs = Date.now()) {
  const kv = env.TOWN_KV, tok = newMeToken(), h = await sha256Hex(tok);
  const old = await kv.get('mev:' + villager);
  if (old) await kv.delete('me:' + old);
  await kv.put('me:' + h, JSON.stringify({ v: villager, at: new Date(nowMs).toISOString() }));
  await kv.put('mev:' + villager, h);
  return tok;
}
async function whoIs(request, env) {
  const m = /^Bearer\s+(\S+)$/.exec(String(request.headers.get('Authorization') || ''));
  if (!m || !validMe(m[1]) || !env.TOWN_KV) return null;
  let d = null;
  try { d = JSON.parse((await env.TOWN_KV.get('me:' + (await sha256Hex(m[1])))) || 'null'); } catch (e) { d = null; }
  return d && validKey(d.v) ? d.v : null;
}
// サイトの config（遊びの回数・釣りの決まり）。5 分おぼえておく
let siteCfg = { at: 0, v: null };
export function _resetSiteConfig() { siteCfg = { at: 0, v: null }; }
async function siteConfig(env, nowMs = Date.now()) {
  if (siteCfg.v && nowMs - siteCfg.at < 5 * 60e3) return siteCfg.v;
  const url = env.DM_CONFIG_URL || (env.SITE_ORIGIN || DEFAULT_SITE).replace(/\/+$/, '') + '/data/config.json';
  try { const r = await fetch(url, { cf: { cacheTtl: 300 } }); if (r.ok) { siteCfg = { at: nowMs, v: (await r.json()) || {} }; return siteCfg.v; } } catch (e) { /* 下へ */ }
  return siteCfg.v || {};
}
const limitsOf = (cfg) => ({ ...PLAY_DEF, ...((cfg && cfg.play) || {}) });
// 釣れた物が config.fishing の決まりの中か（種類は海・夜の海・夜・宝・ごみのどれか、大きさは min〜bigMax）
export function fishOk(cfg, item, cm) {
  const FC = (cfg && cfg.fishing) || {}, H = (cfg && cfg.hours) || {};
  const lists = [FC.seaFish, FC.seaNightFish, H.nightFish, FC.fish, FC.treasure && FC.treasure.items, FC.junk && FC.junk.items].filter(Array.isArray);
  if (typeof item !== 'string' || !lists.some((l) => l.some(([k]) => k === item))) return false;
  if (!item.startsWith('fish_')) return cm == null || cm === 0;
  const sz = FC.sizes && FC.sizes[item];
  return !!sz && typeof cm === 'number' && cm >= sz.min && cm <= Math.max(sz.max, sz.bigMax || 0);
}
const CHORE_FIELD = { tree: 'wood', rock: 'stone', bush: 'berry', field: 'water' }; // field＝畑に水やり
const readJ = async (kv, k, d) => { try { return JSON.parse((await kv.get(k)) || 'null') || d; } catch (e) { return d; } };
const cors = (env, res) => {
  res.headers.set('Access-Control-Allow-Origin', env.SITE_ORIGIN || DEFAULT_SITE);
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Vary', 'Origin');
  return res;
};
export async function playApi(request, env, nowMs = Date.now()) {
  const url = new URL(request.url), path = url.pathname, kv = env.TOWN_KV;
  if (!kv) return jsonRes({ error: 'no kv' }, 503);
  if (path === '/play/pull') {
    if (!dmAuth(request, env)) return jsonRes({ error: 'forbidden' }, 403);
    const n = Math.min(8, Math.max(1, Number(url.searchParams.get('days')) || 3));
    const dates = Array.from({ length: n }, (_, i) => jstDate(nowMs - i * 86400e3));
    const out = { settings: {}, days: {}, chores: {}, treasure: {} };
    const each = async (prefix, fn) => { let cur; do { const l = await kv.list({ prefix, cursor: cur }); for (const k of l.keys || []) await fn(k.name); cur = l.list_complete ? null : l.cursor; } while (cur); };
    await each('set:', async (k) => { out.settings[k.slice(4)] = await readJ(kv, k, {}); });
    for (const d of dates) {
      out.days[d] = {};
      await each(`pd:${d}:`, async (k) => { out.days[d][k.slice(4 + d.length)] = await readJ(kv, k, {}); });
      const c = await readJ(kv, 'chore:' + d, null); if (c) out.chores[d] = c;
      const t = await readJ(kv, 'trs:' + d, null); if (t) out.treasure[d] = t;
    }
    await pullHome(kv, dates, out, each); // 手紙と家の飾り（6)）
    await pullVisits(kv, dates, out, each); // 遊びに行く（7)）
    await pullShop(kv, dates, out, each); // 工房（8)）
    return jsonRes(out);
  }
  const v = await whoIs(request, env);
  if (!v) return cors(env, jsonRes({ error: 'unknown link' }, 401));
  const date = jstDate(nowMs), cfg = await siteConfig(env, nowMs), L = limitsOf(cfg);
  const dk = `pd:${date}:${v}`;
  const day = await readJ(kv, dk, { fish: 0, chores: 0, treasure: false, catches: [] });
  let body = {};
  if (request.method === 'POST') { try { body = (await request.json()) || {}; } catch (e) { return cors(env, jsonRes({ error: 'bad json' }, 400)); } }
  const res = (o, s = 200) => cors(env, jsonRes(o, s));
  if (path.startsWith('/shop/') || path.startsWith('/box/')) return shopApi(path, request, body, { kv, v, date, cfg, nowMs, res, env }); // 工房（8)）
  if (path.startsWith('/visit/')) return visitApi(path, request, body, { kv, v, date, cfg, nowMs, res }); // 遊びに行く（7)）
  if (path.startsWith('/mail/') || path === '/me/decor') return homeApi(path, request, body, { kv, v, date, cfg, nowMs, res }); // 手紙と家の飾り（6)）
  if (path === '/me' && request.method === 'GET') {
    return res({ villager: v, date, day: { fish: day.fish, chores: day.chores, treasure: !!day.treasure, box: day.box || 0, legend: day.legend || [] }, catches: day.catches || [], settings: await readJ(kv, 'set:' + v, {}), choreTotal: (await readJ(kv, 'chore:' + date, {})).total || 0, treasure: await readJ(kv, 'trs:' + date, null), limits: L });
  }
  if (request.method !== 'POST') return res({ error: 'method' }, 405);
  if (path === '/me/settings') {
    // 鉱石の持ち方（oreMode）と誕生日（birthday 'MM-DD'）。片方だけでもよい。送った項目が変な値なら 400
    const hasOre = 'oreMode' in body, hasBd = 'birthday' in body;
    if (!hasOre && !hasBd) return res({ error: 'nothing to save' }, 400);
    if (hasOre && !['self', 'storage'].includes(body.oreMode)) return res({ error: 'bad oreMode' }, 400);
    if (hasBd && !validBirthday(body.birthday)) return res({ error: 'bad birthday' }, 400);
    const nowIso = new Date(nowMs).toISOString();
    const s = { ...(await readJ(kv, 'set:' + v, {})), at: nowIso };
    if (hasOre) { s.oreMode = body.oreMode; s.oreAt = nowIso; }
    if (hasBd) { s.birthday = body.birthday; s.birthdayAt = nowIso; }
    await kv.put('set:' + v, JSON.stringify(s));
    return res({ settings: s });
  }
  if (path === '/play/fish') {
    if (day.fish >= L.fishPerDay) return res({ error: 'limit', day }, 429);
    const miss = body.miss === true;
    if (!miss && !fishOk(cfg, body.item, body.cm)) return res({ error: 'bad catch' }, 400);
    day.fish++;
    let legend = null;
    if (!miss) {
      (day.catches = day.catches || []).push([body.item, body.cm ?? 0]);
      legend = rollLegend(cfg, 'fish', wsRnd(env)); // 激レア（ここで決める。画面は決めない）
      if (legend) (day.legend = day.legend || []).push(legend);
    }
    await kv.put(dk, JSON.stringify(day), { expirationTtl: DAY_TTL });
    if (!miss) await wsGain(kv, date, v, [[body.item, 1], ...(legend ? [[legend, 1]] : [])], 'fish', nowMs); // 持ち物へ（工房 8)）
    return res({ day: { fish: day.fish, chores: day.chores, treasure: !!day.treasure }, catches: day.catches || [], legend });
  }
  if (path === '/play/chore') {
    const f = CHORE_FIELD[body.kind];
    if (!f) return res({ error: 'bad kind' }, 400);
    if (day.chores >= L.chorePerDay) return res({ error: 'limit', day }, 429);
    day.chores++;
    const box = day.chores === L.chorePerDay ? 1 : 0; // 1 日の回数をぜんぶした日は宝箱 1 つ
    if (box) day.box = (day.box || 0) + 1;
    await kv.put(dk, JSON.stringify(day), { expirationTtl: DAY_TTL });
    if (box) await wsGain(kv, date, v, [['treasure_box', 1]], 'chore', nowMs);
    const c = await readJ(kv, 'chore:' + date, { wood: 0, stone: 0, berry: 0, water: 0, total: 0 });
    c[f] = (c[f] || 0) + 1; c.total = (c.total || 0) + 1; // 同じ時に押した人がいると 1 つ数えもれることがある（KV は足し算を守らない）
    await kv.put('chore:' + date, JSON.stringify(c), { expirationTtl: DAY_TTL });
    return res({ day: { fish: day.fish, chores: day.chores, treasure: !!day.treasure }, choreTotal: c.total, box });
  }
  if (path === '/play/treasure') {
    let t = await readJ(kv, 'trs:' + date, null), first = false;
    if (!t) { t = { villager: v, at: new Date(nowMs).toISOString() }; await kv.put('trs:' + date, JSON.stringify(t), { expirationTtl: TRS_TTL }); first = true; }
    let got = null, tier = null, legend = null;
    if (!day.treasure) { // 掘った人は（いちばんでなくても）その場で宝箱を開ける。中身（宝箱の段の抽選）とまれな激レアはここで決め、持ち物には中身が入る
      day.treasure = true;
      legend = rollLegend(cfg, 'treasure', wsRnd(env));
      if (legend) (day.legend = day.legend || []).push(legend);
      const g = rollBox(cfg, wsRnd(env)); got = [g.item, g.n]; tier = g.tier;
      await kv.put(dk, JSON.stringify(day), { expirationTtl: DAY_TTL });
      await wsGain(kv, date, v, [got, ...(legend ? [[legend, 1]] : [])], 'treasure', nowMs);
    }
    return res({ first, treasure: t, day: { fish: day.fish, chores: day.chores, treasure: true }, box: 0, got, tier, legend });
  }
  return res({ error: 'not found' }, 404);
}

// ---------- 6) 手紙と家の飾り（mail.html・home.html。決まりは js/letters.js・js/decor.js と同じ。毎日の更新の側は tools/mail.js・tools/decor.js） ----------
// サイトは 5) と同じ印（Authorization: Bearer <印>）で送る：
//   GET  /mail/state         … { mail: { sent: [きょう送った手紙], left, perDay, maxLen }, decor: 置いた並べ方 | null }
//   POST /mail/send          … { to: 村人, text, gift?: 持ち物 } 1 日 mail.perDay 通まで（ここで数える）。禁止語・長さ・URL は 400
//   POST /me/decor           … { out: [[飾り, i, j, 向き]], in: [...] } 形だけ確かめる（持っている数・家のマスは毎日の更新が確かめる）。1 日 20 回まで
// /play/pull の答えに mail: { 日付: { 村人: [手紙] } } と decor: { 村人: { out, in, at } } を足す
// KV：ml:<日付>:<村人>（その日に送った手紙。8 日で消える）・dc:<村人>（並べ方。ずっと）
// 禁止語は js/letters.js の NG_WORDS・NG_OK と同じ（テストで同じか確かめる）。このファイルだけで置けるように、ここにも持つ
export const MAIL_DEF = { perDay: 3, maxLen: 80 };
// 手紙のきまりの版（js/terms.js の TERMS_VERSION と同じ。変えたら両方上げる）と、1 人が 1 日にできる通報の数
//   POST /mail/agree { version } … 同意を tm:<村人> に { version, at } で残す。/mail/send は同意した人だけ（403 terms）
//   POST /mail/report { id }     … rp:<手紙> に通報した村人を足す。pull の答えに terms: { 村人: { version, at } }・reports: { 手紙: 数 }
export const TERMS_VER = 2;
const REPORT_PER_DAY = 10;
export const NG_WORDS = ['しね', '死ね', 'しんでしまえ', 'ころす', '殺す', 'ころして', 'きえろ', '消えろ', 'きもい', 'きしょい', 'うざい', 'うぜえ', 'ぶす', 'でぶ', 'ぶさいく', 'くず', 'ごみくず', 'ばか', '馬鹿', 'あほ', 'まぬけ', 'だまれ', '黙れ', 'くたばれ', 'ざこ', '雑魚', 'いんきゃ', '陰キャ', 'きちがい', 'がいじ', 'ふぁっく', 'fuck', 'shit', 'bitch',
  // 出会い・連絡先の交換・お金や性的なさそい（はじまり島は出会いの場ではない）
  '会おう', '会える', '会いませんか', 'あいませんか', 'おふかい', 'オフ会', 'うらあか', '裏垢', '裏あか', 'line', 'らいん', 'かかお', 'kakao', 'でぃすこ', 'discord', 'telegram', 'てれぐら', '連絡先', 'れんらくさき', 'dmして', 'dmください', 'dmちょうだい', 'いんすたおしえ', 'いんすた教え', 'いんすた交換', '番号教え', 'ばんごうおしえ', 'ぱぱかつ', 'パパ活', 'ままかつ', 'えんこう', '援交', 'せっくす', 'えっち', 'おかねあげる', 'お金あげる', 'おかねちょうだい', 'お金ちょうだい', 'おかねおくって', 'お金送って'];
export const NG_OK = ['ばかり', 'ばかし', 'ばかでかい', 'くずもち', 'くずれ', 'くずし', 'くずゆ', 'ぶすっと', 'しねん', 'ざこね', 'あほうどり', 'でぶね', 'おんらいん', 'online', 'outline', 'deadline', 'lineup', 'すたとらいん', 'ごるらいん', 'かかおまめ', 'かかお豆', 'かかおます', 'かかおばた', 'かかお%', 'ちょこかかお'];
const foldText = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s　・.,、。!！?？~〜ー\-_*＊/／\\|｜'"`()（）「」『』【】[\]{}<>＜＞♪☆★♡♥]/g, '');
const GIFT_RE = /^(log|cobble|berry|apple|flower_r|flower_y|sapling|wheat|seeds|carrot|potato|egg|milk|wool|mushroom|pearl|old_coin|driftwood|bone|string|leather|coal|iron|gold|diamond|fish_[a-z]+)$/;
const DECOR_RE = /^(flowerbed|fence|flag|lantern|bench|barrel|planter|bed|desk|chair|shelf|lamp|plant|rug|picture)$/;
export function checkLetter(raw, cfg) {
  const M = { ...MAIL_DEF, ...((cfg && cfg.mail) || {}) };
  const text = String(raw == null ? '' : raw).normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ 　]{2,}/g, ' ').trim();
  if (!text) return { ok: false, error: 'empty', text };
  if (Array.from(text).length > M.maxLen) return { ok: false, error: 'long', text };
  if ((text.match(/\n/g) || []).length > 4) return { ok: false, error: 'lines', text };
  const n = text.normalize('NFKC');
  if (/(https?:|www\.|\.com\b|\.jp\b|\.net\b|line\.me|@[a-z0-9_.]{2,})/i.test(n) || /\d[\d-]{8,}\d/.test(n)) return { ok: false, error: 'url', text };
  let f = foldText(text);
  for (const w of NG_OK) f = f.split(w).join('');
  if ([...NG_WORDS, ...(Array.isArray(M.ngWords) ? M.ngWords : [])].some((w) => { const k = foldText(w); return k && f.includes(k); })) return { ok: false, error: 'ng', text };
  return { ok: true, text };
}
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => ME_CHARS[b % ME_CHARS.length]).join('');
const layoutOk = (list) => Array.isArray(list) && list.length <= 40 && list.every((e) => Array.isArray(e) && e.length === 4 && DECOR_RE.test(e[0]) && [1, 2].every((i) => Number.isInteger(e[i]) && e[i] >= 0 && e[i] <= 12) && Number.isInteger(e[3]) && e[3] >= 0 && e[3] <= 3);
async function homeApi(path, request, body, { kv, v, date, cfg, nowMs, res }) {
  const M = { ...MAIL_DEF, ...((cfg && cfg.mail) || {}) };
  const mk = `ml:${date}:${v}`;
  const terms = await readJ(kv, 'tm:' + v, null), agreed = !!(terms && terms.version >= TERMS_VER);
  if (path === '/mail/state' && request.method === 'GET') {
    const m = await readJ(kv, mk, { letters: [] });
    return res({ mail: { sent: m.letters, left: Math.max(0, M.perDay - m.letters.length), perDay: M.perDay, maxLen: M.maxLen }, decor: await readJ(kv, 'dc:' + v, null), terms: { version: TERMS_VER, agreed, at: terms ? terms.at : null } });
  }
  if (request.method !== 'POST') return res({ error: 'method' }, 405);
  if (path === '/mail/agree') {
    // 手紙のきまり（terms.html）に同意した：村人ごとに、版と日時を残す（ずっと）
    if (body.version !== TERMS_VER) return res({ error: 'version', version: TERMS_VER }, 400);
    const t = { version: TERMS_VER, at: new Date(nowMs).toISOString() };
    await kv.put('tm:' + v, JSON.stringify(t));
    return res({ terms: { ...t, agreed: true } });
  }
  if (path === '/mail/report') {
    // 手紙の通報：手紙ごとに通報した村人を残す（同じ人は 1 回）。1 日 REPORT_PER_DAY 回まで
    if (!(typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.id))) return res({ error: 'id' }, 400);
    const rk = 'rp:' + body.id, r = await readJ(kv, rk, { by: [], at: null });
    if (r.by.includes(v)) return res({ n: r.by.length, again: true });
    const dk = `rpd:${date}:${v}`, n = Number(await kv.get(dk)) || 0;
    if (n >= REPORT_PER_DAY) return res({ error: 'limit' }, 429);
    r.by.push(v); r.at = new Date(nowMs).toISOString();
    await kv.put(rk, JSON.stringify(r));
    await kv.put(dk, String(n + 1), { expirationTtl: DAY_TTL });
    return res({ n: r.by.length });
  }
  if (path === '/mail/send') {
    if (!agreed) return res({ error: 'terms', version: TERMS_VER }, 403); // きまりに同意していない（版が上がった時も）
    if (!validKey(body.to) || body.to === v) return res({ error: 'to' }, 400);
    if (body.gift != null && !(typeof body.gift === 'string' && (GIFT_RE.test(body.gift) || DECOR_RE.test(body.gift)))) return res({ error: 'gift' }, 400);
    const c = checkLetter(body.text, cfg);
    if (!c.ok) return res({ error: c.error }, 400);
    const m = await readJ(kv, mk, { letters: [] });
    if (m.letters.length >= M.perDay) return res({ error: 'limit', left: 0 }, 429);
    const L = { id: rid(), to: body.to, text: c.text, gift: body.gift || null, at: new Date(nowMs).toISOString() };
    m.letters.push(L);
    await kv.put(mk, JSON.stringify(m), { expirationTtl: DAY_TTL });
    return res({ letter: L, left: Math.max(0, M.perDay - m.letters.length) });
  }
  if (path === '/me/decor') {
    if (!layoutOk(body.out) || !layoutOk(body.in)) return res({ error: 'bad layout' }, 400);
    const old = await readJ(kv, 'dc:' + v, null);
    const n = old && old.date === date ? (old.n || 0) : 0;
    if (n >= 20) return res({ error: 'limit' }, 429);
    const d = { out: body.out, in: body.in, at: new Date(nowMs).toISOString(), date, n: n + 1 };
    await kv.put('dc:' + v, JSON.stringify(d));
    return res({ decor: d });
  }
  return res({ error: 'not found' }, 404);
}
async function pullHome(kv, dates, out, each) {
  out.mail = {}; out.decor = {};
  for (const d of dates) {
    out.mail[d] = {};
    await each(`ml:${d}:`, async (k) => { out.mail[d][k.slice(4 + d.length)] = (await readJ(kv, k, { letters: [] })).letters || []; });
  }
  await each('dc:', async (k) => { const x = await readJ(kv, k, null); if (x) out.decor[k.slice(3)] = { out: x.out, in: x.in, at: x.at }; });
  out.terms = {}; out.reports = {};
  await each('tm:', async (k) => { const x = await readJ(kv, k, null); if (x) out.terms[k.slice(3)] = { version: x.version, at: x.at }; });
  await each('rp:', async (k) => { const x = await readJ(kv, k, null); if (x && Array.isArray(x.by)) out.reports[k.slice(3)] = x.by.length; });
}

// ---------- 7) 誰かの家に遊びに行く（村人のページ・home.html の「遊びに行く」→ 町の画面。決まりは js/visits.js と同じ。毎日の更新の側は tools/visit.js） ----------
//   GET  /visit/state  … { visits: [きょう行った分], left, perDay }
//   POST /visit/go     … { to: 村人 } 1 日 visit.perDay 回まで（ここで数える）→ { visit: { id, to, at }, left }
//   POST /visit/note   … { id, note: 一言の番号 } きょう行った分に、来た人ノートの一言（選ぶだけ）を付ける
// /play/pull の答えに visits: { 日付: { 村人: [{ id, to, at, note? }] } } を足す。KV：vs:<日付>:<村人>（8 日で消える）
export const VISIT_DEF = { perDay: 3 };
export const NOTE_COUNT = 8; // js/visits.js の NOTE_WORDS の数（テストで同じか確かめる）
async function visitApi(path, request, body, { kv, v, date, cfg, nowMs, res }) {
  const C = { ...VISIT_DEF, ...((cfg && cfg.visit) || {}) }, k = `vs:${date}:${v}`;
  const m = await readJ(kv, k, { visits: [] });
  if (path === '/visit/state' && request.method === 'GET') return res({ visits: m.visits, left: Math.max(0, C.perDay - m.visits.length), perDay: C.perDay });
  if (request.method !== 'POST') return res({ error: 'method' }, 405);
  if (path === '/visit/go') {
    if (!validKey(body.to) || body.to === v) return res({ error: 'to' }, 400);
    if (m.visits.length >= C.perDay) return res({ error: 'limit', left: 0 }, 429);
    const x = { id: rid(), to: body.to, at: new Date(nowMs).toISOString() };
    m.visits.push(x);
    await kv.put(k, JSON.stringify(m), { expirationTtl: DAY_TTL });
    return res({ visit: x, left: Math.max(0, C.perDay - m.visits.length) });
  }
  if (path === '/visit/note') {
    const x = m.visits.find((y) => y.id === body.id);
    if (!x) return res({ error: 'no visit' }, 404);
    if (!(Number.isInteger(body.note) && body.note >= 0 && body.note < NOTE_COUNT)) return res({ error: 'note' }, 400);
    if (x.note != null) return res({ error: 'done' }, 409);
    x.note = body.note;
    await kv.put(k, JSON.stringify(m), { expirationTtl: DAY_TTL });
    return res({ visit: x });
  }
  return res({ error: 'not found' }, 404);
}
async function pullVisits(kv, dates, out, each) {
  out.visits = {};
  for (const d of dates) {
    out.visits[d] = {};
    await each(`vs:${d}:`, async (k) => { out.visits[d][k.slice(4 + d.length)] = (await readJ(kv, k, { visits: [] })).visits || []; });
  }
}

// ==== 工房の決まり：ここから（worker.mjs にも同じ物） ====
export const WS_DEF = { perDay: 20, keepDays: 8 };
export const wsCfg = (config) => ({ ...WS_DEF, ...((config && config.workshop) || {}) });
export const WS_TIER_ORDER = ['hand', 'wood', 'stone', 'iron', 'gold', 'diamond'];
// 道具か（wood_axe → { kind: 'axe', tier: 'wood' }）
export function wsTool(item) { const m = /^(?:(wood|stone|iron|gold|diamond)_)?(axe|pickaxe|hoe|shovel|sword|fishing_rod)$/.exec(item || ''); return m ? { kind: m[2], tier: m[1] || 'wood' } : null; }
export const wsItem = (config, item) => (config && config.items && Object.prototype.hasOwnProperty.call(config.items, item) ? config.items[item] : null);
export const wsName = (config, item) => (wsItem(config, item) || {}).name || item;
export const isLegend = (config, item) => (wsItem(config, item) || {}).rarity === 'legend';
// 1 枠に重ねられる数（items の stack。道具は重ねない）
export function stackOf(config, item) {
  if (wsTool(item)) return 1;
  const it = wsItem(config, item), def = (config && config.inventory && config.inventory.stack) || 64;
  return Math.max(1, Math.min(def, (it && it.stack) || def));
}
export function countOf(inv, item) { let n = 0; for (const s of inv || []) if (s && s.item === item && !wsTool(s.item)) n += s.n || 0; return n; }
export function invCounts(inv) { const o = {}; for (const s of inv || []) if (s && !wsTool(s.item)) o[s.item] = (o[s.item] || 0) + (s.n || 0); return o; }
// 入るだけ入れて、入らなかった数を返す（同じ物の枠を先に埋め、あとは空いた枠へ。1 枠は stackOf まで）
export function addTo(inv, slots, item, n, config) {
  if (wsTool(item)) return n;
  while (inv.length < slots) inv.push(null);
  const st = stackOf(config, item);
  for (let i = 0; i < slots && n > 0; i++) { const s = inv[i]; if (s && s.item === item && s.n < st) { const k = Math.min(n, st - s.n); s.n += k; n -= k; } }
  for (let i = 0; i < slots && n > 0; i++) if (!inv[i]) { const k = Math.min(n, st); inv[i] = { item, n: k }; n -= k; }
  return n;
}
// n 個とる（足りなければ何もしないで false）。うしろの枠から
export function takeFrom(inv, item, n) {
  if (!(n > 0) || countOf(inv, item) < n) return false;
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) { const s = inv[i]; if (s && s.item === item && !wsTool(s.item)) { const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) inv[i] = null; } }
  return true;
}
// 交換の「どれでも」：@fish（魚）・@legend（激レア）
export const WS_GROUPS = { '@fish': '魚（どれでも）', '@legend': '激レア（どれでも）' };
const inGroup = (config, g, item) => (g === '@fish' ? /^fish_/.test(item) : g === '@legend' ? isLegend(config, item) : item === g);
export const groupCount = (config, inv, g) => Object.entries(invCounts(inv)).reduce((a, [k, n]) => a + (inGroup(config, g, k) ? n : 0), 0);
function takeGroup(config, inv, g, n) {
  if (!g.startsWith('@')) return takeFrom(inv, g, n);
  if (groupCount(config, inv, g) < n) return false;
  const list = Object.entries(invCounts(inv)).filter(([k]) => inGroup(config, g, k)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); // 多い物から
  for (const [k, have] of list) { if (n <= 0) break; const m = Math.min(n, have); takeFrom(inv, k, m); n -= m; }
  return true;
}
// 余った数（stackOf より多い枠）を、空いた枠へ分ける（消さない。空きがなければそのまま持つ）
export function splitOver(inv, slots, config) {
  while (inv.length < slots) inv.push(null);
  for (let i = 0; i < inv.length; i++) {
    const s = inv[i]; if (!s || wsTool(s.item)) continue;
    const st = stackOf(config, s.item);
    while (s.n > st) { const j = inv.findIndex((x, k) => !x && k < slots); if (j < 0) break; const k = Math.min(st, s.n - st); inv[j] = { item: s.item, n: k }; s.n -= k; }
  }
  return inv;
}

// ---------- 道具を作る（材料は自分の持ち物から。原木 → 板 → 棒は足りない時に自動で） ----------
// counts（{ 物: 数 }）で recipe を作れるか。{ ok, after（使ったあとの数）, missing }
export function craftUse(counts, recipe, CC) {
  const s = { ...counts }, inter = (CC && CC.intermediates) || { planks: { from: { log: 1 }, makes: 4 }, stick: { from: { planks: 2 }, makes: 4 } }, missing = {};
  const take = (it, n) => { const have = s[it] || 0, k = Math.min(have, n); s[it] = have - k; return n - k; };
  let planks = 0, sticks = 0;
  for (const [it, n] of Object.entries(recipe.from || {})) {
    if (it === 'planks') planks += n; else if (it === 'stick') sticks += n;
    else { const left = take(it, n); if (left) missing[it] = (missing[it] || 0) + left; }
  }
  const stLeft = take('stick', sticks);
  if (stLeft) { const b = Math.ceil(stLeft / inter.stick.makes); planks += b * inter.stick.from.planks; s.stick = (s.stick || 0) + b * inter.stick.makes - stLeft; }
  const plLeft = take('planks', planks);
  if (plLeft) { const b = Math.ceil(plLeft / inter.planks.makes), lack = take('log', b * inter.planks.from.log); if (lack) missing.log = (missing.log || 0) + lack; else s.planks = (s.planks || 0) + b * inter.planks.makes - plLeft; }
  for (const k of Object.keys(s)) if (!s[k]) delete s[k];
  return Object.keys(missing).length ? { ok: false, missing } : { ok: true, after: s };
}
// その道具のレシピが開いているか。開いていれば null、まだなら { text, badge, tier }
export function recipeLock(config, key, L) {
  const CC = (config && config.crafting) || {}, r = CC.recipes && CC.recipes[key];
  if (!r) return { text: 'ない道具' };
  const U = wsCfg(config).unlock || {};
  if ((U.start || []).includes(key)) return null;
  const BG = (config && config.badges) || {}, badge = (U.kinds || {})[r.tool], B = BG.list && BG.list[badge], bn = B ? B.name : badge;
  const have = L && L.badges && Number.isInteger(L.badges[badge]) ? L.badges[badge] : -1, names = BG.tierNames || ['銅', '銀', '金', 'ダイヤ'];
  if (r.tier === 'wood') {
    if (((L && L.level) || 1) >= (U.woodLevel || 1) || have >= 0) return null;
    return { text: `Lv${U.woodLevel} か「${bn}」の銅バッジで作れる`, badge, tier: 0, level: U.woodLevel };
  }
  const need = (U.tiers || {})[r.tier];
  if (!Number.isInteger(need)) return { text: '今は作れない' };
  return have >= need ? null : { text: `「${bn}」の${names[need]}バッジで作れる`, badge, tier: need };
}
// バッジ（熟練度）の数（js/combat.js の badgeCount と同じ）と、次の段まで
export function wsBadgeCount(L, stat) { let v = L; for (const p of String(stat).split('.')) v = v == null ? undefined : v[p]; if (Array.isArray(v)) return v.length; if (v && typeof v === 'object') v = v.total; return Math.floor(Number(v) || 0); }
export function badgeNext(config, L) {
  const BG = (config && config.badges) || {}, out = [];
  for (const [id, B] of Object.entries(BG.list || {})) {
    if (B.founder || !Array.isArray(B.tiers)) continue;
    const n = wsBadgeCount(L || {}, B.stat), tier = B.tiers.reduce((t, x, i) => (n >= x ? i : t), -1), next = B.tiers[tier + 1];
    out.push({ id, name: B.name, unit: B.unit || '', note: B.note || '', count: n, tier, next: next ?? null, nextTier: next == null ? null : tier + 1, left: next == null ? 0 : next - n });
  }
  return out;
}

// ---------- 1 つの頼み（op）を持ち物に当てる ----------
// op：{ t: 'send', items: [[物, 数]] } チェストへ送る・{ t: 'craft', recipe } 作る・{ t: 'trade', trade, times } 交換・{ t: 'open', got: [物, 数], tier } 宝箱を開けた（中身は受け口が先に決めた）
//     { t: 'gain', items, src } 遊ぶで手に入れた物（受け口が、釣れた時・宝を掘った時・おてつだいをぜんぶした時に積む）。頼みと同じ列に時刻の順で並ぶ
// L（村人の持ち物 inv・枠 slots・badges・level）を書きかえる（できた時だけ）。store があればチェストへ入れる。{ ok, why?, text?, toStore? }
export function applyOp(config, L, op, store = null) {
  const slots = L.slots || (L.inv || []).length || 3, inv = (L.inv || []).map((s) => (s ? { ...s } : null)), toStore = {};
  while (inv.length < slots) inv.push(null);
  const fail = (why) => ({ ok: false, why });
  const nm = (k) => wsName(config, k);
  if (!op || typeof op !== 'object') return fail('形がちがう');
  let text = '';
  if (op.t === 'send') {
    const list = Array.isArray(op.items) ? op.items : [];
    if (!list.length || list.length > 12) return fail('形がちがう');
    for (const [it, n] of list) {
      if (!wsItem(config, it) || wsTool(it) || !Number.isInteger(n) || n < 1 || n > 999) return fail('送れない物');
      if (!takeFrom(inv, it, n)) return fail(`${nm(it)}が足りない`);
      toStore[it] = (toStore[it] || 0) + n;
    }
    text = list.map(([it, n]) => `${nm(it)}${n > 1 ? ` ${n} 個` : ''}`).join('・');
  } else if (op.t === 'craft') {
    const CC = (config && config.crafting) || {}, r = CC.recipes && CC.recipes[op.recipe], T = r && wsTool(op.recipe);
    if (!r || !T) return fail('ない道具');
    const lock = recipeLock(config, op.recipe, L);
    if (lock) return fail(lock.text);
    const cur = inv.findIndex((s) => s && wsTool(s.item) && wsTool(s.item).kind === T.kind);
    if (cur >= 0 && WS_TIER_ORDER.indexOf(wsTool(inv[cur].item).tier) >= WS_TIER_ORDER.indexOf(T.tier)) return fail('同じか、もっと良い物を持っている');
    const before = invCounts(inv), p = craftUse(before, r, CC);
    if (!p.ok) return fail('材料が足りない：' + Object.entries(p.missing).map(([k, n]) => `${nm(k)} あと ${n}`).join('・'));
    for (const k of Object.keys(before)) { const d = before[k] - (p.after[k] || 0); if (d > 0) takeFrom(inv, k, d); }
    if (cur >= 0) { toStore[inv[cur].item] = 1; inv[cur] = null; } // 前の道具は島のチェストへ
    for (const [k, n] of Object.entries(p.after)) { const d = n - (before[k] || 0); if (d > 0 && addTo(inv, slots, k, d, config) > 0) return fail('持ち物がいっぱい'); }
    const j = inv.findIndex((s, i) => !s && i < slots);
    if (j < 0) return fail('持ち物がいっぱい');
    const dur = ((CC.tiers || {})[T.tier] || {}).durability || 30;
    inv[j] = { item: op.recipe, dur, max: dur };
    text = nm(op.recipe);
  } else if (op.t === 'trade') {
    const T = (wsCfg(config).trades || []).find((x) => x.id === op.trade), times = op.times == null ? 1 : op.times;
    if (!T) return fail('ない交換');
    if (!Number.isInteger(times) || times < 1 || times > 10) return fail('形がちがう');
    if (T.need) { const have = L.badges && Number.isInteger(L.badges[T.need.badge]) ? L.badges[T.need.badge] : -1; if (have < T.need.tier) return fail('まだ交換できない'); }
    for (const [g, n] of Object.entries(T.give || {})) if (!takeGroup(config, inv, g, n * times)) return fail(`${WS_GROUPS[g] || nm(g)}が足りない`);
    for (const [it, n] of Object.entries(T.get || {})) {
      if (wsTool(it)) { const dur = ((((config && config.crafting) || {}).tiers || {})[wsTool(it).tier] || {}).durability || 30; for (let k = 0; k < n * times; k++) { const j = inv.findIndex((s, i) => !s && i < slots); if (j < 0) return fail('持ち物がいっぱい'); inv[j] = { item: it, dur, max: dur }; } }
      else if (addTo(inv, slots, it, n * times, config) > 0) return fail('持ち物がいっぱい');
    }
    text = Object.entries(T.get || {}).map(([it, n]) => `${nm(it)}${n * times > 1 ? ` ${n * times} 個` : ''}`).join('・');
  } else if (op.t === 'gain') { // 遊ぶで手に入れた（釣れた・宝箱をもらった・激レア）。受け口が積む。入らない分は島のチェストへ（できないことはない）
    const list = Array.isArray(op.items) ? op.items : [];
    if (!list.length || list.length > 12) return fail('形がちがう');
    for (const [it, n] of list) {
      if (!wsItem(config, it) || wsTool(it) || !Number.isInteger(n) || n < 1 || n > 99) return fail('形がちがう');
      const left = addTo(inv, slots, it, n, config);
      if (left) toStore[it] = (toStore[it] || 0) + left;
    }
    text = list.map(([it, n]) => `${nm(it)}${n > 1 ? ` ${n} 個` : ''}`).join('・');
  } else if (op.t === 'open') {
    if (!boxOk(config, op.got)) return fail('中身がちがう');
    if (!takeFrom(inv, 'treasure_box', 1)) return fail('宝箱がない');
    if (addTo(inv, slots, op.got[0], op.got[1], config) > 0) return fail('持ち物がいっぱい');
    text = `${nm(op.got[0])}${op.got[1] > 1 ? ` ${op.got[1]} 個` : ''}`;
  } else return fail('形がちがう');
  L.inv = inv;
  if (store) for (const [k, n] of Object.entries(toStore)) store[k] = (store[k] || 0) + n;
  return { ok: true, text, toStore };
}
// 手に入れた物（釣った物・宝箱・激レア）を入れる。入らなかった分 { 物: 数 } を返す（毎日の更新はチェストへ）
export function applyGains(config, L, gains) {
  const slots = L.slots || (L.inv || []).length || 3, over = {};
  L.inv = L.inv || [];
  for (const [it, n] of gains) { if (!wsItem(config, it) || wsTool(it)) continue; const left = addTo(L.inv, slots, it, n, config); if (left) over[it] = (over[it] || 0) + left; }
  return over;
}
// まだ毎日の更新に入っていない分を足した、今の持ち物（受け口・画面の見本）。ops の順に確かめ、できない物は ok: false
export function simulate(config, L0, gains, ops) {
  const L = { ...L0, inv: (L0.inv || []).map((s) => (s ? { ...s } : null)) };
  applyGains(config, L, gains || []);
  const results = (ops || []).map((op) => ({ id: op.id, ...applyOp(config, L, op, null) }));
  return { L, results };
}

// ---------- 宝箱と激レア（抽選は受け口。rnd は 0〜1 を返す関数） ----------
export const boxTiers = (config) => ((wsCfg(config).box || {}).tiers || []);
const pickW = (list, rnd) => { let sum = 0; for (const x of list) sum += x[2] ?? 1; let r = rnd() * sum; for (const x of list) { r -= x[2] ?? 1; if (r < 0) return x; } return list[list.length - 1]; };
export function rollBox(config, rnd) {
  const T = boxTiers(config); let r = rnd(), t = T[T.length - 1];
  for (const x of T) { r -= x.p; if (r < 0) { t = x; break; } }
  const [item, n] = pickW(t.items, rnd);
  return { tier: t.id, item, n };
}
// 帯に並べる物（本当の確率で引いた物。stop の所が当たり）
export function boxStrip(config, rnd, got, len = 44, stop = 37) { const a = []; for (let i = 0; i < len; i++) { const x = i === stop ? got : rollBox(config, rnd); a.push([x.item, x.n, x.tier]); } return a; }
export function boxOk(config, got) { return Array.isArray(got) && boxTiers(config).some((t) => t.items.some(([k, n]) => k === got[0] && n === got[1])); }
export const tierOfItem = (config, item) => { for (const t of boxTiers(config)) if (t.items.some(([k]) => k === item)) return t.id; return isLegend(config, item) ? 'legend' : null; };
// 激レア：釣り（fishP）・宝探し（treasureP）。当たれば物の key、外れは null
export function rollLegend(config, src, rnd) {
  const G = wsCfg(config).legend || {}, p = src === 'treasure' ? G.treasureP : G.fishP, list = src === 'treasure' ? G.treasure : G.fish;
  if (!(p > 0) || !Array.isArray(list) || !list.length || rnd() >= p) return null;
  return pickW(list.map(([k, w]) => [k, 1, w]), rnd)[0];
}
// ==== 工房の決まり：ここまで ====

// ---------- 8) 工房（play.html の「持ち物」。決まりは上の「工房の決まり」＝ js/workshop.js の写し。毎日の更新の側は tools/workshop.js） ----------
// サイトは 5) と同じ印で送る：
//   GET  /shop/state … { inv, slots, ops: [{ …頼み, ok, why }], gains: [[物, 数]], left, perDay }（まだ毎日の更新に入っていない分を足した持ち物）
//   POST /shop/do    … { t: 'send', items: [[物, 数]] }（島のチェストへ）| { t: 'craft', recipe } | { t: 'trade', trade, times? }。できるかここで確かめて積む（できない時は 400 と why）
//   POST /box/open   … 宝箱を 1 つ開ける。中身・帯に並べる物・止まる所（stop・offset）はここで決める（画面は合わせて止めるだけ）
// 持ち物はサイトの data/life.json、毎日の更新がもう入れた分は data/workshop.json（applied・seen）から読む（60 秒おぼえておく）。
// 1 日に頼めるのは workshop.perDay 回まで。KV：wk:<日付>:<村人>（8 日で消える）。/play/pull の答えに shop: { 日付: { 村人: [頼み] } }
// 遊びでもらえる物：釣れた物（と、まれに激レア legend.fishP）・宝を掘った時に宝箱 1 つ（と、まれに激レア legend.treasureP）・おてつだいを全部した日に宝箱 1 つ。
//   どれも { t: 'gain', items, src } として頼みと同じ列（wk:）に時刻の順で積む（持ち物に入れるのは毎日の更新。数は perDay に数えない）
const siteFiles = {};
export function _resetSiteFiles() { for (const k of Object.keys(siteFiles)) delete siteFiles[k]; }
async function siteFile(env, name, nowMs) {
  const c = siteFiles[name];
  if (c && nowMs - c.at < 60e3) return c.v;
  try { const r = await fetch(siteOf(env) + '/data/' + name + '.json', { cf: { cacheTtl: 60 } }); if (r.ok) { const v = (await r.json()) || {}; siteFiles[name] = { at: nowMs, v }; return v; } } catch (e) { /* 下へ */ }
  return c ? c.v : null;
}
const wsRnd = (env) => (typeof env._rnd === 'function' ? env._rnd : () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296);
// まだ毎日の更新に入っていない頼みと、もらった物（ops）。3 日分（/play/pull と同じ）・時刻の順
async function wsPending(kv, env, v, nowMs) {
  const life = (await siteFile(env, 'life', nowMs)) || {}, ws = (await siteFile(env, 'workshop', nowMs)) || {};
  const L0 = life[v] && typeof life[v] === 'object' ? life[v] : { inv: [], slots: 3 };
  const seen = new Set(Array.isArray(ws.seen) ? ws.seen : []), ops = [];
  for (let i = 2; i >= 0; i--) for (const op of (await readJ(kv, `wk:${jstDate(nowMs - i * 86400e3)}:${v}`, { ops: [] })).ops || []) if (op && !seen.has(op.id)) ops.push(op);
  return { L0, gains: [], ops };
}
// もらった物を積む（釣れた・宝を掘った・おてつだいをぜんぶした）
async function wsGain(kv, date, v, items, src, nowMs) {
  const k = `wk:${date}:${v}`, m = await readJ(kv, k, { ops: [] });
  (m.ops = m.ops || []).push({ id: rid(), t: 'gain', items, src, at: new Date(nowMs).toISOString() });
  await kv.put(k, JSON.stringify(m), { expirationTtl: DAY_TTL });
}
const wsAsked = (m) => (m.ops || []).filter((o) => o && o.t !== 'gain').length; // きょう頼んだ数（もらった物は数えない）
async function shopApi(path, request, body, { kv, v, date, cfg, nowMs, res, env }) {
  const W = wsCfg(cfg), k = `wk:${date}:${v}`;
  const P = await wsPending(kv, env, v, nowMs), sim = simulate(cfg, P.L0, P.gains, P.ops);
  const today = await readJ(kv, k, { ops: [] });
  today.ops = today.ops || [];
  const view = () => ({ inv: sim.L.inv, slots: sim.L.slots || 3, ops: P.ops.map((op, i) => ({ ...op, ok: sim.results[i].ok, why: sim.results[i].why || null })), gains: P.gains, left: Math.max(0, W.perDay - wsAsked(today)), perDay: W.perDay });
  if (path === '/shop/state' && request.method === 'GET') return res(view());
  if (request.method !== 'POST') return res({ error: 'method' }, 405);
  let op;
  if (path === '/shop/do') {
    const t = body.t;
    if (t === 'send') op = { t, items: (Array.isArray(body.items) ? body.items : []).slice(0, 12).map((x) => (Array.isArray(x) ? [String(x[0]).slice(0, 40), x[1]] : ['', 0])) };
    else if (t === 'craft') op = { t, recipe: String(body.recipe || '').slice(0, 40) };
    else if (t === 'trade') op = { t, trade: String(body.trade || '').slice(0, 40), times: body.times == null ? 1 : body.times };
    else return res({ error: 'bad op' }, 400);
  } else if (path === '/box/open') {
    const g = rollBox(cfg, wsRnd(env));
    op = { t: 'open', got: [g.item, g.n], tier: g.tier };
  } else return res({ error: 'not found' }, 404);
  if (wsAsked(today) >= W.perDay) return res({ error: 'limit', left: 0 }, 429);
  const L = { ...sim.L, inv: sim.L.inv.map((s) => (s ? { ...s } : null)) };
  const r = applyOp(cfg, L, op, null);
  if (!r.ok) return res({ error: 'cannot', why: r.why }, 400);
  op.id = rid(); op.at = new Date(nowMs).toISOString();
  today.ops.push(op);
  await kv.put(k, JSON.stringify(today), { expirationTtl: DAY_TTL });
  sim.L = L; P.ops.push(op); sim.results.push({ id: op.id, ...r });
  const out = { op, text: r.text, ...view() };
  if (op.t === 'open') { const rnd = wsRnd(env); out.stop = 37; out.strip = boxStrip(cfg, rnd, { item: op.got[0], n: op.got[1], tier: op.tier }, 44, out.stop); out.offset = Math.round((0.18 + rnd() * 0.64) * 1000) / 1000; }
  return res(out);
}
async function pullShop(kv, dates, out, each) {
  out.shop = {};
  for (const d of dates) {
    out.shop[d] = {};
    await each(`wk:${d}:`, async (k) => { out.shop[d][k.slice(4 + d.length)] = (await readJ(kv, k, { ops: [] })).ops || []; });
  }
}

export { poll, stats, handleDm, dmQueue, dmDone };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 自分の村人と遊び（サイトから。印で確かめる）
    const playPath = url.pathname === '/me' || url.pathname === '/me/settings' || url.pathname.startsWith('/play/') || url.pathname.startsWith('/mail/') || url.pathname === '/me/decor' || url.pathname.startsWith('/visit/') || url.pathname.startsWith('/shop/') || url.pathname.startsWith('/box/');
    if (playPath && request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
    if (playPath) return playApi(request, env);
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
