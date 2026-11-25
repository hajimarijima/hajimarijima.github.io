'use strict';
// 村人どうしの関係・立ち話・プロフィール（MBTI と誕生日）。sim.js とテストで使う。
// 決まり方は種と日付だけで決まる（同じ入力なら同じ結果）。
const { hashStr } = require('./rand');
const P = require('./people');
const TM = require('../js/tilemap.js'); // 近い人を探すマスの一覧（空間ハッシュ）

// ---------- MBTI ----------
const MBTI = ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ'];
const LETTER = {
  E: 'よくしゃべる', I: 'ひとりで働くのが好き', N: '新しいものの話が好き', S: '目の前の仕事を大事にする',
  T: '段取りを考える', F: '仲間思い', J: '計画どおりに進めたい', P: '気まぐれ',
};
// MBTI が入っていない人は、番号から気質を決める（表には出さない）
function traits(v) {
  const mm = v.mbti || (v._priv && v._priv.mbti);
  const m = mm && MBTI.includes(mm) ? mm : null;
  const h = hashStr('trait:' + v.key);
  const pick = (i, a, b) => (m ? m[i] : ((h >>> (i * 3)) & 1) ? a : b);
  const t = { E: pick(0, 'E', 'I') === 'E', N: pick(1, 'N', 'S') === 'N', F: pick(2, 'F', 'T') === 'F', J: pick(3, 'J', 'P') === 'J', known: !!m };
  t.talk = t.E ? 0.75 : 0.35;
  t.solo = !t.E;
  return t;
}
function personality(v) {
  if (!v.mbti) return [];
  return v.mbti.split('').map((c) => LETTER[c]);
}
// 相性 -1〜1：考え方（N/S）が同じ・気持ち（F/T）が同じだと合う。E と I は少し補い合う。
function compat(a, b) {
  const x = traits(a), y = traits(b);
  let s = 0;
  s += x.N === y.N ? 0.35 : -0.25;
  s += x.F === y.F ? 0.25 : -0.15;
  s += x.E !== y.E ? 0.15 : 0.05;
  s += x.J === y.J ? 0.1 : -0.1;
  return Math.max(-1, Math.min(1, s));
}

// ---------- プロフィールのコメント ----------
// 「プロフ INFP 0512」「プロフ infp 5/12」「プロフ ENFJ 12-03」など
function parseProfile(text, word = 'プロフ') {
  const s = P.norm(text).toUpperCase().replace(/\s+/g, ' ');
  const w = P.norm(word).toUpperCase();
  const i = s.indexOf(w);
  if (i < 0) return null;
  // 「0512」（2 桁ずつ）か「5/12」「5-12」「5月12日」
  const m = s.slice(i + w.length).match(/^\s*([EI][NS][TF][JP])\s*(?:(\d{2})(\d{2})(?!\d)|(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})(?!\d))/);
  if (!m) return null;
  const mm = +(m[2] || m[4]), dd = +(m[3] || m[5]);
  const days = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= days[mm])) return null;
  return { mbti: m[1], birthday: String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0') };
}
// 本人かどうかは from.id で確かめる（名前だけのコメントは使わない）。1 人 1 つ、あとのコメントが勝つ。
function profilesFrom(comments, word) {
  const out = new Map();
  for (const c of (comments || []).slice().sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0))) {
    const id = c.from && c.from.id;
    if (!id) continue;
    const p = parseProfile(c.text, word);
    if (p) out.set(String(id), p);
  }
  return [...out].map(([igId, p]) => ({ igId, ...p }));
}

// ---------- 関係 ----------
const KIND = { family: '家族', best: '親友', friend: '友だち', rival: 'ライバル', crush: '片思い', known: '知り合い' };
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
function kindOf(p, a, b) {
  if (p.family >= 5) return 'family';
  if (p.rival) return 'rival';
  if (p.s >= 40) return 'best';
  if (p.crush && p.s >= 16) return 'crush';
  if (p.s >= 20) return 'friend';
  if (p.s >= 6) return 'known';
  return null;
}
// a から見た b との関係（片思いは向きがある）
function viewOf(p, me) {
  const k = kindOf(p);
  if (k === 'crush') return p.crush === me ? 'crush' : 'friend';
  return k;
}

