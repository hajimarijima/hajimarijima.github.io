'use strict';
// 効果音の部品：雑音を共鳴フィルタに通した「かたまりが鳴る音」・低い「ドッ」・砕けるつぶ
// どれも put(i, v) に足していく（i は 44100Hz のサンプル番号）
const SR = 44100;
let seed = 99;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const nz = () => rnd() * 2 - 1;
function bp(f, q) {
  const w = 2 * Math.PI * f / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
  const b0 = a / a0, b2 = -a / a0, a1 = -2 * c / a0, a2 = (1 - a) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
function lp(f) { const k = 1 - Math.exp(-2 * Math.PI * f / SR); let y = 0; return (x) => (y += (x - y) * k); }
function hp(f) { const l = lp(f); return (x) => x - l(x); }
const stone = (base, j) => [[base * j, 1], [base * 1.63 * j, 0.6], [base * 2.31 * j, 0.45], [base * 3.07 * j, 0.25], [base * 4.4 * j, 0.15]];
function impact(put, s0, { modes, decay, q = 18, gain = 1, exc = 0.004 }) {
  const fs = modes.map(([f, g]) => ({ flt: bp(f, q), g }));
  for (let k = 0; k < SR * 0.5; k++) {
    const t = k / SR, x = t < exc ? nz() * (1 - t / exc) : 0;
    let y = 0; for (const m of fs) y += m.flt(x) * m.g;
    put(s0 + k, y * gain * 40 * Math.exp(-t * decay));
  }
}
function thump(put, s0, { f = 80, gain = 1, decay = 25 }) { const l = lp(f * 2); for (let k = 0; k < SR * 0.25; k++) { const t = k / SR; put(s0 + k, l(nz()) * 6 * gain * Math.exp(-t * decay)); } }
function crunch(put, s0, { len, lo, hi, density, gain = 1, decay = 10 }) {
  const f1 = hp(lo), f2 = lp(hi); let env = 0;
  for (let k = 0; k < SR * len; k++) {
    const t = k / SR;
    if (rnd() < density / SR) env = 0.5 + rnd() * 0.5;
    env *= 0.9965;
    put(s0 + k, f2(f1(nz())) * env * gain * Math.exp(-t * decay));
  }
}
const jit = () => 0.93 + rnd() * 0.14;
let digHit = 0;
// 選んでもらった音（岩の音の候補3 の 6 番＝木を切る、8 番＝作る・建てる）
const SOUNDS = {
  chop(put, s0) { const j = jit(); impact(put, s0, { modes: stone(520, j), decay: 30, q: 12, gain: 0.7, exc: 0.006 }); thump(put, s0, { f: 100, gain: 0.8, decay: 20 }); },
  // 岩を掘る「カン」（岩の音の候補7 の 9 番を少し高く）：たたくたびに少しずつ上がる（4 回で 1 回り）
  dig(put, s0) {
    const j = 1 + 0.05 * (digHit++ % 4), f = 830;
    impact(put, s0, { modes: stone(f, j), decay: 20, q: 22, gain: 0.8, exc: 0.003 });
    thump(put, s0, { f: 120, gain: 0.15 });
    crunch(put, s0 + 200, { len: 0.06, lo: 1500, hi: 5000, density: 800, gain: 0.15, decay: 35 });
  },
  build(put, s0) { const j = jit(); impact(put, s0, { modes: stone(520, j), decay: 30, q: 8, gain: 0.8, exc: 0.012 }); thump(put, s0, { f: 120, gain: 0.35 }); },
};
module.exports = { SR, rnd, impact, thump, crunch, stone, jit, SOUNDS };
