#!/usr/bin/env node
'use strict';
// DM で入居する（インスタの DM に「住みたい」と送ると、コメントと同じように町に住める）。config.dm.enabled が true の時だけ動く。
// 手順と、要る権限・設定は docs/DMで入居する手順.md。
//
// 流れ
//   1) Cloudflare の受け口（tools/webhook/worker.mjs）が Meta の messages の Webhook を受け、送り主のユーザー名・フォローしているかを引いて、
//      KV に積む（公開しない。23 時間で消える）。そして GitHub の join を動かす（repository_dispatch の ig-dm。中身は送らない）
//   2) join.yml：node tools/dm.js pull … 受け口の /dm/queue から積んである DM を読み、data/inbox/dm.json に置く（.gitignore で公開しない）
//   3) join.js：dmJoins() で入居（コメントの入居と同じ upsertVillager。同じ人はコメントと DM で二重にならない）→ 返事の文を data/inbox/dm_replies.json に
//   4) join.yml：コミットのあと node tools/dm.js done … 受け口の /dm/done に返事を渡す。受け口が Send API で DM を返し、KV から消す
//
// 公開データ（data/*.json）に書くのは、今のコメントの入居と同じ印だけ（IGSID は塩入りの igHash、名前は userHash。かくす人は名前も書かない）。
// IGSID・ユーザー名・DM の文はログにも出さない（数だけ出す）。
// env：DM_QUEUE_URL（受け口の URL。例 https://town-webhook.〇〇.workers.dev）・DM_QUEUE_TOKEN（受け口の DM_QUEUE_TOKEN と同じ合言葉）
const fs = require('fs');
const path = require('path');
const P = require('./people');

const DEFAULT_SITE = 'https://hajimarijima.github.io/';
const DEFAULT_WORDS = ['住みたい', 'すみたい', '入居', '入村'];
const DEFAULT_MESSAGES = {
  welcome: '{name}さん、はじまり島へようこそ！あなたの家はこちら → {url}',
  already: '{name}さんは、もうはじまり島に住んでいます！あなたの家はこちら → {url}',
  notFollowing: 'フォローしてからもう一度「{word}」と送ってね',
  retry: 'うまく受け付けられませんでした。少したってから、もう一度「{word}」と送ってね',
};

// config.dm を、足りない所を既定の値でうめて返す
function dmConfig(config) {
  const d = (config && config.dm) || {};
  return {
    enabled: d.enabled === true,
    words: (Array.isArray(d.words) && d.words.length ? d.words : DEFAULT_WORDS).map(P.norm).filter(Boolean),
    readOptions: d.readOptions !== false,
    requireFollow: d.requireFollow !== false,
    messages: { ...DEFAULT_MESSAGES, ...(d.messages || {}) },
    houseUrl: d.houseUrl || '{site}?v={id}',
    site: String(d.siteUrl || (config && config.siteUrl) || DEFAULT_SITE),
  };
}

// DM の文が入居の言葉か。いちばん前に書いてある言葉を返す（なければ null）。「住みたくない」「入居しない」などは読まない
const NOT_DM_JOIN = /(住|す)みたくない|(住|す)めない|入居(し|でき)ない|入居しません|入村(し|でき)ない|入村しません/;
function dmJoinWord(text, words) {
  const t = P.norm(text);
  if (!t || NOT_DM_JOIN.test(t)) return null;
  let best = null, at = Infinity;
  for (const w of words || DEFAULT_WORDS) { const i = t.indexOf(P.norm(w)); if (i >= 0 && i < at) { at = i; best = P.norm(w); } }
  return best && P.isJoin(t, best) ? best : null;
}

const fill = (tpl, o) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (o[k] !== undefined ? String(o[k]) : m));
const houseUrl = (dc, key) => {
  const site = dc.site.endsWith('/') ? dc.site : dc.site + '/';
  return fill(dc.houseUrl, { site, id: encodeURIComponent(key) });
};