// ---------- 立ち話のセリフ ----------
const T = {
  open: ['おつかれさま！', 'やあ、元気？', 'ちょっと休もうか', 'ねえねえ'],
  weather: {
    '晴れ': ['いい天気だね', '日ざしが気持ちいい', '洗たく日和だ'],
    'くもり': ['くもってきたね', '暑くなくていいね', '雨になるかな'],
    '雨': ['よく降るね', '足もとに気をつけて', '雨の日は休みたい'],
  },
  job: {
    wood: ['今日は木を{n}本切った', '斧が重くなってきた', '木の香りっていいね'],
    stone: ['岩がかたくて手がしびれる', 'つるはしを研がなきゃ', '石がたくさんとれた'],
    food: ['ベリーがよく実ってた', '畑の麦が育ってきた', 'おなかすいたね'],
    none: ['今日はのんびりしてた', 'ぶらぶら町を歩いた'],
  },
  build: ['{b}ができたね！', '{b}、もう見た？', '次は{q}らしいよ', '{q}の材料、あと少し'],
  vote: ['投票、何にした？', '{o}がいいなあ', 'みんな迷ってるみたい'],
  reply: ['うんうん', 'ほんとにね', 'わかる！', 'がんばろうね'],
  // 話題ごとの返事
  re: {
    weather: { '晴れ': ['ほんと、ぽかぽかだね', '散歩したくなるね'], 'くもり': ['ちょうどいいくらいだね', '傘を持っていこうかな'], '雨': ['畑にはうれしい雨だね', '早く晴れるといいね'] },
    build: ['見に行こう！', 'がんばった甲斐があったね', '中はどうなってるかな'],
    buildNext: ['じゃあ材料を集めよう', '楽しみだね！', 'ぼくも手伝うよ'],
    vote: ['ぼくは{o}かな', 'まだ決めてないんだ', '{o}に入れたよ'],
    rel: { best: ['もちろん！', 'こちらこそ'], friend: ['いいね、そうしよう', 'うん、また明日'], family: ['シチューがいいな', 'うん、すぐ帰るよ'], known: ['うん、あの家だよ', 'よろしくね'] },
    birthday: ['ありがとう！', 'うれしいな'],
    job: ['おつかれさま', '明日は手伝おうか？', '無理しないでね'],
  },
  rel: {
    best: ['今度いっしょに釣りしよう', 'いつもありがとう', 'また明日もよろしく'],
    friend: ['明日もいっしょに働こう', 'お昼いっしょに食べよう'],
    rival: ['次は負けないからな', '今日はそっちが多かったか', '明日は倍とってみせる'],
    crush: ['あ、あの…なんでもない', 'その服、似合ってるね'],
    family: ['晩ごはん何にする？', '早く帰ってきてね'],
    known: ['はじめましてだっけ？', 'このへんに住んでるの？'],
  },
  birthday: ['誕生日おめでとう！', 'お祝いのケーキ食べた？'],
};
const fill = (s, ctx) => s.replace(/\{(\w)\}/g, (_, k) => ctx[k] ?? '');

