// 夜の戦い（sim.js・町の画面・fight.html で共通。three.js も DOM も使わない）。
//   数字は config.combat から出す：見張りの攻撃力は装備で決まり（素手＜道具・たいまつ＜木の剣＜石の剣＜鉄の剣…）、
//   クリティカルは決まった確率（攻撃力が高い装備ほど少し上がる）。乱数は呼ぶ側が渡す（同じ種なら同じ結果）。

// 装備の名前 → 攻撃力の段（'hand' | 'tool' | 剣の素材）
export function weaponKind(item) {
  if (!item) return 'hand';
  const m = /^(\w+)_sword$/.exec(item);
  if (m) return m[1];
  return 'tool'; // つるはし・斧・たいまつなど、剣でない物
}
export function attackOf(item, C) { const k = weaponKind(item); return C.atk[k] ?? C.atk.hand; }
export function critChance(item, C) { return Math.min(C.critMax ?? 0.4, C.critBase + Math.max(0, attackOf(item, C) - C.atk.hand) * C.critPerAtk); }

// 1 回の攻撃：{ dmg, crit }
export function rollHit(item, C, rng) {
  const atk = attackOf(item, C), crit = rng() < critChance(item, C);
  const r = rng(), spread = r < 0.3 ? -1 : r > 0.75 ? 1 : 0;
  const base = Math.max(1, atk + spread);
  return { dmg: crit ? Math.round(base * C.critMult) : base, crit };
}

// 文字列から決まった乱数を作る（fight.html 用。sim は自分の乱数を渡す）
export function seededRng(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ひと晩の戦い。mobs: [{ type }]、guards: [{ key, weapon, shield }]
// 返す値：{ mobs: [{ type, max, hp, fate: 'killed'|'fled'|'dawn', by, round }], log: [...], taken: { key: 受けたダメージ } }
//   log の 1 行：見張りの攻撃 { r, g, m, dmg, crit, kill?, flee? } ／ 敵の攻撃 { r, m, g, to: ダメージ } か { r, m, g, guard: true }
//   敵 i の相手は guards[i % 見張りの数]。相手の敵がいなくなった見張りは、残っている敵のうち先の番号を打つ
export function fightNight({ mobs, guards, C, rng }) {
  const M = mobs.map((m) => { const S = C.mobs[m.type] || C.mobs.zombie; return { type: m.type, max: S.hp, hp: S.hp, fate: null, by: null, round: null }; });
  const log = [], taken = {};
  if (!guards.length) { for (const m of M) m.fate = 'dawn'; return { mobs: M, log, taken }; }
  const alive = (m) => !m.fate;
  const rounds = C.rounds || 6;
  for (let r = 0; r < rounds && M.some(alive); r++) {
    guards.forEach((g, gi) => {
      let mi = M.findIndex((m, i) => alive(m) && i % guards.length === gi);
      if (mi < 0) mi = M.findIndex(alive);
      if (mi < 0) return;
      const m = M[mi], h = rollHit(g.weapon, C, rng);
      m.hp = Math.max(0, m.hp - h.dmg);
      const e = { r, g: g.key, m: mi, dmg: h.dmg, crit: h.crit };
      if (m.hp <= 0) { m.fate = 'killed'; m.by = g.key; m.round = r; e.kill = true; }
      else if (m.hp <= m.max * C.fleeAt && rng() < C.fleeP) { m.fate = 'fled'; m.by = g.key; m.round = r; e.flee = true; }
      log.push(e);
    });
    // 残った敵が、それぞれの相手をなぐる（盾があれば受けられることがある）
    M.forEach((m, mi) => {
      if (!alive(m)) return;
      const g = guards[mi % guards.length], S = C.mobs[m.type] || C.mobs.zombie;
      if (g.shield && rng() < C.shieldGuardP) { log.push({ r, m: mi, g: g.key, guard: true }); return; }
      const to = Math.max(1, S.atk + (rng() < 0.3 ? 1 : 0));
      taken[g.key] = (taken[g.key] || 0) + to;
      log.push({ r, m: mi, g: g.key, to });
    });
  }
  for (const m of M) if (!m.fate) m.fate = 'dawn';
  return { mobs: M, log, taken };
}

// 倒した敵の落とし物（config.combat.mobs[type].drops = { 物: [最小, 最大] }）
export function rollDrops(type, C, rng) {
  const D = (C.mobs[type] || {}).drops || {}, out = {};
  for (const [it, [a, b]] of Object.entries(D)) { const n = a + Math.floor(rng() * (b - a + 1)); if (n > 0) out[it] = n; }
  return out;
}

// バッジの段（tiers = [銅, 銀, 金, ダイヤ] の数）。届いていなければ -1
export function badgeTier(n, tiers) { let t = -1; tiers.forEach((v, i) => { if (n >= v) t = i; }); return t; }
