// 町のチェストの画面（町のページの「町のチェスト」）。DOM は使わず、数と HTML の文字を返す（テストでも使う）
// ・チェストの中身を 材料／部品／食べ物／道具／その他 に分けて、マス目（アイコンと数）で出す
// ・今つくっている物（投票で決まった建物）の、あつまった数／いる数 と進みぐあいのバー

import { needsOf, stageOf, STAGE_NAMES } from './construction.js';
const RES_JA = { wood: '木材', stone: '石', food: '食べ物' };
export const GROUPS = [['mat', '材料'], ['part', '部品'], ['food', '食べ物'], ['tool', '道具'], ['other', 'その他']];
const MAT = ['log', 'planks', 'stick', 'driftwood', 'cobble', 'coal', 'iron', 'gold', 'diamond', 'wool', 'stump', 'sapling', 'seeds'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// アイテム 1 つの分け先
export function groupOf(key, items) {
  const it = items[key] || {};
  if (it.part || it.furniture) return 'part';
  if (/_(pickaxe|axe|hoe|shovel|sword|fishing_rod)$/.test(key)) return 'tool';
  if (MAT.includes(key)) return 'mat';
  if (it.value && it.value.food > 0) return 'food';
  if (it.value && (it.value.wood > 0 || it.value.stone > 0)) return 'mat';
  return 'other';
}

// チェストの中身 → { mat: [[key, n], ...], part: [...], ... }（中は config.items の順）
export function chestGroups(store, config) {
  const items = config.items || {}, order = Object.keys(items);
  const out = Object.fromEntries(GROUPS.map(([g]) => [g, []]));
  for (const [k, n] of Object.entries(store || {})) if (n > 0) out[groupOf(k, items)].push([k, n]);
  for (const g of Object.keys(out)) out[g].sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999));
  return out;
}

// 今つくっている物の進みぐあい。plan がなければ null
//   rows：[{ key, name, have, need, icon }]（材料は木材・石・食べ物の量、部品はチェストの数）
//   stage：'gather'（集めている）/ 'level'（整地を待つ）/ 'build'（建てている。prog 0〜1）
export function goalProgress(state, config, hour) {
  const plan = state && state.plan;
  if (!plan) return null;
  const b = config.buildings[plan.build] || { name: plan.build, cost: {} };
  const items = config.items || {}, res = state.resources || {}, store = state.store || {};
  const rows = [];
  // 材料（部品にした分を引いた残り）と部品（柱・石材・屋根板・扉）。建て始めたら全部そろった扱い
  const NEED = config.construction ? needsOf(plan.build, config) : { raw: b.cost || {}, parts: b.parts || {} };
  for (const [r, n] of Object.entries(NEED.raw)) if (n > 0) rows.push({ key: r, name: RES_JA[r] || r, have: plan.started ? n : Math.min(res[r] || 0, n), need: n, res: true });
  for (const [k, n] of Object.entries(NEED.parts)) rows.push({ key: k, name: (items[k] || {}).name || k, have: plan.started ? n : Math.min(store[k] || 0, n), need: n, icon: k, part: true });
  let stage = 'gather', prog = 0;
  if (plan.started) {
    stage = 'build';
    const hp = Array.isArray(plan.hourProg) && Number.isFinite(hour) ? plan.hourProg[((Math.floor(hour) % 24) + 24) % 24] : null;
    prog = hp ?? (plan.buildNeed ? (plan.buildH || 0) / plan.buildNeed : 0);
  } else if (plan.site && !plan.leveled) stage = 'level';
  const ready = rows.length > 0 && rows.every((x) => x.have >= x.need);
  return { name: b.name, site: plan.site ? plan.site.label : null, rows, stage, prog: Math.max(0, Math.min(1, prog)), ready };
}

// 建てている時の見た目の段階（土台 → 壁 → 屋根 → できあがり）
export function stageName(prog, stages = [0.34, 0.67]) {
  return STAGE_NAMES[stageOf(prog, { construction: { stages } })];
}

const bar = (k) => `<span class="pbar"><i style="width:${Math.round(Math.max(0, Math.min(1, k)) * 100)}%"></i></span>`;

// 「今つくっている物」の HTML
export function goalHtml(state, config, hour) {
  const g = goalProgress(state, config, hour);
  if (!g) return '<p class="muted">何を建てるかは、投票で決めます。</p>';
  const CN = config.construction || {};
  let h = `<p class="goalname"><b>${esc(g.name)}</b>${g.site ? `（${esc(g.site)}）` : '（場所は投票中）'}</p>`;
  if (g.stage === 'build') h += `<p class="goalstage">建てている：${stageName(g.prog, CN.stages)}（${Math.round(g.prog * 100)}%）${bar(g.prog)}</p>`;
  else if (g.stage === 'level') h += '<p class="goalstage muted">建てる場所の整地はこれから</p>';
  else if (g.ready) h += '<p class="goalstage">材料と部品がそろった。あしたから建て始める</p>';
  h += '<ul class="goallist">' + g.rows.map((x) => `<li${x.have >= x.need ? ' class="done"' : ''}>` +
    (x.icon ? `<img class="pixel" src="icons/${esc(x.icon)}.png" alt="" width="20" height="20" onerror="this.style.visibility='hidden'">` : `<i class="dot r-${esc(x.key)}"></i>`) +
    `<span class="gn">${esc(x.name)}</span><span class="gc">${Math.floor(x.have)}／${x.need}</span>${bar(x.have / x.need)}</li>`).join('') + '</ul>';
  return h;
}

// チェストの中身の HTML（分けたマス目）
export function chestHtml(store, config) {
  const items = config.items || {}, gs = chestGroups(store, config);
  const any = GROUPS.some(([g]) => gs[g].length);
  if (!any) return '<p class="muted">まだ空っぽです。</p>';
  return GROUPS.filter(([g]) => gs[g].length).map(([g, label]) => `<h3 class="chg">${label}</h3><div class="mcslots">` +
    gs[g].map(([k, n]) => `<div class="mcslot" title="${esc((items[k] || {}).name || k)}"><img src="icons/${esc(k)}.png" alt="" width="32" height="32" onerror="this.style.visibility='hidden'"><b>${n}</b><span>${esc((items[k] || {}).name || k)}</span></div>`).join('') + '</div>').join('');
}
