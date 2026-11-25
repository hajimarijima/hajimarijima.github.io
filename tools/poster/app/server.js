#!/usr/bin/env node
'use strict';
// はじまり島 投稿アプリのサーバー。Node の http だけで動く。127.0.0.1 だけで待つ。
// post.js をそのまま子プロセスで動かし、出てきた文字を画面に渡す（画面は 0.7 秒ごとに取りに来る）。
// 窓を閉じたら（または長く使われなければ）自分で止まる。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const L = require('../lib');
const C = require('./core');

const APP = __dirname;
const POSTER = path.join(APP, '..');
const ROOT = path.join(POSTER, '..', '..');
const POST_JS = path.join(POSTER, 'post.js');
const VIDEO_DIR = path.join(ROOT, 'video');
const SHOTS = path.join(POSTER, 'shots');
const DM_LOG = path.join(POSTER, 'dm_log.json');
const COMMENTS_OUT = path.join(ROOT, 'data', 'inbox_comments.json');
const TMP = path.join(APP, 'tmp');
const PORT_FILE = path.join(APP, '.port');
const PREFERRED_PORT = Number(process.env.POSTER_PORT || 47821);
const TOKEN = crypto.randomBytes(16).toString('hex'); // よそのページから勝手に動かされないための合言葉

const state = { startedMs: Date.now(), lastBeatMs: 0, byeMs: 0 };
let job = null; // { id, title, lines: [], done, code, child, tmp: [] }
let port = 0;

// ---------- 道具 ----------
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.setEncoding('utf8');
  req.on('data', (d) => { s += d; if (s.length > 1e6) { reject(new Error('大きすぎます')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (_) { reject(new Error('JSON が読めません')); } });
});
function listVideos() {
  const out = [];
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3 && !['frames', 'check', 'node_modules'].includes(e.name)) walk(p, depth + 1); }
      else if (/\.mp4$/i.test(e.name)) { const st = fs.statSync(p); out.push({ path: p, name: path.relative(VIDEO_DIR, p), size: st.size, mtime: st.mtimeMs }); }
    }
  };
  walk(VIDEO_DIR, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}
function latestShot() {
  let best = null;
  try {
    for (const f of fs.readdirSync(SHOTS)) {
      if (!/\.png$/i.test(f)) continue;
      const m = fs.statSync(path.join(SHOTS, f)).mtimeMs;
      if (!best || m > best.mtime) best = { name: f, mtime: m };
    }
  } catch (_) { /* まだない */ }
  return best;
}
const dmLog = () => L.loadDmLog(fs.existsSync(DM_LOG) ? fs.readFileSync(DM_LOG, 'utf8') : '');
function writeTmp(text) {
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, `${Date.now()}_${crypto.randomBytes(3).toString('hex')}.txt`);
  fs.writeFileSync(f, String(text || ''));
  return f;
}

