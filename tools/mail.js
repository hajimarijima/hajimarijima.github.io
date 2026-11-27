'use strict';
// 手紙（毎日の更新の中。tools/sim.js から呼ぶ）。決まりは js/letters.js（サイトと共通）。
//   ・web で書いた手紙：受け口の Worker（/mail/send）に積まれ、tools/play.js pull が data/inbox/play.json の mail に入れる
//   ・コメント「手紙 @相手 本文」：毎日のインスタのコメント（inbox の joinComments・voteComments）から読む。1 日の数はここで数える
//   ・村人どうし：仲の良さ（social.pairs）に合わせて時々書き合う（型の組み合わせ）。人からもらった手紙には、お礼の手紙を返す（飾りを添えることがある）
//   data/mail.json：{ day, letters: [{ id, day, from, to, text, kind: 'web'|'comment'|'villager'|'thanks', gift?, decor? }], seen: [...] }
//   手紙のきまり（terms.html・js/terms.js）：同意していない人のコメントは届けない（needTerms に入れて mail.html で案内）。通報が reportHide 件で隠す。運営の道具はこのファイルの下
//   届いた手紙は、相手の村人ページの「手紙」と、自分の村人の郵便受け（mail.html）で読める。新しい手紙（今日の分）があると、家の郵便受けに旗が立つ
const LT = require('../js/letters.js');
const TM = require('../js/terms.js'); // 手紙のきまりの版・通報で隠す数
const DC = require('../js/decor.js');
const DEC = require('./decor');
const I = require('./inventory');
const P = require('./people');
const SO = require('./social');
const { hashStr } = require('./rand');

const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const norm = (s) => String(s || '').normalize('NFKC').trim().toLowerCase();
// @名前 → 村人（インスタの名前か、出している名前。かくしている人はあだ名だけ）
function findTo(villagers, name) {
  const n = norm(name).replace(/^@/, '');
  if (!n) return null;
  return villagers.find((v) => !v.gone && v.name && norm(v.name) === n) || villagers.find((v) => !v.gone && norm(v.display) === n) || null;
}
// 持ち物から 1 つ渡す（道具はだめ）。渡せたら true
function moveItem(S, from, to, item) {
  const A = S.life[from], B = S.life[to], IC = S.config.inventory || {};
  if (!LT.giftOk(item) || !A || !B || !Array.isArray(A.inv) || !Array.isArray(B.inv)) return false;
  const i = A.inv.findIndex((s) => s && s.item === item && !I.isTool(s) && (s.n || 0) > 0);
  if (i < 0 || !I.canFit(B.inv, B.slots, item, IC.stack || 64)) return false;
  A.inv[i].n--; if (!A.inv[i].n) A.inv[i] = null;
  I.addItem(B.inv, B.slots, item, 1, IC.stack || 64);
  return true;
}
const diaryAdd = (S, k, day, text) => { const L = S.life[k], d = L && L.diary && L.diary[L.diary.length - 1]; if (d && d.day === day) d.text += text; };

