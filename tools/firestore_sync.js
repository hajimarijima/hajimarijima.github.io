#!/usr/bin/env node
'use strict';
// 毎日の処理（GitHub Actions）で、Firestore から Google ログインで入れたプロフィールを読み、data/ に反映する。
//   node tools/firestore_sync.js            … つなぐコードの処理 → プロフィールの反映
//   node tools/firestore_sync.js --dry      … 読むだけ（書きこまない）
// 鍵：環境変数 FIREBASE_SERVICE_ACCOUNT（サービスアカウントの JSON をそのまま入れる。GitHub Secrets から渡す）
// 入れるもの：Google の uid と、結びつけた村人の key だけ。メールアドレスは読まないし、どこにも書かない。
// 追加のライブラリは使わない（JWT は node の crypto で作り、Firestore は REST で読む）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./people');
const PR = require('./profiles');
const INV = require('./invites');
const IG = require('./instagram');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry');
const read = (f, d) => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d; };
const write = (f, o) => { if (DRY) return; fs.mkdirSync(path.dirname(path.join(DATA, f)), { recursive: true }); fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 1) + '\n'); };

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT がないので、Firestore の反映はとばします'); process.exit(0); }
const sa = JSON.parse(raw);
const b64 = (b) => Buffer.from(b).toString('base64url');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }) });
  if (!r.ok) throw new Error('トークンを取れません: ' + r.status);
  return (await r.json()).access_token;
}
// Firestore の値 ⇔ ふつうの値
const fromFs = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? null)]));
const toFs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }]));

(async () => {
  const tk = await token();
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status}`);
    return r.status === 204 ? {} : r.json();
  };
  const list = async (col) => {
    const out = {}; let page = '';
    do {
      const j = await api('GET', `/${col}?pageSize=300${page ? '&pageToken=' + page : ''}`);
      for (const d of (j && j.documents) || []) out[d.name.split('/').pop()] = fromFs(d.fields);
      page = j && j.nextPageToken;
    } while (page);
    return out;
  };
  const config = read('config.json');
  const villagers = read('villagers.json', []);
  const word = (config.firebase && config.firebase.linkWord) || 'つなぐ';

  // 1. つなぐコード：インスタのコメントの from.id で村人を決め、コードを出した Google の uid と結ぶ
  const inbox = read('inbox/instagram.json', null);
  let linked = 0;
  for (const { code, igId } of PR.linksFrom(inbox && inbox.joinComments, word)) {
    const c = await api('GET', `/linkCodes/${code}`);
    if (!c) continue;
    const uid = fromFs(c.fields).uid;
    const v = villagers.find((x) => x.igId && x.igId === P.igHash(igId));
    if (!uid || !v) continue;
    if (!DRY) {
      // 同じ村人につながっていた別の uid ははずす（1 人の村人に 1 つ）
      const users = await list('users');
      for (const [u, d] of Object.entries(users)) if (u !== uid && d.villager === v.key) await api('PATCH', `/users/${u}?updateMask.fieldPaths=villager`, { fields: {} });
      await api('PATCH', `/users/${uid}?updateMask.fieldPaths=villager&updateMask.fieldPaths=linkedAt`, { fields: toFs({ villager: v.key, linkedAt: new Date().toISOString() }) });
      await api('DELETE', `/linkCodes/${code}`);
    }
    linked++;
  }

  // 1.5 招待リンク：使われた印で村人をつなぎ直し（1 人の村人に 1 つ）、切れた・使った印は消す
  const invites = await list('invites');
  const now = Date.now();
  let used = 0, removed = 0;
  for (const [tok, inv] of Object.entries(invites)) {
    if (inv.usedBy && inv.villager && !DRY) {
      const users = await list('users');
      for (const [u, d] of Object.entries(users)) if (u !== inv.usedBy && d.villager === inv.villager) await api('PATCH', `/users/${u}?updateMask.fieldPaths=villager`, { fields: {} });
      used++;
    }
    if (INV.shouldDelete(inv, now)) { if (!DRY) await api('DELETE', `/invites/${tok}`); removed++; }
  }
  // まだ Google とつながっていない新しい村人に、DM で招待リンクを送る（審査が済むまでは送らない）
  let dmSent = 0;
  if (IG.dmReady()) {
    const sent = read('inbox/invites_sent.json', {});
    const users = await list('users');
    const linkedSet = new Set(Object.values(users).map((d) => d.villager).filter(Boolean));
    const site = (config.siteUrl || '').trim();
    for (const p of INV.pendingInvites(inbox && inbox.joinComments, villagers, sent, linkedSet, now, config.joinWord)) {
      if (!site) { console.log('config.json の siteUrl が空なので、招待リンクは送りません'); break; }
      const inv = INV.newInvite(p.villager, now);
      if (!DRY) await api('PATCH', `/invites/${inv.token}`, { fields: { villager: { stringValue: inv.villager }, createdAt: { timestampValue: inv.createdAt }, expiresAt: { timestampValue: inv.expiresAt } } });
      const r = DRY ? { sent: false } : await IG.sendPrivateReply(p.commentId, INV.messageText(INV.inviteUrl(site, inv.villager, inv.token)));
      if (r.sent) { sent[p.igHash] = { at: new Date(now).toISOString(), villager: p.villager }; dmSent++; }
    }
    write('inbox/invites_sent.json', sent);
  }
  console.log(`招待：使われた印 ${used}・片付けた印 ${removed}・DM を送った人 ${dmSent}${IG.dmReady() ? '' : '（DM はまだ送らない設定）'}`);

  // 2. プロフィール：公開の項目は villagers.json へ、公開しない項目は data/inbox/（git に入らない）へ
  const pub = await list('profiles');
  const priv = await list('private');
  const { report, priv: privOut } = PR.applyProfiles(villagers, pub, priv, config.profileFields || []);
  write('villagers.json', villagers);
  write('inbox/profiles_private.json', privOut);
  console.log(`つないだ人 ${linked} 人・プロフィールを反映 ${report.updated.length} 人・使えなかった項目 ${report.rejected.length}${DRY ? '（--dry なので書いていません）' : ''}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
