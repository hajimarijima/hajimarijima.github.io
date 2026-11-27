// 遊びの記録（1 日の回数・釣った物・おてつだいのみんなの合計・宝箱をいちばんに見つけた人）。
// 本番（自分の村人とつながった 'live'）は受け口（Worker・tools/webhook/worker.mjs の 5)）に印を付けて送り、Worker が数えて KV に記録する。
// 見本（?demo-me=1）と、つながっていない時は、その場だけ（何も保存しない・どこにも送らない）。
import { playCfg, jstDate, emptyDay, demoChoreTotal } from './rules.js';
import { api } from '../mine.js';

export function makeStore(W) {
  const config = (W && W.config) || {};
  const P = playCfg(config);
  if (W && W.mode === 'live') return liveStore(config, P, W.me || {});
  return memStore(P, W && W.mode === 'demo' ? 'demo' : 'guest');
}

function memStore(P, mode) {
  const date = jstDate();
  const day = emptyDay(), fish = [];
  let mine = 0;
  return {
    mode, date, P,
    async today() { return { ...day }; },
    async useFish(res) { if (day.fish >= P.fishPerDay) throw new Error('きょうの回数はおしまいです'); day.fish++; if (res) fish.push([res.item, res.cm ?? 0]); return { ...day }; },
    async useChore() { if (day.chores >= P.chorePerDay) throw new Error('きょうの回数はおしまいです'); day.chores++; mine++; return { ...day }; },
    async choreTotal() { return demoChoreTotal(date, P.choreGoal) + mine; },
    async claimTreasure(key) { day.treasure = true; return { first: true, finder: key }; },
    async catches() { return fish.slice(); },
  };
}

function liveStore(config, P0, me) {
  let day = { ...emptyDay(), ...(me.day || {}) }, catches = me.catches || [], total = me.choreTotal || 0;
  const P = { ...P0, ...(me.limits || {}) };
  return {
    mode: 'live', date: me.date || jstDate(), P,
    async today() { return { ...day }; },
    async useFish(res) {
      const j = await api(config, '/play/fish', res ? { item: res.item, cm: res.cm ?? 0 } : { miss: true });
      day = { ...day, ...j.day }; catches = j.catches || catches; return { ...day };
    },
    async useChore(kind) { const j = await api(config, '/play/chore', { kind }); day = { ...day, ...j.day }; total = j.choreTotal ?? total; return { ...day }; },
    async choreTotal() { return total; },
    async claimTreasure() { const j = await api(config, '/play/treasure', {}); day = { ...day, ...j.day }; return { first: !!j.first, finder: j.treasure && j.treasure.villager }; },
    async catches() { return catches.slice(); },
  };
}
