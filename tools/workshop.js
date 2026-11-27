'use strict';
// 工房（毎日の更新の中。tools/sim.js から呼ぶ）。決まりは js/workshop.js（サイト・受け口と共通）。
//   受け口（Worker・tools/webhook/worker.mjs の 8)）が積んだ列を、時刻の順に、本当の持ち物で当てる：
//   ・{ t: 'gain' } 遊ぶで手に入れた物（釣れた物・宝箱・激レア）。入らない分は島のチェストへ（村人の持ち物が増えるのはここだけ）
//   ・{ t: 'send' | 'craft' | 'trade' | 'open' } チェストへ送る・作る・交換・宝箱を開ける。本当の持ち物でもう一度確かめ、できない頼みは当てない
//   列は tools/play.js pull が data/inbox/play.json の shop に入れる
//   data/workshop.json（公開）：{ day, date, seen: [当てた id], results: { id: { ok, why?, text?, day, who, t } } }
//     受け口はこれと data/life.json を読んで「まだ入っていない分」だけ足して見せる（二重に数えない）
const WS = require('../js/workshop.js');

function stepWorkshop(S, { day, date, play = null, hist = () => {}, now = Date.now() }) {
  const config = S.config, W = WS.wsCfg(config);
  const X = S.workshop && typeof S.workshop === 'object' ? S.workshop : {};
  X.results = X.results && typeof X.results === 'object' ? X.results : {};
  delete X.applied; // 前の形
  const seen = new Set(Array.isArray(X.seen) ? X.seen : []);
  const store = S.state.store || (S.state.store = {});
  const active = new Map(S.villagers.filter((v) => v.joinedDay <= day && !v.gone).map((v) => [v.key, v]));
  const nameOf = (k) => (active.get(k) || { display: k }).display;
  const diary = (k, text) => { const L = S.life[k], d = L && L.diary && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += text; };
  const nm = (it) => WS.wsName(config, it);
  // 1 枠の上限より多く重なっている枠は、空いた枠へ分ける（前の上限 64 のまま持っていた分。消さない）
  for (const [k] of active) { const L = S.life[k]; if (L && Array.isArray(L.inv)) WS.splitOver(L.inv, L.slots || L.inv.length, config); }
  const shop = (play && play.shop) || {}, list = [];
  for (const d of Object.keys(shop).sort()) for (const [k, ops] of Object.entries(shop[d] || {})) for (const op of ops || []) if (op && op.id) list.push({ k, op });
  list.sort((a, b) => String(a.op.at || '').localeCompare(String(b.op.at || '')));
  const stats = { gains: 0, ops: 0, failed: 0, legend: 0 }, nowIso = new Date(+now).toISOString();
  for (const { k, op } of list) {
    if (seen.has(op.id)) continue;
    seen.add(op.id);
    const L = S.life[k];
    if (!active.has(k) || !L) { X.results[op.id] = { ok: false, why: '島にいない', day, who: k, t: op.t, at: nowIso }; stats.failed++; continue; }
    const r = WS.applyOp(config, L, op, store);
    X.results[op.id] = r.ok ? { ok: true, text: r.text, day, who: k, t: op.t, at: nowIso } : { ok: false, why: r.why, day, who: k, t: op.t, at: nowIso };
    if (!r.ok) { stats.failed++; continue; }
    const who = nameOf(k);
    if (op.t === 'gain') {
      stats.gains++;
      for (const [it, n] of op.items) {
        if (op.src === 'fish' && /^fish_/.test(it)) L.fished = (L.fished || 0) + n; // 釣り人のバッジ（熟練度）の数
        if (WS.isLegend(config, it)) { stats.legend++; hist('find', `${who}さんが激レアの${nm(it)}を見つけた！`, { who: [k], item: it, rarity: 'legend' }); diary(k, `激レアの${nm(it)}を見つけた！`); }
        if (it === 'treasure_box') diary(k, '宝箱をもらった。');
      }
      if (Array.isArray(op.stones) && op.stones.length) diary(k, `${op.src === 'fish' ? '釣りで' : op.src === 'treasure' ? '宝探しで' : ''}ストーンを見つけた。`);
      if (op.src === 'treasure' && op.items.length && op.items[0][0] !== 'treasure_box') diary(k, `宝探しで宝箱を掘り出して開けたら、${nm(op.items[0][0])}が出てきた。`); // 掘った場で開ける（中身だけが届く）
      if (Object.keys(r.toStore || {}).length) diary(k, `持ち物がいっぱいだったので、${Object.keys(r.toStore).map(nm).join('・')}は島のチェストに入れた。`);
      continue;
    }
    stats.ops++;
    if (op.t === 'send') { hist('chest', `${who}さんが${r.text}を島のチェストに入れた。`, { who: [k], items: op.items }); diary(k, `${r.text}を島のチェストに入れた。`); }
    else if (op.t === 'craft') { hist('craft', `${who}さんが自分の持ち物で${r.text}を作った。`, { who: [k], item: op.recipe }); diary(k, `${r.text}を作った。`); for (const it of Object.keys(r.toStore || {})) diary(k, `前の${nm(it)}は島のチェストに入れた。`); }
    else if (op.t === 'trade') diary(k, `交換所で${r.text}と交換した。`);
    else if (op.t === 'armor') diary(k, `${r.text}を作った（穴 ${op.holes} 個）。`); // 防具とストーン（競争にしないので年表には出さない）
    else if (op.t === 'crush') diary(k, `ストーンを砕いて${r.text}にした。`);
    else if (op.t === 'reroll') diary(k, 'かけらでストーンを磨き直した。');
    else if (op.t === 'open') {
      diary(k, `宝箱を開けたら${r.text.replace('・ストーン', '')}が出てきた。${op.stone ? 'ストーンも入っていた。' : ''}`);
      if (WS.isLegend(config, op.got[0])) { stats.legend++; hist('find', `${who}さんが宝箱から激レアの${nm(op.got[0])}を見つけた！`, { who: [k], item: op.got[0], rarity: 'legend' }); }
    }
  }
  // 古い分を消す（本当の時刻で keepDays 日より前。受け口が見るのは 3 日分。町の日を何日も進める時も、まだ読む分は消さない）
  const keep = W.keepDays || 8;
  for (const [id, r] of Object.entries(X.results)) if (!r || !(Date.parse(r.at) >= +now - keep * 86400e3)) { delete X.results[id]; seen.delete(id); }
  X.seen = [...seen].filter((id) => X.results[id]);
  X.day = day; X.date = date || null; X.at = nowIso;
  S.workshop = X;
  return stats;
}

module.exports = { stepWorkshop };
