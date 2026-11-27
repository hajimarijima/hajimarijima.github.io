// 遊びの記録（1 日の回数・釣った物・おてつだいのみんなの合計・宝箱をいちばんに見つけた人）と、工房（持ち物・チェストへ送る・作る・交換・宝箱）。
// 本番（自分の村人とつながった 'live'）は受け口（Worker・tools/webhook/worker.mjs の 5)・8)）に印を付けて送り、Worker が数えて KV に記録する。
//   激レア・宝箱の中身の抽選も Worker。持ち物を本当に動かすのは毎日の更新（tools/workshop.js）。画面は Worker の答えを見せるだけ。
// 見本（?demo-me=1）と、つながっていない時は、その場だけ（何も保存しない・どこにも送らない）。
import { playCfg, jstDate, emptyDay, demoChoreTotal } from './rules.js';
import { api } from '../mine.js';
import { simulate, applyOp, rollBox, boxStrip, rollLegend, wsCfg, boxTiers, rollStone, rollHoles, rerollMods, gearOf, gearStats, gearBoost, gearCfg } from '../workshop.js';

export function makeStore(W, L = {}) {
  const config = (W && W.config) || {};
  const P = playCfg(config);
  if (W && W.mode === 'live') return liveStore(config, P, W.me || {});
  return memStore(config, P, W && W.mode === 'demo' ? 'demo' : 'guest', L);
}

// 見本の持ち物（その場だけ。遊ぶと少しずつ増える）
const DEMO_GAINS = [['fish_aji', 5], ['fish_saba', 4], ['log', 6], ['cobble', 10], ['berry', 9], ['old_coin', 2], ['treasure_box', 2], ['leather', 8], ['iron', 6], ['gold', 3], ['diamond', 2]];
function memStore(config, P, mode, L) {
  const date = jstDate();
  const day = emptyDay(), fish = [];
  let mine = 0;
  const L0 = { ...L, inv: (L.inv || []).map((s) => (s ? { ...s } : null)), slots: Math.max(L.slots || 3, 12) }; // 見本は枠を多めに
  const gains = DEMO_GAINS.map((g) => g.slice()), ops = [];
  let n = 0, sid = 0;
  const nid = () => 'dm' + Date.now().toString(36).slice(-5) + ++sid;
  // 見本の防具とストーン：石を 3 つとかけら 30 個から（その場だけ）
  //   見本は色ちがい（緑・青・紫）のくらしの石にして、セット効果まで見られるようにする（本番の出かたは受け口の抽選）
  const fixed = (...v) => { let i = 0; return () => (i < v.length ? v[i++] : Math.random()); };
  if (mode === 'demo' && !L0.kit) L0.kit = { armor: [], on: {}, stones: [[0.7, 0.9, 0.5, 0.85], [0.9, 0.9, 0.5, 0.6], [0.97, 0.9, 0.5, 0.3]].map((v) => rollStone(config, fixed(...v), nid())), shards: 30, sf: 0 };
  const cur = () => simulate(config, L0, gains, ops).L;
  const view = () => { const s = simulate(config, L0, gains, ops); return { inv: s.L.inv, slots: s.L.slots, kit: s.L.kit || null, ops: ops.map((o, i) => ({ ...o, ok: s.results[i].ok, why: s.results[i].why || null })), gains, left: Math.max(0, wsCfg(config).perDay - ops.filter((o) => !['gain', 'wear', 'socket', 'unsocket'].includes(o.t)).length), perDay: wsCfg(config).perDay, demo: true }; };
  const force = (k) => (typeof window !== 'undefined' ? window[k] : undefined);
  const stoneDrop = (src) => { const f = force('__stoneForce'); const st = gearStats(config, cur().kit); return f || Math.random() < gearCfg(config).drop[src] * gearBoost(st, 'u_find') ? rollStone(config, Math.random, nid()) : null; };
  // 受け口と同じく、穴の数・新しいモッドはここで決める（見本だけ window.__holesForce で穴の数を決められる）
  const prep = (op) => {
    if (op.t === 'armor') { const f = force('__holesForce'); op = { t: 'armor', part: op.part, mat: op.mat, holes: Number.isInteger(f) ? f : rollHoles(config, Math.random), aid: nid() }; }
    if (op.t === 'reroll') { const F = gearOf(cur()), s = [...F.stones, ...F.armor.flatMap((a) => a.st.filter(Boolean))].find((x) => x.id === op.stone), lock = op.lock || null; if (s) { op = { t: 'reroll', stone: s.id, mods: rerollMods(config, s, lock, Math.random) }; if (lock) op.lock = lock; } }
    return op;
  };
  const push = (op0) => {
    const op = prep(op0);
    const s = simulate(config, L0, gains, ops), r = applyOp(config, s.L, op, null);
    if (!r.ok) throw Object.assign(new Error(r.why), { code: 'cannot' });
    op.id = 'demo' + ++n; op.at = new Date().toISOString(); ops.push(op);
    return { op, text: r.text, ...view() };
  };
  const st = {
    mode, date, P, last: {},
    async today() { return { ...day }; },
    async useFish(res) {
      if (day.fish >= P.fishPerDay) throw new Error('きょうの回数はおしまいです');
      day.fish++; st.last = {};
      if (res) { fish.push([res.item, res.cm ?? 0]); gains.push([res.item, 1]); const lg = rollLegend(config, 'fish', Math.random, gearBoost(gearStats(config, cur().kit), 'fish')); if (lg) { gains.push([lg, 1]); st.last.legend = lg; } const sn = stoneDrop('fish'); if (sn) { ops.push({ id: 'demo' + ++n, t: 'gain', items: [], stones: [sn], src: 'fish', at: new Date().toISOString() }); st.last.stone = sn; } }
      return { ...day };
    },
    async useChore() { if (day.chores >= P.chorePerDay) throw new Error('きょうの回数はおしまいです'); day.chores++; mine++; st.last = {}; if (day.chores === P.chorePerDay) { gains.push(['treasure_box', 1]); st.last.box = 1; } return { ...day }; },
    async choreTotal() { return demoChoreTotal(date, P.choreGoal) + mine; },
    async claimTreasure(key) { // 掘った場で宝箱を開ける：中身（宝箱の段の抽選）を持ち物へ。見本だけ window.__boxForce で段を決められる
      st.last = {};
      if (!day.treasure) {
        const lg = rollLegend(config, 'treasure', Math.random); if (lg) st.last.legend = lg;
        const f = typeof window !== 'undefined' && window.__boxForce, ft = f && boxTiers(config).find((x) => x.id === f);
        const g = ft ? { tier: ft.id, item: ft.items[0][0], n: ft.items[0][1] } : rollBox(config, Math.random);
        gains.push([g.item, g.n]); if (lg) gains.push([lg, 1]); st.last.got = [g.item, g.n]; st.last.tier = g.tier;
        const sn = stoneDrop('treasure'); if (sn) { ops.push({ id: 'demo' + ++n, t: 'gain', items: [], stones: [sn], src: 'treasure', at: new Date().toISOString() }); st.last.stone = sn; }
      }
      day.treasure = true; return { first: true, finder: key };
    },
    async catches() { return fish.slice(); },
    // 工房（見本はこの端末の中だけで決める。本番は受け口が決める）
    async shop() { return view(); },
    async shopDo(op) { return push(op); },
    async openBox() {
      // 見本だけ：確かめ用に段を決められる（window.__boxForce = 'legend' など。本番は受け口が決めるので効かない）
      const f = typeof window !== 'undefined' && window.__boxForce, ft = f && boxTiers(config).find((x) => x.id === f);
      const g = ft ? { tier: ft.id, item: ft.items[0][0], n: ft.items[0][1] } : rollBox(config, Math.random), sn = stoneDrop('box'), op = { t: 'open', got: [g.item, g.n], tier: g.tier };
      if (sn) op.stone = sn;
      const out = push(op);
      return { ...out, stop: 37, strip: boxStrip(config, Math.random, g, 44, 37), offset: 0.18 + Math.random() * 0.64 };
    },
  };
  return st;
}

