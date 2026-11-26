'use strict';
// 釣った魚の大きさ（cm）と、釣りランキング（島の記録）。sim.js とテストで共通。
// 大きさの範囲は config.json の fishing.sizes（魚ごとに min〜max cm、まれに bigMax までの大物）。
// 記録は state.fishing.top に「魚ごとの上位 keep 匹」だけ、村人ごとの一番は life の fishBest に魚ごとに 1 つだけ残す（全部の釣果は残さない）。

// 大きさを決める。ふつうは min〜max で、大きいほど出にくい（skew が大きいほど小さめに寄る）。
// bigP の確率で「大物」になり、max〜bigMax の大きさになる
function rollSize(sz, rng) {
  if (!sz) return null;
  const min = +sz.min || 0, max = Math.max(min, +sz.max || min);
  const skew = sz.skew || 2;
  let cm;
  if (sz.bigMax > max && rng.next() < (sz.bigP ?? 0.02)) cm = max + (sz.bigMax - max) * Math.pow(rng.next(), 1.5);
  else cm = min + (max - min) * Math.pow(rng.next(), skew);
  // 10cm より小さい魚は 0.1cm まで、ほかは 1cm きざみ
  return (sz.bigMax || max) < 10 ? Math.round(cm * 10) / 10 : Math.round(cm);
}

// 1 匹を記録する。返す値：{ record: 島の新記録か（前の記録をこえた時だけ）, prev: 前の記録の cm, best: 自分の一番を更新したか }
function addCatch(state, L, key, item, cm, day, keep = 10) {
  const F = state.fishing || (state.fishing = { top: {}, catches: 0 });
  if (!F.top) F.top = {};
  F.catches = (F.catches || 0) + 1;
  const top = F.top[item] || (F.top[item] = []);
  const prev = top.length ? top[0][0] : null;
  const record = prev != null && cm > prev;
  // [cm, 村人の key, 日]。同じ大きさなら先に釣った人が上
  let i = top.findIndex((t) => cm > t[0]);
  if (i < 0) i = top.length;
  if (i < keep) { top.splice(i, 0, [cm, key, day]); if (top.length > keep) top.length = keep; }
  let best = false;
  if (L) {
    const fb = L.fishBest || (L.fishBest = {});
    if (!fb[item] || cm > fb[item][0]) { fb[item] = [cm, day]; best = true; }
  }
  return { record, prev, best };
}

module.exports = { rollSize, addCatch };
