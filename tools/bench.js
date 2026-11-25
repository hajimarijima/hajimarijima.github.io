#!/usr/bin/env node
'use strict';
// 何人まで参加できるかを測る（本物の data/ はさわらない。作業用フォルダに町を作る）。
// 使い方: node tools/bench.js --out <作業用フォルダ> [--n 50,100,300] [--days 3] [--no-browser] [--mobile] [--reuse]
//   --mobile：スマホの画面（390×844・3 倍・指）で、はじめから CPU 4 倍の制限をかけて、開くまでの時間とコマ数を測る
//   --reuse：作業用フォルダにもう町があれば、作り直さずに使う（画面だけ測り直す）
// 測る物：1 日分の sim の時間・data/*.json の大きさ・サイトを開くまでの時間・町の画面のコマ数（そのまま／CPU 4 倍制限）
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const P = require('./people');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out');
if (!OUT) { console.error('--out <作業用フォルダ> を付けてください'); process.exit(1); }
const NS = String(arg('--n', '50,100,300,1000,3000,10000')).split(',').map(Number);
const DAYS = Number(arg('--days', 3));
const EDGE = process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // Chrome（Edge のヘッドレスはこの環境では起動しない）
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/json' };

const MOBILE = process.argv.includes('--mobile'), REUSE = process.argv.includes('--reuse');
function makeTown(n) {
  const dir = path.join(OUT, 'n' + n);
  if (REUSE && fs.existsSync(path.join(dir, 'state.json'))) return { dir, reused: true };
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env, stdio: 'ignore' });
  // 見本の 20 人に足して、n 人まで（名前は「村人N」）。参加日は 1 日目
  const vf = path.join(dir, 'villagers.json');
  const villagers = JSON.parse(fs.readFileSync(vf, 'utf8'));
  for (let i = villagers.length; i < n; i++) P.upsertVillager(villagers, { username: '村人' + (i + 1), joined: '2026-11-01', joinedDay: 1, source: 'demo' }, new Set());
  villagers.length = Math.min(villagers.length, n);
  fs.writeFileSync(vf, JSON.stringify(villagers, null, 1) + '\n');
  const times = [];
  for (let d = 0; d < DAYS; d++) {
    const t0 = process.hrtime.bigint();
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo'], { env, stdio: 'ignore', timeout: 30 * 60e3, maxBuffer: 1 << 26 });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const sizes = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) sizes[f] = fs.statSync(path.join(dir, f)).size;
  return { dir, simMs: times, sizes, total: Object.values(sizes).reduce((a, b) => a + b, 0) };
}

function serve(dataDir) {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const p = u.startsWith('/data/') ? path.join(dataDir, u.slice(6)) : path.normalize(path.join(ROOT, u === '/' ? '/index.html' : u));
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory() || /sw\.js$/.test(p)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function browse(dataDir, puppeteer) {
  const srv = await serve(dataDir);
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', userDataDir: fs.mkdtempSync(path.join(require('os').tmpdir(), 'town-bench-')), args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--no-first-run', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const out = {};
  try {
    const page = await browser.newPage();
    if (MOBILE) {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const c0 = await page.target().createCDPSession(); await c0.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    } else await page.setViewport({ width: 1280, height: 800 });
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?time=day`, { waitUntil: 'load', timeout: 300e3 });
    out.loadMs = Date.now() - t0;
    await page.waitForFunction(() => window.TOWN && window.TOWN.people, { timeout: 600e3, polling: 200 });
    out.readyMs = Date.now() - t0;
    out.timing = await page.evaluate(() => window.TOWN.timing);
    out.gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
    const fps = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
    await new Promise((r) => setTimeout(r, 2000));
    if (MOBILE) { out.fps4x = +(await fps()).toFixed(1); out.lite = await page.evaluate(() => window.TOWN.lite); }
    else {
      out.fps = +(await fps()).toFixed(1);
      const cdp = await page.target().createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      out.fps4x = +(await fps()).toFixed(1);
    }
    out.firstMB = await page.evaluate(() => +(performance.getEntriesByType('resource').filter((e) => /\/data\//.test(e.name)).reduce((a, e) => a + (e.encodedBodySize || e.transferSize || 0), 0) / 1048576).toFixed(2));
    out.heapMB = +((await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0))) / 1048576).toFixed(0);
  } catch (e) { out.error = e.message.slice(0, 200); }
  await browser.close(); srv.close();
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const puppeteer = process.argv.includes('--no-browser') ? null : require('puppeteer-core');
  const rows = [];
  for (const n of NS) {
    const r = { n, ...makeTown(n) };
    if (puppeteer) Object.assign(r, await browse(r.dir, puppeteer));
    delete r.dir;
    rows.push(r);
    console.log(JSON.stringify(r));
    fs.writeFileSync(path.join(OUT, 'bench.json'), JSON.stringify(rows, null, 1));
  }
})();