// 1 日の関係の更新と立ち話。ctx: { day, R, active, life, homesOf, weather, built, queueNext, vote, birthdays, hist }
const SPARSE_AT = 200, NEAR_K = 6;
function stepSocial(social, ctx) {
  const { day, R, active, life, weather } = ctx;
  social.pairs = social.pairs || {};
  social.talks = social.talks || [];
  const byKey = Object.fromEntries(active.map((v) => [v.key, v]));
  const changes = [];
  const pos = (k) => ctx.posOf(k);
  const crushers = new Set(Object.values(social.pairs).map((p) => p.crush).filter(Boolean)); // 片思いは 1 人 1 つまで
  // 人が多い町（SPARSE_AT 人より多い）では、全員の組を見ずに「近くの人・同じ家・前から関係のある人」の組だけを見る（人数の 2 乗にしない）
  const pairs = [];
  if (active.length <= SPARSE_AT) {
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) pairs.push([active[i], active[j]]);
  } else {
    const set = new Set();
    for (const k in social.pairs) { const [a, b] = k.split('|'); if (byKey[a] && byKey[b]) set.add(k); }
    const groups = {};
    const add = (g, v) => { (groups[g] = groups[g] || []).push(v); };
    // 近い人は、村人の位置の「マスごとの一覧」（空間ハッシュ）で、周りのマスだけを見て探す
    const grid = new TM.SpatialHash(8 * TM.TILE);
    for (const v of active) {
      const L = life[v.key];
      if (L.home) add('h:' + L.home, v);
      const q = pos(v.key);
      if (q) grid.set(v.key, q.x, q.z, { x: q.x, z: q.z, v });
    }
    for (const v of active) {
      const q = pos(v.key); if (!q) continue;
      for (const o of grid.nearest(q.x, q.z, NEAR_K + 1, (o) => o.v !== v, 14)) set.add(pairKey(v.key, o.v.key));
    }
    for (const g of Object.values(groups)) {
      // 1 人につき、組の中で名前順にとなりの NEAR_K 人まで
      g.sort((x, y) => (x.key < y.key ? -1 : 1));
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j <= Math.min(g.length - 1, i + NEAR_K); j++) set.add(pairKey(g[i].key, g[j].key));
    }
    for (const k of [...set].sort()) { const [a, b] = k.split('|'); pairs.push([byKey[a], byKey[b]]); }
  }
  for (const [a, b] of pairs) {
    const k = pairKey(a.key, b.key);
    const p = social.pairs[k] || (social.pairs[k] = { s: 0, w: 0, family: 0 });
    const before = kindOf(p);
    const La = life[a.key], Lb = life[b.key];
    const c = compat(a, b);
    let d = c * 1.4 - 0.2; // 気が合わないと少しずつ遠くなる
    // 一緒に働いた（同じ仕事で近い場所）
    const pa = pos(a.key), pb = pos(b.key);
    const near = pa && pb && Math.hypot(pa.x - pb.x, pa.z - pb.z) < 14;
    if (La.job && La.job === Lb.job && near) {
      p.w++;
      const ta = traits(a), tb = traits(b);
      d += 3.2 - (ta.solo ? 0.8 : 0) - (tb.solo ? 0.8 : 0);
      // 気が合わない同業者はライバルになる
      if (c < 0 && p.w >= 4 && !p.rival && R.chance(0.2)) p.rival = true;
      if (c > 0 && p.w >= 4) d += 1.5; // 気の合う仕事仲間
    }
    // 同じ家・近所
    if (La.home && La.home === Lb.home) { p.family++; d += 2; } else p.family = Math.max(0, p.family - 1);
    const ha = ctx.homePos(La.home), hb = ctx.homePos(Lb.home);
    if (ha && hb && Math.hypot(ha.x - hb.x, ha.z - hb.z) < 10) d += 0.8;
    d += R.range(-0.6, 0.6);
    p.s = Math.max(-30, Math.min(100, +(p.s * 0.985 + d).toFixed(2)));
    if (p.rival && c > 0.3 && p.s > 50) p.rival = false; // 仲直り
    // 片思い：仲がよくなってきた時に、ときどき片方だけが意識しはじめる
    if (!p.crush && p.s >= 18 && p.s < 40 && c > 0.2 && R.chance(0.025)) { const who = R.chance(0.5) ? a.key : b.key; if (!crushers.has(who)) { p.crush = who; crushers.add(who); } }
    if (p.crush && p.s >= 40) { crushers.delete(p.crush); delete p.crush; } // 両思い→親友
    const after = kindOf(p);
    if (after !== before && ['best', 'rival', 'family', 'crush'].includes(after)) changes.push({ a: a.key, b: b.key, kind: after, by: p.crush });
  }
  // 人が多い町では、まだ何もない組（ほぼ 0）は持たない（データを小さく）
  if (active.length > SPARSE_AT) for (const k in social.pairs) { const p = social.pairs[k]; if (Math.abs(p.s) < 1 && !p.w && !p.family && !p.rival && !p.crush) delete social.pairs[k]; }
  // 家族は家ごとに 1 行にまとめる
  const fam = {};
  for (const ch of changes.filter((c) => c.kind === 'family')) { const h = life[ch.a].home; (fam[h] = fam[h] || new Set()).add(ch.a).add(ch.b); }
  for (const h in fam) { const ks = [...fam[h]]; ctx.hist('social', `${ks.map((k) => byKey[k].display).join('・')}は同じ家で暮らす家族になった。`, { who: ks, kind: 'family' }); }
  for (const ch of changes.filter((c) => c.kind !== 'family')) {
    const A = byKey[ch.a].display, Bn = byKey[ch.b].display;
    const text = ch.kind === 'best' ? `${A}と${Bn}が親友になった。`
      : ch.kind === 'rival' ? `${A}と${Bn}がライバルになった。`
        : ch.kind === 'family' ? `${A}と${Bn}は同じ家で暮らす家族になった。`
          : `${byKey[ch.by].display}は${byKey[ch.by === ch.a ? ch.b : ch.a].display}のことが気になっているらしい。`;
    ctx.hist('social', text, { who: [ch.a, ch.b], kind: ch.kind });
  }

  // ---- 立ち話：1 人 1 回まで。しゃべる人ほど、仲がいいほど話しやすい ----
  const cands = [];
  for (const k in social.pairs) {
    const [a, b] = k.split('|');
    if (!byKey[a] || !byKey[b]) continue;
    const p = social.pairs[k];
    const kind = kindOf(p);
    const pa = pos(a), pb = pos(b);
    const dd = pa && pb ? Math.hypot(pa.x - pb.x, pa.z - pb.z) : 99;
    if (dd > 14 && kind !== 'family' && kind !== 'best') continue;
    const w = (traits(byKey[a]).talk + traits(byKey[b]).talk) * (1 + Math.max(0, p.s) / 40) * (kind === 'rival' ? 1.5 : 1) / (1 + dd / 8);
    cands.push({ a, b, k, w, kind });
  }
  cands.sort((x, y) => y.w - x.w || (x.k < y.k ? -1 : 1));
  const used = new Set(); const talks = [];
  const maxTalks = Math.min(6, Math.floor(active.length / 3) + 1);
  for (const c of cands) {
    if (talks.length >= maxTalks) break;
    if (used.has(c.a) || used.has(c.b) || !R.chance(Math.min(0.9, c.w / 2))) continue;
    used.add(c.a); used.add(c.b);
    // 話しかける人：よくしゃべる方
    const [s1, s2] = traits(byKey[c.a]).talk >= traits(byKey[c.b]).talk ? [c.a, c.b] : [c.b, c.a];
    talks.push(makeTalk(s1, s2, c.kind, ctx, R, social.pairs[c.k]));
    social.pairs[c.k].s = Math.min(100, social.pairs[c.k].s + 2.5); // 話すと少し仲よくなる
  }
  social.talks.push(...talks.map((t) => ({ day, ...t })));
  // ページ用にまとめておく（ページ側で同じ計算をしなくてすむように）
  const rel = relationsIndex(social);
  social.view = Object.fromEntries(active.map((v) => [v.key, (rel[v.key] || []).sort((x, y) => y.s - x.s).slice(0, 12)]));
  social.edges = [];
  for (const k in social.pairs) {
    const [a, b] = k.split('|');
    if (!byKey[a] || !byKey[b]) continue;
    const p = social.pairs[k], kind = kindOf(p);
    if (kind && kind !== 'known') social.edges.push({ a, b, kind, s: Math.round(p.s), ...(kind === 'crush' ? { by: p.crush } : {}) });
  }
  if (social.talks.length > 120) social.talks.splice(0, social.talks.length - 120);
  return { changes, talks };
}

