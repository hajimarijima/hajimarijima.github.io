// 工房（持ち物をチェストへ送る・道具を作る・交換所・宝箱・熟練度）の決まり。three.js も DOM も使わない。
//   サイト（js/play/bag.js）・毎日の更新（tools/workshop.js）・テストで共通。
//   受け口（tools/webhook/worker.mjs）は 1 つのファイルで置けるよう、下の「ここから〜ここまで」を同じ文字のまま持つ
//   （書きかえたら node tools/sync_workshop.js で写す。テストで同じか確かめる）。
// 持ち物を増やす・減らすのは、受け口（その場の確かめ・宝箱の中身の抽選）と毎日の更新（本当に持ち物を動かす）だけ。画面は結果を見せるだけ。
// 数は data/config.json の "workshop"（交換の表・解放の条件・宝箱の中身と確率・激レアの出方）と items の stack（1 枠に重ねられる数）・rarity。

// ==== 工房の決まり：ここから（worker.mjs にも同じ物） ====
export const WS_DEF = { perDay: 20, keepDays: 8 };
export const wsCfg = (config) => ({ ...WS_DEF, ...((config && config.workshop) || {}) });
export const WS_TIER_ORDER = ['hand', 'wood', 'stone', 'iron', 'gold', 'diamond'];
// 道具か（wood_axe → { kind: 'axe', tier: 'wood' }）
export function wsTool(item) { const m = /^(?:(wood|stone|iron|gold|diamond)_)?(axe|pickaxe|hoe|shovel|sword|fishing_rod)$/.exec(item || ''); return m ? { kind: m[2], tier: m[1] || 'wood' } : null; }
export const wsItem = (config, item) => (config && config.items && Object.prototype.hasOwnProperty.call(config.items, item) ? config.items[item] : null);
export const wsName = (config, item) => (wsItem(config, item) || {}).name || item;
export const isLegend = (config, item) => (wsItem(config, item) || {}).rarity === 'legend';
// 1 枠に重ねられる数（items の stack。道具は重ねない）
export function stackOf(config, item) {
  if (wsTool(item)) return 1;
  const it = wsItem(config, item), def = (config && config.inventory && config.inventory.stack) || 64;
  return Math.max(1, Math.min(def, (it && it.stack) || def));
}
export function countOf(inv, item) { let n = 0; for (const s of inv || []) if (s && s.item === item && !wsTool(s.item)) n += s.n || 0; return n; }
export function invCounts(inv) { const o = {}; for (const s of inv || []) if (s && !wsTool(s.item)) o[s.item] = (o[s.item] || 0) + (s.n || 0); return o; }
// 入るだけ入れて、入らなかった数を返す（同じ物の枠を先に埋め、あとは空いた枠へ。1 枠は stackOf まで）
export function addTo(inv, slots, item, n, config) {
  if (wsTool(item)) return n;
  while (inv.length < slots) inv.push(null);
  const st = stackOf(config, item);
  for (let i = 0; i < slots && n > 0; i++) { const s = inv[i]; if (s && s.item === item && s.n < st) { const k = Math.min(n, st - s.n); s.n += k; n -= k; } }
  for (let i = 0; i < slots && n > 0; i++) if (!inv[i]) { const k = Math.min(n, st); inv[i] = { item, n: k }; n -= k; }
  return n;
}
// n 個とる（足りなければ何もしないで false）。うしろの枠から
export function takeFrom(inv, item, n) {
  if (!(n > 0) || countOf(inv, item) < n) return false;
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) { const s = inv[i]; if (s && s.item === item && !wsTool(s.item)) { const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) inv[i] = null; } }
  return true;
}
// 交換の「どれでも」：@fish（魚）・@legend（激レア）
export const WS_GROUPS = { '@fish': '魚（どれでも）', '@legend': '激レア（どれでも）' };
const inGroup = (config, g, item) => (g === '@fish' ? /^fish_/.test(item) : g === '@legend' ? isLegend(config, item) : item === g);
export const groupCount = (config, inv, g) => Object.entries(invCounts(inv)).reduce((a, [k, n]) => a + (inGroup(config, g, k) ? n : 0), 0);
function takeGroup(config, inv, g, n) {
  if (!g.startsWith('@')) return takeFrom(inv, g, n);
  if (groupCount(config, inv, g) < n) return false;
  const list = Object.entries(invCounts(inv)).filter(([k]) => inGroup(config, g, k)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)); // 多い物から
  for (const [k, have] of list) { if (n <= 0) break; const m = Math.min(n, have); takeFrom(inv, k, m); n -= m; }
  return true;
}
// 余った数（stackOf より多い枠）を、空いた枠へ分ける（消さない。空きがなければそのまま持つ）
export function splitOver(inv, slots, config) {
  while (inv.length < slots) inv.push(null);
  for (let i = 0; i < inv.length; i++) {
    const s = inv[i]; if (!s || wsTool(s.item)) continue;
    const st = stackOf(config, s.item);
    while (s.n > st) { const j = inv.findIndex((x, k) => !x && k < slots); if (j < 0) break; const k = Math.min(st, s.n - st); inv[j] = { item: s.item, n: k }; s.n -= k; }
  }
  return inv;
}

