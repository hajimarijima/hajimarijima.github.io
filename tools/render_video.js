#!/usr/bin/env node
'use strict';
// video/reel.html をヘッドレスの Edge で開いて 1 コマずつ書き出し、音を作って mp4 にまとめる。
//   node tools/render_video.js            … ぜんぶ作る（video/town_reel.mp4）
//   node tools/render_video.js --stills 1,5,9.5   … その秒のコマだけ video/check/ に書く
//   --page video/part1.html --name part1_day0 --maxmb 9.5 … 別のリール（軽い版は <name>_720p.mp4、maxmb MB 未満）
//   --gpu … Chrome の GPU で描く（速い）。--sheet 10 … 確かめ用のコマ一覧（<name>_コマ一覧.jpg、10 コマ）
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
const PAGE = arg('--page') || 'video/reel.html';
const NAME = arg('--name') || 'town_reel';
const LITE_NAME = arg('--name') ? NAME + '_720p' : 'town_reel_軽量';
const MAXMB = Number(arg('--maxmb')) || 27;
const GPU = process.argv.includes('--gpu');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const FRAMES = path.join(VIDEO, NAME === 'town_reel' ? 'frames' : 'frames_' + NAME);
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
  // BGM：南の島ふうの明るい曲（スチールドラムの旋律・ウクレレの裏打ち・はずむベース・シェイカー・クラーベ）
  const bpm = 116, beat = 60 / bpm, e8 = beat / 2;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const chords = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74], [60, 64, 67]]; // C F G C Am F G C
  const _ = null;
  const melody = [
    [72, _, 76, 79, _, 76, 74, 72], [77, _, 77, 76, 74, _, 72, _], [74, _, 79, 77, 74, _, 71, 74], [72, _, _, 67, 72, _, 76, _],
    [76, _, 76, 79, 81, _, 79, 76], [77, _, 76, 74, 72, _, 74, _], [79, _, 77, 74, 71, 74, _, 79], [84, _, 79, _, 76, _, 72, _],
  ];
  const tone = (t0, len, fn) => { const s0 = Math.floor(t0 * SR), m = Math.floor(len * SR); for (let k = 0; k < m; k++) fn(s0 + k, k / SR); };
  // スチールドラム：基音・1 オクターブ上・その上の 5 度が強く、すばやく立ち上がって鳴りが残る
  const steel = (t0, f, amp, pan) => tone(t0, 1.3, (i, tt) => {
    const env = Math.min(1, tt / 0.004) * Math.exp(-tt * 3.6), w = 2 * Math.PI * f * tt;
    add(i, amp * env * (Math.sin(w) + 0.55 * Math.sin(2 * w) * Math.exp(-tt * 2) + 0.28 * Math.sin(3.01 * w) * Math.exp(-tt * 5) + 0.12 * Math.sin(4.2 * w) * Math.exp(-tt * 9)), pan);
  });
  // ウクレレ：高い 3 音を少しずらして「ちゃっ」と短く
  const uke = (t0, ch, amp) => ch.forEach((m, j) => tone(t0 + j * 0.011, 0.22, (i, tt) => {
    const f = midi(m), env = Math.min(1, tt / 0.003) * Math.exp(-tt * 16), w = 2 * Math.PI * f * tt;
    add(i, amp * env * (Math.sin(w) + 0.45 * Math.sin(2 * w) + 0.2 * Math.sin(3 * w)), 0.3);
  }));
  const bass = (t0, f, amp, len) => tone(t0, len, (i, tt) => {
    const env = Math.min(1, tt / 0.006) * Math.exp(-tt * 4.5) * Math.min(1, (len - tt) / 0.03), w = 2 * Math.PI * f * tt;
    add(i, amp * env * (Math.sin(w) + 0.25 * Math.sin(2 * w)), 0);
  });
  // 太いキック（低く沈む「ドゥン」）と、長く響く重低音（808 ふう）
  const kick = (t0, amp) => { let ph = 0; tone(t0, 0.45, (i, tt) => { ph += 2 * Math.PI * (42 + 110 * Math.exp(-tt * 28)) / SR; add(i, amp * Math.tanh(1.6 * Math.sin(ph)) * Math.exp(-tt * 7), 0); }); };
  const sub = (t0, f, amp, len) => { let ph = 0; tone(t0, len, (i, tt) => { ph += 2 * Math.PI * f * (1 + 0.5 * Math.exp(-tt * 40)) / SR; const env = Math.min(1, tt / 0.005) * Math.exp(-tt * 1.8) * Math.min(1, (len - tt) / 0.05); add(i, amp * env * Math.tanh(1.4 * Math.sin(ph)), 0); }); };
  const clave = (t0, amp) => tone(t0, 0.1, (i, tt) => add(i, amp * Math.sin(2 * Math.PI * 820 * tt) * Math.exp(-tt * 45), -0.35)); // 木のブロック（低め）
  const shaker = (t0, amp) => { let prev = 0; tone(t0, 0.07, (i, tt) => { const x = noise(), h = x - prev; prev = x; add(i, amp * h * Math.min(1, tt / 0.01) * Math.exp(-tt * 55), 0.4); }); };
  const claveSlots = [0, 3, 6, 10, 12]; // 3-2 のクラーベ（2 小節＝16 の 8 分音符の中で）
  for (let bar = 0; bar * 4 * beat < duration; bar++) {
    const t0 = bar * 4 * beat, ch = chords[bar % 8], root = ch[0] % 12 + 36;
    // ベース：1 拍目に根音、2 拍目の裏に 5 度、3 拍目に根音、4 拍目の裏に 1 オクターブ上（カリプソのはずみ）
    bass(t0, midi(root), 0.11, e8 * 2.6); bass(t0 + e8 * 3, midi(root + 7), 0.09, e8 * 1.0);
    bass(t0 + e8 * 4, midi(root), 0.1, e8 * 2.6); bass(t0 + e8 * 7, midi(root + 12), 0.08, e8 * 0.9);
    kick(t0, 0.34); kick(t0 + e8 * 3, 0.22); kick(t0 + beat * 2, 0.3);
    sub(t0, midi(root - 12), 0.2, beat * 1.45); sub(t0 + e8 * 3, midi(root - 12), 0.15, beat * 0.95); sub(t0 + beat * 2, midi(root - 12), 0.18, beat * 1.9);
    for (let b = 0; b < 4; b++) uke(t0 + b * beat + e8, ch, 0.03); // 裏打ち
    for (let s = 0; s < 8; s++) shaker(t0 + s * e8, 0.025); // シェイカーは小さく（高い音をおさえる）
    for (const c of claveSlots) { const s = c - (bar % 2) * 8; if (s >= 0 && s < 8) clave(t0 + s * e8, 0.05); }
    if (bar < 1) continue; // 最初の 1 小節は伴奏だけ
    const mel = melody[(bar - 1) % 8];
    for (let b = 0; b < 8; b++) if (mel[b]) steel(t0 + b * e8, midi(mel[b] - 12), 0.08, b % 2 ? 0.15 : -0.15); // 旋律は 1 オクターブ下げる
  }
  // 木を切る音（こもった「コン」）と、岩を掘る音（かたい「カン」）
  for (const e of sfx) {
    const s0 = Math.floor(e.t * SR), pan = ((e.t * 7.3) % 1 - 0.5) * 0.4;
    if (e.type === 'pop') {
      // 名札や絵が出る「ぽん」：高さが上がる短い音
      for (let k = 0; k < SR * 0.16; k++) { const tt = k / SR, f = 300 + 400 * tt / 0.16; add(s0 + k, 0.22 * e.gain * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 26), pan); }
      continue;
    }
    if (e.type === 'chime') {
      // 予告の「きらん」：3 つの高い音を少しずつずらして
      [523.25, 659.25, 784].forEach((f, j) => { const o = Math.floor(j * 0.07 * SR); for (let k = 0; k < SR * 1.2; k++) { const tt = k / SR; add(s0 + o + k, 0.12 * e.gain * (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt)) * Math.exp(-tt * 3.5), (j - 1) * 0.3); } });
      continue;
    }
    if (e.type === 'whoosh') {
      // 風の「ひゅう」：ゆっくり大きくなって消える、こもった雑音
      let lp = 0; const len = SR * 1.6;
      for (let k = 0; k < len; k++) { const tt = k / len; lp += (noise() - lp) * (0.02 + 0.05 * tt); add(s0 + k, 0.5 * e.gain * lp * Math.sin(Math.PI * tt), Math.sin(tt * 3) * 0.4); }
      continue;
    }
    if (e.type === 'chop') {
      let lp = 0;
      for (let k = 0; k < SR * 0.25; k++) {
        const tt = k / SR; lp += (noise() - lp) * 0.08;
        add(s0 + k, 0.30 * e.gain * (Math.sin(2 * Math.PI * 170 * tt * (1 - tt)) * Math.exp(-tt * 28) + lp * 2.2 * Math.exp(-tt * 40)), pan);
      }
    } else {
      for (let k = 0; k < SR * 0.35; k++) {
        const tt = k / SR;
        add(s0 + k, 0.17 * e.gain * ((Math.sin(2 * Math.PI * 520 * tt) + 0.5 * Math.sin(2 * Math.PI * 780 * tt)) * Math.exp(-tt * 18) + noise() * 0.3 * Math.exp(-tt * 70)), pan);
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
  const out = path.join(VIDEO, NAME + '.mp4');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(info.FPS), '-i', path.join(FRAMES, '%05d.jpg'), '-i', path.join(VIDEO, 'audio.wav'),
    '-vf', 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(info.FPS), '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('できました: ' + out);
  // 軽い版（30MB 未満。送ったり上げたりしやすい）：720p（720×1280）・crf 28。念のためビットレートの上限もつける
  const lite = path.join(VIDEO, LITE_NAME + '.mp4');
  const kbps = Math.max(800, Math.min(3200, Math.floor(((MAXMB * 0.92) * 8 * 1024) / info.DURATION) - 128));
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', out, '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-maxrate', kbps + 'k', '-bufsize', kbps * 2 + 'k',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', lite], { stdio: 'inherit' });
  console.log('軽い版: ' + lite + `（${(fs.statSync(lite).size / 1048576).toFixed(1)} MB）`);
  return out;
}

