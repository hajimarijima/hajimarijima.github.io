#!/usr/bin/env node
'use strict';
// 投稿アプリのブラウザを使わない部分を確かめる。使い方: node tools/poster/test_app.js
const assert = require('assert');
const C = require('./app/core');
const L = require('./lib');

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('OK  ' + name); };

t('このパソコンからの通信だけ通す（Host も見る）', () => {
  assert.ok(C.isAllowedRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:5000', port: 5000 }));
  assert.ok(C.isAllowedRequest({ remoteAddress: '::ffff:127.0.0.1', host: 'localhost:5000', port: 5000 }));
  assert.ok(!C.isAllowedRequest({ remoteAddress: '192.168.1.5', host: '127.0.0.1:5000', port: 5000 }), 'よそのパソコン');
  assert.ok(!C.isAllowedRequest({ remoteAddress: '127.0.0.1', host: 'evil.example:5000', port: 5000 }), '名前の付けかえ');
  assert.ok(!C.isAllowedRequest({ remoteAddress: '127.0.0.1', host: '127.0.0.1:5001', port: 5000 }));
  assert.ok(!C.isAllowedRequest({ remoteAddress: '127.0.0.1', host: undefined, port: 5000 }));
});

t('投稿の入力 → post.js の引数（試し・公開設定・タイトル）', () => {
  const v = 'D:\\VoiceStudio\\town\\video\\out.mp4';
  let s = C.buildPostSteps({ video: v, youtube: true, instagram: true, visibility: 'unlisted', title: ' たいとる ', dryRun: true }, 'cap.txt');
  assert.deepStrictEqual(s, [
    ['youtube', v, 'cap.txt', '--visibility', 'unlisted', '--title', 'たいとる', '--dry-run'],
    ['instagram', v, 'cap.txt', '--dry-run'],
  ]);
  s = C.buildPostSteps({ video: v, instagram: true }, 'cap.txt');
  assert.deepStrictEqual(s, [['instagram', v, 'cap.txt']]);
  s = C.buildPostSteps({ video: v, youtube: true }, 'cap.txt');
  assert.deepStrictEqual(s, [['youtube', v, 'cap.txt', '--visibility', 'private']], '既定は非公開');
  assert.throws(() => C.buildPostSteps({ video: v }, 'cap.txt'), /1 つ以上/);
  assert.throws(() => C.buildPostSteps({ video: 'out.mp4', youtube: true }, 'cap.txt'), /動画/);
  assert.throws(() => C.buildPostSteps({ video: 'D:\\a.txt', youtube: true }, 'cap.txt'), /動画/);
  assert.throws(() => C.buildPostSteps({ video: v, youtube: true, visibility: 'everyone' }, 'cap.txt'));
});

t('ログイン・コメント・DM の引数', () => {
  assert.deepStrictEqual(C.buildLoginSteps('youtube'), [['login', 'youtube']]);
  assert.deepStrictEqual(C.buildLoginSteps(), [['login']]);
  assert.throws(() => C.buildLoginSteps('tiktok'));
  assert.deepStrictEqual(C.buildCommentSteps(' https://www.instagram.com/p/Abc1/ ', 'o.json'), [['comments', 'https://www.instagram.com/p/Abc1/', '--out', 'o.json']]);
  assert.throws(() => C.buildCommentSteps('https://example.com/', 'o.json'));
  assert.deepStrictEqual(C.buildDmSteps('@hana', 'm.txt', true), [['dm', '@hana', 'm.txt', '--dry-run']]);
  assert.throws(() => C.buildDmSteps('bad name', 'm.txt'));
  assert.strictEqual(L.parseArgs(['login', 'instagram']).args[0], 'instagram');
});

t('DM の記録 → 画面（新しい順・今日の残り・次に送れる時刻）', () => {
  const t0 = Date.parse('2026-11-25T01:00:00Z');
  const log = L.emptyDmLog();
  L.dmRecord(log, 'old', Date.parse('2026-11-24T01:00:00Z'), () => 0);
  L.dmRecord(log, 'a', t0, () => 0);
  L.dmRecord(log, 'b', t0 + 60e3, () => 0);
  let s = C.dmSummary(log, t0 + 61e3);
  assert.deepStrictEqual(s.sent.map((x) => x.username), ['b', 'a', 'old']);
  assert.strictEqual(s.today, 2); assert.strictEqual(s.remaining, 18); assert.strictEqual(s.max, 20);
  assert.strictEqual(s.nextAt, new Date(t0 + 100e3).toISOString());
  s = C.dmSummary(log, t0 + 200e3);
  assert.strictEqual(s.nextAt, null, '過ぎたら出さない');
});

t('窓が閉じたら・使われなければ止まる（動いている間は止まらない）', () => {
  const base = { startedMs: 0, lastBeatMs: 0, byeMs: 0, running: false };
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 60e3 }), false, '開くまで待つ');
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 200e3 }), true, '窓が開かなかった');
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 100e3, lastBeatMs: 80e3 }), false);
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 130e3, lastBeatMs: 80e3 }), true, '合図が来ない');
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 95e3, lastBeatMs: 80e3, byeMs: 85e3 }), true, '閉じた');
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 95e3, lastBeatMs: 90e3, byeMs: 85e3 }), false, '読み直しは閉じたことにしない');
  assert.strictEqual(C.shouldExit({ ...base, nowMs: 999e3, lastBeatMs: 1, byeMs: 2, running: true }), false, '仕事中は止まらない');
});

console.log(`\nぜんぶ通りました（${ok} 件）`);