// 積んであった DM で入居する（join.js から。S は join.js の町の中身）。
//   dms：[{ id, igsid, username, follows, text, at }]（tools/dm.js pull が置く data/inbox/dm.json の items）
//   返り値：{ registered: [新しく来た村人], known: [もう住んでいた村人], replies: [{ ids, text, kind, v }], profUpdated }
//   replies の v は、町に迎えたあと（welcomeNow のあと）に replyTexts() で文を作るために持っておく
function dmJoins(S, dms, { config, owners = [], hidden, date, day, enemies = false, moved = [] } = {}) {
  const dc = dmConfig(config);
  const out = { registered: [], known: [], replies: [], skipped: 0, profUpdated: 0 };
  if (!dc.enabled) return out;
  // 1 人 1 回（同じ人が続けて送っても返事は 1 つ）。古い順
  const byUser = new Map();
  for (const m of [...(dms || [])].filter((x) => x && x.id && x.igsid).sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0))) {
    const k = String(m.igsid);
    const g = byUser.get(k) || { ids: [], msgs: [] };
    g.ids.push(String(m.id)); g.msgs.push(m);
    byUser.set(k, g);
  }
  for (const [igsid, g] of byUser) {
    // 入居の言葉が書いてある、いちばん新しい DM（受け口でも見ているが、config の言葉で見直す）
    const hits = g.msgs.map((m) => ({ m, word: dmJoinWord(m.text, dc.words) })).filter((x) => x.word);
    const last = hits[hits.length - 1];
    const u = g.msgs[g.msgs.length - 1];
    const word = last ? last.word : dc.words[0];
    if (!last) { out.replies.push({ ids: g.ids, text: null, kind: 'ignore' }); out.skipped++; continue; } // 入居の言葉がない（返事はしないで消す）
    const username = u.username ? P.norm(u.username) : '';
    if (username && owners.includes(username.toLowerCase())) { out.replies.push({ ids: g.ids, text: null, kind: 'owner' }); out.skipped++; continue; }
    // フォローしているか（受け口が User Profile API の is_user_follow_business で見た値。分からない時（null）は通す）
    const known = P.findVillager(S.villagers, { igId: igsid, username });
    if (dc.requireFollow && !known && u.follows === false) { out.replies.push({ ids: g.ids, text: fill(dc.messages.notFollowing, { word }), kind: 'notFollowing' }); continue; }
    if (!username && !known) { out.replies.push({ ids: g.ids, text: fill(dc.messages.retry, { word }), kind: 'retry' }); continue; } // 名前が引けなかった（もう一度送ってもらう）
    // コメントと同じ書き方（住みたい ピッケル 12/11 りんご INFP）を読む。readOptions が false なら言葉だけ
    //   続けて送った DM もまとめて読む（あとの値が勝つ）。DM の言葉（入居・入村）は「住みたい」に読みかえる（食べ物などとまちがえないように）
    const JW = '住みたい';
    const asJoin = (s) => dc.words.reduce((a, w) => a.split(w).join(` ${JW} `), P.norm(s));
    const from = { id: igsid, username: username || (known && known.name) || '' };
    const fake = (dc.readOptions ? hits : [last]).map((x) => ({ text: dc.readOptions ? asJoin(x.m.text) : JW, timestamp: x.m.at || new Date().toISOString(), from }));
    const r = P.registrationsFrom(fake, JW, config.startTools, { enemies, mbti: config.mbtiOn !== false })[0] || {};
    if (!known && P.movedBefore(moved, r)) { out.replies.push({ ids: g.ids, text: null, kind: 'ignore' }); out.skipped++; continue; } // 引っ越す前の DM（tools/moveout.js）
    const v = P.upsertVillager(S.villagers, { igId: igsid, username: username || (known && known.name), joined: date, joinedDay: day, source: 'comment', startTool: r.startTool, birthday: r.birthday, food: r.food }, hidden);
    if (v) { v.via = 'dm'; out.registered.push(v); }
    const who = v || P.findVillager(S.villagers, { igId: igsid, username });
    if (!who) { out.replies.push({ ids: g.ids, text: fill(dc.messages.retry, { word }), kind: 'retry' }); continue; }
    if (!v) out.known.push(who);
    // 誕生日・好きな食べ物・MBTI・性別（コメントと同じ決まり。あとから書いた値が勝つ）
    if (dc.readOptions) out.profUpdated += P.applyCommentProfiles(S.villagers, fake, { word: JW, startTools: config.startTools, mbti: config.mbtiOn !== false, enemies });
    out.replies.push({ ids: g.ids, kind: v ? 'welcome' : 'already', v: who });
  }
  return out;
}

