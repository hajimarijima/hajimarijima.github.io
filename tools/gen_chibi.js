#!/usr/bin/env node
'use strict';
// 2 頭身の見本の画像を作る: node tools/gen_chibi.js → video/2頭身の見本.png
// video/chibi.html をヘッドレスの Chrome で開いて、絵を描いたキャンバスをそのまま保存する
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');
const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, rsp) => {
  const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
  rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(rsp);
});
srv.listen(0, '127.0.0.1', async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: fs.mkdtempSync(path.join(require('os').tmpdir(), 'town-chibi-')), args: ['--no-sandbox', '--ignore-gpu-blocklist'] });
  try {
    const pg = await b.newPage();
    pg.on('pageerror', (e) => console.log('[page error]', e.message)); pg.on('console', (m) => console.log('[page]', m.text())); pg.on('requestfailed', (r) => console.log('[req]', r.url()));
    await pg.setViewport({ width: 1800, height: 1300 });
    await pg.goto(`http://127.0.0.1:${srv.address().port}/video/chibi.html`, { waitUntil: 'load' });
    await pg.waitForFunction('window.DONE', { timeout: 60000 });
    const data = await pg.evaluate(() => document.getElementById('out').toDataURL('image/png'));
    const dst = path.join(ROOT, 'video', '2頭身の見本.png');
    fs.writeFileSync(dst, Buffer.from(data.split(',')[1], 'base64'));
    console.log('2頭身の見本: ' + dst);
  } finally { await b.close(); srv.close(); }
});
