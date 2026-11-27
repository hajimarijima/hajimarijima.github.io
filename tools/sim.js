#!/usr/bin/env node
'use strict';
// 町を 1 日進める。
// 使い方: node tools/sim.js [--days N] [--demo] [--inbox ファイル]
//   --demo      フォロワー数と投票コメントを見本で作る（インスタにつなぐ前の確かめ用）
//   --inbox     instagram.js が書いた JSON（既定: data/inbox/instagram.json があれば使う）
//   --gate      daily.yml 用。0 日目のあいだは、config.json の startAt を過ぎた時か --start（環境変数 TOWN_START=true）の時だけ進める
//   --now 日時  テスト用（今の時刻を決める）
// 乱数は state.seed と日付で決まるので、同じ入力なら同じ結果になる。
const fs = require('fs');
const path = require('path');
const { makeRng, hashStr } = require('./rand');
const SO = require('./social');
const ST = require('./store'); // world.json は地図の文字、日記は人ごとのファイル
const TM = require('../js/tilemap.js');
const P = require('./people');
const I = require('./inventory');
const N = require('./night');
const O = require('./ores');
const CR = require('./craft');
const HR = require('../js/hours.js');
const CON = require('../js/construction.js'); // 材料 → 部品 → 建てる（土台・壁・屋根）
const CB = require('../js/combat.js'); // 夜の戦い・バッジの段 // 1 日 24 時間の行動の記号と数の決まり
const W = require('./welcome'); // 新しく来た人を迎える決まり・町を始める日の決まり（join.js と共通）
const IS = require('../js/island.js'); // 島の形（どこが陸か・まだ行けない島・橋）
const BASE = require('./base'); // 拠点の場所の投票（0 日目）
const FZ = require('./fishsize'); // 釣った魚の大きさと釣りランキング
const SMT = require('../js/smithing.js'); // 鍛冶屋と鍛冶職人（道具の作り直し・防具）
const TN = require('../js/tents.js'); // テント（家のない人の寝床。1 つに何人・いくつまで）
const OM = require('./oremode'); // 鉱石の持ち方（自分で持つ／島の倉庫）。コメントと web の設定（data/inbox/play.json）
const EV = require('../js/islandevents.js'); // 島の行事（冬祭りなど）と誕生日パーティ
const ORE_ITEMS = new Set(Object.values(O.ORE_ITEM)); // 石炭・鉄・金・ダイヤ（自分で持つ人は、チェストに入れない）
// 村のまん中（拠点）。前のデータは (0, -1)
const ctrOf = (world) => (world && world.square ? { x: world.square.x, z: world.square.z } : { x: 0, z: -1 });

const ROOT = path.join(__dirname, '..');
const DATA = process.env.TOWN_DATA || path.join(ROOT, 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const read = (f, d) => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d; };
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 1) + '\n');

const RES = ['wood', 'stone', 'food'];
const RES_JA = { wood: '木材', stone: '石', food: '食べ物' };
let ITEMS0 = {};
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const jst = (date, hh = 0) => date + 'T' + String(hh).padStart(2, '0') + ':00:00+09:00';
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function area(p, world) {
  const isl = world && world.islands && IS.islandName(world, p.x, p.z);
  if (isl) return isl + 'の';
  if (world && world.islands) return IS.shoreDist(world.islands[0], p.x, p.z) < 14 ? '海べの' : p.x > 18 && p.z < -18 ? '北東の' : p.x < -22 ? '西の森の' : p.x > 22 ? '東の森の' : p.z < -22 ? '北の森の' : '村はずれの';
  if (p.z > 28) return '海べの';
  if (p.x > 18 && p.z < -18) return '北東の';
  if (p.x < -30) return '西の森の';
  if (p.x > 30) return '東の森の';
  if (p.z < -30) return '北の森の';
  return '村はずれの';
}

// 「どこに建てる？」の 3 つの候補。空いている区画から、海のそば・森の入口・広場の近くを 1 つずつ
function siteOptions(world, state) {
  const used = new Set(world.buildings.map((b) => b.plot));
  // まだ橋がかかっていない島の区画は、候補に出さない
  const openIsl = (id) => !id || IS.isOpen((world.islands || []).find((i) => i.id === id));
  const free = world.plots.map((p, i) => ({ x: p.x, z: p.z, plot: i, island: p.island })).filter((p) => !used.has(p.plot) && openIsl(p.island));
  const C = ctrOf(world);
  const r = (p) => Math.hypot(p.x - C.x, p.z - C.z);
  const isl = (p) => (p.island && world.islands ? IS.islandName(world, p.x, p.z) : '');
  const trees = (p) => world.trees.filter((t) => !t.gone && t.state === 'tree' && Math.hypot(t.x - p.x, t.z - p.z) < 9).length;
  const mainFree = free.filter((p) => !p.island);
  const sea = (mainFree.length ? mainFree : free).slice().sort((a, b) => b.z - a.z || r(a) - r(b))[0];
  const mid = free.filter((p) => p !== sea && !p.island).sort((a, b) => r(a) - r(b))[0] || free.find((p) => p !== sea);
  const forest = free.filter((p) => p !== sea && p !== mid && p.z < 10).sort((a, b) => trees(b) - trees(a) || r(b) - r(a))[0] || free.find((p) => p !== sea && p !== mid);
  const dir = (p) => (Math.abs(p.x - C.x) > Math.abs(p.z - C.z) ? (p.x > C.x ? '東' : '西') : (p.z < C.z ? '北' : '南'));
  return [
    { name: '海のそば', x: sea.x, z: sea.z, plot: sea.plot },
    { name: (isl(forest) || dir(forest)) + 'の森の入口', x: forest.x, z: forest.z, plot: forest.plot },
    { name: '広場の近く', x: mid.x, z: mid.z, plot: mid.plot },
  ];
}

