// 建てる段取り（sim.js・町の画面・町のチェストで共通。three.js も DOM も使わない）。
//   材料（チェストの原木・丸石・板）→ 部品（柱・石材・屋根板・扉）→ 建てる（土台 → 壁 → 屋根 → できあがり）
//   建物の cost（木材・石・食べ物の量）はそのまま全体の量。そのうち一部を部品にして、残りをそのまま使う。
//   数は config.construction から出す。

const NO_PARTS = ['fence', 'wall', 'lamps', 'farm', 'canal', 'workbench', 'garden', 'pen', 'plaza'];
const ROOFED = ['house', 'storehouse', 'tower', 'windmill', 'watch'];

// 物 1 つの値（config.items[it].value）
const valOf = (it, config) => ((config.items || {})[it] || {}).value || {};

// 建物 type に要る物：{ raw: { wood, stone, food }（そのまま使う量）, parts: { 部品: 数 }, total: 全体の量 }
export function needsOf(type, config) {
  const B = (config.buildings || {})[type] || {}, cost = B.cost || {}, CN = config.construction || {}, P = CN.parts || {};
  const total = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
  const parts = {};
  const look = B.look || {};
  if (!NO_PARTS.includes(type) && total >= (CN.minCost || 20)) {
    for (const [k, p] of Object.entries(P)) {
      if (p.roof && !ROOFED.includes(look.kind)) continue;
      if (p.house && look.kind !== 'house') continue;
      let n = p.fixed || 0;
      for (const [r, per] of Object.entries(p.per || {})) if (cost[r] > 0) n += Math.ceil(cost[r] / per);
      if (n > 0) parts[k] = n;
    }
  }
  // 部品にした分の材料を、全体の量から引いた残り
  const used = { wood: 0, stone: 0, food: 0 };
  for (const [k, n] of Object.entries(parts)) for (const [it, m] of Object.entries((P[k] || {}).from || {})) { const v = valOf(it, config); for (const r of Object.keys(used)) used[r] += (v[r] || 0) * m * n; }
  const raw = {};
  for (const [r, n] of Object.entries(cost)) if (n > 0) raw[r] = Math.max(0, Math.ceil(n - used[r] - 1e-9));
  return { raw, parts, total };
}

// 建てるのにかかる手間（人×時間）。大きい建物ほどかかる
export function buildHours(type, config) {
  const CN = config.construction || {}, { total } = needsOf(type, config);
  return Math.max(CN.minHours || 6, Math.min(CN.maxHours || 48, Math.ceil(total * (CN.hoursPerCost || 0.3))));
}

// 進み（0〜1）→ 段階：0 土台・1 壁・2 屋根・3 できあがり
export function stageOf(prog, config) {
  const st = (config.construction || {}).stages || [0.34, 0.67];
  return prog >= 1 ? 3 : prog >= st[1] ? 2 : prog >= st[0] ? 1 : 0;
}
export const STAGE_NAMES = ['土台', '壁', '屋根', 'できあがり'];
// 土台・壁・屋根の段階がある建物（家・倉庫・塔など）。畑・柵・井戸などは段階の名前を出さない
export function hasStages(type, config) { const L = ((config.buildings || {})[type] || {}).look || {}; return ROOFED.includes(L.kind); }
