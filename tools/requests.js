#!/usr/bin/env node
'use strict';
// 建物のリクエスト（「図書館たててほしい」「温泉ほしい」「灯台つくって」など）を、コメントから数える。
// 投票（A/B/C）は変えない。次の A/B/C の候補を選ぶための、うらの集計。
//   data/requests.json       … { updated, buildings: { id: { name, count, firstDay, lastDay } }, other: [{ text, count }] }
//   data/requests_seen.json  … 1 人 1 回にするための印（塩入りの印をさらに印にした物。ユーザー名は入れない）
// 使い方: node tools/requests.js        … 多い順に出す
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./people');
const PF = require('../js/profile-fields.js');

// 建物の別の呼び方（config.json にある建物だけ使う。名前そのものは config の name でも見つかる）
const ALIASES = {
  onsen: ['温泉', 'おんせん', 'オンセン'],
  bathhouse: ['湯治場', '銭湯', 'せんとう'],
  library: ['図書館', 'としょかん', '図書室'],
  lighthouse: ['灯台', 'とうだい'],
  clocktower: ['時計台', 'とけいだい', '時計塔'],
  port: ['港', 'みなと', '船着き場'],
  inn: ['宿屋', 'やどや', '宿', 'ホテル', '旅館'],
  smithy: ['鍛冶屋', 'かじや', '鍛冶場'],
  bakery: ['パン屋', 'ぱんや', 'ベーカリー'],
  windmill: ['風車', 'ふうしゃ'],
  fountain: ['噴水', 'ふんすい', '大噴水'],
  cathedral: ['教会', 'きょうかい', '大聖堂'],
  school: ['学校', 'がっこう'],
  castle: ['お城', '城', 'おしろ'],
  market: ['市場', 'いちば', 'マーケット'],
  museum: ['美術館', '博物館'],
  station: ['駅', 'えき'],
  observatory: ['天文台'],
  theater: ['劇場', 'げきじょう'],
  ranch: ['牧場', 'ぼくじょう'],
  shop: ['お店', 'おみせ'],
  well: ['井戸', 'いど'],
  garden: ['花畑', 'はなばたけ'],
};
// 「ほしい」の言い方（これがある時だけリクエストとして読む。ただの感想は数えない）
const WANT = /(ほしい|欲しい|ホシイ|たてて|建てて|立てて|つくって|作って|造って|できたら|出来たら|あったら|あるといい|あればいい|がいい|希望|おねがい|お願い|ください|下さい|よろしく|リクエスト)/;
const norm = (s) => String(s || '').normalize('NFKC').trim();

// 文から建物の id を探す（長い呼び方から先に。「大噴水」を「噴水」より先に）
function words(config) {
  const out = [];
  for (const [id, b] of Object.entries(config.buildings || {})) {
    for (const w of new Set([b.name, ...(ALIASES[id] || [])].filter(Boolean))) out.push({ id, w: norm(w) });
  }
  return out.sort((a, b) => b.w.length - a.w.length);
}

// 1 つのコメントを読む → { ids: [建物 id...], other: 'その他の短い文' | null }。リクエストでなければ null
function parseRequest(text, config, W = words(config)) {
  let t = norm(text);
  if (!t || !WANT.test(t)) return null;
  const ids = new Set();
  let rest = t;
  for (const { id, w } of W) if (rest.includes(w)) { ids.add(id); rest = rest.split(w).join(' '); }
  if (ids.size) return { ids: [...ids], other: null };
  // その他：「〜ほしい」の前の言葉。リンク・@・よくない言葉は捨てる。20 文字まで
  const m = t.split(WANT)[0].replace(/[をがのもはにで、。!！?？・\s]+$/u, '');
  const o = PF.cleanText(m, 20);
  if (!o || Array.from(o).length < 2 || /https?:|www\.|@/i.test(o) || PF.badWord(o) || PF.badWord(t)) return { ids: [], other: null };
  return { ids: [], other: o };
}

// コメントの人の印（塩入り）→ さらに印にして保存用に（塩を知らなければ、だれのものか分からない）
function personMark(c) {
  const id = c.from && c.from.id, u = (c.from && c.from.username) || c.username;
  const base = id ? 'ig:' + P.igHash(id) : u ? 'u:' + P.userHash(u) : null;
  return base ? crypto.createHash('sha256').update('req:' + base).digest('hex').slice(0, 12) : null;
}

// コメントを足して数え直す（1 人 1 建物 1 回。その他は 1 人 1 文 1 回）。req・seen を書きかえて返す
function tally(comments, config, day, req = {}, seen = {}) {
  req.buildings = req.buildings || {}; req.other = req.other || []; seen.b = seen.b || {}; seen.o = seen.o || {};
  const W = words(config);
  for (const c of comments || []) {
    if (!c || P.parseChoice(c.text || '')) continue; // A/B/C だけの票は数えない
    const r = parseRequest(c.text, config, W);
    if (!r) continue;
    const who = personMark(c);
    if (!who) continue;
    for (const id of r.ids) {
      const s = (seen.b[id] = seen.b[id] || []);
      if (s.includes(who)) continue;
      s.push(who);
      const e = (req.buildings[id] = req.buildings[id] || { name: config.buildings[id].name, count: 0, firstDay: day, lastDay: day });
      e.count++; e.lastDay = day;
    }
    if (r.other) {
      const k = r.other.toLowerCase(), s = (seen.o[k] = seen.o[k] || []);
      if (s.includes(who)) continue;
      s.push(who);
      const e = req.other.find((x) => x.text.toLowerCase() === k);
      if (e) e.count++; else req.other.push({ text: r.other, count: 1 });
    }
  }
  req.other.sort((a, b) => b.count - a.count);
  req.updated = new Date().toISOString();
  return { req, seen };
}

// data/ のファイルを読んで足して書く（sim.js から 1 日 1 回）
function updateFiles(dataDir, comments, config, day) {
  const rf = path.join(dataDir, 'requests.json'), sf = path.join(dataDir, 'requests_seen.json');
  const read = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
  const { req, seen } = tally(comments, config, day, read(rf, {}), read(sf, {}));
  fs.writeFileSync(rf, JSON.stringify(req, null, 1) + '\n');
  fs.writeFileSync(sf, JSON.stringify(seen) + '\n');
  return req;
}

function ranking(req) {
  const b = Object.entries(req.buildings || {}).sort((x, y) => y[1].count - x[1].count);
  const lines = ['建物のリクエスト（多い順）'];
  if (!b.length) lines.push('  まだありません');
  b.forEach(([id, e], i) => lines.push(`  ${i + 1}. ${e.name}（${id}） ${e.count} 人  ${e.firstDay}〜${e.lastDay}日目`));
  lines.push('その他');
  if (!(req.other || []).length) lines.push('  まだありません');
  for (const o of (req.other || []).slice(0, 20)) lines.push(`  ${o.text}  ${o.count} 人`);
  return lines.join('\n');
}

module.exports = { ALIASES, parseRequest, personMark, tally, updateFiles, ranking };

if (require.main === module) {
  const DATA = process.env.TOWN_DATA || path.join(__dirname, '..', 'data');
  const f = path.join(DATA, 'requests.json');
  console.log(ranking(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}));
}
