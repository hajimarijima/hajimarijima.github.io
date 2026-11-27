'use strict';
// 遊ぶの宝探し（金属探知機）：js/play/rules.js の treasureSpot・beepInterval・beepPitch・detectWord と、js/play/detector.js。tests/run_tests.js から読む
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = function treasureTests({ at, t, ROOT }) {
  const imp = (f) => import(require('url').pathToFileURL(path.join(ROOT, f)).href);

  at('宝探し：ピッの間は近いほど短く・高く、すぐそばはほぼ続けて鳴る。言葉に数字を出さない', async () => {
    const R = await imp('js/play/rules.js');
    const D = R.DETECT;
    let prevMs = -1, prevHz = 1e9;
    for (let d = 0; d <= 24; d += 0.5) {
      const ms = R.beepInterval(d), hz = R.beepPitch(d);
      assert.ok(ms >= prevMs && hz <= prevHz, '遠いほど間が長く・低い：' + d);
      assert.ok(ms >= D.minMs && ms <= D.maxMs && hz >= D.lowHz && hz <= D.highHz);
      assert.ok(!/[0-9０-９]/.test(R.detectWord(d)), '距離を数字で出さない');
      prevMs = ms; prevHz = hz;
    }
    assert.ok(R.beepInterval(0.5) <= 80 && R.beepInterval(1) - D.beepMs <= 30, 'すぐそばは「ピピピピ…」（鳴っていない間が 30ms 以下）');
    assert.ok(R.beepInterval(16) >= 1200 && R.beepInterval(30) === R.beepInterval(16), '遠いとゆっくり（それより先は同じ）');
    assert.ok(R.beepInterval(8) - R.beepInterval(6) >= 120, '2 マス近づくと、はっきり速くなる');
    assert.strictEqual(R.detectWord(D.dig), 'この下だ！');
  });

  at('宝探し：うまる所は日付で決まり、決まりに合う所だけ', async () => {
    const R = await imp('js/play/rules.js');
    const ok = (x, z) => Math.hypot(x, z) < 12 && Math.hypot(x, z - 1) >= 6;
    const seen = new Set();
    for (let d = 1; d <= 28; d++) {
      const date = `2026-03-${String(d).padStart(2, '0')}`;
      const a = R.treasureSpot(date, ok), b = R.treasureSpot(date, ok);
      assert.ok(a && ok(a.x, a.z), '決まりに合う所：' + date);
      assert.deepStrictEqual(a, b, '同じ日は同じ所（だれが開いても）');
      seen.add(a.x + ',' + a.z);
    }
    assert.ok(seen.size >= 26, '日ごとに違う所');
    assert.strictEqual(R.treasureSpot('2026-03-01', () => false, 14, 50), null, '合う所がなければ null');
  });

  t('宝探し：目印を出さない・探知機を持つ・音はファイルを使わない', () => {
    const main = fs.readFileSync(path.join(ROOT, 'js', 'play', 'main.js'), 'utf8');
    const scene = fs.readFileSync(path.join(ROOT, 'js', 'play', 'scene.js'), 'utf8');
    const det = fs.readFileSync(path.join(ROOT, 'js', 'play', 'detector.js'), 'utf8');
    assert.ok(/g\.visible = false/.test(scene) && /o\.passable = true/.test(scene), 'うまっている宝箱は見えず、上を歩ける');
    assert.ok(/chest\.g\.visible = k === 'treasure' && T\.riseAt != null/.test(main), '掘り出したあとだけ見える');
    assert.ok(/makeDetector/.test(main) && /holdDetector/.test(main) && /beepInterval/.test(main), '探知機を持って、距離でピッ');
    assert.ok(/createOscillator/.test(det) && !/\.(mp3|wav|ogg)\b/.test(det + main), '音は Web Audio で作る');
    assert.ok(/navigator\.vibrate/.test(det), '震える端末は震わせる');
    assert.ok(/音が出ます/.test(main) && /音を消す/.test(main), '最初の音はボタンを押してから・消すボタン');
    assert.ok(!/マイクラ|マインクラフト/.test(det), '作品の名前を入れない');
  });
};