function stepDay(S) {
  const { config, villagers, world, state, life, history, inbox, demo, hidden } = S;
  ITEMS0 = config.items;
  const day = state.day + 1;
  const date = addDays(state.startDate, day - 1);
  const R = makeRng(state.seed + ':day:' + day);
  const hist = (type, text, extra) => history.push({ day, date, type, text, ...(extra || {}) });
  const B = (t) => config.buildings[t];
  // 前の形のデータ（フォロワーの節目で投票・建てる順番の列）から、毎回投票で決める形へ
  if (!Array.isArray(state.votes)) state.votes = [];
  if (!state.pool) state.pool = config.firstChoices.concat(config.choicePool);
  if (!('plan' in state)) state.plan = null;
  delete state.queue; delete state.repeatIdx;
  if (!world.square) world.square = { x: 0, z: -1, r: 8, leveled: day > 1 ? 1 : 0 };
  if (!world.debris) world.debris = [];
  if (!world.chest) world.chest = { x: 5.2, z: 0.6, day: 0 };
  if (!world.animals) world.animals = [];
  if (!state.firsts) state.firsts = {};
  // 拠点の場所の投票（0 日目）は、1 日目にする時に締めて決める（tools/base.js）。拠点にチェスト・たき火・広場を置き、区画も拠点のまわりに作り直す
  const baseDecided = BASE.decideBase(S, { day, now: S.now || new Date(), hist });
  // 釣り・畑・動物は別の乱数（ここが増えても、木・岩・投票の流れは変わらない）
  const R2 = makeRng(state.seed + ':farm:' + day);
  // 動物を追う・しとめる・子が生まれるも別の乱数（ほかの流れは変えない）。島の決まり「動物は攻撃すると逃げる。肉は柵で囲ってから」
  const RH = makeRng(state.seed + ':hunt:' + day);
  const HU = config.hunting && config.hunting.enabled !== false ? config.hunting : null;
  // 釣った魚の大きさも別の乱数（大きさを足しても、ほかの流れは変わらない）。島の新記録は魚ごとに 1 日 1 行（同じ日にまた破られたら、その行を書きかえる）
  const RF = makeRng(state.seed + ':fishsize:' + day), recToday = {};
  const fishCatch = (v, L, c, it) => {
    const FC = config.fishing || {}, sz = FC.sizes && FC.sizes[it];
    if (!sz) return;
    const cm = FZ.rollSize(sz, RF), nm = ITEMS0[it] ? ITEMS0[it].name : it;
    const ent = [it, cm];
    (c.fishCm = c.fishCm || []).push(ent);
    if (it === 'fish_maguro' && first('maguro', `${v.display}が、海べで ${cm}cm のマグロを釣り上げた！ 島ではじめてのマグロ`, { who: [v.key], item: it, cm })) c.notes.push(`${cm}cm のマグロが釣れた！ 島ではじめて。`); // ごくまれな大物
    const r = FZ.addCatch(state, L, v.key, it, cm, day, FC.rankKeep || 10);
    if (!r.record) return;
    ent.push(1); // 町の画面で「新記録！」と見せる印
    const text = `${v.display}が ${cm}cm の${nm}を釣った！ 島の新記録`;
    if (recToday[it]) Object.assign(recToday[it], { text, who: [v.key], cm });
    else { hist('fish', text, { who: [v.key], item: it, cm }); recToday[it] = history[history.length - 1]; }
    c.notes.push(`${cm}cm の${nm}を釣り上げた。島の新記録！（前は ${r.prev}cm）`);
  };
  // 「はじめて」の出来事は、町の歴史に 1 回だけ書く
  const first = (key, text, extra) => { if (state.firsts[key]) return false; state.firsts[key] = day; hist('first', text, extra); return true; };
  // 切り株・新しい木・草の畑・体力とおなかは、また別の乱数（ほかの流れを変えない）
  const R3 = makeRng(state.seed + ':needs:' + day);
  if (!world.treeSeq) world.treeSeq = world.trees.reduce((m, t) => Math.max(m, (+String(t.id).slice(1) || 0) + 1), 0);
  // 掘り出した・朽ちた切り株は次の日に消す。その場所は noGrow に残して、もう木を生やさない（新しい順に 600 か所まで）
  if (!world.noGrow) world.noGrow = [];
  for (const t of world.trees) if (t.state === 'removed' && t.removedDay < day && t.cutDay) world.noGrow.push([t.x, t.z]);
  const NG_MAX = world.islands ? 2000 : 600; // 小さな島は同じ所を何度も使うので、長く覚えておく
  if (world.noGrow.length > NG_MAX) world.noGrow.splice(0, world.noGrow.length - NG_MAX);
  world.trees = world.trees.filter((t) => !(t.state === 'removed' && t.removedDay < day));
  world.trees.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // 保存した地図から読んだ時と同じ順（何日まとめて進めても同じ結果）
  world.rocks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 近くを探すための「マスごとの一覧」（空間ハッシュ）。全部の木や岩を調べずに、周りのマスだけを見る
  const IX = {
    trees: TM.SpatialHash.of(world.trees, 4), rocks: TM.SpatialHash.of(world.rocks, 4),
    fields: TM.SpatialHash.of(world.fields, 4), slots: TM.SpatialHash.of(world.fieldSlots || [], 4),
    noGrow: TM.SpatialHash.of(world.noGrow.map(([x, z]) => ({ x, z })), 4),
  };
  const addTree = (t) => { world.trees.push(t); IX.trees.set(t, t.x, t.z); return t; };
  // 建物（建てる場所も）のまわり clearBlocks ブロックには、木も岩も置かない・生やさない（無限の地形と同じ決まり）
  const clearR = ((config.terrain && config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5;
  const nearBuilding = (x, z, extra = 0) => world.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < clearR + extra)
    || !!(state.plan && state.plan.site && state.plan.site.plot !== 'ring' && Math.hypot(state.plan.site.x - x, state.plan.site.z - z) < clearR + extra);
  // 島の形の町（world.islands）：陸かどうか・まだ行けない島は js/island.js で決める。橋のたもとと橋の上には何も生やさない
  const ISL = !!world.islands;
  const nearBridge = (x, z) => (world.bridges || []).some((b) => IS.bridgeDist(b, x, z) < 6);
  const reach = ISL ? (o) => IS.reachable(world, o.x, o.z) : () => true;
  // 空いている場所（建物のまわり・村のまん中・池・海・木・岩・畑を避ける）。木の生えかわりと草の畑で使う
  const freeSpot = (r0, r1, what) => {
    for (let k = 0; k < 60; k++) {
      let x, z;
      if (r1) { const a = R3.range(0, Math.PI * 2), r = R3.range(r0, r1); x = world.square.x + Math.cos(a) * r; z = world.square.z + Math.sin(a) * r; }
      else if (ISL) { const p = IS.randomLand(world, () => R3.next(), 5.5, 1); if (!p) continue; x = p.x; z = p.z; } // 行ける島の上だけ
      else { x = R3.range(-100, 100); z = R3.range(-100, world.seaZ - 6); }
      if ((ISL ? !IS.onLand(world, x, z, 5.5) || nearBridge(x, z) : z > world.seaZ - 4) || nearBuilding(x, z, what === 'field' ? -clearR + 5 : 0)) continue;
      if (Math.hypot(x - world.square.x, z - world.square.z) < world.square.r + (what === 'field' ? 3 : 2.5)) continue;
      if (world.pond && Math.hypot(x - world.pond.x, z - world.pond.z) < world.pond.r + 3) continue;
      if (IX.trees.any(x, z, 3, (t) => !t.gone || t.state === 'removed')) continue;
      if (what === 'tree' && IX.noGrow.any(x, z, 2)) continue; // 切り株があった場所
      if (IX.rocks.any(x, z, 3.5, (r) => r.hp > 0)) continue;
      if (IX.fields.any(x, z, what === 'field' ? 2.4 : 3.5)) continue;
      if (IX.slots.any(x, z, 3)) continue;
      return { x: +x.toFixed(2), z: +z.toFixed(2) };
    }
    return null;
  };
  const clearAround = (x, z) => {
    for (const t of IX.trees.near(x, z, clearR - 1e-9, (t) => !t.gone)) { t.gone = 1; t.state = 'removed'; t.removedDay = day; }
    for (const r of IX.rocks.near(x, z, clearR - 1e-9, (r) => !r.gone && r.hp > 0)) { r.hp = 0; r.back = day + config.respawn.rockDays[0]; }
  };

  // ---- 1. 参加の登録（「参加したい」コメント） ----
  if (inbox && inbox.joinComments) {
    const enemiesOn = !!(config.enemies && config.enemies.enabled);
    for (const r of P.registrationsFrom(inbox.joinComments, config.joinWord, config.startTools, { enemies: enemiesOn })) {
      const v = P.upsertVillager(villagers, { igId: r.igId, username: r.username, joined: date, joinedDay: day, source: 'comment', startTool: r.startTool, birthday: r.birthday, food: r.food }, hidden);
      if (v) v._new = true;
    }
    // コメントで書いた誕生日・好きな食べ物・MBTI（あとから書いた値が勝つ。tools/people.js の applyCommentProfiles。join.js と同じ）
    P.applyCommentProfiles(villagers, [...inbox.joinComments, ...(inbox.voteComments || [])], { word: config.joinWord, startTools: config.startTools, mbti: config.mbtiOn !== false, enemies: enemiesOn });
  }
  // 町のアカウントの持ち主は村人にしない（join.js と同じ）
  W.removeOwners(S, W.ownerNames(inbox, config));
  for (const v of villagers) { P.applyPrivacy(v, hidden); P.fillJoinProfile(v); P.fitGenderSkin(v); } // 「住みたい」で来た人の誕生日・好きな食べ物（なければ足す）。名前で女性・男性と分かる人のスキン
  // 役職（仕事）の変更のコメント（join.js と同じ。もう読んだコメントは使わない）。道具の持ちかえは下の ensureLife
  if (inbox && inbox.joinComments) {
    const owners = W.ownerNames(inbox, config);
    // 日記は下の ensureLife（「仕事が◯◯になったので…」）が書く
    require('./jobs').applyJobChanges(S, [...inbox.joinComments, ...(inbox.voteComments || [])], { day, date, enemies: !!(config.enemies && config.enemies.enabled), owners, diary: false });
    // 鉱石の持ち方のコメント「鉱石 自分」「鉱石 倉庫」（tools/oremode.js）
    OM.applyOreComments(S, [...inbox.joinComments, ...(inbox.voteComments || [])], { day, date, owners });
  }
  // web の設定（me.html の鉱石・誕生日 → Worker → tools/play.js pull → data/inbox/play.json）。コメントと新しい方が勝つ
  if (S.play && S.play.settings) OM.applyPlaySettings(S, S.play.settings, { day, date });
  // 誕生日がまだない人には、名前の印（key）から決まった日を入れる（同じ人はいつも同じ。コメント「誕生日 3/14」で変えられる）
  for (const v of villagers) if (!v.birthday) v.birthday = P.autoBirthday(v.key);
  // 公開しない項目（firestore_sync.js が data/inbox/ に書く）は、書き出さない形で持つ
  for (const v of villagers) if (S.priv && S.priv[v.key]) Object.defineProperty(v, '_priv', { value: S.priv[v.key], enumerable: false, configurable: true });
  const active = villagers.filter((v) => v.joinedDay <= day);
  for (const v of active) {
    if (!life[v.key]) life[v.key] = { job: null, target: null, home: null, gathered: { wood: 0, stone: 0, food: 0 }, built: [], contrib: { wood: 0, stone: 0, food: 0 }, diary: [] };
  }
  // ---- 1.5 プロフィール（MBTI と誕生日）。本人の確かめは from.id で行う。年は受け取らない ----
  const RS = makeRng(state.seed + ':social:' + day); // 関係まわりは別の乱数（ほかの結果を変えない）
  const profComments = inbox && (inbox.profileComments || inbox.joinComments);
  if (profComments) {
    for (const p of SO.profilesFrom(profComments, config.profileWord || 'プロフ')) {
      const v = villagers.find((x) => x.igId && x.igId === P.igHash(p.igId));
      if (!v || (v.mbti === p.mbti && v.birthday === p.birthday)) continue;
      v.mbti = p.mbti; v.birthday = p.birthday; v.profileDay = day;
    }
  } else if (demo) {
    for (const v of active) {
      if (v.mbti || day < 2 || (hashStr('prof:' + v.key) % 9) !== day % 9) continue;
      v.mbti = RS.pick(SO.MBTI);
      v.birthday = RS.chance(0.45) ? addDays(state.startDate, RS.int(day + 1, 29)).slice(5) : String(RS.int(1, 12)).padStart(2, '0') + '-' + String(RS.int(1, 28)).padStart(2, '0');
      v.profileDay = day;
      // 見本：ほかの項目も、名前から決まった値で入れる（乱数の流れは変えない）
      const h = hashStr('prof2:' + v.key);
      if (h % 10 < 7) {
        const pf = {};
        pf.food = ['カレー', 'おにぎり', 'りんご', 'たまご焼き', 'パン', 'やきいも', 'シチュー', 'みかん'][h % 8];
        pf.color = ['#d9534f', '#3f78b8', '#e0b030', '#8e5bb5', '#2e9a8a', '#e07a3a', '#c2457a', '#5a8f3a'][(h >> 3) % 8];
        if ((h >> 6) % 3) pf.hobby = ['昼寝', '釣り', '星を見る', '歌', '木彫り', '散歩'][(h >> 8) % 6];
        if ((h >> 11) % 4 === 0) pf.wantJob = ['伐採', '採掘', '農業', '漁業', '牧場', '建築'][(h >> 13) % 6];
        if ((h >> 15) % 3 === 0) pf.message = ['よろしくね', 'みんなで大きな町にしよう', '朝が苦手です', '畑をひろげたい'][(h >> 17) % 4];
        v.profile = pf;
      }
    }
  }
  const newcomers = active.filter((v) => v.joinedDay === day || v._new);
  if (newcomers.length) hist('join', newcomers.map((v) => v.display).join('、') + ' が村に住むことになった。', { who: newcomers.map((v) => v.key) });
  for (const v of villagers) delete v._new;

  // ---- 2. フォロワー数 ----
  if (inbox && typeof inbox.followers === 'number') state.followers = inbox.followers;
  else if (demo) {
    const f = Math.round(5 + 1.8 * day + 0.05 * day * day + R.range(-2, 2));
    state.followers = Math.max(state.followers, f);
  }
  state.followerLog.push({ day, followers: state.followers });

  // ---- 3. 投票（建てる物・建てる場所・ときどき道具。どれも A/B/C） ----
  // 何を建てるかと、どこに建てるかは同じ日に、時間を分けて開く（同じ A/B/C でも、コメントの時刻で区別できる）
  const BV = config.buildVote;
  const diaryExtra = {}; // key -> 文
  let closedVoters = baseDecided ? baseDecided.who.slice() : [];
  if (baseDecided) for (const v of active) diaryExtra[v.key] = baseDecided.diary;
  const KIND_Q = { what: '何を建てる？', where: 'どこに建てる？', tool: 'どの道具を作る？' };
  const genDemo = (vote) => { // 見本の投票コメントを作る（締め切り後のコメントも混ぜて、数えないことを確かめる）
    vote.demoComments = vote.demoComments || [];
    const bias = vote.demoBias || (vote.demoBias = [R.range(0.6, 1.4), R.range(0.6, 1.4), R.range(0.6, 1.4)]);
    const t0 = Date.parse(vote.opensAt), t1 = Date.parse(vote.closesAt);
    const n = R.int(5, 10);
    for (let i = 0; i < n + 2; i++) {
      const named = active.filter((x) => x.name);
      const who = named.length && R.chance(0.45) ? R.pick(named).name : 'voter_' + R.int(1, 40);
      const ch = R.weighted([['A', bias[0]], ['B', bias[1]], ['C', bias[2]]]);
      const word = R.pick([ch, ch.toLowerCase(), String.fromCharCode(0xFF21 + ch.charCodeAt(0) - 65), ch + 'がいい', ch + '案で!', '断然' + ch]);
      const late = i >= n; // 締め切りのあとに来たコメント（数えない）
      const t = late ? t1 + R.range(60e3, 3 * 3600e3) : t0 + R.range(0, t1 - t0 - 60e3);
      vote.demoComments.push({ id: 'd' + day + '_' + vote.kind + '_' + i, text: word, timestamp: new Date(t).toISOString(), from: { id: 'demo-' + who, username: who } });
    }
  };
  const retally = (vote) => {
    const comments = (inbox && inbox.voteComments) || vote.demoComments || [];
    const tally = P.tallyVote(comments, { opensAt: vote.opensAt, closesAt: vote.closesAt });
    const manual = vote.manual || { A: 0, B: 0, C: 0 }; // 手で書いた票（data/state.json の votes[].manual）
    vote.counted = tally.votes;
    vote.votes = { A: tally.votes.A + (manual.A || 0), B: tally.votes.B + (manual.B || 0), C: tally.votes.C + (manual.C || 0) };
    vote.voters = tally.voters + (manual.A || 0) + (manual.B || 0) + (manual.C || 0);
    vote.timeline = tally.timeline;
    vote.commentCount = tally.comments;
    return tally;
  };
  // 特別な建物（時計台など）は、フォロワーの数では候補に入らない。入れる時は config の choicePool に手で足す
  // （コメントのリクエストは tools/requests.js で数えるだけで、投票は変えない）
  // 締め切った投票を決める（何を → どこに の順）
  const ORDER = { what: 0, where: 1, tool: 2 };
  for (const vote of state.votes.filter((v) => day >= v.closesDay).sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
    closedVoters = closedVoters.concat(retally(vote).who);
    const max = Math.max(vote.votes.A, vote.votes.B, vote.votes.C);
    const tops = ['A', 'B', 'C'].filter((k) => vote.votes[k] === max);
    const win = tops.length === 1 ? tops[0] : R.pick(tops);
    const opt = vote.options.find((o) => o.key === win);
    const total = vote.votes.A + vote.votes.B + vote.votes.C;
    const result = {
      kind: vote.kind, question: KIND_Q[vote.kind], key: win, name: opt.name, day, openedDay: vote.openedDay,
      votes: vote.votes, voters: vote.voters, tie: tops.length > 1,
      pct: Object.fromEntries(['A', 'B', 'C'].map((k) => [k, total ? Math.round((vote.votes[k] / total) * 1000) / 10 : 0])),
      options: vote.options, opensAt: vote.opensAt, closesAt: vote.closesAt, timeline: vote.timeline,
    };
    const tail = `（A ${vote.votes.A} 票・B ${vote.votes.B} 票・C ${vote.votes.C} 票、${vote.voters} 人が投票${tops.length > 1 ? '、同点のためくじ引き' : ''}）`;
    if (vote.kind === 'what') {
      result.build = opt.build;
      state.plan = { build: opt.build, day, site: null, leveled: 0 };
      const i = state.pool.indexOf(opt.build);
      if (i >= 0) { state.pool.splice(i, 1); if (!B(opt.build).unique) state.pool.push(opt.build); } // 何度も建つ物は列の後ろへ
      hist('vote_result', `「何を建てる？」の投票で「${win} ${opt.name}」に決まった${tail}。`, { kind: 'what', key: win, votes: vote.votes, voters: vote.voters });
      for (const v of active) diaryExtra[v.key] = (diaryExtra[v.key] || '') + `投票で${opt.name}を建てることに決まった。`;
    } else if (vote.kind === 'where') {
      const def = state.plan && B(state.plan.build);
      if (state.plan && !state.plan.site) {
        const farm = world.buildings.find((b) => b.type === 'farm');
        if (def.plot === 'ring') state.plan.site = { ...ctrOf(world), plot: 'ring', label: '町のまわり' };
        else if (def.plot === 'farm' && farm) state.plan.site = { x: +(farm.x + Math.cos(farm.rot) * 4.4).toFixed(2), z: +(farm.z - Math.sin(farm.rot) * 4.4).toFixed(2), plot: 'farm', label: '畑のとなり', rot: farm.rot };
        else if (def.plot && world.special[def.plot]) state.plan.site = { ...world.special[def.plot], plot: def.plot, label: def.plot === 'center' ? '町のまん中' : '海べ' };
        else state.plan.site = { x: opt.x, z: opt.z, plot: opt.plot, label: opt.name };
      }
      result.site = state.plan ? state.plan.site : null;
      const fixed = state.plan && state.plan.site && state.plan.site.label !== opt.name;
      hist('vote_result', `「どこに建てる？」の投票で「${win} ${opt.name}」に決まった${tail}。${fixed ? `${def.name}は${state.plan.site.label}にしか建てられないので、${state.plan.site.label}に建てる。` : ''}`, { kind: 'where', key: win, votes: vote.votes, voters: vote.voters });
    } else {
      result.recipe = opt.recipe;
      state.toolGoal = opt.recipe;
      hist('vote_result', `「どの道具を作る？」の投票で「${win} ${opt.name}」に決まった${tail}。`, { kind: 'tool', key: win, votes: vote.votes, voters: vote.voters });
    }
    state.decisions.push(result);
  }
  state.votes = state.votes.filter((v) => day < v.closesDay);
  // 新しい投票を開く（村人がいる時だけ）
  const builtTypes = world.buildings.map((b) => b.type);
  // 鍛冶屋：作業台と倉庫が建って minDay 日目をすぎたら（config.smithing.unlock）、「何を建てる？」の候補に入れる（次の 3 つの中）
  {
    const SMC = config.smithing, sb = SMC && SMC.building;
    if (sb && B(sb) && active.length && !state.pool.includes(sb) && !builtTypes.includes(sb) && !(state.plan && state.plan.build === sb) && SMT.smithyUnlocked(SMC, builtTypes, day)) {
      state.pool.splice(Math.min(2, state.pool.length), 0, sb);
      hist('event', `${B(sb).name}が「何を建てる？」の候補に入った。建つと、村人のひとりが鍛冶職人になって、道具や防具を作る。`, { buildingType: sb });
    }
  }
  // 動物に penAfterFails 回逃げられたら、「動物の柵」を「何を建てる？」の候補の前（次の 3 つの中）へ出す（1 回だけ）
  if (HU && B('pen') && active.length && !state.penAsked && (state.huntFails || 0) >= (HU.penAfterFails ?? 2) && !builtTypes.includes('pen') && !(state.plan && state.plan.build === 'pen')) {
    state.penAsked = day;
    const i = state.pool.indexOf('pen'); if (i >= 0) state.pool.splice(i, 1);
    state.pool.splice(Math.min(1, state.pool.length), 0, 'pen');
    hist('event', `動物は追いかけると逃げてしまう。「柵で囲ってから捕まえよう」という話になり、${B('pen').name}（木材 ${(B('pen').cost || {}).wood || 0}）が「何を建てる？」の候補の前に出た。`, { buildingType: 'pen' });
  }
  const choices = () => {
    const out = [];
    for (const b of state.pool) {
      if (out.includes(b) || (B(b).unique && (builtTypes.includes(b) || (state.plan && state.plan.build === b)))) continue;
      if (B(b).needs && !builtTypes.includes(B(b).needs)) continue; // 水路は畑ができてから
      out.push(b); if (out.length === 3) break;
    }
    return out;
  };
  const openVote = (kind, options, h0, h1) => {
    // 拠点の投票を今日締めた時は、それより前のコメントを数えない（同じ投稿に A/B/C が続いても区別できる）
    const bc = state.base && state.base.day === day && state.base.closesAt;
    const op = bc && Date.parse(bc) > Date.parse(jst(date, h0)) ? new Date(bc).toISOString() : jst(date, h0);
    const v = {
      kind, question: KIND_Q[kind], openedDay: day, closesDay: day + 1,
      opensAt: op, closesAt: h1 >= 24 ? jst(addDays(date, 1), h1 - 24) : jst(date, h1),
      options: options.map((o, i) => ({ key: 'ABC'[i], ...o })),
      votes: { A: 0, B: 0, C: 0 }, manual: { A: 0, B: 0, C: 0 }, voters: 0, timeline: [],
    };
    state.votes.push(v);
    return v;
  };
  if (!state.votes.length && active.length) {
    if (!state.plan) {
      const what = choices();
      if (what.length === 3) {
        const sites = siteOptions(world, state);
        const v1 = openVote('what', what.map((b) => ({ build: b, name: B(b).name })), BV.whatHours[0], BV.whatHours[1]);
        const v2 = openVote('where', sites, BV.whereHours[0], BV.whereHours[1]);
        hist('vote_open', `投票が始まった。「何を建てる？」（${v1.options.map((o) => o.key + ' ' + o.name).join(' / ')}、${BV.whatHours[0]}時〜${BV.whatHours[1]}時）と「どこに建てる？」（${v2.options.map((o) => o.key + ' ' + o.name).join(' / ')}、${BV.whereHours[0]}時〜${BV.whereHours[1]}時）。`, { kind: 'build' });
      }
    } else if (state.plan.site && builtTypes.includes(config.crafting.tiers.stone.needs) && day - (state.lastToolVote || 0) >= config.crafting.toolVoteEvery) {
      // 作業台がある時だけ、ときどき「どの道具を作る？」
      const recs = Object.entries(config.crafting.recipes).filter(([k, r]) => r.tier !== 'wood' && k !== state.toolGoal).slice(0, 3);
      if (recs.length === 3) {
        const v = openVote('tool', recs.map(([k, r]) => ({ recipe: k, name: ITEMS0[k].name, from: r.from })), BV.toolHours[0], BV.toolHours[1]);
        state.lastToolVote = day;
        hist('vote_open', `「どの道具を作る？」の投票が始まった（${v.options.map((o) => o.key + ' ' + o.name).join(' / ')}）。`, { kind: 'tool' });
      }
    }
  }
  for (const v of state.votes) { if (demo && !(inbox && inbox.voteComments)) genDemo(v); retally(v); }
  state.vote = state.votes[0] || null; // 前の形で読む画面のため

  // ---- 4. 天気 ----
  state.weather = R.weighted([['晴れ', 55], ['くもり', 25], ['雨', 20]]);
  const rain = state.weather === '雨';

  // ---- 5. 仕事を決める ----
  const built = builtTypes;
  const has = (t) => built.includes(t);
  const mult = { wood: 1 + state.bonus.wood, stone: 1 + state.bonus.stone, food: 1 + state.bonus.food };
  for (const t of built) { const bo = B(t).bonus; if (bo) for (const r of RES) mult[r] += bo[r] || 0; }
  const plan = state.plan;
  const cost = plan ? B(plan.build).cost : { wood: 20, stone: 8 }; // 何を建てるか決まる前は、木を多めに
  const IC = config.inventory;
  const ITEMS = config.items;
  const CC = config.crafting, GA = config.gather, RS2 = config.respawn;
  const NE = config.needs || { max: 20, hungerBase: 4, hungerWork: 5, eat: 10, starve: 2, regenAt: 14, regen: 2, restBelow: 8, restHeal: 8, restHunger: 2 };
  const GR = config.grass || { maxFields: 8, near: [12, 30] };
  if (!state.store) state.store = {};
  // チェスト（state.store）がそのまま町の持ち物。資源の数はチェストの中身から数える
  const VAL = (it) => (ITEMS[it] && ITEMS[it].value) || {};
  const syncRes = () => {
    state.res = { wood: 0, stone: 0, food: 0 };
    for (const r of RES) for (const it of config.spendOrder[r]) state.res[r] += (state.store[it] || 0) * (VAL(it)[r] || 0);
    for (const r of RES) state.resources[r] = Math.floor(state.res[r] + 1e-9);
  };
  const valueOf = (items) => { const v = { wood: 0, stone: 0, food: 0 }; for (const [it, n] of Object.entries(items)) { const val = VAL(it); for (const r of RES) v[r] += (val[r] || 0) * n; } return v; };
  const deposit = (items) => { for (const [it, n] of Object.entries(items)) if (n) state.store[it] = (state.store[it] || 0) + n; const v = valueOf(items); for (const r of RES) state.totals[r] = Math.round((state.totals[r] + v[r]) * 100) / 100; syncRes(); return v; };
  // チェストから使う（建てる・食べる）。足りた分だけ使って、足りなければ false
  const spend = (r, amount) => {
    let left = amount;
    for (const it of config.spendOrder[r]) {
      const per = VAL(it)[r]; if (!per || left <= 1e-9) continue;
      const k = Math.min(state.store[it] || 0, Math.ceil(left / per - 1e-9));
      state.store[it] = (state.store[it] || 0) - k; left -= k * per;
      if (!state.store[it]) delete state.store[it];
    }
    syncRes();
    return left <= 1e-9;
  };
  syncRes();
  const need = {};
  for (const r of RES) need[r] = Math.max(0, (cost[r] || 0) - state.resources[r]);
  need.food += Math.max(0, active.length * 4 - state.resources.food);
  // 遠出と寝る場所の決まり（config.hours.far）
  const FAR = config.hours.far || { near: 28, homeR: 28, treeR: 15 };

  const daysIn = (v) => day - v.joinedDay + 1;
  // 体力・持ち物・最初の道具（tools/welcome.js。15 分ごとの受付で迎える時と同じ決まり）
  const ensureLife = (L, v) => {
    const note = W.ensureLife(L, v, { day, life, config });
    if (note) diaryExtra[v.key] = (diaryExtra[v.key] || '') + note;
  };
  const ST = config.startTools || { options: [] };
  const startJob = (L) => { const o = ST.options.find((x) => x.id === L.startTool); return o ? o.job : null; };
  const haulText = (got) => Object.entries(got).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([it, n]) => `${ITEMS[it].name}${n}`).join('・');

  // 整地：最初の日は村のまん中、建てる場所が決まったらその場所。2 人までがする（終わるまで levelHours 人・時間）
  const levelJobs = [];
  if (active.length && !world.square.leveled) levelJobs.push({ target: 'square', at: world.square, r: world.square.r, what: '村のまん中', prog: world.square });
  if (plan && plan.site && !plan.leveled && plan.site.plot !== 'ring' && plan.site.plot !== 'farm') levelJobs.push({ target: 'site', at: plan.site, r: 4.2, what: `${B(plan.build).name}を建てる場所`, prog: plan });
  let leveler = 0;
  // チェストは最初の村人が来た日に置く
  if (active.length && !world.chest.day) { world.chest.day = day; hist('event', '村のまん中にチェストを置いた。集めた物は、ここに入れる。'); }

  const today = { weather: state.weather, jobs: { wood: 0, stone: 0, food: 0 }, gained: { wood: 0, stone: 0, food: 0 }, built: [], trips: 0, crafted: [], leveled: [] };
  // 立てたたいまつは燃えつきる：1 晩に burnPerNight 本ずつ減る（足りなくなれば、見張りがまた作る）
  if (config.guardGear && (state.store.torch || 0) > 0) {
    state.store.torch = Math.max(0, state.store.torch - (config.guardGear.burnPerNight ?? 1));
    if (!state.store.torch) delete state.store.torch;
    syncRes();
  }
  // ---- 5. 24 時間：1 時間に 1 つ行動する（数は config.json の hours） ----
  const H = config.hours;
  const R4 = makeRng(state.seed + ':hours:' + day); // 1 時間ごとの行動は別の乱数（投票・天気・生えかわりの流れを変えない）
  const CHRONO = ['朝型', '夜型'];
  const wetting = new Set(); // 今日水をやった畑（2 人が同じ畑に行かない）
  const takenFields = new Set(), takenBushes = new Set(), takenApple = new Set();
  const AP = config.apples; // りんごの木（数は config.json の apples）
  const bushCap = Math.ceil(world.bushes.length * (H.bushShare ?? 1));
  let ranchTaken = null; // 動物の世話は 1 日 1 人（もらえる物はその人がまとめて受け取る）
  const center = world.campfire;
  let huntN = 0; // 今日、動物を追った回数（村ぜんたい）
  // 柵の中で、しとめてよい動物（同じ種類が keepPerKind 頭より多い種類の、いちばん新しく来た 1 頭）
  const penPrey = () => {
    const inPen = world.animals.filter((a) => a.pen && world.buildings.some((b) => b.id === a.pen));
    const n = {}; for (const a of inPen) n[a.kind] = (n[a.kind] || 0) + 1;
    const ok = inPen.filter((a) => n[a.kind] > (HU.keepPerKind ?? 2)).sort((a, b) => n[b.kind] - n[a.kind] || (b.tamedDay || 0) - (a.tamedDay || 0) || (a.id < b.id ? -1 : 1));
    return ok[0] || null;
  };
  // 野の動物（行ける島の上で、村のまん中に近い 3 頭から、名前と日で 1 頭）
  const wildPrey = (c) => {
    const w = world.animals.filter((a) => !a.pen && (!ISL || IS.onLand(world, a.x, a.z, 0)));
    const o = center || { x: 0, z: 0 };
    w.sort((a, b) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x - o.x, b.z - o.z) || (a.id < b.id ? -1 : 1));
    return w.length ? w[hashStr(c.v.key + ':prey:' + day) % Math.min(3, w.length)] : null;
  };
  const claimT = new Map(), claimR = new Map(); // 木・岩 → 今たたいている人の数（新しく選ぶ時は避ける。手伝う時は入る）
  const claim = (m, id, d) => { const n = (m.get(id) || 0) + d; if (n > 0) m.set(id, n); else m.delete(id); };
  const torchOK = (L) => !!(H.torchItem && L.inv.some((s) => s && s.item === H.torchItem));
  const tierOf = (L, kind) => { const t = kind && I.getTool(L.inv, kind); return t ? I.toolTier(t.item) : 'hand'; };
  const KIND_OF = { chop: 'axe', stump: 'axe', dig: 'pickaxe', till: 'hoe', tend: 'hoe', harvest: 'hoe', fish: 'fishing_rod' };
  // 日記の時刻：0〜3 時は「夜中の」、4〜5 時は「まだ暗い」（夜の間だけ）
  const tm = (h) => (h < 4 ? `夜中の${h}時` : h < 6 && HR.isNight(h, H) ? `まだ暗い${h}時` : `${h}時`);
  const lateH = (h) => h >= 23 || h <= 3; // 「夜おそくまで」と言える時刻
  const FA0 = config.farming;
  const FOODS = Object.keys(ITEMS).filter((k) => VAL(k).food > 0);

  const ctxs = [];
  for (const v of active) {
    const L = life[v.key];
    ensureLife(L, v);
    L.targets = [];
    // 朝型・夜型（プロフィールで選べる。なければ名前から決まる）と、その人の寝る時刻
    L.chrono = W.chronoOf(v, H);
    const [b0, b1] = H.bedtime[L.chrono];
    const bedH = (b0 + (hashStr('bed:' + v.key) % (b1 - b0 + 1))) % 24;
    if (L.sleepy == null) { // はじめての日：寝る時刻から、0 時の眠気を決める
      const since = (24 - bedH) % 24, drop = HR.sleepGain(L.bed ? 'bed' : 'ground', H).sleepy, len = Math.ceil(H.sleepAt / drop);
      if (since < len) { L.zz = L.bed ? 'bed' : 'ground'; L.sleepy = H.sleepAt - since * drop; L.awakeH = 0; }
      else { delete L.zz; L.awakeH = since - len; L.sleepy = Math.min(H.sleepAt - 1, L.awakeH * H.awake); }
      L.stamina = H.staminaMax;
    }
    L.stamina = L.stamina ?? H.staminaMax;
    const c = { v, L, bedH, codes: new Array(24), ev: [], notes: [], got: {}, pending: null, trips: 0, tripH: 0, work: 0, meals: 0, up: new Set(), broke: new Set(), extra: 0, want: false, debt: L.debt > 0 };
    L.debt = 0;
    if (L.hurt && L.hurt >= day) c.off = 'hurt';           // 夜にケガをした人は、この日は休む
    else if (L.hp <= NE.restBelow) { c.off = 'weak'; L.restWhy = 'weak'; } // 体力が少ない人も休む
    else delete L.restWhy;
    if (!c.off) {
      const lv = levelJobs.length ? levelJobs[Math.min(levelJobs.length - 1, Math.floor(leveler / 2))] : null;
      if (lv && leveler < levelJobs.length * 2) { leveler++; c.level = lv; }
      // 役割は、選んだ道具で決まる。道具に仕事がない時（見張りなど）だけ、プロフィールの「やりたい仕事」を使う
      const pref = RES[(P.userHash(v.key).charCodeAt(0)) % 3];
      const toolJob = startJob(L);
      const toolRes = { '伐採': 'wood', '採掘': 'stone', '農業': 'food', '漁業': 'food', '牧場': 'food' }[toolJob];
      const want = toolRes ? toolJob : ((v.profile && v.profile.wantJob) || (v._priv && v._priv.wantJob) || toolJob);
      const wantRes = { '伐採': 'wood', '採掘': 'stone', '農業': 'food', '漁業': 'food', '牧場': 'food' }[want] || (want === '建築' ? RES.slice().sort((a, b) => need[b] - need[a])[0] : null);
      const wantK = toolRes ? 4 : 2.2;
      let job = R.weighted(RES.map((r) => [r, (1 + need[r] / 8) * (r === pref ? 1.6 : 1) * (r === wantRes ? wantK : 1)]));
      if (wantK === 4 && wantRes) job = wantRes;
      c.job = job; c.want = want;
    }
    ctxs.push(c);
  }
  // ---- 鍛冶職人（config.smithing）：鍛冶屋が建った次の日から、smiths 人が鍛冶をする。それまではだれもしない ----
  const SMC = config.smithing || null;
  const smithyB = SMC ? world.buildings.find((b) => b.type === SMC.building && b.day < day) : null;
  if (smithyB) {
    state.smiths = (state.smiths || []).filter((k) => life[k] && active.some((v) => v.key === k));
    const nS = SMC.smiths || 1;
    if (state.smiths.length < nS) {
      const cand = active.filter((v) => !state.smiths.includes(v.key)).sort((a, b) => ((life[b.key].gathered || {}).stone || 0) - ((life[a.key].gathered || {}).stone || 0) || (a.key < b.key ? -1 : 1));
      for (const v of cand.slice(0, nS - state.smiths.length)) {
        state.smiths.push(v.key); life[v.key].smith = day;
        hist('event', `鍛冶屋ができたので、${v.display}が村の鍛冶職人になった。これからは鍛冶屋で、みんなの道具や防具を作る。`, { who: [v.key], buildingType: SMC.building });
        diaryExtra[v.key] = (diaryExtra[v.key] || '') + '鍛冶屋ができたので、今日から村の鍛冶職人になった。';
      }
    }
    for (const c of ctxs) if (state.smiths.includes(c.v.key) && !c.off) c.smith = smithyB;
  }

  // 橋がかかった島には、木こりと石掘りの何人か（config.expansion の workShare）が、その島の木と岩から先に選んで働きに行く
  {
    const EXB = (config.expansion && config.expansion.bridges) || {};
    const opened = ISL ? world.islands.filter((i) => i.id !== IS.MAIN && i.open && i.open < day) : [];
    for (const c of ctxs) {
      if (c.off || (c.job !== 'wood' && c.job !== 'stone')) continue;
      for (const isl of opened) {
        const share = (EXB[isl.id] && EXB[isl.id].workShare) ?? 0.35;
        if ((hashStr('isl:' + isl.id + ':' + c.v.key + ':' + day) % 100) < share * 100) { c.base = { x: isl.x, z: isl.z }; break; }
      }
    }
  }
  // ---- 持ち物とチェスト ----
  const give = (c, items) => {
    for (const [it, n] of items) {
      if (!n) continue;
      c.got[it] = (c.got[it] || 0) + n;
      const left = I.addItem(c.L.inv, c.L.slots, it, n, IC.stack);
      if (left > 0) { c.pending = c.pending || {}; c.pending[it] = (c.pending[it] || 0) + left; }
    }
  };
  const unloadAll = (c) => {
    const out = I.unload(c.L.inv);
    if (c.pending) { for (const [it, n] of Object.entries(c.pending)) out[it] = (out[it] || 0) + n; c.pending = null; }
    // 鉱石を「自分で持つ」人（v.oreMode が chest でない人）：掘った鉱石はチェストに入れず、自分の鉱石袋（L.ores）へ。鍛冶屋で自分の装備に使う
    if (OM.modeOf(c.v) === 'keep') for (const it of Object.keys(out)) if (ORE_ITEMS.has(it)) { c.L.ores = c.L.ores || {}; c.L.ores[it] = (c.L.ores[it] || 0) + out[it]; delete out[it]; }
    if (Object.keys(out).length) { const val = deposit(out); for (const r of RES) c.L.contrib[r] += val[r]; }
  };
  const invFull = (L) => { // 枠がぜんぶ埋まっていて、道具でない物が 1 つはある（配列を作らずに見る）
    let item = false;
    for (let i = 0; i < L.slots; i++) { const x = L.inv[i]; if (!x) return false; if (!item && !I.isTool(x)) item = true; }
    return item;
  };
  // 食べる：チェストの食べ物（なければ自分の持ち物）を mealFood ぶん
  const eat = (c) => {
    if (state.res.food + 1e-9 >= H.mealFood) { spend('food', H.mealFood); return 1; }
    let got = 0;
    const inv = c.L.inv;
    for (let i = 0; i < inv.length && got < H.mealFood - 1e-9; i++) {
      const s = inv[i];
      if (!s || !FOODS.includes(s.item)) continue;
      while (s.n > 0 && got < H.mealFood - 1e-9) { s.n--; got += VAL(s.item).food; }
      if (s.n <= 0) inv[i] = null;
    }
    return Math.min(1, got / H.mealFood);
  };

  // ---- 見張りの装備（config.guardGear）：夜の見張りの時間に、作業台で たいまつ・剣・盾 を作る ----
  // はじめは道具か素手。作ったたいまつはチェストに入れ、村のまわりに立てる（町の地図は state.store.torch を見て立てる）
  const GG = config.guardGear || null;
  const replaceStore = (s) => { for (const k of Object.keys(state.store)) delete state.store[k]; Object.assign(state.store, s); syncRes(); };
  const guardCraft = (c, h) => {
    if (!GG || !built.includes('workbench')) return null;
    if ((today.guardCrafts || 0) >= (GG.perNight || 1)) return null; // 1 晩に作るのは少しずつ
    const L = c.L;
    const done = (code) => { today.guardCrafts = (today.guardCrafts || 0) + 1; return code; };
    if (GG.torch && (state.store.torch || 0) < GG.torch.keep) {
      const p = CR.plan(state.store, { from: GG.torch.from }, CC);
      if (p.ok) {
        p.store.torch = (p.store.torch || 0) + GG.torch.makes; replaceStore(p.store);
        c.ev.push({ h, text: `${tm(h)}、作業台でたいまつを${GG.torch.makes}本作った。` });
        today.crafted.push({ who: c.v.key, item: 'torch' });
        first('torch', 'はじめてたいまつを作った。夜の村のまわりに立てて、明るくする。', { item: 'torch' });
        return done('cr:torch');
      }
    }
    // 剣を持つのは見張り役の swordMax 人まで（持っている人は、より良い剣に作り直す）
    const swordsNow = Object.values(life).filter((l) => l && l.inv && I.getTool(l.inv, 'sword')).length;
    if (GG.sword && (swordsNow < (GG.swordMax || 3) || I.getTool(L.inv, 'sword'))) {
      const cur = I.getTool(L.inv, 'sword');
      const ch = CR.choose(state.store, 'sword', CC, { built, have: cur ? I.toolTier(cur.item) : 'hand' });
      if (ch.key && (cur || L.inv.slice(0, L.slots).some((s) => !s))) {
        I.removeTool(L.inv, 'sword');
        if (I.addTool(L.inv, L.slots, ch.key, CC.tiers[ch.recipe.tier].durability)) {
          replaceStore(ch.store);
          c.ev.push({ h, text: `${tm(h)}、見張りのために${ITEMS[ch.key].name}を作った。` });
          today.crafted.push({ who: c.v.key, item: ch.key });
          first('sword', `はじめて${ITEMS[ch.key].name}を作った。見張りが素手で戦わなくてよくなった。`, { item: ch.key });
          return done('cr:' + ch.key);
        }
      }
    }
    if (GG.shield && (state.store.shield || 0) < GG.shield.keep) {
      const p = CR.plan(state.store, { from: GG.shield.from }, CC);
      if (p.ok) {
        p.store.shield = (p.store.shield || 0) + 1; replaceStore(p.store);
        c.ev.push({ h, text: `${tm(h)}、作業台で盾を作った。` });
        today.crafted.push({ who: c.v.key, item: 'shield' });
        first('shield', 'はじめて盾を作った。見張りが矢やこぶしを盾で受けられる。', { item: 'shield' });
        return done('cr:shield');
      }
    }
    // 弓：クモの糸と棒で作る（チェストに入れておく）
    if (GG.bow && (state.store.string || 0) > 0 && (state.store.bow || 0) < GG.bow.keep) {
      const p = CR.plan(state.store, { from: GG.bow.from }, CC);
      if (p.ok) {
        p.store.bow = (p.store.bow || 0) + 1; replaceStore(p.store);
        c.ev.push({ h, text: `${tm(h)}、クモの糸で弓を作った。` });
        today.crafted.push({ who: c.v.key, item: 'bow' });
        first('bow', 'はじめて弓を作った。クモの糸を弦にした。', { item: 'bow' });
        return done('cr:bow');
      }
    }
    return null;
  };

  // ---- 鍛冶職人の 1 時間（config.smithing）：鍛冶屋の金床で、チェストの材料から 道具の作り直しか防具を 1 つ作る ----
  //   見張り（剣を持つ人）が先、そのあとは段階の低い人から（js/smithing.js の pickJob）。作る物がなければ null（ふつうの仕事にもどる）
  const ctxByKey = new Map(ctxs.map((x) => [x.v.key, x]));
  const smithHour = (c, h) => {
    if (!SMC || (today.smithed || 0) >= (SMC.perDay || 2)) return null;
    const people = active.map((v) => { const l = life[v.key]; return { key: v.key, L: l, guard: !!(l && l.inv && I.getTool(l.inv, 'sword')) }; });
    const r = SMT.pickJob({ store: state.store, people, config, built, CR });
    if (!r.job) {
      if (r.want && !c.smithWant) { c.smithWant = 1; c.notes.push(`鍛冶屋で${ITEMS[r.want.key].name}を作りたかったが、チェストに材料がそろっていなかった。`); }
      return null;
    }
    const j = r.job, T = life[j.to], to = active.find((v) => v.key === j.to), nm = ITEMS[j.key].name;
    if (j.type === 'tool') {
      const old = I.getTool(T.inv, j.kind), oldCopy = old && { ...old };
      I.removeTool(T.inv, j.kind);
      if (!I.addTool(T.inv, T.slots, j.key, CC.tiers[j.tier].durability)) { if (oldCopy) I.addTool(T.inv, T.slots, oldCopy.item, oldCopy.dur); return null; }
    } else { T.gear = T.gear || {}; T.gear[j.slot] = j.key; }
    replaceStore(j.store);
    if (j.own) T.ores = j.own; // 本人が持っていた鉱石を使った分（js/smithing.js の pickJob）
    today.smithed = (today.smithed || 0) + 1;
    today.crafted.push({ who: c.v.key, item: j.key, for: j.to });
    const self = j.to === c.v.key;
    c.ev.push({ h, text: self ? `${tm(h)}、鍛冶屋で自分の${nm}を作った。` : `${tm(h)}、鍛冶屋で${to.display}に${nm}を作った。` });
    const tc = ctxByKey.get(j.to);
    if (tc && !self) tc.ev.push({ h, text: `${tm(h)}、鍛冶職人の${c.v.display}が${nm}を作ってくれた。` });
    hist('craft', self ? `鍛冶職人の${c.v.display}が、自分の${nm}を作った。` : `鍛冶職人の${c.v.display}が${to.display}に${nm}を作った。`, { who: self ? [c.v.key] : [c.v.key, j.to], item: j.key, smith: true });
    if (j.type === 'armor') first('armor', `はじめて防具（${nm}）ができた。夜の敵の攻撃を少し防げる。`, { item: j.key });
    c.work++; c.workAt = c.workAt ?? h; (c.workHs = c.workHs || []).push(h);
    c.acts = c.acts || {}; c.acts.smith = (c.acts.smith || 0) + 1;
    return 'sm:' + c.smith.id;
  };

  // ---- 木・岩をえらぶ ----
  let bedMade = false; // 今日だれかがベッドを作った
  let noTree = false, noRock = false; // もう選べる木・岩がない（その日はもう探さない。選べる物は 1 日の中では増えない）
  // 近くになければ、だんだん遠くへ（いちばん近い物から選ぶので、探す広さは島ぜんたいまで広がる）。
  // 遠く（チェストから FAR.near より先）になる時は、もう遠くで働いている仲間のそばを先に探す（あちこちに散らばらない）
  const isFar = (o) => !!o && dist(o, world.chest) > FAR.near;
  const farAnchor = (c) => { for (const x of ctxs) if (x !== c && x.pos && isFar(x.pos)) return x.pos; return null; };
  const nextTree = (from, c) => {
    if (noTree) return null;
    const ok0 = (t) => t.state === 'tree' && !t.gone && !claimT.has(t.id) && reach(t); // 橋のない島の木は選ばない
    // りんごの木は、近くにほかの木があるうちは切らない（実をとるために残す）
    const ok = (t) => ok0(t) && !(AP && t.fruit === 'apple' && IX.trees.any(t.x, t.z, AP.spareR ?? 12, (o) => o !== t && o.fruit !== 'apple' && ok0(o)));
    let cand = IX.trees.nearest(from.x, from.z, from === center ? 8 : 2, ok);
    if (!cand.length) { noTree = true; return null; }
    let t = from === center ? R4.pick(cand) : cand[0];
    const an = from === center && isFar(cand[0]) && farAnchor(c);
    if (an) { cand = IX.trees.nearest(an.x, an.z, 1, ok); if (cand.length) t = cand[0]; }
    if (!t.logs) t.logs = R4.int(GA.treeLogs[0], GA.treeLogs[1]);
    return t;
  };
  const nextRock = (from, c) => {
    if (noRock) return null;
    const ok = (r) => r.hp > 0 && !r.gone && !claimR.has(r.id) && reach(r);
    let cand = IX.rocks.nearest(from.x, from.z, from === center ? 4 : 2, ok);
    if (!cand.length) { noRock = true; return null; }
    let r = from === center ? R4.pick(cand) : cand[0];
    const an = from === center && isFar(cand[0]) && farAnchor(c);
    if (an) { cand = IX.rocks.nearest(an.x, an.z, 1, ok); if (cand.length) r = cand[0]; }
    O.ensureBlocks(state.seed, r, config.ores);
    return r;
  };
  const objOf = {};
  const CT = ctrOf(world);
  const farPlace = (o) => (ISL && IS.islandName(world, o.x, o.z)) ? IS.islandName(world, o.x, o.z) + (o.hp !== undefined ? 'の岩場' : 'の森') : (Math.abs(o.x - CT.x) > Math.abs(o.z - CT.z) ? (o.x > CT.x ? '東' : '西') : (o.z < CT.z ? '北' : '南')) + (o.hp !== undefined ? 'の山' : 'の森');
  // 木にもたれて寝る木：村のまん中から FAR.treeR 以内（広場のふちから数マス）の木だけ。人ごとに決まった 1 本
  const nearTrees = IX.trees.nearest(center.x, center.z, 16, (t) => t.state === 'tree' && !t.gone && dist(t, center) <= FAR.treeR);
  const sleepTree = (c) => { const ok = nearTrees.filter((t) => t.state === 'tree' && !t.gone); return ok.length ? ok[hashStr('st:' + c.v.key) % ok.length] : null; };
  const treeOK = (t) => t && t.state === 'tree' && !t.gone;
  const stumpOK = (t) => t && t.state === 'stump' && t.dig && !t.gone;
  const rockOK = (r) => r && r.hp > 0 && !r.gone;
  // 今の時間にだれかがたたいている木・岩（手伝う相手）
  let hourWork = new Map();
  const helpable = (kind, c) => [...hourWork.values()].filter((w) => w.kind === kind && !w.who.some((x) => x.c === c) && (kind === 'tree' ? treeOK(w.o) : rockOK(w.o)));
  const pickWood = (c) => {
    if (stumpOK(objOf[c.stump])) return { action: 'stump', o: objOf[c.stump] };
    if (treeOK(objOf[c.tree])) return { action: 'chop', o: objOf[c.tree] };
    c.tree = null;
    const help = helpable('tree', c);
    let t = null;
    if (help.length && R4.chance(H.joinChance)) { const at = c.at || center; t = help.sort((a, b) => dist(a.o, at) - dist(b.o, at))[0].o; }
    else { t = nextTree(c.at && !c.fresh ? c.at : (c.base || center), c); if (t) t.owner = c.v.key; } // 自分で選んだ木（手伝いではない）
    if (!t) return null;
    if (!t.logs) t.logs = R4.int(GA.treeLogs[0], GA.treeLogs[1]);
    objOf[t.id] = t; c.tree = t.id; claim(claimT, t.id, 1);
    return { action: 'chop', o: t };
  };
  const pickStone = (c) => {
    if (rockOK(objOf[c.rock])) return { action: 'dig', o: objOf[c.rock] };
    c.rock = null;
    const help = helpable('rock', c);
    let r = null;
    if (help.length && R4.chance(H.joinChance)) r = help[0].o;
    else r = nextRock(c.at && !c.fresh ? c.at : (c.base || center), c);
    if (!r) return null;
    objOf[r.id] = r; c.rock = r.id; claim(claimR, r.id, 1);
    return { action: 'dig', o: r };
  };
  // 食べ物の仕事の中身：畑（農業）・釣り（漁業）・動物の世話（牧場）・野原で集める。1 日の初めに 1 回決める
  const foodSub = (c) => {
    if (c.sub) return c.sub;
    const L = c.L, tamed = world.animals.filter((a) => a.pen);
    const rodOK = I.getTool(L.inv, 'fishing_rod') || CR.choose(state.store, 'fishing_rod', CC, { built, have: 'hand' }).key;
    const subs = [['wild', 1.2]];
    const wildN = world.fields.filter((f) => f.wild).length;
    const canPlant = !!I.getTool(L.inv, 'hoe') && (state.store.seeds || 0) > 0 && wildN < GR.maxFields;
    if (world.fieldSlots.length || canPlant || world.fields.length) subs.push(['farm', c.want === '農業' ? 5 : 1.8]);
    if ((world.pond || world.islands) && rodOK) subs.push(['fish', c.want === '漁業' ? 5 : 1.0]);
    if (tamed.length && !ranchTaken) subs.push(['ranch', c.want === '牧場' ? 5 : 2.5]);
    let sub = R2.weighted(subs);
    const forced = { '漁業': 'fish', '牧場': 'ranch' }[c.want];
    if (forced && subs.some(([s]) => s === forced)) sub = forced;
    // 動物を追う（村ぜんたいで 1 日 perDay 回まで）：柵の中にしとめてよい動物がいれば penTryP、いなければ tryP（野の動物は必ず逃げる）
    if (HU && !forced && sub !== 'ranch' && huntN < (HU.perDay ?? 1)) {
      const prey = penPrey(), wild = prey ? null : wildPrey(c);
      if ((prey || wild) && RH.chance(prey ? HU.penTryP : HU.tryP)) { sub = 'hunt'; huntN++; c.prey = (prey || wild).id; }
    }
    if (sub === 'ranch') ranchTaken = c.v.key;
    return (c.sub = sub);
  };
  const pickFood = (c, night) => {
    const sub = foodSub(c), L = c.L, FA = config.farming;
    if (sub === 'fish') { // 釣り場：島の町は、その日ごとに海べか池（乱数は使わず、名前と日から決める。池がなければ海べ）
      if (!c.spot) { const hs = [...(c.v.key + ':' + day)].reduce((h0, ch) => (h0 * 31 + ch.charCodeAt(0)) >>> 0, 7); c.spot = world.islands && (!world.pond || hs % 100 < (config.fishing.seaShare ?? 0.5) * 100) ? 'sea' : 'pond'; }
      return { action: 'fish', target: c.spot };
    }
    if (sub === 'ranch' && !c.ranched) return { action: 'ranch', target: (world.buildings.find((b) => b.type === 'pen') || {}).id || null };
    if (sub === 'hunt' && !c.hunted && !night) return { action: 'hunt', target: c.prey };
    if (sub === 'farm' || sub === 'ranch') {
      const ripe = world.fields.filter((f) => f.stage >= (f.max || 3) && f.day !== day && !takenFields.has(f.id)); // 今日まいた・世話した畑は、明日から
      if (ripe.length) return { action: 'harvest', f: R2.pick(ripe) };
      const slotN = world.fields.filter((f) => !f.wild).length;
      if (slotN < world.fieldSlots.length) return { action: 'till', slot: world.fieldSlots[slotN] };
      const wildN = world.fields.filter((f) => f.wild).length;
      if (I.getTool(L.inv, 'hoe') && (state.store.seeds || 0) > 0 && wildN < GR.maxFields && !c.noSpot) return { action: 'till', wild: true };
      // 水やり：雨でない日に、まだ水をやっていない育ちかけの畑へ（1 人 1 日 1 時間。水をやった畑はその夜もう 1 段育つ）
      if (sub === 'farm' && !rain && !night && !c.watered) {
        const dry = world.fields.filter((f) => f.wet !== day && !wetting.has(f.id) && f.stage < (f.max || 3));
        if (dry.length) return { action: 'water', f: dry[0] };
      }
      const grow = world.fields.filter((f) => !takenFields.has(f.id) && f.stage < (f.max || 3) - 1);
      if (grow.length) return { action: 'tend', f: R2.pick(grow) };
      void FA;
    }
    if (night) return { action: 'guard' }; // 暗くて実が見えない夜は、見張りをする
    // りんごの木：チェストから near 以内の、実っている木（1 日に村ぜんたいで perDay 本まで）
    if (AP && takenApple.size < (AP.perDay ?? 3)) {
      const ok = (t) => t.fruit === 'apple' && t.state === 'tree' && !t.gone && !t.appleWait && !takenApple.has(t.id) && !claimT.has(t.id) && reach(t) && dist(t, world.chest) <= (AP.near ?? FAR.near);
      const at = IX.trees.nearest(world.chest.x, world.chest.z, 6, ok);
      if (at.length) return { action: 'apple', o: R.pick(at) };
    }
    // 草むらの実は、1 日に村ぜんたいで bushShare の割合まで（とった草むらは何日かでまた実る）
    if (takenBushes.size < bushCap) {
      const bush = world.bushes.filter((b) => b.ready && !takenBushes.has(b.id));
      if (bush.length) return { action: 'berry', b: R.pick(bush) };
    }
    return { action: 'forage' };
  };

  // ---- 仕事のあとの時間：散歩・おしゃべり・海をながめる・畑に水・動物をなでる・荷物運びの手伝い（とれる物はない） ----
  //   同じことを 1〜2 時間続ける。おしゃべりは、その時間におしゃべりしたい人どうしを、仲のいい順に組にする（resolveChat）
  const FW = H.free || { walk: 3, chat: 3, view: 2, water: 1.5, pet: 1.5, help: 1 };
  const penOK = world.buildings.some((b) => b.type === 'pen') && world.animals.some((a) => a.pen);
  let chatList = [], carriers = [];
  function freeHour(c, h) {
    if (!c.freeK || c.freeUntil <= h) {
      const opts = [['walk', FW.walk], ['chat', FW.chat], ['view', FW.view]];
      if (world.fields.length && !rain && !HR.isNight(h, H)) opts.push(['water', FW.water]); // 雨の日と夜は水やりしない
      if (penOK) opts.push(['pet', FW.pet]);
      if (carriers.some((x) => x !== c)) opts.push(['help', FW.help]);
      c.freeK = R4.weighted(opts); c.freeUntil = h + R4.int(1, 2); c.freeT = null;
    }
    const k = c.freeK;
    c.freeH = (c.freeH || 0) + 1;
    if (k === 'chat') { chatList.push(c); return 'tk'; } // 相手は resolveChat で決める
    if (k === 'water') { if (!c.freeT) c.freeT = R4.pick(world.fields).id; const wf = world.fields.find((x) => x.id === c.freeT); if (wf) wf.wet = day; logFree(c, h, k); return 'wf:' + c.freeT; }
    if (k === 'help') {
      const o = carriers.find((x) => x !== c);
      if (o) { logFree(c, h, k, o.v); return 'hk:' + o.v.key; }
      c.freeK = 'walk';
    }
    logFree(c, h, c.freeK);
    return { walk: 'sp', view: 'sv', pet: 'pt' }[c.freeK];
  }
  const logFree = (c, h, kind, other) => { (c.freeLog = c.freeLog || []).push({ h, kind, other }); };
  // おしゃべりの組：となりの 8 人までの中で、いちばん仲のいい人と（人が多くても軽い）
  function resolveChat(h) {
    const left = chatList; chatList = [];
    while (left.length) {
      const a = left.shift();
      let bi = -1, best = -Infinity;
      for (let i = 0; i < Math.min(8, left.length); i++) {
        const p = S.social.pairs && S.social.pairs[SO.pairKey(a.v.key, left[i].v.key)];
        const s = p ? p.s : 0;
        if (s > best) { best = s; bi = i; }
      }
      if (bi < 0) { a.codes[h] = 'sp'; a.freeK = 'walk'; logFree(a, h, 'walk'); continue; }
      const b = left.splice(bi, 1)[0];
      a.codes[h] = 'tk:' + b.v.key; b.codes[h] = 'tk:' + a.v.key;
      logFree(a, h, 'chat', b.v); logFree(b, h, 'chat', a.v);
    }
  }

  // ---- 1 時間の行動を決める ----
  const GAIN = { bed: HR.sleepGain('bed', H), tree: HR.sleepGain('tree', H), ground: HR.sleepGain('ground', H) }; // 1 日 1 回だけ作る
  const sinceBed = (c, h) => (h - c.bedH + 24) % 24;
  const outdoorSleep = (L) => !L.home && L.zz !== 'bed';
  let tentDay = null; // その日のテントの寝床の割り当て（1 日 1 回だけ作る）
  const tentNow = () => tentDay || (tentDay = TN.tentPlan(active, life, config));
  function hourFor(c, h, night) {
    const L = c.L;
    // 1. 眠気：眠い → 寝る。眠気が 0 になったら起きる
    // 朝型は、目がさめても wakeEarliest 時までは暗いのでまどろむ
    if (L.zz && L.sleepy <= 0 && !(L.chrono === '朝型' && h < (H.wakeEarliest ?? 5))) { delete L.zz; L.awakeH = 0; L.sleepy = 0; }
    if (!L.zz) {
      if (L.awakeH >= H.lateAfter && sinceBed(c, h) < 6) L.sleepy += H.lateBoost; // 寝る時刻を過ぎた
      // 寝る時刻に遠くにいたら、まず 1 時間歩いて村へ帰る（夜型で遠くの岩を掘っていた人も）
      if (L.sleepy >= H.sleepAt && c.pos && dist(c.pos, world.chest) > FAR.homeR) {
        c.pos = null; c.fresh = true; c.homeWalk = (c.homeWalk || 0) + 1; c.homeAt = c.homeAt ?? h; c.goHome = true;
      } else if (L.sleepy >= H.sleepAt) {
        // 寝る場所：ベッド → 家・テントのそば → 村のまん中の近くの木（遠くの森では寝ない）
        //   家のない人はテントの中（ベッドか敷物。js/tents.js の割り当て）。テントがいっぱいなら たき火のそば。ベッドは外に置かない
        const tentSlot = !L.home && tentNow().slot[c.v.key];
        c.sleepTree = null; c.inTent = !!tentSlot;
        L.zz = L.bed && (L.home || tentSlot) ? 'bed' : 'ground';
        c.pos = null;
        L.sleepy = Math.min(L.sleepy, H.sleepAt + 10);
        c.sleptAt = h; c.sleepPlace = L.zz;
      }
    }
    if (L.zz) {
      const g = GAIN[L.zz] || GAIN.ground;
      L.sleepy = Math.max(-1, L.sleepy - g.sleepy); L.stamina = Math.min(H.staminaMax, L.stamina + g.stamina);
      L.hunger = Math.max(0, L.hunger - H.hungerSleep);
      if (L.hunger > 0) L.hp = Math.min(NE.max, L.hp + g.hp); else L.hp = Math.max(1, L.hp - H.starveHp);
      if (night && outdoorSleep(L)) c.outNight = true;
      const tr = L.zz === 'tree' && (c.sleepTree || sleepTree(c));
      return 's' + L.zz[0] + (tr ? ':' + tr.id : '');
    }
    L.awakeH++;
    if (night) c.awakeNight = true;
    const finish = (code, kind) => {
      const heavy = kind === 'heavy';
      L.hunger = Math.max(0, L.hunger - H.hungerAwake - (heavy ? H.hungerWork : 0));
      if (kind === 'rest') { L.stamina = Math.min(H.staminaMax, L.stamina + H.restStamina); L.hp = Math.min(NE.max, L.hp + H.restHp); }
      else if (kind === 'free') L.stamina = Math.min(H.staminaMax, L.stamina + (H.freeStamina ?? 1)); // 仕事のあとの軽いこと：少し戻る
      else L.stamina = Math.max(0, L.stamina - (heavy ? H.staminaWork : H.staminaLight));
      if (L.hunger <= 0) { L.hp = Math.max(1, L.hp - H.starveHp); c.starved = true; }
      else if (L.hunger >= NE.regenAt) L.hp = Math.min(NE.max, L.hp + H.hpRegen);
      L.sleepy += H.awake + (heavy ? H.awakeHeavy : 0);
      return code;
    };
    if (c.goHome) { c.goHome = false; return finish('wh', 'light'); }
    // 2. おなかがすいた → 食べる
    if (NE.eat > 0 && L.hunger <= H.eatBelow && c.meals < H.maxMeals) {
      const k = eat(c);
      if (k > 0) { c.meals++; L.hunger = Math.min(NE.max, L.hunger + NE.eat * k); return finish('e', 'light'); }
      c.noFood = true;
    }
    // ケガ・体力が少ない日は休む
    if (c.off) return finish('r', 'rest');
    // 3. 行動力が少ない → 休む
    if (L.stamina <= H.restBelow) return finish('r', 'rest');
    // 4. 持ち物がいっぱい → チェストへ運ぶ（建てる材料を運んだ次の日も、最初に 1 回）
    //    チェストが近い（carryNear 以内）時は、ついでに置いて仕事を続ける（1 時間はつかわない）。
    //    遠い時は 1 時間かけて運ぶ。それが maxTrips 回をこえたら、持ちきれないので今日の仕事はおしまい
    if (c.debt) { c.debt = false; unloadAll(c); c.trips++; c.tripH++; return finish('k', 'light'); }
    if (c.pending || invFull(L)) {
      if (c.at && dist(c.at, world.chest) <= H.carryNear) { unloadAll(c); c.trips++; }
      else if (c.tripH < H.maxTrips) { unloadAll(c); c.trips++; c.tripH++; (c.tripHs = c.tripHs || []).push(h); return finish('k', 'light'); }
      else if (!c.fullStop) { c.fullStop = true; c.fullStopAt = h; }
    }
    // 今日の仕事は workHours 時間まで（あとは休む。夜なら見張り）
    if (c.fullStop || c.work >= H.workHours) {
      // 遠くで仕事を終えたら、まず 1 時間歩いて村へ帰る
      if (c.pos && dist(c.pos, world.chest) > FAR.homeR) { c.pos = null; c.fresh = true; c.homeWalk = (c.homeWalk || 0) + 1; c.homeAt = c.homeAt ?? h; return finish('wh', 'light'); }
      if (night) { const gc = guardCraft(c, h); if (gc) return finish(gc, 'light'); c.guardH = (c.guardH || 0) + 1; return finish('w', 'light'); }
      return finish(freeHour(c, h), 'free');
    }
    // 鍛冶職人：昼に、作る物があれば まず鍛冶屋で作る（1 日 perDay 個まで。なければふつうの仕事）
    if (c.smith && !c.smithDone && !night) {
      const code = smithHour(c, h);
      if (code) return finish(code, 'heavy');
      c.smithDone = true;
    }
    // 整地
    if (c.level && !c.level.done) {
      const lv = c.level;
      lv.prog.levelH = (lv.prog.levelH || 0) + (night ? H.nightSlow : 1);
      if (lv.prog.levelH >= H.levelHours - 1e-9) lv.done = h;
      c.levelH = (c.levelH || 0) + 1; c.levelAt = c.levelAt ?? h; c.work++;
      return finish('l:' + lv.target, 'heavy');
    }
    // 5. その人の仕事（できなければ別の仕事）
    let a = null;
    for (const j of { wood: ['wood', 'stone', 'food'], stone: ['stone', 'wood', 'food'], food: ['food'] }[c.job]) {
      a = j === 'wood' ? pickWood(c) : j === 'stone' ? pickStone(c) : pickFood(c, night);
      if (a) break;
    }
    // 道具：なければ・こわれたら・良い物が作れるなら、チェストの材料で作る（1 時間）
    const kind = KIND_OF[a.action] || null;
    if (kind) {
      const cur = I.getTool(L.inv, kind);
      if (!cur || !c.up.has(kind)) {
        c.up.add(kind);
        const ch = CR.choose(state.store, kind, CC, { built, have: cur ? I.toolTier(cur.item) : 'hand', goal: state.toolGoal });
        if (ch.key && (cur || L.inv.slice(0, L.slots).some((s) => !s))) {
          I.removeTool(L.inv, kind);
          if (I.addTool(L.inv, L.slots, ch.key, CC.tiers[ch.recipe.tier].durability)) {
            for (const k of Object.keys(state.store)) delete state.store[k];
            Object.assign(state.store, ch.store); syncRes();
            c.ev.push({ h, text: c.broke.has(kind) ? `${tm(h)}、${ITEMS[ch.key].name}を作り直した。` : `${tm(h)}、チェストの材料で${ITEMS[ch.key].name}を作った。` });
            today.crafted.push({ who: c.v.key, item: ch.key });
            if (state.toolGoal === ch.key) { hist('craft', `投票で決まった${ITEMS[ch.key].name}ができた。`, { item: ch.key }); state.toolGoal = null; }
            return finish('cr:' + ch.key, 'light');
          }
        } else if (!cur && ch.want && !c.wantNoted) {
          c.wantNoted = true;
          c.notes.push(`${ITEMS[ch.want.key].name}を作りたかったが、材料が足りない（${CR.missingText(ch.want.missing, ITEMS)}）。素手でがんばった。`);
          today.craftNeed = { item: ch.want.key, missing: ch.want.missing };
        }
      }
      if (a.action === 'fish' && !I.getTool(L.inv, 'fishing_rod')) a = night ? { action: 'guard' } : { action: 'forage' }; // 釣りざおがない
    }
    // ベッド：まだ持っていなくて、チェストに板と羊毛があれば作る（昼だけ・1 日 1 回見る）
    //   村で 1 日 1 つまで。チェストの羊毛は bedKeep ぶん残す（ほかの使い道のため）
    const bedFrom = CC.furniture && CC.furniture.bed && CC.furniture.bed.from;
    if (!L.bed && !night && !c.bedTried && bedFrom && !bedMade && Object.entries(H.bedKeep || {}).every(([k, n]) => (state.store[k] || 0) >= (bedFrom[k] || 0) + n)) {
      c.bedTried = true;
      const p = CR.plan(state.store, CC.furniture.bed, CC);
      if (p.ok) {
        for (const k of Object.keys(state.store)) delete state.store[k];
        Object.assign(state.store, p.store); syncRes();
        L.bed = 1; bedMade = true; c.ev.push({ h, text: `${tm(h)}、板と羊毛でベッドを作った。今夜からベッドで眠れる。` });
        first('bed', `${c.v.display}が、村ではじめてベッドを作った。`, { who: [c.v.key] });
        return finish('cr:bed', 'light');
      }
    }
    // 遠くの木・岩：今いる所から遠ければ、まず 1 時間歩いて行く（その日の仕事の時間が減る）
    const o = a && a.o;
    if (o && (a.action === 'chop' || a.action === 'dig' || a.action === 'stump') && isFar(o) && (!c.pos || dist(c.pos, o) > 14)) {
      // 歩いて着いても働く時間が残らない時は、行かずに今日の仕事をおしまいにする（遠くにいれば村へ帰る）
      if (c.work >= H.workHours - 1) {
        if (a.action === 'dig') { claim(claimR, o.id, -1); c.rock = null; } else if (a.action === 'chop') { claim(claimT, o.id, -1); c.tree = null; }
        c.work = H.workHours;
        if (c.pos && dist(c.pos, world.chest) > FAR.homeR) { c.pos = null; c.fresh = true; c.homeWalk = (c.homeWalk || 0) + 1; c.homeAt = c.homeAt ?? h; return finish('wh', 'light'); }
        return night ? finish('w', 'light') : finish(freeHour(c, h), 'free');
      }
      c.pos = o; c.walkOut = (c.walkOut || 0) + 1; c.work++; // 歩く 1 時間も仕事の時間（workHours）に数える
      if (!c.farNote) {
        const what = a.action === 'dig' ? '岩' : '木';
        const nearLeft = a.action === 'dig' ? IX.rocks.any(world.chest.x, world.chest.z, FAR.near, (r) => r.hp > 0 && !r.gone) : IX.trees.any(world.chest.x, world.chest.z, FAR.near, (t) => t.state === 'tree' && !t.gone);
        c.farNote = { h, text: `${tm(h)}、${nearLeft ? `${what}を探して` : `近くの${what}がなくなったので、`}${farPlace(o)}まで歩いた。` };
        c.ev.push(c.farNote);
      }
      return finish('wk:' + o.id, 'light');
    }
    return doWork(c, h, night, a, kind, finish);
  }

  // 働く 1 時間
  function doWork(c, h, night, a, kind, finish) {
    const L = c.L, v = c.v;
    const tier = tierOf(L, kind), st = CR.stats(kind ? tier : 'wood', CC);
    const wear = () => {
      if (!kind) return;
      const before = I.getTool(L.inv, kind);
      if (before && st.durability) for (let k = 0; k < H.toolWearPerHour; k++) if (I.useTool(L.inv, kind)) { c.ev.push({ h, text: `${tm(h)}、${ITEMS[before.item].name}がこわれた。` }); c.broke.add(kind); c.up.delete(kind); break; }
    };
    c.work++; c.workAt = c.workAt ?? h; (c.workHs = c.workHs || []).push(h);
    c.acts = c.acts || {}; c.acts[a.action] = (c.acts[a.action] || 0) + 1;
    if (night) { c.nightWork = (c.nightWork || 0) + 1; c.nightAt = c.nightAt ?? h; }
    if (lateH(h) && a.action !== 'guard') { c.lateWork = true; c.lateAt = c.lateAt ?? h; }
    const add = (kindW, o, code) => {
      const pow = HR.powerOf(tier, H, { night, outdoor: kindW !== 'rock', torch: torchOK(L) });
      const w = hourWork.get(o.id) || { kind: kindW, o, who: [] };
      w.who.push({ key: v.key, pow, c, drop: st.drop, tier });
      hourWork.set(o.id, w);
      L.targets.push(o.id); c.at = o; c.fresh = false; c.pos = o;
      c.tgt = c.tgt || {}; c.tgt[o.id] = (c.tgt[o.id] || 0) + 1;
      wear();
      return finish(code + ':' + o.id, 'heavy');
    };
    if (a.action === 'chop') { c.lastTree = a.o.id; if (!c.place) c.place = area(a.o, world); return add('tree', a.o, 'c'); }
    if (a.action === 'stump') return add('stump', a.o, 'u');
    if (a.action === 'dig') { if (!c.placeR) c.placeR = area(a.o, world); return add('rock', a.o, 'd'); }
    const slow = night && !torchOK(L) && !R4.chance(H.nightSlow); // 暗い外仕事は、うまく進まないことがある
    const FA = config.farming, q = (lo, hi, m) => Math.max(0, Math.round(R.int(lo, hi) * m));
    if (a.action === 'fish') { // うきが沈んだら釣り上げる。良い釣りざおほど、よく沈む。夜は夜だけの魚もいる
      const FC = config.fishing, out = [], sea = a.target === 'sea' && FC.seaFish, pl = sea ? '海' : '池'; // 海べでは海の魚
      for (let k = 0; k < H.fishCasts; k++) {
        if (!R2.chance(Math.min(0.95, FC.biteChance * CC.tiers.wood.hits / st.hits))) continue;
        let it;
        if (night && R2.chance(H.nightFishP)) { it = R2.weighted(sea && FC.seaNightFish ? FC.seaNightFish : H.nightFish); if (!c.nightFish) { c.nightFish = 1; c.ev.push({ h, text: `${tm(h)}、夜の${pl}で${ITEMS[it].name}を釣り上げた。` }); first('nightfish', `${v.display}が、夜の${pl}ではじめて${ITEMS[it].name}を釣った。`, { who: [v.key], item: it }); } }
        else it = R2.chance(FC.treasure.p) ? R2.weighted(FC.treasure.items) : R2.chance(FC.junk.p) ? R2.weighted(FC.junk.items) : R2.weighted(sea ? FC.seaFish : FC.fish);
        out.push([it, 1]);
        if (it.startsWith('fish_')) { first('fish', `${v.display}が、村ではじめて魚を釣った（${ITEMS[it].name}）。`, { who: [v.key], item: it }); fishCatch(v, L, c, it); }
        else if (FC.treasure.items.some(([k2]) => k2 === it)) { first('treasure', `${v.display}が${pl}から${ITEMS[it].name}を釣り上げた。村ではじめての宝物。`, { who: [v.key], item: it }); c.notes.push(`${ITEMS[it].name}が釣れた。`); }
      }
      give(c, out); wear(); c.target = c.target || (sea ? 'sea' : 'pond');
      if (sea && config.sea && config.sea.sharks !== 0) first('shark', `${v.display}が海べで釣りをしていたら、沖にサメの背びれが見えた。海にはサメがいるので、村人は海に入らない（浜から釣るだけ）。`, { who: [v.key] });
      return finish(sea ? 'f:sea' : 'f', 'light');
    }
    if (a.action === 'ranch') { // 柵の中の動物の世話。もらえる物は 1 日 1 回
      c.ranched = true;
      const AN = config.animals, out = {};
      for (const an of world.animals.filter((x) => x.pen)) {
        const k = AN.kinds[an.kind];
        if ((day - an.tamedDay) % k.every !== 0 || !R2.chance(k.p)) continue;
        out[k.gives] = (out[k.gives] || 0) + 1;
        first('give_' + k.gives, `はじめて${k.name}から${ITEMS[k.gives].name}をもらった。`, { who: [v.key], item: k.gives });
      }
      give(c, Object.entries(out)); c.ranchGot = Object.keys(out).length > 0; c.target = c.target || a.target;
      return finish('n', 'light');
    }
    if (a.action === 'hunt') { // 動物を追う 1 時間。動物は攻撃すると逃げる：柵の中の動物だけ、しとめられる
      c.hunted = true;
      const AN = config.animals, an = world.animals.find((x) => x.id === a.target), nm = an ? AN.kinds[an.kind].name : '動物';
      const penB = an && an.pen && world.buildings.find((b) => b.id === an.pen);
      if (!an || !penB) {
        state.huntFails = (state.huntFails || 0) + 1;
        c.ev.push({ h, text: `${tm(h)}、野原の${nm}を追いかけてたたこうとしたが、${nm}は走って逃げてしまった。柵で囲わないと捕まえられない。` });
        first('hunt_fail', `${v.display}が野原の${nm}を追いかけたが、逃げられた。動物はおそうと逃げるので、肉を取るには柵で囲ってからでないといけない。`, { who: [v.key], animal: an ? an.id : null });
        return finish('ht:' + (an ? an.id : ''), 'heavy');
      }
      const rng = (m) => (m ? RH.int(m[0], m[1]) : 0);
      const meat = rng((HU.meat || {})[an.kind]), leather = rng((HU.leather || {})[an.kind]);
      world.animals.splice(world.animals.indexOf(an), 1);
      state.hunted = (state.hunted || 0) + 1;
      give(c, [['meat', meat], ['leather', leather]]);
      c.ev.push({ h, text: `${tm(h)}、柵の中の${nm}を追いつめてしとめた。逃げ場がないので、つかまえられた。${haulText({ meat, leather }) || ''}。` });
      first('hunt', `${v.display}が柵の中の${nm}をしとめて、村ではじめて肉が手に入った。動物は逃げるので、柵で囲ってから捕まえる。`, { who: [v.key], animal: an.id, item: 'meat' });
      if (leather) first('leather', `はじめて${nm}の革が手に入った。革の防具の材料になる。`, { who: [v.key], item: 'leather' });
      c.target = c.target || penB.id; c.pos = penB;
      return finish('ht:' + an.id, 'heavy');
    }
    if (a.action === 'harvest') {
      if (slow) { wear(); return finish('h:' + a.f.id, 'heavy'); }
      const f = a.f, crop = f.crop || 'wheat', cp = FA.crops[crop] || FA.crops.wheat;
      f.stage = 0; f.harvested = (f.harvested || 0) + 1; takenFields.add(f.id);
      first('harvest_' + crop, `畑ではじめて${cp.name}がとれた。`, { who: [v.key], item: crop });
      give(c, [[crop, Math.max(0, Math.round(R2.int(cp.yield[0], cp.yield[1]) * mult.food))], [cp.seed || 'seeds', R2.int(1, 2)]]);
      c.crop = c.crop || crop; c.target = c.target || f.id; L.targets.push(f.id); wear();
      return finish('h:' + f.id, 'heavy');
    }
    if (a.action === 'till') {
      if (slow) { wear(); return finish('ti', 'heavy'); }
      let f;
      if (a.slot) {
        const crops = Object.keys(FA.crops), crop = crops[world.fields.length % crops.length];
        f = { id: 'f' + world.fields.length, x: a.slot.x, z: a.slot.z, rot: a.slot.rot || 0, stage: 0, day, crop, max: FA.crops[crop].days };
      } else {
        const spot = freeSpot(GR.near[0], GR.near[1], 'field');
        if (!spot) { c.noSpot = true; return finish('g', 'light'); }
        f = { id: 'f' + world.fields.length, x: spot.x, z: spot.z, rot: 0, stage: 0, day, crop: 'wheat', max: FA.crops.wheat.days, wild: 1 };
        state.store.seeds--; if (!state.store.seeds) delete state.store.seeds;
        first('wild_field', `${v.display}が、くわで草を耕して畑にし、種をまいた。`, { who: [v.key] });
      }
      world.fields.push(f); IX.fields.set(f, f.x, f.z); takenFields.add(f.id);
      first('till', `${v.display}が、村ではじめて畑を耕して${FA.crops[f.crop].name}の種をまいた。`, { who: [v.key] });
      give(c, [['wheat', R.chance(0.35) ? q(1, 2, mult.food) : 0], ['seeds', R.int(0, 1)]]);
      c.crop = c.crop || f.crop; c.target = c.target || f.id; c.tilled = (c.tilled || 0) + 1; L.targets.push(f.id); wear();
      return finish('ti:' + f.id, 'heavy');
    }
    if (a.action === 'water') { // じょうろで畑の列に水をまく（とれる物はない）
      const f = a.f; wetting.add(f.id); f.wet = day; c.watered = true;
      c.target = c.target || f.id; L.targets.push(f.id);
      today.watered = (today.watered || 0) + 1;
      first('water_field', `${v.display}が、はじめてじょうろで畑に水をやった。水をやった畑は早く育つ。`, { who: [v.key] });
      return finish('wf:' + f.id, 'light');
    }
    if (a.action === 'tend') {
      const f = a.f; takenFields.add(f.id);
      // 世話だけでは実らない（実るのは夜のあいだに育った時）
      if (!slow) { f.stage = Math.min((f.max || 3) - 1, f.stage + 1); give(c, [['wheat', R.chance(0.35) ? q(1, 2, mult.food) : 0], ['seeds', R.int(0, 1)]]); }
      c.target = c.target || f.id; L.targets.push(f.id); wear();
      return finish('te:' + f.id, 'light');
    }
    if (a.action === 'berry') {
      const b = a.b; takenBushes.add(b.id); b.ready = false; b.regrow = 3;
      const woolB = world.animals.some((an) => an.kind === 'sheep' && !an.pen) && R.chance(0.35) ? 1 : 0;
      if (woolB && !c.woolEv) { c.woolEv = 1; c.ev.push({ h, text: `${tm(h)}、しげみの近くで、ヒツジの羊毛が枝にひっかかっているのを拾った。` }); }
      give(c, [['berry', q(1, 3, mult.food)], ['flower_r', R.chance(0.08) ? 1 : 0], ['wool', woolB]]);
      c.target = c.target || b.id; L.targets.push(b.id);
      return finish('gb:' + b.id, 'light');
    }
    if (a.action === 'apple') { // りんごの木から実をもぐ。とった木は regrowDays 日でまた実る
      const t = a.o; takenApple.add(t.id); t.appleWait = AP.regrowDays ?? 3;
      if (!L.appleTree) { L.appleTree = day; c.ev.push({ h, text: `${tm(h)}、りんごの木を見つけた。` }); }
      first('apple_tree', `${v.display}が、島でりんごの木を見つけた。`, { who: [v.key], item: 'apple' });
      give(c, [['apple', q(AP.pick[0], AP.pick[1], mult.food)]]);
      c.target = c.target || t.id; L.targets.push(t.id); c.pos = t;
      return finish('ga:' + t.id, 'light');
    }
    if (a.action === 'guard') { c.guardH = (c.guardH || 0) + 1; return finish('w', 'light'); }
    // 野原のヒツジが落とした羊毛を、ときどき拾う（柵がなくてもベッドを作れるように。柵で世話するほうがずっと多くもらえる）
    const wildSheep = world.animals.some((an) => an.kind === 'sheep' && !an.pen);
    const wool = wildSheep && R.chance(0.3) ? 1 : 0;
    if (wool && !c.woolEv) { c.woolEv = 1; c.ev.push({ h, text: `${tm(h)}、野原で、ヒツジの羊毛が草にひっかかっているのを拾った。` }); }
    give(c, [['berry', q(1, 2, mult.food)], [R.chance(0.5) ? 'flower_r' : 'flower_y', R.chance(0.25) ? 1 : 0], ['seeds', R.int(0, 1)], ['wool', wool]]);
    return finish('g', 'light');
  }

  // 同じ時間に同じ木・岩をたたいた人の力を足して、終わったら落ちた物を分ける
  const splitN = (n, who) => { // n 個を力の割合で分ける（端数は力の大きい人から）
    const sum = who.reduce((a, w) => a + w.pow, 0) || 1;
    const out = who.map((w) => ({ w, k: Math.floor((n * w.pow) / sum), r: ((n * w.pow) / sum) % 1 }));
    let left = n - out.reduce((a, x) => a + x.k, 0);
    for (const x of out.slice().sort((a, b) => b.r - a.r || b.w.pow - a.w.pow)) { if (left <= 0) break; x.k++; left--; }
    return out;
  };
  function resolveHour(h) {
    for (const w of hourWork.values()) {
      const o = w.o, who = w.who, top = who.slice().sort((a, b) => b.pow - a.pow)[0];
      if (w.kind === 'tree') {
        if (!treeOK(o)) continue;
        const need = Math.round(H.treeWork * (o.size || 1) * 100) / 100;
        const r = HR.addWork(o.work, need, who);
        o.work = r.work;
        if (!r.done) continue;
        // 倒れて、切り株が残る。原木を、たたいた力の割合で分ける
        const drop = who.reduce((a, x) => a + x.drop * (r.share[x.key] || 0), 0);
        const logs = Math.max(1, Math.round((o.logs || GA.treeLogs[0]) * drop * mult.wood * (H.logScale ?? 1)));
        for (const { w: x, k } of splitN(logs, who)) give(x.c, [['log', k]]);
        if (o.fruit === 'apple' && AP) { if (!o.appleWait) give(top.c, [['apple', R4.int(AP.chop[0], AP.chop[1])]]); delete o.appleWait; } // りんごの木は、なっていた実も落ちる
        else if (R4.chance(0.12)) give(top.c, [['apple', 1]]);
        if (R4.chance(0.1)) give(top.c, [['sapling', 1]]);
        o.state = 'stump'; o.regrow = RS2.stumpDays; o.cutDay = day; o.logs = 0; delete o.work;
        const dig = R3.chance(RS2.stumpDig ?? 0.5); // 切り株も掘る
        if (dig) o.dig = 1;
        const big = (o.size || 1) >= H.bigTree;
        // 自分の木（選んだ人・1 人で切った人）は「たおした」、人の木に入った人は「手伝った」に数える
        const owner = who.some((x) => x.key === o.owner) ? o.owner : top.key;
        for (const x of who) {
          claim(claimT, o.id, -1); x.c.tree = null;
          if (x.key === owner) x.c.fell = (x.c.fell || 0) + 1; else x.c.helped = (x.c.helped || 0) + 1;
          if (dig) x.c.stump = o.id;
          if (who.length > 1 && x.key === owner && !x.c.helpEv) { x.c.helpEv = 1; x.c.ev.push({ h, text: `${tm(h)}、仲間に手伝ってもらって、${who.length}人で${big ? '大きな' : ''}木を切りたおした。` }); }
        }
        delete o.owner;
      } else if (w.kind === 'stump') {
        if (!stumpOK(o)) continue;
        const r = HR.addWork(o.swork, H.stumpWork, who);
        o.swork = r.work;
        if (!r.done) continue;
        give(top.c, [[R3.chance(0.5) ? 'log' : 'stump', 1]]); // 切り株を掘り出す：原木 1 本か「切り株」が 1 つ落ちる
        o.state = 'removed'; o.gone = 1; o.removedDay = day; delete o.dig; delete o.swork;
        for (const x of who) { x.c.stump = null; if (!x.c.stumpEv) { x.c.stumpEv = 1; x.c.ev.push({ h, text: `${tm(h)}、${who.length > 1 ? `仲間と${who.length}人で` : ''}切り株を掘り出した。` }); } }
      } else if (w.kind === 'rock') {
        if (!rockOK(o)) continue;
        o.work = (o.work || 0) + who.reduce((a, x) => a + x.pow, 0);
        let i = 0;
        const order = who.slice().sort((a, b) => b.pow - a.pow);
        while (o.work >= H.blockWork - 1e-9 && o.hp > 0) {
          o.work -= H.blockWork;
          const x = order[i++ % order.length], vv = x.c.v;
          const blk = o.blocks[o.max - o.hp] || 's';
          const item = O.ORE_ITEM[blk] || 'cobble';
          let n = 1;
          if (item === 'cobble') { x.c.extra += x.drop - 1; if (x.c.extra >= 1) { n += Math.floor(x.c.extra); x.c.extra -= Math.floor(x.c.extra); } n = Math.round(n * mult.stone); }
          give(x.c, [[item, n]]);
          if (O.RARE.has(blk) && !history.some((hh) => hh.day === day && hh.type === 'find' && hh.item === item)) { hist('find', `${vv.display}が${ITEMS[item].name}を見つけた。`, { who: [vv.key], item, rock: o.id }); x.c.ev.push({ h, text: `${tm(h)}、岩の中から${ITEMS[item].name}が出てきた。` }); }
          o.hp -= 1;
        }
        if (o.hp <= 0) { // 壊れて消える。何日かでまた出る
          o.back = day + R4.int(RS2.rockDays[0], RS2.rockDays[1]); delete o.work;
          for (const x of who) { claim(claimR, o.id, -1); x.c.rock = null; x.c.rocks = (x.c.rocks || 0) + 1; }
        } else o.work = +o.work.toFixed(2);
      }
    }
  }
  for (let h = 0; h < 24; h++) {
    const night = HR.isNight(h, H);
    hourWork = new Map();
    carriers = h ? ctxs.filter((c) => c.codes[h - 1] === 'k') : []; // さっきの 1 時間に運んでいた人（手伝う相手）
    for (const c of ctxs) c.codes[h] = hourFor(c, h, night);
    resolveChat(h);
    resolveHour(h);
  }
  // 整地のできあがり：草と石がなくなる。建てる場所の木と岩はどける
  for (const lv of levelJobs) {
    if (lv.done === undefined) continue;
    delete lv.prog.levelH;
    if (lv.target === 'square') { world.square.leveled = day; today.leveled.push('square'); hist('level', '村のまん中の草をぬいて、石をどけて、地面をならした（整地）。'); }
    else {
      plan.leveled = day; today.leveled.push('site');
      clearAround(plan.site.x, plan.site.z); // 建てる場所のまわり（clearBlocks）の木と岩をどける
      hist('level', `${plan.site.label}の、${B(plan.build).name}を建てる場所をならした。建て始めた。`);
    }
  }
  if (plan && plan.site && (plan.site.plot === 'ring' || plan.site.plot === 'farm') && !plan.leveled) plan.leveled = day;

  // 日記の文を時刻の順につなぐ
  const renderDiary = (c) => c.pieces.slice().sort((a, b) => a.h - b.h).map((x) => x.t).join('');
  // あとから（立ち話など）時刻つきの文を入れる：自分の部分を並べ直し、後ろに足された文はそのまま
  const insertDiary = (c, h, t) => {
    const rest = c.entry.text.slice(c.baseLen);
    c.pieces.push({ h, t });
    const mine = renderDiary(c);
    c.entry.text = mine + rest; c.baseLen = mine.length;
  };
  // ---- 1 日のまとめと日記 ----
  let noFood = false;
  for (const c of ctxs) {
    const L = c.L, v = c.v;
    // 仕事のおわりに持っていた物（サイトの持ち物の枠に出す。夜にチェストへ入れる前の中身。道具の耐久もそのまま）
    L.held = L.inv.slice(0, L.slots).map((s) => (s ? { ...s } : null));
    while (L.held.length && L.held[L.held.length - 1] === null) L.held.pop();
    unloadAll(c); // 夜、持っている物をぜんぶチェストへ入れる（往復には数えない）
    L.targets = [...new Set(L.targets)];
    L.hours = HR.encodeHours(c.codes);
    // その日のおもな行動（動画・サイトの前の形のため）：整地 → いちばん長くした仕事 → 休み
    const acts = Object.entries(c.acts || {}).sort((a, b) => b[1] - a[1]);
    const main = c.off ? 'rest' : c.levelH ? 'level' : acts.length ? acts[0][0] : 'rest';
    const action = main === 'stump' ? 'chop' : main === 'guard' ? 'forage' : main;
    const job = c.off ? 'rest' : main === 'level' ? 'level' : main === 'smith' ? 'smith' : { chop: 'wood', dig: 'stone' }[action] || (main === 'rest' ? 'rest' : 'food');
    const tg = c.tgt ? Object.entries(c.tgt).sort((a, b) => b[1] - a[1])[0][0] : null;
    L.job = job; L.action = action;
    L.target = main === 'level' ? c.level.target : (action === 'chop' || action === 'dig') ? tg : action === 'rest' ? null : (c.target || null);
    const kind = KIND_OF[action];
    L.tool = kind ? (I.getTool(L.inv, kind) || {}).item || null : null; L.toolTier = tierOf(L, kind);
    const gotVal = valueOf(c.got);
    for (const [it, n] of Object.entries(c.got)) L.items[it] = (L.items[it] || 0) + n;
    for (const r of RES) L.gathered[r] = Math.round((L.gathered[r] + gotVal[r]) * 100) / 100;
    L.trips += c.trips; today.trips += c.trips;
    const xpType = { wood: 'chop', stone: 'dig' }[job] || 'gather';
    L.xp += c.work * IC.xp[xpType] + c.trips * IC.xp.carry;
    L.amount = RES.includes(job) ? Math.round(gotVal[job] * 10) / 10 : 0;
    L.today = { got: c.got, trips: c.trips, actions: c.work };
    if (c.fishCm) L.today.fish = c.fishCm.filter((e) => e[2]).concat(c.fishCm.filter((e) => !e[2])).slice(0, 8); // 新記録の魚は必ず残す // 今日釣った魚と大きさ（町の画面の「+1 フナ 23cm」）
    if (RES.includes(job)) today.jobs[job]++;
    for (const r of RES) today.gained[r] = Math.round((today.gained[r] + gotVal[r]) * 10) / 10;
    L.sleepy = Math.round(L.sleepy * 10) / 10; L.stamina = Math.round(L.stamina * 10) / 10;
    L.hp = Math.round(L.hp * 10) / 10; L.hunger = Math.round(L.hunger * 10) / 10;

    // 日記（時刻つき。短く）
    const haul = haulText(c.got) || '少し';
    const t0 = c.workAt !== undefined ? tm(c.workAt) + 'から、' : '';
    const place = c.place || c.placeR || '';
    const T = {
      chop: c.fell >= 1 ? [`${t0}${place}木を${c.fell}本たおした。${haul}。`]
        : c.helped ? [`${t0}${place}仲間の木を切るのを手伝った。${haul}。`]
          : [`${t0}${place}木を切った。${haul}。`, `${t0}斧をふって、${place}木を切った。${haul}。`],
      dig: [`${t0}${place}岩をたたいて掘った。${haul}。`, `${t0}つるはしで岩をくだいた。${haul}。`, `${t0}岩を何回もたたいて、かけらを掘り出した。${haul}。`],
      berry: [`${t0}草むらで木の実を集めた。${haul}。`, `${t0}赤い実をかごいっぱいにつんだ。${haul}。`],
      apple: [`${t0}りんごの木から赤い実をもいだ。${haul}。`, `${t0}手をのばして、りんごをかごに入れた。${haul}。`],
      till: [`${t0}くわで土を起こして、${(FA0.crops[c.crop] || FA0.crops.wheat).name}の種をまいた。${haul}。`, `${t0}新しい畑を耕した。${haul}。`],
      tend: [`${t0}畑の世話をした。芽がのびてきた。${haul}。`, `${t0}畑の草をぬいて、土をならした。${haul}。`],
      water: [`${t0}じょうろを持って、畑の列に水をまいた。`, `${t0}畑の土が乾いていたので、じょうろで水をやった。`],
      harvest: [`${t0}畑で${(FA0.crops[c.crop] || FA0.crops.wheat).name}を収穫した。${haul}。`, `${t0}畑の作物をかりとった。${haul}。`],
      forage: c.guardH && !Object.keys(c.got).length ? [`${t0}村のはずれで見張りをした。`] : [`${t0}野原で草や実を集めた。${haul}。`],
      fish: c.target === 'sea' ? (Object.keys(c.got).length ? [`${t0}海べで釣りをした。波の上のうきが沈むのを待って、${haul}を釣り上げた。`, `${t0}釣りざおを持って海べへ行った。${haul}。`] : [`${t0}海べで釣りをしたが、何もかからなかった。`])
        : Object.keys(c.got).length ? [`${t0}池で釣りをした。うきが沈むのを待って、${haul}を釣り上げた。`, `${t0}釣りざおを持って池へ行った。${haul}。`] : [`${t0}池で釣りをしたが、何もかからなかった。`],
      smith: [`${t0}鍛冶屋の金床で、金づちをふるった。`, `${t0}鍛冶屋で火をおこして、金づちをふるった。`],
      hunt: [`${t0}動物を追いかけた。${haul}。`],
      ranch: c.ranchGot ? [`${t0}柵の中の動物に、えさと水をやった。${haul}をもらった。`, `${t0}動物の世話をした。${haul}をもらった。`] : [`${t0}柵の中の動物に、えさと水をやった。`],
    };
    // 日記は 1 日の時刻の順に書く（できごとごとに時刻 h を付けて並べる）。夜おそく寝た文は、いちばん最後（c.tail）
    const P2 = c.pieces = [];
    const put = (h, t) => { if (t) P2.push({ h, t }); };
    if (v.joinedDay === day) put(-1, '今日から村に住むことになった。よろしく。');
    if (c.off === 'hurt' && v.joinedDay !== day) put(-0.9, 'ゆうべのケガで、今日は家で休んだ。');
    else if (c.off === 'weak') put(-0.9, '体に力が入らないので、今日は家で休んだ。');
    if (diaryExtra[v.key]) put(-0.5, diaryExtra[v.key]);
    if (c.levelH) put(c.levelAt, `${tm(c.levelAt)}から、${c.level.what}の草をぬいて、石をどけて、地面をならした。`);
    if (c.homeWalk) put(c.homeAt, `${tm(c.homeAt)}、遠くから村まで歩いて帰った。`);
    // おもな仕事の文は、いちばん長く起きていたあいだ（寝る時間で区切る）の、最初の仕事の時刻に置く。
    // それより前の起きていたあいだの仕事（夜型の 0〜1 時など）は「もう少し働いた」と別に書く
    const wh = c.workHs || [];
    let mainAt = c.workAt;
    if (wh.length) {
      const blocks = [];
      let cur = null;
      for (let h = 0; h < 24; h++) {
        if (HR.parseCode(c.codes[h]).action === 'sleep') { cur = null; continue; }
        if (!cur) blocks.push(cur = []);
        if (wh.includes(h)) cur.push(h);
      }
      const big = blocks.filter((b) => b.length).sort((a, b) => b.length - a.length)[0];
      mainAt = big[0];
      for (const b of blocks) if (b.length && b !== big) put(b[0], `${tm(b[0])}から${b[b.length - 1] + 1}時まで、もう少し働いた。`);
    }
    if (!c.off && action !== 'rest' && action !== 'level' && T[action]) {
      const t1 = mainAt !== undefined ? tm(mainAt) + 'から、' : '';
      let text = R.pick(T[action]).replace(t0, t1);
      if (rain && R.chance(0.6)) text = '雨の中、' + text;
      else if (state.weather === '晴れ' && !HR.isNight(mainAt ?? 12, H) && R.chance(0.25)) text = 'いい天気。' + text;
      put(mainAt ?? 6, text);
    }
    const after = (mainAt ?? 6) + 0.1;
    if (action === 'chop' && c.fell >= 1 && c.helped) put(after, `仲間の木を${c.helped}本手伝った。`);
    // 夜の言葉は、本当にその時刻に働いた時だけ（夜型は夜に 2 時間以上、ほかの人は 23〜3 時に働いた時）
    if (action !== 'rest') {
      if (L.chrono === '夜型' && c.nightWork >= 2) put((c.nightAt ?? after) + 0.15, '夜のほうが元気が出る。');
      else if (c.lateWork) put((c.lateAt ?? after) + 0.15, '夜おそくまで働いた。');
    }
    for (const e of c.ev.sort((a, b) => a.h - b.h).slice(0, 4)) put(e.h + 0.5, e.text);
    for (const n of c.notes) put(after + 0.1, n);
    const lastTrip = (c.tripHs || []).slice(-1)[0];
    if (c.fullStop) put(c.fullStopAt ?? after + 0.2, `チェストまで${c.trips}回往復したが、また持ち物がいっぱいになったので、早めに作業をおしまいにした。`);
    else if (c.trips) put((lastTrip ?? after) + 0.2, `持ち物がいっぱいになって、チェストまで${c.trips}回往復した。`);
    // 仕事のあとの時間：ときどき 1 つだけ書く
    if (c.freeLog && c.freeLog.length && R4.chance(H.freeDiaryP ?? 0.6)) {
      const f = R4.pick(c.freeLog), o = f.other ? f.other.display : '';
      c.freePiece = f;
      put(f.h + 0.3, `${tm(f.h)}ごろ、` + {
        walk: R4.pick(['村のまわりをぶらぶら歩いた。', '島のはずれまで散歩してみた。']),
        chat: `${o}とおしゃべりした。`,
        view: '池のそばに座って、海をながめた。',
        water: '畑に水をやった。',
        pet: '柵の動物をなでてやった。',
        help: `${o}の荷物運びを手伝った。`,
      }[f.kind]);
    }
    if (c.noFood) { put(23.5, 'おなかがすいたが、食べる物がなかった。'); noFood = true; }
    else if (c.starved) put(23.5, 'おなかがすいて、体力が減った。');
    if (c.sleptAt !== undefined) {
      const st = { bed: L.home ? `${tm(c.sleptAt)}、ベッドでぐっすり眠った。` : `${tm(c.sleptAt)}、テントの中のベッドでぐっすり眠った。`, tree: `${tm(c.sleptAt)}、木にもたれて眠った。`, ground: L.home ? `${tm(c.sleptAt)}、家の床で横になって眠った。` : c.inTent ? `${tm(c.sleptAt)}、テントの中で敷物にくるまって眠った。` : `${tm(c.sleptAt)}、テントがいっぱいだったので、たき火のそばで横になって眠った。` }[c.sleepPlace];
      // その日の最後のできごとなら、あとで足される文（レベル・立ち話など）のさらに後ろに置く
      if (P2.every((x) => x.h < c.sleptAt)) c.tail = st; else put(c.sleptAt, st);
    }
    c.entry = { day, date, text: renderDiary(c) };
    c.baseLen = c.entry.text.length;
    L.diary.push(c.entry);
  }
  require('./titles').awardTitles({ config, villagers, life, history }, { day, date }); // 称号（最初に住んだ人。1 回だけ。今日の日記の後ろに書く）
  if (noFood) hist('event', '食べ物が足りなくなった。みんなおなかをすかせている。');
  syncRes();

  // ---- 7. 生える・育つ・また出てくる（日数は config.json の respawn） ----
  // 切り株：その場所にはもう生えない。stumpDays たつと、別の空いた場所に苗木が出て、saplingDays で木になる。
  // 切り株は stumpRotDays で朽ちて消える（たたいて掘り出すこともできる）
  for (const t of world.trees.slice()) {
    // 小さな島の町：苗木を出す前に切り株を掘り出した時も、別の所に苗木を 1 本出す（そうしないと島の木がへり続ける）
    const early = ISL && t.state === 'removed' && t.cutDay && !t.spawned;
    if (t.gone && !early) continue;
    if (t.state === 'stump' || early) {
      if (t.cutDay === day && !early) continue;
      if (!early) t.regrow -= 1;
      if ((t.regrow <= 0 || early) && !t.spawned) {
        t.spawned = day;
        const spot = freeSpot(0, 0, 'tree');
        // 苗木はそのマスの決まった所に（保存は地図の文字だけで済む）。同じマスにもう何かあれば置かない
        if (spot) { R3.int(0, 2); R3.range(0.85, 1.2); world.treeSeq++; }
        const nt = spot && TM.treeAt(spot.x, spot.z);
        if (nt && !nearBuilding(nt.x, nt.z) && !world.trees.some((o) => o.id === nt.id) && !IX.noGrow.any(nt.x, nt.z, 2) && !IX.trees.any(nt.x, nt.z, 2.6, (o) => !o.gone || o.state === 'removed')) addTree({ ...nt, state: 'sapling', regrow: RS2.saplingDays, born: day });
      }
      if (!early && t.cutDay && day - t.cutDay >= (RS2.stumpRotDays || 40)) { t.state = 'removed'; t.gone = 1; t.removedDay = day; }
    } else if (t.state === 'sapling') {
      if (t.born === day) continue;
      t.regrow -= 1;
      if (t.regrow <= 0) { t.state = 'tree'; t.logs = 0; }
    }
  }
  // 岩：同じ場所か、別の場所に新しく出る（建物や建てる場所の上には出ない）
  const busy = (x, z) => nearBuilding(x, z)
    || Math.hypot(x - world.square.x, z - world.square.z) < world.square.r + 2 || IX.trees.any(x, z, 2.6, (t) => !t.gone && t.state === 'tree')
    || IX.rocks.any(x, z, 4, (r) => r.hp > 0);
  for (const r of world.rocks) {
    if (r.hp > 0 || !r.back || day < r.back) continue;
    let x = r.x, z = r.z;
    if (!R.chance(RS2.sameSpot) || busy(x, z)) {
      let ok = false;
      for (let k = 0; k < 40 && !ok; k++) {
        if (ISL) { // 行ける島の上で、野原（world.meadow）と橋のたもとの外
          const p = IS.randomLand(world, () => R.next(), 5.5, 1); if (!p) continue;
          x = p.x; z = p.z;
          const M = world.meadow;
          ok = !busy(x, z) && !nearBridge(x, z) && !(M && x > M.x0 && x < M.x1 && z > M.z0 && z < M.z1);
          continue;
        }
        x = R.range(-100, 100); z = R.range(-100, world.seaZ - 6);
        ok = !busy(x, z) && !(x < -30 && x > -46 && z > -10 && z < 12);
      }
      if (!ok) continue;
    }
    r.gen = (r.gen || 0) + 1;
    r.x = +x.toFixed(2); r.z = +z.toFixed(2); IX.rocks.set(r, r.x, r.z);
    r.max = R.int(GA.rockItems[0], GA.rockItems[1]); r.hp = r.max;
    r.blocks = O.genBlocks(state.seed, { id: r.id + '#' + r.gen, max: r.max }, config.ores);
    if (Math.hypot(r.x - ctrOf(world).x, r.z - ctrOf(world).z) > 44) r.far = 1; else delete r.far;
    delete r.back; delete r.gone;
  }
  for (const b of world.bushes) if (!b.ready) { b.regrow -= 1; if (b.regrow <= 0) b.ready = true; }
  // りんごの木：とってから regrowDays 日でまた実る（実っている木は appleWait を持たない）
  for (const t of world.trees) if (t.appleWait) { t.appleWait -= 1; if (t.appleWait <= 0 || t.state !== 'tree') delete t.appleWait; }
  // 畑：毎日 1 段育つ。雨の日と、水路のそば（確率）はもう 1 段
  {
    const FA = config.farming;
    const canal = world.buildings.find((b) => b.type === 'canal');
    for (const f of world.fields) {
      const max = f.max || 3;
      if (f.day === day && f.stage === 0 && takenFields.has(f.id)) continue; // 今日まいた種は明日から
      let g = 1;
      if (rain) g++;
      else if (f.wet === day) g++; // 水をやった畑（雨の日は水やりはいらない）
      if (canal && Math.hypot(f.x - canal.x, f.z - canal.z) < FA.canalRange && R2.chance(FA.canalBoost)) { g++; f.water = 1; }
      f.stage = Math.min(max, f.stage + g);
    }
    // 骨粉：骨を砕いて作り、毎朝 perDay 個まで、まだ育ちきっていない畑にまく（もう 1 段育つ）。畑は id の順
    const BM = config.guardGear && config.guardGear.boneMeal;
    if (BM && world.fields.length) {
      while ((state.store.bone_meal || 0) < BM.perDay && (state.store.bone || 0) >= (BM.from.bone || 1)) {
        state.store.bone -= BM.from.bone || 1; if (!state.store.bone) delete state.store.bone;
        state.store.bone_meal = (state.store.bone_meal || 0) + BM.makes;
      }
      const grow = world.fields.filter((f) => f.stage < (f.max || 3) && !(f.day === day && f.stage === 0)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let used = 0;
      for (const f of grow) { if (used >= BM.perDay || !(state.store.bone_meal > 0)) break; f.stage++; f.meal = day; state.store.bone_meal--; used++; }
      if (!state.store.bone_meal) delete state.store.bone_meal;
      if (used) { today.boneMeal = used; first('bone_meal', `はじめて骨粉を畑にまいた。スケルトンの骨を砕いた肥料で、作物が早く育つ。`, { item: 'bone_meal' }); }
    }
  }
  // 種や作物を持っている村人には、近くの動物がついてくる。柵があれば、その人が柵まで連れて入れる（動物は減らない）
  const LURE = ['seeds', 'wheat', 'carrot', 'potato'];
  const leaders = active.filter((v) => { const g = (life[v.key].today && life[v.key].today.got) || {}; const it = LURE.find((k) => g[k] > 0); life[v.key].lure = it || null; return !!it; });
  {
    const AN = config.animals;
    let li = 0;
    for (const pen of world.buildings.filter((b) => b.type === 'pen')) {
      const inPen = world.animals.filter((a) => a.pen === pen.id);
      const wild = world.animals.filter((a) => !a.pen && Math.hypot(a.x - pen.x, a.z - pen.z) < AN.tameRange)
        .sort((a, b) => Math.hypot(a.x - pen.x, a.z - pen.z) - Math.hypot(b.x - pen.x, b.z - pen.z) || (a.id < b.id ? -1 : 1));
      // 種類がかたよらないように、まだいない種類を先に
      wild.sort((a, b) => inPen.some((x) => x.kind === a.kind) - inPen.some((x) => x.kind === b.kind));
      for (const a of wild.slice(0, Math.max(0, Math.min(AN.tamePerDay, AN.penCap - inPen.length, leaders.length - li)))) {
        const i = inPen.length;
        const ld = leaders[li++], Ll = life[ld.key];
        a.pen = pen.id; a.tamedDay = day; a.wildX = a.x; a.wildZ = a.z; a.ledBy = ld.key;
        Ll.diary[Ll.diary.length - 1].text += `${ITEMS[Ll.lure].name}を持っていたら${AN.kinds[a.kind].name}がついてきたので、柵に入れた。`;
        a.x = +(pen.x + ((i % 4) - 1.5) * 1.6 + R2.range(-0.3, 0.3)).toFixed(2); a.z = +(pen.z + (Math.floor(i / 4) - 0.5) * 1.8 + R2.range(-0.3, 0.3)).toFixed(2);
        inPen.push(a);
        first('tame', `野の${AN.kinds[a.kind].name}を、はじめて柵の中に入れて飼い始めた。`, { animal: a.id });
      }
    }
    // 柵の中で子が生まれる（config.hunting.breed）：同じ種類が 2 頭以上・柵に空きがある・前に来た（生まれた）日から every 日たった
    const BR = HU && HU.breed;
    if (BR) {
      let born = 0;
      for (const pen of world.buildings.filter((b) => b.type === 'pen')) {
        const inPen = world.animals.filter((a) => a.pen === pen.id);
        for (const kind of Object.keys(AN.kinds)) {
          if (born >= (BR.perDay ?? 1) || inPen.length >= AN.penCap) break;
          const same = inPen.filter((a) => a.kind === kind);
          if (same.length < 2) continue;
          const last = Math.max(...same.map((a) => a.born || a.tamedDay || 0));
          if (day - last < (BR.every ?? 3) || !RH.chance(BR.p ?? 0.4)) continue;
          state.animalSeq = Math.max(state.animalSeq || 0, ...world.animals.map((a) => parseInt(String(a.id).slice(1), 10) || 0)) + 1;
          const a = { id: 'a' + state.animalSeq, kind, x: +(pen.x + RH.range(-1.5, 1.5)).toFixed(2), z: +(pen.z + RH.range(-1.5, 1.5)).toFixed(2), pen: pen.id, tamedDay: day, born: day };
          a.wildX = a.x; a.wildZ = a.z;
          world.animals.push(a); inPen.push(a); born++;
          const nm = AN.kinds[kind].name;
          if (!first('born_' + kind, `柵の中で、はじめて${nm}の子が生まれた。`, { animal: a.id })) hist('event', `柵の中で${nm}の子が生まれた（柵の動物 ${inPen.length} 頭）。`, { animal: a.id });
        }
      }
    }
  }

  // ---- 8. 建てる（投票で決まった物を、決まった場所に）：材料 → 部品 → 建てる（土台 → 壁 → 屋根 → できあがり） ----
  // 部品（柱・石材・屋根板・扉）はチェストの原木・丸石・板から毎日少しずつ作る。部品にした分を引いた残りの材料と、部品がそろったら建て始める。
  // チェストだけで材料が足りなければ、材料を持っている人が持ち寄る（その人は明日の仕事が往復ぶん減る）
  const CNF = config.construction || {};
  const NEED = plan ? CON.needsOf(plan.build, config) : null;
  const rawCost = NEED ? NEED.raw : {};
  const lacking = () => RES.filter((r) => state.res[r] + 1e-9 < (rawCost[r] || 0));
  const partsLack = () => (NEED ? Object.entries(NEED.parts).filter(([k, n]) => (state.store[k] || 0) < n) : []);
  if (plan && plan.site && !plan.started && partsLack().length && CNF.parts) {
    const made = {}; let budget = CNF.partsPerDay || 6;
    for (const [k, n] of Object.entries(NEED.parts)) {
      const from = (CNF.parts[k] || {}).from || {};
      while ((state.store[k] || 0) < n && budget > 0) {
        if (from.planks && (state.store.planks || 0) < from.planks && (state.store.log || 0) > 0) { // 板が足りなければ原木から（原木 1 → 板 4）
          state.store.log--; if (!state.store.log) delete state.store.log; state.store.planks = (state.store.planks || 0) + 4; continue;
        }
        if (!Object.entries(from).every(([it, m]) => (state.store[it] || 0) >= m)) break;
        for (const [it, m] of Object.entries(from)) { state.store[it] -= m; if (!state.store[it]) delete state.store[it]; }
        state.store[k] = (state.store[k] || 0) + 1; made[k] = (made[k] || 0) + 1; budget--;
      }
    }
    syncRes();
    if (Object.keys(made).length) {
      const txt = Object.entries(made).map(([k, n]) => `${ITEMS[k] ? ITEMS[k].name : k} ${n}`).join('、');
      const maker = active.slice().sort((a, b) => hashStr(a.key + ':pt' + day) - hashStr(b.key + ':pt' + day))[0];
      if (maker && life[maker.key]) { const L = life[maker.key]; L.diary[L.diary.length - 1].text += `${B(plan.build).name}の部品（${txt}）を作った。`; L.xp += IC.xp.carry || 0; }
      first('part', `はじめて建てる部品（${txt}）を作った。材料を部品にしてから建てる。`, { parts: made });
    }
  }
  const lackingAll = () => lacking().length || partsLack().length;
  if (plan && plan.site && plan.leveled && !plan.started && lacking().length) {
    const pooled = { ...state.res };
    const carriers = active.map((v) => ({ v, val: valueOf(Object.fromEntries(life[v.key].inv.filter((s) => s && !I.isTool(s) && config.spendOrder.wood.concat(config.spendOrder.stone, config.spendOrder.food).includes(s.item)).map((s) => [s.item, s.n]))) }));
    for (const c of carriers) for (const r of RES) pooled[r] += c.val[r];
    if (RES.every((r) => pooled[r] + 1e-9 >= (rawCost[r] || 0))) {
      carriers.sort((a, b) => RES.reduce((s, r) => s + (lacking().includes(r) ? b.val[r] - a.val[r] : 0), 0));
      for (const c of carriers) {
        const lk = lacking();
        if (!lk.length) break;
        if (!lk.some((r) => c.val[r] > 0)) continue;
        const L = life[c.v.key];
        const val = deposit(I.unload(L.inv));
        for (const r of RES) L.contrib[r] += val[r];
        L.trips++; today.trips++; L.debt += IC.tripCost; L.xp += IC.xp.carry;
        L.diary[L.diary.length - 1].text += '建てる材料をチェストへ運んだ。';
      }
    }
  }
  // 材料と部品がそろった：使って建て始める（まず土台）
  if (plan && plan.site && plan.leveled && !plan.started && !lackingAll()) {
    for (const r of RES) if (rawCost[r]) spend(r, rawCost[r]);
    for (const [k, n] of Object.entries(NEED.parts)) { state.store[k] -= n; if (!state.store[k]) delete state.store[k]; }
    syncRes();
    const bc = B(plan.build).cost || {};
    let bs = active.filter((v) => RES.some((r) => (bc[r] || 0) > 0 && life[v.key].contrib[r] > 0)).map((v) => v.key);
    if (!bs.length) bs = active.slice().sort((a, b) => hashStr(a.key + ':bd' + day) - hashStr(b.key + ':bd' + day)).slice(0, 2).map((v) => v.key);
    Object.assign(plan, { started: day, buildNeed: CON.buildHours(plan.build, config), buildH: 0, builders: bs });
    const pt = Object.entries(NEED.parts).map(([k, n]) => `${ITEMS[k] ? ITEMS[k].name : k} ${n}`).join('、');
    hist('build_start', `${B(plan.build).name}の材料${pt ? 'と部品（' + pt + '）' : ''}がそろったので、${plan.site.label}で建て始めた。${CON.hasStages(plan.build, config) ? 'まず土台から。' : ''}`, { buildingType: plan.build });
  }
  // 建てている：毎日、建てる人が少しずつ進める（土台 → 壁 → 屋根）。町の画面は hourProg で 1 時間ごとの進みを見せる
  if (plan && plan.started && plan.buildH < plan.buildNeed) {
    const nB = Math.min(CNF.builders || 4, Math.max(2, (plan.builders || []).length));
    const before = plan.buildH, after = Math.min(plan.buildNeed, before + nB * (CNF.builderHours || 3));
    plan.hourProg = Array.from({ length: 24 }, (_, h) => +((before + (after - before) * Math.max(0, Math.min(1, (h - 8) / 9))) / plan.buildNeed).toFixed(3));
    plan.buildH = after;
    const s0 = CON.stageOf(before / plan.buildNeed, config), s1 = CON.stageOf(after / plan.buildNeed, config), nm = B(plan.build).name;
    const staged = CON.hasStages(plan.build, config);
    if (staged) for (let s = s0 + 1; s <= Math.min(2, s1); s++) hist('build_stage', `${nm}の${CON.STAGE_NAMES[s - 1]}ができた。次は${CON.STAGE_NAMES[s]}。`, { buildingType: plan.build, stage: s });
    for (const k of (plan.builders || []).slice(0, nB)) if (life[k] && life[k].diary.length) life[k].diary[life[k].diary.length - 1].text += staged ? `${nm}を建てた（${CON.STAGE_NAMES[Math.min(2, s1)]}）。` : `${nm}を作った。`;
  }
  if (plan && plan.started && plan.buildH >= plan.buildNeed - 1e-9) {
    const def = B(plan.build);
    const pos = plan.site;
    const id = plan.build + '_' + world.buildings.length;
    const builders = plan.builders || [];
    const b = { id, type: plan.build, x: pos.x, z: pos.z, plot: pos.plot, rot: +Math.atan2(-(pos.x - ctrOf(world).x), -(pos.z - ctrOf(world).z)).toFixed(3), day, builders, variant: R.int(0, 3), voted: true };
    if (pos.plot === 'coast' || pos.plot === 'coast2' || pos.plot === 'coast3') b.rot = Math.PI;
    if (pos.rot !== undefined) b.rot = pos.rot;
    world.buildings.push(b);
    clearAround(b.x, b.z); // 建物のまわりの木と岩をどける（そこにはもう生えない）
    if (plan.build === 'farm') { // 畑の区画（3 × 2）。建った場所の向きにそろえる
      const n = config.farming.plotsPerFarm, c = Math.cos(b.rot), s = Math.sin(b.rot);
      for (let i = 0; i < n; i++) {
        const lx = ((i % 3) - 1) * 2.3, lz = (Math.floor(i / 3) - 0.5) * 2.5;
        { const fs0 = { x: +(b.x + lx * c + lz * s).toFixed(2), z: +(b.z - lx * s + lz * c).toFixed(2), farm: b.id, rot: b.rot }; world.fieldSlots.push(fs0); IX.slots.set(fs0, fs0.x, fs0.z); }
      }
    }
    for (const k of builders) { life[k].built.push(id); life[k].xp += IC.xp.build; for (const r of RES) life[k].contrib[r] = 0; life[k].diary[life[k].diary.length - 1].text += `${def.name}ができた。自分の運んだ材料も使われている。`; }
    today.built.push(id);
    hist('build', `投票で決まった${def.name}が${pos.label}に建った。${builders.length} 人が材料を集めた。`, { building: id, buildingType: plan.build });
    state.plan = null;
  }
  // 次に作れる道具（サイトの「町のチェスト」に出す）
  {
    const best = (kind) => active.reduce((m, v) => { const t = I.getTool(life[v.key].inv || [], kind); const tier = t ? I.toolTier(t.item) : 'hand'; return CR.tierRank(tier) > CR.tierRank(m) ? tier : m; }, 'hand');
    const ch = CR.choose(state.store, 'pickaxe', CC, { built: world.buildings.map((x) => x.type), have: best('pickaxe'), goal: state.toolGoal });
    let nt = ch.key ? { item: ch.key, ok: true, text: "作れる" } : ch.want ? { item: ch.want.key, ok: false, missing: ch.want.missing, text: `材料が足りない（${CR.missingText(ch.want.missing, ITEMS)}）` } : null;
    if (!nt) { // 次の段階に作業台が要る時
      const have = best("pickaxe"), nx = Object.entries(CC.recipes).find(([, r]) => r.tool === "pickaxe" && CR.tierRank(r.tier) === CR.tierRank(have) + 1);
      if (nx) nt = { item: nx[0], ok: false, text: `${B(CC.tiers[nx[1].tier].needs).name}がいる` };
    }
    state.nextTool = nt;
  }

  // ---- 8.2 となりの島へ橋をかける（config.json の expansion）----
  // フォロワーが followers 人に届いた日から、チェストの木材と石を毎日 perDay まで使って橋を作る（keep の分はチェストに残す）。
  // cost の分がそろうと橋ができあがり、その島へ行けるようになる（木・岩・区画・動物が使える）。投票とは別に進む
  if (ISL && config.expansion && config.expansion.bridges) {
    if (!state.expansion) state.expansion = {};
    const addLine = (k, t) => { const L = life[k], d = L && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += t; };
    for (const br of world.bridges || []) {
      const def = config.expansion.bridges[br.id];
      const isl = world.islands.find((i) => i.id === br.to);
      if (!def || !isl || br.built) continue;
      const ex = state.expansion[br.id];
      const nm = isl.name || 'となりの島';
      if (!ex) {
        if (state.followers < def.followers || day < (def.minDay || 1) || !active.length) continue;
        state.expansion[br.id] = { started: day, paid: { wood: 0, stone: 0 }, cost: { ...def.cost } };
        hist('event', `フォロワーが${def.followers}人をこえた。北の海の向こうに見える「${nm}」へ、橋をかけることになった。チェストの木材と石を少しずつ使って作る。`, { expansion: br.id, stage: 'start' });
        for (const v of active) addLine(v.key, `${nm}へ橋をかけることになった。`);
        continue;
      }
      // 材料を少しずつ橋にする
      const got = {};
      for (const r of ['wood', 'stone']) {
        const want = Math.max(0, (ex.cost[r] || 0) - ex.paid[r]);
        const can = Math.min(want, (def.perDay && def.perDay[r]) || want, Math.max(0, Math.floor(state.res[r] - ((def.keep && def.keep[r]) || 0))));
        if (can > 0 && spend(r, can)) { ex.paid[r] += can; got[r] = can; }
      }
      if (Object.keys(got).length) {
        const crew = active.slice().sort((a, b) => hashStr(a.key + ':br' + day) - hashStr(b.key + ':br' + day)).slice(0, def.crew || 3);
        const txt = Object.entries(got).map(([r, n]) => `${RES_JA[r]} ${n}`).join('・');
        for (const v of crew) { const L = life[v.key], d = L && L.diary[L.diary.length - 1]; if (d && d.day === day) { d.text += `${nm}への橋に、板と石を運んで打ちつけた（${txt}）。`; L.xp += IC.xp.carry || 0; } }
        ex.crew = crew.map((v) => v.key);
      }
      ex.prog = +Math.min(1, ['wood', 'stone'].reduce((s, r) => s + ex.paid[r], 0) / Math.max(1, ['wood', 'stone'].reduce((s, r) => s + (ex.cost[r] || 0), 0))).toFixed(3);
      if (['wood', 'stone'].every((r) => ex.paid[r] >= (ex.cost[r] || 0))) {
        br.built = day; isl.open = day; ex.built = day; ex.prog = 1;
        hist('event', `${nm}への橋ができあがった！ 明日からは${nm}でも木を切ったり岩を掘ったりでき、家も建てられる。`, { expansion: br.id, stage: 'built' });
        first('bridge_' + br.id, `はじめて海に橋がかかった。町が${nm}まで広がった。`, { expansion: br.id });
        for (const v of active) addLine(v.key, `${nm}への橋ができた。明日、わたってみたい。`);
        for (const k of ex.crew || []) { const L = life[k], d = L && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += `${nm}への橋ができあがった。`; }
      }
    }
  }
  syncRes();

  // ---- 8.5 コメントで参加した人にも少し経験値 ----
  const bonusXp = (users, amount, note) => {
    const seen = new Set();
    for (const u of users) {
      const v = P.findVillager(active, u);
      if (!v || seen.has(v.key) || !life[v.key]) continue;
      seen.add(v.key); life[v.key].xp += amount;
      if (note) life[v.key].diary[life[v.key].diary.length - 1].text += note;
    }
  };
  if (inbox && inbox.joinComments) bonusXp(inbox.joinComments.filter((c) => Date.parse(c.timestamp) >= Date.parse(jst(addDays(date, -1), 0))).map(P.commentUser), IC.xp.comment);
  if (closedVoters.length) bonusXp(closedVoters, IC.xp.vote, '投票に参加した。');

  // ---- レベルと枠 ----
  for (const v of active) {
    const L = life[v.key];
    const before = { level: L.level, slots: L.slots };
    W.refreshLevel(L, daysIn(v), IC);
    const d = L.diary[L.diary.length - 1];
    if (L.level > before.level) d.text += `レベルが${L.level}になった。`;
    if (L.slots > before.slots) d.text += `持ち物の枠がふえた（${L.slots}枠）。`;
  }

  // ---- 9. 住む家 ----
  W.assignHomes(active, life, world, config);

  // ---- 10. 誕生日（月日だけ） ----
  const md = date.slice(5);
  today.birthdays = active.filter((v) => v.birthday === md).map((v) => v.key);
  // ---- 10.5 誕生日パーティと島の行事（js/islandevents.js）。同じ日が誕生日の人が何人いても、夕方の広場で 1 回にまとめる ----
  today.events = EV.eventsOn(date, today.birthdays, config);
  const EVX = (config.islandEventsXp || {});
  const noteDiary = (k, text) => { const L = life[k], d = L && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += text; else if (L) L.diary.push({ day, date, text }); };
  for (const ev of today.events) {
    if (ev.id === 'birthday') {
      const vs = ev.who.map((k) => active.find((x) => x.key === k)).filter(Boolean);
      const guests = active.filter((v) => !ev.who.includes(v.key)).length;
      ev.gifts = {};
      for (const v of vs) {
        const L = life[v.key];
        L.xp += EVX.birthday ?? 20; // 本人には経験値と小さな贈り物
        const g = EV.giftFor(v, ITEMS0, hashStr);
        if (g) {
          ev.gifts[v.key] = g;
          if (!L.inv || I.addItem(L.inv, L.slots, g, 1, IC.stack) > 0) deposit({ [g]: 1 }); // 持ち物がいっぱいならチェストへ
          L.gifts = (L.gifts || []).concat({ day, item: g }).slice(-20);
        }
        noteDiary(v.key, `今日は誕生日。夕方、広場でみんながパーティを開いてくれた。${g ? `贈り物に${(ITEMS0[g] || {}).name || g}をもらった。` : ''}`);
      }
      hist('birthday', `${EV.partyTitle(vs.map((v) => v.display))}。夕方、広場にケーキと飾りを出して${guests ? `、${guests}人でお祝いした` : 'お祝いした'}。`, { who: ev.who, event: 'birthday', title: EV.partyTitle(vs.map((v) => v.display)) });
      continue;
    }
    // 季節の行事：みんなに少し経験値。釣り大会は今日いちばん大きな魚を釣った人が優勝
    for (const v of active) if (life[v.key]) life[v.key].xp += EVX.festival ?? 5;
    const def = EV.eventList(config).find((e) => e.id === ev.id) || {};
    let extra = '', who;
    if (ev.id === 'fishing') {
      let best = null;
      for (const v of active) for (const f of ((life[v.key] || {}).today || {}).fish || []) if (!best || f[1] > best.cm) best = { k: v.key, it: f[0], cm: f[1], name: v.display };
      if (best) {
        ev.winner = best.k; who = [best.k];
        life[best.k].xp += EVX.fishingWin ?? 15;
        extra = `優勝は${best.name}さん（${best.cm}cm の${(ITEMS0[best.it] || {}).name || best.it}）。`;
        noteDiary(best.k, `釣り大会で優勝した（${best.cm}cm）。`);
      }
    }
    hist('event', `${ev.name}${ev.day > 1 ? `（${ev.day}日目）` : ''}。${def.text || ''}${extra}`, { kind: 'festival', event: ev.id, ...(who ? { who } : {}) });
    for (const v of active) if (!who || !who.includes(v.key)) noteDiary(v.key, `夕方は広場の${ev.name}に行った。`);
  }

  // ---- 11. 関係と立ち話 ----
  const objAt = {};
  for (const arr of [world.trees, world.rocks, world.fields || [], world.bushes || [], world.buildings]) for (const o of arr) objAt[o.id] = o;
  const soc = SO.stepSocial(S.social, {
    day, R: RS, active, life, weather: state.weather, hist, birthdays: today.birthdays,
    posOf: (k) => objAt[life[k].target] || objAt[life[k].home] || null,
    homePos: (id) => (id && objAt[id]) || null,
    built: today.built.length ? B(world.buildings.find((b) => b.id === today.built[0]).type).name : '',
    queueNext: state.plan ? B(state.plan.build).name : '',
    vote: state.votes.find((v) => v.kind !== 'where') || null,
  });
  today.talks = soc.talks.length;
  // 立ち話は、2 人がおしゃべりしていた時間に置く。なければ 2 人とも手のあいていた時間をおしゃべりにする
  const ctxOf = Object.fromEntries(ctxs.map((c) => [c.v.key, c]));
  const FREEISH = new Set(['sp', 'sv', 'pt', 'r']);
  let rehour = new Set();
  for (const t of soc.talks) {
    const A = ctxOf[t.a], Bc = ctxOf[t.b];
    let at = -1;
    if (A && Bc) {
      at = A.codes.findIndex((x) => x === 'tk:' + t.b);
      if (at < 0) {
        at = A.codes.findIndex((x, h) => FREEISH.has(x) && FREEISH.has(Bc.codes[h]) && !HR.isNight(h, H));
        if (at >= 0) { A.codes[at] = 'tk:' + t.b; Bc.codes[at] = 'tk:' + t.a; rehour.add(A).add(Bc); }
      }
    }
    for (const k of [t.a, t.b]) {
      const other = active.find((x) => x.key === (k === t.a ? t.b : t.a)), c = ctxOf[k];
      const line = `${other.display}と立ち話をした。`;
      if (c && c.entry && at >= 0) {
        // 同じ相手とのおしゃべりの文は、立ち話の文にまとめる
        // 同じ時間の、仕事のあとの文も（同じ時刻が 2 回続かないように）
        if (c.freePiece && ((c.freePiece.kind === 'chat' && c.freePiece.other && c.freePiece.other.key === other.key) || c.freePiece.h === at)) c.pieces = c.pieces.filter((x) => x.h !== c.freePiece.h + 0.3);
        insertDiary(c, at + 0.3, `${tm(at)}ごろ、${line}`);
      } else life[k].diary[life[k].diary.length - 1].text += line;
    }
  }
  for (const c of rehour) c.L.hours = HR.encodeHours(c.codes);
  // 夜おそく寝た文は、その日のいちばん最後（このあとの夜のできごとの前）
  for (const c of ctxs) if (c.tail && c.entry) c.entry.text += c.tail;

  // ---- 11.5 家の飾りと手紙（tools/decor.js・tools/mail.js。web の分は data/inbox/play.json）。別の乱数なので、ここまでの結果は変わらない ----
  require('./decor').stepDecor(S, { day, play: S.play });
  require('./mail').stepMail(S, { day, play: S.play, since: Date.parse(jst(addDays(date, -1), 0)), R: makeRng('mail:' + state.seed + ':' + day).next, built: today.built.length ? B(world.buildings.find((b) => b.id === today.built[0]).type).name : '' });
  require('./visit').stepVisit(S, { day, play: S.play, R: makeRng('visit:' + state.seed + ':' + day).next, hist }); // 誰かの家に遊びに行く（tools/visit.js）

  // ---- 12. 夜（敵が来る・見張りが追い払う）。別の乱数なので、ここまでの結果は変わらない ----
  // 見張りの装備：剣（いちばん良い物）、なければ持っている道具、なければたいまつ、なければ素手。盾はチェストの数だけ、先の見張りから
  let shieldLeft = state.store.shield || 0;
  const nightGear = (k) => {
    const L = life[k] || {}, inv = (L.inv || []).filter(Boolean);
    const sw = I.getTool(inv, 'sword'), tool = inv.find((x) => I.isTool(x.item));
    const weapon = sw ? sw.item : tool ? tool.item : (state.store.torch || 0) > 0 ? 'torch' : null;
    const shield = shieldLeft > 0; if (shield) shieldLeft--;
    const armor = SMT.armorDef(L.gear, config.smithing); // 鍛冶職人が作った防具の守り（ない人は 0：前と同じ戦い）
    return armor > 0 ? { weapon, shield, armor } : { weapon, shield };
  };
  state.night = config.enemies && config.enemies.enabled ? N.stepNight({ day, seed: state.seed, active, life, world, state, config, hist, gear: nightGear, guards: ctxs.filter((c) => c.awakeNight && !c.off).map((c) => c.v.key), outside: ctxs.filter((c) => c.outNight && R4.chance(H.outsideHurtP)).map((c) => c.v.key) }) : null;
  syncRes();
  // 夜の魔物（config.nightFoes。町の画面で見るだけ）：3 つ目の大きな島に夜だけ出る。海とサメで渡れないので村には来ない（村の夜の戦いは enemies）。
  //   夜に起きていた人がいれば、はじめての時だけ歴史に書く
  if (config.nightFoes && config.nightFoes.enabled !== false && ISL && world.islands.some((i) => i.id === (config.nightFoes.island || 'far'))) {
    const saw = ctxs.find((c) => c.awakeNight && !c.off);
    if (saw) first('night_foes', `${day}日目の夜、${saw.v.display}が海の向こうの大きな島を見ると、魔物の目がいくつも光っていた。海とサメがいるので、魔物は村には来られない。`, { who: [saw.v.key] });
  }
  if (state.night) {
    const NT = state.night, XP = IC.xp, BG = config.badges;
    const nameOf = (k) => (active.find((v) => v.key === k) || { display: k }).display;
    for (const k of NT.guards || []) {
      const L = life[k]; if (!L) continue;
      let gain = XP.guard || 0;
      const kl = (NT.kills || {})[k] || {};
      for (const t of Object.keys(kl)) { gain += (XP['kill_' + t] || 0) * kl[t]; L.kills = L.kills || { total: 0 }; L.kills[t] = (L.kills[t] || 0) + kl[t]; L.kills.total += kl[t]; }
      if (NT.fight && NT.fight.end === 'won') gain += XP.repel || 0; // 守りきった夜（敵を全員倒した）
      L.xp += gain; L.nightXp = { day, xp: gain };
    }
    if (NT.drops && Object.keys(NT.drops).length) {
      deposit(NT.drops);
      const txt = Object.entries(NT.drops).map(([it, n]) => `${ITEMS[it] ? ITEMS[it].name : it} ${n}`).join('、');
      hist('night', `${day}日目の夜、倒した敵の落とし物（${txt}）をチェストに入れた。`, { night: day, drops: NT.drops });
    }
    state.nightLog = (state.nightLog || []).concat({ day, count: state.night.count, result: state.night.result, defense: state.night.defense }).slice(-60);
    today.night = { count: state.night.count, result: state.night.result };
  }

  // バッジ（はじまりの住人・技能バッジ 銅/銀/金/ダイヤ）：届いたら町の歴史と日記に残す
  const BGS = config.badges;
  if (BGS) for (const v of active) {
    const k = v.key, L = life[k]; if (!L) continue;
    const got = CB.badgesOf(L, v, BGS);
    L.badges = L.badges || {};
    for (const [id, tier] of Object.entries(got)) {
      if (tier <= (L.badges[id] ?? -1)) continue;
      const B = BGS.list[id]; L.badges[id] = tier;
      const what = B.founder ? `「${B.name}」のバッジ` : `「${B.name}」の${BGS.tierNames[tier]}バッジ`;
      const why = B.founder ? B.note : `${B.note} ${CB.badgeCount(L, B.stat)}${B.unit || ''}`;
      hist('badge', `${v.display}が${what}をもらった（${why}）。`, { who: [k], badge: id, tier });
      const d = L.diary[L.diary.length - 1];
      if (d && d.day === day) d.text += `${what}をもらった。`;
    }
  }

  // 称号バッジ（釣りの 1 位・橋づくり・友だちの数など、一日の終わりに決まるもの。1 人 1 回だけ。tools/titles.js）
  require('./titles').awardTitles({ config, villagers, life, history, state, social: S.social }, { day, date });
  for (const k in life) if (life[k].diary.length > 90) life[k].diary.splice(0, life[k].diary.length - 90);
  state.day = day; state.date = date; state.today = today; state.updated = new Date().toISOString();
}

