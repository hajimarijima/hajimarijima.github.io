'use strict';
// 夜のできごと。敵（ゾンビ・スケルトン・クモ）が森の外から来て、見張りが追い払う。
// 乱数は「種 + 夜 + 日」で別に作るので、昼の結果（仕事・投票・関係）の流れは変えない。
// 村人は死なない。ケガをした人は次の日だけ休む。
const { makeRng, hashStr } = require('./rand');

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
  const guards = Array.isArray(S.guards) ? S.guards.filter((k) => able.some((v) => v.key === k)) : shuffled.sort((a, b) => last.has(a.key) - last.has(b.key)).slice(0, nGuard).map((v) => v.key);
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

  // たいまつ 2 本ぶん + 見張り 1 人 2 + 守りの建物
  const power = guards.length * 2 + defense + 2;
  const gText = names(guards).join('と');
  const lead = names(guards.slice(0, 1))[0];
  if (power >= count * 1.3) {
    night.result = 'repelled';
    hist('night', `${day}日目の夜、${mobText(night.groups)}が来たが、${guards.length > 1 ? lead + 'たち' : lead}が追い払った。朝になると敵は森へ帰った。`, { night: day, who: guards });
    for (const k of guards) diary(k, `夜の見張りで、${mobText(night.groups)}をたいまつで追い払った。`);
    return night;
  }
  // 守りきれなかった：小さな被害（ケガ・畑・食べ物）。だれも死なない
  night.result = 'damage';
  const dmg = [];
  const fields = (world.fields || []).filter((f) => f.stage > 0);
  if (fields.length && R.chance(0.7)) { const f = R.pick(fields); f.stage = 0; night.damage.push({ kind: 'field', id: f.id }); dmg.push('畑がひとつ荒らされた'); }
  if (R.chance(0.5) && S.state.res && S.state.res.food > 2) { const n = Math.min(Math.floor(S.state.res.food), R.int(2, 5)); S.state.res.food -= n; night.damage.push({ kind: 'food', n }); dmg.push(`倉庫の食べ物が ${n} 減った`); }
  const pool = guards.concat(outside);
  if (pool.length && (!dmg.length || R.chance(0.35))) {
    const k = R.pick(pool);
    life[k].hurt = day + 1; // 次の日は休む
    night.hurt.push(k); night.damage.push({ kind: 'hurt', who: k });
    dmg.push(`${names([k])[0]}が軽いケガをした（1 日休む）`);
    diary(k, guards.includes(k) ? '夜の見張りでケガをした。明日は休む。' : '外で寝ていたら敵にひっかかれて、ケガをした。明日は休む。');
  }
  if (!dmg.length) dmg.push('みんな無事だった');
  for (const k of guards) if (!night.hurt.includes(k)) diary(k, `夜の見張りで、${mobText(night.groups)}と戦った。`);
  hist('night', `${day}日目の夜、${mobText(night.groups)}が来た。${gText}がたいまつで追い払ったが、${dmg.join('、')}。朝日でゾンビは燃え、ほかは森へ帰った。`, { night: day, who: guards });
  return night;
}

module.exports = { stepNight, defenseOf, MOBS, FIRST_NIGHT, mobText };
