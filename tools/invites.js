'use strict';
// 「参加したい」とコメントした人に、DM（Instagram の Private Replies）で送る招待リンクの部品（入出力なし。firestore_sync.js とテストで使う）。
//
// 流れ
//   1. 「参加したい」とコメント → 毎日の処理で村人になる
//   2. firestore_sync.js が招待の印（token）を作り、Firestore の invites/{token} に { villager, expiresAt } を置く
//   3. instagram.js の sendPrivateReply で、その人専用のリンク（villager.html?k=村人&invite=印）を DM で送る
//   4. リンクを開いて Google でログインすると、印を使って Google アカウントと村人がつながる（js/auth.js の useInvite）
// 印は 7 日で切れ、一度使ったら使えない（firestore.rules と firestore_sync.js の片付けで守る）。
// Private Replies はコメントから 7 日以内・1 つのコメントに 1 回だけしか送れないので、その範囲の人だけに送る。
const crypto = require('crypto');
const P = require('./people');

const INVITE_DAYS = 7;
const REPLY_WINDOW_DAYS = 7;
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const DAY = 86400000;

// 推測できない長さ（20 字）の印
function makeToken() {
  return Array.from(crypto.randomBytes(20), (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join('');
}
const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9]{16,40}$/.test(t);

function newInvite(villagerKey, now = Date.now()) {
  return { token: makeToken(), villager: villagerKey, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + INVITE_DAYS * DAY).toISOString() };
}
const isExpired = (inv, now = Date.now()) => !inv || !inv.expiresAt || Date.parse(inv.expiresAt) <= now;
// 片付けるもの：切れたもの・使い終わったもの
const shouldDelete = (inv, now = Date.now()) => isExpired(inv, now) || !!inv.usedBy;

function inviteUrl(siteUrl, villagerKey, token) {
  const base = String(siteUrl || '').replace(/\/?$/, '/');
  return `${base}villager.html?k=${encodeURIComponent(villagerKey)}&invite=${encodeURIComponent(token)}`;
}
function messageText(url) {
  return `町に来てくれてありがとう。このリンクを開いて Google でログインすると、あなたの村人とつながって、プロフィールを書きかえられます（7 日間・1 回だけ使えます）。\n${url}`;
}

// DM を送る相手：参加のコメントをした人で、村人になっていて、まだ送っていない人（コメントから 7 日以内）。
// sent: { igの印: { at, villager } }（data/inbox/invites_sent.json。git に入らない）
// linked: すでに Google とつながっている村人の key の集まり（その人には送らない）
function pendingInvites(comments, villagers, sent = {}, linked = new Set(), now = Date.now(), word) {
  const out = [];
  const seen = new Set();
  const list = (comments || []).filter((c) => c && c.id && c.from && c.from.id && P.isJoin(c.text, word))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const c of list) {
    const h = P.igHash(c.from.id);
    if (seen.has(h) || sent[h]) continue;
    if (now - Date.parse(c.timestamp) > REPLY_WINDOW_DAYS * DAY) continue;
    const v = villagers.find((x) => x.igId === h);
    if (!v || linked.has(v.key)) continue;
    seen.add(h);
    out.push({ commentId: c.id, igHash: h, villager: v.key });
  }
  return out;
}

module.exports = { INVITE_DAYS, REPLY_WINDOW_DAYS, makeToken, validToken, newInvite, isExpired, shouldDelete, inviteUrl, messageText, pendingInvites };