// ---------- 実行 ----------
const days = Number(opt('--days', 1));
// 毎日の更新（GitHub Actions）で TOWN_SALT がないまま公開データを書くと、だれでも計算できる開発用の印になる。書かずに止める
if (process.env.GITHUB_ACTIONS && P.saltIsDev) { console.error('TOWN_SALT がありません（Secrets を daily.yml の env で渡してください）。公開データは書きません'); process.exit(1); }
const config = read('config.json');
const S = {
  config, villagers: read('villagers.json', []), world: ST.readWorld(DATA), state: read('state.json'),
  life: ST.readLife(DATA), history: read('history.json', []), hidden: P.loadHidden(DATA),
  social: read('social.json', { pairs: {}, talks: [] }),
  priv: read('inbox/profiles_private.json', null),
  play: read('inbox/play.json', null), // web の設定（鉱石の持ち方・誕生日）。tools/play.js pull が置く
  mail: read('mail.json', null), decor: read('decor.json', null), // 手紙と家の飾り（tools/mail.js・tools/decor.js）
  visits: read('visits.json', null), // 遊びに行った・来た人ノート（tools/visit.js）
};
S.demo = args.includes('--demo') || S.state.demo;
const inboxFile = opt('--inbox', path.join(DATA, 'inbox', 'instagram.json'));
S.inbox = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : null;
if (S.inbox && S.inbox.sample) S.inbox = null; // 見本ファイルは使わない
// 建物のリクエスト（「温泉ほしい」など）を数える。投票は変えない、うらの集計（data/requests.json）
const reqComments = S.inbox ? [...(S.inbox.joinComments || []), ...(S.inbox.voteComments || [])] : [];
// 町を始める日の決まり（daily.yml は --gate を付けて動かす）。0 日目のあいだは、持ち主が始めるまで日を進めない
//   始める：config.json の startAt の日時を過ぎた時、または --start（Actions の「Run workflow」で start を選んだ時）
//   手で `node tools/sim.js` を動かす時（--gate なし）は、今までどおりいつも進める
const gate = args.includes('--gate');
const startNow = args.includes('--start') || /^(1|true|yes)$/i.test(process.env.TOWN_START || '');
const nowArg = opt('--now', process.env.TOWN_NOW || null); // テスト用：今の時刻を決める
const NOW = nowArg ? new Date(nowArg) : new Date();
if (!W.shouldAdvance(S.state, config, { gate, start: startNow, now: NOW })) {
  const at = W.parseStartAt(config.startAt);
  console.log(`町はまだ 0 日目です（${at ? '始まる日時 ' + new Date(at + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + '（日本時間）' : '始まる日はまだ決まっていません'}）。日は進めません`);
  process.exit(0);
}
if (gate && S.state.day === 0) { // 0 日目から始める：1 日目は今日（日本時間）にする
  S.state.startDate = W.jstToday(NOW);
  S.state.startedAt = NOW.toISOString();
}
S.now = NOW; // 拠点の投票を締める時刻
// 今建てている物の「いる数」と「あつまった数」を state.plan に書いておく（町の画面で「あと何個」を出す）。
//   plan.need：{ wood, stone, food（部品にした分を引いた材料）, 柱などの部品: 数 }／plan.got：同じ形で、今あつまっている数（建て始めたら need と同じ）
//   橋は state.expansion[id] の cost（いる数）と paid（使った数）でわかる
function noteProjects(S) {
  const pl = S.state.plan;
  if (!pl || !pl.build || !S.config.buildings[pl.build]) return;
  const nd = CON.needsOf(pl.build, S.config), res = S.state.resources || {}, store = S.state.store || {};
  pl.need = { ...nd.raw, ...nd.parts };
  pl.got = {};
  for (const [k, n] of Object.entries(pl.need)) pl.got[k] = pl.started ? n : Math.max(0, Math.min(n, Math.floor((RES.includes(k) ? res[k] : store[k]) || 0)));
}
for (let i = 0; i < days; i++) { stepDay(S); noteProjects(S); if (i === 0 && S.inbox) S.inbox = { ...S.inbox, joinComments: null }; }
write('villagers.json', S.villagers);
ST.writeWorld(DATA, S.world, { clearR: ((S.config.terrain && S.config.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
write('state.json', S.state);
ST.writeLife(DATA, S.life);
write('history.json', S.history);
write('social.json', S.social);
if (S.mail) write('mail.json', S.mail);
if (S.decor) write('decor.json', S.decor);
if (S.visits) write('visits.json', S.visits);
require('./requests').updateFiles( // コメントがない日もファイルは作る（daily.yml の git add で使う）
DATA, reqComments, S.config, S.state.day);
console.log(`${S.state.day} 日目まで進めました（村人 ${S.villagers.filter((v) => v.joinedDay <= S.state.day).length} 人・建物 ${S.world.buildings.length}・フォロワー ${S.state.followers}）`);
