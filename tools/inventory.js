'use strict';
// 村人の持ち物欄・レベル・枠の数（sim.js とテストで共通）
// 数は data/config.json の "inventory" にある。

const TOOLS = { axe: '斧', pickaxe: 'つるはし', hoe: 'くわ', shovel: 'シャベル', sword: '剣', fishing_rod: '釣りざお' };
// 道具の種類（wood_pickaxe → pickaxe）と段階（wood / stone / iron）
const toolKind = (item) => { if (!item) return null; const m = /^(?:(wood|stone|iron|gold|diamond)_)?(axe|pickaxe|hoe|shovel|sword|fishing_rod)$/.exec(item); return m ? m[2] : null; };
const toolTier = (item) => { const m = /^(wood|stone|iron|gold|diamond)_/.exec(item || ''); return m ? m[1] : toolKind(item) ? 'wood' : 'hand'; };

// レベル L に届くのに要る経験値の合計
function xpForLevel(L, cfg) { return L <= 1 ? 0 : Math.round(cfg.xpBase * Math.pow(L - 1, cfg.xpExp)); }
function levelFor(xp, cfg) { let L = 1; while (L < cfg.maxLevel && xp >= xpForLevel(L + 1, cfg)) L++; return L; }

// 枠の数：最初の数 + レベルの節目 + 在籍日数の節目（上限あり）
function slotCount(level, days, cfg) {
  const n = cfg.base + cfg.levelSlots.filter((l) => level >= l).length + cfg.daySlots.filter((d) => days >= d).length;
  return Math.min(cfg.max, n);
}

// まだ開いていない枠の条件を、近い順に並べる
function lockList(level, xp, days, xpPerDay, cfg) {
  const out = [];
  for (const l of cfg.levelSlots) if (level < l) out.push({ type: 'level', at: l, label: `Lv${l} で解放`, short: `Lv${l}`, eta: (xpForLevel(l, cfg) - xp) / Math.max(1, xpPerDay) });
  for (const d of cfg.daySlots) if (days < d) out.push({ type: 'days', at: d, label: `在籍 ${d} 日で解放`, short: `${d}日`, eta: d - days });
  out.sort((a, b) => a.eta - b.eta);
  const open = slotCount(level, days, cfg);
  return out.slice(0, Math.max(0, cfg.max - open)).map(({ eta, ...r }) => r);
}

// ---------- 持ち物 ----------
const isTool = (it) => !!(it && toolKind(it.item));
// 物ごとの 1 枠の上限（config.items の stack。木・石は 64、鉱石・魚・食べ物は 16、激レア・特別な物は 8、道具は 1）。
// sim.js が毎日 setItemStacks(config.items) で入れる。入れていない時は、呼んだ所の stack（config.inventory.stack）のまま
let ITEM_STACK = null;
function setItemStacks(items) { ITEM_STACK = items ? Object.fromEntries(Object.entries(items).filter(([, v]) => v && Number.isInteger(v.stack) && v.stack > 0).map(([k, v]) => [k, v.stack])) : null; }
const lim = (item, stack) => (ITEM_STACK && ITEM_STACK[item] ? Math.min(stack, ITEM_STACK[item]) : stack);
// 上限より多く重なっている枠を、空いた枠へ分ける（消さない。空きがなければそのまま持つ）
function splitOver(inv, slots) {
  ensureSize(inv, slots);
  for (let i = 0; i < inv.length; i++) {
    const s = inv[i]; if (!s || isTool(s)) continue;
    const st = lim(s.item, 1e9);
    while (s.n > st) { const j = inv.findIndex((x, k) => !x && k < slots); if (j < 0) break; const k = Math.min(st, s.n - st); inv[j] = { item: s.item, n: k }; s.n -= k; }
  }
  return inv;
}
function ensureSize(inv, slots) {
  while (inv.length < slots) inv.push(null);
  return inv;
}
function canFit(inv, slots, item, stack) {
  for (let i = 0; i < slots; i++) { const s = inv[i]; if (!s) return true; if (s.item === item && !isTool(s) && s.n < lim(item, stack)) return true; }
  return false;
}
// 入るだけ入れて、入らなかった数を返す
function addItem(inv, slots, item, n, stack) {
  ensureSize(inv, slots);
  stack = lim(item, stack);
  for (let i = 0; i < slots && n > 0; i++) {
    const s = inv[i];
    if (s && s.item === item && !isTool(s) && s.n < stack) { const k = Math.min(n, stack - s.n); s.n += k; n -= k; }
  }
  for (let i = 0; i < slots && n > 0; i++) {
    if (!inv[i]) { const k = Math.min(n, stack); inv[i] = { item, n: k }; n -= k; }
  }
  return n;
}
// tool は種類（axe / pickaxe / hoe）か、道具の名前（stone_axe など）
const sameTool = (s, tool) => s && (s.item === tool || (toolKind(s.item) && toolKind(s.item) === tool));
function hasTool(inv, tool) { return inv.some((s) => sameTool(s, tool)); }
function getTool(inv, kind) { return inv.find((s) => sameTool(s, kind)) || null; }
function removeTool(inv, kind) { const i = inv.findIndex((s) => sameTool(s, kind)); if (i >= 0) inv[i] = null; }
function addTool(inv, slots, tool, dur) {
  ensureSize(inv, slots);
  for (let i = 0; i < slots; i++) if (!inv[i]) { inv[i] = { item: tool, dur, max: dur }; return true; }
  return false;
}
// 道具を 1 回使う。こわれたら true
function useTool(inv, tool) {
  const s = inv.find((x) => sameTool(x, tool));
  if (!s) return false;
  s.dur -= 1;
  if (s.dur <= 0) { inv[inv.indexOf(s)] = null; return true; }
  return false;
}
// 道具以外をぜんぶ出す（倉庫へ置く）
function unload(inv) {
  const out = {};
  for (let i = 0; i < inv.length; i++) {
    const s = inv[i];
    if (s && !isTool(s)) { out[s.item] = (out[s.item] || 0) + s.n; inv[i] = null; }
  }
  // 道具を前へ詰める
  const tools = inv.filter(Boolean);
  for (let i = 0; i < inv.length; i++) inv[i] = tools[i] || null;
  return out;
}
const countItems = (inv) => inv.reduce((a, s) => (s && !isTool(s) ? a + s.n : a), 0);

// 1 日の仕事。produce() は 1 回の作業でとれる [[item, n], ...] を返す。
// いっぱいで入らない時は倉庫へ置きに行き（往復で tripCost 回ぶんの時間を使う）、残りを入れる。
function workDay({ inv, slots, budget, produce, onUnload, cfg }) {
  let actions = 0, trips = 0, t = budget;
  const got = {};
  while (t >= 1) {
    const items = produce();
    t -= 1; actions++;
    for (const [item, n0] of items) {
      if (!n0) continue;
      got[item] = (got[item] || 0) + n0;
      let n = addItem(inv, slots, item, n0, cfg.stack);
      if (n > 0) { // いっぱい → 置きに行く
        onUnload(unload(inv));
        trips++; t -= cfg.tripCost;
        n = addItem(inv, slots, item, n, cfg.stack);
      }
    }
  }
  return { actions, trips, got };
}

module.exports = { setItemStacks, splitOver, TOOLS, toolKind, toolTier, getTool, removeTool, xpForLevel, levelFor, slotCount, lockList, ensureSize, canFit, addItem, hasTool, addTool, useTool, unload, countItems, workDay, isTool };