function liveStore(config, P0, me) {
  let day = { ...emptyDay(), ...(me.day || {}) }, catches = me.catches || [], total = me.choreTotal || 0;
  const P = { ...P0, ...(me.limits || {}) };
  const shopCall = async (path, body) => {
    try { return await api(config, path, body); } catch (e) { if (e.body && e.body.why) throw Object.assign(new Error(e.body.why), { code: 'cannot' }); throw e; }
  };
  const st = {
    mode: 'live', date: me.date || jstDate(), P, last: {},
    async today() { return { ...day }; },
    async useFish(res) {
      const j = await api(config, '/play/fish', res ? { item: res.item, cm: res.cm ?? 0 } : { miss: true });
      day = { ...day, ...j.day }; catches = j.catches || catches; st.last = { legend: j.legend || null, stone: j.stone || null }; return { ...day };
    },
    async useChore(kind) { const j = await api(config, '/play/chore', { kind }); day = { ...day, ...j.day }; total = j.choreTotal ?? total; st.last = { box: j.box || 0 }; return { ...day }; },
    async choreTotal() { return total; },
    async claimTreasure() { const j = await api(config, '/play/treasure', {}); day = { ...day, ...j.day }; st.last = { got: j.got || null, tier: j.tier || null, legend: j.legend || null, stone: j.stone || null }; return { first: !!j.first, finder: j.treasure && j.treasure.villager }; },
    async catches() { return catches.slice(); },
    async shop() { return api(config, '/shop/state'); },
    async shopDo(op) { return shopCall('/shop/do', op); },
    async openBox() { return shopCall('/box/open', {}); },
  };
  return st;
}
