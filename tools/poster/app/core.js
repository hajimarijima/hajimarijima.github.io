'use strict';
// 投稿アプリの「ブラウザも通信も使わない部分」。test_app.js で確かめる。
const path = require('path');
const L = require('../lib');

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const isVideoPath = (p) => typeof p === 'string' && path.isAbsolute(p) && VIDEO_EXT.test(p);

// このパソコンの中からの通信だけ通す。Host も見る（よそのサイトが名前を付けかえて来るのを防ぐ）
function isAllowedRequest({ remoteAddress, host, port }) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(remoteAddress || ''));
  const h = String(host || '').toLowerCase();
  return local && (h === `127.0.0.1:${port}` || h === `localhost:${port}`);
}

// 画面の入力 → post.js に渡す引数の並び（1 つずつ順に動かす）。まちがいは Error
// form: { video, title, youtube, instagram, visibility, dryRun }、captionFile は説明を書いた一時ファイル
function buildPostSteps(form, captionFile) {
  if (!form || (!form.youtube && !form.instagram)) throw new Error('YouTube か Instagram を 1 つ以上選んでください');
  if (!isVideoPath(form.video)) throw new Error('動画を選んでください（mp4 などのファイル）');
  const steps = [];
  if (form.youtube) {
    const a = ['youtube', form.video, captionFile, '--visibility', form.visibility || 'private'];
    if (form.title && String(form.title).trim()) a.push('--title', String(form.title).trim());
    if (form.dryRun) a.push('--dry-run');
    steps.push(a);
  }
  if (form.instagram) steps.push(['instagram', form.video, captionFile, ...(form.dryRun ? ['--dry-run'] : [])]);
  for (const s of steps) L.parseArgs(s); // engine と同じ決まりで先に確かめる
  return steps;
}
function buildLoginSteps(site) {
  const s = ['login', ...(site ? [site] : [])];
  L.parseArgs(s);
  return [s];
}
function buildCommentSteps(url, out) {
  const s = ['comments', String(url || '').trim(), '--out', out];
  L.parseArgs(s);
  return [s];
}
function buildDmSteps(username, msgFile, dryRun) {
  const s = ['dm', String(username || ''), msgFile, ...(dryRun ? ['--dry-run'] : [])];
  L.parseArgs(s);
  return [s];
}

// DM の記録 → 画面に出す形（新しい順・今日の件数・残り）
function dmSummary(log, nowMs, rules = L.DM_RULES) {
  const today = log.sent.filter((x) => L.dayKey(Date.parse(x.at)) === L.dayKey(nowMs)).length;
  return {
    sent: [...log.sent].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    today, max: rules.maxPerDay, remaining: Math.max(0, rules.maxPerDay - today),
    nextAt: log.nextAt && Date.parse(log.nextAt) > nowMs ? log.nextAt : null,
  };
}

// 窓が閉じたか・ずっと使われていないか。true ならサーバーを止める
function shouldExit({ nowMs, startedMs, lastBeatMs, byeMs, running }, t = { firstBeatMs: 180e3, beatMs: 45e3, byeMs: 8e3 }) {
  if (running) return false;
  if (byeMs && (!lastBeatMs || lastBeatMs <= byeMs) && nowMs - byeMs > t.byeMs) return true;
  if (!lastBeatMs) return nowMs - startedMs > t.firstBeatMs;
  return nowMs - lastBeatMs > t.beatMs;
}

module.exports = { isVideoPath, isAllowedRequest, buildPostSteps, buildLoginSteps, buildCommentSteps, buildDmSteps, dmSummary, shouldExit };
