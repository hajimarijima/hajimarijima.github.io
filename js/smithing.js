// 鍛冶屋と鍛冶職人（sim.js・町の画面・村人ページ・テストで共通。three.js も DOM も使わない）。
//   決まりと数は data/config.json の "smithing"。防具は持ち物の枠を使わず、村人の L.gear（{ head, body, feet }）に入る。
//   道具は今持っている道具をより良い物に作り直す（持ち物の同じ枠に入れかえる）。材料は町のチェストから使う。

export const SLOTS = ['head', 'body', 'feet'];
export const SLOT_JA = { head: '帽子', body: '服', feet: 'くつ' };
const TIER_ORDER = ['hand', 'wood', 'stone', 'iron', 'gold', 'diamond'];
const toolTier = (item) => { const m = /^(wood|stone|iron|gold|diamond)_/.exec(item || ''); return m ? m[1] : 'hand'; };
const toolKind = (item) => { const m = /^(?:(?:wood|stone|iron|gold|diamond)_)?(axe|pickaxe|hoe|shovel|sword|fishing_rod)$/.exec(item || ''); return m ? m[1] : null; };

// 鍛冶屋が使えるようになる（投票の候補に入る）か：unlock.built の建物がぜんぶ建っていて、minDay 日目から
export function smithyUnlocked(SM, built, day) {
  if (!SM || !SM.unlock) return false;
  return (SM.unlock.built || []).every((t) => built.includes(t)) && day >= (SM.unlock.minDay || 0);
}

// 防具 1 つの守り（def）と、身につけている防具の合計
export function armorDefOf(item, SM) {
  const r = SM && SM.armor && SM.armor[item];
  return r ? ((SM.armorTiers[r.tier] || {}).def || 0) : 0;
}
export function armorDef(gear, SM) {
  if (!gear || !SM) return 0;
  return SLOTS.reduce((s, k) => s + armorDefOf(gear[k], SM), 0);
}
// 敵の 1 回の攻撃を 1 へらす確率（守り × perDef、上限 max）
export function armorBlockP(def, C) {
  if (!def || !C) return 0;
  return Math.min(C.armorMax ?? 0.6, def * (C.armorPerDef ?? 0.08));
}

// 体に重ねる色（帽子・服・くつ）。{ head: '#色', body, feet }。ないところは入れない
export function armorLook(gear, SM) {
  const out = {};
  if (!gear || !SM) return out;
  for (const k of SLOTS) { const r = SM.armor && SM.armor[gear[k]]; const t = r && SM.armorTiers[r.tier]; if (t && t.color) out[k] = r.tier + t.color; } // '素材#色'（模様は素材で変える：character.js の setArmor）
  return out;
}

// 「装備：鉄のつるはし・羊毛の服」に出す名前の並び（道具は持ち物から、防具は L.gear から）
export function gearNames(L, items) {
  if (!L) return [];
  const out = [];
  const inv = (L.held && L.held.length ? L.held : L.inv) || [];
  for (const s of inv) if (s && toolKind(s.item) && items[s.item]) out.push(items[s.item].name);
  for (const k of SLOTS) { const it = L.gear && L.gear[k]; if (it && items[it]) out.push(items[it].name); }
  return out;
}

// 材料が足りるか（板・棒は原木から作る）。keep の分はチェストに残す。
// plan はtools/craft.js の CR.plan（同じ決まりで数える）
function canMake(store, from, keep, plan, CC) {
  for (const [k, n] of Object.entries(keep || {})) if (from[k] && (store[k] || 0) < from[k] + n) return null;
  const p = plan(store, { from }, CC);
  return p.ok ? p.store : null;
}

