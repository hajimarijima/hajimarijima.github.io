'use strict';
// 夜のできごと。敵（ゾンビ・スケルトン・クモ）が森の外から来て、見張りとどちらかが倒れるまで戦う。
// 乱数は「種 + 夜 + 日」で別に作るので、昼の結果（仕事・投票・関係）の流れは変えない。
// 村人は死なない。ケガをした人は次の日だけ休む。
const { makeRng, hashStr } = require('./rand');
const CB = require('../js/combat.js'); // 攻撃力・クリティカル・ひと晩の戦い（町の画面と同じ数字）

const MOBS = { zombie: 'ゾンビ', skeleton: 'スケルトン', spider: 'クモ' };
const FIRST_NIGHT = 2; // 1 日目の夜はまだ来ない（たき火のまわりで眠る最初の夜）

// 町の守りの強さ：建物の defense を足す
function defenseOf(world, config) {
  let d = 0;
  for (const b of world.buildings) d += (config.buildings[b.type] && config.buildings[b.type].defense) || 0;
  return d;
}

const mobText = (groups) => groups.map((g) => `${MOBS[g.type]} ${g.n} 体`).join('と');

// 1 晩ぶん進める。S = { day, seed, active, life, world, state, config, hist }
// 返す値は state.night に入る形（動画とサイトの夜の場面に使う）
function stepNight(S) {
  const { day, seed, active, life, world, config, hist } = S;
  if (!active.length || day < FIRST_NIGHT) return null;
  const R = makeRng(seed + ':night:' + day);
  const defense = defenseOf(world, config);
  const names = (keys) => keys.map((k) => active.find((v) => v.key === k).display);
  const diary = (k, s) => { const L = life[k]; if (L && L.diary.length && L.diary[L.diary.length - 1].day === day) L.diary[L.diary.length - 1].text += s; };

  // 見張り：ケガをしていない人から、毎晩入れかわりで選ぶ（守りの建物があると 1 人ふえる）
  const able = active.filter((v) => !(life[v.key] && life[v.key].hurt > day));
  const hasWatch = world.buildings.some((b) => ['watch', 'watchtower'].includes(b.type));
  const nGuard = Math.min(able.length, 1 + Math.floor(able.length / 6) + (hasWatch ? 1 : 0));
  // 前の晩に見張った人は、なるべく休ませる
  const last = new Set((S.state.night && S.state.night.guards) || []);
  // 24 時間の sim から：夜に起きていた人（S.guards）がそのまま見張りになる。外で寝ていた人（S.outside）は敵にケガをさせられることがある
  const shuffled = R.shuffle(able);
  // 見張りは 1 晩 2〜4 人（村人がふえると増える、上限 4）。夜に起きていた人（S.guards）から先に選ぶ。ほかの起きている人は家の近くにいる
  const nWatch = Math.min(able.length, 4, 2 + Math.floor(able.length / 8) + (hasWatch ? 1 : 0));
  const awake = new Set(Array.isArray(S.guards) ? S.guards : []);
  const guards = Array.isArray(S.guards)
    ? shuffled.slice().sort((a, b) => (awake.has(b.key) - awake.has(a.key)) || (last.has(a.key) - last.has(b.key))).slice(0, nWatch).map((v) => v.key)
    : shuffled.sort((a, b) => last.has(a.key) - last.has(b.key)).slice(0, nGuard).map((v) => v.key);
  const outside = (S.outside || []).filter((k) => life[k] && !guards.includes(k));
  const a = R.range(Math.PI * 0.85, Math.PI * 2.15); // 北・西・東の森から（南は海）
  const from = { x: +(Math.cos(a) * 52).toFixed(1), z: +(Math.min(12, Math.sin(a) * 52)).toFixed(1) };
  const night = { day, defense, guards, from, quiet: false, groups: [], count: 0, result: 'quiet', damage: [], hurt: [], hid: [] };

  // 静かな夜：守りが強いほど多い
  const quiet = Math.min(0.85, 0.2 + defense * 0.06);
  if (R.chance(quiet)) {
    night.quiet = true;
    for (const k of guards) diary(k, '夜の見張りをした。静かな夜だった。');
    return night;
  }
  // 来る数：日がたつほど少しふえ、守りが強いほど減る
  const base = R.int(2, 3 + Math.floor(day / 5));
  const count = Math.max(1, base - Math.floor(defense / 3) - (Array.isArray(S.guards) ? Math.floor(guards.length / 4) : 0)); // 起きている人が多いほど減る
  const kinds = [['zombie', 5], ['skeleton', day >= 3 ? 3 : 0], ['spider', day >= 4 ? 2 : 0]];
  const tally = {};
  for (let i = 0; i < count; i++) { const t = R.weighted(kinds); tally[t] = (tally[t] || 0) + 1; }
  night.groups = Object.keys(MOBS).filter((t) => tally[t]).map((t) => ({ type: t, n: tally[t] }));
  night.count = count;

  // 家のある人のうち何人かは、家に逃げ込む
  const homed = active.filter((v) => !guards.includes(v.key) && life[v.key] && life[v.key].home);
  night.hid = homed.filter((v) => hashStr(v.key + ':h' + day) % 3 === 0).map((v) => v.key).slice(0, 4);
  for (const k of night.hid) diary(k, '夜、外で物音がして家に逃げ込んだ。');

  // 戦い：見張りの装備（S.gear(key) → { weapon, shield }）で攻撃力が決まる。敵は逃げず、どちらかが全員倒れるまで戦う。
  // 体力がなくなった見張りは「たおれた」となり、ほかの見張りが代わる（村人は死なない：朝に家で目を覚まし、次の日は休む）
  const C = config.combat;
  const kills = {}, stats = {};
  const list = []; for (const g of night.groups) for (let i = 0; i < g.n; i++) list.push({ type: g.type });
  const gs = guards.map((k) => ({ key: k, ...((S.gear && S.gear(k)) || { weapon: null, shield: false }) }));
  const F = CB.fightNight({ mobs: list, guards: gs, C, rng: () => R.next() });
  night.fight = {
    gear: Object.fromEntries(gs.map((g) => [g.key, { weapon: g.weapon || null, shield: !!g.shield }])),
    mobs: F.mobs.map((m) => ({ type: m.type, max: m.max, hp: m.hp, fate: m.fate, by: m.by, round: m.round })),
    guards: F.guards, log: F.log, taken: F.taken, end: F.end,
  };
  night.down = F.down;
  night.drops = {};
  for (const m of F.mobs) {
    if (m.fate !== 'killed') continue;
    kills[m.by] = kills[m.by] || {}; kills[m.by][m.type] = (kills[m.by][m.type] || 0) + 1;
    for (const [it, n] of Object.entries(CB.rollDrops(m.type, C, () => R.next()))) night.drops[it] = (night.drops[it] || 0) + n;
  }
  for (const g of gs) {
    const mine = F.log.filter((e) => e.g === g.key && e.dmg);
    stats[g.key] = { hits: mine.length, crit: mine.filter((e) => e.crit).length, guard: F.log.filter((e) => e.g === g.key && e.guard).length, taken: F.taken[g.key] || 0, down: F.down.includes(g.key) };
  }
  night.kills = kills; night.stats = stats;

  const killedN = F.mobs.filter((m) => m.fate === 'killed').length;
  const raid = F.mobs.filter((m) => m.fate === 'raid');
  const killText = (t) => Object.keys(MOBS).filter((k) => t[k]).map((k) => `${MOBS[k]}を ${t[k]} 体`).join('、');
  const allKills = {}; for (const k in kills) for (const t in kills[k]) allKills[t] = (allKills[t] || 0) + kills[k][t];
  const fightText = killedN ? `${killText(allKills)}倒した。` : '';
  const myText = (k) => { const st = stats[k]; if (!st) return ''; let t = kills[k] ? `${killText(kills[k])}倒した。` : ''; if (st.crit) t += `クリティカル ${st.crit} 回。`; if (st.guard) t += `盾で ${st.guard} 回受けた。`; return t; };
  // 見張りの書き方：3 人までは名前を「と」でつなぐ。もっと多い時は「見張りの〇人」
  const gText = guards.length <= 3 ? names(guards).join('と') : `見張りの${guards.length}人`;

  // たおれた見張り：朝に家で目を覚まし、次の日は 1 日休む
  for (const k of F.down) {
    life[k].hurt = day + 1;
    night.hurt.push(k); night.damage.push({ kind: 'down', who: k });
  }
  const downText = F.down.length ? `${names(F.down).join('と')}は体力がつきてたおれ、朝に家で目を覚ました（1 日休む）。` : '';
  const diaryDown = (k) => (F.down.includes(k) ? '体力がつきてたおれた。朝、家で目を覚ました。明日は休む。' : '');

  if (F.end === 'won') {
    night.result = 'repelled';
    const sub = F.down.length && F.down.length < guards.length ? 'たおれた見張りの代わりに、ほかの見張りが戦った。' : '';
    hist('night', `${day}日目の夜、${mobText(night.groups)}が来たが、${gText}が${fightText || '戦って'}守りきった。${sub}${downText}`, { night: day, who: guards });
    for (const k of guards) diary(k, `夜の見張りで、${mobText(night.groups)}と戦った。${myText(k)}${diaryDown(k)}`);
    return night;
  }
  // 見張りが全員たおれた：残った敵が柵や建物を少し壊し、朝に消える（朝日でゾンビ・スケルトンは燃え、クモは森へ戻る）。だれも死なない
  night.result = 'damage';
  const dmg = [];
  const BNAME = { fence: '柵', wall: '石壁', gate: '門' };
  const bName = (b) => BNAME[b.type] || (config.buildings[b.type] && config.buildings[b.type].name) || '建物';
  const targets = world.buildings.filter((b) => b.type === 'fence' || b.type === 'wall').concat(world.buildings.filter((b) => b.type !== 'fence' && b.type !== 'wall'));
  const nBreak = Math.min(targets.length, Math.max(1, Math.ceil(raid.length / 2)));
  const broke = [];
  for (let i = 0; i < nBreak; i++) {
    const b = i === 0 && targets[0] && (targets[0].type === 'fence' || targets[0].type === 'wall') ? targets[0] : R.pick(targets);
    if (broke.includes(b)) continue;
    b.damage = (b.damage || 0) + 1; broke.push(b);
    night.damage.push({ kind: 'building', id: b.id, type: b.type });
  }
  if (broke.length) dmg.push(`${broke.map(bName).join('と')}を少し壊した`);
  const fields = (world.fields || []).filter((f) => f.stage > 0);
  if (fields.length && R.chance(0.5)) { const f = R.pick(fields); f.stage = 0; night.damage.push({ kind: 'field', id: f.id }); dmg.push('畑をひとつ荒らした'); }
  if (R.chance(0.4) && S.state.res && S.state.res.food > 2) { const n = Math.min(Math.floor(S.state.res.food), R.int(2, 5)); S.state.res.food -= n; night.damage.push({ kind: 'food', n }); dmg.push(`倉庫の食べ物を ${n} 減らした`); }
  // 外で寝ていた人は、ひっかかれることがある
  const sleeper = outside.filter((k) => !night.hurt.includes(k));
  if (sleeper.length && R.chance(0.5)) {
    const k = R.pick(sleeper);
    life[k].hurt = day + 1; night.hurt.push(k); night.damage.push({ kind: 'hurt', who: k });
    dmg.push(`外で寝ていた${names([k])[0]}がひっかかれた（1 日休む）`);
    diary(k, '外で寝ていたら敵にひっかかれて、ケガをした。明日は休む。');
  }
  const burn = raid.filter((m) => m.type !== 'spider').length, back = raid.length - burn;
  const dawn = [burn ? `${raid.some((m) => m.type === 'zombie') && raid.some((m) => m.type === 'skeleton') ? 'ゾンビとスケルトン' : raid.some((m) => m.type === 'zombie') ? 'ゾンビ' : 'スケルトン'}は朝日で燃え` : '', back ? 'クモは森へ戻った' : ''].filter(Boolean).join('、');
  for (const k of guards) diary(k, `夜の見張りで、${mobText(night.groups)}と戦った。${myText(k)}${diaryDown(k)}`);
  hist('night', `${day}日目の夜、${mobText(night.groups)}が来た。${gText}が${fightText}戦ったが、見張りがみんなたおれた。残った敵が${dmg.join('、')}。${dawn ? '朝になると' + dawn + (back ? '。' : 'た。') : ''}${downText}`, { night: day, who: guards });
  return night;
}

module.exports = { stepNight, defenseOf, MOBS, FIRST_NIGHT, mobText };
