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
//     防具とストーン：{ t: 'armor', part, mat, holes, aid }・{ t: 'wear' | 'scrap', armor }・{ t: 'socket', armor, hole, stone }・{ t: 'unsocket', armor, hole }・{ t: 'crush', stone }・{ t: 'reroll', stone, lock?, mods }
//     （holes・aid・mods は受け口が決める。gain の stones・open の stone は見つけたストーン）
// L（村人の持ち物 inv・枠 slots・badges・level）を書きかえる（できた時だけ）。store があればチェストへ入れる。{ ok, why?, text?, toStore? }
export function applyOp(config, L, op, store = null) {
  const slots = L.slots || (L.inv || []).length || 3, inv = (L.inv || []).map((s) => (s ? { ...s } : null)), toStore = {};
  while (inv.length < slots) inv.push(null);
  const fail = (why) => ({ ok: false, why });
  const nm = (k) => wsName(config, k);
  if (!op || typeof op !== 'object') return fail('形がちがう');
  let text = '', gear = null; // 防具とストーン（L.kit）。さわった時だけ書きもどす
  if (GEAR_OPS.includes(op.t)) {
    gear = gearOf(L);
    const r = applyGear(config, inv, gear, op, L);
    if (!r.ok) return r;
    L.inv = inv; L.kit = gear;
    return { ok: true, text: r.text, toStore };
  }
  const addStones = (list) => { if (!list) return true; if (!Array.isArray(list) || list.length > 4 || !list.every((s) => stoneOk(config, s))) return false; gear = gear || gearOf(L); for (const s of list) gearAddStone(config, gear, s); return true; };
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
    if ((!list.length && !(Array.isArray(op.stones) && op.stones.length)) || list.length > 12) return fail('形がちがう');
    if (!addStones(op.stones)) return fail('形がちがう'); // 遊びで見つけたストーン
    for (const [it, n] of list) {
      if (!wsItem(config, it) || wsTool(it) || !Number.isInteger(n) || n < 1 || n > 99) return fail('形がちがう');
      const left = addTo(inv, slots, it, n, config);
      if (left) toStore[it] = (toStore[it] || 0) + left;
    }
    text = list.map(([it, n]) => `${nm(it)}${n > 1 ? ` ${n} 個` : ''}`).concat((op.stones || []).map(() => 'ストーン')).join('・');
  } else if (op.t === 'open') {
    if (!boxOk(config, op.got)) return fail('中身がちがう');
    if (op.stone != null && !addStones([op.stone])) return fail('中身がちがう');
    if (!takeFrom(inv, 'treasure_box', 1)) return fail('宝箱がない');
    if (addTo(inv, slots, op.got[0], op.got[1], config) > 0) return fail('持ち物がいっぱい');
    text = `${nm(op.got[0])}${op.got[1] > 1 ? ` ${op.got[1]} 個` : ''}${op.stone ? '・ストーン' : ''}`;
  } else return fail('形がちがう');
  L.inv = inv;
  if (gear) L.kit = gear;
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
  if (L0.kit) L.kit = gearOf(L0);
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
export function rollLegend(config, src, rnd, mul = 1) {
  const G = wsCfg(config).legend || {}, p = (src === 'treasure' ? G.treasureP : G.fishP) * mul, list = src === 'treasure' ? G.treasure : G.fish;
  if (!(p > 0) || !Array.isArray(list) || !list.length || rnd() >= p) return null;
  return pickW(list.map(([k, w]) => [k, 1, w]), rnd)[0];
}