function makeTalk(a, b, kind, ctx, R, p) {
  const { life, weather } = ctx;
  const jobOf = (k) => life[k].job || 'none';
  const cx = {
    n: String(Math.max(1, Math.round((life[a].todayGot || 2)))),
    b: ctx.built || '', q: ctx.queueNext || '', o: ctx.vote ? R.pick(ctx.vote.options).name : '',
  };
  const topics = ['weather', 'job'];
  if (ctx.built || ctx.queueNext) topics.push('build');
  if (ctx.vote) topics.push('vote', 'vote');
  if (kind && T.rel[kind]) topics.push('rel', 'rel');
  if (ctx.birthdays && (ctx.birthdays.includes(a) || ctx.birthdays.includes(b))) topics.push('birthday', 'birthday', 'birthday');
  const topic = R.pick(topics);
  let first;
  if (topic === 'weather') first = R.pick(T.weather[weather] || T.weather['晴れ']);
  else if (topic === 'job') first = R.pick(T.job[jobOf(a)] || T.job.none);
  else if (topic === 'build') first = ctx.built ? R.pick(T.build.slice(0, 2)) : R.pick(T.build.slice(2));
  else if (topic === 'vote') first = R.pick(T.vote);
  else if (topic === 'rel') first = R.pick(T.rel[kind]);
  else first = R.pick(T.birthday);
  const lines = [];
  if (R.chance(0.4)) lines.push([0, R.pick(T.open)]);
  lines.push([0, fill(first, cx)]);
  // 返事：ライバルは言い返す、片思いの相手には照れる
  if (topic === 'rel' && kind === 'rival') lines.push([1, R.pick(['こっちのセリフだ', '望むところだ', 'ふん、見てなよ'])]);
  else if (topic === 'rel' && kind === 'crush') lines.push([1, R.pick(['え、ありがとう', 'どうしたの？'])]);
  else if (topic === 'job' && jobOf(b) !== 'none' && jobOf(b) !== jobOf(a)) lines.push([1, fill(R.pick(T.job[jobOf(b)] || T.job.none), cx)]);
  else if (topic === 'job') lines.push([1, R.pick(T.re.job)]);
  else if (topic === 'weather') lines.push([1, R.pick(T.re.weather[weather] || T.re.weather['晴れ'])]);
  else if (topic === 'build') lines.push([1, R.pick(ctx.built ? T.re.build : T.re.buildNext)]);
  else if (topic === 'vote') lines.push([1, fill(R.pick(T.re.vote), { o: R.pick(ctx.vote.options).name })]);
  else if (topic === 'rel') lines.push([1, R.pick(T.re.rel[kind] || T.reply)]);
  else lines.push([1, R.pick(T.re.birthday)]);
  if (lines.length < 3 && R.chance(0.35)) lines.push([0, R.pick(T.reply)]);
  return { a, b, topic, kind: kind || null, lines: lines.map(([w, t]) => [w ? b : a, t]) };
}

// 全員の関係の一覧を 1 回でまとめる（人ごとに全部の組を見直さない）
function relationsIndex(social) {
  const out = {};
  for (const k in social.pairs || {}) {
    const [a, b] = k.split('|'), p = social.pairs[k];
    for (const [me, other] of [[a, b], [b, a]]) { const kind = viewOf(p, me); if (kind) (out[me] = out[me] || []).push({ other, kind, s: Math.round(p.s), w: p.w }); }
  }
  return out;
}
// 村人ページ用：その人の関係の一覧（仲のいい順）
function relationsOf(social, key) {
  const out = [];
  for (const k in social.pairs || {}) {
    const [a, b] = k.split('|');
    if (a !== key && b !== key) continue;
    const p = social.pairs[k];
    const kind = viewOf(p, key);
    if (!kind) continue;
    out.push({ other: a === key ? b : a, kind, s: Math.round(p.s), w: p.w });
  }
  return out.sort((x, y) => y.s - x.s);
}

module.exports = { MBTI, LETTER, traits, personality, compat, parseProfile, profilesFrom, KIND, pairKey, kindOf, viewOf, stepSocial, relationsOf, TEMPLATES: T };