// 毎日の分。play：data/inbox/play.json（なければ null）。since：コメントを読む時刻（これより前のコメントは前の日に読んだ）
function stepMail(S, { day, play = null, since = 0, R = Math.random, built = '' }) {
  const M = LT.mailCfg(S.config);
  S.mail = S.mail && Array.isArray(S.mail.letters) ? S.mail : { letters: [], seen: [] };
  S.mail.seen = S.mail.seen || [];
  S.decor = S.decor || {};
  // 手紙のきまりへの同意（受け口から。村人ごとの版と日時）・通報の数・運営が止めた人
  S.mail.terms = { ...(S.mail.terms || {}), ...((play && play.terms) || {}) };
  if (play && play.reports) S.mail.reports = { ...(S.mail.reports || {}), ...play.reports };
  S.mail.banned = Array.isArray(S.mail.banned) ? S.mail.banned : [];
  const banned = new Set(S.mail.banned), needTerms = new Set();
  const seen = new Set(S.mail.seen), active = S.villagers.filter((v) => v.joinedDay <= day && !v.gone), byKey = Object.fromEntries(active.map((v) => [v.key, v]));
  const sentToday = {}, letters = [];
  const send = (L) => {
    if (!byKey[L.from] || !byKey[L.to] || L.from === L.to || banned.has(L.from)) return false;
    const c = LT.checkLetter(L.text, S.config);
    if (!c.ok) return false;
    const out = { id: L.id, day, from: L.from, to: L.to, text: c.text, kind: L.kind };
    if (L.gift && (L.kind === 'web' || L.kind === 'comment')) {
      if (DC.isDecor(L.gift) ? DEC.give(S, L.from, L.to, L.gift, day) : moveItem(S, L.from, L.to, L.gift)) out.gift = L.gift;
    }
    if (L.decor) out.decor = L.decor;
    letters.push(out); seen.add(L.id);
    return true;
  };
  // 1) web（受け口が 1 日の数を数えた分。何日分か来るので、id で 1 回だけ）
  for (const m of Object.values((play && play.mail) || {})) {
    for (const [k, list] of Object.entries(m || {})) {
      for (const L of list || []) {
        const id = 'w' + String(L.id || '').slice(0, 24);
        if (!L.id || seen.has(id) || !KEY.test(String(L.to || ''))) continue;
        if (send({ id, from: k, to: L.to, text: L.text, gift: L.gift || null, kind: 'web' })) sentToday[k] = (sentToday[k] || 0) + 1;
      }
    }
  }
  // 2) コメント「手紙 @相手 本文」（1 日 perDay 通まで。web の分と合わせて数える）
  const comments = [...((S.inbox && S.inbox.joinComments) || []), ...((S.inbox && S.inbox.voteComments) || []), ...((S.inbox && S.inbox.mailComments) || [])];
  for (const c of comments.slice().sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0))) {
    const p = LT.parseLetterComment(c.text);
    if (!p || (since && Date.parse(c.timestamp || 0) < since)) continue;
    const id = 'c' + (hashStr('mail:' + (c.id || c.timestamp + c.text)) >>> 0).toString(36);
    if (seen.has(id)) continue;
    seen.add(id);
    const from = P.findVillager(S.villagers, P.commentUser(c)), to = findTo(active, p.to);
    if (!from || !to || !byKey[from.key] || (sentToday[from.key] || 0) >= M.perDay) continue;
    if (!TM.agreedOk(S.mail.terms[from.key])) { needTerms.add(from.key); continue; } // きまりに同意していない人のコメントは届けない（mail.html で同意するよう案内する）
    if (send({ id, from: from.key, to: to.key, text: p.body, kind: 'comment' })) sentToday[from.key] = (sentToday[from.key] || 0) + 1;
  }
  // 3) お礼の手紙（人から手紙をもらった村人が返す。飾りを添えることがある。1 人に 1 日 1 通）
  const thanked = new Set();
  for (const L of letters.slice()) {
    const pair = L.to + '>' + L.from;
    if (thanked.has(pair) || !(L.gift || R() < M.thanksP)) continue;
    thanked.add(pair);
    const decor = L.gift || R() < 0.5 ? DEC.earn(S, L.from, 'thanks', day, `${day}:thanks:${L.to}`, { diary: false }) : null;
    const text = LT.thanksLetter({ gift: L.gift ? ((S.config.items[L.gift] || DC.DECOR[L.gift] || {}).name || '') : '', decor: decor ? DC.DECOR[decor].name : '' }, R);
    letters.push({ id: `t${day}-${letters.length}`, day, from: L.to, to: L.from, text, kind: 'thanks', ...(decor ? { decor } : {}) });
  }
  // 4) 村人どうし（仲の良さに合わせて。1 日 villagerPerDay 通まで）
  const pairs = Object.entries((S.social && S.social.pairs) || {}).map(([k, p]) => { const [a, b] = k.split('|'); return { a, b, p, kind: SO.kindOf(p) }; })
    .filter((x) => x.kind && byKey[x.a] && byKey[x.b]).sort((x, y) => y.p.s - x.p.s);
  let vn = 0;
  for (const x of pairs) {
    if (vn >= M.villagerPerDay) break;
    if (R() >= M.villagerP * Math.max(0.3, Math.min(2, (x.p.s || 0) / 40))) continue;
    const [from, to] = R() < 0.5 ? [x.a, x.b] : [x.b, x.a];
    const text = LT.villagerLetter(x.kind, { from: byKey[from].display, to: byKey[to].display, job: (S.life[from] || {}).job, weather: S.state && S.state.weather, built }, R);
    letters.push({ id: `v${day}-${letters.length}`, day, from, to, text, kind: 'villager' });
    vn++;
  }
  // 日記と、ためる数（受け取った人ごとに keep 通まで）
  for (const L of letters) diaryAdd(S, L.to, day, `${byKey[L.from].display}から手紙が届いた。`);
  const all = [...S.mail.letters.filter((L) => S.life[L.to] && S.life[L.from]), ...letters], per = {}, keepIx = new Set();
  for (let i = all.length - 1; i >= 0; i--) { const t = all[i].to; per[t] = (per[t] || 0) + 1; if (per[t] <= M.keep) keepIx.add(i); }
  S.mail.letters = all.filter((_, i) => keepIx.has(i));
  applyReports(S);
  // コメントで送ろうとしたが、まだ同意していない人（mail.html・自分の村人の郵便受けで案内する）
  S.mail.needTerms = { ...Object.fromEntries(Object.entries(S.mail.needTerms || {}).filter(([k]) => !TM.agreedOk(S.mail.terms[k]))), ...Object.fromEntries([...needTerms].map((k) => [k, day])) };
  S.mail.seen = [...seen].slice(-800);
  S.mail.day = day;
  return { letters };
}