// ---------- 防具とストーン ----------
// 防具：頭（かんむり。兜で顔をかくさない）・胴・脚・足 × 革・鎖（丸石）・鉄・金・ダイヤ。材料を集めればいつでも作れる（お金は使わない）。
//   作るたびに穴が 0〜3 個できる（数は受け口が決めて op.holes に入れる。画面は決めない）
// ストーン：防具の穴にはめる。色は宝箱と同じ 5 段。ごくまれにユニーク（ふつうの石に付かないモッドが 1 つ）。モッドは 1〜4 個・同じ石に同じモッドは付かない。
//   値には幅があり、色が上がるほど上限が上がる。同じ系統（攻め・守り・くらし）の石を 3 つはめるとセット効果
// かけら：いらない石を砕くと出る。10 個でモッドをぜんぶ振り直し・15 個で 1 つ固定して振り直し（新しいモッドは受け口が決めて op.mods に入れる）
// 持ち物の L.kit = {（L.gear は鍛冶職人の防具なので別） armor: [{ id, part, mat, holes, st: [石 | null] }], on: { 部位: 防具の id }, stones: [石], shards, sf（かけらの端数） }
//   石 = { id, c: 色, f: 系統（atk・def・life）, m: [[モッド, 値]], u?: [ユニークのモッド, 値] }
// 戦い・敵・ボスはまだないので、攻め・守りは数を持って見せるだけ。くらしのうち live の物は今も効く（受け口と画面で）
export const GEAR_DEF = {
  parts: { head: { name: 'かんむり', n: 3, def: 1 }, chest: { name: 'よろい', n: 5, def: 3 }, legs: { name: 'すねあて', n: 4, def: 2 }, feet: { name: 'くつ', n: 2, def: 1 } },
  mats: { leather: { name: '革', item: 'leather', mul: 1, def: 1 }, chain: { name: '鎖', item: 'cobble', mul: 3, def: 2 }, iron: { name: '鉄', item: 'iron', mul: 1, def: 3 }, gold: { name: '金', item: 'gold', mul: 1, def: 2 }, diamond: { name: 'ダイヤ', item: 'diamond', mul: 1, def: 4 } },
  holes: [0.35, 0.35, 0.22, 0.08],
  colors: [['common', 0.62, 1], ['uncommon', 0.22, 1.35], ['rare', 0.1, 1.75], ['epic', 0.04, 2.25], ['legend', 0.02, 3]],
  modCount: [0.5, 0.3, 0.15, 0.05],
  uniqueP: 0.002,
  drop: { box: 0.08, treasure: 0.1, fish: 0.03 },
  shards: { common: 1, uncommon: 2, rare: 4, epic: 7, legend: 12, unique: 20 },
  reroll: 10, rerollLock: 15, maxArmor: 16, maxStones: 40,
  sets: { atk: [['atk', 8], ['crit', 3]], def: [['hp', 8], ['armor', 8]], life: [['walk', 4], ['shard', 10]] },
};
export const gearCfg = (config) => ({ ...GEAR_DEF, ...(((config && config.workshop) || {}).gear || {}) });
export const GEAR_PARTS = ['head', 'chest', 'legs', 'feet'];
export const GEAR_MATS = ['leather', 'chain', 'iron', 'gold', 'diamond'];
export const GEAR_FAM = { atk: '攻め', def: '守り', life: 'くらし' };
// モッド：[系統, 名前, 下限, 上限（白の時）, 単位, 説明]。u_ はユニークの石だけ（色で上限は変わらない）
export const GEAR_MODS = {
  atk: ['atk', '攻撃力', 2, 6, '%', ''], aspd: ['atk', '攻撃速度', 2, 5, '%', ''], crit: ['atk', '会心率', 1, 4, '%', ''], critd: ['atk', '会心ダメージ', 5, 15, '%', ''],
  multi: ['atk', '連撃', 1, 4, '%', 'たまに 2 回当たる'], mob: ['atk', '敵モブへのダメージ', 3, 8, '%', ''], boss: ['atk', 'ボスへのダメージ', 3, 8, '%', ''],
  hp: ['def', '体力', 2, 6, '%', ''], armor: ['def', '防御', 2, 6, '%', ''], regen: ['def', '自動回復', 1, 3, '', '10 秒ごとに体力が回復'], leech: ['def', '吸収', 1, 3, '%', '与えたダメージの一部で回復'],
  dodge: ['def', '回避', 1, 4, '%', ''], bosshp: ['def', 'ボス戦の体力', 3, 8, '%', ''],
  gather: ['life', '採掘・木こりの速さ', 3, 8, '%', ''], fish: ['life', '釣りで良い物', 2, 6, '%', '激レアが出やすい'], dig: ['life', '宝探しで良い物', 2, 6, '%', '宝箱の段が上がりやすい'],
  walk: ['life', '歩く速さ', 2, 5, '%', ''], xp: ['life', '経験値', 3, 8, '%', ''], chore: ['life', 'おてつだいの報酬', 3, 8, '%', '宝箱がもう 1 つ出ることがある'], shard: ['life', 'かけら', 5, 15, '%', '砕いた時のかけらが増える'],
  u_star: ['atk', '流れ星', 10, 20, '%', '会心のあと、次の一撃も会心'], u_wall: ['def', '不動', 1, 1, '回', '倒れる一撃を 1 日に耐える'],
  u_gold: ['life', '黄金の手', 3, 8, '%', '宝箱の段が 1 つ上がる'], u_find: ['life', '石読み', 20, 50, '%', 'ストーンが見つかりやすい'],
};
// 今も効くモッド（くらし）。ほかは戦いができたら効く
export const GEAR_LIVE = ['fish', 'dig', 'walk', 'chore', 'shard', 'u_gold', 'u_find'];
const GID = /^[A-Za-z0-9]{4,24}$/;
const pickI = (ps, rnd) => { let r = rnd(); for (let i = 0; i < ps.length; i++) { r -= ps[i]; if (r < 0) return i; } return ps.length - 1; };
export const armorName = (config, part, mat) => { const G = gearCfg(config); return `${(G.mats[mat] || {}).name || mat}の${(G.parts[part] || {}).name || part}`; };
export const armorIcon = (part, mat) => `armor_${mat}_${part}`;
export const stoneIcon = (s) => (s && s.u ? 'stone_unique' : `stone_${(s && s.c) || 'common'}`);
export function armorCost(config, part, mat) { const G = gearCfg(config), P = G.parts[part], M = G.mats[mat]; return P && M ? { [M.item]: P.n * M.mul } : null; }
export const armorDef = (config, part, mat) => { const G = gearCfg(config); return ((G.parts[part] || {}).def || 0) * ((G.mats[mat] || {}).def || 0); };
const colorMul = (config, c) => { const x = gearCfg(config).colors.find((y) => y[0] === c); return x ? x[2] : 0; };
// そのモッドがその色で取れる幅 [下限, 上限]
export function modRange(config, key, c) { const M = GEAR_MODS[key]; if (!M) return null; if (key.startsWith('u_')) return [M[2], M[3]]; return [M[2], Math.max(M[2], Math.round(M[3] * colorMul(config, c)))]; }
export const modText = (key, v) => { const M = GEAR_MODS[key]; return M ? `${M[1]} +${v}${M[4]}` : key; };
export const holesP = (config) => gearCfg(config).holes;
export function rollHoles(config, rnd) { return pickI(holesP(config), rnd); }
const modVal = (config, key, c, rnd) => { const [a, b] = modRange(config, key, c); return a + Math.min(b - a, Math.floor(rnd() * (b - a + 1))); };
// keep（[[モッド, 値]]）は残し、同じ系統から n 個になるまで足す（同じモッドは付けない）
export function rollMods(config, f, c, n, rnd, keep = []) {
  const out = keep.map((x) => [x[0], x[1]]), pool = Object.keys(GEAR_MODS).filter((k) => !k.startsWith('u_') && GEAR_MODS[k][0] === f && !out.some((x) => x[0] === k));
  while (out.length < n && pool.length) { const k = pool.splice(Math.min(pool.length - 1, Math.floor(rnd() * pool.length)), 1)[0]; out.push([k, modVal(config, k, c, rnd)]); }
  return out;
}
export function rollStone(config, rnd, id) {
  const G = gearCfg(config), c = G.colors[pickI(G.colors.map((x) => x[1]), rnd)][0];
  let f = ['atk', 'def', 'life'][Math.min(2, Math.floor(rnd() * 3))], u = null;
  if (rnd() < G.uniqueP) { const U = Object.keys(GEAR_MODS).filter((k) => k.startsWith('u_')), k = U[Math.min(U.length - 1, Math.floor(rnd() * U.length))]; f = GEAR_MODS[k][0]; u = [k, modVal(config, k, c, rnd)]; }
  const s = { id, c, f, m: rollMods(config, f, c, 1 + pickI(G.modCount, rnd), rnd) };
  if (u) s.u = u;
  return s;
}
// 振り直し：数はそのまま。lock（モッドの名前）があればそれだけ残す
export function rerollMods(config, s, lock, rnd) { const keep = lock ? s.m.filter((x) => x[0] === lock) : []; return rollMods(config, s.f, s.c, s.m.length, rnd, keep); }
const modsOk = (config, f, c, m) => Array.isArray(m) && m.length >= 1 && m.length <= 4 && new Set(m.map((x) => x && x[0])).size === m.length &&
  m.every((x) => Array.isArray(x) && x.length === 2 && GEAR_MODS[x[0]] && !x[0].startsWith('u_') && GEAR_MODS[x[0]][0] === f && Number.isInteger(x[1]) && x[1] >= modRange(config, x[0], c)[0] && x[1] <= modRange(config, x[0], c)[1]);