// ---------- 道具を作る（材料は自分の持ち物から。原木 → 板 → 棒は足りない時に自動で） ----------
// counts（{ 物: 数 }）で recipe を作れるか。{ ok, after（使ったあとの数）, missing }
export function craftUse(counts, recipe, CC) {
  const s = { ...counts }, inter = (CC && CC.intermediates) || { planks: { from: { log: 1 }, makes: 4 }, stick: { from: { planks: 2 }, makes: 4 } }, missing = {};
  const take = (it, n) => { const have = s[it] || 0, k = Math.min(have, n); s[it] = have - k; return n - k; };
  let planks = 0, sticks = 0;
  for (const [it, n] of Object.entries(recipe.from || {})) {
    if (it === 'planks') planks += n; else if (it === 'stick') sticks += n;
    else { const left = take(it, n); if (left) missing[it] = (missing[it] || 0) + left; }
  }
  const stLeft = take('stick', sticks);
  if (stLeft) { const b = Math.ceil(stLeft / inter.stick.makes); planks += b * inter.stick.from.planks; s.stick = (s.stick || 0) + b * inter.stick.makes - stLeft; }
  const plLeft = take('planks', planks);
  if (plLeft) { const b = Math.ceil(plLeft / inter.planks.makes), lack = take('log', b * inter.planks.from.log); if (lack) missing.log = (missing.log || 0) + lack; else s.planks = (s.planks || 0) + b * inter.planks.makes - plLeft; }
  for (const k of Object.keys(s)) if (!s[k]) delete s[k];
  return Object.keys(missing).length ? { ok: false, missing } : { ok: true, after: s };
}
// その道具のレシピが開いているか。開いていれば null、まだなら { text, badge, tier }
export function recipeLock(config, key, L) {
  const CC = (config && config.crafting) || {}, r = CC.recipes && CC.recipes[key];
  if (!r) return { text: 'ない道具' };
  const U = wsCfg(config).unlock || {};
  if ((U.start || []).includes(key)) return null;
  const BG = (config && config.badges) || {}, badge = (U.kinds || {})[r.tool], B = BG.list && BG.list[badge], bn = B ? B.name : badge;
  const have = L && L.badges && Number.isInteger(L.badges[badge]) ? L.badges[badge] : -1, names = BG.tierNames || ['銅', '銀', '金', 'ダイヤ'];
  if (r.tier === 'wood') {
    if (((L && L.level) || 1) >= (U.woodLevel || 1) || have >= 0) return null;
    return { text: `Lv${U.woodLevel} か「${bn}」の銅バッジで作れる`, badge, tier: 0, level: U.woodLevel };
  }
  const need = (U.tiers || {})[r.tier];
  if (!Number.isInteger(need)) return { text: '今は作れない' };
  return have >= need ? null : { text: `「${bn}」の${names[need]}バッジで作れる`, badge, tier: need };
}
// バッジ（熟練度）の数（js/combat.js の badgeCount と同じ）と、次の段まで
export function wsBadgeCount(L, stat) { let v = L; for (const p of String(stat).split('.')) v = v == null ? undefined : v[p]; if (Array.isArray(v)) return v.length; if (v && typeof v === 'object') v = v.total; return Math.floor(Number(v) || 0); }
export function badgeNext(config, L) {
  const BG = (config && config.badges) || {}, out = [];
  for (const [id, B] of Object.entries(BG.list || {})) {
    if (B.founder || !Array.isArray(B.tiers)) continue;
    const n = wsBadgeCount(L || {}, B.stat), tier = B.tiers.reduce((t, x, i) => (n >= x ? i : t), -1), next = B.tiers[tier + 1];
    out.push({ id, name: B.name, unit: B.unit || '', note: B.note || '', count: n, tier, next: next ?? null, nextTier: next == null ? null : tier + 1, left: next == null ? 0 : next - n });
  }
  return out;
}