// ---------- 仕事（post.js を順に動かす。同時に 1 つだけ：Chrome のプロフィールは 1 つしか開けない） ----------
function startJob(title, steps, tmp = []) {
  if (job && !job.done) throw new Error('いま別の仕事が動いています。終わってからにしてください');
  const j = { id: crypto.randomBytes(4).toString('hex'), title, lines: [], done: false, code: null, child: null, tmp, stopped: false };
  job = j;
  const log = (s) => { for (const l of String(s).split(/\r?\n/)) if (l.trim()) j.lines.push(l); };
  (async () => {
    for (const argv of steps) {
      if (j.stopped) break;
      log(`▶ ${argv[0]}${argv[0] === 'login' && argv[1] ? ' ' + argv[1] : ''}${argv.includes('--dry-run') ? '（試し）' : ''}`);
      const code = await new Promise((resolve) => {
        const ch = spawn(process.execPath, [POST_JS, ...argv], { cwd: ROOT, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
        j.child = ch;
        ch.stdout.setEncoding('utf8'); ch.stderr.setEncoding('utf8');
        ch.stdout.on('data', log); ch.stderr.on('data', log);
        ch.on('error', (e) => { log('動かせませんでした: ' + e.message); resolve(1); });
        ch.on('close', (c) => resolve(c));
      });
      j.child = null;
      if (code !== 0) { j.code = code; log(j.stopped ? '■ 止めました' : `✖ 失敗しました（${argv[0]}）。ここで止めます`); break; }
      j.code = 0;
    }
    if (j.code === 0 && !j.stopped) log('✔ ぜんぶ終わりました');
    j.done = true;
    for (const f of j.tmp) fs.rm(f, { force: true }, () => {});
  })();
  return j;
}

// ---------- 道すじ ----------
async function handle(req, res) {
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = u.pathname;
  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace('__TOKEN__', TOKEN);
    return send(res, 200, html, 'text/html; charset=utf-8');
  }
  if (p === '/icon.png') return send(res, 200, fs.readFileSync(path.join(ROOT, 'icons', 'icon-192.png')), 'image/png');
  if (!p.startsWith('/api/')) return send(res, 404, { error: 'ありません' });
  const tok = req.headers['x-token'] || u.searchParams.get('token');
  if (tok !== TOKEN) return send(res, 403, { error: '合言葉がちがいます' });
  if (req.method === 'POST' && p !== '/api/bye' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON で送ってください' });

  const body = req.method === 'POST' ? await readBody(req) : {};
  switch (`${req.method} ${p}`) {
    case 'GET /api/state': {
      const shot = latestShot();
      return send(res, 200, {
        videos: listVideos(), videoDir: VIDEO_DIR, shot, dm: C.dmSummary(dmLog(), Date.now()),
        job: job && { id: job.id, title: job.title, done: job.done, code: job.code },
      });
    }
    case 'POST /api/beat': state.lastBeatMs = Date.now(); return send(res, 200, { ok: true });
    case 'POST /api/bye': state.byeMs = Date.now(); return send(res, 200, { ok: true });
    case 'POST /api/login': return send(res, 200, startJob('ログイン', C.buildLoginSteps(body.site)));
    case 'POST /api/post': {
      const video = String(body.video || '').trim().replace(/^"(.*)"$/, '$1');
      if (!fs.existsSync(video) || !fs.statSync(video).isFile()) throw new Error('動画のファイルがありません: ' + video);
      if (!String(body.caption || '').trim() && !String(body.title || '').trim()) throw new Error('キャプション（説明）を書いてください');
      const cap = writeTmp(body.caption);
      let steps;
      try { steps = C.buildPostSteps({ ...body, video: path.resolve(video) }, cap); } catch (e) { fs.rmSync(cap, { force: true }); throw e; }
      return send(res, 200, startJob(body.dryRun ? '投稿（試し）' : '投稿', steps, [cap]));
    }
    case 'POST /api/comments': return send(res, 200, startJob('コメントを読む', C.buildCommentSteps(body.url, COMMENTS_OUT)));
    case 'GET /api/comments': {
      const list = fs.existsSync(COMMENTS_OUT) ? JSON.parse(fs.readFileSync(COMMENTS_OUT, 'utf8')) : [];
      return send(res, 200, { file: path.relative(ROOT, COMMENTS_OUT), comments: list });
    }
    case 'POST /api/dm': {
      if (!String(body.message || '').trim()) throw new Error('メッセージを書いてください');
      const msg = writeTmp(body.message);
      let steps;
      try { steps = C.buildDmSteps(body.username, msg, !!body.dryRun); } catch (e) { fs.rmSync(msg, { force: true }); throw e; }
      return send(res, 200, startJob(body.dryRun ? 'DM（試し）' : 'DM', steps, [msg]));
    }
    case 'GET /api/job': {
      if (!job) return send(res, 200, { job: null });
      const since = Math.max(0, Number(u.searchParams.get('since')) || 0);
      return send(res, 200, { id: job.id, title: job.title, lines: job.lines.slice(since), next: job.lines.length, done: job.done, code: job.code });
    }
    case 'POST /api/stop': {
      if (job && !job.done) { job.stopped = true; if (job.child) job.child.kill(); }
      return send(res, 200, { ok: true });
    }
    case 'GET /api/shot': {
      const name = path.basename(String(u.searchParams.get('name') || ''));
      const f = path.join(SHOTS, name);
      if (!/\.png$/i.test(name) || !fs.existsSync(f)) return send(res, 404, { error: '画像がありません' });
      return send(res, 200, fs.readFileSync(f), 'image/png');
    }
    default: return send(res, 404, { error: 'ありません' });
  }
}

const server = http.createServer((req, res) => {
  if (!C.isAllowedRequest({ remoteAddress: req.socket.remoteAddress, host: req.headers.host, port })) {
    res.writeHead(403); return res.end('forbidden');
  }
  handle(req, res).catch((e) => send(res, 400, { error: e.message.split('\n')[0] }));
});

function listen(p) {
  server.once('error', (e) => {
    if (p !== 0 && e.code === 'EADDRINUSE') return listen(0); // 使われていたら空いている番号
    console.error('サーバーを開けませんでした: ' + e.message); process.exit(1);
  });
  server.listen(p, '127.0.0.1', () => {
    port = server.address().port;
    fs.writeFileSync(PORT_FILE, String(port));
    console.log(`はじまり島 投稿アプリ: http://127.0.0.1:${port}/`);
  });
}

function quit(why) {
  console.log('止めます: ' + why);
  try { if (fs.readFileSync(PORT_FILE, 'utf8').trim() === String(port)) fs.rmSync(PORT_FILE, { force: true }); } catch (_) { /* もうない */ }
  fs.rm(TMP, { recursive: true, force: true }, () => process.exit(0));
}
setInterval(() => {
  const running = !!(job && !job.done);
  if (C.shouldExit({ nowMs: Date.now(), startedMs: state.startedMs, lastBeatMs: state.lastBeatMs, byeMs: state.byeMs, running })) quit('窓が閉じたか、しばらく使われていません');
}, 2000).unref();
process.on('SIGINT', () => quit('Ctrl+C'));

if (require.main === module) listen(Number(process.argv[2]) || PREFERRED_PORT);
module.exports = { server };