// 町に迎えたあと（表示名・かくす人のあだ名が決まってから）、返事の文を作る。dm_replies.json に書く形（v は入れない）
function replyTexts(res, config) {
  const dc = dmConfig(config);
  return res.replies.map((r) => {
    if (!r.v) return { ids: r.ids, text: r.text || null, kind: r.kind };
    // villager：受け口（Worker）がこの人専用のリンク（?me=印）を作って文に入れる（印は受け口の中だけ。ここには書かない）
    return { ids: r.ids, text: fill(dc.messages[r.kind] || dc.messages.welcome, { name: r.v.display || r.v.name || '', url: houseUrl(dc, r.v.key) }), kind: r.kind, villager: r.v.key };
  });
}

// ---------- 受け口（Worker）とのやりとり ----------
function queueEnv(env = process.env) {
  const url = String(env.DM_QUEUE_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.DM_QUEUE_TOKEN || '').trim();
  if (!url || !token) return null;
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error('DM_QUEUE_URL は https:// の URL にしてください');
  return { url, token };
}
async function pull({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  const q = queueEnv(env);
  if (!q) return null;
  const r = await fetchFn(q.url + '/dm/queue', { headers: { Authorization: 'Bearer ' + q.token, 'User-Agent': 'town-join' } });
  if (!r.ok) throw new Error('受け口から DM を読めませんでした（' + r.status + '）');
  const j = await r.json();
  return (Array.isArray(j.items) ? j.items : []).filter((x) => x && x.id && x.igsid);
}
async function done(items, { env = process.env, fetchFn = globalThis.fetch } = {}) {
  const q = queueEnv(env);
  if (!q || !items.length) return null;
  const body = { items: items.map((x) => ({ ids: x.ids, text: x.text || null, ...(x.villager && x.text ? { villager: x.villager } : {}) })) };
  const r = await fetchFn(q.url + '/dm/done', { method: 'POST', headers: { Authorization: 'Bearer ' + q.token, 'Content-Type': 'application/json', 'User-Agent': 'town-join' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('受け口に返事を渡せませんでした（' + r.status + '）');
  return r.json().catch(() => ({}));
}

module.exports = { dmConfig, dmJoinWord, dmJoins, replyTexts, houseUrl, pull, done, DEFAULT_WORDS, DEFAULT_MESSAGES };

// ---------- コマンド ----------
// node tools/dm.js pull   … 積んである DM を data/inbox/dm.json に置く
// node tools/dm.js done   … data/inbox/dm_replies.json の返事を受け口に渡す（送ったら消す）
if (require.main === module) {
  const DATA = process.env.TOWN_DATA || path.join(__dirname, '..', 'data');
  const inbox = path.join(DATA, 'inbox');
  const cmd = process.argv[2];
  const config = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'));
  (async () => {
    if (!dmConfig(config).enabled) { console.log('DM の入居は切ってあります（config.dm.enabled）'); return; }
    if (!queueEnv()) { console.log('DM_QUEUE_URL / DM_QUEUE_TOKEN がないので、DM は見ません'); return; }
    if (cmd === 'pull') {
      const items = await pull();
      fs.mkdirSync(inbox, { recursive: true });
      fs.writeFileSync(path.join(inbox, 'dm.json'), JSON.stringify({ items }) + '\n');
      console.log(`DM：${items.length} 件`);
    } else if (cmd === 'done') {
      const f = path.join(inbox, 'dm_replies.json');
      if (!fs.existsSync(f)) { console.log('DM の返事：なし'); return; }
      const items = JSON.parse(fs.readFileSync(f, 'utf8')).items || [];
      const r = await done(items);
      fs.unlinkSync(f);
      console.log(`DM の返事：${items.filter((x) => x.text).length} 件を渡しました（消した DM ${items.reduce((a, x) => a + x.ids.length, 0)} 件）${r && typeof r.sent === 'number' ? `・送れた ${r.sent} 件` : ''}`);
    } else { console.error('使い方: node tools/dm.js pull | done'); process.exit(2); }
  })().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