// ---------- 1 つの頼み（op）を持ち物に当てる ----------
// op：{ t: 'send', items: [[物, 数]] } チェストへ送る・{ t: 'craft', recipe } 作る・{ t: 'trade', trade, times } 交換・{ t: 'open', got: [物, 数], tier } 宝箱を開けた（中身は受け口が先に決めた）
//     { t: 'gain', items, src } 遊ぶで手に入れた物（受け口が、釣れた時・宝を掘った時・おてつだいをぜんぶした時に積む）。頼みと同じ列に時刻の順で並ぶ
// L（村人の持ち物 inv・枠 slots・badges・level）を書きかえる（できた時だけ）。store があればチェストへ入れる。{ ok, why?, text?, toStore? }
export function applyOp(config, L, op, store = null) {
  const slots = L.slots || (L.inv || []).length || 3, inv = (L.inv || []).map((s) => (s ? { ...s } : null)), toStore = {};
  while (inv.length < slots) inv.push(null);
  const fail = (why) => ({ ok: false, why });
  const nm = (k) => wsName(config, k);
  if (!op || typeof op !== 'object') return fail('形がちがう');
  let text = '';
  if (op.t === 'send') {
    const list = Array.isArray(op.items) ? op.items : [];
    if (!list.length || list.length > 12) return fail('形がちがう');
    for (const [it, n] of list) {
      if (!wsItem(config, it) || wsTool(it) || !Number.isInteger(n) || n < 1 || n > 999) return fail('送れない物');
      if (!takeFrom(inv, it, n)) return fail(`${nm(it)}が足りない`);
      toStore[it] = (toStore[it] || 0) + n;
    }
    text = list.map(([it, n]) => `${nm(it)}${n > 1 ? ` ${n} 個` : ''}`).join('・');
  } else if (op.t === 'craft') {
    const CC = (config && config.crafting) || {}, r = CC.recipes && CC.recipes[op.recipe], T = r && wsTool(op.recipe);
    if (!r || !T) return fail('ない道具');
    const lock = recipeLock(config, op.recipe, L);
    if (lock) return fail(lock.text);
    const cur = inv.findIndex((s) => s && wsTool(s.item) && wsTool(s.item).kind === T.kind);
    if (cur >= 0 && WS_TIER_ORDER.indexOf(wsTool(inv[cur].item).tier) >= WS_TIER_ORDER.indexOf(T.tier)) return fail('同じか、もっと良い物を持っている');
    const before = invCounts(inv), p = craftUse(before, r, CC);
    if (!p.ok) return fail('材料が足りない：' + Object.entries(p.missing).map(([k, n]) => `${nm(k)} あと ${n}`).join('・'));
    for (const k of Object.keys(before)) { const d = before[k] - (p.after[k] || 0); if (d > 0) takeFrom(inv, k, d); }
    if (cur >= 0) { toStore[inv[cur].item] = 1; inv[cur] = null; } // 前の道具は島のチェストへ
    for (const [k, n] of Object.entries(p.after)) { const d = n - (before[k] || 0); if (d > 0 && addTo(inv, slots, k, d, config) > 0) return fail('持ち物がいっぱい'); }
    const j = inv.findIndex((s, i) => !s && i < slots);
    if (j < 0) return fail('持ち物がいっぱい');
    const dur = ((CC.tiers || {})[T.tier] || {}).durability || 30;
    inv[j] = { item: op.recipe, dur, max: dur };
    text = nm(op.recipe);
  } else if (op.t === 'trade') {
    const T = (wsCfg(config).trades || []).find((x) => x.id === op.trade), times = op.times == null ? 1 : op.times;
    if (!T) return fail('ない交換');
    if (!Number.isInteger(times) || times < 1 || times > 10) return fail('形がちがう');
    if (T.need) { const have = L.badges && Number.isInteger(L.badges[T.need.badge]) ? L.badges[T.need.badge] : -1; if (have < T.need.tier) return fail('まだ交換できない'); }
    for (const [g, n] of Object.entries(T.give || {})) if (!takeGroup(config, inv, g, n * times)) return fail(`${WS_GROUPS[g] || nm(g)}が足りない`);
    for (const [it, n] of Object.entries(T.get || {})) {
      if (wsTool(it)) { const dur = ((((config && config.crafting) || {}).tiers || {})[wsTool(it).tier] || {}).durability || 30; for (let k = 0; k < n * times; k++) { const j = inv.findIndex((s, i) => !s && i < slots); if (j < 0) return fail('持ち物がいっぱい'); inv[j] = { item: it, dur, max: dur }; } }
      else if (addTo(inv, slots, it, n * times, config) > 0) return fail('持ち物がいっぱい');
    }
    text = Object.entries(T.get || {}).map(([it, n]) => `${nm(it)}${n * times > 1 ? ` ${n * times} 個` : ''}`).join('・');
  } else if (op.t === 'gain') { // 遊ぶで手に入れた（釣れた・宝箱をもらった・激レア）。受け口が積む。入らない分は島のチェストへ（できないことはない）
    const list = Array.isArray(op.items) ? op.items : [];
    if (!list.length || list.length > 12) return fail('形がちがう');
    for (const [it, n] of list) {
      if (!wsItem(config, it) || wsTool(it) || !Number.isInteger(n) || n < 1 || n > 99) return fail('形がちがう');
      const left = addTo(inv, slots, it, n, config);
      if (left) toStore[it] = (toStore[it] || 0) + left;
    }
    text = list.map(([it, n]) => `${nm(it)}${n > 1 ? ` ${n} 個` : ''}`).join('・');
  } else if (op.t === 'open') {
    if (!boxOk(config, op.got)) return fail('中身がちがう');
    if (!takeFrom(inv, 'treasure_box', 1)) return fail('宝箱がない');
    if (addTo(inv, slots, op.got[0], op.got[1], config) > 0) return fail('持ち物がいっぱい');
    text = `${nm(op.got[0])}${op.got[1] > 1 ? ` ${op.got[1]} 個` : ''}`;
  } else return fail('形がちがう');
  L.inv = inv;
  if (store) for (const [k, n] of Object.entries(toStore)) store[k] = (store[k] || 0) + n;
  return { ok: true, text, toStore };
}
// 手に入れた物（釣った物・宝箱・激レア）を入れる。入らなかった分 { 物: 数 } を返す（毎日の更新はチェストへ）
export function applyGains(config, L, gains) {
  const slots = L.slots || (L.inv || []).length || 3, over = {};
  L.inv = L.inv || [];
  for (const [it, n] of gains) { if (!wsItem(config, it) || wsTool(it)) continue; const left = addTo(L.inv, slots, it, n, config); if (left) over[it] = (over[it] || 0) + left; }
  return over;
}
// まだ毎日の更新に入っていない分を足した、今の持ち物（受け口・画面の見本）。ops の順に確かめ、できない物は ok: false
export function simulate(config, L0, gains, ops) {
  const L = { ...L0, inv: (L0.inv || []).map((s) => (s ? { ...s } : null)) };
  applyGains(config, L, gains || []);
  const results = (ops || []).map((op) => ({ id: op.id, ...applyOp(config, L, op, null) }));
  return { L, results };
}