export function stoneOk(config, s) {
  if (!s || typeof s !== 'object' || !GID.test(String(s.id)) || !colorMul(config, s.c) || !GEAR_FAM[s.f] || !modsOk(config, s.f, s.c, s.m)) return false;
  if (s.u != null) { const R = Array.isArray(s.u) && String(s.u[0]).startsWith('u_') && GEAR_MODS[s.u[0]] && GEAR_MODS[s.u[0]][0] === s.f ? modRange(config, s.u[0], s.c) : null; if (!R || !Number.isInteger(s.u[1]) || s.u[1] < R[0] || s.u[1] > R[1]) return false; }
  return true;
}
const cleanStone = (s) => { const o = { id: s.id, c: s.c, f: s.f, m: s.m.map((x) => [x[0], x[1]]) }; if (s.u) o.u = [s.u[0], s.u[1]]; return o; };
export function gearOf(L) {
  const g = (L && L.kit) || {};
  return { armor: (g.armor || []).map((a) => ({ ...a, st: (a.st || []).map((s) => (s ? cleanStone(s) : null)) })), on: { ...(g.on || {}) }, stones: (g.stones || []).map(cleanStone), shards: g.shards || 0, sf: g.sf || 0 };
}
// つけている防具の合計（はめた石のモッド・セット効果・守りの数）
export function gearStats(config, gear) {
  const G = gearCfg(config), g = gear || {}, on = g.on || {}, sum = {}, fams = { atk: 0, def: 0, life: 0 }, sets = {};
  let def = 0, n = 0;
  for (const a of g.armor || []) {
    if (!a || on[a.part] !== a.id) continue;
    def += armorDef(config, a.part, a.mat);
    for (const s of a.st || []) { if (!s) continue; n++; fams[s.f] = (fams[s.f] || 0) + 1; for (const [k, v] of s.m || []) sum[k] = (sum[k] || 0) + v; if (s.u) sum[s.u[0]] = (sum[s.u[0]] || 0) + s.u[1]; }
  }
  for (const [f, c] of Object.entries(fams)) { const k = Math.floor(c / 3); if (k) { sets[f] = k; for (const [m, v] of G.sets[f] || []) sum[m] = (sum[m] || 0) + v * k; } }
  return { sum, sets, def, n, fams };
}
// 体に重ねる見た目（js/character.js の setArmor）。{ head: '素材#色', crown: true, body, legs, feet }。つけていない所は入れない
export const GEAR_LOOK = { leather: '#9a6234', chain: '#8e9399', iron: '#d3d8de', gold: '#efb726', diamond: '#45d6cf' };
export function kitLook(L) {
  const g = (L && L.kit) || {}, on = g.on || {}, out = {}, slot = { head: 'head', chest: 'body', legs: 'legs', feet: 'feet' };
  for (const a of g.armor || []) if (a && on[a.part] === a.id && GEAR_LOOK[a.mat] && slot[a.part]) out[slot[a.part]] = a.mat + GEAR_LOOK[a.mat];
  if (out.feet) out.feet = out.feet.replace(/#(w{6})/, (m, h) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.82).toString(16).padStart(2, '0')).join('')); // くつは少し暗く（すねあてとの境目が見える）
  if (out.head) out.crown = true; // 頭はかんむり（兜で顔と髪をかくさない）
  return out;
}
// 今も効くモッドの倍（上限つき）。例：gearBoost(st, 'walk') → 1.08
const BOOST_CAP = { walk: 30, fish: 100, dig: 60, chore: 60, shard: 200, u_gold: 30, u_find: 200 };
export const gearBoost = (st, key) => 1 + Math.min(BOOST_CAP[key] || 100, (st && st.sum && st.sum[key]) || 0) / 100;
// 宝箱の段を 1 つ上げる（黄金の手・宝探しで良い物）。上の段の物から 1 つ
export function bumpBox(config, g, rnd) { const T = boxTiers(config), i = T.findIndex((x) => x.id === g.tier); if (i < 0 || i >= T.length - 1) return g; const t = T[i + 1], [item, n] = pickW(t.items, rnd); return { tier: t.id, item, n }; }
// 手に入れた石を入れる。いっぱいならかけらにする（なくさない）
function gearAddStone(config, gear, s) { const G = gearCfg(config); if (gear.stones.length < G.maxStones) { gear.stones.push(cleanStone(s)); return 0; } const k = (G.shards[s.c] || 1) + (s.u ? G.shards.unique : 0); gear.shards += k; return k; }
function findStone(gear, id) {
  const i = gear.stones.findIndex((s) => s.id === id); if (i >= 0) return { s: gear.stones[i], i };
  for (const a of gear.armor) { const j = (a.st || []).findIndex((s) => s && s.id === id); if (j >= 0) return { s: a.st[j], a, j }; }
  return null;
}
// 防具とストーンの頼み（applyOp から）。gear を書きかえる。{ ok, why?, text? }
function applyGear(config, inv, gear, op, L) {
  const G = gearCfg(config), fail = (why) => ({ ok: false, why }), nm = (k) => wsName(config, k);
  const arm = (id) => gear.armor.find((a) => a.id === id);
  if (op.t === 'armor') {
    const cost = armorCost(config, op.part, op.mat);
    if (!cost || !Number.isInteger(op.holes) || op.holes < 0 || op.holes >= G.holes.length || !GID.test(String(op.aid)) || arm(op.aid)) return fail('形がちがう');
    if (gear.armor.length >= G.maxArmor) return fail('防具がいっぱい（いらない防具を手放してね）');
    for (const [it, n] of Object.entries(cost)) if (countOf(inv, it) < n) return fail(`材料が足りない：${nm(it)} あと ${n - countOf(inv, it)}`);
    for (const [it, n] of Object.entries(cost)) takeFrom(inv, it, n);
    gear.armor.push({ id: op.aid, part: op.part, mat: op.mat, holes: op.holes, st: Array.from({ length: op.holes }, () => null) });
    if (!arm(gear.on[op.part])) gear.on[op.part] = op.aid; // その部位に何もつけていなければ、すぐつける
    return { ok: true, text: armorName(config, op.part, op.mat) };
  }
  if (op.t === 'wear') { const a = arm(op.armor); if (!a) return fail('ない防具'); gear.on[a.part] = a.id; return { ok: true, text: armorName(config, a.part, a.mat) }; }
  if (op.t === 'scrap') {
    const a = arm(op.armor); if (!a) return fail('ない防具');
    const back = (a.st || []).filter(Boolean);
    if (gear.stones.length + back.length > G.maxStones) return fail('ストーンがいっぱい（先に砕いてね）');
    for (const s of back) gear.stones.push(s);
    gear.armor = gear.armor.filter((x) => x !== a); if (gear.on[a.part] === a.id) delete gear.on[a.part];
    return { ok: true, text: armorName(config, a.part, a.mat) };
  }
  if (op.t === 'socket' || op.t === 'unsocket') {
    const a = arm(op.armor); if (!a) return fail('ない防具');
    if (!Number.isInteger(op.hole) || op.hole < 0 || op.hole >= a.holes) return fail('ない穴');
    const old = a.st[op.hole];
    if (op.t === 'unsocket') { if (!old) return fail('石がない'); if (gear.stones.length >= G.maxStones) return fail('ストーンがいっぱい'); gear.stones.push(old); a.st[op.hole] = null; return { ok: true, text: 'ストーン' }; }
    const i = gear.stones.findIndex((s) => s.id === op.stone); if (i < 0) return fail('ないストーン');
    a.st[op.hole] = gear.stones.splice(i, 1)[0]; if (old) gear.stones.push(old);
    return { ok: true, text: 'ストーン' };
  }
  if (op.t === 'crush') {
    const i = gear.stones.findIndex((s) => s.id === op.stone); if (i < 0) return fail('ないストーン（はめている石は外してから）');
    const s = gear.stones[i], base = (G.shards[s.c] || 1) + (s.u ? G.shards.unique : 0), tot = base * gearBoost(gearStats(config, gear), 'shard') + (gear.sf || 0), got = Math.floor(tot + 1e-9);
    gear.sf = Math.round((tot - got) * 1000) / 1000; gear.shards += got; gear.stones.splice(i, 1);
    return { ok: true, text: `かけら ${got} 個`, got };
  }
  if (op.t === 'reroll') {
    const F = findStone(gear, op.stone); if (!F) return fail('ないストーン');
    const s = F.s, cost = op.lock ? G.rerollLock : G.reroll;
    if (gear.shards < cost) return fail(`かけらが足りない（あと ${cost - gear.shards} 個）`);
    if (op.lock && !s.m.some((x) => x[0] === op.lock)) return fail('ないモッド');
    if (!modsOk(config, s.f, s.c, op.mods) || op.mods.length !== s.m.length) return fail('形がちがう');
    if (op.lock) { const k = s.m.find((x) => x[0] === op.lock); if (!op.mods.some((x) => x[0] === k[0] && x[1] === k[1])) return fail('形がちがう'); }
    s.m = op.mods.map((x) => [x[0], x[1]]); gear.shards -= cost;
    return { ok: true, text: 'ストーン' };
  }
  return fail('形がちがう');
}
export const GEAR_OPS = ['armor', 'wear', 'scrap', 'socket', 'unsocket', 'crush', 'reroll'];
// ==== 工房の決まり：ここまで ====

// 画面の言葉
// 宝箱の段は 5 つ：ふつう＝白・すこしレア＝緑・レア＝青・とてもレア＝紫・激レア＝黄（枠・光・帯の物のふちの色をそろえる。css の .t-<段> と同じ）
export const TIER_LOOK = { common: { name: 'ふつう', color: '#f4f1ea' }, uncommon: { name: 'すこしレア', color: '#4cc35a' }, rare: { name: 'レア', color: '#3f8fe6' }, epic: { name: 'とてもレア', color: '#a457e0' }, legend: { name: '激レア', color: '#f5c518' } };
export const pct = (p) => (p * 100 >= 10 ? Math.round(p * 100) : Math.round(p * 1000) / 10) + '%';