// --serve <port>：ブラウザ（reel.html?send=1）からコマを受け取って書く。ヘッドレスが動かない環境向け
if (process.argv.includes('--serve')) {
  const port = Number(arg('--serve')) || 8091;
  const frames = FRAMES;
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
  const browser = await puppeteer.launch(GPU ? { executablePath: CHROME, headless: 'new', userDataDir: fs.mkdtempSync(path.join(require('os').tmpdir(), 'town-chrome-')), args: ['--no-sandbox', '--ignore-gpu-blocklist', '--no-first-run', '--mute-audio'] } : { executablePath: EDGE, headless: 'new', dumpio: !!process.env.DUMPIO, userDataDir: fs.mkdtempSync(path.join(require('os').tmpdir(), 'town-edge-')), args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--mute-audio'] });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
    page.on('pageerror', (e) => console.log('[page error]', e.message));
    await page.setViewport({ width: 400, height: 700 });
    await page.goto(`http://127.0.0.1:${port}/${PAGE}`, { waitUntil: 'load' });
    await page.waitForFunction('window.REEL && window.REEL.ready', { timeout: 60000 });
    const info = await page.evaluate(() => ({ ...window.REEL, sfx: window.SFX }));
    const grab = async (t, q = 0.92) => {
      const url = await page.evaluate((tt, qq) => { window.renderFrame(tt); return document.getElementById('out').toDataURL('image/jpeg', qq); }, t, q);
      return Buffer.from(url.split(',')[1], 'base64');
    };
    // --audio-only：コマはそのまま（前に書き出した物を使う）で、音だけ作り直して mp4 にまとめ直す
    if (process.argv.includes('--audio-only')) { encode(info); return; }
    const stills = arg('--stills');
    if (stills) {
      const dir = path.join(VIDEO, 'check'); fs.mkdirSync(dir, { recursive: true });
      for (const s of stills.split(',')) { fs.writeFileSync(path.join(dir, `t${String(s).replace('.', '_')}.jpg`), await grab(Number(s), 0.85)); }
      console.log(`${stills.split(',').length} コマを video/check/ に書きました`);
      return;
    }
    const sheetN = Number(arg('--sheet'));
    if (sheetN) {
      // 確かめ用のコマ一覧：等間隔の sheetN コマを 5 列に並べる（1 コマ 216×384）
      const dir = path.join(VIDEO, 'check_' + NAME); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const ts = Array.from({ length: sheetN }, (_, i) => +(((i + 0.5) / sheetN) * info.DURATION).toFixed(2));
      for (const [i, s] of ts.entries()) fs.writeFileSync(path.join(dir, String(i).padStart(2, '0') + '.jpg'), await grab(s, 0.85));
      const cols = 5, rows = Math.ceil(sheetN / cols);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(dir, '%02d.jpg'), '-vf', `scale=324:576,tile=${cols}x${rows}:padding=8:color=0x222222`, '-frames:v', '1', '-q:v', '3', path.join(VIDEO, NAME + '_コマ一覧.jpg')]);
      console.log('コマ一覧: ' + path.join(VIDEO, NAME + '_コマ一覧.jpg') + '（' + ts.join(', ') + ' 秒）');
      return;
    }
    const frames = FRAMES;
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
