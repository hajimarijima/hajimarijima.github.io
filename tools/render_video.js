#!/usr/bin/env node
'use strict';
// video/reel.html をヘッドレスの Edge で開いて 1 コマずつ書き出し、音を作って mp4 にまとめる。
//   node tools/render_video.js            … ぜんぶ作る（video/town_reel.mp4）
//   node tools/render_video.js --stills 1,5,9.5   … その秒のコマだけ video/check/ に書く
// 環境変数 EDGE_PATH / FFMPEG_PATH で場所を変えられる。
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const VIDEO = path.join(ROOT, 'video');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// ffmpeg：環境変数 → winget で入れた場所 → PATH の順にさがす
const FFMPEG = process.env.FFMPEG_PATH || (() => {
  const homes = [require('os').homedir()];
  try { for (const u of fs.readdirSync('C:\\Users')) homes.push(path.join('C:\\Users', u)); } catch { /* なし */ }
  for (const h of homes) {
    const pk = path.join(h, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('Gyan.FFmpeg'))) {
        for (const e of fs.readdirSync(path.join(pk, d))) { const f = path.join(pk, d, e, 'bin', 'ffmpeg.exe'); if (fs.existsSync(f)) return f; }
      }
    } catch { /* なければ次 */ }
  }
  return 'ffmpeg';
})();
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ---------- 音 ----------
const SR = 44100;
function synth(duration, sfx) {
  const n = Math.ceil(duration * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let seed = 12345; const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const add = (i, v, pan = 0) => { if (i >= 0 && i < n) { L[i] += v * (1 - pan) ; R[i] += v * (1 + pan); } };
  // BGM：ゆっくりのペンタトニックのつま弾き＋やわらかい和音
  const bpm = 84, beat = 60 / bpm;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]; // C Am F G
  const melody = [72, 74, 76, 79, 76, 74, 72, 69, 72, 74, 76, 74, 72, 69, 67, 69];
  const pluck = (t0, f, amp, len, pan) => {
    const s0 = Math.floor(t0 * SR), m = Math.floor(len * SR);
    for (let k = 0; k < m; k++) {
      const tt = k / SR, env = Math.min(1, tt / 0.008) * Math.exp(-tt * 3.2);
      add(s0 + k, amp * env * (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt) + 0.1 * Math.sin(6 * Math.PI * f * tt)), pan);
    }
  };
  const pad = (t0, f, amp, len) => {
    const s0 = Math.floor(t0 * SR), m = Math.floor(len * SR);
    for (let k = 0; k < m; k++) {
      const tt = k / SR, env = Math.min(1, tt / 0.6) * Math.min(1, (len - tt) / 0.6);
      add(s0 + k, amp * env * (Math.sin(2 * Math.PI * f * tt) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * tt)) * 0.5, 0);
    }
  };
  for (let bar = 0; bar * 4 * beat < duration; bar++) {
    const t0 = bar * 4 * beat, ch = chords[bar % 4];
    for (const m of ch) pad(t0, midi(m - 12), 0.035, 4 * beat + 0.3);
    pluck(t0, midi(ch[0] - 24), 0.09, 2.5, 0);
    for (let b = 0; b < 8; b++) {
      if ((bar * 8 + b) % 3 === 2) continue;
      pluck(t0 + b * beat / 2, midi(melody[(bar * 8 + b) % melody.length]), 0.045, 1.4, b % 2 ? 0.25 : -0.25);
    }
  }
  // 木を切る音（こもった「コン」）と、岩を掘る音（かたい「カン」）
  for (const e of sfx) {
    const s0 = Math.floor(e.t * SR), pan = ((e.t * 7.3) % 1 - 0.5) * 0.4;
    if (e.type === 'chop') {
      let lp = 0;
      for (let k = 0; k < SR * 0.25; k++) {
        const tt = k / SR; lp += (noise() - lp) * 0.08;
        add(s0 + k, 0.30 * e.gain * (Math.sin(2 * Math.PI * 170 * tt * (1 - tt)) * Math.exp(-tt * 28) + lp * 2.2 * Math.exp(-tt * 40)), pan);
      }
    } else {
      for (let k = 0; k < SR * 0.35; k++) {
        const tt = k / SR;
        add(s0 + k, 0.17 * e.gain * ((Math.sin(2 * Math.PI * 1180 * tt) + 0.6 * Math.sin(2 * Math.PI * 1730 * tt)) * Math.exp(-tt * 18) + noise() * 0.7 * Math.exp(-tt * 70)), pan);
      }
    }
  }
  // 始めと終わりをなめらかに
  for (let i = 0; i < n; i++) {
    const t = i / SR, g = Math.min(1, t / 0.8, (duration - t) / 1.6);
    L[i] *= g; R[i] *= g;
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), 46 + i * 4);
  }
  return buf;
}