// 鍛冶職人が次に作る物を 1 つ選ぶ。見張り（剣を持つ人）が先、そのあとは今の段階がいちばん低い所から。
//   people: [{ key, L, guard }]（並びは決まった順）。CR = tools/craft.js。
//   戻り値：{ type: 'tool'|'armor', key: 作る物, to: 村人の key, kind（道具の種類）| slot（防具の場所）, store: 使ったあとのチェスト } か null。
//   want：作りたかったが材料が足りない物（いちばん先の 1 つ。日記に書く）
export function pickJob({ store, people, config, built, CR }) {
  const SM = config.smithing, CC = config.crafting;
  if (!SM) return { job: null, want: null };
  const cand = [];
  // 人が多い時は、見張りと今の段階が低い人から SM.lookAt 人だけを見る（軽くするため）
  const low = (L) => Math.min(...SLOTS.map((k) => armorDefOf(L.gear && L.gear[k], SM)), ...(L.inv || []).filter((s) => s && toolKind(s.item)).map((s) => TIER_ORDER.indexOf(toolTier(s.item))));
  const pool = people.filter((p) => p.L).map((p) => ({ p, g: p.guard ? 1 : 0, r: low(p.L) }))
    .sort((a, b) => (b.g - a.g) || (a.r - b.r)).slice(0, SM.lookAt || 60).map((x) => x.p);
  for (const p of pool) {
    const L = p.L;
    // 防具：今より守りの大きい物
    for (const slot of SLOTS) {
      const cur = armorDefOf(L.gear && L.gear[slot], SM);
      for (const [key, r] of Object.entries(SM.armor || {})) {
        if (r.slot !== slot) continue;
        const d = armorDefOf(key, SM);
        if (d > cur) cand.push({ p, type: 'armor', key, slot, from: r.from, rank: cur, gain: d });
      }
    }
    // 道具：持っている道具を、より良い段階に
    for (const s of (L.inv || []).slice(0, L.slots || 99)) {
      const kind = s && toolKind(s.item);
      if (!kind || !(SM.toolKinds || []).includes(kind)) continue;
      const have = toolTier(s.item);
      for (const [key, r] of Object.entries(CC.recipes)) {
        if (r.tool !== kind || CR.tierRank(r.tier) <= CR.tierRank(have)) continue;
        const need = CC.tiers[r.tier] && CC.tiers[r.tier].needs;
        if (need && !built.includes(need)) continue;
        cand.push({ p, type: 'tool', key, kind, from: r.from, rank: TIER_ORDER.indexOf(have), gain: CR.tierRank(r.tier), tier: r.tier });
      }
    }
  }
  // 見張りが先 → 今の段階が低い人 → 良い物 → 防具が先（守りは夜のため）
  cand.sort((a, b) => (b.p.guard - a.p.guard) || (a.rank - b.rank) || (b.gain - a.gain) || ((a.type === 'armor' ? 0 : 1) - (b.type === 'armor' ? 0 : 1)));
  let want = null;
  for (const c of cand) {
    // 鉱石を「自分で持つ」人（L.ores）の装備は、本人の鉱石を先に使い、足りない分をチェストから（keep の決まりはチェストの分だけ）
    const own = c.p.L.ores || null;
    if (own && Object.values(own).some((n) => n > 0)) {
      const merged = { ...store };
      for (const [k, n] of Object.entries(own)) merged[k] = (merged[k] || 0) + n;
      const s = canMake(merged, c.from, SM.keep, CR.plan, CC); // 本人の分を先に使うので、チェストに残る数は keep のまま
      if (s) {
        const left = { ...s }, mine = {};
        for (const [k, n] of Object.entries(own)) {
          const used = (merged[k] || 0) - (s[k] || 0), fromOwn = Math.min(n, Math.max(0, used));
          mine[k] = n - fromOwn;
          left[k] = (store[k] || 0) - (used - fromOwn);
          if (!left[k] && !(k in store)) delete left[k];
        }
        return { job: { type: c.type, key: c.key, to: c.p.key, kind: c.kind, slot: c.slot, tier: c.tier, store: left, own: mine }, want };
      }
    }
    const s = canMake(store, c.from, SM.keep, CR.plan, CC);
    if (s) return { job: { type: c.type, key: c.key, to: c.p.key, kind: c.kind, slot: c.slot, tier: c.tier, store: s }, want };
    if (!want) want = { key: c.key, to: c.p.key };
  }
  return { job: null, want };
}
