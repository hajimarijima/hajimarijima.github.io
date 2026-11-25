'use strict';
// 投稿ツールの「ブラウザを使わない部分」。引数の読み取り・DM の回数と間隔・コメントの形をここにまとめる（テストする部分）。
const crypto = require('crypto');

const COMMANDS = ['login', 'youtube', 'instagram', 'comments', 'dm'];
const VISIBILITIES = ['private', 'unlisted', 'public'];
const VALUE_FLAGS = ['--title', '--visibility', '--out'];
const BOOL_FLAGS = ['--dry-run'];
const USAGE = [
  '使い方:',
  '  node tools/poster/post.js login [youtube|instagram]',
  '  node tools/poster/post.js youtube <動画> <説明.txt> [--title "..."] [--visibility private|unlisted|public] [--dry-run]',
  '  node tools/poster/post.js instagram <動画> <キャプション.txt> [--dry-run]',
  '  node tools/poster/post.js comments <インスタの投稿URL> [--out data/inbox_comments.json]',
  '  node tools/poster/post.js dm <ユーザー名> <メッセージ.txt> [--dry-run]',
].join('\n');

// argv（node と post.js を除いたもの）→ { cmd, args, flags }。まちがいは Error を投げる
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || !COMMANDS.includes(cmd)) throw new Error((cmd ? `知らないコマンドです: ${cmd}\n` : '') + USAGE);
  const args = [], flags = { dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    let [k, v] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    if (VALUE_FLAGS.includes(k)) {
      if (v === undefined) { v = rest[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${k} のあとに値を書いてください`); }
      flags[k.slice(2)] = v;
    } else if (BOOL_FLAGS.includes(k)) {
      flags.dryRun = true;
    } else if (k.startsWith('--')) {
      throw new Error(`知らないオプションです: ${k}\n` + USAGE);
    } else args.push(a);
  }
  const need = { login: 0, youtube: 2, instagram: 2, comments: 1, dm: 2 }[cmd];
  // login だけは、開くサイトを 1 つ選べる（login youtube / login instagram）
  if (cmd === 'login' && args.length === 1 && !['youtube', 'instagram'].includes(args[0])) throw new Error('login のあとは youtube か instagram です');
  if (!(cmd === 'login' ? args.length <= 1 : args.length === need)) throw new Error(`${cmd} には ${need} 個の値が要ります（${args.length} 個ありました）\n` + USAGE);
  const allowed = { youtube: ['title', 'visibility'], comments: ['out'] }[cmd] || [];
  for (const f of ['title', 'visibility', 'out']) if (flags[f] !== undefined && !allowed.includes(f)) throw new Error(`--${f} は ${cmd} では使えません`);
  if (flags.dryRun && !['youtube', 'instagram', 'dm'].includes(cmd)) throw new Error(`--dry-run は ${cmd} では使えません`);
  if (cmd === 'youtube') {
    flags.visibility = (flags.visibility || 'private').toLowerCase();
    if (!VISIBILITIES.includes(flags.visibility)) throw new Error(`--visibility は ${VISIBILITIES.join(' / ')} のどれかです`);
  }
  if (cmd === 'comments' && !isInstagramPostUrl(args[0])) throw new Error(`インスタの投稿 URL ではありません: ${args[0]}（https://www.instagram.com/p/... か /reel/...）`);
  if (cmd === 'dm') { args[0] = normUser(args[0]); if (!/^[a-z0-9._]{1,30}$/.test(args[0])) throw new Error(`ユーザー名の形がおかしいです: ${argv[1]}`); }
  return { cmd, args, flags };
}

const isInstagramPostUrl = (u) => /^https:\/\/(www\.)?instagram\.com\/([a-z0-9._]+\/)?(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?(\?.*)?$/.test(String(u || ''));

// YouTube：タイトルは 100 文字まで・改行なし。< > は YouTube が受け付けないので全角にする。説明は 5000 文字まで
function youtubeText(caption, title) {
  const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/</g, '＜').replace(/>/g, '＞');
  const desc = clean(caption).trim();
  let t = clean(title).replace(/\s*\n\s*/g, ' ').trim();
  if (!t) t = (desc.split('\n').find((l) => l.trim()) || '').trim();
  if (!t) throw new Error('タイトルが空です（--title を付けるか、説明の 1 行目に書いてください）');
  return { title: [...t].slice(0, 100).join(''), description: [...desc].slice(0, 5000).join('') };
}
// インスタのキャプションは 2200 文字まで
const instagramCaption = (s) => [...String(s || '').replace(/\r\n?/g, '\n').trim()].slice(0, 2200).join('');

// YouTube Studio のアップロードの進み具合の文字 → アップロードは終わったか（処理中・チェック中は「終わった」）
function isUploadDone(label) {
  const s = String(label || '');
  if (/アップロード中|アップロードしています|Uploading|待機|Waiting/i.test(s)) return false;
  return /アップロード完了|アップロードが完了|Upload complete|処理|Processing|チェック|Check|完了|complete/i.test(s);
}

// ---------- DM の決まり：1 日 20 件まで・送るあいだは 40〜90 秒あける・同じ人に 2 回送らない ----------
const DM_RULES = { maxPerDay: 20, minWaitMs: 40e3, maxWaitMs: 90e3 };
const normUser = (u) => String(u || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '').toLowerCase();
const dayKey = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10); // 日本時間の日付
const emptyDmLog = () => ({ sent: [], nextAt: null });
function loadDmLog(text) {
  if (!text) return emptyDmLog();
  const j = JSON.parse(text);
  return { sent: Array.isArray(j.sent) ? j.sent : [], nextAt: j.nextAt || null };
}
const randomWaitMs = (rand = Math.random, rules = DM_RULES) => Math.round(rules.minWaitMs + rand() * (rules.maxWaitMs - rules.minWaitMs));

// 送ってよいか。{ ok, reason, waitMs }。waitMs > 0 なら、その分待ってから送る（断りではない）
function dmCheck(log, username, nowMs, rules = DM_RULES) {
  const u = normUser(username);
  if (log.sent.some((x) => normUser(x.username) === u)) return { ok: false, reason: `@${u} にはもう送っています（dm_log.json）` };
  const today = log.sent.filter((x) => dayKey(Date.parse(x.at)) === dayKey(nowMs)).length;
  if (today >= rules.maxPerDay) return { ok: false, reason: `今日はもう ${today} 件送りました（1 日 ${rules.maxPerDay} 件まで）。明日にしてください` };
  const waitMs = log.nextAt ? Math.max(0, Date.parse(log.nextAt) - nowMs) : 0;
  return { ok: true, waitMs, today };
}
// 送ったあとに記録する。次に送ってよい時刻もここで決める
function dmRecord(log, username, nowMs, rand = Math.random, rules = DM_RULES) {
  log.sent.push({ username: normUser(username), at: new Date(nowMs).toISOString() });
  log.nextAt = new Date(nowMs + randomWaitMs(rand, rules)).toISOString();
  return log;
}

// ---------- コメントの形 ----------
// 画面から読んだ [{ username, text, time, isCaption }] → registrationsFrom() が読める形。
// Graph API の形（{ id, text, timestamp, username, from: { id, username } }）に time も足す。
// 画面からは本当の ID が取れないので from.id にはユーザー名を入れる（名前を変えると別の人になる）。
function shapeComments(raw, fetchedAtMs = Date.now()) {
  const seen = new Set(), out = [];
  for (const c of raw || []) {
    if (!c || c.isCaption) continue;
    const username = normUser(c.username);
    const text = String(c.text || '').replace(/\r\n?/g, '\n').trim();
    if (!username || !text) continue;
    const t = Date.parse(c.time);
    const time = Number.isFinite(t) ? new Date(t).toISOString() : new Date(fetchedAtMs).toISOString();
    const k = username + '\u0000' + time + '\u0000' + text;
    if (seen.has(k)) continue;
    seen.add(k);
    const id = 'web_' + crypto.createHash('sha1').update(k).digest('hex').slice(0, 12);
    out.push({ id, username, text, time, timestamp: time, from: { id: username, username } });
  }
  return out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

module.exports = { COMMANDS, USAGE, parseArgs, isInstagramPostUrl, youtubeText, instagramCaption, isUploadDone, DM_RULES, normUser, dayKey, emptyDmLog, loadDmLog, randomWaitMs, dmCheck, dmRecord, shapeComments };