// ---------- 宝箱と激レア（抽選は受け口。rnd は 0〜1 を返す関数） ----------
export const boxTiers = (config) => ((wsCfg(config).box || {}).tiers || []);
const pickW = (list, rnd) => { let sum = 0; for (const x of list) sum += x[2] ?? 1; let r = rnd() * sum; for (const x of list) { r -= x[2] ?? 1; if (r < 0) return x; } return list[list.length - 1]; };
export function rollBox(config, rnd) {
  const T = boxTiers(config); let r = rnd(), t = T[T.length - 1];
  for (const x of T) { r -= x.p; if (r < 0) { t = x; break; } }
  const [item, n] = pickW(t.items, rnd);
  return { tier: t.id, item, n };
}
// 帯に並べる物（本当の確率で引いた物。stop の所が当たり）
export function boxStrip(config, rnd, got, len = 44, stop = 37) { const a = []; for (let i = 0; i < len; i++) { const x = i === stop ? got : rollBox(config, rnd); a.push([x.item, x.n, x.tier]); } return a; }
export function boxOk(config, got) { return Array.isArray(got) && boxTiers(config).some((t) => t.items.some(([k, n]) => k === got[0] && n === got[1])); }
export const tierOfItem = (config, item) => { for (const t of boxTiers(config)) if (t.items.some(([k]) => k === item)) return t.id; return isLegend(config, item) ? 'legend' : null; };
// 激レア：釣り（fishP）・宝探し（treasureP）。当たれば物の key、外れは null
export function rollLegend(config, src, rnd) {
  const G = wsCfg(config).legend || {}, p = src === 'treasure' ? G.treasureP : G.fishP, list = src === 'treasure' ? G.treasure : G.fish;
  if (!(p > 0) || !Array.isArray(list) || !list.length || rnd() >= p) return null;
  return pickW(list.map(([k, w]) => [k, 1, w]), rnd)[0];
}
// ==== 工房の決まり：ここまで ====

// 画面の言葉
// 宝箱の段は 5 つ：ふつう＝白・すこしレア＝緑・レア＝青・とてもレア＝紫・激レア＝黄（枠・光・帯の物のふちの色をそろえる。css の .t-<段> と同じ）
export const TIER_LOOK = { common: { name: 'ふつう', color: '#f4f1ea' }, uncommon: { name: 'すこしレア', color: '#4cc35a' }, rare: { name: 'レア', color: '#3f8fe6' }, epic: { name: 'とてもレア', color: '#a457e0' }, legend: { name: '激レア', color: '#f5c518' } };
export const pct = (p) => (p * 100 >= 10 ? Math.round(p * 100) : Math.round(p * 1000) / 10) + '%';
