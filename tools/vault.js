'use strict';
// 引っ越した人の保管（tools/moveout.js が書き、tools/movein-restore.js が読む）。
//   中身（村人の行・暮らし・日記・関係・地図や state の名簿の位置など、元にもどすのに要るもの全部）は、
//   TOWN_SALT（GitHub Secrets）から作った鍵で AES-256-GCM に暗号化して、公開されない所に置く：
//     ・手元：<リポジトリ>/.vault/<userHash>.json（.gitignore。data/ の外なので GitHub Pages には出ない）
//     ・Actions：moveout.yml が Actions の artifact（retention-days: 30）に上げる。30 日で GitHub が消す
//   ファイルの名前は名前の印（塩入りの userHash）。外から見えるのは、引っ越した時刻（at）だけ
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP_DAYS = 30;
const DIR = () => process.env.TOWN_VAULT || path.join(__dirname, '..', '.vault');
const key = () => crypto.createHmac('sha256', process.env.TOWN_SALT || 'town-dev-salt-NOT-SECRET').update('vault-key:moveout').digest();
const fileOf = (userHash, dir = DIR()) => path.join(dir, `${userHash}.json`);

function seal(obj, at) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, at, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function open(env) {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(env.iv, 'base64'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]).toString('utf8'));
}
const expired = (at, now = new Date()) => now.getTime() - Date.parse(at) > KEEP_DAYS * 86400e3;

function save(userHash, obj, at, dir = DIR()) {
  fs.mkdirSync(dir, { recursive: true });
  const f = fileOf(userHash, dir);
  fs.writeFileSync(f, JSON.stringify(seal(obj, at)) + '\n');
  return f;
}
// 30 日を過ぎた保管分を消す。消したファイルの数を返す
function purge(now = new Date(), dir = DIR()) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    let at = null;
    try { at = JSON.parse(fs.readFileSync(p, 'utf8')).at; } catch { /* 読めない物も消す */ }
    if (!at || expired(at, now)) { fs.unlinkSync(p); n++; }
  }
  return n;
}
module.exports = { KEEP_DAYS, DIR, fileOf, seal, open, expired, save, purge };
