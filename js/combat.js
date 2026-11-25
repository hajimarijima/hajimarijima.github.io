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

// ひと晩の戦い：敵は逃げず、どちらかが全員倒れるまで戦う。mobs: [{ type }]、guards: [{ key, weapon, shield }]
// 返す値：{ mobs: [{ type, max, hp, fate: 'killed'|'raid', by, round }], guards: [{ key, max, hp, down: 倒れた回 | null }],
//          log: [...], taken: { key: 受けたダメージ }, down: [倒れた見張り], end: 'won'|'lost' }
//   log の 1 行：見張りの攻撃 { r, g, m, dmg, crit, kill? } ／ 敵の攻撃 { r, m, g, to, down? } か { r, m, g, guard: true }
//   敵 i の相手は、その回に立っている見張りの i 番目（数で割った余り）。見張りは自分を相手にしている敵のうち先の番号を打つ。
//   見張りが倒れると、ほかの見張りが代わりに相手をする。全員倒れたら残った敵は 'raid'（柵や建物を少し壊して朝に消える）
export function fightNight({ mobs, guards, C, rng }) {
  const M = mobs.map((m) => { const S = C.mobs[m.type] || C.mobs.zombie; return { type: m.type, max: S.hp, hp: S.hp, fate: null, by: null, round: null }; });
  const G = guards.map((g) => ({ key: g.key, max: C.guardHp || 20, hp: C.guardHp || 20, down: null }));
  const log = [], taken = {};
  const alive = (m) => !m.fate, up = (g) => g.down === null;
  const cap = C.maxRounds || 80; // 念のための上限（ふつうはその前にどちらかが倒れる）
  let r = 0;
  for (; r < cap && M.some(alive) && G.some(up); r++) {
    const standing = guards.map((g, gi) => gi).filter((gi) => up(G[gi]));
    const foe = (mi) => standing[mi % standing.length];
    standing.forEach((gi) => {
      let mi = M.findIndex((m, i) => alive(m) && foe(i) === gi);
      if (mi < 0) mi = M.findIndex(alive);
      if (mi < 0) return;
      const m = M[mi], h = rollHit(guards[gi].weapon, C, rng);
      m.hp = Math.max(0, m.hp - h.dmg);
      const e = { r, g: guards[gi].key, m: mi, dmg: h.dmg, crit: h.crit };
      if (m.hp <= 0) { m.fate = 'killed'; m.by = guards[gi].key; m.round = r; e.kill = true; }
      log.push(e);
    });
    // 残った敵が、それぞれの相手をなぐる（盾があれば受けられることがある）
    M.forEach((m, mi) => {
      if (!alive(m)) return;
      const gi = foe(mi), g = guards[gi], S = C.mobs[m.type] || C.mobs.zombie;
      if (!up(G[gi])) return; // この回にもう倒れている
      if (g.shield && rng() < C.shieldGuardP) { log.push({ r, m: mi, g: g.key, guard: true }); return; }
      const to = Math.max(1, S.atk + (rng() < 0.3 ? 1 : 0));
      taken[g.key] = (taken[g.key] || 0) + to;
      G[gi].hp = Math.max(0, G[gi].hp - to);
      const e = { r, m: mi, g: g.key, to };
      if (G[gi].hp <= 0) { G[gi].down = r; e.down = true; }
      log.push(e);
    });
  }
  const won = !M.some(alive);
  for (const m of M) if (!m.fate) { m.fate = 'raid'; m.round = r; }
  return { mobs: M, guards: G, log, taken, down: G.filter((g) => !up(g)).map((g) => g.key), end: won ? 'won' : 'lost' };
}

// 画面で見せる用：戦いの記録を「回ごと・敵ごと」に並べ直す（fight.html と町で共通）
// 返す値：{ R: 回の数, rounds: [回][敵] = { foe: 相手の見張り, hit: { g, dmg, crit, kill } | null, atk: { g, to?, guard?, down? } | null },
//          killAt: [敵] = 倒れた回 | null, downAt: { 見張り: たおれた回 }, end }
export function roundsOf(F) {
  const R = F.log.length ? Math.max(...F.log.map((e) => e.r)) + 1 : 0;
  const nM = F.mobs.length, rounds = [], foe = new Array(nM).fill(null);
  for (let r = 0; r < R; r++) rounds.push(Array.from({ length: nM }, () => ({ foe: null, hit: null, atk: null })));
  for (const e of F.log) {
    const X = rounds[e.r][e.m];
    if (e.dmg) X.hit = { g: e.g, dmg: e.dmg, crit: e.crit, kill: !!e.kill };
    else X.atk = { g: e.g, to: e.to, guard: !!e.guard, down: !!e.down };
  }
  for (let r = 0; r < R; r++) for (let m = 0; m < nM; m++) {
    const X = rounds[r][m];
    if (X.atk) foe[m] = X.atk.g; else if (foe[m] === null && X.hit) foe[m] = X.hit.g;
    X.foe = foe[m];
  }
  // 最初の回に相手が決まっていない敵は、あとで最初に決まった相手を使う
  for (let m = 0; m < nM; m++) { let f = null; for (let r = R - 1; r >= 0; r--) { if (rounds[r][m].foe) f = rounds[r][m].foe; else rounds[r][m].foe = f; } }
  const killAt = F.mobs.map((mb) => (mb.fate === 'killed' ? mb.round : null));
  const downAt = {}; for (const g of F.guards || []) if (g.down !== null) downAt[g.key] = g.down;
  return { R, rounds, killAt, downAt, end: F.end };
}

// 倒した敵の落とし物（config.combat.mobs[type].drops = { 物: [最小, 最大] }）
export function rollDrops(type, C, rng) {
  const D = (C.mobs[type] || {}).drops || {}, out = {};
  for (const [it, [a, b]] of Object.entries(D)) { const n = a + Math.floor(rng() * (b - a + 1)); if (n > 0) out[it] = n; }
  return out;
}

// バッジの段（tiers = [銅, 銀, 金, ダイヤ] の数）。届いていなければ -1
export function badgeTier(n, tiers) { let t = -1; tiers.forEach((v, i) => { if (n >= v) t = i; }); return t; }

// バッジの数を村人の記録から読む。stat は 'kills.total' / 'gathered.wood' / 'built'（配列は数）など。
// 'kills' のように入れ物だけなら .total を使う
export function badgeCount(L, stat) {
  let v = L;
  for (const p of String(stat).split('.')) v = v == null ? undefined : v[p];
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') v = v.total;
  return Math.floor(Number(v) || 0);
}

// その村人がいま持っているはずのバッジ { id: 段 }。founder のバッジは段なし（0 だけ）
export function badgesOf(L, v, BG) {
  const out = {};
  if (!BG || !L) return out;
  for (const [id, B] of Object.entries(BG.list)) {
    if (B.founder) { if (v && v.joinedDay <= B.founder) out[id] = 0; continue; }
    const t = badgeTier(badgeCount(L, B.stat), B.tiers);
    if (t >= 0) out[id] = t;
  }
  return out;
}
