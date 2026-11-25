#!/usr/bin/env node
'use strict';
// YouTube と Instagram に、API を使わずブラウザ（Google Chrome）を動かして投稿する。
// ログインは人が手でする（login コマンド）。このスクリプトはパスワードを一切あつかわない。
// 使い方は tools/poster/README.md
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const L = require('./lib');

const ROOT = path.join(__dirname, '..', '..');
const PROFILE = path.join(ROOT, '.poster-profile');
const SHOTS = path.join(__dirname, 'shots');
const DM_LOG = path.join(__dirname, 'dm_log.json');
const SEC = 1000, MIN = 60 * SEC;

// ---------- Playwright（npm -g で入れたもの）を探す。ダウンロードはしない ----------
function loadPlaywright() {
  const roots = [];
  if (process.env.PLAYWRIGHT_ROOT) roots.push(process.env.PLAYWRIGHT_ROOT);
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()); } catch (_) { /* 下で知らせる */ }
  for (const r of roots) for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
    try { return require(path.join(r, name)); } catch (_) { /* 次を試す */ }
  }
  throw new Error('Playwright が見つかりません。npm install -g playwright で入れてあるか確かめてください（npm root -g: ' + (roots.join(', ') || '取れませんでした') + '）');
}

async function openBrowser() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(PROFILE, { recursive: true });
  try {
    return await chromium.launchPersistentContext(PROFILE, {
      channel: 'chrome', // 入っている Google Chrome を使う
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (e) {
    if (/ProcessSingleton|user data directory is already in use|SingletonLock/i.test(e.message)) throw new Error('投稿用の Chrome がもう開いています。閉じてからやり直してください');
    throw new Error('Chrome を開けませんでした: ' + e.message.split('\n')[0]);
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${stamp()}_${name}.png`);
  try { await page.screenshot({ path: f, fullPage: false }); return f; } catch (_) { return null; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// いくつかの候補（日本語と英語の表示、役割で探すものと CSS）から、最初に見えたものを返す
async function firstVisible(candidates, what, timeout = 30 * SEC) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const loc of candidates) {
      try {
        const n = await loc.count();
        for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
      } catch (_) { /* ページが動いている間は失敗することがある */ }
    }
    await sleep(500);
  }
  throw new Error(`「${what}」が見つかりませんでした（${Math.round(timeout / SEC)} 秒待ちました）。画面の表示が変わったかもしれません`);
}
async function clickFirst(candidates, what, timeout) {
  const el = await firstVisible(candidates, what, timeout);
  await el.click();
  return el;
}
async function maybeClick(candidates, timeout = 3 * SEC) {
  try { await clickFirst(candidates, '', timeout); return true; } catch (_) { return false; }
}
// 文字を打つ（貼り付けと同じ速さ）。改行は newlineKey で入れる
async function typeText(page, el, text, newlineKey = 'Enter') {
  await el.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press(newlineKey);
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
}
const readText = (f) => {
  if (!fs.existsSync(f)) throw new Error(`ファイルがありません: ${f}`);
  return fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
};
const needFile = (f) => {
  const p = path.resolve(f);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error(`動画がありません: ${p}`);
  return p;
};

// ---------- ログイン（人が手でする） ----------
async function cmdLogin(site) {
  const urls = { youtube: 'https://www.youtube.com/', instagram: 'https://www.instagram.com/' };
  const list = site ? [urls[site]] : [urls.youtube, urls.instagram];
  const ctx = await openBrowser();
  for (let i = 0; i < list.length; i++) {
    const p = (i === 0 && ctx.pages()[0]) || (await ctx.newPage());
    await p.goto(list[i], { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  console.log(`Chrome を開きました。${site ? (site === 'youtube' ? 'YouTube' : 'Instagram') : 'YouTube と Instagram'} に手でログインしてください。`);
  console.log('終わったら Chrome のウィンドウを閉じてください（ログインは .poster-profile に残ります）。');
  await new Promise((r) => ctx.on('close', r));
  console.log('閉じました。');
}

const isLoginUrl = (u) => /accounts\.google\.com|ServiceLogin|instagram\.com\/accounts\/login/.test(u);
function assertLoggedIn(page, site) {
  if (isLoginUrl(page.url())) throw new Error(`${site} にログインしていません。先に node tools/poster/post.js login でログインしてください`);
}

// ---------- YouTube Studio ----------
async function cmdYoutube(page, [video, captionFile], flags) {
  const file = needFile(video);
  const { title, description } = L.youtubeText(readText(captionFile), flags.title);
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60 * SEC });
  await page.waitForLoadState('networkidle', { timeout: 30 * SEC }).catch(() => {});
  assertLoggedIn(page, 'YouTube');

  // 作成 → 動画をアップロード
  await clickFirst([page.locator('#create-icon'), page.getByRole('button', { name: /^(作成|Create)$/ })], '作成ボタン', 60 * SEC);
  await clickFirst([page.locator('#text-item-0'), page.getByRole('menuitem', { name: /動画をアップロード|Upload videos?/ })], '動画をアップロード');
  const dialog = page.locator('ytcp-uploads-dialog');
  const input = page.locator('ytcp-uploads-dialog input[type="file"], input[type="file"][name="Filedata"]').first();
  await input.waitFor({ state: 'attached', timeout: 60 * SEC });
  await input.setInputFiles(file);
  console.log('動画を送り始めました: ' + path.basename(file));

  // タイトルと説明
  const titleBox = await firstVisible([dialog.locator('#title-textarea #textbox'), page.getByRole('textbox', { name: /タイトル|title/i })], 'タイトル欄', 120 * SEC);
  await typeText(page, titleBox, title);
  const descBox = await firstVisible([dialog.locator('#description-textarea #textbox'), page.getByRole('textbox', { name: /説明|description/i })], '説明欄');
  await typeText(page, descBox, description);

  // 子ども向けではありません
  await clickFirst([
    dialog.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]'),
    page.getByRole('radio', { name: /子ども向けではありません|not made for kids/i }),
  ], '「子ども向けではありません」');

  // 次へ を 3 回（詳細 → 動画の要素 → チェック → 公開設定）
  for (let i = 0; i < 3; i++) {
    await clickFirst([dialog.locator('#next-button'), page.getByRole('button', { name: /^(次へ|Next)$/ })], `次へ（${i + 1} 回目）`, 60 * SEC);
    await sleep(1500);
  }

  // 公開設定
  const vis = flags.visibility;
  const visName = { private: /^(非公開|Private)$/, unlisted: /^(限定公開|Unlisted)$/, public: /^(公開|Public)$/ }[vis];
  await clickFirst([
    dialog.locator(`tp-yt-paper-radio-button[name="${vis.toUpperCase()}"]`),
    page.getByRole('radio', { name: visName }),
  ], `公開設定（${vis}）`, 60 * SEC);

  // 動画の URL
  let url = null;
  try {
    const a = await firstVisible([dialog.locator('.video-url-fadeable a'), dialog.locator('a[href*="youtu.be/"], a[href*="youtube.com/shorts/"], a[href*="watch?v="]')], '動画の URL', 120 * SEC);
    url = (await a.getAttribute('href')) || (await a.innerText());
  } catch (_) { /* URL が出ないこともある。保存はできる */ }

  if (flags.dryRun) {
    const f = await shot(page, 'youtube_dry-run');
    console.log(`ここで止めました（--dry-run）。保存は押していません。画像: ${f}`);
    if (url) console.log('（下書きの URL: ' + url + '）');
    console.log('この下書きは YouTube Studio のコンテンツに残ることがあります。要らなければ Studio で消してください。');
    return;
  }

  // アップロードが終わるまで待つ（途中でブラウザを閉じると止まるため）
  const progress = dialog.locator('.progress-label, ytcp-video-upload-progress .progress-label').first();
  const end = Date.now() + 60 * MIN;
  let last = '';
  while (Date.now() < end) {
    const s = await progress.innerText().catch(() => '');
    if (s !== last) { console.log('  ' + s.replace(/\s+/g, ' ')); last = s; }
    if (L.isUploadDone(s)) break;
    await sleep(3 * SEC);
  }
  if (!L.isUploadDone(last)) throw new Error('60 分たってもアップロードが終わりませんでした');

  await clickFirst([dialog.locator('#done-button'), page.getByRole('button', { name: /^(保存|公開|Save|Publish)$/ })], '保存ボタン');
  // 終わりの小窓（「動画を公開しました」など）を閉じる
  await maybeClick([page.getByRole('button', { name: /^(閉じる|Close)$/ }), page.locator('ytcp-video-share-dialog #close-button')], 30 * SEC);
  await shot(page, 'youtube_saved');
  console.log('保存しました（' + vis + '）');
  console.log(url ? 'URL: ' + url : 'URL は YouTube Studio のコンテンツで確かめてください');
}

// ---------- Instagram（リール） ----------
const igDialog = (page) => page.getByRole('dialog').last();
async function igHome(page) {
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60 * SEC });
  await page.waitForLoadState('networkidle', { timeout: 20 * SEC }).catch(() => {});
  assertLoggedIn(page, 'Instagram');
  if (await page.locator('input[name="password"]').count()) throw new Error('Instagram にログインしていません。先に node tools/poster/post.js login でログインしてください');
  // 「通知をオンにする」などの小窓は「後で」で閉じる
  await maybeClick([page.getByRole('button', { name: /^(後で|Not Now|Not now)$/ })], 3 * SEC);
}

async function cmdInstagram(page, [video, captionFile], flags) {
  const file = needFile(video);
  const caption = L.instagramCaption(readText(captionFile));
  await igHome(page);

  // 作成 → 投稿
  await clickFirst([
    page.locator('svg[aria-label="新規投稿"], svg[aria-label="New post"], svg[aria-label="作成"], svg[aria-label="Create"]').locator('xpath=ancestor::*[self::a or @role="link" or @role="button"][1]'),
    page.getByRole('link', { name: /^(作成|新規投稿|Create|New post)$/ }),
  ], '作成（＋）ボタン', 60 * SEC);
  await maybeClick([page.getByRole('link', { name: /^(投稿|Post)$/ }), page.getByRole('menuitem', { name: /^(投稿|Post)$/ }), page.locator('svg[aria-label="投稿"], svg[aria-label="Post"]').locator('xpath=ancestor::*[self::a or @role="link" or @role="button"][1]')], 5 * SEC);

  // ファイルを選ぶ（隠れた input に直接入れる。だめならファイル選択の窓で）
  const input = page.locator('div[role="dialog"] input[type="file"], form input[type="file"][accept*="video"]').first();
  try {
    await input.waitFor({ state: 'attached', timeout: 30 * SEC });
    await input.setInputFiles(file);
  } catch (_) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 30 * SEC }),
      clickFirst([page.getByRole('button', { name: /コンピューターから選択|Select from computer/ })], 'コンピューターから選択'),
    ]);
    await chooser.setFiles(file);
  }
  console.log('動画を選びました: ' + path.basename(file));
  // 「動画はリールとしてシェアされます」→ OK
  await maybeClick([page.getByRole('button', { name: /^OK$/ })], 8 * SEC);

  // 切り取り → 元の比率
  await clickFirst([
    page.locator('svg[aria-label="切り取りを選択"], svg[aria-label="Select crop"], svg[aria-label="切り取り"], svg[aria-label="Crop"]').locator('xpath=ancestor::*[@role="button" or self::button][1]'),
    page.getByRole('button', { name: /切り取りを選択|Select crop/ }),
  ], '切り取りボタン', 120 * SEC);
  await clickFirst([
    page.getByRole('button', { name: /^(元の比率|オリジナル|Original)$/ }),
    page.getByText(/^(元の比率|オリジナル|Original)$/),
  ], '「元の比率」');

  // 次へ を 2 回（切り取り → 編集 → キャプション）
  for (let i = 0; i < 2; i++) {
    await clickFirst([igDialog(page).getByRole('button', { name: /^(次へ|Next)$/ }), page.getByText(/^(次へ|Next)$/)], `次へ（${i + 1} 回目）`, 60 * SEC);
    await sleep(2 * SEC);
  }

  // キャプション
  const box = await firstVisible([
    page.locator('div[aria-label^="キャプションを入力"], div[aria-label^="Write a caption"]'),
    page.getByRole('textbox', { name: /キャプション|caption/i }),
  ], 'キャプション欄', 60 * SEC);
  await typeText(page, box, caption, 'Enter');

  const share = await firstVisible([igDialog(page).getByRole('button', { name: /^(シェア|Share)$/ }), page.getByText(/^(シェア|Share)$/)], 'シェアボタン');
  if (flags.dryRun) {
    const f = await shot(page, 'instagram_dry-run');
    console.log(`ここで止めました（--dry-run）。シェアは押していません。画像: ${f}`);
    return;
  }
  await share.click();
  await firstVisible([
    page.getByText(/リールがシェアされました|投稿がシェアされました|Your reel has been shared|Your post has been shared|Reel shared|Post shared/),
  ], 'シェア完了の表示', 20 * MIN);
  await shot(page, 'instagram_shared');
  console.log('シェアしました。プロフィールのリールで確かめてください。');
}

// ---------- コメントを読む ----------
async function cmdComments(page, [url], flags) {
  const out = path.resolve(ROOT, flags.out || 'data/inbox_comments.json');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60 * SEC });
  await page.waitForLoadState('networkidle', { timeout: 20 * SEC }).catch(() => {});
  assertLoggedIn(page, 'Instagram');
  await maybeClick([page.getByRole('button', { name: /^(後で|Not Now|Not now)$/ })], 3 * SEC);
  await firstVisible([page.locator('time[datetime]')], '投稿の日付（ページが開けていないかもしれません）', 60 * SEC);

  const MORE = /さらにコメントを読み込む|コメント.*をすべて見る|返信を表示|返信.*件を表示|Load more comments|View all .*comments|View replies|View more replies|View \d+ more repl/i;
  let lastCount = -1, still = 0;
  for (let round = 0; round < 80 && still < 4; round++) {
    // 「もっと見る」系を押す
    const btns = page.getByRole('button', { name: MORE }).or(page.locator('svg[aria-label="さらにコメントを読み込む"], svg[aria-label="Load more comments"]'));
    const n = await btns.count().catch(() => 0);
    for (let i = 0; i < n; i++) { try { const b = btns.nth(i); if (await b.isVisible()) await b.click({ timeout: 3 * SEC }); } catch (_) { /* 消えたものは飛ばす */ } }
    // コメントの入れ物をいちばん下まで動かす
    await page.evaluate(() => {
      const times = [...document.querySelectorAll('time[datetime]')];
      const last = times[times.length - 1];
      let el = last && last.parentElement;
      while (el && el !== document.body) { if (el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY)) { el.scrollTop = el.scrollHeight; break; } el = el.parentElement; }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await sleep(1500 + Math.random() * 1000);
    const c = await page.locator('time[datetime]').count();
    if (c === lastCount) still++; else { still = 0; lastCount = c; }
  }

  // time[datetime] ごとに、そのコメントのかたまりを探して、名前と本文を読む
  const raw = await page.evaluate(() => {
    const SKIP = /^(返信する|返信|いいね！?|いいね！\d+件|翻訳を見る|翻訳を表示|Reply|Like|\d+ likes?|See translation|View translation|Edited|編集済み|作成者|Author|•|·)$/i;
    const res = [];
    for (const t of document.querySelectorAll('time[datetime]')) {
      let box = t.parentElement, link = null;
      while (box && box !== document.body) {
        if (box.querySelectorAll('time[datetime]').length > 1) { box = null; break; }
        link = [...box.querySelectorAll('a[href^="/"]')].find((a) => { const slug = a.getAttribute('href').split('/').filter(Boolean); return slug.length === 1 && a.textContent.trim().replace(/^@/, '') === slug[0]; });
        if (link) break;
        box = box.parentElement;
      }
      if (!box || !link) continue;
      const username = link.textContent.trim();
      const lines = box.innerText.split('\n').map((s) => s.trim()).filter(Boolean)
        .filter((s) => s !== username && s !== t.textContent.trim() && !SKIP.test(s));
      res.push({ username, text: lines.join('\n'), time: t.getAttribute('datetime'), isCaption: !!box.querySelector('h1') });
    }
    return res;
  });
  const shaped = L.shapeComments(raw);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(shaped, null, 1) + '\n');
  console.log(`コメント ${shaped.length} 件を ${path.relative(ROOT, out)} に書きました（from.id にはユーザー名が入っています）`);
}

// ---------- DM ----------
async function cmdDm(page, [username, msgFile], flags) {
  const text = readText(msgFile).replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('メッセージが空です: ' + msgFile);
  const log = L.loadDmLog(fs.existsSync(DM_LOG) ? fs.readFileSync(DM_LOG, 'utf8') : '');
  const chk = L.dmCheck(log, username, Date.now());
  if (!chk.ok) throw Object.assign(new Error(chk.reason), { noShot: true });
  if (chk.waitMs > 0 && !flags.dryRun) {
    console.log(`前の DM から間をあけるため ${Math.ceil(chk.waitMs / SEC)} 秒待ちます…`);
    await sleep(chk.waitMs);
  }

  await igHome(page);
  await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded', timeout: 60 * SEC });
  await page.waitForLoadState('networkidle', { timeout: 20 * SEC }).catch(() => {});
  await maybeClick([page.getByRole('button', { name: /^(後で|Not Now|Not now)$/ })], 3 * SEC);
  // 新しいメッセージ
  await clickFirst([
    page.locator('svg[aria-label="新規メッセージ"], svg[aria-label="New message"]').locator('xpath=ancestor::*[@role="button" or self::button or self::a][1]'),
    page.getByRole('button', { name: /^(新規メッセージ|メッセージを送信|New message|Send message)$/ }),
  ], '新規メッセージボタン', 60 * SEC);
  const dlg = igDialog(page);
  const search = await firstVisible([dlg.getByRole('textbox'), dlg.locator('input[name="queryBox"], input[placeholder*="検索"], input[placeholder*="Search"]')], '宛先の検索欄');
  await search.click();
  await page.keyboard.insertText(username);
  // 検索結果から、ユーザー名がぴったり同じ人を選ぶ
  const exact = new RegExp(`(^|\\s)${username.replace(/[.]/g, '\\.')}(\\s|$)`, 'i');
  await clickFirst([
    dlg.getByRole('checkbox', { name: exact }),
    dlg.getByRole('button', { name: exact }),
    dlg.getByText(new RegExp(`^${username.replace(/[.]/g, '\\.')}$`, 'i')),
  ], `検索結果の @${username}`, 30 * SEC);
  await clickFirst([dlg.getByRole('button', { name: /^(チャット|次へ|Chat|Next)$/ }), dlg.getByText(/^(チャット|次へ|Chat|Next)$/)], 'チャットボタン');

  const box = await firstVisible([
    page.getByRole('textbox', { name: /メッセージ|Message/ }),
    page.locator('div[aria-label^="メッセージ"][contenteditable="true"], div[aria-label^="Message"][contenteditable="true"]'),
  ], 'メッセージ欄', 60 * SEC);
  await typeText(page, box, text, 'Shift+Enter'); // Enter だと途中で送られるので、改行は Shift+Enter
  if (flags.dryRun) {
    const f = await shot(page, 'dm_dry-run');
    console.log(`ここで止めました（--dry-run）。送っていません（記録もしていません）。画像: ${f}`);
    return;
  }
  await page.keyboard.press('Enter');
  await sleep(3 * SEC);
  L.dmRecord(log, username, Date.now());
  fs.writeFileSync(DM_LOG, JSON.stringify(log, null, 1) + '\n');
  await shot(page, 'dm_sent');
  console.log(`@${username} に送りました（今日 ${chk.today + 1} 件目）。次は ${new Date(log.nextAt).toLocaleTimeString('ja-JP')} 以降に送れます`);
}

// ---------- 入口 ----------
async function main() {
  let parsed;
  try { parsed = L.parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const { cmd, args, flags } = parsed;
  if (cmd === 'login') return cmdLogin(args[0]);
  // ブラウザを開く前に、ファイルや DM の記録を確かめる（むだに Chrome を開かない）
  if (cmd === 'youtube' || cmd === 'instagram') { needFile(args[0]); readText(args[1]); }
  if (cmd === 'dm') {
    readText(args[1]);
    const log = L.loadDmLog(fs.existsSync(DM_LOG) ? fs.readFileSync(DM_LOG, 'utf8') : '');
    const chk = L.dmCheck(log, args[0], Date.now());
    if (!chk.ok) { console.error(chk.reason); process.exit(1); }
  }
  const ctx = await openBrowser();
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30 * SEC);
  try {
    await { youtube: cmdYoutube, instagram: cmdInstagram, comments: cmdComments, dm: cmdDm }[cmd](page, args, flags);
  } catch (e) {
    const f = e.noShot ? null : await shot(page, `error_${cmd}`);
    console.error(`失敗しました（${cmd}）: ${e.message.split('\n')[0]}`);
    if (f) console.error('そのときの画面: ' + f);
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
