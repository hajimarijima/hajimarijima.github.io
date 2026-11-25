'use strict';
// 道具作り（sim.js・サイト・動画・テストで共通。ブラウザでも使えるよう、require も DOM も使わない）
// レシピと段階は data/config.json の "crafting"。材料はチェスト（state.store）から使う。
// 原木 1 → 板 4、板 2 → 棒 4 は、足りない時に自動で作る（余りはチェストに残る）。

const TIER_ORDER = ['hand', 'wood', 'stone', 'iron', 'gold', 'diamond'];
const tierRank = (t) => TIER_ORDER.indexOf(t);

// recipe を今のチェストで作れるか。作れるなら { ok: true, store: 使ったあとの中身 }、
// 作れないなら { ok: false, missing: { 原料: あといくつ } }（板・棒は原木に直して数える）
function plan(store, recipe, cfg) {
  const s = { ...store };
  const inter = cfg.intermediates;
  const missing = {};
  const take = (item, n) => { const have = s[item] || 0; const k = Math.min(have, n); s[item] = have - k; return n - k; };
  let planks = 0, sticks = 0;
  for (const [it, n] of Object.entries(recipe.from)) {
    if (it === 'planks') planks += n;
    else if (it === 'stick') sticks += n;
    else { const left = take(it, n); if (left) missing[it] = (missing[it] || 0) + left; }
  }
  // 棒：チェストの棒 → 板から作る
  const stLeft = take('stick', sticks);
  if (stLeft) {
    const batches = Math.ceil(stLeft / inter.stick.makes);
    planks += batches * inter.stick.from.planks;
    s.stick = (s.stick || 0) + batches * inter.stick.makes - stLeft;
  }
  // 板：チェストの板 → 原木から作る
  const plLeft = take('planks', planks);
  if (plLeft) {
    const batches = Math.ceil(plLeft / inter.planks.makes);
    const lack = take('log', batches * inter.planks.from.log);
    if (lack) missing.log = (missing.log || 0) + lack;
    else s.planks = (s.planks || 0) + batches * inter.planks.makes - plLeft;
  }
  for (const k of Object.keys(s)) if (!s[k]) delete s[k];
  return Object.keys(missing).length ? { ok: false, missing } : { ok: true, store: s };
}

// kind（pickaxe / axe / hoe）の道具で、今より良い物を作れるか。良い物から順に試す。
// goal（投票で決まった道具）があれば、それを先に試す。
// 戻り値：{ key, recipe, store }（作れた） / { key: null, want: { key, missing } }（いちばん欲しい物の足りない材料）
function choose(store, kind, cfg, { built = [], have = 'hand', goal = null } = {}) {
  const ok = (r) => r.tool === kind && tierRank(r.tier) > tierRank(have) && (!cfg.tiers[r.tier].needs || built.includes(cfg.tiers[r.tier].needs));
  const recs = Object.entries(cfg.recipes).filter(([, r]) => ok(r));
  recs.sort((a, b) => (b[0] === goal) - (a[0] === goal) || tierRank(b[1].tier) - tierRank(a[1].tier));
  let want = null;
  for (const [key, recipe] of recs) {
    const p = plan(store, recipe, cfg);
    if (p.ok) return { key, recipe, store: p.store, want };
    if (!want) want = { key, missing: p.missing };
  }
  return { key: null, want };
}

// 「丸石 あと 2・原木 あと 1」
function missingText(missing, items) {
  return Object.entries(missing).map(([k, n]) => `${(items[k] && items[k].name) || k} あと ${n}`).join('・');
}

// 道具の強さ（たたく回数・落ちる数・耐久）
const stats = (tier, cfg) => cfg.tiers[tier] || cfg.tiers.hand;

const api = { TIER_ORDER, tierRank, plan, choose, missingText, stats };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.CRAFT = api;