// 通報が reportHide 件たまった手紙は隠す（サイトに出さない。運営が remove で消すか、unhide でもどす）
function applyReports(S) {
  const n = Number((S.config.mail || {}).reportHide) || TM.REPORT_HIDE, R = S.mail.reports || {}, keep = new Set(S.mail.unhidden || []);
  for (const L of S.mail.letters) if ((R[L.id] || 0) >= n && !keep.has(L.id)) L.hidden = true;
}

// ---------- 運営の道具：node tools/mail.js <命令>（data/mail.json を書きかえる。TOWN_DATA で場所を変えられる） ----------
//   reported         通報のある手紙を、多い順に出す
//   remove <手紙id>   手紙を消す
//   unhide <手紙id>   隠した手紙をもどす（通報がまちがいだった時）
//   ban <村人>        その人の手紙を届けない（web もコメントも。受け口は送れても、毎日の更新で捨てる）
//   unban <村人>      もどす
function admin(argv, dataDir) {
  const fs = require('fs'), path = require('path');
  const f = path.join(dataDir, 'mail.json');
  const M = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { letters: [], seen: [] };
  M.banned = M.banned || []; M.unhidden = M.unhidden || [];
  const [cmd, arg] = argv, save = () => fs.writeFileSync(f, JSON.stringify(M, null, 1));
  if (cmd === 'reported') {
    const R = M.reports || {};
    return M.letters.filter((L) => R[L.id]).sort((a, b) => R[b.id] - R[a.id]).map((L) => `${L.id}\t通報 ${R[L.id]}${L.hidden ? '（隠した）' : ''}\t${L.from} → ${L.to}\t${L.text.replace(/\n/g, ' ')}`).join('\n') || '通報のある手紙はありません';
  }
  if (!arg || !KEY.test(arg)) return 'つかい方：node tools/mail.js reported | remove <手紙id> | unhide <手紙id> | ban <村人> | unban <村人>';
  if (cmd === 'remove') { const n = M.letters.length; M.letters = M.letters.filter((L) => L.id !== arg); save(); return n > M.letters.length ? `消しました：${arg}` : `見つかりません：${arg}`; }
  if (cmd === 'unhide') { const L = M.letters.find((x) => x.id === arg); if (!L) return `見つかりません：${arg}`; delete L.hidden; if (!M.unhidden.includes(arg)) M.unhidden.push(arg); save(); return `もどしました：${arg}`; }
  if (cmd === 'ban') { if (!M.banned.includes(arg)) M.banned.push(arg); save(); return `${arg} の手紙を届けないようにしました`; }
  if (cmd === 'unban') { M.banned = M.banned.filter((k) => k !== arg); save(); return `${arg} の手紙をまた届けます`; }
  return '知らない命令です';
}
if (require.main === module) console.log(admin(process.argv.slice(2), process.env.TOWN_DATA || require('path').join(__dirname, '..', 'data')));

module.exports = { stepMail, findTo, moveItem, applyReports, admin };