function encode(info) {
  fs.writeFileSync(path.join(VIDEO, 'audio.wav'), synth(info.DURATION, info.sfx));
  const out = path.join(VIDEO, 'town_reel.mp4');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(info.FPS), '-i', path.join(VIDEO, 'frames', '%05d.jpg'), '-i', path.join(VIDEO, 'audio.wav'),
    '-vf', 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(info.FPS), '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('できました: ' + out);
  return out;
}

// --serve <port>：ブラウザ（reel.html?send=1）からコマを受け取って書く。ヘッドレスが動かない環境向け
if (process.argv.includes('--serve')) {
  const port = Number(arg('--serve')) || 8091;
  const frames = path.join(VIDEO, 'frames');
  const body = (req) => new Promise((res) => { const a = []; req.on('data', (c) => a.push(c)); req.on('end', () => res(Buffer.concat(a))); });
  const base = http.createServer(async (req, rsp) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST') {
      const buf = await body(req);
      try {
        if (u.pathname === '/__start') { fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true }); }
        else if (u.pathname === '/__frame') fs.writeFileSync(path.join(frames, String(Number(u.searchParams.get('f'))).padStart(5, '0') + '.jpg'), buf);
        else if (u.pathname === '/__still') { const dir = path.join(VIDEO, 'check'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, u.searchParams.get('name').replace(/[^\w.-]/g, '_') + '.jpg'), buf); }
        else if (u.pathname === '/__done') encode(JSON.parse(buf.toString('utf8')));
        rsp.writeHead(200); return rsp.end('ok');
      } catch (e) { console.error(e); rsp.writeHead(500); return rsp.end(String(e.message)); }
    }
    const p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
    rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(p).pipe(rsp);
  });
  base.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/video/reel.html で待っています`));
  return;
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', dumpio: !!process.env.DUMPIO, userDataDir: fs.mkdtempSync(path.join(require('os').tmpdir(), 'town-edge-')), args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--mute-audio'] });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
    page.on('pageerror', (e) => console.log('[page error]', e.message));
    await page.setViewport({ width: 400, height: 700 });
    await page.goto(`http://127.0.0.1:${port}/video/reel.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.REEL && window.REEL.ready', { timeout: 60000 });
    const info = await page.evaluate(() => ({ ...window.REEL, sfx: window.SFX }));
    const grab = async (t, q = 0.92) => {
      const url = await page.evaluate((tt, qq) => { window.renderFrame(tt); return document.getElementById('out').toDataURL('image/jpeg', qq); }, t, q);
      return Buffer.from(url.split(',')[1], 'base64');
    };
    const stills = arg('--stills');
    if (stills) {
      const dir = path.join(VIDEO, 'check'); fs.mkdirSync(dir, { recursive: true });
      for (const s of stills.split(',')) { fs.writeFileSync(path.join(dir, `t${String(s).replace('.', '_')}.jpg`), await grab(Number(s), 0.85)); }
      console.log(`${stills.split(',').length} コマを video/check/ に書きました`);
      return;
    }
    const frames = path.join(VIDEO, 'frames');
    fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
    const total = Math.round(info.DURATION * info.FPS);
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      fs.writeFileSync(path.join(frames, String(f).padStart(5, '0') + '.jpg'), await grab(f / info.FPS));
      if (f % 150 === 0) console.log(`コマ ${f}/${total}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
    }
    encode(info);
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
