#!/usr/bin/env node
'use strict';
// 参加の登録（「参加したい」コメント）・投票の集計・フォロワー取り込み・名前かくしを、見本の JSON で確かめる。
// 使い方: node tests/run_tests.js   （本物の data/ はさわらない。一時フォルダで動かす）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('assert');
process.env.TOWN_SALT_QUIET = '1'; // テストは開発用の塩で動かす（警告は出さない。子の sim.js にも引きつがれる）
const P = require('../tools/people');
const STORE = require('../tools/store'); // world.json（地図の文字）と日記（人ごとのファイル）を読む

const ROOT = path.join(__dirname, '..');
// 本番の config.json を読む。拠点の投票（needPost）は、投票の投稿の URL を貼った後として試す
function liveCfg() {
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  if (!c.votePostUrl) c.votePostUrl = 'https://www.instagram.com/p/TEST/';
  return c;
}
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample_comments.json'), 'utf8'));
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('OK  ' + name); };

// ---------- 関数ごと ----------
t('A/B/C の読み取り', () => {
  const cases = { 'A': 'A', 'c': 'C', 'Ｂがいい': 'B', 'b案': 'B', 'I like A': 'A', 'Aで！': 'A', 'ａ': 'A', 'BとCで迷う': null, 'ABC': null, 'かわいい': null, 'CAFE': null, '断然C': 'C' };
  for (const [k, v] of Object.entries(cases)) assert.strictEqual(P.parseChoice(k), v, k);
});
t('投票：1 人 1 票・最後のコメント・締め切り後は数えない', () => {
  const r = P.tallyVote(sample.voteComments, sample.vote);
  assert.deepStrictEqual(r.votes, sample.expect.votes);
  assert.strictEqual(r.voters, sample.expect.voters);
  assert.ok(r.timeline.length > 3, '時間ごとの伸びがある');
  const last = r.timeline[r.timeline.length - 1];
  assert.deepStrictEqual({ A: last.A, B: last.B, C: last.C }, sample.expect.votes);
});
t('「参加したい」の読み取り（前の「住民登録」も読む・「参加しない」は読まない）', () => {
  for (const s of ['参加したい', '参加します！', '参加', 'わたしも参加したいです', '住民登録', '参加したい！！']) assert.ok(P.isJoin(s), s);
  for (const s of ['参加しない', '今回は参加できないです', '不参加で', 'かわいい町', '参加しません']) assert.ok(!P.isJoin(s), s);
  // はじまり島の参加のことば「住みたい」「すみたい」（「参加したい」も今までどおり）
  for (const s of ['住みたい', 'すみたい！', 'わたしも住みたいです', '住みたい ピッケル', '参加したい 斧']) assert.ok(P.isJoin(s, '住みたい'), s);
  for (const s of ['住みたくない', 'すみたくないかも', 'ここには住めない']) assert.ok(!P.isJoin(s, '住みたい'), s);
});
t('参加の登録：重複は from.id で 1 回・名前が変わったら新しい名前', () => {
  const regs = P.registrationsFrom(sample.joinComments);
  assert.strictEqual(regs.length, 3);
  const vs = [];
  for (const r of regs) P.upsertVillager(vs, { ...r, joined: '2026-11-02', joinedDay: 2 }, new Set());
  assert.strictEqual(vs.length, 3);
  assert.ok(vs.some((v) => v.name === 'taro_pan_new'));
  // 同じ人がもう一度来ても増えない。名前が変わっても同じ人
  P.upsertVillager(vs, { igId: '1001', username: 'hanako_renamed', joined: 'x', joinedDay: 9 }, new Set());
  assert.strictEqual(vs.length, 3);
  const h = vs.find((v) => v.igId === P.igHash('1001'));
  assert.strictEqual(h.name, 'hanako_renamed');
  assert.strictEqual(h.joinedDay, 2, '参加日は最初のまま');
});
t('フォロワー一覧の取り込み：重複しない', () => {
  const list = P.readFollowerExport(JSON.parse(fs.readFileSync(path.join(__dirname, 'sample_followers_1.json'), 'utf8')));
  assert.strictEqual(list.length, 4);
  const vs = [];
  P.upsertVillager(vs, { username: 'sora_no_iro', joinedDay: 1 }, new Set());
  let added = 0;
  for (const u of list) if (P.upsertVillager(vs, { username: u.username, joinedDay: 3 }, new Set())) added++;
  assert.strictEqual(added, 2);
  assert.strictEqual(vs.length, 3);
  // あとからコメントで来ても同じ人として扱う（名前で合わせて ID を付ける）
  assert.strictEqual(P.upsertVillager(vs, { igId: '777', username: 'sample_owl' }, new Set()), null);
  assert.strictEqual(vs.find((v) => v.name === 'sample_owl').igId, P.igHash('777'));
});
t('名前かくし：hidden.json の人はあだ名・名前は JSON に残らない', () => {
  const hidden = new Set([P.userHash('secret_cat')]);
  const vs = [];
  const v = P.upsertVillager(vs, { igId: '1004', username: 'secret_cat', joinedDay: 1 }, hidden);
  assert.strictEqual(v.hidden, true);
  assert.ok(!('name' in v));
  assert.ok(!JSON.stringify(vs).includes('secret_cat'));
  assert.strictEqual(v.display, P.nickname(v.key));
});

t('名前かくし：公開ファイルのどこからも、かくした人のユーザー名・インスタ ID がたどれない（塩入りの印）', () => {
  const crypto = require('crypto');
  const hc = sample.joinComments.find((c) => (c.from && c.from.username || c.username) === 'secret_cat');
  assert.ok(hc, '見本に secret_cat の参加コメントがある');
  const uname = 'secret_cat', igid = hc.from && hc.from.id ? String(hc.from.id) : null;
  const SALT = 'test-salt-' + Date.now();
  const hm = (s) => crypto.createHmac('sha256', SALT).update(s).digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-priv-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  // hidden.json には名前ではなく塩入りの印だけ（tools/hide.js と同じ形）
  fs.writeFileSync(path.join(dir, 'hidden.json'), JSON.stringify(['hmac:' + hm('user:' + uname).slice(0, 16)]));
  const env = { ...process.env, TOWN_DATA: dir, TOWN_SALT: SALT, TOWN_SALT_QUIET: '1' };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'test', '--start', '2026-11-01');
  const inboxDir = path.join(dir, 'inbox'); fs.mkdirSync(inboxDir);
  const inbox = path.join(inboxDir, 'instagram.json'); // 生のコメントは inbox/ にだけ置く（.gitignore で公開しない）
  fs.writeFileSync(inbox, JSON.stringify({ followers: sample.followers, joinComments: sample.joinComments, voteComments: null }));
  node('tools/sim.js', '--inbox', inbox);
  node('tools/sim.js', '--days', '2');
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  const hv = vs.find((v) => v.hidden);
  assert.ok(hv, 'かくした人も村人になっている');
  // 公開されるファイル（inbox/ 以外ぜんぶ）を集める
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'inbox') walk(p); } else files.push(p); } };
  walk(dir);
  const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n').toLowerCase();
  // だれでも計算できる形（塩なし・開発用の塩）の印。どれも公開ファイルに入っていてはいけない
  const plain = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const dev = (s) => crypto.createHmac('sha256', 'town-dev-salt-NOT-SECRET').update(s).digest('hex');
  const bad = [uname];
  if (igid) bad.push(igid);
  for (const h of [plain, dev]) {
    bad.push(h('user:' + uname).slice(0, 16), h('key:user:' + uname).slice(0, 10));
    if (igid) bad.push(h('ig:' + igid).slice(0, 16), h('key:ig:' + igid).slice(0, 10));
  }
  // 数字だけの ID（見本は 4 けた）は、ハッシュの 16 進の中にたまたま並ぶことがあるので、前後が英数字でない所だけ見る
  for (const b of bad) {
    const hit = /^\d+$/.test(b) ? new RegExp(`(^|[^0-9a-z])${b}($|[^0-9a-z])`).test(text) : text.includes(b.toLowerCase());
    assert.ok(!hit, '公開ファイルに入っている：' + b);
  }
  // 印は塩入りの HMAC になっている（塩を知らなければ名前から作れない）
  assert.strictEqual(hv.userHash, hm('user:' + uname).slice(0, 16));
  if (igid) assert.strictEqual(hv.key, hm('key:ig:' + igid).slice(0, 10));
  assert.ok(!('name' in hv) && hv.display === P.nickname(hv.key));
});

// ---------- 町を動かして確かめる ----------
t('sim.js にコメントを入れると村人が増え、投票が数えられて決まる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-test-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  fs.writeFileSync(path.join(dir, 'hidden.json'), JSON.stringify(['secret_cat']));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'test', '--start', '2026-11-01');
  // 1 日目：参加の登録とフォロワー 12 人 → 投票が開く
  const inbox = path.join(dir, 'inbox.json');
  fs.writeFileSync(inbox, JSON.stringify({ followers: sample.followers, joinComments: sample.joinComments, voteComments: null }));
  node('tools/sim.js', '--inbox', inbox);
  let vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.strictEqual(vs.length, sample.expect.newVillagers);
  assert.ok(!fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8').includes('secret_cat'), 'かくす人の名前は出ない');
  let st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  // 1 日目：村人が来たら「何を建てる？」と「どこに建てる？」が A/B/C で開く。最初の候補は 小屋・倉庫・作業台
  assert.strictEqual(st.votes.length, 2, '投票が 2 つ開く');
  const [vw, vp] = st.votes;
  assert.strictEqual(vw.kind, 'what'); assert.strictEqual(vp.kind, 'where');
  assert.deepStrictEqual(vw.options.map((o) => o.key + o.build), ['Ahut', 'Bstorehouse', 'Cworkbench']);
  assert.ok(vp.options.every((o) => typeof o.x === 'number' && typeof o.z === 'number' && o.name), '場所の候補には地図の位置がある');
  assert.ok(Date.parse(vw.closesAt) <= Date.parse(vp.opensAt), '「何を」が締まってから「どこに」が開く');
  // 投票の時刻を見本に合わせて、コメントを入れて 1 日進める → 締め切って決まる
  for (const v of st.votes) { v.opensAt = sample.vote.opensAt; v.closesAt = sample.vote.closesAt; }
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));
  fs.writeFileSync(inbox, JSON.stringify({ followers: sample.followers, joinComments: sample.joinComments, voteComments: sample.voteComments }));
  node('tools/sim.js', '--inbox', inbox);
  st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(st.decisions.length, 2);
  const d = st.decisions[0];
  assert.strictEqual(d.kind, 'what');
  assert.deepStrictEqual(d.votes, sample.expect.votes);
  assert.ok(d.key === 'A' || d.key === 'B', '同点の A と B のどちらか（くじ引き）');
  assert.strictEqual(d.tie, true);
  assert.strictEqual(st.plan.build, d.build, '決まった物を建てる');
  assert.ok(st.plan.site && st.decisions[1].kind === 'where', '場所も決まる');
  assert.ok(!st.votes.some((v) => v.kind === 'what'), '建つまでは次の「何を」は開かない');
  node('tools/sim.js', '--inbox', inbox, '--days', '2');
  const hist = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  assert.ok(hist.some((h) => h.type === 'vote_result'));
  vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.strictEqual(vs.length, 3, '何日コメントを読んでも重複しない');
  // フォロワー一覧の取り込み
  fs.mkdirSync(path.join(dir, 'import'));
  fs.copyFileSync(path.join(__dirname, 'sample_followers_1.json'), path.join(dir, 'import', 'followers_1.json'));
  node('tools/import_followers.js');
  node('tools/import_followers.js');
  vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.strictEqual(vs.length, 6, '3 人 + フォロワー 3 人（2 回取り込んでも同じ）');
  fs.rmSync(dir, { recursive: true, force: true });
});

t('同じ種なら同じ町になる', () => {
  const runs = [0, 1].map(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-det-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '10'], { env });
    const w = JSON.stringify(STORE.readWorld(dir)) + JSON.stringify(STORE.readLife(dir)); // 日記（人ごとのファイル）もふくめて
    fs.rmSync(dir, { recursive: true, force: true });
    return w;
  });
  assert.strictEqual(runs[0], runs[1]);
});

// ---------- 持ち物欄 ----------
const I = require('../tools/inventory');
const IC = liveCfg().inventory;
t('枠の数：最初 3・レベルと在籍日数で増える・上限 27', () => {
  assert.strictEqual(I.slotCount(1, 1, IC), 3);
  assert.strictEqual(I.slotCount(3, 1, IC), 4);
  assert.strictEqual(I.slotCount(6, 7, IC), 6);
  assert.strictEqual(I.slotCount(10, 14, IC), 8);
  assert.strictEqual(I.slotCount(20, 30, IC), 11);
  assert.strictEqual(I.slotCount(90, 100, IC), 27, '節目をぜんぶ通ると 27');
  assert.strictEqual(I.slotCount(99, 999, IC), 27);
  const locks = I.lockList(5, I.xpForLevel(5, IC), 10, 20, IC);
  assert.ok(locks.some((l) => l.label === 'Lv6 で解放') && locks.some((l) => l.label === '在籍 14 日で解放'));
  assert.strictEqual(locks.length, 27 - I.slotCount(5, 10, IC));
});
t('レベル：経験値で上がる', () => {
  assert.strictEqual(I.levelFor(0, IC), 1);
  assert.strictEqual(I.levelFor(I.xpForLevel(6, IC), IC), 6);
  assert.strictEqual(I.levelFor(I.xpForLevel(6, IC) - 1, IC), 5);
});
t('1 枠 64 個まで・道具は 1 枠で耐久が減る', () => {
  const inv = [];
  assert.strictEqual(I.addTool(inv, 5, 'axe', 3), true);
  assert.strictEqual(I.addItem(inv, 5, 'log', 100, 64), 0);
  assert.deepStrictEqual(inv.slice(0, 3).map((s) => s && (s.n || s.dur)), [3, 64, 36]);
  assert.strictEqual(I.addItem(inv, 5, 'log', 200, 64), 200 - (28 + 64 + 64)); // 残り 2 枠 + 端数
  assert.strictEqual(I.useTool(inv, 'axe'), false);
  I.useTool(inv, 'axe');
  assert.strictEqual(I.useTool(inv, 'axe'), true, '3 回でこわれる');
  assert.ok(!I.hasTool(inv, 'axe'));
  const out = I.unload(inv);
  assert.strictEqual(out.log, 256);
});
t('枠が多い人ほど往復が減って、たくさん集められる', () => {
  const run = (slots) => { // 3 枠と 27 枠でくらべる
    const { makeRng } = require('../tools/rand');
    const R = makeRng('inv-test');
    const inv = []; I.addTool(inv, slots, 'axe', 9999);
    let total = 0, trips = 0;
    for (let d = 0; d < 30; d++) {
      const r = I.workDay({ inv, slots, budget: IC.actionsPerDay, cfg: IC, onUnload: (items) => { total += items.log || 0; }, produce: () => [['log', R.int(2, 4)], ['apple', R.chance(0.12) ? 1 : 0], ['sapling', R.chance(0.1) ? 1 : 0]] });
      trips += r.trips;
    }
    total += I.unload(inv).log || 0;
    return { total, trips };
  };
  const a = run(3), b = run(27);
  assert.ok(a.trips > b.trips, `往復 3枠=${a.trips} 27枠=${b.trips}`);
  assert.ok(b.total > a.total, `原木 3枠=${a.total} 27枠=${b.total}`);
});
t('sim.js：持ち物・レベル・枠が決まった結果になる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-inv-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
  execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '15'], { env });
  const life = STORE.readLife(dir);
  for (const L of Object.values(life)) {
    assert.ok(L.slots >= 3 && L.slots <= 27);
    assert.strictEqual(L.inv.length, L.slots);
    for (const s of L.inv) if (s && s.n !== undefined) assert.ok(s.n <= 64);
    assert.ok(L.level >= 1 && typeof L.next === 'string');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 関係・プロフィール ----------
const SO = require('../tools/social');
t('プロフィールのコメントの読み取り', () => {
  const ok1 = { 'プロフ INFP 0512': ['INFP', '05-12'], 'ﾌﾟﾛﾌ infp 5/12': ['INFP', '05-12'], 'プロフ　ENTJ 12-03 です': ['ENTJ', '12-03'], 'プロフ ISFJ 2月29日': ['ISFJ', '02-29'] };
  for (const [k, [m, b]] of Object.entries(ok1)) { const p = SO.parseProfile(k); assert.ok(p, k); assert.strictEqual(p.mbti, m, k); assert.strictEqual(p.birthday, b, k); }
  for (const bad of ['プロフ XXXX 0512', 'プロフ INFP 1332', 'INFP 0512', 'プロフ INFP 02-30', 'プロフ INFP 19990512']) assert.strictEqual(SO.parseProfile(bad), null, bad);
});
t('プロフィールは from.id で 1 人 1 つ（あとのコメントが勝つ・id なしは使わない）', () => {
  const cs = [
    { text: 'プロフ INFP 0512', timestamp: '2026-11-02T01:00:00Z', from: { id: '1', username: 'a' } },
    { text: 'プロフ ENFP 0513', timestamp: '2026-11-03T01:00:00Z', from: { id: '1', username: 'a' } },
    { text: 'プロフ ISTJ 0101', timestamp: '2026-11-03T02:00:00Z', from: { username: 'nobody' } },
  ];
  const r = SO.profilesFrom(cs);
  assert.deepStrictEqual(r, [{ igId: '1', mbti: 'ENFP', birthday: '05-13' }]);
});
t('相性と関係の種類', () => {
  assert.ok(SO.compat({ key: 'a', mbti: 'INFP' }, { key: 'b', mbti: 'ENFP' }) > SO.compat({ key: 'a', mbti: 'INFP' }, { key: 'b', mbti: 'ESTJ' }));
  assert.strictEqual(SO.kindOf({ s: 50, w: 0, family: 0 }), 'best');
  assert.strictEqual(SO.kindOf({ s: 50, w: 0, family: 6 }), 'family');
  assert.strictEqual(SO.kindOf({ s: 5, w: 6, family: 0, rival: true }), 'rival');
  assert.strictEqual(SO.viewOf({ s: 25, family: 0, crush: 'a' }, 'a'), 'crush');
  assert.strictEqual(SO.viewOf({ s: 25, family: 0, crush: 'a' }, 'b'), 'friend');
});
t('sim の関係・会話・誕生日（同じ種なら同じ結果、年は持たない）', () => {
  const runOnce = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-soc-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '30'], { env });
    const r = { social: fs.readFileSync(path.join(dir, 'social.json'), 'utf8'), vs: JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8')), hist: JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')) };
    fs.rmSync(dir, { recursive: true, force: true });
    return r;
  };
  const a = runOnce(), b = runOnce();
  assert.strictEqual(a.social, b.social);
  const soc = JSON.parse(a.social);
  assert.ok(soc.talks.length > 20);
  for (const tk of soc.talks) { assert.ok(tk.lines.length >= 2 && tk.lines.length <= 3); for (const [w, s] of tk.lines) { assert.ok(w === tk.a || w === tk.b); assert.ok(s.length <= 16, s); } }
  // 1 日に同じ人が 2 回話さない
  const perDay = {};
  for (const tk of soc.talks) { const s = perDay[tk.day] || (perDay[tk.day] = new Set()); assert.ok(!s.has(tk.a) && !s.has(tk.b)); s.add(tk.a); s.add(tk.b); }
  assert.ok(a.hist.some((h) => h.type === 'social'));
  for (const v of a.vs) if (v.birthday) assert.ok(/^\d{2}-\d{2}$/.test(v.birthday), '月日だけ');
  for (const h of a.hist.filter((x) => x.type === 'birthday')) { const v = a.vs.find((x) => x.key === h.who[0]); assert.strictEqual(v.birthday, h.date.slice(5)); }
});

const PF = require('../js/profile-fields.js');
const PR = require('../tools/profiles');
const FIELDS = liveCfg().profileFields;
t('プロフィールの項目：確かめ・悪い言葉・文字数', () => {
  for (const w of ['カステラ', 'ちょっとばかり', 'くずもち', 'らーめん']) assert.ok(!PF.badWord(w), w);
  for (const w of ['バーカ', '死ね', 'し ね', 'ｸｿ', '馬鹿']) assert.ok(PF.badWord(w), w);
  const r = PF.validate(FIELDS, { mbti: 'INFP', birthday: '5-2', food: 'カレー', color: '#AABBCC', hobby: 'https://x.example', message: 'あ'.repeat(60), wantJob: '採掘' });
  assert.strictEqual(r.ok.birthday, '05-02');
  assert.strictEqual(r.ok.color, '#aabbcc');
  assert.ok(r.errors.hobby, 'URL はだめ');
  assert.strictEqual(Array.from(r.ok.message).length, 40, '上限で切る');
  const bad = PF.validate(FIELDS, { mbti: 'ABCD', birthday: '2-30', wantJob: '勇者', color: 'red' });
  assert.deepStrictEqual(Object.keys(bad.errors).sort(), ['birthday', 'color', 'mbti', 'wantJob']);
});
t('つなぐコード：読み取りと from.id', () => {
  assert.strictEqual(PR.parseLink('つなぐ 7K3Q'), '7K3Q');
  assert.strictEqual(PR.parseLink('つなぐ７ｋ３ｑ'), '7K3Q');
  assert.strictEqual(PR.parseLink('つなぐ 7K3B'), null, '使わない字');
  assert.strictEqual(PR.parseLink('つなぐ 7K3QX'), null, '長すぎ');
  const L = PR.linksFrom([{ text: 'つなぐ 7K3Q', from: { id: '11' }, timestamp: '2026-01-01T00:00:00Z' }, { text: 'つなぐ AC4D', timestamp: '2026-01-01T00:00:00Z' }]);
  assert.deepStrictEqual(L, [{ code: '7K3Q', igId: '11' }]);
});
t('プロフィールの反映：悪い値は弾き、メールなど知らない項目は入れない', () => {
  const vs = [{ key: 'a' }, { key: 'b' }];
  const { report, priv } = PR.applyProfiles(vs, { a: { mbti: 'ENTJ', birthday: '12-24', food: 'くそまずい', color: '#112233', email: 'x@example.com' }, zz: { mbti: 'INFP' } }, { a: { secret: 1 } }, FIELDS);
  assert.strictEqual(vs[0].mbti, 'ENTJ');
  assert.strictEqual(vs[0].birthday, '12-24');
  assert.deepStrictEqual(vs[0].profile, { color: '#112233' });
  assert.ok(report.rejected.some((r) => r.field === 'food'));
  assert.ok(!JSON.stringify(vs).includes('example.com'));
  assert.deepStrictEqual(priv, {});
  assert.strictEqual(vs[1].profile, undefined);
});

const INV = require('../tools/invites');
t('招待リンク：7 日で切れる・使ったら片付け・送る相手は 7 日以内のコメントで未送信の人', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const inv = INV.newInvite('vkey', now);
  assert.ok(INV.validToken(inv.token) && inv.token.length === 20);
  assert.notStrictEqual(INV.newInvite('vkey', now).token, inv.token);
  assert.ok(!INV.isExpired(inv, now + 6.9 * 86400000));
  assert.ok(INV.isExpired(inv, now + 7 * 86400000));
  assert.ok(INV.shouldDelete({ ...inv, usedBy: 'uid1' }, now));
  assert.ok(!INV.shouldDelete(inv, now));
  assert.strictEqual(INV.inviteUrl('https://x.github.io/town', 'vkey', 'T0KEN'), 'https://x.github.io/town/villager.html?k=vkey&invite=T0KEN');
  const vs = [{ key: 'a', igId: P.igHash('1') }, { key: 'b', igId: P.igHash('2') }, { key: 'c', igId: P.igHash('3') }, { key: 'd', igId: P.igHash('4') }];
  const cm = [
    { id: 'k1', text: '参加したい', timestamp: '2026-11-09T00:00:00Z', from: { id: '1' } },
    { id: 'k1b', text: '参加します', timestamp: '2026-11-09T05:00:00Z', from: { id: '1' } },
    { id: 'k2', text: '参加したい', timestamp: '2026-11-01T00:00:00Z', from: { id: '2' } }, // 7 日より前
    { id: 'k3', text: '参加', timestamp: '2026-11-09T00:00:00Z', from: { id: '3' } },      // もう送った
    { id: 'k4', text: '参加したい', timestamp: '2026-11-09T00:00:00Z', from: { id: '4' } }, // もうつながっている
    { id: 'k5', text: '参加したい', timestamp: '2026-11-09T00:00:00Z', from: { id: '9' } }, // まだ村人でない
    { id: 'k6', text: '参加したい', timestamp: '2026-11-09T00:00:00Z' },                     // from.id なし
  ];
  const p = INV.pendingInvites(cm, vs, { [P.igHash('3')]: { at: 'x' } }, new Set(['d']), now);
  assert.deepStrictEqual(p, [{ commentId: 'k1', igHash: P.igHash('1'), villager: 'a' }]);
});
t('本番の 0 日目：村人 0・建物 0 で、コメントがなくても何日進めても壊れない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-empty-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js');
  const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.strictEqual(rd('villagers.json').length, 0);
  assert.strictEqual(rd('world.json').buildings.length, 0);
  assert.ok(rd('world.json').trees.length > 50 && rd('world.json').rocks.length > 5);
  const empty = path.join(dir, 'inbox.json');
  fs.writeFileSync(empty, JSON.stringify({ followers: 0, joinComments: [], voteComments: null }));
  node('tools/sim.js', '--inbox', empty, '--days', '3');
  assert.strictEqual(rd('villagers.json').length, 0);
  assert.strictEqual(rd('world.json').buildings.length, 0);
  // 最初に「参加したい」と書いた人が最初の村人になる
  fs.writeFileSync(empty, JSON.stringify({ followers: 1, joinComments: [{ id: 'c1', text: '参加したい！', timestamp: '2026-11-04T00:00:00Z', from: { id: '77', username: 'first_one' } }], voteComments: null }));
  node('tools/sim.js', '--inbox', empty);
  const vs = rd('villagers.json');
  assert.strictEqual(vs.length, 1);
  assert.strictEqual(vs[0].name, 'first_one');
});
t('夜：敵は来ても村人は死なない・ケガは次の日だけ休む・守りが強いほど来る数が減る', () => {
  const NI = require('../tools/night');
  const config = liveCfg();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ key: 'v' + i, display: 'v' + i }));
  const run = (buildings) => {
    let sum = 0, nights = 0;
    for (let d = 2; d < 80; d++) {
      const active = mk(6), life = {}; for (const v of active) life[v.key] = { diary: [{ day: d, text: '' }], home: 'h' };
      const state = { res: { food: 20 }, night: null };
      const world = { buildings, fields: [{ id: 'f0', stage: 2 }] };
      const n = NI.stepNight({ day: d, seed: 'test', active, life, world, state, config, hist: () => {} });
      assert.strictEqual(active.length, 6); // だれも減らない
      for (const k of n.hurt) assert.strictEqual(life[k].hurt, d + 1);
      sum += n.count; nights++;
    }
    return sum / nights;
  };
  const none = run([]), strong = run([{ type: 'wall' }, { type: 'fence' }, { type: 'watch' }, { type: 'lamps' }]);
  assert.ok(strong < none * 0.6, `守りなし ${none.toFixed(2)} / 守りあり ${strong.toFixed(2)}`);
  assert.strictEqual(NI.stepNight({ day: 1, seed: 'x', active: mk(3), life: {}, world: { buildings: [] }, state: {}, config, hist: () => {} }), null, '1 日目の夜はまだ来ない');
});
t('夜：sim.js で履歴に残り、ケガをした人は次の日「休み」になる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-night-'));
  const cfgN = liveCfg();
  cfgN.enemies = { ...(cfgN.enemies || {}), enabled: true }; // ふだんは止めてある。コードは残っているので、出す設定で確かめる
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfgN));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--demo'); node('tools/sim.js', '--demo', '--days', '30');
  const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const h = rd('history.json').filter((x) => x.type === 'night');
  assert.ok(h.length >= 5, '夜のできごとが履歴にある');
  assert.ok(h.every((x) => /日目の夜、/.test(x.text)));
  assert.strictEqual(rd('villagers.json').length, 20);
  const life = rd('life.json');
  for (const k in life) for (const d of life[k].diary) if (/ケガで、今日は家で休んだ/.test(d.text)) assert.ok(life[k].diary.some((e) => e.day === d.day - 1 && /ケガをした|たおれた/.test(e.text)), 'ケガの次の日だけ休む');
  // 戦い：倒した数・経験値・落とし物・記録
  const killers = Object.values(life).filter((l) => l.kills && l.kills.total > 0);
  assert.ok(killers.length > 0, '敵を倒した見張りがいる');
  assert.ok(killers.every((l) => l.kills.total === ['zombie', 'skeleton', 'spider'].reduce((a, t) => a + (l.kills[t] || 0), 0)), '倒した数の合計が合う');
  assert.ok(h.some((x) => /を \d+ 体倒した/.test(x.text)), '町の歴史に「〇〇を n 体倒した」');
  assert.ok(Object.values(life).some((l) => l.diary.some((d) => /倒した。/.test(d.text))), '日記に倒した数');
  const st = rd('state.json');
  assert.ok(st.night === null || st.night.quiet || (st.night.fight && Array.isArray(st.night.fight.log)), '夜の戦いの記録（町の画面で数字を出す元）');
  assert.ok(rd('history.json').some((x) => /落とし物/.test(x.text)), '落とし物をチェストに入れた記録');
  assert.ok(!h.some((x) => /逃げ|追い払/.test(x.text)), '敵は逃げない');
  // 建てる段取り：部品を作る → 建て始める（土台）→ 壁・屋根 → できあがり
  const hAll = rd('history.json');
  assert.ok(hAll.some((x) => x.type === 'first' && /建てる部品/.test(x.text)), 'はじめて部品を作った記録');
  assert.ok(hAll.some((x) => x.type === 'build_start' && /まず土台から/.test(x.text)), '建て始めた記録');
  assert.ok(hAll.some((x) => x.type === 'build_stage' && /土台ができた/.test(x.text)), '土台ができた記録');
  const iS = hAll.findIndex((x) => x.type === 'build_start'), iB = hAll.findIndex((x, i) => i > iS && x.type === 'build');
  assert.ok(iS >= 0 && iB > iS, '建て始めてから、あとでできあがる');
  assert.ok(h.some((x) => /守りきった|みんなたおれた/.test(x.text)), '守りきったか、見張りが全員たおれたかが残る');
  // 同じ種なら同じ結果
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'town-night2-'));
  fs.writeFileSync(path.join(dir2, 'config.json'), JSON.stringify(cfgN));
  const env2 = { ...process.env, TOWN_DATA: dir2 };
  for (const a of [['tools/init.js', '--demo'], ['tools/sim.js', '--demo', '--days', '30']]) execFileSync(process.execPath, [path.join(ROOT, a[0]), ...a.slice(1)], { env: env2, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir2, 'state.json'), 'utf8')).night, st.night, '同じ種で同じ夜の戦い');
});
t('戦い：攻撃力は装備で決まる・クリティカルは良い装備ほど少し出やすい・同じ乱数で同じ結果・落とし物・バッジの段', () => {
  const CB = require('../js/combat.js');
  const config = liveCfg(), C = config.combat;
  const ws = [null, 'stone_pickaxe', 'wood_sword', 'stone_sword', 'iron_sword'];
  for (let i = 1; i < ws.length; i++) {
    assert.ok(CB.attackOf(ws[i], C) > CB.attackOf(ws[i - 1], C), `攻撃力 ${ws[i - 1]} < ${ws[i]}`);
    assert.ok(CB.critChance(ws[i], C) > CB.critChance(ws[i - 1], C), `クリティカル ${ws[i - 1]} < ${ws[i]}`);
  }
  assert.strictEqual(CB.weaponKind('torch'), 'tool');
  const mobs = [{ type: 'zombie' }, { type: 'skeleton' }, { type: 'spider' }];
  const run = (w, seed) => CB.fightNight({ mobs, guards: [{ key: 'a', weapon: w, shield: true }, { key: 'b', weapon: w, shield: false }], C, rng: CB.seededRng(seed) });
  assert.deepStrictEqual(run('stone_sword', 's1'), run('stone_sword', 's1'), '同じ乱数なら同じ結果');
  let kHand = 0, kIron = 0, crit = 0, hits = 0;
  for (let i = 0; i < 300; i++) {
    kHand += run(null, 'k' + i).mobs.filter((m) => m.fate === 'killed').length;
    const F = run('iron_sword', 'k' + i); kIron += F.mobs.filter((m) => m.fate === 'killed').length;
    for (const e of F.log) if (e.dmg) { hits++; if (e.crit) crit++; }
    for (const m of F.mobs) assert.ok(['killed', 'raid'].includes(m.fate), '敵は逃げない：倒れるか、見張りが全員たおれて残るか');
    if (F.end === 'won') assert.ok(F.mobs.every((m) => m.fate === 'killed'), '守りきった夜は敵が全員倒れている');
    else assert.ok(F.guards.every((g) => g.down !== null), '負けた夜は見張りが全員たおれている');
    for (const g of F.guards) assert.strictEqual(g.down !== null, F.log.some((e) => e.g === g.key && e.down), 'たおれた記録が合う');
    for (const g of F.guards) if (g.down !== null) assert.ok(!F.log.some((e) => e.g === g.key && e.r > g.down), 'たおれた見張りはそのあと戦わない');
    for (const e of F.log) if (e.kill) assert.strictEqual(F.mobs[e.m].fate, 'killed');
  }
  assert.ok(kIron > kHand * 1.2, `鉄の剣の方がたくさん倒す（素手 ${kHand} / 鉄 ${kIron}）`);
  const cr = crit / hits; assert.ok(Math.abs(cr - CB.critChance('iron_sword', C)) < 0.04, `クリティカルの割合 ${cr.toFixed(3)}`);
  const d = CB.rollDrops('skeleton', C, CB.seededRng('d'));
  assert.ok(Object.keys(d).every((k) => ['bone', 'arrow'].includes(k)), 'スケルトンは骨と矢');
  for (const k of ['rotten_flesh', 'bone', 'arrow', 'string', 'bone_meal', 'bow']) {
    assert.ok(config.items[k] && config.items[k].name, `${k} の名前`);
    assert.ok(fs.existsSync(path.join(ROOT, 'icons', k + '.png')), `${k} のアイコン`);
  }
  const T = config.badges.list.guard.tiers;
  assert.deepStrictEqual([9, 10, 99, 100, 500, 999, 1000].map((n) => CB.badgeTier(n, T)), [-1, 0, 0, 1, 2, 2, 3], '見張り番バッジの段（銅・銀・金・ダイヤ）');
  for (const k of ['guard', 'repel', 'kill_zombie', 'kill_skeleton', 'kill_spider']) assert.ok(config.inventory.xp[k] > 0, `経験値 ${k}`);
});
t('バッジ：はじまりの住人と技能バッジ（銅・銀・金・ダイヤ）・数の読み方・絵がある', () => {
  const CB = require('../js/combat.js');
  const BG = liveCfg().badges;
  const L = { kills: { total: 120, zombie: 100 }, gathered: { wood: 600, stone: 10, food: 50 }, built: ['a', 'b', 'c', 'd', 'e'] };
  assert.strictEqual(CB.badgeCount(L, 'kills'), 120, 'kills は total を読む');
  assert.strictEqual(CB.badgeCount(L, 'gathered.wood'), 600);
  assert.strictEqual(CB.badgeCount(L, 'built'), 5, '配列は数');
  assert.strictEqual(CB.badgeCount(L, 'nothing.here'), 0);
  assert.deepStrictEqual(CB.badgesOf(L, { joinedDay: 1 }, BG), { founder: 0, guard: 1, lumber: 0, builder: 1 }); // 木こりは 100/1000/5000/10000 本（600 本は銅）・食べもの 50 はまだ
  assert.ok(!('founder' in CB.badgesOf(L, { joinedDay: BG.list.founder.founder + 1 }, BG)), 'あとから来た人ははじまりの住人ではない');
  for (const [id, B] of Object.entries(BG.list)) {
    assert.ok(B.name && B.note, id + ' の名前と説明');
    if (B.founder) { assert.ok(fs.existsSync(path.join(ROOT, 'icons', `badge_${id}.png`)), id + ' の絵'); continue; }
    assert.strictEqual(B.tiers.length, BG.tierNames.length, id + ' は 4 段');
    assert.ok(B.tiers.every((v, i) => i === 0 || v > B.tiers[i - 1]), id + ' の段は増えていく');
    B.tiers.forEach((_, i) => assert.ok(fs.existsSync(path.join(ROOT, 'icons', `badge_${id}_${i}.png`)), `${id} ${BG.tierNames[i]} の絵`));
  }
});
t('鉱石：岩の中身は種と岩の id で毎回同じ・確率は config.json・まれな物ほど少ない', () => {
  const O = require('../tools/ores');
  const config = liveCfg();
  assert.ok(config.ores && config.ores.iron > 0 && config.ores.diamond < config.ores.iron, 'config.json に ores がある');
  const rock = { id: 'r5', max: 12 };
  assert.strictEqual(O.genBlocks('machi-12', rock, config.ores), O.genBlocks('machi-12', rock, config.ores));
  assert.notStrictEqual(O.genBlocks('machi-12', rock, config.ores), O.genBlocks('machi-12', { id: 'r6', max: 12 }, config.ores));
  const cnt = { s: 0, c: 0, i: 0, g: 0, d: 0 };
  for (let k = 0; k < 3000; k++) for (const ch of O.genBlocks('t', { id: 'r' + k, max: 10 }, config.ores)) cnt[ch]++;
  assert.ok(cnt.s > cnt.c && cnt.c > cnt.g && cnt.i > cnt.g && cnt.g > cnt.d && cnt.d > 0, JSON.stringify(cnt));
  assert.strictEqual(O.genBlocks('t', { id: 'x', max: 10 }, { coal: 0, iron: 0, gold: 0, diamond: 0 }), 'ssssssssss', '確率 0 なら石だけ');
});
t('鉱石：鉄・金・ダイヤを掘ると履歴に「〇〇が鉄鉱石を見つけた」と残り、見本の名前は「村人N」', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-ore-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--demo');
  const w0 = STORE.readWorld(dir);
  assert.ok(w0.rocks.every((r) => typeof r.blocks === 'string' && r.blocks.length === r.max), '岩ごとに中身がある');
  // 小さな島の町：森は島の岸の近くまであり、北の島にも森がある（前の広い平地は「町の外まで森が続く」だった）
  assert.ok(w0.trees.some((t) => Math.hypot(t.x, t.z) > 38 && t.z > -60) && w0.trees.some((t) => t.z < -80), '島の岸の近くまで森があり、北の島にも森がある');
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.ok(vs.every((v) => /^村人\d+$/.test(v.name)), '見本の名前は実在しえない形');
  node('tools/sim.js', '--demo', '--days', '30');
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  const finds = h.filter((x) => x.type === 'find');
  assert.ok(finds.length >= 1, '30 日で 1 回は何か見つかる');
  for (const f of finds) { assert.ok(/が(鉄鉱石|金鉱石|ダイヤ)を見つけた。$/.test(f.text), f.text); assert.ok(['iron', 'gold', 'diamond'].includes(f.item)); }
  // 2 回動かしても同じ
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'town-ore2-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir2, 'config.json'));
  const env2 = { ...process.env, TOWN_DATA: dir2 };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env: env2 });
  execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '30'], { env: env2 });
  const h2 = JSON.parse(fs.readFileSync(path.join(dir2, 'history.json'), 'utf8'));
  assert.deepStrictEqual(h2.filter((x) => x.type === 'find').map((x) => x.text), finds.map((x) => x.text));
});
t('投票：候補は普通の村の建物だけ。時計台などの特別な建物はフォロワーが増えても自動では候補に入らない', () => {
  const config = liveCfg();
  const plain = new Set(['hut', 'house', 'well', 'storehouse', 'workbench', 'fence', 'workshop', 'watch', 'garden', 'plaza', 'shop', 'lamps', 'wall', 'inn', 'farm', 'canal', 'pen']);
  for (const b of config.firstChoices.concat(config.choicePool)) assert.ok(plain.has(b), b);
  assert.ok(config.firstChoices.includes('workbench'), '作業台は最初から選べる');
  assert.ok(!('milestones' in config), 'フォロワーの節目で候補を足す決まりはない');
  assert.ok(config.buildings.clocktower, '時計台そのものは config に残る（手で選べば建てられる）');
  // フォロワーが 1000 人になっても、候補に特別な建物は入らない
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-ms-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--seed', 'ms', '--start', '2026-11-01'], { env });
  const inbox = path.join(dir, 'inbox.json');
  fs.writeFileSync(inbox, JSON.stringify({ followers: 1000, joinComments: sample.joinComments, voteComments: null }));
  execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--inbox', inbox, '--days', '3'], { env });
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const offered = new Set([...(st.pool || []), ...st.votes.flatMap((v) => (v.options || []).map((o) => o.build).filter(Boolean))]);
  for (const b of offered) assert.ok(plain.has(b), '候補に特別な建物：' + b);
});

// ---------- 建物のリクエスト（tools/requests.js） ----------
const RQ = require('../tools/requests');
const RCFG = liveCfg();
t('リクエスト：いろいろな言い方を建物に読む。ただの感想・A/B/C の票は数えない', () => {
  const cases = { '図書館たててほしい': ['library'], '温泉ほしい！': ['onsen'], 'おんせん欲しいです': ['onsen'], '灯台つくって〜': ['lighthouse'], '時計台がいいな': ['clocktower'],
    '港と風車ができたらうれしい': ['port', 'windmill'], 'パン屋さんお願いします': ['bakery'], '大噴水ほしい': ['fountain'], '教会たてて': ['cathedral'] };
  for (const [s, ids] of Object.entries(cases)) assert.deepStrictEqual(RQ.parseRequest(s, RCFG).ids.sort(), ids.sort(), s);
  assert.strictEqual(RQ.parseRequest('図書館きれい', RCFG), null, '「ほしい」がなければ数えない');
  assert.deepStrictEqual(RQ.parseRequest('ジェットコースターつくって', RCFG), { ids: [], other: 'ジェットコースター' });
  const { req } = RQ.tally([{ text: 'A', from: { id: '1' } }, { text: 'Bがいい', from: { id: '2' } }], RCFG, 1);
  assert.deepStrictEqual(req.buildings, {}, 'A/B/C の票はリクエストにしない');
});
t('リクエスト：1 人 1 建物 1 回。日をまたいでも同じ人は増えない', () => {
  const c = (id, text) => ({ text, from: { id, username: 'user' + id } });
  let { req, seen } = RQ.tally([c('1', '温泉ほしい'), c('1', 'やっぱり温泉ほしい！'), c('2', 'おんせんたてて'), c('1', '図書館ほしい')], RCFG, 3);
  assert.strictEqual(req.buildings.onsen.count, 2);
  assert.strictEqual(req.buildings.library.count, 1);
  ({ req, seen } = RQ.tally([c('1', '温泉ほしい'), c('3', '温泉お願い')], RCFG, 5, req, seen));
  assert.strictEqual(req.buildings.onsen.count, 3, '次の日に同じ人が書いても増えない・新しい人は増える');
  assert.deepStrictEqual([req.buildings.onsen.firstDay, req.buildings.onsen.lastDay], [3, 5]);
  assert.strictEqual(req.buildings.onsen.name, '温泉');
});
t('リクエスト：その他はよくない言葉を捨て、20 文字まで。ユーザー名・ID は残らない', () => {
  const cs = [{ text: 'しねって書いた看板ほしい', from: { id: '11', username: 'bad_guy' } }, { text: 'くそでかい滑り台つくって', from: { id: '12', username: 'x' } },
    { text: 'あいうえおかきくけこさしすせそたちつてとなにぬねの 作って', from: { id: '13', username: 'long_name_user' } }, { text: 'https://example.com ほしい', from: { id: '14', username: 'spam' } },
    { text: '温泉ほしい', from: { id: '98765', username: 'secret_cat' } }, { text: '観覧車ほしい', username: 'only_name' }];
  const { req, seen } = RQ.tally(cs, RCFG, 2);
  const out = JSON.stringify(req) + JSON.stringify(seen);
  assert.ok(!/しね|くそ|http/.test(out), 'よくない言葉・リンクは入らない');
  assert.ok(req.other.every((o) => Array.from(o.text).length <= 20), '20 文字まで');
  assert.ok(req.other.some((o) => o.text === '観覧車'));
  for (const s of ['bad_guy', 'long_name_user', 'secret_cat', 'only_name', '98765', P.igHash('98765'), P.userHash('only_name')]) assert.ok(!out.includes(s), '残っている：' + s);
  // ファイルに書いても同じ
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-req-'));
  RQ.updateFiles(dir, cs, RCFG, 2);
  const files = fs.readFileSync(path.join(dir, 'requests.json'), 'utf8') + fs.readFileSync(path.join(dir, 'requests_seen.json'), 'utf8');
  for (const s of ['secret_cat', 'only_name', '98765']) assert.ok(!files.includes(s));
  assert.ok(RQ.ranking(JSON.parse(fs.readFileSync(path.join(dir, 'requests.json'), 'utf8'))).includes('温泉'));
});

// ---------- 道具作り ----------
t('道具作り：板 3＋棒 2 で木のつるはし。原木から板・棒を自動で作る。足りない時は「あと いくつ」', () => {
  const CR = require('../tools/craft');
  const config = liveCfg();
  const CC = config.crafting, IT = config.items;
  assert.deepStrictEqual(CC.recipes.wood_pickaxe.from, { planks: 3, stick: 2 });
  // 原木 2 → 板 8 → 棒に板 2 を使う → 板 3 を使って、板 3 と棒 2 が残る
  const p = CR.plan({ log: 2 }, CC.recipes.wood_pickaxe, CC);
  assert.ok(p.ok); assert.deepStrictEqual(p.store, { planks: 3, stick: 2 });
  assert.deepStrictEqual(CR.plan({ log: 1 }, CC.recipes.wood_pickaxe, CC).missing, { log: 1 });
  const m = CR.plan({ cobble: 1, stick: 2 }, CC.recipes.stone_pickaxe, CC);
  assert.ok(!m.ok); assert.strictEqual(CR.missingText(m.missing, IT), '丸石 あと 2');
  // 石の道具は作業台がいる。あれば石を選ぶ。投票で決まった道具（goal）を先に作る
  const store = { log: 4, cobble: 6 };
  assert.strictEqual(CR.choose(store, 'pickaxe', CC, { built: [] }).key, 'wood_pickaxe');
  assert.strictEqual(CR.choose(store, 'pickaxe', CC, { built: ['workbench'] }).key, 'stone_pickaxe');
  assert.strictEqual(CR.choose(store, 'pickaxe', CC, { built: ['workbench'], have: 'stone' }).key, null);
  assert.strictEqual(CR.choose({ log: 4, iron: 3, coal: 1, cobble: 3 }, 'pickaxe', CC, { built: ['workbench'], goal: 'iron_pickaxe' }).key, 'iron_pickaxe');
  // 良い道具ほど少ない回数で落ち、多く落ち、長く持つ
  const T = CC.tiers;
  assert.ok(T.hand.hits > T.wood.hits && T.wood.hits > T.stone.hits && T.stone.hits > T.iron.hits);
  assert.ok(T.wood.drop <= T.stone.drop && T.stone.drop < T.iron.drop);
  assert.ok(T.wood.durability < T.stone.durability && T.stone.durability < T.iron.durability);
});
t('道具作り：sim.js で序盤に木の道具を作り、こわれたら作り直す・同じ種なら同じ結果', () => {
  const runs = [0, 1].map(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-craft-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '40'], { env });
    const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const out = { life: rd('life.json'), state: rd('state.json'), world: rd('world.json'), hist: rd('history.json') };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  });
  const [r] = runs;
  const key = (r) => JSON.stringify([r.life, r.world, r.state.store, r.state.decisions, r.hist.map((h) => h.text)]);
  assert.ok(key(runs[0]) === key(runs[1]), '同じ種なら同じ');
  const diary = Object.values(r.life).flatMap((L) => L.diary);
  // 最初の道具（木）は持って来るので、作るのは別の種類の道具がいる時。序盤（6 日目まで）に木の道具を作る
  assert.ok(diary.some((d) => d.day <= 6 && /チェストの材料で木の(つるはし|斧|釣りざお|くわ)を作った/.test(d.text)), '序盤に木の道具を作る');
  // 最初の道具があるので、足りない日はないこともある。あれば「あと いくつ」の形
  assert.ok(diary.filter((d) => /材料が足りない/.test(d.text)).every((d) => /材料が足りない（.+ あと \d+）/.test(d.text)), '足りない時は「あと いくつ」');
  assert.ok(diary.some((d) => /こわれた|作り直した/.test(d.text)), '道具はこわれて、作り直す');
  if (r.world.buildings.some((b) => b.type === 'workbench')) assert.ok(diary.some((d) => /石の(つるはし|斧)を作った/.test(d.text)), '作業台ができたら石の道具');
  assert.ok((r.state.store.log || 0) + (r.state.store.planks || 0) > 0, 'チェストに木がある');
  assert.ok(r.state.store.cobble > 0, 'チェストに丸石がある');
  assert.ok(r.world.buildings.length >= 3, '投票で決まった物が建つ');
  assert.ok(r.world.buildings.every((b) => b.voted), 'どの建物も投票で決まった');
  assert.ok(!r.hist.some((h) => h.type === 'night'), '敵は止めてある（config.enemies.enabled=false）');
});

// ---------- 木と岩 ----------
t('木と岩：切った木は切り株になり、別の場所に苗木→木・掘り切った岩は何日かで戻る（日数は config.json）・地図の全体に散らばる', () => {
  const config = liveCfg();
  const RS = config.respawn;
  assert.ok(RS.stumpDays > 0 && RS.saplingDays > 0 && RS.rockDays[0] > 0, 'config.json に日数がある');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-regrow-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--demo');
  const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const w0 = rd('world.json');
  const near = (a) => a.filter((o) => Math.hypot(o.x, o.z) < 40).length;
  assert.ok(near(w0.trees) >= 8 && near(w0.rocks) >= 2, `町の近くにも木 ${near(w0.trees)}・岩 ${near(w0.rocks)}`);
  const quad = (a) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => a.filter((o) => o.x * sx > 0 && o.z * sz > 0).length);
  assert.ok(quad(w0.rocks).every((n) => n >= 3), '岩が四方にある ' + quad(w0.rocks));
  const seen = { stump: 0, sapling: 0, regrown: 0, rockGone: 0, rockBack: 0 };
  const prev = {};
  for (let d = 0; d < 20; d++) {
    node('tools/sim.js', '--demo');
    const w = rd('world.json');
    for (const t of w.trees) {
      if (t.state === 'stump') seen.stump++;
      if (t.state === 'sapling') seen.sapling++;
      if (prev[t.id] === 'sapling' && t.state === 'tree') seen.regrown++;
      prev[t.id] = t.state;
    }
    for (const r of w.rocks) {
      if (r.hp <= 0) { seen.rockGone++; assert.ok(r.back > 0, '戻る日がある'); }
      if (prev[r.id] === 0 && r.hp > 0) seen.rockBack++;
      prev[r.id] = r.hp > 0 ? 1 : 0;
    }
  }
  assert.ok(seen.stump && seen.sapling && seen.regrown, '切り株 → 苗木 → 木 ' + JSON.stringify(seen));
  assert.ok(seen.rockGone && seen.rockBack, '岩はなくなって、また出る ' + JSON.stringify(seen));
  fs.rmSync(dir, { recursive: true, force: true });
});
t('1 日目：村のまん中の草と石を整地し、チェストを置く', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-level-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--demo');
  const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(rd('world.json').debris.length > 0 && !rd('world.json').square.leveled, '最初は草と石がある');
  node('tools/sim.js', '--demo');
  const w = rd('world.json'), life = rd('life.json');
  assert.ok(w.square.leveled, '1 日目に整地が終わる');
  assert.ok(Object.values(life).some((L) => L.action === 'level'), '整地する人がいる');
  assert.ok(w.chest && w.chest.day === 1, 'チェストを置く');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('釣り・畑・動物：同じ種なら同じ結果・動物は減らない・はじめては歴史に残る', () => {
  const cfg = liveCfg();
  // 確率は config.json から読む（0〜1 の間・重みは正・宝物とがらくたはまれ）
  assert.ok(cfg.fishing.biteChance > 0 && cfg.fishing.biteChance <= 1);
  assert.ok(cfg.fishing.treasure.p < 0.1 && cfg.fishing.junk.p < 0.2, '宝物とがらくたはまれ');
  for (const [id, w] of [...cfg.fishing.fish, ...cfg.fishing.treasure.items, ...cfg.fishing.junk.items]) assert.ok(w > 0 && cfg.items[id], id);
  for (const k of ['wheat', 'carrot', 'potato']) assert.ok(cfg.farming.crops[k].days >= 3, k);
  const run = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-farm-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    const n0 = rd('world.json').animals.length;
    const counts = [];
    for (let d = 0; d < 6; d++) {
      execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '5'], { env });
      counts.push(rd('world.json').animals.length);
    }
    const out = { n0, counts, world: rd('world.json'), history: rd('history.json'), store: rd('state.json').store, state: rd('state.json') };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  };
  const a = run(), b = run();
  assert.deepStrictEqual(a.world.animals, b.world.animals, '動物の動きが同じ');
  assert.deepStrictEqual(a.world.fields, b.world.fields, '畑が同じ');
  assert.deepStrictEqual(a.store, b.store, 'チェストの中身が同じ');
  // 動物は攻撃すると逃げる：減るのは柵の中でしとめた時だけ。ふえるのは柵の中で子が生まれた時だけ
  const births = a.history.filter((h) => /の子が生まれた/.test(h.text)).length;
  assert.ok(a.n0 >= 8 && a.world.animals.length === a.n0 + births - (a.state.hunted || 0), `動物の数 = はじめ + 生まれた - しとめた ${a.n0} ${births} ${a.state.hunted} ${a.world.animals.length}`);
  if (!a.state.hunted) assert.ok(a.counts.every((n) => n >= a.n0), '柵でしとめるまで動物は減らない');
  const firsts = a.history.filter((h) => h.type === 'first').map((h) => h.text).join('\n');
  assert.ok(/はじめて魚を釣った/.test(firsts), '初めての魚 ' + firsts);
  // 柵を建てるかは投票しだいなので、柵ができた時だけ確かめる
  const hasPen = a.world.buildings.some((b) => b.type === 'pen');
  if (hasPen) assert.ok(/はじめて.*柵の中に入れて/.test(firsts), '初めて飼った');
  assert.ok(/はじめて畑を耕して/.test(firsts) && /畑ではじめて.*とれた/.test(firsts), '初めての畑と収穫');
  // たまごは食べ物なので、食べ物が足りない日はチェストから食べられて 0 になることがある（ニワトリ 1 羽だと特に）。もらったことを記録で確かめる
  if (hasPen) assert.ok(/たまごをもらった/.test(firsts) && a.store.milk > 0 && a.store.wool > 0, 'たまご・ミルク・羊毛がたまる');
  assert.ok(Object.keys(a.store).some((k) => k.startsWith('fish_')), '魚がたまる');
  assert.ok(a.world.animals.filter((x) => x.pen).length <= cfg.animals.penCap, '柵の数を超えない');
});
t('最初の道具：コメントの言葉で選ぶ・なければ人の少ない仕事・木の道具を 1 つ持つ・プロフィールは参加した日に 1 回だけ', () => {
  const cfg = liveCfg();
  const ST = cfg.startTools;
  const cases = { '参加したい ピッケル': 'pickaxe', '参加したい つるはし': 'pickaxe', '参加したい！採掘': 'pickaxe', '参加したい 斧': 'axe', '参加します 木こり': 'axe', '参加したい 釣り': 'fishing_rod', '参加したい 釣りざお': 'fishing_rod', '参加 くわ': 'hoe', '参加したい 畑やりたい': 'hoe', '参加したい': null, '参加したい 剣': null, '参加したい 釣りと畑': 'fishing_rod' };
  for (const [k, v] of Object.entries(cases)) assert.strictEqual(P.parseStartTool(k, ST), v, k);
  assert.strictEqual(P.parseStartTool('参加したい 剣', ST, { enemies: true }), 'sword', '敵が出るようになったら剣も選べる');
  for (const o of ST.options) assert.ok(cfg.items[o.item] && o.item.startsWith('wood_'), o.id);
  const regs = P.registrationsFrom([
    { text: '参加したい ピッケル', timestamp: '2026-11-02T01:00:00Z', from: { id: '9001', username: 'a' } },
    { text: '参加したい', timestamp: '2026-11-02T02:00:00Z', from: { id: '9002', username: 'b' } },
    { text: '参加したい', timestamp: '2026-11-02T03:00:00Z', from: { id: '9001', username: 'a' } },
  ], cfg.joinWord, ST);
  assert.strictEqual(regs.find((r) => r.username === 'a').startTool, 'pickaxe', 'あとの「参加したい」だけのコメントで消えない');
  assert.strictEqual(regs.find((r) => r.username === 'b').startTool, undefined);
  const vs = [];
  for (const r of regs) P.upsertVillager(vs, { ...r, joined: 'x', joinedDay: 2 }, new Set());
  assert.strictEqual(vs[0].startTool, 'pickaxe');
  // プロフィール：参加した日なら 1 回だけ変えられる。次の日や 2 回目は変わらない
  const PR = require('../tools/profiles');
  const fields = cfg.profileFields;
  assert.ok(fields.find((f) => f.id === 'startTool' && f.options.includes('つるはし') && !f.options.includes('剣')));
  let r = PR.applyProfiles(vs, { [vs[0].key]: { startTool: '釣りざお' } }, {}, fields, { day: 2, startTools: ST });
  assert.strictEqual(vs[0].startTool, 'fishing_rod');
  r = PR.applyProfiles(vs, { [vs[0].key]: { startTool: 'くわ' } }, {}, fields, { day: 2, startTools: ST });
  assert.strictEqual(vs[0].startTool, 'fishing_rod', '2 回目は変わらない');
  assert.ok(r.report.rejected.some((x) => x.field === 'startTool'));
  PR.applyProfiles(vs, { [vs[1].key]: { startTool: 'くわ' } }, {}, fields, { day: 3, startTools: ST });
  assert.strictEqual(vs[1].startTool, undefined, '次の日は変えられない');
  // sim.js：見本の町で、全員が木の道具を 1 つ持って来る・自動の分け方はかたよらない・同じ種なら同じ
  const run = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-start-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '1'], { env });
    const out = { life: rd('life.json'), villagers: rd('villagers.json'), day: rd('state.json').day };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  };
  const a = run(), b = run();
  const act = a.villagers.filter((v) => v.joinedDay <= a.day);
  assert.ok(act.length >= 2, '見本の村人がいる');
  const n = {};
  for (const v of act) {
    const L = a.life[v.key];
    const o = ST.options.find((x) => x.id === L.startTool);
    assert.ok(o && !o.needsEnemies, v.key + ' の最初の道具');
    assert.ok(L.inv.some((s) => s && s.item === o.item), '木の道具を持っている');
    assert.ok(L.slots === cfg.inventory.base, '持ち物は 3 つ');
    n[o.id] = (n[o.id] || 0) + 1;
  }
  const cnt = ST.options.filter((o) => !o.needsEnemies).map((o) => n[o.id] || 0);
  assert.ok(Math.max(...cnt) - Math.min(...cnt) <= 1, '自動の分け方がかたよらない ' + JSON.stringify(n));
  assert.deepStrictEqual(Object.fromEntries(Object.entries(a.life).map(([k, L]) => [k, L.startTool])), Object.fromEntries(Object.entries(b.life).map(([k, L]) => [k, L.startTool])), '同じ種なら同じ');
});

// ---------- 切り株・建物のまわり・草の畑・動物・体力とおなか ----------
t('切り株はその場所に生えず別の場所に木が出る・建物のまわりに木と岩なし・草の畑と種・動物は種を持つ人が連れる・体力とおなか', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-life-'));
  const config = liveCfg();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  node('tools/init.js', '--demo');
  const clearR = config.terrain.clearBlocks * 1.9 + 2.5;
  const stumpAt = [], prev = {};
  const seen = { stump: 0, dug: 0, rot: 0, newTree: 0, wild: 0, weak: 0 };
  for (let d = 0; d < 45; d++) {
    node('tools/sim.js', '--demo');
    const w = rd('world.json'), life = rd('life.json'), st = rd('state.json');
    for (const t of w.trees) {
      if (t.state === 'stump' && prev[t.id] !== 'stump') { seen.stump++; stumpAt.push(t); }
      assert.ok(!(prev[t.id] === 'stump' && (t.state === 'tree' || t.state === 'sapling')), '切り株の場所には生えない ' + t.id);
      if (t.state === 'removed' && prev[t.id] === 'stump') seen.dug++;
      if (t.born === st.day) {
        seen.newTree++;
        assert.ok(stumpAt.every((s) => Math.hypot(s.x - t.x, s.z - t.z) > 1), '新しい木は切り株と別の場所 ' + t.id);
      }
      prev[t.id] = t.state;
      if (!t.gone && (t.state === 'tree' || t.state === 'sapling')) for (const b of w.buildings) assert.ok(Math.hypot(b.x - t.x, b.z - t.z) >= clearR - 1e-6, `建物 ${b.id} のそばに木 ${t.id}`);
    }
    for (const r of w.rocks) if (r.hp > 0) for (const b of w.buildings) assert.ok(Math.hypot(b.x - r.x, b.z - r.z) >= clearR - 1e-6, `建物 ${b.id} のそばに岩 ${r.id}`);
    seen.wild = w.fields.filter((f) => f.wild).length;
    for (const a of w.animals) if (a.pen && a.tamedDay === st.day && !a.born) assert.ok(a.ledBy && life[a.ledBy] && life[a.ledBy].lure, '柵に入った動物は、種や作物を持った人が連れてきた');
    for (const [k, L] of Object.entries(life)) {
      assert.ok(L.hp >= 1 && L.hp <= 20 && L.hunger >= 0 && L.hunger <= 20, `体力とおなかは 0〜20 ${k} ${L.hp}/${L.hunger}`);
    }
  }
  const items = Object.values(rd('life.json')).reduce((m, L) => { for (const [k, n] of Object.entries(L.items || {})) m[k] = (m[k] || 0) + n; return m; }, {});
  assert.ok(seen.stump > 5 && seen.newTree > 3, '切り株ができて、別の場所に木が出た ' + JSON.stringify(seen));
  assert.ok(seen.dug > 0 && (items.stump || 0) > 0, '切り株をたたくと掘り出せて「切り株」が落ちる ' + JSON.stringify(seen) + ' ' + items.stump);
  assert.ok((items.seeds || 0) > 0, '草を摘むと種が取れる');
  assert.ok(seen.wild > 0, 'くわで草を耕して畑にした ' + JSON.stringify(seen));
  assert.ok(rd('history.json').some((h) => h.type === 'first' && /草を耕して畑/.test(h.text)), '草の畑のはじめては歴史に残る');
  fs.rmSync(dir, { recursive: true, force: true });

  // 食べ物がまったくない町：おなかが 0 になると体力が減るが、死なずに休んで戻す
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'town-hunger-'));
  const c2 = JSON.parse(JSON.stringify(config)); c2.needs.eat = 0;
  fs.writeFileSync(path.join(dir2, 'config.json'), JSON.stringify(c2));
  const env2 = { ...process.env, TOWN_DATA: dir2 };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env: env2 });
  const hp = [];
  for (let d = 0; d < 14; d++) {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo'], { env: env2 });
    const life = STORE.readLife(dir2);
    const L = Object.values(life)[0]; hp.push([L.hunger, L.hp, L.action]);
  }
  assert.ok(hp.some(([h]) => h === 0), 'おなかが 0 になる ' + JSON.stringify(hp));
  assert.ok(hp.some(([, h]) => h < 20) && hp.every(([, h]) => h >= 1), '体力が減るが 1 より下がらない ' + JSON.stringify(hp));
  assert.ok(hp.some(([, , a]) => a === 'rest'), '体力が少ないと休む ' + JSON.stringify(hp));
  fs.rmSync(dir2, { recursive: true, force: true });
});

t('見た目：同じシードと体の種類なら同じスキン・プロフィールの「見た目」は 体:シード だけ通す・引き直しは体を変えた時に 1 回だけ（2 回目と開き直し後は断る）', () => {
  const PF = require('../js/profile-fields.js');
  const f = { id: 'look', type: 'skin', public: true };
  assert.strictEqual(PF.check(f, 'female:123').value, 'female:123');
  for (const bad of ['girl:1', 'male:', 'male:-1', 'male:1e5', 'none:99999999999', '<b>']) assert.ok(PF.check(f, bad).error, bad);
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import { makeSkin } from ${JSON.stringify(require('url').pathToFileURL(path.join(ROOT, 'js/skingen.js')).href)};
    const a = makeSkin(42, 'female'), b = makeSkin(42, 'female'), c = makeSkin(42, 'male'), n = makeSkin(43, 'female');
    const same = (x, y) => x.px.every((v, i) => v === y.px[i]);
    console.log(JSON.stringify({ same: same(a, b), diffBody: !same(a, c), diffSeed: !same(a, n), slimF: a.slim, size: a.px.length }));`], { encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.ok(r.same && r.diffBody && r.diffSeed && r.size === 64 * 64 * 4, JSON.stringify(r));
  const PR = require('../tools/profiles.js');
  // 最初のスキンは参加した時の番号（none:skin）。体の種類だけ変えるのはいつでも通る
  const vs = [{ key: 'k1', joinedDay: 1, skin: 12 }];
  let r1 = PR.applyProfiles(vs, { k1: { look: 'male:12:0' } }, {}, [f], { day: 1 });
  assert.deepStrictEqual(vs[0].look, { body: 'male', seed: 12 }); assert.ok(!vs[0].lookRerolls && !r1.report.rejected.length);
  // 体の種類を変えて引き直す：1 回目は通る
  r1 = PR.applyProfiles(vs, { k1: { look: 'female:77:1' } }, {}, [f], { day: 2 });
  assert.deepStrictEqual(vs[0].look, { body: 'female', seed: 77 }); assert.strictEqual(vs[0].lookRerolls, 1); assert.ok(!r1.report.rejected.length);
  // 同じ保存のままの次の日は、変化なしで通る
  r1 = PR.applyProfiles(vs, { k1: { look: 'female:77:1' } }, {}, [f], { day: 3 });
  assert.ok(!r1.report.rejected.length && vs[0].lookRerolls === 1);
  // 2 回目は断る（体の種類を変えても、保存の回数を 0 に書きかえても）
  r1 = PR.applyProfiles(vs, { k1: { look: 'male:999:0' } }, {}, [f], { day: 4 });
  assert.deepStrictEqual(vs[0].look, { body: 'female', seed: 77 }); assert.ok(r1.report.rejected.some((x) => x.field === 'look'));
  // 開き直した（villagers.json を読み直した）あとも断る
  const again = JSON.parse(JSON.stringify(vs));
  r1 = PR.applyProfiles(again, { k1: { look: 'none:5:1' } }, {}, [f], { day: 5 });
  assert.ok(r1.report.rejected.some((x) => x.field === 'look') && again[0].look.seed === 77);
  // 体の種類を変えずにシードだけ変えるのは断る
  const vs2 = [{ key: 'k2', joinedDay: 1, skin: 3 }];
  r1 = PR.applyProfiles(vs2, { k2: { look: 'none:44:1' } }, {}, [f], { day: 1 });
  assert.ok(r1.report.rejected.length && !vs2[0].look);
  // 画面の決まり：体の種類を変えた時だけ 1 回。保存したプロフィールに 1 が残っていれば、開き直しても押せない
  assert.strictEqual(PF.rerollAllowed({ used: 0, bodyChanged: false }), false);
  assert.strictEqual(PF.rerollAllowed({ used: 0, bodyChanged: true }), true);
  assert.strictEqual(PF.rerollAllowed({ used: 1, bodyChanged: true }), false);
  const reopened = PF.parseLookValue('female:77:1');
  assert.strictEqual(PF.rerollAllowed({ used: reopened.used, bodyChanged: true }), false);
});

t('体型：normal と chibi だけ通す・何度でも変えられる（見た目の引き直しの回数とは別）・villagers の body とプロフィールに入る', () => {
  const PF = require('../js/profile-fields.js'), PR = require('../tools/profiles.js');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
  const fields = cfg.profileFields.filter((f) => f.id === 'look' || f.id === 'body');
  const fb = fields.find((f) => f.id === 'body');
  assert.ok(fb && fb.type === 'shape' && fb.public);
  assert.strictEqual(PF.check(fb, 'chibi').value, 'chibi');
  for (const bad of ['big', 'CHIBI', '<b>', 1]) assert.ok(PF.check(fb, bad).error, String(bad));
  const vs = [{ key: 'k1', joinedDay: 1, skin: 7, lookRerolls: 1, look: { body: 'female', seed: 9 } }];
  for (const [d, b] of [[2, 'chibi'], [3, 'normal'], [4, 'chibi'], [5, 'chibi']]) {
    const r = PR.applyProfiles(vs, { k1: { look: 'female:9:1', body: b } }, {}, fields, { day: d });
    assert.ok(!r.report.rejected.length, JSON.stringify(r.report));
    assert.strictEqual(vs[0].body, b); assert.strictEqual(vs[0].profile.body, b);
  }
  assert.strictEqual(vs[0].lookRerolls, 1); // 引き直しの回数は増えない
  assert.deepStrictEqual(vs[0].look, { body: 'female', seed: 9 });
});

// ---------- 投稿ツール（tools/poster）のブラウザを使わない部分 ----------
t('投稿ツール：引数の読み取り（既定は非公開・まちがいは断る）', () => {
  const PL = require('../tools/poster/lib.js');
  let r = PL.parseArgs(['youtube', 'a.mp4', 'c.txt', '--title', 'たいとる']);
  assert.deepStrictEqual(r, { cmd: 'youtube', args: ['a.mp4', 'c.txt'], flags: { dryRun: false, title: 'たいとる', visibility: 'private' } });
  r = PL.parseArgs(['youtube', 'a.mp4', 'c.txt', '--visibility=Unlisted', '--dry-run']);
  assert.strictEqual(r.flags.visibility, 'unlisted'); assert.strictEqual(r.flags.dryRun, true);
  assert.strictEqual(PL.parseArgs(['instagram', 'a.mp4', 'c.txt', '--dry-run']).flags.dryRun, true);
  assert.strictEqual(PL.parseArgs(['comments', 'https://www.instagram.com/p/AbC_12-x/', '--out', 'x.json']).flags.out, 'x.json');
  assert.strictEqual(PL.parseArgs(['comments', 'https://www.instagram.com/reel/AbC123/?igsh=1']).cmd, 'comments');
  assert.deepStrictEqual(PL.parseArgs(['dm', '@Hanako.Town', 'm.txt']).args, ['hanako.town', 'm.txt']);
  assert.deepStrictEqual(PL.parseArgs(['login']).args, []);
  for (const bad of [[], ['tweet'], ['youtube', 'a.mp4'], ['youtube', 'a.mp4', 'c.txt', '--visibility', 'secret'], ['youtube', 'a.mp4', 'c.txt', '--title'],
    ['instagram', 'a.mp4', 'c.txt', '--title', 'x'], ['comments', 'https://example.com/p/x'], ['comments', 'u', '--dry-run'], ['dm', 'bad name!', 'm.txt'], ['login', '--zzz']]) {
    assert.throws(() => PL.parseArgs(bad), Error, JSON.stringify(bad));
  }
  const y = PL.youtubeText('1行目の説明 <b>\n2行目', '');
  assert.strictEqual(y.title, '1行目の説明 ＜b＞'); assert.ok(!/[<>]/.test(y.description));
  assert.strictEqual([...PL.youtubeText('x', 'あ'.repeat(150)).title].length, 100);
  assert.throws(() => PL.youtubeText('  \n ', ''));
  assert.strictEqual(PL.isUploadDone('アップロード中… 45%'), false);
  assert.strictEqual(PL.isUploadDone('アップロード完了 ... 処理しています'), true);
  assert.strictEqual(PL.isUploadDone('Checks complete. No issues found.'), true);
  assert.strictEqual(PL.isUploadDone(''), false);
});
t('投稿ツール：DM は 1 日 20 件まで・40〜90 秒あける・同じ人に 2 回送らない', () => {
  const PL = require('../tools/poster/lib.js');
  const t0 = Date.parse('2026-11-25T01:00:00Z'); // 日本時間 10 時
  const log = PL.loadDmLog('');
  assert.deepStrictEqual(PL.dmCheck(log, 'a', t0), { ok: true, waitMs: 0, today: 0 });
  PL.dmRecord(log, '@A', t0, () => 0);
  assert.strictEqual(PL.dmCheck(log, 'a', t0 + 999e3).ok, false, '同じ人（大文字・@ ちがい）は断る');
  assert.strictEqual(PL.dmCheck(log, 'b', t0 + 10e3).waitMs, 30e3, '最短 40 秒あける');
  assert.strictEqual(PL.dmCheck(log, 'b', t0 + 41e3).waitMs, 0);
  for (const r of [() => 0, () => 0.5, () => 0.999999]) { const w = PL.randomWaitMs(r); assert.ok(w >= 40e3 && w <= 90e3, String(w)); }
  for (let i = 1; i < 20; i++) PL.dmRecord(log, 'u' + i, t0 + i * 100e3);
  const late = t0 + 20 * 100e3;
  assert.ok(!PL.dmCheck(log, 'zz', late).ok && /20/.test(PL.dmCheck(log, 'zz', late).reason), '21 件目は断る');
  assert.ok(PL.dmCheck(log, 'zz', Date.parse('2026-11-25T15:30:00Z')).ok, '日本時間で次の日になれば送れる');
  const again = PL.loadDmLog(JSON.stringify(log));
  assert.strictEqual(again.sent.length, 20); assert.strictEqual(again.nextAt, log.nextAt);
});
t('投稿ツール：画面から読んだコメントを registrationsFrom の形にする', () => {
  const PL = require('../tools/poster/lib.js');
  const raw = [
    { username: 'owner', text: '参加したい人はコメントしてね', time: '2026-11-01T09:00:00.000Z', isCaption: true },
    { username: 'Taro_Pan', text: ' 参加したい ピッケル ', time: '2026-11-01T12:00:00.000Z' },
    { username: 'new_hanako', text: '参加したいです！', time: '2026-11-01T10:00:00.000Z' },
    { username: 'new_hanako', text: '参加したいです！', time: '2026-11-01T10:00:00.000Z' }, // 2 回読んだもの
    { username: 'x', text: '', time: '2026-11-01T10:00:00.000Z' },
  ];
  const c = PL.shapeComments(raw, Date.parse('2026-11-02T00:00:00Z'));
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c.map((x) => x.username), ['new_hanako', 'taro_pan'], '古い順・名前は小文字');
  assert.deepStrictEqual(c[1].from, { id: 'taro_pan', username: 'taro_pan' });
  assert.strictEqual(c[1].text, '参加したい ピッケル'); assert.strictEqual(c[1].time, c[1].timestamp);
  assert.ok(/^web_[0-9a-f]{12}$/.test(c[0].id));
  assert.strictEqual(PL.shapeComments([{ username: 'n', text: 'a', time: 'きのう' }], 0)[0].time, '1970-01-01T00:00:00.000Z');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
  const regs = P.registrationsFrom(c, cfg.joinWord, cfg.startTools);
  assert.strictEqual(regs.length, 2);
  assert.deepStrictEqual(regs.map((r) => [r.igId, r.username]), [['new_hanako', 'new_hanako'], ['taro_pan', 'taro_pan']]);
});

// ---------- 1 日 24 時間の行動 ----------
const HR = require('../js/hours.js');
const HC = liveCfg().hours;
const hourRun = (() => {
  let memo = null;
  return () => {
    if (memo) return memo;
    const one = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-hours-'));
      fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
      const env = { ...process.env, TOWN_DATA: dir };
      execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
      execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '3'], { env });
      const life = STORE.readLife(dir), vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
      const world = STORE.readWorld(dir), FAR = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).hours.far;
      fs.rmSync(dir, { recursive: true, force: true });
      return { life, vs, world, FAR };
    };
    memo = [one(), one()];
    return memo;
  };
})();
t('24 時間：村人はみんな 1 日 24 個の行動を持つ（L.action も残る）', () => {
  const { life, vs } = hourRun()[0];
  const act = vs.filter((v) => life[v.key] && life[v.key].hours);
  assert.ok(act.length >= 5, '行動のある村人 ' + act.length);
  for (const v of act) {
    const arr = HR.decodeHours(life[v.key].hours);
    assert.strictEqual(arr.length, 24, v.key + ' ' + life[v.key].hours);
    assert.ok(arr.every((c) => HR.parseCode(c).action), '知らない記号 ' + life[v.key].hours);
    assert.ok(life[v.key].action, 'その日のおもな行動 L.action');
    assert.strictEqual(HR.encodeHours(arr), life[v.key].hours, 'まとめ直しても同じ');
  }
});
t('持ち物の枠：仕事のおわりの中身（L.held）が残り、枠の数だけ出る・あいた枠は空・道具は耐久つき', () => {
  const { life, vs } = hourRun()[0];
  const INV = require('../js/invslots.js');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
  const act = vs.filter((v) => life[v.key] && life[v.key].hours);
  assert.ok(act.every((v) => Array.isArray(life[v.key].held)), 'L.held がある');
  assert.ok(act.every((v) => life[v.key].held.length <= life[v.key].slots), '枠より多くない');
  assert.ok(act.some((v) => life[v.key].held.some((s) => s && s.dur !== undefined)), '道具（耐久つき）を持つ人がいる');
  const L = { slots: 4, held: [{ item: 'wood_axe', dur: 30, max: 60 }, null, { item: 'log', n: 12 }] };
  const h = INV.slotsHtml(L, cfg);
  assert.strictEqual((h.match(/class="islot( vacant)?"/g) || []).length, 4, '枠の数だけ');
  assert.strictEqual((h.match(/islot vacant/g) || []).length, 2, 'あいた枠 2 つ');
  assert.ok(h.includes('class="dur"') && h.includes('>12<'), '耐久と個数');
  assert.ok(INV.heldOf({ inv: [] }).label.includes('今の持ち物'), '古いデータは今の持ち物');
});
t('畑の水やり：晴れ・くもりの日は農家が畑に水をやり（wf: の行動・f.wet＝その日）、雨の日はやらない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-water-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    let dryDays = 0, wetDays = 0, rainDays = 0;
    for (let i = 0; i < 8; i++) {
      execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '1'], { env });
      const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), w = STORE.readWorld(dir), life = STORE.readLife(dir);
      const codes = Object.values(life).flatMap((L) => HR.decodeHours(L && L.hours)).filter((c) => /^wf:/.test(c));
      const wet = (w.fields || []).filter((f) => f.wet === st.day);
      const H = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).hours;
      for (const L of Object.values(life)) HR.decodeHours(L && L.hours).forEach((c, h) => { if (/^wf:/.test(c)) assert.ok(!HR.isNight(h, H), '夜は水やりしない ' + h); });
      if (st.weather === '雨') { rainDays++; assert.strictEqual(codes.length + wet.length, 0, '雨の日に水やり ' + st.day); continue; }
      if (!(w.fields || []).length) continue;
      dryDays++;
      for (const c of codes) assert.ok(w.fields.some((f) => f.id === c.slice(3) && f.wet === st.day), '水をやった畑は f.wet がその日 ' + c);
      if (codes.length) wetDays++;
    }
    assert.ok(dryDays === 0 || wetDays > 0, `晴れの日に水やりがない（${dryDays} 日中 ${wetDays}・雨 ${rainDays}）`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
t('畑の水やり：水をやった畑は 1 段早く育つ', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'sim.js'), 'utf8');
  assert.ok(/else if \(f\.wet === day\) g\+\+/.test(src), '水をやった日は育ちが 1 つ多い');
  assert.ok(/!rain && !night && !c\.watered/.test(src), '雨の日は水やりに行かない');
});
// 遠出と寝る場所：近くの岩をぜんぶ掘り切った村で 1 日動かす
const farRun = (() => {
  let memo = null;
  return () => {
    if (memo) return memo;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-far-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '2'], { env });
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')), FAR = cfg.hours.far;
    const w0 = STORE.readWorld(dir), st0 = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    const ch = w0.chest;
    let gone = 0;
    for (const r of w0.rocks) if (Math.hypot(r.x - ch.x, r.z - ch.z) <= FAR.near + 0.5 && r.hp > 0) { r.hp = 0; r.back = st0.day + 50; gone++; }
    STORE.writeWorld(dir, w0);
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '1'], { env });
    const life = STORE.readLife(dir), vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8')), world = STORE.readWorld(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    memo = { life, vs, world, cfg, FAR, gone };
    return memo;
  };
})();
t('遠出：近くの岩がなくなっても、遠くの岩まで歩いて掘る（歩く 1 時間ぶん働く時間が減る）・寝る前に村へ帰る', () => {
  const { life, vs, world, cfg, FAR, gone } = farRun();
  assert.ok(gone > 0, '近くの岩を消した');
  const rocks = Object.fromEntries(world.rocks.map((r) => [r.id, r]));
  const ch = world.chest;
  let miners = 0;
  for (const v of vs) {
    const L = life[v.key]; if (!L || !L.hours) continue;
    const arr = HR.decodeHours(L.hours).map(HR.parseCode);
    const digs = arr.filter((x) => x.action === 'dig');
    if (!digs.length) continue;
    miners++;
    for (const d of digs) assert.ok(Math.hypot(rocks[d.target].x - ch.x, rocks[d.target].z - ch.z) > FAR.near, '近くの岩はもうない ' + d.target);
    assert.ok(arr.some((x) => x.action === 'walkout'), '歩いて行く 1 時間がある ' + L.hours);
    const work = arr.filter((x) => HR.WORK.has(x.action)).length;
    assert.ok(digs.length <= cfg.hours.workHours - 1, `掘る時間は workHours より短い ${digs.length}`);
    void work;
    assert.ok(L.diary[L.diary.length - 1].text.includes('まで歩いた'), '日記に遠出 ' + L.diary[L.diary.length - 1].text);
    // 最後に遠くで掘ったあと、次に寝る前に村へ帰る（wh）
    const last = arr.map((x) => x.action).lastIndexOf('dig');
    const rest = arr.slice(last + 1).concat(arr.slice(0, last + 1));
    const si = rest.findIndex((x) => x.action === 'sleep');
    assert.ok(si > 0 && rest.slice(0, si).some((x) => x.action === 'walkhome'), '寝る前に村へ帰る ' + L.hours);
  }
  assert.ok(miners >= 1, '岩を掘った人がいる');
});
t('寝る場所：木にもたれて寝る人の木は、みんな村のまん中から treeR 以内', () => {
  const runs = [farRun(), ...hourRun()];
  let n = 0;
  for (const r of runs) {
    const world = r.world || null;
    if (!world) continue;
    const trees = Object.fromEntries(world.trees.map((t) => [t.id, t]));
    const c = world.campfire;
    for (const v of r.vs) {
      const L = r.life[v.key]; if (!L || !L.hours) continue;
      for (const x of HR.decodeHours(L.hours).map(HR.parseCode)) {
        if (x.place !== 'tree') continue;
        assert.ok(x.target && trees[x.target], '木の id ' + L.hours);
        assert.ok(Math.hypot(trees[x.target].x - c.x, trees[x.target].z - c.z) <= r.FAR.treeR + 1e-6, '村から遠い木 ' + x.target);
        n++;
      }
    }
  }
  assert.ok(n >= 0);
});
t('町のチェスト：中身を 材料・食べ物・道具・その他 に分け、今つくっている物の あつまった数／いる数 を出す', () => {
  const CV = require('../js/chestview.js');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
  const g = CV.chestGroups({ log: 5, cobble: 3, berry: 4, wood_axe: 1, old_coin: 1, zero: 0 }, cfg);
  assert.deepStrictEqual(g.mat.map((x) => x[0]).sort(), ['cobble', 'log']);
  assert.deepStrictEqual(g.food, [['berry', 4]]);
  assert.deepStrictEqual(g.tool, [['wood_axe', 1]]);
  assert.deepStrictEqual(g.other, [['old_coin', 1]]);
  const b = Object.keys(cfg.buildings).find((k) => cfg.buildings[k].cost.wood && cfg.buildings[k].cost.stone);
  const c = require('../js/construction.js').needsOf(b, cfg).raw; // 部品にした分を引いた材料
  const st = { plan: { build: b, site: { label: 'テスト' }, leveled: 1 }, resources: { wood: c.wood + 50, stone: 1, food: 0 }, store: {} };
  const p = CV.goalProgress(st, cfg, 10);
  const w = p.rows.find((x) => x.key === 'wood'), s = p.rows.find((x) => x.key === 'stone');
  assert.strictEqual(w.have, c.wood, '多くてもいる数まで');
  assert.strictEqual(s.have, 1);
  assert.strictEqual(p.ready, false);
  assert.ok(CV.goalHtml(st, cfg, 10).includes(`1／${c.stone}`));
  assert.ok(p.rows.some((x) => x.part && x.icon === 'beam'), '部品（柱）の行もある');
  // 部品にした分＋残りの材料＝建物の cost（全体の量は変わらない）。部品のアイコンと名前がある
  const CON = require('../js/construction.js');
  for (const k of ['hut', 'house', 'workshop', 'castle']) {
    const nd = CON.needsOf(k, cfg), cost = cfg.buildings[k].cost, used = { wood: 0, stone: 0, food: 0 };
    for (const [pk, n] of Object.entries(nd.parts)) for (const [it, m] of Object.entries(cfg.construction.parts[pk].from)) for (const r in used) used[r] += ((cfg.items[it].value || {})[r] || 0) * m * n;
    for (const r of Object.keys(cost)) assert.ok(Math.abs(nd.raw[r] + used[r] - cost[r]) < 1, `${k} の ${r}：部品 ${used[r]} + 残り ${nd.raw[r]} ≒ ${cost[r]}`);
    assert.ok(nd.parts.beam > 0, `${k} は柱がいる`);
  }
  assert.deepStrictEqual(CON.needsOf('fence', cfg).parts, {}, '柵は部品なし');
  for (const k of Object.keys(cfg.construction.parts)) { assert.ok(cfg.items[k] && cfg.items[k].part, `${k} は部品`); assert.ok(fs.existsSync(path.join(__dirname, '..', 'icons', k + '.png')), `${k} のアイコン`); }
  assert.deepStrictEqual([0, 0.33, 0.34, 0.66, 0.67, 1].map((x) => CON.stageOf(x, cfg)), [0, 0, 1, 1, 2, 3], '土台 → 壁 → 屋根 → できあがり');
  assert.strictEqual(CV.goalProgress({ plan: null }, cfg), null);
  assert.ok(CV.chestHtml({}, cfg).includes('空っぽ'));
});
t('建てている物・橋：sim が いる数／あつまった数 を残し、押した時の「あと何個」が日ごとに正しい', () => {
  const CV = require('../js/chestview.js'), CON = require('../js/construction.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-proj-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
  const cfg = liveCfg();
  let seenGather = 0, seenBuild = 0;
  const paidBefore = {};
  for (let d = 0; d < 10; d++) {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '4'], { env });
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), world = STORE.readWorld(dir);
    const list = CV.projectList(st, world, cfg, 12);
    const pl = st.plan;
    if (pl && pl.build) {
      const nd = CON.needsOf(pl.build, cfg), need = { ...nd.raw, ...nd.parts };
      assert.deepStrictEqual(pl.need, need, 'plan.need は needsOf と同じ');
      for (const [k, n] of Object.entries(need)) {
        const live = ['wood', 'stone', 'food'].includes(k) ? st.resources[k] : (st.store[k] || 0);
        assert.strictEqual(pl.got[k], pl.started ? n : Math.min(n, Math.floor(live || 0)), `plan.got.${k}`);
      }
      const p = list.find((x) => x.id === 'plan');
      assert.ok(p && p.kind === 'building');
      for (const r of p.rows) { assert.strictEqual(r.left, r.need - r.have, r.key); assert.ok(r.left >= 0 && r.have <= r.need); assert.strictEqual(r.need, need[r.key]); }
      const html = CV.projectCardHtml(p);
      for (const r of p.rows) assert.ok(html.includes(`（${r.have} / ${r.need}）`), '札に あつまった数 / いる数');
      if (pl.started) { seenBuild++; assert.ok(p.rows.every((r) => r.left === 0)); } else if (p.rows.some((r) => r.left > 0)) { seenGather++; assert.ok(html.includes('あと <b>')); }
    } else assert.ok(!list.some((x) => x.id === 'plan'));
    for (const [id, ex] of Object.entries(st.expansion || {})) {
      const br = (world.bridges || []).find((b) => b.id === id);
      const p = list.find((x) => x.id === 'bridge:' + id);
      if (ex.built || (br && br.built)) { assert.ok(!p, 'できた橋は出さない'); continue; }
      assert.ok(p && p.kind === 'bridge', '作っている橋が出る');
      for (const r of p.rows) {
        assert.strictEqual(r.need, ex.cost[r.key]); assert.strictEqual(r.have, Math.min(r.need, ex.paid[r.key])); assert.strictEqual(r.left, r.need - r.have);
        assert.ok(r.have >= (paidBefore[id + r.key] || 0), '橋に使った数は減らない'); paidBefore[id + r.key] = r.have;
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(seenGather + seenBuild > 0, '40 日のうちに何か建てている日がある');
});
t('24 時間：2 人で同じ木を切ると 1 人より早い／木の斧 1 人でおよそ 1 時間', () => {
  const need = HC.treeWork;
  const one = HR.hoursToFinish(need, [HC.power.wood]), two = HR.hoursToFinish(need * 2, [HC.power.wood, HC.power.wood]);
  assert.strictEqual(one, 1, '木の斧 1 人で 1 時間');
  const big = need * 3; // 大きな木
  assert.ok(HR.hoursToFinish(big, [HC.power.wood, HC.power.stone]) < HR.hoursToFinish(big, [HC.power.wood]), '手伝うと早い');
  assert.ok(two <= one);
  assert.ok(HC.power.hand < HC.power.wood && HC.power.wood < HC.power.stone && HC.power.stone < HC.power.iron, '素手 < 木 < 石 < 鉄');
  const r = HR.addWork(0, big, [{ key: 'a', pow: 12 }, { key: 'b', pow: 24 }]);
  assert.ok(r.done && Math.abs(r.share.b - 2 / 3) < 1e-9, '力の割合で分ける');
});
t('24 時間：切り株を掘るのにも時間がかかる（素手は木の斧より遅い）', () => {
  assert.ok(HR.hoursToFinish(HC.stumpWork, [HC.power.wood]) >= 1);
  assert.ok(HR.hoursToFinish(HC.stumpWork, [HC.power.hand]) > HR.hoursToFinish(HC.stumpWork, [HC.power.wood]));
  const { life } = hourRun()[0];
  const all = Object.values(life).map((L) => HR.decodeHours(L.hours)).flat();
  assert.ok(all.some((c) => HR.parseCode(c).action === 'stump'), '切り株を掘る時間がある');
});
t('24 時間：ベッドで寝ると、木や地面より早く戻る', () => {
  const b = HR.sleepGain('bed', HC), g = HR.sleepGain('ground', HC), tr = HR.sleepGain('tree', HC);
  assert.ok(b.sleepy > g.sleepy && b.stamina > g.stamina && b.hp > g.hp);
  assert.ok(b.sleepy > tr.sleepy);
  const hoursTo = (place) => Math.ceil(HC.sleepAt / HR.sleepGain(place, HC).sleepy);
  assert.ok(hoursTo('bed') < hoursTo('ground') && hoursTo('bed') >= 5 && hoursTo('ground') <= 9, `ベッド ${hoursTo('bed')} 時間・地面 ${hoursTo('ground')} 時間`);
});
t('24 時間：夜にも起きて動く村人がいる（寝る時刻は人ごとにちがう）', () => {
  const { life } = hourRun()[0];
  const hs = Object.values(life).filter((L) => L.hours).map((L) => HR.decodeHours(L.hours));
  const nightAwake = hs.filter((a) => a.some((c, h) => HR.isNight(h, HC) && HR.parseCode(c).action !== 'sleep'));
  assert.ok(nightAwake.length > 0, '夜に起きている人');
  const firstSleep = new Set(hs.map((a) => a.findIndex((c, h) => h >= 12 && HR.parseCode(c).action === 'sleep')));
  assert.ok(firstSleep.size >= 2, '寝る時刻は 1 つに決まっていない');
  for (const a of hs) { const n = a.filter((c) => HR.parseCode(c).action === 'sleep').length; assert.ok(n >= 4 && n <= 11, '寝る時間 ' + n); }
});
t('24 時間：同じ種なら同じ 1 日になる', () => {
  const [a, b] = hourRun();
  const pick = (r) => JSON.stringify(Object.keys(r.life).sort().map((k) => [k, r.life[k].hours, r.life[k].action, r.life[k].diary]));
  assert.strictEqual(pick(a), pick(b));
});

// ---------- 村人さがし（js/search.js） ----------
const SR = require('../js/search.js');
// 名前かくしは本物の流れ（upsertVillager → applyPrivacy）で作る
const searchList = () => {
  const hidden = new Set([P.userHash('secret.user')]), vs = [];
  P.upsertVillager(vs, { username: 'Taro_Yamada', joined: '2026-11-01', joinedDay: 1 }, hidden);
  P.upsertVillager(vs, { username: 'hanako.k', joined: '2026-11-01', joinedDay: 2 }, hidden);
  P.upsertVillager(vs, { username: 'secret.user', joined: '2026-11-01', joinedDay: 3 }, hidden);
  return vs;
};
t('村人さがし：一部・大文字小文字・全角・先頭の @ を気にせず見つかる', () => {
  const vs = searchList();
  for (const q of ['taro', 'TARO', '@taro_y', '＠ＴＡＲＯ', ' yamada ', '@@Taro_Yamada']) assert.deepStrictEqual(SR.searchVillagers(vs, q).map((v) => v.name), ['Taro_Yamada'], q);
  assert.deepStrictEqual(SR.searchVillagers(vs, 'zzz'), []);
  assert.deepStrictEqual(SR.searchVillagers(vs, '@'), [], '@ だけでは出さない');
  assert.strictEqual(SR.findExact(vs, '@hanako.k').name, 'hanako.k');
  assert.strictEqual(SR.findExact(vs, 'hanako'), null, '?who= はぴったりの人だけ');
});
t('村人さがし：名前をかくした人はユーザー名では見つからず、あだ名でだけ見つかる', () => {
  const vs = searchList(), s = vs.find((v) => v.hidden);
  assert.ok(s && !s.name, 'かくした人の名前は公開データに入らない');
  for (const q of ['secret.user', 'secret', '@secret.user']) assert.ok(!SR.searchVillagers(vs, q).includes(s), q);
  assert.strictEqual(SR.findExact(vs, 'secret.user'), null);
  // もし名前が残っていても、かくした人はユーザー名では引かない
  const leak = { ...s, name: 'secret.user' };
  assert.deepStrictEqual(SR.searchVillagers([leak], 'secret'), []);
  assert.deepStrictEqual(SR.searchVillagers(vs, s.display).map((v) => v.key), [s.key], 'あだ名では見つかる');
});
t('村人さがし：インスタのリンクは、かくしていない人のユーザー名だけ', () => {
  const vs = searchList(), s = vs.find((v) => v.hidden), taro = vs.find((v) => v.name === 'Taro_Yamada');
  assert.strictEqual(SR.igUrl(taro), 'https://www.instagram.com/taro_yamada/');
  assert.strictEqual(SR.igUrl(s), null);
  assert.strictEqual(SR.igUrl({ ...s, name: 'secret.user' }), null, 'かくした人は名前が残っていてもリンクなし');
  assert.strictEqual(SR.igUrl({ name: '村人1', hidden: false }), null, 'ユーザー名の形でなければリンクなし');
  assert.strictEqual(SR.igUrl({ name: 'a/../b', hidden: false }), null);
});
t('名前札：かくしていない人は @ユーザー名・かくした人はあだ名・動画は config.nameTags.video で切りかえ', () => {
  const vs = searchList(), s = vs.find((v) => v.hidden), taro = vs.find((v) => v.name === 'Taro_Yamada');
  assert.strictEqual(SR.tagName(taro), '@taro_yamada');
  assert.strictEqual(SR.tagName({ ...s, name: 'secret.user' }), s.display, 'かくした人はユーザー名を出さない');
  assert.strictEqual(SR.tagName({ name: '村人1', display: '村人1', hidden: false }), '村人1');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.nameTags.video, true, '動画でも名前を出す（今の決まり）');
  assert.strictEqual(SR.tagName(taro, { video: true, cfg }), '@taro_yamada');
  assert.strictEqual(SR.tagName(taro, { video: true, cfg: { nameTags: { video: false } } }), taro.display, 'video を false にすると動画ではあだ名');
});

// ---------- 町を始める日（0 日目の待ち）と、すぐの入居 ----------
const W = require('../tools/welcome');
t('町を始める日：startAt の読み方と、gate のあいだは 0 日目のまま', () => {
  assert.strictEqual(W.parseStartAt('2026-11-28 06:00'), Date.parse('2026-11-28T06:00:00+09:00'));
  assert.strictEqual(W.parseStartAt('2026-11-28'), Date.parse('2026-11-28T06:00:00+09:00'), '日だけなら朝 6 時');
  assert.strictEqual(W.parseStartAt('2026-11-28T06:00:00+09:00'), Date.parse('2026-11-28T06:00:00+09:00'));
  assert.strictEqual(W.parseStartAt(null), null);
  const s0 = { day: 0 }, s1 = { day: 1 }, at = { startAt: '2026-11-28 06:00' };
  const before = new Date('2026-11-28T05:59:00+09:00'), after = new Date('2026-11-28T06:07:00+09:00');
  assert.strictEqual(W.shouldAdvance(s0, {}, {}), true, 'gate なし（手で・テスト）はいつも進める');
  assert.strictEqual(W.shouldAdvance(s0, { startAt: null }, { gate: true, now: after }), false, '始める日が決まっていなければ進めない');
  assert.strictEqual(W.shouldAdvance(s0, at, { gate: true, now: before }), false);
  assert.strictEqual(W.shouldAdvance(s0, at, { gate: true, now: after }), true);
  assert.strictEqual(W.shouldAdvance(s0, {}, { gate: true, start: true, now: before }), true, 'Actions の start で始める');
  assert.strictEqual(W.shouldAdvance(s1, {}, { gate: true, now: before }), true, '1 日目より後は毎朝進む');
});
t('すぐの入居：join.js で 0 日目に住み始め、daily（--gate）は始めるまで進まない・始めたら 1 日目', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-join-'));
  const cfg = liveCfg();
  cfg.startAt = null; cfg.joinExclude = ['town_owner2'];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'jt', '--start', '2026-11-01');
  fs.mkdirSync(path.join(dir, 'inbox'));
  const inbox = path.join(dir, 'inbox', 'instagram.json');
  const cm = (id, u, text, ts) => ({ from: { id, username: u }, text, timestamp: ts });
  fs.writeFileSync(inbox, JSON.stringify({ owner: 'town_owner', joinComments: [cm('9001', 'kaito_a', '住みたい ピッケル', '2026-11-27T01:00:00Z'), cm('9002', 'town_owner', '住みたい', '2026-11-27T01:00:00Z'), cm('9003', 'town_owner2', '住みたい', '2026-11-27T01:00:00Z')] }));
  node('tools/join.js', '--now', '2026-11-27T10:00:00+09:00');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  let vs = read('villagers.json'), st = read('state.json');
  assert.strictEqual(st.day, 0, 'join.js は日を進めない');
  assert.strictEqual(vs.length, 1, '持ち主（inbox.owner・joinExclude）は村人にならない');
  const v = vs[0];
  assert.strictEqual(v.joinedDay, 0, '今の日（0 日目）の村人');
  assert.strictEqual(v.joined, '2026-11-27', '参加した日は本当の日付（日本時間）');
  let life = STORE.readLife(dir), L = life[v.key];
  assert.ok(L, 'その場で暮らしの入れ物ができる');
  assert.ok(L.inv.some((s) => s && s.item === 'wood_pickaxe'), '選んだ木の道具を持ってくる');
  assert.strictEqual(L.startTool, 'pickaxe');
  assert.strictEqual(L.home, null, '家がないのでテント');
  assert.strictEqual(L.hp, 20); assert.ok(L.slots >= 3 && L.next);
  assert.ok(L.hours && L.hours.includes('sp') && L.hours.includes('sg'), 'その日の 24 時間（見て回る・夜は寝る）');
  assert.ok(L.diary.length === 1 && L.diary[0].day === 0 && L.diary[0].text.startsWith('今日から村に住むことになった。'), '日記の 1 行目');
  let hist = read('history.json');
  assert.ok(hist.some((h) => h.type === 'join' && h.day === 0 && h.who.includes(v.key)), '町の歴史に残る');
  assert.strictEqual(v.joinedAt, '10:00', '島に来た時刻（日本時間の 時:分）');
  assert.strictEqual(hist.find((h) => h.type === 'join').time, '10:00', '歴史の行にも時刻');
  assert.ok(!STORE.readWorld(dir).chest.day,'0 日目はまだチェストを置かない（1 日目の朝）');
  // もう一度動かしても、同じ人は増えない・日記も増えない
  node('tools/join.js', '--now', '2026-11-27T10:15:00+09:00');
  assert.strictEqual(read('villagers.json').length, 1);
  assert.strictEqual(STORE.readLife(dir)[v.key].diary.length, 1);
  assert.strictEqual(read('history.json').filter((h) => h.type === 'join').length, 1);
  // フォロワー数：受付のたびに state.followers を新しくする（変わった時だけ state.json を書く）
  fs.writeFileSync(inbox, JSON.stringify({ owner: 'town_owner', followers: 321, joinComments: [] }));
  node('tools/join.js', '--now', '2026-11-27T10:30:00+09:00');
  assert.strictEqual(read('state.json').followers, 321, 'join でフォロワー数が変わる');
  const stTxt = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  node('tools/join.js', '--now', '2026-11-27T10:45:00+09:00');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), stTxt, '同じ数なら書かない');
  fs.writeFileSync(inbox, JSON.stringify({ owner: 'town_owner', joinComments: [] }));
  node('tools/join.js', '--now', '2026-11-27T11:00:00+09:00');
  assert.strictEqual(read('state.json').followers, 321, '数がない時はそのまま');
  // daily（--gate）：始める日が決まっていないので進まない
  node('tools/sim.js', '--gate', '--now', '2026-11-28T06:05:00+09:00');
  assert.strictEqual(read('state.json').day, 0, 'まだ 0 日目');
  // startAt を決めた：その前は進まない、過ぎたら 1 日目（1 日目の日付はその日）
  cfg.startAt = '2026-11-29 06:00'; fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  node('tools/sim.js', '--gate', '--now', '2026-11-28T06:05:00+09:00');
  assert.strictEqual(read('state.json').day, 0);
  node('tools/sim.js', '--gate', '--now', '2026-11-29T06:04:00+09:00');
  st = read('state.json');
  assert.strictEqual(st.day, 1, '始まった'); assert.strictEqual(st.date, '2026-11-29', '1 日目は始めた日');
  life = STORE.readLife(dir); L = life[v.key];
  assert.strictEqual(L.diary.length, 2, '1 日目の日記が足される');
  assert.ok(!L.diary[1].text.includes('今日から村に住む'), '1 日目に「今日から住む」をくり返さない');
  assert.strictEqual(read('history.json').filter((h) => h.type === 'join').length, 1, '入居の歴史は 1 回だけ');
  assert.ok(STORE.readWorld(dir).chest.day === 1, '1 日目にチェストを置く');
  // 1 日目より後に来た人も、その日のうちに住む（チェストはもうある）
  fs.writeFileSync(inbox, JSON.stringify({ owner: 'town_owner', joinComments: [cm('9004', 'mio_b', '住みたい 釣り', '2026-11-29T03:00:00Z')] }));
  node('tools/join.js', '--now', '2026-11-29T12:00:00+09:00');
  vs = read('villagers.json');
  const m = vs.find((x) => x.joinedDay === 1);
  assert.ok(m && STORE.readLife(dir)[m.key].diary[0].day === 1, '1 日目に来た人は 1 日目の村人');
  // 次の朝：2 日目。その人もふつうに働く
  node('tools/sim.js', '--gate', '--now', '2026-11-30T06:03:00+09:00');
  assert.strictEqual(read('state.json').day, 2);
  assert.strictEqual(STORE.readLife(dir)[m.key].diary.length, 2);
  // 前の受付（joinedDay ＝ 次の日）で待っていた人も、次の join.js でその場に入居する
  vs = read('villagers.json');
  P.upsertVillager(vs, { igId: '9005', username: 'old_wait', joined: 'x', joinedDay: 3, source: 'comment' }, new Set());
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify(vs));
  fs.writeFileSync(inbox, JSON.stringify({ joinComments: [] }));
  node('tools/join.js', '--now', '2026-11-30T09:00:00+09:00');
  const ow = read('villagers.json').find((x) => x.name === 'old_wait');
  assert.strictEqual(ow.joinedDay, 2); assert.ok(STORE.readLife(dir)[ow.key]);
});

// ---------- 小さな島と、となりの島への橋 ----------
const ISX = require('../js/island.js');
const islandRun = (() => {
  let memo = null;
  return () => {
    if (memo) return memo;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-island-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
    node('tools/init.js', '--demo', '--start', '2026-11-01');
    const w0 = STORE.readWorld(dir);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    const need = cfg.expansion.bridges.north.followers;
    const inbox = path.join(dir, 'inbox.json');
    const days = [];
    for (let d = 1; d <= 20; d++) {
      fs.writeFileSync(inbox, JSON.stringify({ followers: d < 8 ? 10 : need + d })); // 8 日目にフォロワーが節目をこえる
      node('tools/sim.js', '--inbox', inbox);
      days.push({ state: JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), world: STORE.readWorld(dir), life: STORE.readLife(dir) });
    }
    const history = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
    fs.rmSync(dir, { recursive: true, force: true });
    memo = { w0, cfg, days, history };
    return memo;
  };
})();
t('小さな島：はじまり島は 1 画面ほど（前の一辺 220 の半分以下）で、まわりは海', () => {
  const { w0 } = islandRun();
  assert.ok(w0.islands && w0.islands.length >= 2, '島が 2 つ（はじまり島と北の島）');
  const m = w0.islands[0];
  let rmin = 1e9, rmax = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.02) { const r = ISX.radiusAt(m, a); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  assert.ok(rmax * 2 <= 220 * 0.55 && rmin * 2 >= 220 * 0.35, `はじまり島のはば ${(rmin * 2).toFixed(0)}〜${(rmax * 2).toFixed(0)}`);
  assert.ok(!ISX.onLand(w0, 0, rmax + 6, 0, { open: false }) && !ISX.onLand(w0, rmax + 6, 0, 0, { open: false }), '島の外は海');
  assert.ok(!ISX.isOpen(w0.islands[1]), '北の島は、はじめは行けない');
  for (const list of ['trees', 'rocks', 'bushes', 'animals', 'plots']) for (const o of w0[list]) assert.ok(ISX.onLand(w0, o.x, o.z, 0, { open: false }), `${list} が海の中 ${o.x},${o.z}`);
  const onMain = (o) => ISX.shoreDist(m, o.x, o.z) > 0;
  assert.ok(w0.trees.filter(onMain).length >= 80 && w0.rocks.filter(onMain).length >= 15, '30 人ほどが暮らせる木と岩');
  assert.ok(w0.plots.filter((p) => !p.island).length >= 30, '家を建てる区画が 30 以上');
  assert.ok(w0.animals.filter(onMain).length >= 12, '動物');
});
t('小さな島：広場・チェスト・たき火・池は島のまん中のそばで、岸から十分はなれている', () => {
  const { w0 } = islandRun();
  const m = w0.islands[0];
  for (const [nm, o] of [['広場', w0.square], ['チェスト', w0.chest], ['たき火', w0.campfire]]) {
    assert.ok(Math.hypot(o.x - m.x, o.z - m.z) < 8, nm + 'は島のまん中のそば');
    assert.ok(ISX.shoreDist(m, o.x, o.z) > 38, nm + 'から岸まで ' + ISX.shoreDist(m, o.x, o.z).toFixed(1));
  }
  assert.ok(ISX.shoreDist(m, w0.pond.x, w0.pond.z) > 15, '池も岸から離れている');
  for (const a of w0.animals) { const isl = ISX.islandAt(w0, a.x, a.z); assert.ok(isl && ISX.shoreDist(isl, a.x, a.z) >= 8.9, '動物の歩く輪が海に入らない ' + a.id); }
});
t('小さな島：建物・家・テントは陸の上で、重ならない', () => {
  const { days } = islandRun();
  const { world, life } = days[days.length - 1];
  const cfg = islandRun().cfg;
  const W3 = { footprint: (b) => { const L = cfg.buildings[b.type].look; return L.kind === 'house' ? Math.hypot(L.w, L.d) / 2 + 0.35 : 2; } };
  assert.ok(world.buildings.length >= 3, '建物が建った ' + world.buildings.length);
  for (const b of world.buildings) {
    if (b.plot === 'ring') continue;
    const isl = ISX.islandAt(world, b.x, b.z);
    assert.ok(isl && ISX.shoreDist(isl, b.x, b.z) > W3.footprint(b) + 2, `建物 ${b.id} が陸の上`);
    for (const o of world.buildings) if (o !== b && o.plot !== 'ring' && b.type !== 'canal' && o.type !== 'canal') assert.ok(Math.hypot(o.x - b.x, o.z - b.z) > 4, `建物 ${b.id} と ${o.id} が重なる`);
  }
  for (const k in life) { const h = life[k].home; if (h) assert.ok(world.buildings.some((b) => b.id === h && ISX.onLand(world, b.x, b.z, 2)), '家が陸の上 ' + h); }
  assert.ok(ISX.shoreDist(world.islands[0], world.campfire.x, world.campfire.z) > 30, 'テントはたき火のそば（島のまん中）');
});
t('橋：フォロワーが節目をこえると橋を作り始め、できると北の島で働く（それまでは北の島の木と岩にさわらない）', () => {
  const { days, history, cfg } = islandRun();
  const north = (w) => w.islands.find((i) => i.id === 'north');
  const onN = (w, o) => ISX.shoreDist(north(w), o.x, o.z) > 0;
  const start = days.findIndex((d) => d.state.expansion && d.state.expansion.north) + 1;
  assert.strictEqual(start, 8, '8 日目に作り始める');
  const built = days.findIndex((d) => d.world.bridges[0].built) + 1;
  assert.ok(built > start && built <= start + 6, '何日かでできる ' + built);
  assert.ok(north(days[built - 1].world).open === built, '橋ができた日に北の島が開く');
  for (const d of days.slice(0, built)) {
    assert.ok(d.world.trees.filter((t) => onN(d.world, t)).every((t) => t.state === 'tree'), '橋の前に北の島の木を切らない');
    assert.ok(d.world.rocks.filter((r) => onN(d.world, r)).every((r) => r.hp === r.max), '橋の前に北の島の岩を掘らない');
  }
  const last = days[days.length - 1];
  const used = last.world.trees.filter((t) => onN(last.world, t) && t.state !== 'tree').length + last.world.rocks.filter((r) => onN(last.world, r) && r.hp < r.max).length;
  assert.ok(used >= 5, '橋のあと北の島で木を切り岩を掘る ' + used);
  const ex = last.state.expansion.north, c = cfg.expansion.bridges.north.cost;
  assert.ok(ex.paid.wood >= c.wood && ex.paid.stone >= c.stone, '材料はチェストから使った');
  assert.ok(history.some((h) => h.type === 'event' && h.day === start && /橋をかける/.test(h.text)), '歴史：作り始め');
  assert.ok(history.some((h) => h.type === 'event' && h.day === built && /橋ができあがった/.test(h.text)), '歴史：できあがり');
  assert.ok(Object.values(last.life).some((L) => L.diary.some((e) => /北の島/.test(e.text))), '日記にも残る');
  // 橋ができたあとの「どこに建てる？」には、北の島の区画が出る
  const where = history.filter((h) => h.type === 'vote_open' && h.day > built);
  assert.ok(!where.length || where.some((h) => /北の島/.test(h.text)), '北の島の区画が候補に出る');
});
t('海の島々：重ならず、橋は陸から陸へ（とちゅうで別の島を通らない）・開く条件は順に大きくなる', () => {
  const { w0, cfg } = islandRun();
  const sea = w0.islands.filter((i) => i.look);
  assert.ok(sea.length >= 8, '海の島が 8 つ以上 ' + sea.length);
  assert.ok(sea.every((i) => i.name && !ISX.isOpen(i)), 'どれも名前があり、はじめは行けない');
  for (const a of w0.islands) for (const b of w0.islands) {
    if (a === b) continue;
    for (let k = 0; k < 72; k++) { const p = ISX.shorePoint(a, (k / 72) * Math.PI * 2); assert.ok(ISX.shoreDist(b, p.x, p.z) < -10, `${a.id} と ${b.id} が近すぎる`); }
  }
  const EXB = cfg.expansion.bridges;
  let prev = EXB.north.followers;
  for (const br of w0.bridges) {
    const from = w0.islands.find((i) => i.id === (br.from || 'main')), to = w0.islands.find((i) => i.id === br.to);
    assert.ok(EXB[br.id], '開く条件 ' + br.id);
    assert.ok(ISX.shoreDist(from, br.a.x, br.a.z) > 1 && ISX.shoreDist(to, br.b.x, br.b.z) > 1, '橋の両はしは陸 ' + br.id);
    for (let u = 0.05; u < 0.95; u += 0.05) {
      const x = br.a.x + (br.b.x - br.a.x) * u, z = br.a.z + (br.b.z - br.a.z) * u;
      for (const o of w0.islands) if (o !== from && o !== to) assert.ok(ISX.shoreDist(o, x, z) < -3, `${br.id} の橋が ${o.id} を通る`);
    }
    if (br.from) { assert.ok(EXB[br.id].followers > prev, '開く順に followers が大きい ' + br.id); prev = EXB[br.id].followers; }
  }
});
t('海の島々：北の島のあと、1 つずつ橋を作って開き、開いた日に木と岩が置かれる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-isles-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--demo', '--start', '2026-11-01');
  const inbox = path.join(dir, 'inbox.json');
  let world, state;
  for (let d = 1; d <= 16; d++) {
    fs.writeFileSync(inbox, JSON.stringify({ followers: 5000 }));
    node('tools/sim.js', '--inbox', inbox);
    state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    world = STORE.readWorld(dir);
    assert.ok(Object.values(state.expansion || {}).filter((e) => !e.built).length <= 1, '同時に作る橋は 1 つ（' + d + ' 日目）');
    for (const isl of world.islands.filter((i) => i.look && i.open === state.day)) assert.ok(world.trees.some((t) => t.state === 'tree' && ISX.shoreDist(isl, t.x, t.z) > 0), '開いた日に木が置かれる ' + isl.id);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const opened = world.islands.filter((i) => i.look && i.open);
  assert.ok(ISX.isOpen(world.islands.find((i) => i.id === 'north')) && opened.length >= 1, '北の島のあと海の島も開く ' + opened.map((i) => i.id));
  for (const isl of opened) {
    const br = world.bridges.find((b) => b.to === isl.id);
    assert.ok(br.built === isl.open, '橋ができた日に開く ' + isl.id);
    assert.ok(ISX.isOpen(world.islands.find((i) => i.id === (br.from || 'main'))), '元の島が先に開いている ' + isl.id);
    for (const o of [...world.trees, ...world.rocks]) if (ISX.shoreDist(isl, o.x, o.z) > -1) assert.ok(ISX.shoreDist(isl, o.x, o.z) > 2, '木と岩は岸の内側 ' + isl.id);
  }
});
t('前の広い平地の world.json（島なし）も、今までどおり読める・陸と海の決まりも前と同じ', () => {
  const w = { size: 220, seaZ: 34, trees: [], rocks: [] };
  assert.ok(ISX.onLand(w, 50, 20) && !ISX.onLand(w, 0, 40), '南の seaZ より先は海');
  assert.ok(ISX.reachable(w, -90, -90), '前の形はどこでも行ける');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-legacy-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo', '--legacy'], { env });
  execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '3'], { env });
  const lw = STORE.readWorld(dir);
  assert.ok(!lw.islands && lw.seaZ === 34 && lw.size === 220, '前の形のまま');
  assert.ok(lw.trees.length > 300, '前の広さの木');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('作り直し（--keep-villagers）：住んでいる人は印のまま残り、持ち主は入らず、0 日目の島ですぐ暮らす', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-keep-'));
  const cfg = liveCfg();
  cfg.joinExclude = ['owner_acct'];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify([
    { key: 'k0wner0000', igId: 'i0', name: 'owner_acct', userHash: 'u0', skin: 1, joined: '2026-11-01', joinedDay: 1, source: 'comment', hidden: false, display: 'owner_acct' },
    { key: 'k1villager', igId: 'i1', name: 'someone_1', userHash: 'u1', skin: 42, joined: '2026-11-02', joinedDay: 2, source: 'comment', startTool: 'pickaxe', hidden: false, display: 'someone_1' },
  ]));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--keep-villagers'], { env });
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const life = STORE.readLife(dir), w = STORE.readWorld(dir);
  assert.deepStrictEqual(vs.map((v) => v.key), ['k1villager'], '持ち主は入らない');
  assert.ok(vs[0].igId === 'i1' && vs[0].userHash === 'u1' && vs[0].skin === 42 && vs[0].joinedDay === 0, '印・スキンはそのまま、0 日目の人');
  assert.strictEqual(st.day, 0);
  assert.ok(w.islands && !w.buildings.length, '新しい小さな島');
  assert.ok(life.k1villager && life.k1villager.diary.length === 1 && life.k1villager.inv.some((s) => s && s.item === 'wood_pickaxe'), 'すぐ暮らし始める（日記・最初の道具）');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--gate'], { env, encoding: 'utf8' });
  assert.ok(/0 日目/.test(out) && JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).day === 0, 'daily では 0 日目のまま');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 拠点の場所の投票（0 日目に A/B/C、1 日目に決まる） ----------
const BASE = require('../tools/base');
t('拠点の投票：0 日目は候補 A/B/C が陸の上に出て、チェスト・たき火・整地の草はまだない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-base0-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js')], { env });
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), w = STORE.readWorld(dir);
  const bv = st.votes.find((v) => v.kind === 'base');
  assert.ok(bv && bv.options.length === 3 && bv.question === '拠点はどこにする？', '拠点の投票が開いている');
  assert.deepStrictEqual(bv.options.map((o) => o.key), ['A', 'B', 'C']);
  assert.ok(!w.chest.day && !w.buildings.length && !(w.debris || []).length, 'チェスト・建物・整地の草はまだない');
  const m = w.islands[0];
  for (const o of bv.options) {
    assert.ok(ISX.shoreDist(m, o.x, o.z) >= 15, `${o.key} ${o.name} は岸から 15 以上（${ISX.shoreDist(m, o.x, o.z).toFixed(1)}。A は砂浜のそばなので 20 より近い）`);
    assert.ok(!w.trees.some((t) => Math.hypot(t.x - o.x, t.z - o.z) < 5) && !w.rocks.some((r) => Math.hypot(r.x - o.x, r.z - o.z) < 5), `${o.key} の旗のまわりは空いている`);
    assert.ok(Math.hypot(o.x - w.pond.x, o.z - w.pond.z) > w.pond.r + 10.5, `${o.key} の広場が池にかからない`);
    // そこに決まったら、家や建物の区画が十分ある
    const w2 = JSON.parse(JSON.stringify(w));
    BASE.applyBase(w2, o, { seed: 'x', key: o.key, name: o.name });
    const mp = w2.plots.filter((p) => !p.island);
    assert.ok(mp.length >= 16, `${o.key} のまわりの区画 ${mp.length}`);
    for (const p of mp) assert.ok(ISX.onLand(w2, p.x, p.z, 8, { open: false }) && Math.hypot(p.x - o.x, p.z - o.z) < 28, '区画は拠点のまわりの陸の上');
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(bv.options[i].x - bv.options[j].x, bv.options[i].z - bv.options[j].z) >= 20, '候補どうしは離れている');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).some((h) => h.kind === 'base' && /拠点の場所の投票が始まった/.test(h.text)), '歴史に残る');
  // 見本（--demo）は今までどおり島のまん中に拠点
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
  assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).votes.length && STORE.readWorld(dir).debris.length, '見本は拠点の投票なし');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('拠点の投票：1 人 1 票（最後のコメント）・持ち主は数えない・「Ａ」「a」「浜辺」も読む・2 つ書いたら数えない', () => {
  const cfg = liveCfg();
  cfg.joinExclude = ['owner_b'];
  // needPost：投票の投稿の URL を貼るまでは数えない
  cfg.votePostUrl = '';
  { const st0 = { votes: [] }; const v0 = BASE.openBaseVote(st0, cfg, new Date('2026-11-27T10:00:00+09:00'));
    BASE.tallyBase(v0, { inbox: { voteComments: [{ from: { id: '1', username: 'aa' }, text: 'A', timestamp: '2026-11-27T11:00:00+09:00' }] }, config: { ...cfg, baseVote: { ...cfg.baseVote, needPost: true } }, now: new Date('2026-11-27T22:00:00+09:00') });
    assert.deepStrictEqual(v0.votes, { A: 0, B: 0, C: 0 }, 'URL を貼るまで数えない'); assert.ok(v0.waiting); }
  cfg.votePostUrl = 'https://www.instagram.com/p/TEST/';
  const state = { votes: [] };
  const v = BASE.openBaseVote(state, cfg, new Date('2026-11-27T10:00:00+09:00'));
  const c = (id, u, text, h) => ({ from: { id, username: u }, text, timestamp: `2026-11-27T${String(h).padStart(2, '0')}:00:00+09:00` });
  const inbox = { owner: 'owner_a', voteComments: [
    c('1', 'aa', 'Ａ', 11), c('2', 'bb', 'a がいい', 11), c('3', 'cc', '浜辺の近くがいい！', 12), c('4', 'dd', '池', 12),
    c('5', 'ee', 'B', 12), c('5', 'ee', 'C にする', 13), // 書き直した人は最後だけ
    c('6', 'ff', 'BとCで迷う', 13), // 2 つは数えない
    c('7', 'owner_a', 'C', 13), c('8', 'Owner_B', 'C', 13), // 持ち主（inbox.owner・joinExclude）は数えない
    c('9', 'gg', '森の入口', 23), c('10', 'hh', 'A', 9), // 0 時より前は数えない（9 時は数える）
  ] };
  BASE.tallyBase(v, { inbox, config: cfg, now: new Date('2026-11-27T22:00:00+09:00') });
  assert.deepStrictEqual(v.votes, { A: 4, B: 1, C: 1 }, '23 時のコメントは「今」より後なので、まだ数えない');
  assert.strictEqual(v.voters, 6);
  BASE.tallyBase(v, { inbox, config: cfg, now: new Date('2026-11-28T06:00:00+09:00') });
  assert.deepStrictEqual(v.votes, { A: 4, B: 1, C: 2 });
  assert.strictEqual(P.parseChoice('浜辺', BASE.wordsOf(v, cfg)), 'A');
  assert.strictEqual(P.parseChoice('浜辺と池', BASE.wordsOf(v, cfg)), null);
  // 同点・票なし：fallback（B）がその中にあれば B、なければ A→B→C の順
  assert.deepStrictEqual(BASE.winnerOf({ votes: { A: 0, B: 0, C: 0 } }, cfg), { key: 'B', how: 'none' });
  assert.deepStrictEqual(BASE.winnerOf({ votes: { A: 3, B: 3, C: 1 } }, cfg), { key: 'B', how: 'tie' });
  assert.deepStrictEqual(BASE.winnerOf({ votes: { A: 3, B: 1, C: 3 } }, cfg), { key: 'A', how: 'tie' });
  assert.deepStrictEqual(BASE.winnerOf({ votes: { A: 1, B: 2, C: 5 } }, cfg), { key: 'C', how: 'win' });
});
t('拠点の投票：1 日目にする朝に決まり、そこにチェスト・たき火・広場・区画・テントが移る（票なしは決めておいた場所）', () => {
  const run = (voteComments) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-base1-'));
    const cfg = liveCfg();
    cfg.startAt = null; cfg.joinExclude = ['town_owner2'];
    cfg.votePostUrl = 'https://www.instagram.com/p/TEST/'; // needPost：URL を貼った後の投票として試す
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
    const env = { ...process.env, TOWN_DATA: dir };
    const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
    node('tools/init.js', '--seed', 'bt', '--start', '2026-11-01');
    fs.mkdirSync(path.join(dir, 'inbox'));
    const inbox = path.join(dir, 'inbox', 'instagram.json');
    const now = new Date();
    const ts = (min) => new Date(now.getTime() - min * 60e3).toISOString();
    const cm = (id, u, text, min) => ({ from: { id, username: u }, text, timestamp: ts(min) });
    fs.writeFileSync(inbox, JSON.stringify({ owner: 'town_owner', joinComments: [cm('91', 'kaito_a', '住みたい ピッケル', 30), cm('92', 'mio_b', '住みたい 釣り', 30)], voteComments }));
    node('tools/join.js');
    const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const live = read('state.json').votes.find((v) => v.kind === 'base');
    node('tools/sim.js', '--gate', '--start');
    const out = { st: read('state.json'), w: STORE.readWorld(dir), life: STORE.readLife(dir), hist: read('history.json'), live, cfg };
    // 何日か進めても、建物は拠点のまわりに建つ
    node('tools/sim.js', '--days', '12');
    out.w12 = STORE.readWorld(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  };
  const c = (id, u, text) => ({ from: { id, username: u }, text, timestamp: new Date(Date.now() - 20 * 60e3).toISOString() });
  const r = run([c('1', 'a1', 'C'), c('2', 'a2', '森'), c('3', 'a3', 'ｃ'), c('4', 'a4', 'A'), c('5', 'town_owner', 'A'), c('6', 'town_owner2', 'A'), c('7', 'a7', 'A')]);
  assert.ok(r.live && r.live.votes.C === 3 && r.live.votes.A === 2, '0 日目の受付（join.js）で票を数える（持ち主は数えない）');
  const C = r.cfg.baseVote.candidates[2];
  assert.strictEqual(r.st.day, 1);
  assert.ok(!r.st.votes.some((v) => v.kind === 'base'), '拠点の投票は締まった');
  assert.ok(r.st.base && r.st.base.key === 'C' && r.st.base.votes.C === 3, '票の多い C に決まった');
  assert.ok(r.w.square.x === C.x && r.w.square.z === C.z && r.w.base.key === 'C', '広場は C の場所');
  assert.ok(Math.hypot(r.w.chest.x - C.x, r.w.chest.z - C.z) < 7 && r.w.chest.day === 1, 'チェストは拠点に、1 日目に置く');
  assert.ok(Math.hypot(r.w.campfire.x - C.x, r.w.campfire.z - C.z) < 6, 'たき火（テントのまわり）も拠点に');
  assert.ok(!r.w.trees.some((t) => !t.gone && t.state === 'tree' && Math.hypot(t.x - C.x, t.z - C.z) < 10), '拠点のまわりの木はどけた');
  assert.ok(r.hist.some((h) => h.type === 'base' && /拠点が「C 森の入口」に決まった（A 2票・B 0票・C 3票/.test(h.text)), '歴史：' + (r.hist.find((h) => h.type === 'base') || {}).text);
  for (const L of Object.values(r.life)) assert.ok(L.diary.some((d) => d.day === 1 && /拠点が森の入口に決まった/.test(d.text)), 'みんなの日記に残る');
  const where = r.st.votes.find((v) => v.kind === 'where');
  assert.ok(where && r.st.votes.some((v) => v.kind === 'what'), '「何を」「どこに」の投票はそのあと開く');
  for (const o of where.options) assert.ok(Math.hypot(o.x - C.x, o.z - C.z) < 30, '建てる場所の候補は拠点のまわり ' + o.name);
  const mp = r.w.plots.filter((p) => !p.island);
  assert.ok(mp.every((p) => Math.hypot(p.x - C.x, p.z - C.z) < 28), '区画は拠点のまわり');
  assert.ok(Date.parse(r.st.votes.find((v) => v.kind === 'what').opensAt) >= Date.parse(r.st.base.closesAt) - 1000, '拠点の票は「何を」に数えない');
  for (const b of r.w12.buildings) assert.ok(b.plot === 'ring' || b.island || Math.hypot(b.x - C.x, b.z - C.z) < 30 || /coast/.test(b.plot), '建物は拠点のまわり ' + b.id);
  // 票がない時：決めておいた場所（config の fallback ＝ B）
  const r0 = run(null);
  const B = r0.cfg.baseVote.candidates[1];
  assert.ok(r0.st.base.key === 'B' && r0.st.base.none && r0.w.square.x === B.x, '票なしは B');
  assert.ok(r0.hist.some((h) => h.type === 'base' && /票が入らなかった/.test(h.text)), '歴史にそう書く');
});
t('拠点の投票：config の until を過ぎたら、0 日目のうちに受付（join.js）で決まる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-base2-'));
  const cfg = liveCfg();
  cfg.baseVote.until = '2099-01-01 05:00';
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js');
  fs.mkdirSync(path.join(dir, 'inbox'));
  const inbox = path.join(dir, 'inbox', 'instagram.json');
  fs.writeFileSync(inbox, JSON.stringify({ joinComments: [], voteComments: [{ from: { id: '1', username: 'x1' }, text: '浜辺', timestamp: new Date().toISOString() }, { from: { id: '2', username: 'x2' }, text: 'A', timestamp: '2099-01-01T06:00:00+09:00' }] }));
  node('tools/join.js');
  let st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.ok(st.votes.some((v) => v.kind === 'base') && st.votes[0].votes.A === 1, 'まだ締め切り前');
  node('tools/join.js', '--now', '2099-01-01T07:00:00+09:00');
  st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const w = STORE.readWorld(dir);
  assert.ok(st.day === 0 && st.base && st.base.key === 'A' && st.base.votes.A === 1, '締め切りのあとのコメントは数えず、A に決まる');
  assert.ok(w.square.x === cfg.baseVote.candidates[0].x && !w.chest.day, '拠点は決まり、チェストは 1 日目に置く');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- りんごの木 ----------
t('りんごの木：木のおよそ 10 本に 1 本（場所で決まる・新しい島も）', () => {
  const TMa = require('../js/tilemap.js');
  let n = 0, a = 0;
  for (let j = -100; j < 100; j++) for (let i = -100; i < 100; i++) { n++; const tr = TMa.plainTree(i, j); if (tr.fruit === 'apple') a++; assert.deepStrictEqual(TMa.plainTree(i, j), tr, '同じマスは毎回同じ'); }
  assert.ok(a / n > 0.09 && a / n < 0.11, `マス全体の割合 ${(a / n).toFixed(3)}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-apple0-'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js')], { env });
  const w = STORE.readWorld(dir), ap = w.trees.filter((x) => x.fruit === 'apple');
  assert.ok(w.trees.length > 50 && ap.length / w.trees.length > 0.05 && ap.length / w.trees.length < 0.17, `島の木 ${w.trees.length} 本のうち りんご ${ap.length} 本`);
  assert.ok(ap.every((x) => !x.appleWait && x.state === 'tree'), 'はじめは全部実っている');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('りんごの木：前の形の world.json（fruit を持たない）も読める。そのまま 10 本に 1 本がりんごの木になる', () => {
  const TMa = require('../js/tilemap.js');
  const trees = [];
  for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i += 2) trees.push({ ...TMa.plainTree(i, j), ...(i % 6 === 0 ? { size: 1.1 } : {}) });
  const old = TMa.encodeWorld({ size: 120, seaZ: 200, trees, rocks: [], bushes: [], buildings: [], fields: [] });
  for (const k in old.objs) delete old.objs[k].fruit; // 前の版は fruit を書かない
  const w = TMa.decodeWorld(JSON.parse(JSON.stringify(old)));
  assert.strictEqual(w.trees.length, trees.length, '木の数は同じ');
  assert.deepStrictEqual(w.trees.map((x) => x.id).sort(), trees.map((x) => x.id).sort(), '木の id も同じ');
  const ap = w.trees.filter((x) => x.fruit === 'apple').length;
  assert.ok(ap > 0 && ap < trees.length * 0.2, `りんごの木 ${ap} / ${trees.length}`);
  // もう一度保存しても、りんごの木のぶんで objs は増えない（場所から決まるので、書き足しは要らない）
  const again = TMa.encodeWorld(w);
  assert.deepStrictEqual(again.objs, TMa.encodeWorld({ size: 120, seaZ: 200, trees, rocks: [], bushes: [], buildings: [], fields: [] }).objs);
  // 本物の data/world.json も読める（読むだけ）
  const live = STORE.readWorld(path.join(ROOT, 'data'));
  assert.ok(Array.isArray(live.trees) && live.trees.every((x) => x.fruit === undefined || x.fruit === 'apple'));
});
t('りんごの木：食べ物の村人がもぐ・りんごはチェストへ・日記「りんごの木を見つけた」・もいだ木は regrowDays 日でまた実る', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-apple-'));
  const cfg = liveCfg();
  const RG = cfg.apples.regrowDays;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
  const pickedOn = {}; // 木 → もいだ日
  let apples = 0, chestApple = 0;
  for (let d = 1; d <= 9; d++) {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '1'], { env });
    const life = STORE.readLife(dir), w = STORE.readWorld(dir), st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    const today = new Set();
    for (const L of Object.values(life)) for (const c of HR.decodeHours(L.hours)) if (c.startsWith('ga:')) today.add(c.slice(3));
    assert.ok(today.size <= cfg.apples.perDay, '1 日に perDay 本まで');
    for (const id of today) {
      const tr = w.trees.find((x) => x.id === id);
      assert.ok(tr && tr.fruit === 'apple', 'もいだのはりんごの木 ' + id);
      if (tr.state === 'tree') assert.strictEqual(tr.appleWait, RG - 1, 'もいだ日の夜は、あと regrowDays-1 日');
      for (const d0 of pickedOn[id] || []) assert.ok(st.day - d0 >= RG, `${id} は ${d0} 日目にもいで、${st.day} 日目にまたもいだ（早すぎる）`);
      (pickedOn[id] = pickedOn[id] || []).push(st.day);
    }
    for (const L of Object.values(life)) apples = Math.max(apples, (L.items || {}).apple || 0);
    chestApple = Math.max(chestApple, (st.store || {}).apple || 0);
  }
  const ids = Object.keys(pickedOn);
  assert.ok(ids.length >= 2, 'りんごをもいだ木がある');
  assert.ok(ids.some((id) => pickedOn[id].length >= 2), '実がまたなって、同じ木からもう一度もいだ');
  assert.ok(apples > 0, 'もいだりんごが村人の記録にある');
  assert.ok(chestApple > 0, 'りんごがチェストに入った');
  const life = STORE.readLife(dir);
  const finders = Object.values(life).filter((L) => L.diary.some((e) => /りんごの木を見つけた/.test(e.text)));
  assert.ok(finders.length >= 1, '日記に「りんごの木を見つけた」');
  for (const L of finders) assert.strictEqual(L.diary.filter((e) => /りんごの木を見つけた/.test(e.text)).length, 1, '見つけたと書くのは 1 回だけ');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).some((x) => /りんごの木を見つけた/.test(x.text)), '町の歴史にも');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('りんごの木：切ると原木（＋なっていたりんご）。実の数え方はほかの木と同じ', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/sim.js'), 'utf8');
  assert.ok(/o\.fruit === 'apple' && AP/.test(src) && /AP\.chop/.test(src), '切った時にりんごが落ちる');
  const cfg = liveCfg().apples;
  assert.ok(cfg.note && cfg.pick[0] >= 1 && cfg.pick[1] >= cfg.pick[0] && cfg.regrowDays >= 1 && cfg.perDay >= 1, 'config.json の apples');
  assert.strictEqual(HR.CODE_ACTION.ga, 'apple'); assert.ok(HR.WORK.has('apple')); assert.ok(HR.hourText({ action: 'apple' }).includes('りんご'));
});

// ---------- 「住みたい」の誕生日・好きな食べ物、ベッドの大きさと家の中のベッド ----------
t('住みたい：誕生日の読み取り（いろいろな書き方・全角・空白・「誕生日」のあるなし・道具や食べ物といっしょ）', () => {
  const forms = ['3/14', '03/14', '3-14', '3.14', '3月14日', '３月１４日', '3月14', '0314', '誕生日3/14', '誕生日は3月14日', '3/14生まれ', '3月14日生まれ',
    '３／１４', '０３１４', '3 / 14', '3 月 14 日', 'たんじょうび3/14', 'たんじょうびは 3.14', '誕生日 0314', '誕生日は ３月１４日', '2000/3/14'];
  for (const f of forms) for (const s of [f, '住みたい ' + f, '住みたい ピッケル ' + f + ' りんご', '住みたい 好きな食べ物魚 ' + f + ' 釣り', f + ' 住みたい 斧']) assert.strictEqual(P.parseBirthday(s), '03-14', s);
  const ok1 = { '住みたい ピッケル 誕生日12月25日 魚': '12-25', '住みたい 12-03': '12-03', '住みたい 誕生日は0229': '02-29', '住みたい 誕生日 7.7': '07-07', '住みたい 1/5生まれ': '01-05' };
  for (const [k, v] of Object.entries(ok1)) assert.strictEqual(P.parseBirthday(k), v, k);
  // ありえない日・書いていない時は読まない
  for (const k of ['住みたい', '住みたい ピッケル', '住みたい りんご', '13/40', '住みたい 13/40', '住みたい 2月30日', '住みたい 13/1', '住みたい 0/5', '住みたい 1340', '住みたい 4月31日', '住みたい 3.14.15']) assert.strictEqual(P.parseBirthday(k), null, k);
  // 道具と食べ物もいっしょに読める
  const cfg = liveCfg();
  for (const s of ['住みたい ピッケル 3/14 りんご', '住みたい 0314 ピッケル りんご', '住みたい りんご 誕生日は3月14日 ピッケル']) {
    assert.strictEqual(P.parseStartTool(s, cfg.startTools), 'pickaxe', s); assert.strictEqual(P.parseFood(s), 'りんご', s); assert.strictEqual(P.parseBirthday(s), '03-14', s);
  }
});
t('住みたい：好きな食べ物の読み取り（町の食べ物・言いかえ・書いた言葉）', () => {
  const ok1 = { '住みたい 誕生日3月14日 好きな食べ物りんご': 'りんご', '住みたい 3/14 リンゴ': 'りんご', '住みたい ピッケル 誕生日12月25日 魚': '魚', '住みたい 釣り 刺身すき': '魚', '住みたい ベリー': '木の実', '住みたい 好物は卵焼き': 'たまご', '住みたい 好きな食べ物はカレーです': 'カレー', '住みたい 好きな食べ物：ﾗｰﾒﾝ': 'ラーメン', '住みたい パン': 'パン' };
  for (const [k, v] of Object.entries(ok1)) assert.strictEqual(P.parseFood(k), v, k);
  // 書いていない・知らない言葉だけ・悪い言葉・長すぎは読まない（自動の食べ物になる）
  for (const k of ['住みたい', '住みたい ピッケル', '住みたい よろしく', '住みたいですし', 'クリスマスに住みたい', '住みたい 好きな食べ物 バーカ', '住みたい 好きな食べ物 あいうえおかきくけこさしす', '住みたい 好きな食べ物 http://x.example']) assert.strictEqual(P.parseFood(k), null, k);
});
t('住みたい：道具・誕生日・食べ物をいっしょに書ける（あとのコメントが勝つ・書いていない物は前のまま）', () => {
  const cfg = liveCfg();
  const cm = (id, text, ts) => ({ from: { id, username: 'u' + id }, text, timestamp: ts });
  const regs = P.registrationsFrom([
    cm('1', '住みたい ピッケル 誕生日12月25日 魚', '2026-11-01T00:00:00Z'),
    cm('2', '住みたい 3/14 りんご', '2026-11-01T00:00:00Z'),
    cm('2', '住みたい 釣り', '2026-11-02T00:00:00Z'),
    cm('3', '住みたい', '2026-11-01T00:00:00Z'),
  ], '住みたい', cfg.startTools);
  const by = Object.fromEntries(regs.map((r) => [r.igId, r]));
  assert.deepStrictEqual([by['1'].startTool, by['1'].birthday, by['1'].food], ['pickaxe', '12-25', '魚']);
  assert.deepStrictEqual([by['2'].startTool, by['2'].birthday, by['2'].food], ['fishing_rod', '03-14', 'りんご']);
  assert.ok(!by['3'].birthday && !by['3'].food && !by['3'].startTool);
});
t('住みたい：1 つのコメントにまとめて（1 行・改行・名札つき・MBTI）', () => {
  const cfg = liveCfg();
  const pc = (s) => P.parseCommentProfile(s, { word: '住みたい', startTools: cfg.startTools });
  const one = (s, bd, food, mbti, at) => { const p = pc(s); assert.deepStrictEqual([p.birthday, p.food, p.mbti, p.mbtiAT], [bd, food, mbti, at], s); };
  one('住みたい ピッケル 12月11日 リンゴ', '12-11', 'りんご', undefined, undefined);
  one('住みたい ピッケル 12/11 りんご INFP', '12-11', 'りんご', 'INFP', undefined);
  one('住みたい\nピッケル\n12/11\nりんご\nINFP', '12-11', 'りんご', 'INFP', undefined);
  one('住みたい、ピッケル、12/11、カレー、enfp-t', '12-11', 'カレー', 'ENFP', 'T');
  one('住みたい ピッケル 12/11 カレー', '12-11', 'カレー', undefined, undefined);
  one('住みたい 誕生日 12/11 好きな食べ物 ラーメン MBTI INFP-A', '12-11', 'ラーメン', 'INFP', 'A');
  one('住みたい ＩＮＴＪ', undefined, undefined, 'INTJ', undefined);
  one('住みたい infpt 3/14', '03-14', undefined, 'INFP', 'T');
  one('住みたい ピッケル 12/11 よろしく', '12-11', undefined, undefined, undefined); // あいさつは食べ物にしない
  one('住みたい ピッケル よろしくお願いします カレー', undefined, 'カレー', undefined, undefined); // あいさつを除いて残った 1 語
  one('住みたい カレー', undefined, 'カレー', undefined, undefined); // 町にない物もそのまま（日付・MBTI がなくてもよい）
  one('住みたい12/11カレー', '12-11', 'カレー', undefined, undefined); // 続けて書いても日付・住みたいで区切る
  one('住みたいピッケル12月11日カレー', '12-11', 'カレー', undefined, undefined);
  one('住みたいピッケル12月11日カレーINFP', '12-11', 'カレー', 'INFP', undefined);
  one('住みたい斧ラーメン', undefined, 'ラーメン', undefined, undefined);
  for (const s of ['住みたい', '住みたいです！', 'わたしも住みたい', 'ぜひ住みたい！', '島に住みたい', '住みたい よろしく', '住みたい ピッケル 楽しそう', '住みたい たろうさん', '住みたい 😊✨', '住みたい 12時に見た', '住みたい http://x.example/curry', '住みたい あいうえおかきくけこさしす', '住みたい ピッケル です'])
    assert.strictEqual(pc(s).food, undefined, s);
  one('住みたい 12/11 カレー ラーメン', '12-11', undefined, undefined, undefined); // 2 つ残ったらどちらか分からない
  one('住みたい 12時に見た', undefined, undefined, undefined, undefined);
  one('住みたい https://example.com/ENTJ/3/14', undefined, undefined, undefined, undefined); // URL の中は読まない
  one('住みたい #INFP @entj_cat', undefined, undefined, undefined, undefined);
  one('住みたい 12/11 バーカ', '12-11', undefined, undefined, undefined); // 悪い言葉
  one('住みたい 12/11 🍎✨ りんご', '12-11', 'りんご', undefined, undefined);
  for (const s of ['INFOMATION', 'ENTJS', 'XNFP', 'information']) assert.strictEqual(P.parseMbti(s), null, s);
  // config.mbtiOn が false の時は MBTI を読まない
  assert.strictEqual(P.parseCommentProfile('住みたい INFP', { mbti: false }).mbti, undefined);
  const regs = P.registrationsFrom([{ from: { id: '1', username: 'a' }, text: '住みたい\n斧\n12/11\nりんご\nINFP', timestamp: '2026-11-01T00:00:00Z' }], '住みたい', cfg.startTools);
  assert.deepStrictEqual([regs[0].startTool, regs[0].birthday, regs[0].food, regs[0].mbti], ['axe', '12-11', 'りんご', 'INFP']);
});
t('住みたい：住んだあとのコメントでプロフィールを変える（道具は変えない・あとが勝つ・古いコメントで戻さない）', () => {
  const cfg = liveCfg();
  const o = { word: '住みたい', startTools: cfg.startTools };
  const cm = (id, text, ts) => ({ from: { id, username: 'u' + id }, text, timestamp: ts });
  const vs = [];
  const c1 = [cm('1', '住みたい ピッケル', '2026-11-01T00:00:00Z')];
  for (const r of P.registrationsFrom(c1, '住みたい', cfg.startTools)) P.upsertVillager(vs, { ...r, joined: 'x', joinedDay: 1, source: 'comment' }, new Set());
  P.applyCommentProfiles(vs, c1, o); P.fillJoinProfile(vs[0]);
  const v = vs[0];
  assert.strictEqual(v.startTool, 'pickaxe');
  assert.ok(!v.mbti, 'MBTI は自動で入れない');
  // あとから：名札つき・MBTI だけ・住みたい つき
  const c2 = [...c1, cm('1', '誕生日 12/11', '2026-11-02T00:00:00Z'), cm('1', 'MBTI ENFP', '2026-11-02T01:00:00Z'), cm('1', '好きな食べ物 カレー', '2026-11-02T02:00:00Z')];
  assert.ok(P.applyCommentProfiles(vs, c2, o));
  assert.deepStrictEqual([v.birthday, v.mbti, v.profile.food, v.startTool], ['12-11', 'ENFP', 'カレー', 'pickaxe']);
  const c3 = [...c2, cm('1', '住みたい 釣り 3/14 りんご', '2026-11-03T00:00:00Z'), cm('1', 'INFP-T', '2026-11-03T01:00:00Z')];
  P.applyCommentProfiles(vs, c3, o);
  assert.deepStrictEqual([v.birthday, v.profile.food, v.mbti, v.mbtiAT, v.startTool], ['03-14', 'りんご', 'INFP', 'T', 'pickaxe'], '道具は変わらない');
  assert.strictEqual(vs.length, 1, '住み直さない');
  // ログインで直した値は、同じ（古い）コメントを読み直しても戻さない
  v.birthday = '05-05';
  assert.strictEqual(P.applyCommentProfiles(vs, c3, o), 0);
  assert.strictEqual(v.birthday, '05-05');
  // 住んだあとのコメントで、名札のない日付・会話・お祝いは読まない。住んでいない人は何もしない
  P.applyCommentProfiles(vs, [...c3, cm('1', '12/24楽しみ！', '2026-11-04T00:00:00Z'), cm('1', '誕生日おめでとう 1/1', '2026-11-04T01:00:00Z'), cm('1', 'りんごおいしそう', '2026-11-04T02:00:00Z'), cm('1', 'https://x.com/ENTJ', '2026-11-04T03:00:00Z'), cm('9', '誕生日 1/2', '2026-11-04T00:00:00Z')], o);
  assert.deepStrictEqual([v.birthday, v.profile.food, v.mbti, vs.length], ['05-05', 'りんご', 'INFP', 1]);
  // mbtiOn: false なら MBTI は変えない
  P.applyCommentProfiles(vs, [cm('1', 'MBTI ESTJ', '2026-11-05T00:00:00Z')], { ...o, mbti: false });
  assert.strictEqual(v.mbti, 'INFP');
});
t('住みたい：何も書いていない人には、名前から決まった誕生日と町の食べ物（同じ人はいつも同じ・ある値は変えない）', () => {
  const mk = () => { const vs = []; P.upsertVillager(vs, { igId: '55', username: 'kaze', joinedDay: 0, source: 'comment' }, new Set()); return vs[0]; };
  const a = mk(), b = mk();
  assert.ok(/^\d{2}-\d{2}$/.test(a.birthday) && a.birthday === b.birthday, '同じ人は同じ誕生日');
  assert.ok(a.profile.food && a.profile.food === b.profile.food, '同じ人は同じ食べ物');
  assert.ok(P.FOODS.some((f) => f.auto && f.name === a.profile.food), '町にある食べ物');
  // いろいろな人：ありえる日・ばらける
  const days = new Set(), foods = new Set();
  for (let i = 0; i < 60; i++) { const k = 'k' + i, bd = P.autoBirthday(k), [m, d] = bd.split('-').map(Number); assert.ok(m >= 1 && m <= 12 && d >= 1 && d <= 31 && !(m === 2 && d > 28), bd); days.add(bd); foods.add(P.autoFood(k)); }
  assert.ok(days.size > 30 && foods.size >= 5);
  // コメントに書いてあればそれを使う
  const vs = []; const v = P.upsertVillager(vs, { igId: '56', username: 'mizu', joinedDay: 0, source: 'comment', birthday: '03-14', food: 'カレー' }, new Set());
  assert.deepStrictEqual([v.birthday, v.profile.food], ['03-14', 'カレー']);
  // 足すだけ：前からいる人（ryusei01040505 の形）に足す。もう一度でも変わらない。ログインで入れた値は変えない
  const old = { key: '51dd020030', source: 'comment', startTool: 'pickaxe', display: 'x' };
  assert.strictEqual(P.fillJoinProfile(old), true);
  const snap = JSON.stringify(old);
  assert.strictEqual(P.fillJoinProfile(old), false); assert.strictEqual(JSON.stringify(old), snap);
  // あとから誕生日を書いたら、自動の値から書いた値へ。ログインで入れた値（自動と違う値）は、コメントで変えない
  const g = { key: 'g1', source: 'comment', birthday: '01-01', profile: { food: 'うどん' } };
  P.fillJoinProfile(g, { birthday: '05-05', food: 'りんご' });
  assert.deepStrictEqual([g.birthday, g.profile.food], ['01-01', 'うどん']);
  const au = { key: 'g2', source: 'comment' }; P.fillJoinProfile(au); P.fillJoinProfile(au, { birthday: '05-05', food: 'りんご' });
  assert.deepStrictEqual([au.birthday, au.profile.food], ['05-05', 'りんご']);
  // フォロワー一覧から来た人（コメントでない）には入れない
  const fv = []; P.upsertVillager(fv, { username: 'follow_only', joinedDay: 1 }, new Set());
  assert.ok(!fv[0].birthday && !fv[0].profile);
  // ログインのプロフィールで食べ物を書かなくても、前の食べ物は消えない
  const pv = [{ key: 'p1', source: 'comment', profile: { food: 'りんご' } }];
  PR.applyProfiles(pv, { p1: { color: '#112233' } }, {}, FIELDS);
  assert.deepStrictEqual(pv[0].profile, { color: '#112233', food: 'りんご' });
});
t('住みたい：join.js で入った人に誕生日・食べ物が入り、前からいる人にも足される', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-bday-'));
  const cfg = liveCfg();
  cfg.startAt = null;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'bd', '--start', '2026-11-01');
  // 前からいる人（誕生日・食べ物なし）
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify([{ key: '51dd020030', igId: P.igHash('8000'), name: 'old_one', userHash: P.userHash('old_one'), skin: 1, joined: '2026-11-26', joinedDay: 0, source: 'comment', startTool: 'pickaxe' }]));
  fs.mkdirSync(path.join(dir, 'inbox'));
  const cm = (id, u, text) => ({ from: { id, username: u }, text, timestamp: '2026-11-27T01:00:00Z' });
  fs.writeFileSync(path.join(dir, 'inbox', 'instagram.json'), JSON.stringify({ joinComments: [cm('8001', 'a_san', '住みたい 誕生日3月14日 好きな食べ物りんご'), cm('8002', 'b_san', '住みたい ピッケル 誕生日12月25日 魚'), cm('8003', 'c_san', '住みたい')] }));
  node('tools/join.js', '--now', '2026-11-27T10:00:00+09:00');
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  const by = Object.fromEntries(vs.map((v) => [v.name, v]));
  assert.deepStrictEqual([by.a_san.birthday, by.a_san.profile.food], ['03-14', 'りんご']);
  assert.deepStrictEqual([by.b_san.birthday, by.b_san.profile.food, by.b_san.startTool], ['12-25', '魚', 'pickaxe']);
  assert.deepStrictEqual([by.c_san.birthday, by.c_san.profile.food], [P.autoBirthday(by.c_san.key), P.autoFood(by.c_san.key)]);
  assert.deepStrictEqual([by.old_one.birthday, by.old_one.profile.food, by.old_one.startTool], [P.autoBirthday('51dd020030'), P.autoFood('51dd020030'), 'pickaxe'], '前からいる人にも足す');
  // 称号：いちばん最初に住んだ人（old_one）だけに「はじまりの村人」。歴史と日記に 1 回だけ
  const titleCheck = () => {
    const vs2 = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
    assert.deepStrictEqual(vs2.filter((v) => (v.titles || []).length).map((v) => [v.name, v.titles]), [['old_one', ['first_villager']]]);
    const h = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).filter((x) => x.type === 'title');
    assert.strictEqual(h.length, 1); assert.strictEqual(h[0].text, 'old_one に称号『はじまりの村人』がおくられた。');
    const dy = STORE.readLife(dir)['51dd020030'].diary;
    assert.strictEqual(dy.filter((e) => e.text.includes('称号「はじまりの村人」をもらった')).length, 1, '本人の日記に 1 回');
  };
  titleCheck();
  node('tools/join.js', '--now', '2026-11-27T10:15:00+09:00'); titleCheck(); // もう一度動かしても増えない
  node('tools/sim.js', '--days', '2'); titleCheck(); // 日が進んでも、ほかの人にはおくらない
  fs.rmSync(dir, { recursive: true, force: true });
});
t('称号：config の一覧・最初に住んだ 1 人だけ（来た順）・すでにおくった称号はおくらない', () => {
  const TT = require('../tools/titles');
  const cfg = liveCfg();
  const first = cfg.titles.list.find((x) => x.id === 'first_villager');
  assert.ok(cfg.titles.note && first && first.name === 'はじまりの村人' && first.desc === 'はじまり島に最初に住んだ人' && first.auto === 'first');
  const mk = () => ({ config: cfg, villagers: [{ key: 'b', display: 'B', joinedDay: 1, joined: '2026-11-02' }, { key: 'a', display: 'A', joinedDay: 0, joined: '2026-11-26' }, { key: 'c', display: 'C', joinedDay: 0, joined: '2026-11-26' }, { key: 'w', display: 'W', joinedDay: 5 }], life: { a: { diary: [{ day: 1, date: 'x', text: 'きょう。' }] }, b: { diary: [] }, c: { diary: [] } }, history: [] });
  const S = mk();
  const r = TT.awardTitles(S, { day: 1, date: 'x' });
  assert.deepStrictEqual(r.map((x) => x.v.key), ['a'], '0 日目に来た人のうち、先に来た人');
  assert.deepStrictEqual(S.villagers.find((v) => v.key === 'a').titles, ['first_villager']);
  assert.strictEqual(S.life.a.diary.length, 1); assert.ok(S.life.a.diary[0].text.endsWith('称号「はじまりの村人」をもらった（はじまり島に最初に住んだ人）。'), '今日の日記の後ろ');
  assert.strictEqual(TT.awardTitles(S, { day: 2, date: 'y' }).length, 0, '2 回目はない');
  // 持っていた人が町を出ても、ほかの人にはおくらない
  S.villagers.splice(1, 1); assert.strictEqual(TT.awardTitles(S, { day: 3, date: 'z' }).length, 0);
  // ページの表示（common.js の titleBadges）は説明を title 属性に入れ、文字はエスケープ
  const src = fs.readFileSync(path.join(ROOT, 'js/common.js'), 'utf8');
  assert.ok(/export const titleBadges/.test(src) && /esc\(b\.name/.test(src) && /export function badgeList/.test(src));
  assert.ok(/titleBadges\(v, D\.config, L\)/.test(fs.readFileSync(path.join(ROOT, 'people.html'), 'utf8')), '住人一覧にバッジ');
  assert.ok(/badgeList\(v, D\.config\)/.test(fs.readFileSync(path.join(ROOT, 'js/villager.js'), 'utf8')), '村人ページにバッジ');
  assert.ok(/titleBadges\(v, config, L\)/.test(fs.readFileSync(path.join(ROOT, 'js/town.js'), 'utf8')), '町のカードにバッジ');
});
t('称号バッジ：config の形・絵がある・自動でおくる決まり（1 人 1 回だけ）', () => {
  const TT = require('../tools/titles');
  const cfg = liveCfg();
  const L = cfg.titles.list, ids = L.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id が重ならない');
  const AUTO = ['first', 'count', 'days', 'friends', 'fishRecord', 'bridge', 'home'];
  for (const x of L) {
    assert.ok(/^[a-z0-9_]+$/.test(x.id) && x.name && x.desc, x.id + ' の名前と説明');
    assert.ok(!x.auto || AUTO.includes(x.auto), x.id + ' の auto');
    if (x.auto && x.auto !== 'first') assert.ok(x.how, x.id + ' のもらい方');
    if (['count', 'days', 'friends'].includes(x.auto)) assert.ok(x.n > 0, x.id + ' の n');
    if (x.auto === 'count') assert.ok(x.stat, x.id + ' の stat');
    if (x.img) assert.ok(fs.existsSync(path.join(ROOT, x.img)), x.id + ' の絵 ' + x.img);
  }
  assert.ok(L.length >= 7, '称号は 7 つ以上');
  // 古い形（img・how・n がない称号）でも動く
  assert.strictEqual(TT.awardTitles({ config: { titles: { list: [{ id: 'z', name: 'Z', auto: 'first' }] } }, villagers: [{ key: 'a', display: 'A', joinedDay: 0 }], life: { a: { diary: [] } }, history: [] }, { day: 1, date: 'x' }).length, 1);
  assert.strictEqual(TT.awardTitles({ config: {}, villagers: [], life: {}, history: [] }, { day: 1, date: 'x' }).length, 0, 'titles がない config');
  // 数え方
  assert.strictEqual(TT.statCount({ items: { fish_funa: 3, fish_koi: 2, apple: 9, old_boot: 4 } }, 'items.fish_*'), 5, '* は前が同じ物を足す');
  assert.strictEqual(TT.statCount({ items: { apple: 9 } }, 'items.apple'), 9);
  assert.strictEqual(TT.statCount({}, 'items.apple'), 0);
  assert.strictEqual(TT.statCount({ built: [1, 2] }, 'built'), 2);
  // 自動でおくる
  const mk = () => ({
    config: cfg,
    villagers: [
      { key: 'a', display: 'A', joinedDay: 0, titles: ['first_villager'] },
      { key: 'b', display: 'B', joinedDay: 0 },
      { key: 'c', display: 'C', joinedDay: 20 },
      { key: 'w', display: 'W', joinedDay: 99 },
    ],
    life: {
      a: { diary: [{ day: 30, date: 'x', text: 'きょう。' }], items: { fish_funa: 12, fish_koi: 8, apple: 49 }, home: null },
      b: { diary: [], items: { apple: 50 }, home: 'h1' },
      c: { diary: [], items: { fish_funa: 19, old_boot: 5 } },
      w: { diary: [], items: { apple: 500 } },
    },
    history: [],
    state: { fishing: { top: { fish_koi: [[60, 'c', 3], [50, 'a', 2]] } }, expansion: { north: { crew: ['b'] } } },
    social: { pairs: { 'a|b': { s: 45 }, 'a|c': { s: 25 }, 'a|w': { s: 1 } } },
  });
  const S = mk();
  const got = (k) => (S.villagers.find((v) => v.key === k).titles || []).slice().sort();
  const cfgN = (id) => cfg.titles.list.find((x) => x.id === id);
  // 友だちの数は config の n。ここでは 2 人まで下げて確かめる
  const cfg2 = JSON.parse(JSON.stringify(cfg)); cfg2.titles.list.find((x) => x.id === 'popular').n = 2; S.config = cfg2;
  const r = TT.awardTitles(S, { day: 30, date: 'x' });
  assert.ok(r.length > 0);
  assert.deepStrictEqual(got('a'), ['angler', 'first_villager', 'old_timer', 'popular'].sort(), 'a：魚 20 匹・30 日・友だち 2 人（りんご 49 はまだ）');
  assert.deepStrictEqual(got('b'), ['apple_lover', 'bridge_builder', 'homeowner', 'old_timer'].sort(), 'b：りんご 50・橋・家・30 日');
  assert.deepStrictEqual(got('c'), ['big_catch'], 'c：コイの 1 位（魚は 19 匹で、古いくつは数えない・10 日）');
  assert.deepStrictEqual(got('w'), [], 'まだ住んでいない人にはおくらない');
  assert.ok(cfgN('angler').n === 20 && cfgN('old_timer').n === 30);
  const hs = S.history.filter((h) => h.type === 'title');
  assert.strictEqual(new Set(hs.map((h) => h.title)).size, hs.length, '歴史は称号ごとに 1 行');
  assert.strictEqual(hs.reduce((s, h) => s + h.who.length, 0), r.length, 'もらった人は全員 who に入る');
  assert.strictEqual(hs.find((h) => h.title === 'old_timer').text, 'A、B に称号『古株』がおくられた。', '同じ日の人はまとめる');
  assert.ok(S.life.a.diary[0].text.startsWith('きょう。') && S.life.a.diary[0].text.includes('称号「釣り名人」をもらった'), '今日の日記の後ろに書く');
  // 2 回目はおくらない（同じ日も次の日も）。1 位をとられても、もらった称号はなくならない
  assert.strictEqual(TT.awardTitles(S, { day: 30, date: 'x' }).length, 0, '同じ日にもう一度');
  S.state.fishing.top.fish_koi = [[70, 'b', 31]];
  const r2 = TT.awardTitles(S, { day: 31, date: 'y' });
  assert.deepStrictEqual(r2.map((x) => [x.v.key, x.title.id]), [['b', 'big_catch']], '新しい 1 位にだけ');
  assert.ok(got('c').includes('big_catch'), 'c の大物ハンターは残る');
  assert.strictEqual(TT.awardTitles(S, { day: 32, date: 'z' }).length, 0);
  // state・social がない時（15 分ごとの受付）は、それを使う称号を飛ばす
  const S3 = mk(); delete S3.state; delete S3.social;
  TT.awardTitles(S3, { day: 30, date: 'x' });
  assert.ok(!S3.villagers.some((v) => (v.titles || []).some((id) => ['big_catch', 'bridge_builder', 'popular'].includes(id))));
  assert.ok(S3.villagers.find((v) => v.key === 'b').titles.includes('apple_lover'), '数で決まる称号はおくる');
  // ページ
  const page = fs.readFileSync(path.join(ROOT, 'badges.html'), 'utf8');
  assert.ok(/nav\('badges\.html'\)/.test(page) && /config\.titles/.test(page) && /config\.badges/.test(page), 'バッジのページ');
  assert.ok(/\['badges\.html', 'バッジ'\]/.test(fs.readFileSync(path.join(ROOT, 'js/common.js'), 'utf8')), 'ナビにバッジ');
  assert.ok(/awardTitles\(\{[^}]*state[^}]*social/.test(fs.readFileSync(path.join(ROOT, 'tools/sim.js'), 'utf8')), 'sim は一日の終わりに state と social も渡す');
});
t('ベッド：前より小さい（はば・高さ 75%、長さ 80%）。寝る人の頭はまくら側の板の内側', () => {
  const BD = require('../js/beds.js');
  assert.ok(Math.abs(BD.BED.w - 1.9 * 0.75) < 1e-9 && Math.abs(BD.BED.l - 3.8 * 1.0) < 1e-9 && BD.BED.h < 0.6);
  for (const chibi of [false, true]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const bed = { cx: 10, cz: -4, yaw };
    const s = BD.sleeperOnBed(bed, chibi), len = chibi ? BD.BODY_LEN.chibi : BD.BODY_LEN.normal;
    // 頭のてっぺん＝足から yaw の反対へ体の長さ。まくら側の板（中心から -l/2）より内側で、まくらの上
    const hx = s.x - Math.sin(yaw) * len, hz = s.z - Math.cos(yaw) * len;
    const along = (hx - bed.cx) * Math.sin(yaw) + (hz - bed.cz) * Math.cos(yaw);
    assert.ok(along > -BD.BED.l / 2 + 0.12 && along < -BD.BED.l / 2 + 0.5, '頭はまくら側の板のすぐ内側 ' + along);
  }
  // 部品はベッドの大きさの中
  for (const [w, h, d, x, y, z] of BD.bedParts()) assert.ok(Math.abs(x) + w / 2 <= BD.BED.w / 2 + 1e-9 && Math.abs(z) + d / 2 <= BD.BED.l / 2 + 1e-9);
});
t('ベッド：家ができたら家の中（床の中に並べる）。家がないうちはテントの中（town.js）', () => {
  const BD = require('../js/beds.js');
  const cfg = liveCfg();
  const look = cfg.buildings.house.look;
  for (const rot of [0, Math.PI / 2, Math.PI, 0.6]) {
    const b = { id: 'h1', type: 'house', x: 20, z: 8, rot };
    for (let slot = 0; slot < 4; slot++) {
      const bd = BD.bedInHouse(b, look, slot);
      assert.ok(bd.inside, '家の中');
      for (const c of BD.bedCorners(bd)) assert.ok(BD.insideHouse(c, b, look, 0.05), `ベッドの角が家の壁の中 rot=${rot} slot=${slot}`);
    }
    // 2 人目は 1 人目と重ならない（横に並ぶ）
    const a0 = BD.bedInHouse(b, look, 0), a1 = BD.bedInHouse(b, look, 1);
    assert.ok(Math.hypot(a0.cx - a1.cx, a0.cz - a1.cz) >= BD.BED.w);
  }
  const src = fs.readFileSync(path.join(ROOT, 'js/town.js'), 'utf8');
  assert.ok(/if \(p\.homeB\) \{[\s\S]{0,200}bedInHouse\(p\.homeB/.test(src), '家があれば家の中のベッド');
  assert.ok(/p\.bedAt\.inside \? \{ x: p\.home\.x/.test(src), '家の中のベッドで寝る人は外から見えない（家の扉まで歩いて入る）');
  assert.ok(/filter\(\(p\) => !p\.bedAt\.inside\)/.test(src), '家の中のベッドは描かない');
  assert.ok(/Zz 寝ている/.test(src), '家の上に「寝ている」の札');
});
t('テント：家のない人は大きいテントの中（1 つに perTent 人、maxTents まで）。ベッドはテントか家の中だけ。入れない人はたき火のそば', () => {
  const TN = require('../js/tents.js'), BD = require('../js/beds.js');
  const cfg = liveCfg();
  const { perTent, maxTents } = TN.tentCfg(cfg);
  assert.ok(perTent >= 3 && maxTents >= 1, 'config の tent');
  const vs = Array.from({ length: perTent * maxTents + 3 }, (_, i) => ({ key: 'v' + i }));
  const life = Object.fromEntries(vs.map((v, i) => [v.key, { home: i === 0 ? 'h1' : null, bed: i === 5 ? 1 : 0 }]));
  const one = TN.tentPlan(vs.slice(1, 3), life, cfg);
  assert.strictEqual(one.tents, 1, '人が少なければテントは 1 つ');
  const pl = TN.tentPlan(vs, life, cfg);
  assert.strictEqual(pl.tents, maxTents);
  assert.ok(!pl.slot.v0 && !pl.outside.includes('v0'), '家のある人はテントに入らない');
  assert.deepStrictEqual(pl.slot.v5, { tent: 0, i: 0 }, 'ベッドを持っている人が先');
  assert.strictEqual(pl.outside.length, vs.length - 1 - perTent * maxTents, 'いっぱいの人はたき火のそば');
  // 寝床（ベッド・敷物）と寝ている人は、テントの壁の中（両はし・奥の壁・口にかからない）
  for (const sq of [{ x: 0, z: -1 }, { x: 14, z: -28 }]) for (const t of TN.tentCandidates(sq, perTent)) {
    for (let i = 0; i < perTent; i++) {
      const bd = TN.tentBed(t, i, perTent);
      for (const c of BD.bedCorners(bd)) assert.ok(TN.inTent(t, c.x, c.z, -0.08), 'ベッドの角がテントの中');
      for (const chibi of [false, true]) {
        const f = BD.sleeperOnBed(bd, chibi), L = chibi ? BD.BODY_LEN.chibi : BD.BODY_LEN.normal;
        assert.ok(TN.inTent(t, f.x, f.z, -0.08) && TN.inTent(t, f.x - Math.sin(f.yaw) * L, f.z - Math.cos(f.yaw) * L, -0.08), '寝ている人の足と頭がテントの中');
      }
      if (i) { const b0 = TN.tentBed(t, i - 1, perTent); assert.ok(Math.hypot(bd.cx - b0.cx, bd.cz - b0.cz) >= BD.BED.w + 0.2, 'となりの寝床と重ならない'); }
    }
  }
  // 形：三角屋根で入口は村人の背より高い。ベッドは奥の壁にかからず、足の先と前の壁の間を体の横はば（1.9）で通れる
  const T = TN.TENT;
  assert.ok(T.ridgeH > T.doorH && T.doorH >= 4 && T.door >= 2.2, '入口・てっぺんの高さ');
  assert.ok(TN.BED_U - BD.BED.l / 2 >= -T.depth / 2 + T.wall + 0.2, 'ベッドが奥の壁にかからない');
  assert.ok(TN.AISLE_U - 0.95 >= TN.BED_U + BD.BED.l / 2 + 0.2 && TN.AISLE_U + 0.95 <= T.depth / 2 - T.wall, '通り道のはば');
  { const t = TN.tentCandidates({ x: 0, z: 0 }, perTent)[0], bd = TN.tentBed(t, 0, perTent), ex = TN.tentExit(t, { x: bd.cx, z: bd.cz });
    assert.ok(TN.inTent(t, ex[1].x, ex[1].z) && !TN.inTent(t, ex[2].x, ex[2].z, 0.5), '出る道は入口の内がわ → 外'); }
  // テントどうしも重ならない
  const cs = TN.tentCandidates({ x: 0, z: 0 }, perTent);
  for (let a = 0; a < cs.length; a++) for (let b = 0; b < cs.length; b++) if (a !== b) for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
    const q = TN.tentPoint(cs[a], u * cs[a].depth / 2, v * cs[a].len / 2);
    assert.ok(!TN.inTent(cs[b], q.x, q.z, -0.05), `テント ${a} と ${b} が重なる`);
  }
  const src = fs.readFileSync(path.join(ROOT, 'js/town.js'), 'utf8');
  assert.ok(/tentBed\(s\.t, s\.i, tentP\.perTent\)/.test(src) && !/ConeGeometry\(1, 1\.4, 4\)/.test(src), '町の画面：ベッドはテントの寝床の所（1 人 1 つの小さいテントはやめた）');
  const sim = fs.readFileSync(path.join(ROOT, 'tools/sim.js'), 'utf8');
  assert.ok(/tentNow\(\)\.slot/.test(sim) && /テントの中で敷物にくるまって眠った/.test(sim), 'sim：テントの中で寝る');
});
t('拠点の候補：A 浜辺・B 池・C 森 は島の陸の上で、たがいに 40 以上はなれ、それぞれの場所らしい', () => {
  const cfg = liveCfg();
  const IL = require('../tools/island_layout.js'), ISX2 = require('../js/island.js');
  const [A, B, C] = cfg.baseVote.candidates;
  const w = IL.buildIslandWorld({ seed: 'town', ores: {}, gather: null, debris: [], candidates: [A, B, C] });
  const m = w.islands[0];
  for (const c of [A, B, C]) assert.ok(ISX2.shoreDist(m, c.x, c.z) >= 15, '岸から 15 以上 ' + c.name);
  for (const [a, b] of [[A, B], [B, C], [A, C]]) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 40, `${a.name} と ${b.name} がはなれている`);
  assert.ok(ISX2.shoreDist(m, A.x, A.z) < 20 && A.z > 25, 'A は南の砂浜のそば');
  assert.ok(Math.hypot(B.x - w.pond.x, B.z - w.pond.z) < 17, 'B は池のそば');
  assert.ok(C.z < -20 && ISX2.bridgeDist(w.bridges[0], C.x, C.z) < 30, 'C は北（森と橋のほう）');
  for (const c of [A, B, C]) assert.ok(IL.basePlots(w, c).filter((p) => !p.island).length >= 16, '家を建てる区画が足りる ' + c.name);
  assert.ok(!cfg.baseVote.candidates.some((c) => /港/.test(c.desc)), '島に港はない');
});

// ---------- 釣った魚の大きさ・釣りランキング ----------
t('釣り：魚の大きさは魚ごとの範囲の中。大きいのはめったに出ない（大物はまれ）', () => {
  const FZ = require('../tools/fishsize');
  const { makeRng } = require('../tools/rand');
  const cfg = liveCfg();
  const sizes = cfg.fishing.sizes;
  const fishKinds = cfg.fishing.fish.map(([k]) => k).concat(cfg.hours.nightFish.map(([k]) => k));
  for (const k of fishKinds) assert.ok(sizes[k], '大きさの範囲がある ' + k);
  for (const [k, s] of Object.entries(sizes)) {
    assert.ok(cfg.items[k], '魚がある ' + k);
    assert.ok(s.min < s.max && s.max < s.bigMax, '範囲 ' + k);
    const R = makeRng('fishtest:' + k), N = 20000;
    let hi = 0, big = 0;
    for (let i = 0; i < N; i++) {
      const cm = FZ.rollSize(s, R);
      assert.ok(cm >= s.min && cm <= s.bigMax, `${k} ${cm}cm が範囲の外`);
      if (cm > s.max) big++;
      else if (cm > s.min + (s.max - s.min) * 0.75) hi++;
    }
    assert.ok(hi / N < 0.2, `${k}：大きい方の 1/4 は少ない ${hi / N}`);
    assert.ok(big / N > s.bigP * 0.5 && big / N < s.bigP * 1.6, `${k}：大物は bigP くらい ${big / N}`);
  }
  // 同じ種なら同じ大きさ
  assert.strictEqual(FZ.rollSize(sizes.fish_koi, makeRng('x')), FZ.rollSize(sizes.fish_koi, makeRng('x')));
});
t('釣り：ランキングは魚ごとに上位だけ。前の記録をこえた時だけ「島の新記録」。村人ごとの一番は魚ごとに 1 つ', () => {
  const FZ = require('../tools/fishsize');
  const st = {}, L = {};
  assert.strictEqual(FZ.addCatch(st, L, 'a', 'fish_funa', 20, 1, 3).record, false, 'はじめの 1 匹は記録あつかいにしない');
  let r = FZ.addCatch(st, L, 'b', 'fish_funa', 25, 2, 3);
  assert.ok(r.record && r.prev === 20, '大きいのが釣れたら新記録');
  assert.strictEqual(FZ.addCatch(st, L, 'c', 'fish_funa', 25, 3, 3).record, false, '同じ大きさは新記録ではない');
  FZ.addCatch(st, L, 'd', 'fish_funa', 10, 3, 3);
  FZ.addCatch(st, L, 'e', 'fish_funa', 22, 4, 3);
  assert.deepStrictEqual(st.fishing.top.fish_funa, [[25, 'b', 2], [25, 'c', 3], [22, 'e', 4]], '大きい順・同じなら先の人・3 匹まで');
  assert.strictEqual(st.fishing.catches, 5);
  const Lv = {};
  FZ.addCatch(st, Lv, 'a', 'fish_koi', 30, 5);
  assert.strictEqual(FZ.addCatch(st, Lv, 'a', 'fish_koi', 28, 6).best, false);
  FZ.addCatch(st, Lv, 'a', 'fish_koi', 41, 7);
  assert.deepStrictEqual(Lv.fishBest, { fish_koi: [41, 7] });
});
t('釣り：町を進めると大きさつきで記録され、データは小さいまま（ページ・歴史・日記・町の画面）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-fish-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
  execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '20'], { env });
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const cfg = rd('config.json'), st = rd('state.json'), hist = rd('history.json'), life = STORE.readLife(dir);
  const sizes = cfg.fishing.sizes, keep = cfg.fishing.rankKeep;
  assert.ok(st.fishing && st.fishing.catches > 0, '魚が釣れて数えられている');
  for (const [k, list] of Object.entries(st.fishing.top)) {
    assert.ok(list.length <= keep, '上位だけ');
    for (let i = 0; i < list.length; i++) {
      const [cm, key, day] = list[i];
      assert.ok(cm >= sizes[k].min && cm <= sizes[k].bigMax && typeof key === 'string' && day >= 1 && day <= 20);
      if (i) assert.ok(list[i - 1][0] >= cm, '大きい順');
    }
  }
  assert.ok(JSON.stringify(st.fishing).length < 6000, '記録は小さい ' + JSON.stringify(st.fishing).length);
  const nk = Object.keys(sizes).length;
  let withBest = 0;
  for (const L of Object.values(life)) if (L.fishBest) { withBest++; assert.ok(Object.keys(L.fishBest).length <= nk); }
  assert.ok(withBest > 0, '村人ごとの一番');
  const recs = hist.filter((h) => h.type === 'fish');
  for (const h of recs) {
    assert.ok(/^.+が \d+(\.\d)?cm の.+を釣った！ 島の新記録$/.test(h.text), h.text);
    const top = st.fishing.top[h.item];
    assert.ok(top && top[0][0] >= h.cm, '記録は今の一番以下');
  }
  // 同じ日・同じ魚の新記録は 1 行
  assert.strictEqual(new Set(recs.map((h) => h.day + h.item)).size, recs.length);
  // ページ：ナビに釣り、fish.html、村人ページ、町の画面の「+1 フナ 23cm」
  assert.ok(/\['fish\.html', '釣り'\]/.test(fs.readFileSync(path.join(ROOT, 'js/common.js'), 'utf8')));
  const page = fs.readFileSync(path.join(ROOT, 'fish.html'), 'utf8');
  assert.ok(/state\.fishing/.test(page) && /v\.display/.test(page), 'ランキングは表示名（かくしている人はあだ名）');
  assert.ok(/fishBest/.test(fs.readFileSync(path.join(ROOT, 'js/villager.js'), 'utf8')));
  const town = fs.readFileSync(path.join(ROOT, 'js/town.js'), 'utf8'), chr = fs.readFileSync(path.join(ROOT, 'js/character.js'), 'utf8');
  assert.ok(/today \|\| \{\}\)\.fish/.test(town));
  // 釣ったあと魚を持ち上げて見せる（大きさは cm で決める）・頭の上の札と新記録・村人カードのいちばんの大物
  assert.ok(/pose = 'showfish'/.test(town) && /pose === 'showfish'/.test(chr), '持ち上げて見せる動き');
  assert.ok(/'新記録！'/.test(town) && /bestFishText\(L, config\)/.test(town), '新記録の札・村人カード');
  assert.ok(/fishLenPx = \(cm\) =>/.test(chr), '魚の模型の長さは cm から');
  // 今日の魚に新記録の印（3 つ目が 1）がある時は、町の画面の「新記録！」に使う
  for (const L of Object.values(life)) for (const e of ((L.today || {}).fish || [])) assert.ok(typeof e[0] === 'string' && e[1] > 0 && (e.length === 2 || e[2] === 1));
  fs.rmSync(dir, { recursive: true, force: true });
});
t('釣り：魚は池・海べ・夜で 16 種。どの魚にも名前・食べ物の値・大きさ・絵・持ち上げる模型の色がある', () => {
  const cfg = liveCfg(), FC = cfg.fishing;
  const chr = fs.readFileSync(path.join(ROOT, 'js/character.js'), 'utf8');
  const keys = (l) => (l || []).map(([k]) => k);
  const pond = keys(FC.fish), sea = keys(FC.seaFish), all = new Set([...pond, ...sea, ...keys(FC.seaNightFish), ...keys(cfg.hours.nightFish)]);
  assert.ok(all.size >= 14, '魚の種類 ' + all.size);
  assert.ok(['fish_dojou', 'fish_bluegill', 'fish_ugui'].every((k) => pond.includes(k)), '池の魚');
  assert.ok(['fish_aji', 'fish_saba', 'fish_tai', 'fish_mebaru', 'fish_kasago', 'fish_maguro'].every((k) => sea.includes(k)), '海の魚');
  assert.ok(!sea.some((k) => pond.includes(k)), '池と海べで、昼の魚は分かれている');
  for (const k of all) {
    const it = cfg.items[k];
    assert.ok(it && /^[ァ-ヶー]+$/.test(it.name) && it.value.food > 0 && it.value.food <= 2, k + ' の名前と食べ物の値');
    const s = FC.sizes[k]; assert.ok(s && s.min < s.max && s.max < s.bigMax && s.bigP > 0 && s.bigP <= 0.02, k + ' の大きさ');
    assert.ok(cfg.spendOrder.food.includes(k), k + ' は食べ物として使う');
    assert.ok(new RegExp(k + ': \\[0x').test(chr), k + ' の模型の色');
    const png = fs.readFileSync(path.join(ROOT, 'icons', k + '.png'));
    assert.ok(png.readUInt32BE(16) === 16 && png.readUInt32BE(20) === 16, k + ' の絵は 16x16');
  }
  // マグロはごくまれな大物：海の中でいちばん出にくく、いちばん大きい
  const w = Object.fromEntries(FC.seaFish), maxBig = Math.max(...Object.values(FC.sizes).map((s) => s.bigMax));
  assert.ok(w.fish_maguro / Object.values(w).reduce((a, b) => a + b, 0) < 0.01 && FC.sizes.fish_maguro.bigMax === maxBig);
  // 夜だけの魚（昼の表にない）が海べに 1 種
  assert.ok(keys(FC.seaNightFish).some((k) => !sea.includes(k) && !pond.includes(k)), '夜の海べだけの魚');
});
t('釣り：島の町は日ごとに海べか池で釣る。海べでは海の魚、池では池の魚（日記・今していること・町の画面）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-sea-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'tools/init.js'), '--demo'], { env });
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const wd = rd('world.json'); if (!wd.islands || !wd.pond) return; // 前の形の町・池のない町は片方だけ
  const cfg = rd('config.json'), FC = cfg.fishing;
  const pondK = new Set([...FC.fish, ...cfg.hours.nightFish].map(([k]) => k)), seaK = new Set([...FC.seaFish, ...FC.seaNightFish].map(([k]) => k));
  const seen = { sea: 0, pond: 0 };
  for (let d = 0; d < 4; d++) { // 5 日ずつ進めて、その日の釣りを見る
    execFileSync(process.execPath, [path.join(ROOT, 'tools/sim.js'), '--demo', '--days', '5'], { env });
    const life = STORE.readLife(dir), today = rd('state.json').day;
    for (const L of Object.values(life)) {
      const fh = (Array.isArray(L.hours) ? L.hours : String(L.hours || '').split(',')).map((c) => c.replace(/\*\d+$/, '')).filter((c) => /^f(:|$)/.test(c));
      const fish = ((L.today || {}).fish || []).map((e) => e[0]);
      if (!fh.length) continue;
      const atSea = fh.includes('f:sea');
      assert.ok(fh.every((c) => (c === 'f:sea') === atSea), '1 日の釣り場は 1 つ');
      for (const k of fish) assert.ok(atSea ? seaK.has(k) : pondK.has(k), (atSea ? '海べ' : '池') + 'で ' + k);
      seen[atSea ? 'sea' : 'pond']++;
      const dl = (L.diary || []).find((x) => x.day === today);
      if (dl && /で釣りを/.test(dl.text)) assert.ok(atSea ? !/池で釣り/.test(dl.text) : !/海べで釣り/.test(dl.text), dl.text);
    }
  }
  // 20 日の間に、海の魚も池の魚も記録に入る
  const tops = Object.keys(rd('state.json').fishing.top);
  assert.ok(tops.some((k) => seaK.has(k)) && tops.some((k) => pondK.has(k) && !seaK.has(k)), '海の魚と池の魚 ' + tops.join(' ') + ' ' + JSON.stringify(seen));
  // 今していること・町の画面
  const HRm = fs.readFileSync(path.join(ROOT, 'js/hours.js'), 'utf8'), town = fs.readFileSync(path.join(ROOT, 'js/town.js'), 'utf8');
  assert.ok(/海べで釣りをしている/.test(HRm) && /seaSpotOf\(p\.v\.key\)/.test(town) && /a\.target === 'sea'/.test(town));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 鍛冶屋と鍛冶職人・防具 ----------
const SMT = require('../js/smithing.js');
const smithRun = (() => {
  let cache = null;
  return () => {
    if (cache) return cache;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-smith-'));
    fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
    const env = { ...process.env, TOWN_DATA: dir };
    const node = (...a) => execFileSync(process.execPath, a.map((x, i) => (i === 0 ? path.join(ROOT, x) : x)), { env, encoding: 'utf8' });
    node('tools/init.js', '--demo');
    node('tools/sim.js', '--demo', '--days', '4');
    const before = { life: STORE.readLife(dir), st: JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), w: STORE.readWorld(dir) };
    // 鍛冶屋を建てたことにして（前の日に建った）、チェストに羊毛・鉄・石炭・丸石を足す
    const w = before.w, st = before.st;
    w.buildings.push({ id: 'smithy_t', type: 'smithy', x: w.square.x + 14, z: w.square.z + 3, rot: 0, day: st.day, builders: [], variant: 0 });
    w.buildings.push({ id: 'workbench_t', type: 'workbench', x: w.square.x - 14, z: w.square.z + 3, rot: 0, day: st.day, builders: [], variant: 0 });
    STORE.writeWorld(dir, w);
    Object.assign(st.store, { wool: 20, iron: 12, coal: 6, cobble: 40, log: 30 });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));
    const store0 = { ...st.store };
    node('tools/sim.js', '--demo', '--days', '2');
    const after = { life: STORE.readLife(dir), st: JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), hist: JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')) };
    fs.rmSync(dir, { recursive: true, force: true });
    return (cache = { before, after, store0 });
  };
})();
t('鍛冶：鍛冶屋ができるまでは、だれも鍛冶職人にならない（sm の時間も防具もない）', () => {
  const { before } = smithRun();
  assert.ok(!before.st.smiths, 'state.smiths はまだない');
  for (const L of Object.values(before.life)) {
    assert.ok(!L.smith && !L.gear, '鍛冶職人の印も防具もない');
    assert.ok(!HR.decodeHours(L.hours).some((c) => c.startsWith('sm')), 'sm の時間はない');
  }
  assert.ok(!before.st.pool.includes('smithy') || before.st.day >= RCFG.smithing.unlock.minDay, '作業台と倉庫が建つ前は候補に入らない');
});
t('鍛冶：鍛冶屋が建つと 1 人が鍛冶職人になり、チェストの材料で防具・道具を作る（材料が減る・装備は life.json に残る）', () => {
  const { after, store0 } = smithRun();
  assert.strictEqual((after.st.smiths || []).length, 1, '鍛冶職人は 1 人');
  const sk = after.st.smiths[0], SL = after.life[sk];
  assert.ok(SL.smith, '鍛冶職人の印');
  assert.ok(HR.decodeHours(SL.hours).some((c) => c === 'sm:smithy_t') || after.hist.some((h) => h.smith), '鍛冶屋で打った時間がある');
  const made = after.hist.filter((h) => h.smith);
  assert.ok(made.length >= 1 && made.length <= 2 * RCFG.smithing.perDay, `作った数 ${made.length}（1 日 perDay まで）`);
  assert.ok(after.hist.some((h) => /鍛冶職人になった/.test(h.text)), '歴史に「鍛冶職人になった」');
  assert.ok(made.every((h) => /鍛冶職人の.+(に|、自分の).+を作った/.test(h.text)), made.map((h) => h.text).join('\n'));
  const geared = Object.values(after.life).filter((L) => L.gear && Object.keys(L.gear).length);
  assert.ok(geared.length >= 1, '防具を身につけた人がいる（life.json の gear）');
  for (const L of geared) for (const [slot, it] of Object.entries(L.gear)) assert.strictEqual(RCFG.smithing.armor[it].slot, slot);
  // 材料が減った（羊毛か鉄）
  assert.ok((after.st.store.wool || 0) < store0.wool || (after.st.store.iron || 0) < store0.iron, '羊毛か鉄鉱石が使われた');
  assert.ok((after.st.store.wool || 0) >= RCFG.smithing.keep.wool || store0.wool < RCFG.smithing.keep.wool, '羊毛は keep の分を残す');
  // 日記に作った物が出る
  const diaryHit = Object.values(after.life).some((L) => (L.diary || []).some((d) => /作ってくれた|鍛冶屋で/.test(d.text)));
  assert.ok(diaryHit, '日記に「鍛冶屋で〜を作った」「作ってくれた」');
});
t('鍛冶：pickJob は見張り（剣）を先に、材料が足りない物は作らない。革の防具（革がない）は作れない', () => {
  const cfg = RCFG, CR = require('../tools/craft');
  const people = [
    { key: 'a', L: { inv: [{ item: 'stone_pickaxe', dur: 50 }], slots: 3, gear: {} }, guard: false },
    { key: 'g', L: { inv: [{ item: 'wood_sword', dur: 20 }], slots: 3, gear: {} }, guard: true },
  ];
  const r = SMT.pickJob({ store: { wool: 10 }, people, config: cfg, built: ['workbench', 'smithy'], CR });
  assert.ok(r.job && r.job.to === 'g' && r.job.type === 'armor', '見張りの防具が先');
  assert.ok(r.job.store.wool < 10 && r.job.store.wool >= cfg.smithing.keep.wool);
  const none = SMT.pickJob({ store: { leather: 0, wool: 2 }, people, config: cfg, built: ['workbench'], CR });
  assert.ok(!none.job, '羊毛は keep を残すので作れない・ほかの材料もない');
  const lea = SMT.pickJob({ store: { leather: 9 }, people: [{ key: 'x', L: { inv: [], slots: 3, gear: { head: 'iron_cap', body: 'iron_mail', feet: 'iron_boots' } } }], config: cfg, built: [], CR });
  assert.ok(!lea.job, '鉄の防具より弱い革は作らない');
  assert.ok(!cfg.items.leather.value.wood && /柵の中/.test(cfg.items.leather.note) && cfg.hunting.leather.cow, '革は柵の中の動物をしとめた時だけ手に入る');
  assert.strictEqual(SMT.smithyUnlocked(cfg.smithing, ['workbench'], 99), false);
  assert.strictEqual(SMT.smithyUnlocked(cfg.smithing, ['workbench', 'storehouse'], cfg.smithing.unlock.minDay), true);
});
t('鍛冶：防具は夜の敵の攻撃を少しへらす。防具のない人は前と同じ戦い', () => {
  const CBm = require('../js/combat.js'), C = RCFG.combat;
  const run = (armor, seed) => CBm.fightNight({ mobs: [{ type: 'zombie' }, { type: 'zombie' }, { type: 'skeleton' }], guards: [{ key: 'g', weapon: null, shield: false, ...(armor ? { armor } : {}) }], C, rng: CBm.seededRng('arm' + seed) });
  let plain = 0, armored = 0;
  for (let s = 0; s < 60; s++) {
    const a = run(0, s), b = run(0, s);
    assert.deepStrictEqual(a, b, '同じ種なら同じ');
    const per = (F) => (F.taken.g || 0) / Math.max(1, F.log.filter((e) => e.to).length);
    plain += per(a); armored += per(run(6, s));
  }
  assert.ok(armored < plain * 0.9, `1 回のダメージの平均が減る ${(plain / 60).toFixed(2)} → ${(armored / 60).toFixed(2)}`);
  assert.strictEqual(SMT.armorDef({ head: 'wool_cap', body: 'iron_mail' }, RCFG.smithing), 3);
  assert.ok(SMT.armorBlockP(100, C) <= C.armorMax);
});
t('鍛冶：前のデータ（gear も smith もない life）も読める。装備の名前・見た目は空', () => {
  const L = { inv: [{ item: 'wood_axe', dur: 10 }], slots: 3 };
  assert.deepStrictEqual(SMT.gearNames(L, RCFG.items), ['木の斧']);
  assert.strictEqual(SMT.armorDef(undefined, RCFG.smithing), 0);
  assert.deepStrictEqual(SMT.armorLook(undefined, RCFG.smithing), {});
  assert.deepStrictEqual(SMT.gearNames({ inv: [], gear: { body: 'wool_shirt' } }, RCFG.items), ['羊毛の服']);
  assert.strictEqual(HR.parseCode('sm:smithy_3').action, 'smith');
  assert.ok(/鍛冶/.test(HR.hourText(HR.parseCode('sm:smithy_3'))));
});

// ---------- 投稿の URL → 投稿の ID（Graph API はにせ物で） ----------
const asyncTests = [];
const at = (name, fn) => asyncTests.push([name, fn]);
const IG = require('../tools/instagram');
t('投稿の URL：形がちがっても同じ投稿とわかる・インスタ以外は弾く', () => {
  const same = ['https://www.instagram.com/p/DAbc_12-x/', 'https://instagram.com/p/DAbc_12-x', 'instagram.com/reel/DAbc_12-x/?igsh=abc123', 'https://www.instagram.com/someone/p/DAbc_12-x/?img_index=1', 'https://m.instagram.com/reels/DAbc_12-x/'];
  for (const u of same) assert.strictEqual(IG.normPostUrl(u), 'instagram.com/p/DAbc_12-x', u);
  assert.ok(IG.sameMedia(same[0], same[2]));
  assert.ok(!IG.sameMedia('https://www.instagram.com/p/AAA/', 'https://www.instagram.com/p/AAB/'));
  for (const u of ['', 'https://example.com/p/AAA/', 'https://www.instagram.com/hajimari/', 'https://instagram.com.evil.example/p/AAA/', 'ふつうの文字']) assert.strictEqual(IG.postCode(u), null, u);
  assert.deepStrictEqual(IG.urlList(' a '), ['a']);
  assert.deepStrictEqual(IG.urlList(['a', '', null, 'b']), ['a', 'b']);
});
// にせの Graph API：/media は 2 ページ、/comments などは呼ばれたら記録
function fakeGraph(pages) {
  const calls = [];
  IG._setFetch(async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (/\/media$/.test(u.pathname)) {
      const p = Number(u.searchParams.get('page') || 0);
      const body = { data: pages[p] || [] };
      if (p + 1 < pages.length) body.paging = { next: url.replace(/&page=\d+|$/, '') + '&page=' + (p + 1) };
      return { ok: true, json: async () => body, text: async () => '' };
    }
    return { ok: false, status: 404, text: async () => 'nope' };
  });
  return calls;
}
const PAGES = [
  [{ id: '111', permalink: 'https://www.instagram.com/p/NEWEST/', timestamp: '2026-11-26T00:00:00+0000' }, { id: '222', permalink: 'https://www.instagram.com/reel/VOTE1/', timestamp: '2026-11-25T00:00:00+0000' }],
  [{ id: '333', permalink: 'https://www.instagram.com/p/JOIN_OLD/', timestamp: '2026-11-01T00:00:00+0000' }],
];
at('投稿の URL から ID を探す：次のページもたどる・/reel/ と /p/ は同じ・住みたいはいくつでも', async () => {
  const calls = fakeGraph(PAGES);
  const logs = [];
  const r = await IG.resolveMedia({ votePostUrl: 'https://instagram.com/p/VOTE1?igsh=x', joinPostUrl: ['https://www.instagram.com/p/NEWEST/', 'instagram.com/p/JOIN_OLD/'] }, { IG_VOTE_MEDIA: '999', IG_JOIN_MEDIA: '998' }, 'U1', 'TOKEN_SECRET', (s) => logs.push(s));
  assert.strictEqual(r.vote, '222');
  assert.deepStrictEqual(r.join, ['111', '333']);
  assert.deepStrictEqual(r.source, { vote: 'url', join: 'url' });
  assert.ok(calls.every((c) => /fields=id,permalink,timestamp/.test(c)), '一覧だけ読む');
  assert.ok(logs.some((s) => /votePostUrl/.test(s)) && logs.some((s) => /joinPostUrl/.test(s)), 'どこから決めたか書く');
  assert.ok(!logs.join('\n').includes('TOKEN_SECRET'), '鍵は出さない');
});
at('投稿の URL が見つからない・空の時は Secrets の ID を使う（Secrets もなければ最近の投稿）', async () => {
  fakeGraph(PAGES);
  const logs = [];
  let r = await IG.resolveMedia({ votePostUrl: 'https://www.instagram.com/p/GONE/', joinPostUrl: '' }, { IG_VOTE_MEDIA: '999', IG_JOIN_MEDIA: '998, 997' }, 'U1', 'T', (s) => logs.push(s));
  assert.strictEqual(r.vote, '999');
  assert.deepStrictEqual(r.join, ['998', '997']);
  assert.deepStrictEqual(r.source, { vote: 'secret', join: 'secret' });
  assert.ok(logs.some((s) => /見つかりません/.test(s)));
  r = await IG.resolveMedia({}, {}, 'U1', 'T', () => {});
  assert.strictEqual(r.vote, '111', 'いちばん新しい投稿');
  assert.deepStrictEqual(r.source, { vote: 'recent', join: 'recent' });
  r = await IG.resolveMedia({ votePostUrl: 'https://example.com/x' }, { IG_VOTE_MEDIA: '999' }, 'U1', 'T', () => {});
  assert.strictEqual(r.vote, '999', 'インスタ以外の URL は使わない');
  IG._setFetch(null);
});
// ---------- 最近の投稿をまとめて読む（collect）：にせの Graph API ----------
// media：一覧（comments_count つき）、cm：投稿 ID → コメント。呼ばれた URL を返す
function fakeIG(media, cm, { me = { followers_count: 42, username: 'town_owner' } } = {}) {
  const calls = [];
  IG._setFetch(async (url) => {
    calls.push(url);
    const u = new URL(url);
    const ok = (body) => ({ ok: true, json: async () => body, text: async () => '' });
    if (/\/media$/.test(u.pathname)) return ok({ data: media });
    const m = /\/(\d+)\/comments$/.exec(u.pathname);
    if (m) {
      const all = cm[m[1]] || [], p = Number(u.searchParams.get('page') || 0), per = 2; // 2 件ずつのページ
      const body = { data: all.slice(p * per, p * per + per) };
      if ((p + 1) * per < all.length) body.paging = { next: url.replace(/&page=\d+|$/, '') + '&page=' + (p + 1) };
      return ok(body);
    }
    if (/\/U1$/.test(u.pathname)) return ok(me);
    return { ok: false, status: 404, text: async () => 'nope' };
  });
  return calls;
}
const NOW_IG = new Date('2026-11-26T12:00:00Z');
const igC = (id, uid, user, text, ts = '2026-11-26T01:00:00+0000') => ({ id, text, timestamp: ts, from: { id: uid, username: user } });
const MEDIA = [
  { id: '111', permalink: 'https://www.instagram.com/p/NEWEST/', timestamp: '2026-11-26T00:00:00+0000', comments_count: 3 },
  { id: '222', permalink: 'https://www.instagram.com/reel/VOTE1/', timestamp: '2026-11-25T00:00:00+0000', comments_count: 3 },
  { id: '444', permalink: 'https://www.instagram.com/p/NOCOM/', timestamp: '2026-11-24T00:00:00+0000', comments_count: 0 },
  { id: '333', permalink: 'https://www.instagram.com/p/OLD/', timestamp: '2026-08-01T00:00:00+0000', comments_count: 1 },
];
const CM = {
  111: [igC('c1', '1', 'aki', '住みたい ピッケル'), igC('c2', '2', 'ben', 'A'), igC('c6', '1', 'aki', '誕生日 3/14')],
  222: [igC('c3', '3', 'cho', '住みたい'), igC('c4', '1', 'aki', 'B'), igC('c7', '9', 'town_owner', 'A')],
  333: [igC('c5', '4', 'dan', '住みたい')],
};
at('最近の投稿：どの投稿の「住みたい」も受け付ける・投票は投票の投稿だけ・同じ人は 1 人・持ち主は数えない', async () => {
  const calls = fakeIG(MEDIA, CM);
  const r = await IG.collect({ cfg: { votePostUrl: 'https://www.instagram.com/p/VOTE1/' }, env: {}, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  const ids = (cs) => cs.map((c) => c.id).sort();
  assert.deepStrictEqual(ids(r.data.voteComments), ['c3', 'c4'], '投票は投票の投稿だけ（ほかの投稿の A は数えない）・持ち主は外す');
  assert.deepStrictEqual(ids(r.data.joinComments), ['c1', 'c2', 'c3', 'c4', 'c6'], '最近の投稿ぜんぶ（60 日より古い投稿は読まない）・同じコメントは 1 回');
  const regs = P.registrationsFrom(r.data.joinComments);
  assert.deepStrictEqual(regs.map((x) => x.username).sort(), ['aki', 'cho'], 'from.id ごとに 1 人');
  assert.deepStrictEqual(P.tallyVote(r.data.voteComments, { opensAt: '2026-11-25T00:00:00Z', closesAt: '2026-11-27T00:00:00Z' }).votes, { A: 0, B: 1, C: 0 }, 'ほかの投稿の A は票にならない');
  assert.ok(!calls.some((c) => /\/444\/comments/.test(c)), 'コメントのない投稿は呼ばない');
  assert.ok(!calls.some((c) => /\/333\/comments/.test(c)), '古い投稿は呼ばない');
  assert.strictEqual(calls.filter((c) => /\/222\/comments/.test(c)).length, 2, '投票の投稿は 1 回だけ読む（2 ページ）');
  assert.strictEqual(r.calls, calls.length);
  assert.strictEqual(r.calls, 1 + 1 + 2 + 2, '一覧 1・フォロワーと名前 1・コメント（2 件ずつ）4');
  assert.strictEqual(r.data.followers, 42); assert.strictEqual(r.data.owner, 'town_owner');
  assert.deepStrictEqual(r.cache.media, { 111: 3, 222: 3, 444: 0 }, '覚え書きは ID と数だけ');
  assert.ok(!JSON.stringify(r.cache).includes('aki') && !JSON.stringify(r.cache).includes('住みたい'), '覚え書きに名前・コメントは入れない');
  // joinPostUrl の投稿は、古くても読む
  fakeIG(MEDIA, CM);
  const r2 = await IG.collect({ cfg: { votePostUrl: 'https://www.instagram.com/p/VOTE1/', joinPostUrl: 'https://www.instagram.com/p/OLD/' }, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  assert.ok(r2.data.joinComments.some((c) => c.id === 'c5'), 'joinPostUrl はいつも読む');
  IG._setFetch(null);
});
at('最近の投稿：数（joinScanPosts）・日にち（joinScanDays）で切る・おかしな値は既定', async () => {
  assert.deepStrictEqual(IG.scanOpts({}), { posts: 25, days: 60 });
  assert.deepStrictEqual(IG.scanOpts({ joinScanPosts: 500, joinScanDays: -1 }), { posts: 100, days: 60 });
  assert.deepStrictEqual(IG.scanOpts({ joinScanPosts: 'x', joinScanDays: 0 }), { posts: 25, days: 0 });
  let calls = fakeIG(MEDIA, CM);
  let r = await IG.collect({ cfg: { votePostUrl: 'https://www.instagram.com/p/VOTE1/', joinScanPosts: 1 }, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  assert.deepStrictEqual(r.data.joinComments.map((c) => c.id).sort(), ['c1', 'c2', 'c3', 'c4', 'c6'], '1 投稿＋投票の投稿');
  calls = fakeIG(MEDIA, CM);
  r = await IG.collect({ cfg: { votePostUrl: 'https://www.instagram.com/p/VOTE1/', joinScanPosts: 0 }, env: { IG_JOIN_MEDIA: '333' }, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  assert.ok(!calls.some((c) => /\/111\/comments/.test(c)), '0 なら最近の投稿は読まない（決めた投稿だけ）');
  assert.ok(r.data.joinComments.some((c) => c.id === 'c5'));
  fakeIG(MEDIA, CM);
  r = await IG.collect({ cfg: { votePostUrl: 'https://www.instagram.com/p/VOTE1/', joinScanDays: 0 }, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  assert.ok(r.data.joinComments.some((c) => c.id === 'c5'), '0 なら日にちで切らない');
  IG._setFetch(null);
});
at('覚え書き：コメントの数が同じ投稿は読まない・Webhook の投稿と数が変わった投稿は読む・6 時間で全部読み直す', async () => {
  fakeIG(MEDIA, CM);
  const cfg = { votePostUrl: 'https://www.instagram.com/p/VOTE1/' };
  const first = await IG.collect({ cfg, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  let calls = fakeIG(MEDIA, CM);
  let r = await IG.collect({ cfg, userId: 'U1', token: 'T', now: new Date(NOW_IG.getTime() + 10 * 60e3), cache: first.cache, log: () => {} });
  assert.ok(!calls.some((c) => /\/111\/comments/.test(c)), '数が同じ投稿は読まない');
  assert.ok(calls.some((c) => /\/222\/comments/.test(c)), '投票の投稿は毎回読む');
  assert.strictEqual(calls.filter((c) => /\/U1\?/.test(c)).length, 1, 'フォロワー数は毎回読む（1 回）');
  assert.strictEqual(r.calls, 1 + 1 + 2, '一覧 1・フォロワー 1・投票の投稿 2 ページ');
  assert.strictEqual(r.data.followers, 42);
  assert.strictEqual(r.stats.skipped, 1);
  // フォロワー数が読めない時は、前の値を使う
  IG._setFetch(async (url) => {
    const u = new URL(url), ok = (b) => ({ ok: true, json: async () => b, text: async () => '' });
    if (/\/media$/.test(u.pathname)) return ok({ data: MEDIA });
    const m = /\/(\d+)\/comments$/.exec(u.pathname);
    if (m) return ok({ data: CM[m[1]] || [] });
    return { ok: false, status: 500, text: async () => 'x' };
  });
  r = await IG.collect({ cfg, userId: 'U1', token: 'T', now: new Date(NOW_IG.getTime() + 10 * 60e3), cache: first.cache, log: () => {} });
  assert.strictEqual(r.data.followers, 42, '読めない時は前の数'); assert.strictEqual(r.data.owner, 'town_owner');
  // Webhook が教えた投稿は、数が同じでも読む（数字以外は捨てる）
  assert.deepStrictEqual(IG.hintIds('111, abc,222;x,'), ['111']);
  calls = fakeIG(MEDIA, CM);
  r = await IG.collect({ cfg, userId: 'U1', token: 'T', now: new Date(NOW_IG.getTime() + 10 * 60e3), cache: first.cache, hint: '111', log: () => {} });
  assert.ok(calls.some((c) => /\/111\/comments/.test(c)));
  // 数が変わったら読む
  calls = fakeIG(MEDIA.map((m) => (m.id === '111' ? { ...m, comments_count: 4 } : m)), CM);
  r = await IG.collect({ cfg, userId: 'U1', token: 'T', now: new Date(NOW_IG.getTime() + 10 * 60e3), cache: first.cache, log: () => {} });
  assert.ok(calls.some((c) => /\/111\/comments/.test(c)));
  assert.strictEqual(r.cache.media['111'], 4);
  // 6 時間たったら全部読み直す
  calls = fakeIG(MEDIA, CM);
  r = await IG.collect({ cfg, userId: 'U1', token: 'T', now: new Date(NOW_IG.getTime() + 7 * 3600e3), cache: first.cache, log: () => {} });
  assert.ok(calls.some((c) => /\/111\/comments/.test(c)) && r.stats.full);
  // 読めなかった投稿は覚え書きに入れない（次にまた読む）
  fakeIG(MEDIA, { 222: CM[222] });
  const failing = IG._setFetch;
  calls = [];
  IG._setFetch(async (url) => {
    calls.push(url);
    if (/\/111\/comments/.test(url)) return { ok: false, status: 500, text: async () => 'x' };
    const u = new URL(url), ok = (b) => ({ ok: true, json: async () => b, text: async () => '' });
    if (/\/media$/.test(u.pathname)) return ok({ data: MEDIA });
    if (/\/222\/comments/.test(u.pathname)) return ok({ data: CM[222] });
    return ok({ followers_count: 1, username: 'town_owner' });
  });
  r = await IG.collect({ cfg, userId: 'U1', token: 'T', now: NOW_IG, log: () => {} });
  assert.ok(!('111' in r.cache.media), '失敗した投稿は覚えない');
  assert.ok(failing);
  IG._setFetch(null);
});
at('Webhook の受け口（tools/webhook/worker.mjs）：署名を確かめる・コメントの投稿の ID だけ取る・GET の確かめ', async () => {
  const W = await import(require('url').pathToFileURL(path.join(ROOT, 'tools', 'webhook', 'worker.mjs')).href);
  const body = new TextEncoder().encode(JSON.stringify({ object: 'instagram', entry: [{ id: '1', changes: [{ field: 'comments', value: { comment_id: 'x', text: '住みたい', from: { id: '5' }, media: { id: '1789' } } }] }] }));
  const sig = 'sha256=' + require('crypto').createHmac('sha256', 'APPSECRET').update(body).digest('hex');
  assert.ok(await W.verifySignature(sig, body, ['APPSECRET']));
  assert.ok(await W.verifySignature(sig, body, [undefined, 'APPSECRET']), '2 つ目の秘密でも通す');
  assert.ok(!(await W.verifySignature(sig, body, ['WRONG'])));
  assert.ok(!(await W.verifySignature('sha1=abc', body, ['APPSECRET'])));
  assert.deepStrictEqual(W.commentMedia(JSON.parse(new TextDecoder().decode(body))), ['1789'], 'Facebook のログインの形');
  assert.deepStrictEqual(W.commentMedia([{ object: 'instagram', entry: [{ id: '1', field: 'comments', value: { id: 'c', media: { id: '42' } } }, { id: '1', field: 'mentions', value: {} }] }]), ['42'], 'インスタのログインの形・ほかの field は見ない');
  assert.deepStrictEqual(W.commentMedia({ object: 'page', entry: [] }), []);
  // GET（Meta の確かめ）と POST（署名ちがい）
  const env = { META_VERIFY_TOKEN: 'vt', META_APP_SECRET: 'APPSECRET' };
  let res = await W.default.fetch(new Request('https://w.example/?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345'), env, { waitUntil() {} });
  assert.strictEqual(res.status, 200); assert.strictEqual(await res.text(), '12345');
  res = await W.default.fetch(new Request('https://w.example/?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1'), env, { waitUntil() {} });
  assert.strictEqual(res.status, 403);
  res = await W.default.fetch(new Request('https://w.example/', { method: 'POST', body, headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) } }), env, { waitUntil() {} });
  assert.strictEqual(res.status, 401);
  const waits = [];
  res = await W.default.fetch(new Request('https://w.example/', { method: 'POST', body, headers: { 'X-Hub-Signature-256': sig } }), env, { waitUntil: (p) => waits.push(p) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(waits.length, 0, 'GH_DISPATCH_TOKEN がない時は GitHub に頼まない');
  // 2 分ごとの見回り：フォロワー数を KV に置き、GET /stats で返す（サイトだけ・60 秒キャッシュ）
  const kvStore = new Map(); let puts = 0;
  const kv = { get: async (k) => (kvStore.has(k) ? kvStore.get(k) : null), put: async (k, v) => { puts++; kvStore.set(k, v); } };
  const realFetch = globalThis.fetch, igUrls = [];
  let fol = 120;
  globalThis.fetch = async (url) => { igUrls.push(String(url)); return new Response(JSON.stringify({ followers_count: fol }), { status: 200 }); };
  try {
    const penv = { IG_TOKEN: 'IGtok', IG_USER_ID: '77', TOWN_KV: kv };
    let res0 = await W.default.fetch(new Request('https://w.example/stats'), penv, { waitUntil() {} });
    assert.strictEqual(res0.status, 404, 'まだ数がない');
    const t0 = Date.parse('2026-11-26T03:00:00Z');
    await W.poll(penv, t0);
    assert.strictEqual(igUrls.length, 1, 'GH_DISPATCH_TOKEN がない時はフォロワー数だけ（API 1 回）');
    assert.ok(/graph\.instagram\.com\/v21\.0\/77\?fields=followers_count&/.test(igUrls[0]));
    await W.poll(penv, t0 + 2 * 60e3);
    assert.strictEqual(puts, 1, '同じ数なら KV に書かない');
    fol = 125; await W.poll(penv, t0 + 4 * 60e3);
    assert.strictEqual(puts, 2, '変わったら書く');
    const res = await W.default.fetch(new Request('https://w.example/stats', { headers: { Origin: 'https://hajimarijima.github.io' } }), penv, { waitUntil() {} });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), 'https://hajimarijima.github.io', 'サイトだけ読める');
    assert.ok(/max-age=60/.test(res.headers.get('Cache-Control')));
    const js = await res.json();
    assert.strictEqual(js.followers, 125); assert.strictEqual(js.at, new Date(t0 + 4 * 60e3).toISOString());
    assert.deepStrictEqual(Object.keys(js).sort(), ['at', 'followers'], 'フォロワー数と時刻だけ');
    // コメントの数も見る時は 1 回で両方読む
    igUrls.length = 0;
    await W.poll({ ...penv, GH_DISPATCH_TOKEN: 'x' }, t0 + 6 * 60e3);
    assert.strictEqual(igUrls.length, 1); assert.ok(/fields=followers_count,media\.limit\(10\)/.test(igUrls[0]));
  } finally { globalThis.fetch = realFetch; }
  const vh = fs.readFileSync(path.join(ROOT, 'vote.html'), 'utf8');
  assert.ok(/config\.liveStatsUrl/.test(vh) && /state\.followers\.toLocaleString/.test(vh), '投票のページ：liveStatsUrl があれば読む・なければ state.followers');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).liveStatsUrl.replace(/^https:\/\/[^/]+\.workers\.dev\/stats$/, ''), '', 'liveStatsUrl は空か、Worker の /stats');
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'webhook', 'worker.mjs'), 'utf8');
  assert.ok(!/ghp_|github_pat_/.test(src), '鍵をコードに書かない');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'join.yml'), 'utf8');
  assert.ok(/repository_dispatch:\s*\n\s*types: \[ig-comment(, ig-dm)?\]/.test(wf) && /workflow_dispatch/.test(wf), 'join.yml は Webhook と手で動く');
  assert.ok(/IG_HINT_MEDIA: \$\{\{ github\.event\.client_payload\.media \}\}/.test(wf) && !/run:.*client_payload/.test(wf), 'Webhook の値は env で渡す');
  assert.ok(/instagram\.js --cache/.test(wf), 'join は覚え書きを使う');
});
t('投稿の URL を変える（set_post.js）：その値だけ書きかえ・住みたいは足していく・悪い URL は止める', () => {
  const SP = require('../tools/set_post');
  const src = fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8');
  let r = SP.applyPostUrls(src, 'https://instagram.com/reel/ABC123/?igsh=zz', 'https://www.instagram.com/p/J1/');
  let c = JSON.parse(r.text);
  assert.strictEqual(c.votePostUrl, 'https://www.instagram.com/reel/ABC123/');
  assert.ok(IG.urlList(c.joinPostUrl).includes('https://www.instagram.com/p/J1/'));
  const before = JSON.parse(src);
  assert.deepStrictEqual({ ...c, votePostUrl: 0, joinPostUrl: 0 }, { ...before, votePostUrl: 0, joinPostUrl: 0 }, 'ほかは変えない');
  assert.strictEqual(r.text.split('\n').length, src.split('\n').length, '行の形はそのまま');
  r = SP.applyPostUrls(r.text, '', 'instagram.com/p/J2');
  c = JSON.parse(r.text);
  assert.strictEqual(c.votePostUrl, 'https://www.instagram.com/reel/ABC123/', '空なら変えない');
  assert.ok(IG.urlList(c.joinPostUrl).length >= 2 && IG.urlList(c.joinPostUrl).includes('https://www.instagram.com/p/J2/'), '足す');
  const n = IG.urlList(c.joinPostUrl).length;
  r = SP.applyPostUrls(r.text, '', 'https://www.instagram.com/p/J2/?x=1');
  assert.strictEqual(IG.urlList(JSON.parse(r.text).joinPostUrl).length, n, '同じ投稿は足さない');
  r = SP.applyPostUrls(r.text, '消す', '消す');
  c = JSON.parse(r.text);
  assert.strictEqual(c.votePostUrl, ''); assert.strictEqual(c.joinPostUrl, '');
  assert.throws(() => SP.applyPostUrls(src, 'https://example.com/p/AAA/', ''), /インスタの投稿に見えません/);
  // まだ joinPostUrl が無い config にも足せる
  const old = '{\n  "account": "@a",\n  "votePostUrl": "",\n  "votePostUrlNote": "x",\n  "list": [1, 2]\n}\n';
  r = SP.applyPostUrls(old, '', 'https://www.instagram.com/p/Q/');
  assert.strictEqual(JSON.parse(r.text).joinPostUrl, 'https://www.instagram.com/p/Q/');
  assert.ok(r.text.includes('"list": [1, 2]'));
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'set-post.yml'), 'utf8');
  assert.ok(/VOTE_URL: \$\{\{ inputs\.vote_url \}\}/.test(wf) && !/run:.*\$\{\{ inputs/.test(wf), '貼った文字は env で渡す（run に直接入れない）');
});

t('名前から女性・男性：分かる名前だけ当てる（どちらにもある名前・分からない名前は null）', () => {
  const GD = require('../tools/gender');
  const cases = { mayu: 'f', ryusei: 'm', yuki: null, mayu_0312: 'f', 'kenta.official': 'm', yui_chan: 'f', takuya: 'm', _mayu1030: 'f', 'ayano.ay.0907': 'f', naoto68483: 'm',
    hikaru_k: null, sora: null, nao648074: null, peco_1019: null, 'korokke5.5': null, mayuchan: 'f', 'まゆ': 'f', 'ユイ': 'f', kentaro23: 'm', 'mayu_kenta': null };
  for (const [n, g] of Object.entries(cases)) assert.strictEqual(GD.confidentGender(n), g, n);
  // コメントの言葉：「女の子」「女性」「女」「♀」/「男の子」「男性」「男」「♂」。男前・女王などは読まない。両方あれば null
  const W = { '住みたい 女の子': 'f', '住みたい 女性です': 'f', '住みたい 女': 'f', '住みたい♀': 'f', '住みたい 男の子': 'm', '住みたい 男性': 'm', '住みたい 男です': 'm', '住みたい ♂': 'm',
    '住みたい 男前になりたい': null, '住みたい 女王': null, '住みたい 男の子と女の子': null, '住みたい ピッケル': null };
  for (const [t0, g] of Object.entries(W)) assert.strictEqual(GD.parseGenderWord(t0), g, t0);
  // あとからのコメントは、ほぼその言葉だけの時だけ
  assert.strictEqual(GD.parseGenderWord('女の子です', { strict: true }), 'f');
  assert.strictEqual(GD.parseGenderWord('男の子が釣りしてる', { strict: true }), null);
});
t('名前・コメントの性別でスキンの体の種類を合わせる（選んだ見た目は変えない・同じ人はいつも同じ）', () => {
  // 新しく来た人：名前で分かれば skinBody（シードは今の番号のまま）
  const vs = [];
  const a = P.upsertVillager(vs, { igId: 'g1', username: 'mayu_0312', joinedDay: 1, source: 'comment' }, new Set());
  const a2 = P.upsertVillager([], { igId: 'g1', username: 'mayu_0312', joinedDay: 1, source: 'comment' }, new Set());
  assert.ok(P.skinTag(a.skin) === 'f' || a.skinBody === 'female', 'まゆは女性に見える');
  assert.deepStrictEqual([a.skin, a.skinBody], [a2.skin, a2.skinBody], '同じ人は同じ');
  const y = P.upsertVillager(vs, { igId: 'g2', username: 'yuki', joinedDay: 1, source: 'comment' }, new Set());
  assert.ok(!y.skinBody, '分からない人はそのまま');
  // 男性：女性っぽいスキンの時だけ変える。どちらとも・男性っぽいスキンはそのまま（ryusei01040505 の 197 番）
  const r = { key: '51dd020030', name: 'ryusei01040505', skin: 197, source: 'comment' };
  assert.strictEqual(P.fitGenderSkin(r), false); assert.ok(!r.skinBody);
  const fSkin = JSON.parse(fs.readFileSync(path.join(ROOT, 'skins', 'gender.json'), 'utf8')).f[0];
  const k = { key: 'kk', name: 'kenta', skin: fSkin };
  assert.strictEqual(P.fitGenderSkin(k), true); assert.strictEqual(k.skinBody, 'male');
  // プロフィールで選んだ見た目（look）は変えない
  const chose = { key: 'c1', name: 'mayu', skin: 197, look: { body: 'male', seed: 5 } };
  const snap = JSON.stringify(chose);
  assert.strictEqual(P.fitGenderSkin(chose), false); assert.strictEqual(JSON.stringify(chose), snap);
  // コメントの「男の子」が名前より勝つ。あとからのコメントで直せる。選んだ見た目の人は性別だけ残してスキンは変えない
  const cm = (id, text, ts) => ({ from: { id, username: 'mayu' }, text, timestamp: ts });
  const vs2 = []; P.upsertVillager(vs2, { igId: '71', username: 'mayu', joinedDay: 1, source: 'comment' }, new Set());
  P.applyCommentProfiles(vs2, [cm('71', '住みたい 男の子', '2026-11-01T00:00:00Z')], {});
  assert.deepStrictEqual([vs2[0].gender, vs2[0].skinBody || (P.skinTag(vs2[0].skin) !== 'f' ? 'male' : '')], ['m', 'male']);
  P.fitGenderSkin(vs2[0]); assert.strictEqual(vs2[0].gender, 'm', '次の回も名前に戻らない');
  P.applyCommentProfiles(vs2, [cm('71', '住みたい 男の子', '2026-11-01T00:00:00Z'), cm('71', '女の子です', '2026-11-02T00:00:00Z')], {});
  assert.deepStrictEqual([vs2[0].gender, vs2[0].skinBody], ['f', 'female']);
  vs2[0].look = { body: 'male', seed: 3 }; delete vs2[0].skinBody;
  P.applyCommentProfiles(vs2, [cm('71', '男性', '2026-11-03T00:00:00Z')], {});
  assert.ok(vs2[0].gender === 'm' && !vs2[0].skinBody && vs2[0].look.seed === 3);
  // 「住みたい 女の子」の「女の子」を好きな食べ物にしない
  const p = P.parseCommentProfile('住みたい 女の子', { join: true });
  assert.ok(!p.food, JSON.stringify(p));
  // プロフィールの見た目の初めの値（体の種類）も skinBody に合わせる：体の種類を変えないなら引き直しにならない
  const PR = require('../tools/profiles');
  const f = { id: 'look', type: 'skin', public: true };
  const w = [{ key: 'w1', joinedDay: 1, skin: 12, skinBody: 'female' }];
  const rr = PR.applyProfiles(w, { w1: { look: 'female:12:0' } }, {}, [f], { day: 1 });
  assert.ok(!rr.report.rejected.length && !w[0].lookRerolls);
});
t('ユーザー名の数字から誕生日（コメントの誕生日が勝つ・読めない数字は使わない）', () => {
  const B = { '20001018': '10-18', '28514': '05-14', mayu_0312: '03-12', kenta1990: null, abc230: null, user_12: null, '514': '05-14', ryusei01040505: '05-05', 'a19991231b': '12-31', '991231': '12-31' };
  for (const [n, d] of Object.entries(B)) assert.strictEqual(P.nameBirthday(n), d, n);
  const vs = [];
  const v = P.upsertVillager(vs, { igId: 'b1', username: 'mayu_0312', joinedDay: 1, source: 'comment' }, new Set());
  assert.strictEqual(v.birthday, '03-12');
  const w = P.upsertVillager(vs, { igId: 'b2', username: 'mayu_0312x', joinedDay: 1, source: 'comment', birthday: '07-07' }, new Set());
  assert.strictEqual(w.birthday, '07-07', 'コメントの誕生日が勝つ');
  // 数字から決めた日も、あとのコメント「誕生日 1/2」で直せる
  P.applyCommentProfiles(vs, [{ from: { id: 'b1', username: 'mayu_0312' }, text: '誕生日 1/2', timestamp: '2026-11-02T00:00:00Z' }], {});
  assert.strictEqual(v.birthday, '01-02');
  P.fillJoinProfile(v); assert.strictEqual(v.birthday, '01-02', '直した日は戻さない');
  // 前に名前の印から決めた人は、数字の日に変わる（1 回だけ）
  const old = { key: '51dd020030', name: 'ryusei01040505', source: 'comment', birthday: P.autoBirthday('51dd020030') };
  assert.strictEqual(P.fillJoinProfile(old), true); assert.strictEqual(old.birthday, '05-05');
  assert.strictEqual(P.fillJoinProfile(old), false);
  const n0 = P.upsertVillager([], { igId: 'b3', username: 'kenta1990', joinedDay: 1, source: 'comment' }, new Set());
  assert.strictEqual(n0.birthday, P.autoBirthday(n0.key), '読めない人は今まで通り');
});

// ---------- 役職（仕事）の変更 ----------
t('役職の変更：コメントの読み取り（表記ゆれは「住みたい」の道具と同じ）', () => {
  const JB = require('../tools/jobs');
  const cfg = liveCfg();
  const pj = (s, o = {}) => JB.parseJobChange(s, { startTools: cfg.startTools, ...o });
  assert.strictEqual(pj('仕事 釣り'), 'fishing_rod');
  assert.strictEqual(pj('作業 釣り'), 'fishing_rod', '画面の言葉「作業」でも変えられる');
  assert.strictEqual(pj('作業：きこり'), 'axe');
  for (const s of ['作業台を建てよう', '作業がんばって', 'いい作業してるね']) assert.strictEqual(pj(s), null, s);
  assert.strictEqual(pj('役職：きこり'), 'axe');
  assert.strictEqual(pj('役職を漁業に'), 'fishing_rod');
  assert.strictEqual(pj('転職 ツルハシ'), 'pickaxe');
  assert.strictEqual(pj('職業は農業'), 'hoe');
  assert.strictEqual(pj('釣りに転職します'), 'fishing_rod');
  assert.strictEqual(pj('漁業になりたい！'), 'fishing_rod');
  assert.strictEqual(pj('ジョブ　オノ'), 'axe', '全角の空白・カタカナ');
  assert.strictEqual(pj('仕事 剣'), null, '敵が出ない間は剣は選べない');
  assert.strictEqual(pj('仕事 剣', { enemies: true }), 'sword');
  for (const s of ['仕事がんばって', '釣りの仕事たのしそう', '釣り', 'きこり最高', 'いい仕事してるね', 'おつりください', '']) assert.strictEqual(pj(s), null, s);
});
t('役職の変更：住人だけ・1 人 1 日 1 回まで・同じコメントは 2 回使わない・歴史に「〇〇さんが△△から□□になった」', () => {
  const JB = require('../tools/jobs');
  const cfg = liveCfg();
  const S = () => ({
    config: cfg,
    villagers: [
      { key: 'k1', igId: P.igHash('101'), userHash: P.userHash('aki'), name: 'aki', display: 'aki', joinedDay: 1, startTool: 'pickaxe' },
      { key: 'k2', igId: P.igHash('102'), userHash: P.userHash('bou'), name: 'bou', display: 'bou', joinedDay: 1 },
    ],
    life: { k1: { startTool: 'pickaxe', diary: [{ day: 3, date: 'd', text: 'きょう。' }] }, k2: { startTool: 'axe', startAuto: true, diary: [] } },
    history: [],
  });
  const c = (id, u, text, ts, cid) => ({ id: cid, from: { id, username: u }, text, timestamp: ts });
  const cs = [
    c('101', 'aki', '仕事 釣り', '2026-12-01T01:00:00Z', 'c1'), // 日本時間 12/1 10時
    c('101', 'aki', '役職 きこり', '2026-12-01T05:00:00Z', 'c2'), // 同じ日（日本時間）＝使わない
    c('101', 'aki', '転職 くわ', '2026-12-01T16:00:00Z', 'c3'), // 日本時間 12/2 1時＝次の日
    c('102', 'bou', '住みたい 釣り', '2026-12-01T01:00:00Z', 'c4'), // 「住みたい」は読まない
    c('103', 'nobody', '仕事 釣り', '2026-12-01T01:00:00Z', 'c5'), // 住んでいない人
    c('104', 'owner_acc', '仕事 釣り', '2026-12-01T01:00:00Z', 'c6'),
    c('102', 'bou', '仕事 オノ', '2026-12-01T02:00:00Z', 'c7'), // 今と同じ仕事（自動で斧）
  ];
  const s = S();
  const r = JB.applyJobChanges(s, cs, { day: 3, date: 'd', owners: ['owner_acc'] });
  assert.deepStrictEqual(r.map((x) => [x.v.key, x.from, x.to]), [['k1', '採掘', '漁業'], ['k1', '漁業', '農業']]);
  assert.strictEqual(r.rejected, 1, '同じ日の 2 回目');
  assert.deepStrictEqual(s.history.map((h) => h.text), ['akiさんが採掘から漁業になった。', 'akiさんが漁業から農業になった。']);
  assert.ok(s.history.every((h) => h.type === 'event' && h.kind === 'job' && h.who[0] === 'k1'));
  assert.strictEqual(s.villagers[0].startTool, 'hoe');
  assert.strictEqual(s.villagers[1].startTool, undefined, '同じ仕事なら変えない');
  assert.ok(s.life.k1.diary[0].text.startsWith('きょう。作業を採掘から漁業にかえた。'), '今日の日記の後ろ');
  // もう一度読んでも変わらない（15 分ごとに同じコメントを読み直す）
  assert.strictEqual(JB.applyJobChanges(s, cs, { day: 3, date: 'd', owners: ['owner_acc'] }).length, 0);
  assert.strictEqual(s.history.length, 2);
  // perDay を 2 にすると、同じ日の 2 回目も使う
  const s2 = S(); s2.config = { ...cfg, jobChange: { ...cfg.jobChange, perDay: 2 } };
  assert.strictEqual(JB.applyJobChanges(s2, cs, { day: 3, date: 'd' }).length, 3);
  // enabled: false なら読まない
  const s3 = S(); s3.config = { ...cfg, jobChange: { enabled: false } };
  assert.strictEqual(JB.applyJobChanges(s3, cs, { day: 3, date: 'd' }).length, 0);
  assert.ok(cfg.jobChange && cfg.jobChange.note && cfg.jobChange.perDay === 1, 'config に jobChange');
});
t('役職の変更：木の道具を持ちかえる（石の道具は持ったまま・持ち物がいっぱいでも仕事は変わる）', () => {
  const W = require('../tools/welcome');
  const cfg = liveCfg();
  const life = {};
  const v = { key: 'k1', joinedDay: 1, startTool: 'fishing_rod', jobChangedTo: 'fishing_rod' };
  const L = life.k1 = { startTool: 'pickaxe', inv: [{ item: 'wood_pickaxe', dur: 20 }, null, null], xp: 0, diary: [] };
  const note = W.ensureLife(L, v, { day: 3, life, config: cfg });
  assert.strictEqual(L.startTool, 'fishing_rod');
  assert.ok(L.inv.some((s) => s && s.item === 'wood_fishing_rod') && !L.inv.some((s) => s && s.item === 'wood_pickaxe'), L.inv);
  assert.ok(note.includes('作業が漁業になったので'), note);
  // 持ち物がいっぱい：仕事だけ変わる
  const v2 = { key: 'k2', joinedDay: 1, startTool: 'hoe', jobChangedTo: 'hoe' };
  const L2 = life.k2 = { startTool: 'pickaxe', inv: [{ item: 'stone_pickaxe', dur: 50 }, { item: 'log', n: 64 }, { item: 'cobble', n: 64 }], xp: 0, diary: [] };
  const n2 = W.ensureLife(L2, v2, { day: 3, life, config: cfg });
  assert.strictEqual(L2.startTool, 'hoe'); assert.ok(L2.inv.some((s) => s && s.item === 'stone_pickaxe'), '石のつるはしは持ったまま');
  assert.ok(n2.includes('持てなかった'), n2);
});
t('役職の変更：join.js（一時フォルダ）で住人の仕事が変わり、歴史と持ち物に出る', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-job-'));
  const cfg = liveCfg(); cfg.startAt = null;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'jb', '--start', '2026-11-01');
  fs.mkdirSync(path.join(dir, 'inbox'));
  const cm = (id, u, text, ts) => ({ id: u + ts, from: { id, username: u }, text, timestamp: ts });
  const inbox = (cs) => fs.writeFileSync(path.join(dir, 'inbox', 'instagram.json'), JSON.stringify({ joinComments: cs }));
  inbox([cm('9001', 'job_san', '住みたい ピッケル', '2026-11-27T00:00:00Z')]);
  node('tools/join.js', '--now', '2026-11-27T10:00:00+09:00');
  inbox([cm('9001', 'job_san', '住みたい ピッケル', '2026-11-27T00:00:00Z'), cm('9001', 'job_san', '仕事 釣り', '2026-11-27T02:00:00Z'), cm('9001', 'job_san', '仕事 斧', '2026-11-27T03:00:00Z')]);
  const out = node('tools/join.js', '--now', '2026-11-27T12:30:00+09:00');
  assert.ok(out.includes('採掘 → 漁業'), out);
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8')).find((x) => x.name === 'job_san');
  assert.strictEqual(v.startTool, 'fishing_rod', '同じ日の 2 回目（斧）は使わない');
  const h = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).filter((x) => x.kind === 'job');
  assert.deepStrictEqual(h.map((x) => x.text), ['job_sanさんが採掘から漁業になった。']);
  const L = STORE.readLife(dir)[v.key];
  assert.strictEqual(L.startTool, 'fishing_rod');
  assert.ok(L.inv.some((s) => s && s.item === 'wood_fishing_rod'));
  node('tools/join.js', '--now', '2026-11-27T12:45:00+09:00'); // もう一度動かしても増えない
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).filter((x) => x.kind === 'job').length, 1);
  node('tools/sim.js', '--days', '1'); // 日が進んでも同じコメントでは変わらない
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).filter((x) => x.kind === 'job').length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 一週間の対決投票 ----------
const duelCfg = (over = {}) => {
  const c = liveCfg();
  c.versus = { ...c.versus, topics: c.versus.topics.map((x) => ({ ...x })) };
  c.versus.topics[0].postUrl = 'https://www.instagram.com/p/DUEL1/';
  c.versus.topics[0].start = '2026-12-01 06:00';
  return Object.assign(c, over);
};
t('対決投票：A / B の読み取り・割合・残りの日数・称号の一覧', () => {
  const VJ = require('../js/versus.js');
  const cfg = duelCfg();
  const tp = VJ.topicList(cfg)[0];
  assert.deepStrictEqual([tp.id, tp.days, tp.A.color, tp.B.color], ['kinoko_takenoko', 7, '#d64541', '#3f78b8'], 'A 赤・B 青・7 日');
  const pk = (s) => VJ.pickOf(s, tp);
  assert.strictEqual(pk('A'), 'A'); assert.strictEqual(pk('ｂ'), 'B'); assert.strictEqual(pk('B派です'), 'B');
  assert.strictEqual(pk('きのこ！'), 'A'); assert.strictEqual(pk('たけのこの里しか勝たん'), 'B'); assert.strictEqual(pk('キノコ派'), 'A');
  assert.strictEqual(pk('きのこもたけのこも好き'), null, '両方は数えない');
  assert.strictEqual(pk('AとB'), null); assert.strictEqual(pk('INFP'), null); assert.strictEqual(pk('こんにちは'), null);
  assert.deepStrictEqual(VJ.shares({ A: 3, B: 1 }), { A: 75, B: 25, total: 4 });
  assert.deepStrictEqual(VJ.shares({ A: 0, B: 0 }), { A: 50, B: 50, total: 0 });
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.strictEqual(VJ.leftText('2026-12-04T00:00:00Z', now), 'あと 3 日');
  assert.strictEqual(VJ.leftText('2026-12-01T05:00:00Z', now), 'あと 5 時間');
  assert.strictEqual(VJ.leftText('2026-11-30T00:00:00Z', now), '締め切りました');
  const TT = VJ.versusTitles(cfg);
  assert.ok(TT.some((x) => x.id === 'vs_kinoko_takenoko_a' && x.name === 'きのこ派の勝者'));
  assert.strictEqual(new Set(TT.map((x) => x.id)).size, TT.length, '称号の id が重ならない');
  for (const x of TT) assert.ok(/^[a-z0-9_]+$/.test(x.id) && x.name && x.desc && x.how);
  assert.ok(!cfg.titles.list.some((x) => TT.some((y) => y.id === x.id)), 'ふつうの称号と重ならない');
  assert.deepStrictEqual(VJ.versusTitles({ versus: { enabled: false, topics: cfg.versus.topics } }), []);
});
t('対決投票：URL が空なら始まらない・start を過ぎたら始まる・1 人 1 票（最後）・住人でない票も数える・勝った側の住人に経験値と称号', () => {
  const VS = require('../tools/versus');
  const VJ = require('../js/versus.js');
  const c = (id, u, text, ts) => ({ id: u + ts, from: { id, username: u }, text, timestamp: ts });
  const mk = (cfg) => ({
    config: cfg, state: { day: 5 },
    villagers: [
      { key: 'r1', igId: P.igHash('1'), userHash: P.userHash('ra'), display: 'ra', joinedDay: 1 },
      { key: 'r2', igId: P.igHash('2'), userHash: P.userHash('rb'), display: 'rb', joinedDay: 1 },
      { key: 'r3', igId: P.igHash('3'), userHash: P.userHash('rc'), display: 'rc', joinedDay: 1 },
      { key: 'r9', igId: P.igHash('9'), userHash: P.userHash('rz'), display: 'rz', joinedDay: 99 }, // まだ住んでいない
    ],
    life: { r1: { xp: 0, diary: [] }, r2: { xp: 5, diary: [] }, r3: { xp: 0, diary: [] } },
    history: [],
  });
  // URL が空：始まらない（state に何も書かない）
  const s0 = mk(liveCfg());
  assert.strictEqual(VS.stepVersus(s0, { now: new Date('2026-12-02T00:00:00Z'), day: 5, date: 'd' }).changed, false);
  assert.strictEqual(s0.state.versus, undefined);
  assert.strictEqual(VS.targetTopic(liveCfg(), {}), null, 'インスタも読まない');
  // URL あり・start の前：まだ
  const cfg = duelCfg();
  const S = mk(cfg);
  assert.deepStrictEqual(VS.targetTopic(cfg, S.state), { id: 'kinoko_takenoko', postUrl: 'https://www.instagram.com/p/DUEL1/' });
  VS.stepVersus(S, { now: new Date('2026-11-30T00:00:00Z'), day: 5, date: 'd' });
  assert.ok(!S.state.versus || !S.state.versus.current, 'start の前');
  // start を過ぎた：始まる。締め切りは start から 7 日
  const cs = [
    c('1', 'ra', 'きのこ', '2026-12-01T00:00:00Z'), c('1', 'ra', 'たけのこ派に変えます', '2026-12-02T00:00:00Z'), // 最後の票（B）
    c('2', 'rb', 'B', '2026-12-02T00:00:00Z'), c('3', 'rc', 'A', '2026-12-02T00:00:00Z'), c('3', 'rc', 'がんばれー', '2026-12-03T00:00:00Z'), // 票のないコメントは消さない
    c('7', 'guest1', 'たけのこ', '2026-12-02T00:00:00Z'), c('8', 'guest2', 'b', '2026-12-02T00:00:00Z'), // 住人でない人
    c('9', 'rz', 'B', '2026-12-02T00:00:00Z'), c('5', 'comment_de_sodatsu', 'A', '2026-12-02T00:00:00Z'), // 町のアカウントは数えない
    c('6', 'late', 'A', '2026-12-09T00:00:00Z'), // 締め切りのあと
  ];
  const inbox = { versusComments: { id: 'kinoko_takenoko', comments: cs } };
  const r1 = VS.stepVersus(S, { inbox, now: new Date('2026-12-03T00:00:00Z'), day: 5, date: 'd' });
  assert.deepStrictEqual(r1.opened, ['kinoko_takenoko']);
  const cur = S.state.versus.current;
  assert.deepStrictEqual([cur.opensAt, cur.closesAt], ['2026-11-30T21:00:00.000Z', '2026-12-07T21:00:00.000Z']);
  assert.deepStrictEqual(cur.votes, { A: 1, B: 5 }); assert.strictEqual(cur.voters, 6);
  assert.ok(S.history.some((h) => h.type === 'vote_open' && h.kind === 'versus'));
  // 帯：名前は config から。割合と票と残りの日数
  const html = VJ.bandHtml(S.state, cfg, { now: Date.parse('2026-12-03T00:00:00Z') });
  assert.ok(html.includes('きのこ派') && html.includes('たけのこ派') && html.includes('16.7%') && html.includes('83.3%') && html.includes('あと 5 日') && html.includes('instagram.com/p/DUEL1'), html);
  assert.strictEqual(VJ.bandHtml(S.state, liveCfg()), '', 'config の URL を消したら出さない');
  // 締め切り：B の勝ち。B に投票した住人（ra・rb）に経験値と称号。rc（A）と、住んでいない rz にはなし
  const r2 = VS.stepVersus(S, { inbox, now: new Date('2026-12-08T00:00:00Z'), day: 6, date: 'e' });
  assert.strictEqual(r2.closed.length, 1);
  const done = S.state.versus.done[0];
  assert.deepStrictEqual([done.winner, done.votes, done.rewarded], ['B', { A: 1, B: 5 }, 2]);
  assert.strictEqual(S.state.versus.current, undefined);
  const V = (k) => S.villagers.find((v) => v.key === k);
  assert.deepStrictEqual([V('r1').titles, V('r2').titles, V('r3').titles, V('r9').titles], [['vs_kinoko_takenoko_b'], ['vs_kinoko_takenoko_b'], undefined, undefined]);
  assert.deepStrictEqual([S.life.r1.xp, S.life.r2.xp, S.life.r3.xp], [30, 35, 0]);
  assert.ok(S.life.r1.level >= 1 && S.life.r1.diary[0].text.includes('称号「たけのこ派の勝者」'));
  const res = S.history.find((h) => h.type === 'vote_result' && h.kind === 'versus');
  assert.ok(res.text.includes('たけのこ派の勝ち') && res.text.includes('住人 2 人') && res.text.includes('たけのこ派の勝者'), res.text);
  assert.ok(S.history.some((h) => h.type === 'title' && h.title === 'vs_kinoko_takenoko_b'));
  // 結果の帯（1 日だけ）と、これまでの対決
  assert.ok(VJ.bandHtml(S.state, cfg, { now: Date.parse('2026-12-08T01:00:00Z') }).includes('たけのこ派の勝ち'));
  assert.strictEqual(VJ.bandHtml(S.state, cfg, { now: Date.parse('2026-12-10T00:00:00Z') }), '');
  assert.ok(VJ.pastHtml(S.state, cfg).includes('たけのこ派の勝ち'));
  // もう一度動かしても、ごほうびは増えない。次のお題は URL が空なので始まらない
  VS.stepVersus(S, { inbox, now: new Date('2026-12-08T00:15:00Z'), day: 6, date: 'e' });
  assert.deepStrictEqual([S.life.r1.xp, S.state.versus.done.length, S.state.versus.current], [30, 1, undefined]);
  // 次のお題に URL を貼る：前のお題の締め切りより後で始まる（start なし＝貼って最初の受付の時）
  cfg.versus.topics[1].postUrl = 'https://www.instagram.com/p/DUEL2/';
  assert.deepStrictEqual(VS.targetTopic(cfg, S.state), { id: 'dog_cat', postUrl: 'https://www.instagram.com/p/DUEL2/' });
  VS.stepVersus(S, { inbox: { versusComments: { id: 'dog_cat', comments: [c('1', 'ra', '犬', '2026-12-08T03:00:00Z'), c('2', 'rb', '猫', '2026-12-08T03:00:00Z')] } }, now: new Date('2026-12-08T04:00:00Z'), day: 6, date: 'e' });
  const c2 = S.state.versus.current;
  assert.deepStrictEqual([c2.id, c2.opensAt, c2.votes], ['dog_cat', '2026-12-08T04:00:00.000Z', { A: 1, B: 1 }]);
  // 引き分け：投票した住人みんなに tieXp、称号なし
  VS.stepVersus(S, { inbox: { versusComments: { id: 'dog_cat', comments: [c('1', 'ra', '犬', '2026-12-08T03:00:00Z'), c('2', 'rb', '猫', '2026-12-08T03:00:00Z')] } }, now: new Date('2026-12-15T05:00:00Z'), day: 13, date: 'f' });
  const d2 = S.state.versus.done[1];
  assert.deepStrictEqual([d2.id, d2.winner, d2.tie, d2.rewarded], ['dog_cat', null, true, 2]);
  assert.deepStrictEqual([S.life.r1.xp, S.life.r2.xp], [40, 45]);
  assert.ok(!S.villagers.some((v) => (v.titles || []).some((x) => x.startsWith('vs_dog_cat'))), '引き分けは称号なし');
  assert.ok(S.history.some((h) => h.kind === 'versus' && h.tie && h.text.includes('引き分け')));
});
t('対決投票：締め切りの時にコメントが読めなければ待つ・待ってもだめなら最後の票で決める（ごほうびなし）・票がなければごほうびなし', () => {
  const VS = require('../tools/versus');
  const cfg = duelCfg();
  const S = { config: cfg, state: {}, villagers: [], life: {}, history: [] };
  VS.stepVersus(S, { now: new Date('2026-12-01T00:00:00Z'), day: 1, date: 'a' });
  S.state.versus.current.votes = { A: 2, B: 1 };
  VS.stepVersus(S, { now: new Date('2026-12-08T00:00:00Z'), day: 8, date: 'b' });
  assert.ok(S.state.versus.current && S.state.versus.current.closing, '読めるまで待つ');
  assert.ok(require('../js/versus.js').bandHtml(S.state, cfg, { now: Date.parse('2026-12-08T00:00:00Z') }).includes('集計中'));
  VS.stepVersus(S, { now: new Date('2026-12-09T00:00:00Z'), day: 9, date: 'c' });
  assert.deepStrictEqual([S.state.versus.done[0].winner, S.state.versus.done[0].rewarded], ['A', 0]);
  // 票なし
  const S2 = { config: duelCfg(), state: {}, villagers: [], life: {}, history: [] };
  VS.stepVersus(S2, { inbox: { versusComments: { id: 'kinoko_takenoko', comments: [] } }, now: new Date('2026-12-09T00:00:00Z'), day: 9, date: 'c' });
  assert.deepStrictEqual([S2.state.versus.done[0].winner, S2.state.versus.done[0].tie], [null, false]);
  assert.ok(S2.history.some((h) => h.text.includes('票が入らなかった')));
});
t('対決投票：join.js（一時フォルダ）で数えて締め、画面の決まった文言にお題の言葉を入れない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-duel-'));
  const cfg = duelCfg(); cfg.startAt = null;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'du', '--start', '2026-11-01');
  fs.mkdirSync(path.join(dir, 'inbox'));
  const cm = (id, u, text, ts) => ({ id: u + ts, from: { id, username: u }, text, timestamp: ts });
  fs.writeFileSync(path.join(dir, 'inbox', 'instagram.json'), JSON.stringify({
    joinComments: [cm('51', 'duel_a', '住みたい', '2026-11-30T00:00:00Z'), cm('52', 'duel_b', '住みたい', '2026-11-30T00:00:00Z')],
    versusComments: { id: 'kinoko_takenoko', comments: [cm('51', 'duel_a', 'きのこ', '2026-12-01T00:00:00Z'), cm('52', 'duel_b', 'B', '2026-12-01T00:00:00Z'), cm('53', 'guest', 'A', '2026-12-01T00:00:00Z')] },
  }));
  node('tools/join.js', '--now', '2026-12-02T10:00:00+09:00');
  let st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.deepStrictEqual(st.versus.current.votes, { A: 2, B: 1 });
  const out = node('tools/join.js', '--now', '2026-12-08T07:00:00+09:00');
  assert.ok(out.includes('対決投票を締めました'), out);
  st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(st.versus.done[0].winner, 'A');
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.ok(vs.find((v) => v.name === 'duel_a').titles.includes('vs_kinoko_takenoko_a'));
  assert.ok(!(vs.find((v) => v.name === 'duel_b').titles || []).some((x) => x.startsWith('vs_')));
  assert.strictEqual(STORE.readLife(dir)[vs.find((v) => v.name === 'duel_a').key].xp, 30);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8')).some((h) => h.kind === 'versus' && h.type === 'vote_result'));
  fs.rmSync(dir, { recursive: true, force: true });
  // 画面の決まった文言：お題の言葉（商品名など）は config からだけ出す
  for (const f of ['js/versus.js', 'js/town.js', 'vote.html', 'badges.html', 'js/common.js', 'tools/versus.js', 'tools/jobs.js', 'css/style.css']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const w of ['きのこ', 'たけのこ', 'キノコ', 'タケノコ']) assert.ok(!src.includes(w), `${f} に「${w}」`);
  }
  for (const f of ['js/versus.js', 'tools/versus.js', 'tools/jobs.js']) assert.ok(!/マイクラ|マインクラフト/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
  assert.ok(/versusBand\(state, config\)/.test(fs.readFileSync(path.join(ROOT, 'js/town.js'), 'utf8')), '町の画面に帯');
  assert.ok(/versusBand\(state, config, \{ big: true \}\)/.test(fs.readFileSync(path.join(ROOT, 'vote.html'), 'utf8')), '投票の画面に帯');
});
at('対決投票：instagram.js は対決の投稿のコメントを versusComments に入れる（URL が空なら読まない）', async () => {
  const cfg = duelCfg(); cfg.votePostUrl = 'https://www.instagram.com/p/VOTE1/';
  cfg.versus.topics[0].postUrl = 'https://www.instagram.com/p/OLD/'; // 対決の投稿（古くても読む）
  fakeIG(MEDIA, CM);
  const r = await IG.collect({ cfg, env: {}, userId: 'U1', token: 'T', now: NOW_IG, log: () => {}, state: {} });
  assert.deepStrictEqual([r.data.versusComments.id, r.data.versusComments.comments.map((c) => c.id)], ['kinoko_takenoko', ['c5']]);
  assert.ok(r.data.joinComments.some((c) => c.id === 'c5'), '対決の投稿の「住みたい」も受け付ける');
  // 投票中のお題があれば、そのお題の投稿
  fakeIG(MEDIA, CM);
  const r2 = await IG.collect({ cfg, env: {}, userId: 'U1', token: 'T', now: NOW_IG, log: () => {}, state: { versus: { current: { id: 'kinoko_takenoko', postUrl: '' }, done: [] } } });
  assert.strictEqual(r2.data.versusComments.id, 'kinoko_takenoko');
  // URL が空なら読まない
  const calls = fakeIG(MEDIA, CM);
  const r3 = await IG.collect({ cfg: { ...liveCfg(), votePostUrl: 'https://www.instagram.com/p/VOTE1/' }, env: {}, userId: 'U1', token: 'T', now: NOW_IG, log: () => {}, state: {} });
  assert.strictEqual(r3.data.versusComments, undefined);
  assert.ok(!calls.some((c) => /\/333\/comments/.test(c)));
  IG._setFetch(null);
});
at('町の画面：年表は config.episodes から、空なら歴史の日ごとに作る。@名前 はチップ', async () => {
  const P = await import(require('url').pathToFileURL(path.join(ROOT, 'js', 'islandpanel.js')).href);
  const V = [{ key: 'k1', name: 'aki_01', display: 'aki_01', joinedDay: 0 }, { key: 'k2', name: 'momo', display: 'momo', joinedDay: 1 }, { key: 'k3', name: 'secret', display: 'ないしょ', hidden: true, joinedDay: 1 }];
  const H = [{ day: 0, date: '2026-11-26', type: 'start', text: '島が始まった' }, { day: 0, date: '2026-11-26', type: 'join', text: 'aki_01 が住んだ', who: ['k1'] },
    { day: 1, date: '2026-11-27', type: 'join', text: 'momo が住んだ', who: ['k2', 'k3'] }, { day: 1, date: '2026-11-27', type: 'title', text: 'momo に称号', who: ['k2'] }];
  const auto = P.buildEpisodes({ episodes: [] }, H, V);
  assert.deepStrictEqual(auto.map((e) => [e.no, e.date, e.title, e.pop]), [[1, '11/26', '島のはじまり', 1], [2, '11/27', '2人が引っこしてきた', 3]]);
  assert.strictEqual(auto[1].lines[0].text, '2人が島に住みはじめた');
  const html = P.timelineHtml({}, H, V);
  assert.ok(html.includes('data-key="k2"') && html.includes('第2話') && html.includes('● 住民 3人'));
  assert.ok(!html.includes('secret'), 'かくしている人のユーザー名は出さない');
  const cfg = { episodes: [{ no: 1, date: '11/19', title: 'はじめの島', icon: '🌱', pop: 0, lines: ['🏠 家が建った', '👑 店長 @aki_01'] }] };
  const e = P.buildEpisodes(cfg, H, V);
  assert.deepStrictEqual(e[0].lines.map((l) => l.icon), ['🏠', '👑']);
  const h2 = P.timelineHtml(cfg, H, V);
  assert.ok(h2.includes('class="vchip" data-key="k1"') && h2.includes('第1話 <span>11/19</span>'));
  assert.ok(P.storyHtml(H, V).includes('1日目'));
  assert.ok(!/マイクラ|マインクラフト/.test(fs.readFileSync(path.join(ROOT, 'js', 'islandpanel.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
});

// ---------- DM で入居（tools/dm.js・join.js・tools/webhook/worker.mjs。docs/DMで入居する手順.md） ----------
t('DM で入居：言葉の読み取り・config は切ってある・返事の文', () => {
  const DM = require('../tools/dm');
  const cfg = liveCfg();
  assert.strictEqual(typeof cfg.dm.enabled, 'boolean', 'dm.enabled は true / false');
  for (const w of ['住みたい', 'すみたい', '入居', '入村']) assert.ok(cfg.dm.words.includes(w), w);
  for (const s of ['住みたい', '入居したいです！', '入村 ピッケル', 'わたしも住みたい 12/11 りんご']) assert.ok(DM.dmJoinWord(s, cfg.dm.words), s);
  for (const s of ['住みたくない', '入居しない', 'こんにちは', '参加しない', '']) assert.strictEqual(DM.dmJoinWord(s, cfg.dm.words), null, s);
  assert.strictEqual(DM.houseUrl(DM.dmConfig(cfg), 'abc123'), 'https://hajimarijima.github.io/?v=abc123');
  assert.ok(/フォロー/.test(cfg.dm.messages.notFollowing) && /\{url\}/.test(cfg.dm.messages.welcome) && /\{url\}/.test(cfg.dm.messages.already));
  assert.ok(/DM/.test(cfg.dm.howTo) && cfg.dm.howToSteps.length >= 2, 'サイトの住み方に使う文');
  // 切ってある時は何もしない
  const S = { villagers: [] };
  const r = DM.dmJoins(S, [{ id: 'a'.repeat(32), igsid: '5551', username: 'dm_taro', follows: true, text: '住みたい', at: '2026-11-27T01:00:00Z' }], { config: { ...cfg, dm: { ...cfg.dm, enabled: false } }, hidden: new Set(), date: '2026-11-27', day: 0 });
  assert.strictEqual(r.registered.length + r.replies.length, 0); assert.strictEqual(S.villagers.length, 0);
});
t('DM で入居：コメントと同じ人は二重にならない・フォローしていない人・道具と誕生日も読む・名前をかくす人はあだ名', () => {
  const DM = require('../tools/dm');
  const cfg = liveCfg(); cfg.dm.enabled = true;
  const S = { villagers: [] };
  // 先にコメントで住んだ人（from.id 9001）
  P.upsertVillager(S.villagers, { igId: '9001', username: 'kaito_a', joined: '2026-11-27', joinedDay: 0, source: 'comment' }, new Set());
  const id = (n) => String(n).repeat(32).slice(0, 32);
  const hidden = new Set([P.userHash('secret_dm')]);
  const dms = [
    { id: id(1), igsid: '9001', username: 'kaito_a', follows: true, text: '住みたい', at: '2026-11-27T01:00:00Z' }, // 同じ ID
    { id: id(2), igsid: '7777', username: 'kaito_a', follows: true, text: '入居', at: '2026-11-27T01:01:00Z' }, // ID の形がちがっても名前で同じ人
    { id: id(3), igsid: '8001', username: 'new_mai', follows: true, text: '住みたい ピッケル 12月11日 りんご', at: '2026-11-27T01:02:00Z' },
    { id: id(4), igsid: '8001', username: 'new_mai', follows: true, text: '入村', at: '2026-11-27T01:03:00Z' }, // 続けて送っても返事は 1 つ
    { id: id(5), igsid: '8002', username: 'no_follow', follows: false, text: '住みたい', at: '2026-11-27T01:04:00Z' },
    { id: id(6), igsid: '8003', username: 'secret_dm', follows: null, text: '住みたい', at: '2026-11-27T01:05:00Z' }, // フォローが分からない時は通す
    { id: id(7), igsid: '8004', username: 'town_owner', follows: true, text: '住みたい', at: '2026-11-27T01:06:00Z' },
    { id: id(8), igsid: '8005', username: 'chat_only', follows: true, text: 'こんにちは', at: '2026-11-27T01:07:00Z' },
    { id: id(9), igsid: '8006', username: null, follows: true, text: '住みたい', at: '2026-11-27T01:08:00Z' }, // 名前が引けなかった
  ];
  const r = DM.dmJoins(S, dms, { config: cfg, owners: ['town_owner'], hidden, date: '2026-11-27', day: 0 });
  assert.deepStrictEqual(r.registered.map((v) => v.display).sort(), [P.nickname(r.registered.find((v) => v.hidden).key), 'new_mai'].sort());
  assert.strictEqual(S.villagers.filter((v) => v.name === 'kaito_a').length, 1, 'コメントと DM で二重にならない');
  const kaito = S.villagers.find((v) => v.name === 'kaito_a');
  assert.ok(kaito.igAlt && kaito.igAlt.includes(P.igHash('7777')), 'ちがう形の ID は印で覚える');
  assert.strictEqual(P.findVillager(S.villagers, { igId: '7777' }), kaito, '次からは ID だけでも同じ人');
  const mai = S.villagers.find((v) => v.name === 'new_mai');
  assert.strictEqual(mai.startTool, 'pickaxe'); assert.strictEqual(mai.birthday, '12-11'); assert.strictEqual(mai.profile.food, 'りんご');
  assert.strictEqual(mai.source, 'comment'); assert.strictEqual(mai.via, 'dm');
  assert.ok(!S.villagers.some((v) => v.name === 'no_follow' || v.name === 'town_owner' || v.name === 'chat_only'));
  for (const v of S.villagers) P.applyPrivacy(v, hidden);
  const rep = DM.replyTexts(r, cfg);
  const of = (n) => rep.find((x) => x.ids.includes(id(n)));
  assert.strictEqual(rep.reduce((a, x) => a + x.ids.length, 0), 9, 'どの DM も消す');
  assert.strictEqual(of(3), of(4)); assert.deepStrictEqual(of(3).ids, [id(3), id(4)]);
  assert.strictEqual(of(3).text, 'new_maiさん、はじまり島へようこそ！あなたの家はこちら（あなた専用のリンクです。人に教えないでね）→ {me}', 'リンクの場所は {me} 1 つ（受け口が専用のリンクに置きかえる）');
  assert.strictEqual(of(3).villager, mai.key); assert.strictEqual(of(3).house, `https://hajimarijima.github.io/?v=${mai.key}`);
  assert.strictEqual(of(1).kind, 'already'); assert.ok(of(1).house.endsWith('?v=' + kaito.key) && of(2).house.endsWith('?v=' + kaito.key) && of(1).text.endsWith('→ {me}'), '元の家のリンク');
  assert.strictEqual(of(5).kind, 'notFollowing'); assert.ok(/フォローしてから/.test(of(5).text));
  const sec = S.villagers.find((v) => v.hidden);
  assert.ok(of(6).text.startsWith(sec.display + 'さん') && !of(6).text.includes('secret_dm'), 'かくす人はあだ名');
  assert.strictEqual(of(7).text, null); assert.strictEqual(of(8).text, null);
  assert.strictEqual(of(9).kind, 'retry');
  assert.ok(!JSON.stringify(S.villagers).includes('secret_dm') && !JSON.stringify(S.villagers).includes('8003') && !JSON.stringify(S.villagers).includes('7777'), '公開データに IGSID・かくす名前を書かない');
});
t('DM で入居：join.js（一時フォルダ）で住み、返事のファイルを inbox/ に書く・公開ファイルに IGSID がない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-dm-'));
  const cfg = liveCfg(); cfg.startAt = null; cfg.dm.enabled = true;
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const env = { ...process.env, TOWN_DATA: dir, TOWN_SALT: 'dm-test-salt', TOWN_SALT_QUIET: '1' };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'dm', '--start', '2026-11-01');
  fs.mkdirSync(path.join(dir, 'inbox'));
  fs.writeFileSync(path.join(dir, 'inbox', 'instagram.json'), JSON.stringify({ joinComments: [{ from: { id: '424242', username: 'comment_first' }, text: '住みたい', timestamp: '2026-11-27T00:00:00Z' }] }));
  const id = (c) => c.repeat(32);
  fs.writeFileSync(path.join(dir, 'inbox', 'dm.json'), JSON.stringify({ items: [
    { id: id('a'), igsid: '31415926', username: 'dm_hana', follows: true, text: '住みたい 釣り 3/14', at: '2026-11-27T01:00:00Z' },
    { id: id('b'), igsid: '424242', username: 'comment_first', follows: true, text: '入居', at: '2026-11-27T01:00:00Z' },
  ] }));
  const out = node('tools/join.js', '--now', '2026-11-27T10:00:00+09:00');
  assert.ok(!/dm_hana|31415926/.test(out), 'ログに名前・IGSID を出さない');
  const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.strictEqual(vs.length, 2, 'コメントの人と DM の人。二重にならない');
  const hana = vs.find((v) => v.name === 'dm_hana');
  assert.ok(hana && hana.joinedDay === 0 && hana.birthday === '03-14');
  const life = STORE.readLife(dir);
  assert.ok(life[hana.key], 'その場で町に迎える');
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'inbox', 'dm_replies.json'), 'utf8')).items;
  assert.ok(rep.find((x) => x.ids[0] === id('a')).house.endsWith('?v=' + hana.key));
  assert.strictEqual(rep.find((x) => x.ids[0] === id('b')).kind, 'already');
  const pub = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(!pub.includes('31415926') && !pub.includes('424242'), '公開ファイルに IGSID がない');
  // 次の受付（dm.json がない）では、古い返事のファイルを消す
  fs.unlinkSync(path.join(dir, 'inbox', 'dm.json'));
  node('tools/join.js', '--now', '2026-11-27T10:15:00+09:00');
  assert.ok(!fs.existsSync(path.join(dir, 'inbox', 'dm_replies.json')));
  // サイトの受け口（?v=）と、住み方の文
  const tj = fs.readFileSync(path.join(ROOT, 'js', 'town.js'), 'utf8');
  assert.ok(/QS\.get\('v'\)[^\n]*flyTo\(\(\) => \(\{ x: p\.ch\.position\.x/.test(tj) && /openCard\(p\.v\)/.test(tj), 'town.js の ?v= の受け口（本人に寄ってカードを開く）');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'join.yml'), 'utf8');
  assert.ok(/node tools\/dm\.js pull/.test(wf) && /node tools\/dm\.js done/.test(wf) && /DM_QUEUE_TOKEN: \$\{\{ secrets\.DM_QUEUE_TOKEN \}\}/.test(wf), 'join.yml が DM を読んで返事する');
  assert.ok(wf.indexOf('dm.js done') > wf.indexOf('git push'), '返事はコミットのあと');
});
at('DM で入居：受け口（worker.mjs）が messages の Webhook を積む・/dm/queue・/dm/done で返事', async () => {
  const W = await import(require('url').pathToFileURL(path.join(ROOT, 'tools', 'webhook', 'worker.mjs')).href);
  const crypto = require('crypto');
  W._resetDmConfig();
  const store = new Map();
  const kv = {
    get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v, o) => { store.set(k, v); kv.ttl = o && o.expirationTtl; },
    delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
  const TOKEN = 'q'.repeat(24);
  const env = { META_APP_SECRET: 'APPSECRET', IG_TOKEN: 'IGtest', TOWN_KV: kv, GH_DISPATCH_TOKEN: 'gh', DM_QUEUE_TOKEN: TOKEN };
  let dmEnabled = true;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push({ u, init });
    if (u.endsWith('/data/config.json')) return new Response(JSON.stringify({ dm: { enabled: dmEnabled, words: ['住みたい', '入居'] } }), { status: 200 });
    if (/graph\.instagram\.com\/v21\.0\/5001\?fields=username,name,is_user_follow_business/.test(u)) return new Response(JSON.stringify({ username: 'dm_user', name: 'DM', is_user_follow_business: true }), { status: 200 });
    if (/\/me\/messages$/.test(u)) return new Response('{"message_id":"m"}', { status: 200 });
    if (/api\.github\.com/.test(u)) return new Response(null, { status: 204 });
    return new Response('{}', { status: 404 });
  };
  const post = async (payload) => {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const sig = 'sha256=' + crypto.createHmac('sha256', 'APPSECRET').update(body).digest('hex');
    const waits = [];
    const res = await W.default.fetch(new Request('https://w.example/', { method: 'POST', body, headers: { 'X-Hub-Signature-256': sig } }), env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  const msg = (sid, mid, text, extra = {}) => ({ sender: { id: sid }, recipient: { id: '17841' }, timestamp: Date.now(), message: { mid, text, ...extra } });
  try {
    // 偽の Webhook：ふつうの DM・入居の DM・自分の送った物（echo）・自分のアカウント
    assert.deepStrictEqual(W.dmMessages({ object: 'instagram', entry: [{ id: '17841', messaging: [msg('5001', 'mA', '住みたい'), msg('5002', 'mE', '住みたい', { is_echo: true }), msg('17841', 'mO', '住みたい')] }] }).map((m) => m.mid), ['mA']);
    assert.strictEqual(W.dmMessages({ object: 'instagram', entry: [{ id: '1', changes: [{ field: 'messages', value: msg('5003', 'mC', '入居') }] }] }).length, 1, 'テスト送信の形も読む');
    let res = await post({ object: 'instagram', entry: [{ id: '17841', messaging: [msg('5001', 'mid.1', '住みたい ピッケル'), msg('5001', 'mid.2', 'こんにちは')] }] });
    assert.strictEqual(res.status, 200);
    const keys = [...store.keys()].filter((k) => k.startsWith('dmq:'));
    assert.strictEqual(keys.length, 1, '入居の言葉の DM だけ積む');
    const item = JSON.parse(store.get(keys[0]));
    assert.deepStrictEqual({ u: item.username, f: item.follows, s: item.igsid }, { u: 'dm_user', f: true, s: '5001' });
    assert.ok(kv.ttl <= 24 * 3600, '24 時間で消える');
    const gh = calls.filter((c) => /api\.github\.com/.test(c.u));
    assert.strictEqual(gh.length, 1);
    const ghBody = JSON.parse(gh[0].init.body);
    assert.strictEqual(ghBody.event_type, 'ig-dm');
    assert.ok(!/5001|dm_user|住みたい/.test(gh[0].init.body), 'GitHub には中身を送らない');
    assert.ok(calls.every((c) => !/access_token=/.test(c.u) || !/IGtest/.test(c.u)), 'トークンは URL に入れない');
    // Meta の送り直しは積み直さない
    await post({ object: 'instagram', entry: [{ id: '17841', messaging: [msg('5001', 'mid.1', '住みたい ピッケル')] }] });
    assert.strictEqual([...store.keys()].filter((k) => k.startsWith('dmq:')).length, 1);
    // /dm/queue：合言葉がないと読めない
    res = await W.default.fetch(new Request('https://w.example/dm/queue'), env, { waitUntil() {} });
    assert.strictEqual(res.status, 403);
    res = await W.default.fetch(new Request('https://w.example/dm/queue', { headers: { Authorization: 'Bearer ' + TOKEN } }), env, { waitUntil() {} });
    const q = await res.json();
    assert.strictEqual(q.items.length, 1); assert.strictEqual(q.items[0].text, '住みたい ピッケル');
    // tools/dm.js の pull / done も同じ受け口で
    const DM = require('../tools/dm');
    const fetchFn = (u, init) => W.default.fetch(new Request(u, init), env, { waitUntil() {} });
    const pulled = await DM.pull({ env: { DM_QUEUE_URL: 'https://w.example/', DM_QUEUE_TOKEN: TOKEN }, fetchFn });
    assert.strictEqual(pulled[0].id, q.items[0].id);
    calls.length = 0;
    const r = await DM.done([{ ids: [pulled[0].id], text: 'ようこそ → https://hajimarijima.github.io/?v=k1' }], { env: { DM_QUEUE_URL: 'https://w.example', DM_QUEUE_TOKEN: TOKEN }, fetchFn });
    assert.deepStrictEqual(r, { sent: 1, removed: 1 });
    const send = calls.find((c) => /\/me\/messages$/.test(c.u));
    assert.ok(send && /graph\.instagram\.com/.test(send.u));
    assert.deepStrictEqual(JSON.parse(send.init.body), { recipient: { id: '5001' }, message: { text: 'ようこそ → https://hajimarijima.github.io/?v=k1' } });
    assert.strictEqual(send.init.headers.Authorization, 'Bearer IGtest');
    assert.strictEqual([...store.keys()].filter((k) => k.startsWith('dmq:')).length, 0, '返したら消す');
    // 24 時間を過ぎた DM には返事しない（消すだけ）
    store.set('dmq:' + 'c'.repeat(32), JSON.stringify({ igsid: '5009', text: '住みたい', at: new Date(Date.now() - 25 * 3600e3).toISOString() }));
    calls.length = 0;
    res = await W.default.fetch(new Request('https://w.example/dm/done', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ items: [{ ids: ['c'.repeat(32)], text: 'x' }] }) }), env, { waitUntil() {} });
    assert.deepStrictEqual(await res.json(), { sent: 0, removed: 1 });
    assert.ok(!calls.some((c) => /messages$/.test(c.u)));
    // /dm/done も合言葉がないと使えない・合言葉が短い時は使えない
    res = await W.default.fetch(new Request('https://w.example/dm/done', { method: 'POST', body: '{}' }), env, { waitUntil() {} });
    assert.strictEqual(res.status, 403);
    res = await W.default.fetch(new Request('https://w.example/dm/queue', { headers: { Authorization: 'Bearer short' } }), { ...env, DM_QUEUE_TOKEN: 'short' }, { waitUntil() {} });
    assert.strictEqual(res.status, 403);
    // サイトの config で切ってある時は積まない
    W._resetDmConfig(); dmEnabled = false;
    await post({ object: 'instagram', entry: [{ id: '17841', messaging: [msg('5001', 'mid.3', '住みたい')] }] });
    assert.strictEqual([...store.keys()].filter((k) => k.startsWith('dmq:')).length, 0, 'dm.enabled が false なら積まない');
  } finally { globalThis.fetch = realFetch; W._resetDmConfig(); }
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'webhook', 'worker.mjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'tools', 'dm.js'), 'utf8');
  assert.ok(!/ghp_|github_pat_|IGQ|EAA[A-Za-z0-9]{10}/.test(src), '鍵をコードに書かない');
});

// ---------- 島の決まり：動物は攻撃すると逃げる（肉は柵で囲ってから）・海にはサメがいて入れない ----------
t('動物の体と柵：柵の中の置き場は重ならず柵に入る・外の動物は柵にかからない・逃げる向きは反対', () => {
  const AM = require('../js/animalmove.js');
  for (const rot of [0, 0.7, Math.PI / 2]) {
    const pen = { x: 10, z: -4, rot };
    for (const kind of Object.keys(AM.BODY)) {
      const qs = [];
      for (let i = 0; i < 9; i++) {
        const s = AM.penSlot(i), w = AM.toWorld(pen, s.x, s.z), q = AM.bodyQuad(kind, w.x, w.z, s.face + rot);
        assert.ok(AM.insidePen(pen, q), `${kind} の置き場 ${i} が柵からはみ出す（rot ${rot}）`);
        for (const o of qs) assert.ok(!AM.quadsOverlap(q, o), `${kind} の置き場が重なる ${i}`);
        qs.push(q);
      }
      // 柵ぎわ・外の点
      assert.ok(!AM.insidePen(pen, AM.bodyQuad(kind, pen.x, pen.z, rot + 0).map((v) => ({ x: v.x + 30, z: v.z }))), '柵の外は中ではない');
      const edge = AM.toWorld(pen, AM.PEN.half, 0);
      assert.ok(!AM.clearOfPen(pen, AM.bodyQuad(kind, edge.x, edge.z, 0)), '柵の線にかかる体はだめ');
      const far = AM.toWorld(pen, 9, 0);
      assert.ok(AM.clearOfPen(pen, AM.bodyQuad(kind, far.x, far.z, 1.2)), '遠くの体は柵にかからない');
    }
    // 柵の点の線はぐるり（門もふさがっている）
    const pts = AM.penFencePoints(pen, 0.9);
    for (const p of pts) { const l = AM.toLocal(pen, p.x, p.z); assert.ok(Math.abs(Math.max(Math.abs(l.x), Math.abs(l.z)) - AM.PEN.half) < 1e-6, '柵の点は柱の線の上'); }
    const gate = AM.toWorld(pen, 0, AM.PEN.half);
    assert.ok(pts.some((p) => Math.hypot(p.x - gate.x, p.z - gate.z) < 0.5), '門の所にも柵の点（人も動物も通れない）');
    const out = AM.outsidePen(pen, 3.0, 0.5, 0.95), lo = AM.toLocal(pen, out.x, out.z);
    assert.ok(Math.max(Math.abs(lo.x), Math.abs(lo.z)) > AM.PEN.half + 0.9, '人は柵の外に立つ');
  }
  // 逃げる向き：おそった人と反対。前は (cos, -sin)
  const h = AM.fleeHeading({ x: 0, z: 0 }, { x: 3, z: 0 }, null, () => true), f = AM.fwd(h);
  assert.ok(f.x > 0.99, '人と反対へ逃げる ' + h);
  const h2 = AM.fleeHeading({ x: 0, z: 0 }, { x: 3, z: 0 }, 0, (a) => Math.abs(AM.angDiff(a, 0)) > 0.6);
  assert.ok(h2 !== null && AM.fwd(h2).x > 0, 'まっすぐ行けなければ少しずらして、やはり離れる向き');
  assert.strictEqual(AM.fleeHeading({ x: 0, z: 0 }, { x: 3, z: 0 }, 0, () => false), null, '追いつめられたら止まる');
  // 動物の向きと進む向き：faceOf → fwd でもどる（横歩き・後ろ歩きをしない向きの決まり）
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0.3], [0.2, -1]]) { const v = AM.fwd(AM.faceOf(dx, dz)), L = Math.hypot(dx, dz); assert.ok(Math.abs(v.x - dx / L) < 1e-9 && Math.abs(v.z - dz / L) < 1e-9); }
});
t('海のサメ：背びれは沖だけ（陸・浜・橋・桟橋に近づくと沈む）・進む向きを向く・ときどき見える', () => {
  const AM = require('../js/animalmove.js');
  const cfg = liveCfg(), S = cfg.sea;
  assert.ok(S && S.sharks >= 1 && S.margin >= 5, 'config.sea');
  const w = STORE.readWorld(path.join(ROOT, 'data')); // 読むだけ
  const world = { ...w, buildings: [...w.buildings, { id: 'dk', type: 'dock', x: 0, z: 49 }] }; // 桟橋があっても近づかない
  let shown = 0;
  for (let k = 0; k < S.sharks; k++) for (let tt = 0; tt < 3000; tt += 0.5) {
    const p = AM.sharkPos(world, k, tt, S);
    if (p.rise <= 0.03) continue;
    shown++;
    assert.ok(AM.seaClear(world, p.x, p.z) > S.margin - 1e-6, `サメが陸・橋・桟橋に近い ${k} ${tt} ${p.x},${p.z}`);
    assert.ok(!AM.nearLand(world, p.x, p.z, S.margin), '浜に上がらない');
    const q = AM.sharkPos(world, k, tt + 0.5, S), v = AM.fwd(p.face), dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz);
    assert.ok(L > 0.3 && (v.x * dx + v.z * dz) / L > 0.95, '進む向きを向く');
  }
  assert.ok(shown > 500, 'ときどき水面に出る ' + shown);
  assert.strictEqual(AM.sharkPos({ buildings: [] }, 0, 1, S), null, '島の町でなければ出ない');
});
t('動物を追う：柵がないと逃げられる（日記・歴史）→ 柵が候補の前へ → 柵の中ならしとめて肉・子も生まれる', () => {
  const HR = require('../js/hours.js');
  assert.strictEqual(HR.parseCode('ht:a3').action, 'hunt'); assert.strictEqual(HR.hourText(HR.parseCode('ht:a3')), '動物を追いかけている');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-hunt-'));
  const config = liveCfg();
  config.hunting = { ...config.hunting, tryP: 1, penTryP: 1, perDay: 1, penAfterFails: 1, breed: { every: 0, p: 1, perDay: 1 } };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  const rd = (f) => (f === 'world.json' ? STORE.readWorld(dir) : f === 'life.json' ? STORE.readLife(dir) : JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  node('tools/init.js', '--demo');
  node('tools/sim.js', '--demo', '--days', '4'); // 食べ物の仕事の人が出る 3 日目から追いかける。逃げられた次の日に柵が候補の前へ
  let w = rd('world.json'), st = rd('state.json'), hist = rd('history.json'), life = rd('life.json');
  const n0 = w.animals.length;
  assert.ok((st.huntFails || 0) >= 1, '逃げられた回数');
  assert.ok(hist.some((h) => /追いかけたが、逃げられた/.test(h.text)), '歴史に「逃げられた」');
  assert.ok(Object.values(life).some((L) => L.diary.some((d) => /走って逃げてしまった/.test(d.text))), '日記に「逃げてしまった」');
  assert.ok(Object.values(life).some((L) => /ht:/.test(L.hours || '')), '1 時間の行動に「動物を追う」');
  assert.ok(hist.some((h) => /柵で囲ってから捕まえよう/.test(h.text)) && st.penAsked, '柵が候補の前に出る');
  assert.strictEqual(w.animals.length, n0);
  assert.ok(!Object.values(st.store).length || !st.store.meat, '野の動物から肉は取れない');
  // 柵を建てた形にして、ブタを 4 頭入れる
  const c = w.campfire || { x: 0, z: 0 };
  const pen = { id: 'bpen', type: 'pen', x: c.x + 14, z: c.z + 6, rot: 0, built: st.day };
  w.buildings.push(pen);
  w.animals.slice(0, 4).forEach((a, i) => Object.assign(a, { kind: 'pig', pen: pen.id, tamedDay: st.day - 1, x: pen.x + i - 1.5, z: pen.z }));
  STORE.writeWorld(dir, w);
  node('tools/sim.js', '--demo');
  w = rd('world.json'); st = rd('state.json'); hist = rd('history.json');
  const items = Object.values(rd('life.json')).reduce((m, L) => { for (const [k, n] of Object.entries(L.items || {})) m[k] = (m[k] || 0) + n; return m; }, {});
  assert.strictEqual(st.hunted, 1, '柵の中の 1 頭をしとめた');
  assert.ok(items.meat >= config.hunting.meat.pig[0], '生肉が手に入る ' + items.meat);
  assert.ok(hist.some((h) => /はじめて肉が手に入った/.test(h.text)), '歴史に残る');
  const pigs = w.animals.filter((a) => a.pen === pen.id && a.kind === 'pig');
  assert.ok(pigs.length >= config.hunting.keepPerKind, 'ふやすための頭数は残す');
  assert.ok(w.animals.some((a) => a.born === st.day) && hist.some((h) => /子が生まれた/.test(h.text)), '柵の中で子が生まれる');
  assert.strictEqual(w.animals.length, n0 - 1 + w.animals.filter((a) => a.born).length, '数が合う');
  assert.ok(new Set(w.animals.map((a) => a.id)).size === w.animals.length, '動物の id は重ならない');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('夜の魔物：3 つ目の大きな島の上だけ（海・段・木・岩に入らない）・重ならない・村の島からは海をはさんで遠い', () => {
  const FM = require('../js/foemove.js'), AM = require('../js/animalmove.js'), IS = require('../js/island.js'), TG = require('../js/terrain_gen.js');
  const cfg = liveCfg(), NF = cfg.nightFoes;
  const kinds = FM.foeKinds(NF);
  assert.ok(NF && NF.enabled && kinds.length >= 5 && kinds.every((k) => FM.FOE_BODY[k]), 'config.nightFoes');
  for (const k of ['zombie', 'skeleton', 'mud', 'wolf', 'shroom']) assert.ok(kinds.includes(k), '前からいる敵と新しい 3 種がいっしょに出る ' + k);
  assert.deepStrictEqual(FM.foeKinds({ counts: { zombie: 2, mud: 1, nope: 3 } }), ['zombie', 'zombie', 'mud'], '種類ごとの数');
  assert.ok(cfg.enemies && cfg.enemies.enabled === false && /村には来ない/.test(cfg.enemies.note), '村に攻めてくる敵（剣・見張り）はまだ出ない');
  const world = STORE.readWorld(path.join(ROOT, 'data')); // 読むだけ
  const isl = FM.foeIsland(world, NF.island), main = world.islands.find((i) => i.id === 'main');
  assert.ok(isl && isl.id !== 'main' && isl.id !== 'north' && isl.r > main.r, '3 つ目の大きな島');
  const area = FM.foeArea(world, isl, NF);
  assert.ok(IS.shoreDist(isl, area.x, area.z) > area.r, 'うろつく所は島の中');
  assert.ok(-IS.shoreDist(main, area.x, area.z) > 40, 'はじまり島から海をはさんで遠い');
  const T = TG.makeTerrain({ seed: (cfg.terrain || {}).seed || 'town', seaZ: world.seaZ, islands: world.islands });
  const obstacles = FM.foeObstacles(T.chunkObjects, area, TG.BLOCK, TG.CHUNK);
  const fits = FM.makeFoeFits({ isl, heightAt: T.heightAt, obstacles, margin: NF.shore, area });
  const foes = FM.spawnFoes({ list: kinds, area, fits, heightAt: T.heightAt, seed: 'foes:3', level: NF.level ?? 0 });
  assert.strictEqual(foes.length, kinds.length, '全員置ける');
  for (const f of foes) {
    assert.ok(fits(f.kind, f.x, f.z, f.face, f.h0), '置いた所は歩ける所');
    for (const g of foes) if (g !== f) assert.ok(!FM.foesTouch(f.kind, f.x, f.z, f.face, g.kind, g.x, g.z, g.face), '魔物どうし重ならない');
    for (const o of obstacles) assert.ok(Math.hypot(o.x - f.x, o.z - f.z) > o.r, '木・岩にめり込まない');
  }
  // 歩ける所の決まり：海・はじまり島・木の上はだめ。頭の先が海に出る向きもだめ
  const sea = IS.shorePoint(isl, area.ang, -6), f0 = foes[0];
  assert.ok(!fits('mud', sea.x, sea.z, 0, 0), '海には入らない');
  assert.ok(!fits('mud', 0, 0, 0, 0), 'はじまり島には来ない');
  const edge = IS.shorePoint(isl, area.ang, NF.shore + 0.4), outFace = AM.faceOf(Math.cos(area.ang), Math.sin(area.ang));
  assert.ok(!fits('wolf', edge.x, edge.z, outFace, T.heightAt(edge.x, edge.z)), '頭の先が海に出る向きもだめ');
  if (obstacles.length) { const o = obstacles[0]; assert.ok(!fits('mud', o.x, o.z, 0, T.heightAt(o.x, o.z)), '木・岩の所はだめ'); }
  assert.ok(!fits(f0.kind, f0.x, f0.z, f0.face, f0.h0 + TG.BLOCK), '段の高さがちがう所へは行かない');
  // 行き先はうろつく所の中
  for (let s = 0; s < 50; s++) { const g = FM.foeGoal(area, 'f1', s); assert.ok(Math.hypot(g.x - area.x, g.z - area.z) <= area.r + 1e-9); }
  const src = fs.readFileSync(path.join(ROOT, 'js', 'islandpanel.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/海の向こうの大きな島に魔物/.test(src), 'せつめいの島の決まりに 1 行');
  const art = fs.readFileSync(path.join(ROOT, 'js', 'nightfoes.js'), 'utf8') + Object.values(FM.FOE_JA).join('');
  assert.ok(!/マイクラ|マインクラフト|ゾンビ|スケルトン|クリーパー/.test(art), '新しい 3 種は既存の作品の名前を使わない');
});
t('せつめいに島の決まり（動物は柵で囲ってから・海にはサメ）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'islandpanel.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/柵で囲ってから/.test(src) && /サメ/.test(src) && /islandrules/.test(src));
  assert.ok(!/マイクラ|マインクラフト/.test(src + fs.readFileSync(path.join(ROOT, 'js', 'animalmove.js'), 'utf8')));
});

// ---------- 遊ぶ・自分の村人（play.html・me.html・js/play/・js/mine.js・worker.mjs の 5)・tools/play.js。docs/遊びとログインの手順.md） ----------
at('遊ぶ：釣りの決まりが sim と同じ（大きさ・釣れる物の範囲）・合わせの判定・宝箱とおてつだいの見本', async () => {
  const R = await import(require('url').pathToFileURL(path.join(ROOT, 'js', 'play', 'rules.js')).href);
  const FS = require(path.join(ROOT, 'tools', 'fishsize.js'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const FC = cfg.fishing;
  for (const [k, sz] of Object.entries(FC.sizes)) for (let s = 1; s < 40; s++) assert.strictEqual(R.rollSize(sz, R.makeRng(s * 7 + k.length)), FS.rollSize(sz, R.makeRng(s * 7 + k.length)), '大きさは sim と同じ：' + k);
  const all = [FC.seaFish, FC.seaNightFish, cfg.hours && cfg.hours.nightFish, FC.fish, FC.treasure && FC.treasure.items, FC.junk && FC.junk.items].filter(Array.isArray).flat().map(([k]) => k);
  const W = await import(require('url').pathToFileURL(path.join(ROOT, 'tools', 'webhook', 'worker.mjs')).href);
  const rng = R.makeRng(42);
  for (let i = 0; i < 400; i++) {
    const c = R.pickCatch(cfg, rng, { night: i % 2 === 0 });
    assert.ok(all.includes(c.item), '決まりの中の物：' + c.item);
    if (c.item.startsWith('fish_')) { const sz = FC.sizes[c.item]; assert.ok(c.cm >= sz.min && c.cm <= Math.max(sz.max, sz.bigMax || 0), '大きさの範囲'); }
    assert.ok(W.fishOk(cfg, c.item, c.item.startsWith('fish_') ? c.cm : null), '受け口も通す：' + c.item);
  }
  assert.ok(!W.fishOk(cfg, 'fish_nope', 10) && !W.fishOk(cfg, FC.seaFish[0][0], 99999) && !W.fishOk(cfg, FC.seaFish[0][0], 'big'), '変な魚・大きすぎは通さない');
  assert.strictEqual(R.judgeHook(1.0, 1.5), 'early');
  assert.strictEqual(R.judgeHook(1.8, 1.5), 'hit');
  assert.strictEqual(R.judgeHook(3.0, 1.5), 'late');
  for (let d = 1; d <= 28; d++) {
    const date = `2026-02-${String(d).padStart(2, '0')}`;
    const ix = R.treasureIndex(date, 6); assert.ok(ix >= 0 && ix < 6 && Number.isInteger(ix));
    const tot = R.demoChoreTotal(date, 300); assert.ok(tot >= 105 && tot <= 195);
  }
  assert.strictEqual(R.jstDate(Date.UTC(2026, 0, 1, 15, 0)), '2026-01-02', '日の変わり目は日本時間');
  assert.strictEqual(R.leftOf({ fish: 2 }, R.PLAY_DEFAULTS, 'fish'), 3);
  assert.ok(R.validOreMode('self') && R.validOreMode('storage') && !R.validOreMode('toString'));
});
at('自分の村人：DM のリンク（印）・/me・遊びの回数・宝箱のいちばん乗り・pull', async () => {
  const W = await import(require('url').pathToFileURL(path.join(ROOT, 'tools', 'webhook', 'worker.mjs')).href);
  W._resetSiteConfig(); W._resetDmConfig();
  const store = new Map();
  const kv = {
    get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
  const QT = 'z'.repeat(24);
  const env = { TOWN_KV: kv, DM_QUEUE_TOKEN: QT, SITE_ORIGIN: 'https://isle.example', IG_TOKEN: 'IGtest' };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/data/config.json')) return new Response(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8').replace('"fishPerDay": 5', '"fishPerDay": 2'), { status: 200 });
    if (/\/me\/messages$/.test(u)) { sent.push(JSON.parse(init.body)); return new Response('{"message_id":"m"}', { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
  const call = async (p, tok, body, method) => {
    const res = await W.default.fetch(new Request('https://w.example' + p, { method: method || (body === undefined ? 'GET' : 'POST'), headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: () => {} });
    return { status: res.status, j: await res.json().catch(() => null), h: res.headers };
  };
  try {
    // 印：32 字・KV にはハッシュだけ。もう一度作ると前の印は使えない
    const t1 = await W.issueMe(env, 'alice');
    assert.ok(/^[A-Za-z0-9]{32}$/.test(t1));
    assert.ok(![...store.keys(), ...store.values()].some((s) => s.includes(t1)), 'KV に印そのものは置かない');
    let r = await call('/me', t1); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.villager, 'alice');
    assert.strictEqual(r.h.get('Access-Control-Allow-Origin'), 'https://isle.example');
    const t2 = await W.issueMe(env, 'alice');
    assert.strictEqual((await call('/me', t1)).status, 401, '前の印は使えない');
    assert.strictEqual((await call('/me', t2)).j.villager, 'alice');
    assert.strictEqual((await call('/me')).status, 401, '印なしは 401');
    assert.strictEqual((await call('/me', 'x'.repeat(32))).status, 401, '知らない印は 401');
    const op = await W.default.fetch(new Request('https://w.example/play/fish', { method: 'OPTIONS' }), env, {});
    assert.strictEqual(op.status, 204); assert.ok(/Authorization/.test(op.headers.get('Access-Control-Allow-Headers')));
    // 設定
    assert.strictEqual((await call('/me/settings', t2, { oreMode: 'bad' })).status, 400);
    assert.strictEqual((await call('/me/settings', t2, { oreMode: 'storage' })).j.settings.oreMode, 'storage');
    // 誕生日（MM-DD）：片方だけでも保存できる。ありえない日は 400。鉱石の設定は消えない
    assert.strictEqual((await call('/me/settings', t2, { birthday: '02-30' })).status, 400);
    assert.strictEqual((await call('/me/settings', t2, {})).status, 400);
    { const s = (await call('/me/settings', t2, { birthday: '03-14' })).j.settings; assert.deepStrictEqual([s.birthday, s.oreMode, !!s.birthdayAt, !!s.oreAt], ['03-14', 'storage', true, true]); }
    // 釣り：変な魚は 400・回数は Worker が数える（config の fishPerDay=2）
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
    const [fk] = cfg.fishing.seaFish[0], sz = cfg.fishing.sizes[fk];
    assert.strictEqual((await call('/play/fish', t2, { item: 'fish_nope', cm: 3 })).status, 400);
    assert.strictEqual((await call('/play/fish', t2, { item: fk, cm: sz.min })).j.day.fish, 1);
    assert.strictEqual((await call('/play/fish', t2, { miss: true })).j.day.fish, 2);
    r = await call('/play/fish', t2, { item: fk, cm: sz.min }); assert.strictEqual(r.status, 429); assert.strictEqual(r.j.error, 'limit');
    // おてつだい：みんなの合計
    assert.strictEqual((await call('/play/chore', t2, { kind: 'lava' })).status, 400);
    assert.strictEqual((await call('/play/chore', t2, { kind: 'tree' })).j.choreTotal, 1);
    const tb = await W.issueMe(env, 'bob');
    assert.strictEqual((await call('/play/chore', tb, { kind: 'rock' })).j.choreTotal, 2);
    assert.strictEqual((await call('/play/chore', tb, { kind: 'field' })).j.choreTotal, 3, '畑に水やりもおてつだいに入る');
    // 宝箱：最初の人だけいちばん乗り
    r = await call('/play/treasure', tb, {}); assert.ok(r.j.first); assert.strictEqual(r.j.treasure.villager, 'bob');
    r = await call('/play/treasure', t2, {}); assert.ok(!r.j.first); assert.strictEqual(r.j.treasure.villager, 'bob');
    r = await call('/me', t2); assert.deepStrictEqual(r.j.day, { fish: 2, chores: 1, treasure: true }); assert.strictEqual(r.j.choreTotal, 3); assert.strictEqual(r.j.settings.oreMode, 'storage');
    // pull：合言葉が要る。印では読めない
    assert.strictEqual((await call('/play/pull', t2)).status, 403);
    r = await call('/play/pull?days=2', QT);
    assert.strictEqual(r.status, 200);
    const today = W.jstDate();
    assert.strictEqual(r.j.settings.alice.oreMode, 'storage');
    assert.strictEqual(r.j.days[today].alice.fish, 2); assert.strictEqual(r.j.days[today].bob.chores, 2);
    assert.strictEqual(r.j.chores[today].total, 3); assert.strictEqual(r.j.chores[today].water, 1, '水やりは water に数える'); assert.strictEqual(r.j.treasure[today].villager, 'bob');
    assert.strictEqual(Object.keys(r.j.days).length, 2);
    // tools/play.js：形をととのえて受け取る
    const PL = require(path.join(ROOT, 'tools', 'play.js'));
    let asked = null;
    const pj = await PL.pull({ env: { DM_QUEUE_URL: 'https://w.example/', DM_QUEUE_TOKEN: QT }, days: 2, fetchFn: async (u, init) => { asked = { u, init }; return new Response(JSON.stringify({ ...r.j, settings: { ...r.j.settings, 'bad key!': { oreMode: 'self' }, carol: { oreMode: 'lava' } } }), { status: 200 }); } });
    assert.strictEqual(asked.u, 'https://w.example/play/pull?days=2'); assert.strictEqual(asked.init.headers.Authorization, 'Bearer ' + QT);
    assert.deepStrictEqual(Object.keys(pj.settings), ['alice'], '変な名前・変な設定は捨てる');
    assert.deepStrictEqual(pj.days[today].alice.catches, [[fk, sz.min]]);
    assert.strictEqual(await PL.pull({ env: {} }), null, '受け口がなければ読まない');
    assert.deepStrictEqual(PL.clean({ days: { 'x': {} }, treasure: { '2026-01-01': { villager: '../x' } } }), { settings: {}, days: {}, chores: {}, treasure: {} });
    // DM の返事：villager があれば専用のリンクを入れ、前の印は使えなくなる
    store.set('dmq:' + 'a'.repeat(32), JSON.stringify({ igsid: '5001', at: new Date().toISOString() }));
    store.set('dmq:' + 'b'.repeat(32), JSON.stringify({ igsid: '5002', at: new Date().toISOString() }));
    const done = await W.default.fetch(new Request('https://w.example/dm/done', { method: 'POST', headers: { Authorization: 'Bearer ' + QT }, body: JSON.stringify({ items: [{ ids: ['a'.repeat(32)], text: 'ようこそ', villager: 'alice' }, { ids: ['b'.repeat(32)], text: 'ようこそ {me} だよ' }] }) }), env, {});
    assert.strictEqual((await done.json()).sent, 2);
    const m1 = sent[0].message.text, m2 = sent[1].message.text;
    const mm = /https:\/\/isle\.example\/\?v=alice&me=([A-Za-z0-9]{32})/.exec(m1);
    assert.ok(mm && m1.startsWith('ようこそ\n'), '最後の行に専用のリンク（?v= も付けて家に寄る）');
    assert.strictEqual((await call('/me', mm[1])).j.villager, 'alice');
    assert.strictEqual((await call('/me', t2)).status, 401, 'DM し直すと前の印は使えない');
    assert.strictEqual(m2, 'ようこそ  だよ', '村人がない時は {me} を消すだけ（リンクは作らない）');
    assert.strictEqual(W.meText('a {me} b', 'U'), 'a U b');
    env.ME_LINKS = 'off';
    store.set('dmq:' + 'c'.repeat(32), JSON.stringify({ igsid: '5003', at: new Date().toISOString() }));
    await W.default.fetch(new Request('https://w.example/dm/done', { method: 'POST', headers: { Authorization: 'Bearer ' + QT }, body: JSON.stringify({ items: [{ ids: ['c'.repeat(32)], text: 'ようこそ', villager: 'carol' }] }) }), env, {});
    assert.strictEqual(sent[2].message.text, 'ようこそ', 'ME_LINKS=off ならリンクを作らない');
    assert.ok(!store.has('mev:carol'));
    // dm.js の文（{me} が 1 つ）：専用のリンクが作れない時は家のリンク（?v=）を 1 つ。{me} は残さない
    const H = 'https://hajimarijima.github.io/?v=carol';
    const n = (s, sub) => s.split(sub).length - 1;
    store.set('dmq:' + 'd'.repeat(32), JSON.stringify({ igsid: '5004', at: new Date().toISOString() }));
    await W.default.fetch(new Request('https://w.example/dm/done', { method: 'POST', headers: { Authorization: 'Bearer ' + QT }, body: JSON.stringify({ items: [{ ids: ['d'.repeat(32)], text: 'carolさん → {me}', villager: 'carol', house: H }] }) }), env, {});
    assert.strictEqual(sent[3].message.text, 'carolさん → ' + H, 'ME_LINKS=off なら家のリンク 1 つ');
    assert.strictEqual(W.houseLink(env, { villager: 'carol', house: 'javascript:alert(1)' }), 'https://isle.example/?v=carol', '変な house は使わない');
    delete env.ME_LINKS;
    // 専用のリンクが作れた時：リンクは 1 つ（専用のリンクだけ）
    const t3 = await W.replyText(env, { text: 'ようこそ → {me} {me}', villager: 'carol', house: H }, Date.now());
    assert.strictEqual(n(t3, 'https://'), 1); assert.ok(/→ https:\/\/isle\.example\/\?v=carol&me=[A-Za-z0-9]{32} $/.test(t3)); assert.ok(!t3.includes('{me}'));
    // KV が失敗した時：家のリンク 1 つにして送る
    const badEnv = { ...env, TOWN_KV: { ...env.TOWN_KV, get: async () => null, put: async () => { throw new Error('kv down'); }, delete: async () => {} } };
    const t4 = await W.replyText(badEnv, { text: 'ようこそ → {me}', villager: 'carol', house: H });
    assert.strictEqual(t4, 'ようこそ → ' + H, 'KV の失敗でも家のリンク');
    assert.strictEqual(await W.replyText(env, { text: 'ようこそ → {me}', villager: 'bad key!' }), 'ようこそ → ', '村人の key がなければ {me} を消す');
  } finally { globalThis.fetch = realFetch; W._resetSiteConfig(); W._resetDmConfig(); }
});
t('自分の村人：DM の返事に村人の key を渡す（印は GitHub 側に作らない）', () => {
  const DM = require(path.join(ROOT, 'tools', 'dm.js'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const rep = DM.replyTexts({ replies: [{ ids: ['a'.repeat(32)], kind: 'welcome', v: { key: 'alice', display: 'alice' } }] }, cfg);
  assert.strictEqual(rep[0].villager, 'alice');
  const src = ['tools/dm.js', 'tools/play.js', 'js/mine.js', 'js/me.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('');
  assert.ok(!/newMeToken|getRandomValues/.test(fs.readFileSync(path.join(ROOT, 'tools', 'dm.js'), 'utf8')), '印は受け口だけが作る');
  assert.ok(/replaceState/.test(src), 'リンクを開いたら URL から印を消す');
});
t('DM の返事：リンクは 1 つ・置きかえ前の文字を残さない', () => {
  const DM = require(path.join(ROOT, 'tools', 'dm.js'));
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const n = (s, sub) => s.split(sub).length - 1;
  const v = { key: 'alice', display: 'あり' };
  const run = (messages, vv = v, kind = 'welcome') => DM.replyTexts({ replies: [{ ids: ['a'.repeat(32)], kind, v: vv }] }, { ...base, dm: { ...base.dm, messages: { ...base.dm.messages, ...messages } } })[0];
  // 今の config の文
  const w = run({});
  assert.strictEqual(w.text, 'ありさん、はじまり島へようこそ！あなたの家はこちら（あなた専用のリンクです。人に教えないでね）→ {me}');
  assert.strictEqual(w.house, 'https://hajimarijima.github.io/?v=alice');
  assert.strictEqual(run({}, v, 'already').text, 'ありさんは、もうはじまり島に住んでいます！あなたの家はこちら（あなた専用のリンクです。人に教えないでね）→ {me}');
  // {url} が 2 つ・{me} と {url}・リンクの場所なし・知らない {foo}：どれも {me} がちょうど 1 つで、ほかの {…} は残らない
  for (const tpl of ['{name} {url} {url}', '{name} {me} → {url}', '{name}さん、ようこそ', '{name} {foo} {url} {word}']) {
    const r = run({ welcome: tpl });
    assert.strictEqual(n(r.text, '{me}'), 1, tpl); assert.ok(!/\{(?!me\})\w+\}/.test(r.text), tpl);
    assert.ok(!r.text.includes('https://'), 'リンクを入れるのは受け口（二重にしない）');
  }
  // 村人の key がない・変な時：家（サイト）のリンクを 1 つだけ入れ、{me} も villager も渡さない
  for (const vv of [{ display: 'なし' }, { key: '../x', display: 'へん' }]) {
    const r = run({}, vv);
    assert.strictEqual(n(r.text, 'https://'), 1); assert.ok(!/\{\w+\}/.test(r.text)); assert.ok(!('villager' in r));
  }
  // 村人のない返事（フォローしてね）にも {…} を残さない
  const nf = DM.replyTexts({ replies: [{ ids: ['b'.repeat(32)], kind: 'notFollowing', text: 'フォローして {foo}' }] }, base)[0];
  assert.strictEqual(nf.text, 'フォローして ');
});
at('DM の返事：島（GitHub Pages）に出てから送る', async () => {
  const DM = require(path.join(ROOT, 'tools', 'dm.js'));
  let clock = 0; const asked = [];
  const opts = (seq) => ({ site: 'https://isle.example/', now: () => clock, sleep: async (ms) => { clock += ms; }, everyMs: 12e3, maxMs: 5 * 60e3,
    fetchFn: async (u) => { asked.push(u); const x = seq.length > 1 ? seq.shift() : seq[0]; if (x instanceof Error) throw x; return new Response(JSON.stringify(x), { status: 200 }); } });
  const welcome = { ids: ['a'.repeat(32)], text: 'よ → {me}', kind: 'welcome', villager: 'alice' };
  // 新しい村人がいない（もう住んでいる・フォローしてね）：待たない・読みにも行かない
  let r = await DM.waitForSite([{ ...welcome, kind: 'already' }, { ids: ['b'.repeat(32)], text: 'フォローしてね', kind: 'notFollowing' }], opts([[]]));
  assert.deepStrictEqual(r, { waited: false }); assert.strictEqual(asked.length, 0);
  // 3 回目で出た（1 回目は読めない）：出たらすぐ送る。キャッシュよけの ?t=
  clock = 0;
  r = await DM.waitForSite([welcome], opts([new Error('net'), [{ key: 'bob' }], [{ key: 'bob' }, { key: 'alice' }]]));
  assert.deepStrictEqual([r.waited, r.ok, r.tries, r.ms], [true, true, 3, 24e3]);
  assert.ok(/^https:\/\/isle\.example\/data\/villagers\.json\?t=\d+$/.test(asked[0]));
  // 出ないまま：5 分で切り上げる（送るのは呼んだ側）
  clock = 0;
  r = await DM.waitForSite([welcome, { ...welcome, ids: ['c'.repeat(32)], villager: 'carol' }], opts([[{ key: 'alice' }]]));
  assert.strictEqual(r.ok, false); assert.deepStrictEqual(r.missing, ['carol']); assert.ok(r.ms <= 5 * 60e3 && r.ms >= 4 * 60e3, String(r.ms));
  // join.yml：done が push のあと・待つ時間の上限
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'join.yml'), 'utf8');
  assert.ok(/node tools\/dm\.js done/.test(wf) && /timeout-minutes: 8/.test(wf));
  assert.ok(/waitForSite\(items/.test(fs.readFileSync(path.join(ROOT, 'tools', 'dm.js'), 'utf8')), 'done の前に待つ');
});
at('自分の村人：DM の done が villager を送る（text がある時だけ）', async () => {
  const DM = require(path.join(ROOT, 'tools', 'dm.js'));
  let body = null;
  await DM.done([{ ids: ['a'.repeat(32)], text: 'hi', villager: 'alice' }, { ids: ['b'.repeat(32)], text: null, villager: 'bob' }], { env: { DM_QUEUE_URL: 'https://w.example', DM_QUEUE_TOKEN: 'q'.repeat(24) }, fetchFn: async (u, init) => { body = JSON.parse(init.body); return new Response('{"sent":1,"removed":2}', { status: 200 }); } });
  assert.strictEqual(body.items[0].villager, 'alice');
  assert.ok(!('villager' in body.items[1]));
});
t('遊ぶ・自分の村人：メニュー・ページ・文字の決まり', () => {
  const files = ['play.html', 'me.html', 'js/mine.js', 'js/me.js', 'js/play/rules.js', 'js/play/scene.js', 'js/play/hero.js', 'js/play/store.js', 'js/play/main.js', 'tools/play.js', 'docs/遊びとログインの手順.md'];
  const all = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/マイクラ|マインクラフト/.test(all), '作品の名前を入れない');
  assert.ok(!/firebase|signInWith/i.test(files.slice(0, 10).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('')), '遊び・自分の村人は Google ログインを使わない');
  const common = fs.readFileSync(path.join(ROOT, 'js', 'common.js'), 'utf8');
  assert.ok(/'play\.html'/.test(common) && /'me\.html'/.test(common) && /'自分の村人'/.test(common));
  assert.ok(/noindex/.test(fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8')));
  const js = fs.readFileSync(path.join(ROOT, 'js', 'joinsheet.js'), 'utf8');
  assert.ok(/あなた専用のリンク/.test(js));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  assert.ok(cfg.play && typeof cfg.play.apiUrl === 'string' && cfg.play.fishPerDay > 0);
});

// ---------- 誕生日パーティ・島の行事・鉱石の持ち方 ----------
const loadEsm = (f) => require(path.join(ROOT, 'js', f));
t('島の行事：暦の窓（年をまたぐ時も）・冬祭りの日数・誕生日は何人でも 1 回', () => {
  const EVM = loadEsm('islandevents.js');
  assert.ok(EVM.inWindow('12-31', '12-30', '01-02') && EVM.inWindow('01-01', '12-30', '01-02') && !EVM.inWindow('01-03', '12-30', '01-02'));
  const w = EVM.seasonalOn('2026-11-27');
  assert.deepStrictEqual(w.map((e) => [e.id, e.name, e.day]), [['winter', '冬祭り', 2]]);
  assert.deepStrictEqual(EVM.seasonalOn('2026-06-01'), []);
  for (const id of ['fireworks', 'harvest', 'fishing']) assert.ok(EVM.EVENTS.some((e) => e.id === id), id);
  const ev = EVM.eventsOn('2026-11-27', ['a', 'b']);
  assert.strictEqual(ev.filter((e) => e.id === 'birthday').length, 1, '2 人でもパーティは 1 回');
  assert.deepStrictEqual(ev[0].who, ['a', 'b']);
  const nm = { a: 'ゆい', b: 'そら' };
  assert.strictEqual(EVM.todayLine(ev[0], (k) => nm[k]), '今日は ゆい さん・そら さんの誕生日');
  assert.strictEqual(EVM.todayLine(ev[1], (k) => nm[k]), '今日は冬祭り（2日目）');
  assert.strictEqual(EVM.partyTitle(['ゆい']), 'ゆいさんの誕生日パーティ');
  // 設定で行事を変えられる
  assert.deepStrictEqual(EVM.seasonalOn('2026-03-03', { islandEvents: [{ id: 'hina', name: 'ひなまつり', from: '03-03', to: '03-03' }] }).map((e) => e.name), ['ひなまつり']);
  // 3D・設定の文に作品の名前を入れない。town.js は p.party の人を party3d.js にまかせる
  const src = ['js/party3d.js', 'js/islandevents.js', 'tools/oremode.js', 'js/me.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/マイクラ|マインクラフト/.test(src));
  assert.ok(/partyStep/.test(fs.readFileSync(path.join(ROOT, 'js', 'town.js'), 'utf8')) && /party3d\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  // 贈り物：好きな食べ物があればそれ
  assert.strictEqual(EVM.giftFor({ key: 'x', profile: { food: 'りんご' } }, { apple: {} }, P.hashStr || require('../tools/rand').hashStr), 'apple');
});
t('鉱石の持ち方：コメント「鉱石 自分」「鉱石 倉庫」・新しい方が勝つ・web の設定（self / storage）と誕生日', () => {
  const OMx = require('../tools/oremode');
  for (const [s, m] of [['鉱石 自分', 'keep'], ['鉱石：倉庫', 'chest'], ['鉱石は自分で持つ', 'keep'], ['鉱石 チェスト', 'chest'], ['こうせき じぶん', 'keep'], ['こんにちは', null], ['倉庫 鉱石', null]]) assert.strictEqual(OMx.parseOreMode(s), m, s);
  const S = { config: { joinWord: '住みたい' }, villagers: [{ key: 'k1', igId: P.igHash('9001'), name: 'ore_a', display: 'ore_a' }], history: [] };
  const c = (text, ts, id) => ({ id, text, timestamp: ts, from: { id: '9001', username: 'ore_a' } });
  OMx.applyOreComments(S, [c('鉱石 倉庫', '2026-11-02T01:00:00Z', 'c1')], { day: 2, date: '2026-11-02' });
  assert.strictEqual(S.villagers[0].oreMode, 'chest');
  assert.strictEqual(OMx.applyOreComments(S, [c('鉱石 倉庫', '2026-11-02T01:00:00Z', 'c1')]).length, 0, '同じコメントは 2 回使わない');
  // web の設定が新しければ web、古ければコメントのまま
  OMx.applyPlaySettings(S, { k1: { oreMode: 'self', oreAt: '2026-11-01T00:00:00Z' } });
  assert.strictEqual(S.villagers[0].oreMode, 'chest', '古い web の設定は使わない');
  OMx.applyPlaySettings(S, { k1: { oreMode: 'self', oreAt: '2026-11-03T00:00:00Z', birthday: '03-14', birthdayAt: '2026-11-03T00:00:00Z' } }, { day: 3 });
  assert.deepStrictEqual([S.villagers[0].oreMode, S.villagers[0].birthday], ['keep', '03-14']);
  assert.ok(S.history.some((h) => h.kind === 'ore' && /自分で持つ/.test(h.text)));
  assert.strictEqual(OMx.modeOf({}), 'keep', 'ふつうは自分で持つ');
  // play.js pull の形：誕生日と時刻も残す・変な誕生日は捨てる
  const PLx = require('../tools/play');
  const cl = PLx.clean({ settings: { a: { oreMode: 'self', at: '2026-11-03T00:00:00Z', birthday: '13-01' }, b: { birthday: '03-14', birthdayAt: '2026-11-03T00:00:00Z' } } });
  assert.deepStrictEqual(cl.settings, { a: { oreMode: 'self', oreAt: '2026-11-03T00:00:00.000Z' }, b: { birthday: '03-14', birthdayAt: '2026-11-03T00:00:00.000Z' } });
});
t('鍛冶屋：鉱石を自分で持つ人の装備は、本人の鉱石を先に使う（チェストの分は残る）', () => {
  const SMx = loadEsm('smithing.js'), CRx = require('../tools/craft');
  const cfg = liveCfg();
  // 石のつるはしを持つ人に、鉄のつるはしを作る（鉄は本人が持っている）
  const iron = Object.entries(cfg.crafting.recipes).find(([, r]) => r.tool === 'pickaxe' && r.tier === 'iron');
  assert.ok(iron, '鉄のつるはしの作り方');
  const need = iron[1].from;
  const own = Object.fromEntries(Object.entries(need).filter(([k]) => ['iron', 'coal', 'gold', 'diamond'].includes(k)));
  assert.ok(Object.keys(own).length, '鉄を使う');
  const store = { log: 50, planks: 20, stick: 20, cobble: 50, iron: 0 };
  const L = { inv: [{ item: 'stone_pickaxe', n: 1, dur: 10 }], slots: 4, gear: { head: 'x', body: 'x', feet: 'x' }, ores: { ...own } };
  const smc = { ...cfg.smithing, armor: {} };
  const r = SMx.pickJob({ store, people: [{ key: 'me', L, guard: false }], config: { ...cfg, smithing: smc }, built: Object.keys(cfg.buildings), CR: CRx });
  assert.ok(r.job && r.job.key === iron[0], JSON.stringify(r));
  for (const k of Object.keys(own)) { assert.strictEqual(r.job.own[k], 0, '本人の ' + k + ' を使った'); assert.strictEqual(r.job.store[k] || 0, 0); }
  // 本人が持っていなければ、チェストに鉄がないので作れない
  const r2 = SMx.pickJob({ store, people: [{ key: 'me', L: { ...L, ores: {} }, guard: false }], config: { ...cfg, smithing: smc }, built: Object.keys(cfg.buildings), CR: CRx });
  assert.ok(!r2.job);
});
t('sim.js：誕生日パーティ（同じ日の人はまとめて 1 回・経験値と贈り物・年表）・冬祭り・鉱石の持ち方', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-party-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(liveCfg()));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--seed', 'party', '--start', '2026-11-20');
  const inbox = path.join(dir, 'inbox.json');
  fs.writeFileSync(inbox, JSON.stringify({ followers: sample.followers, joinComments: sample.joinComments, voteComments: null }));
  node('tools/sim.js', '--inbox', inbox, '--now', '2026-11-20T12:00:00+09:00');
  let vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.ok(vs.length >= 2 && vs.every((v) => /^\d{2}-\d{2}$/.test(v.birthday)), 'みんな誕生日がある');
  const auto = vs.find((v) => v.source !== 'comment');
  if (auto) assert.strictEqual(auto.birthday, P.autoBirthday(auto.key), 'key から決まる');
  // 2 日目（11/21）が誕生日の人を 2 人。web の設定で 1 人目は倉庫、ほかは自分で持つ
  vs[0].birthday = '11-21'; vs[1].birthday = '11-21';
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify(vs));
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'inbox', 'play.json'), JSON.stringify({ settings: { [vs[0].key]: { oreMode: 'storage', oreAt: '2026-11-20T00:00:00Z' } } }));
  const life0 = STORE.readLife(dir);
  node('tools/sim.js', '--now', '2026-11-21T12:00:00+09:00');
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const hist = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  const life = STORE.readLife(dir);
  vs = JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  assert.strictEqual(st.date, '2026-11-21');
  const bd = st.today.events.filter((e) => e.id === 'birthday');
  assert.strictEqual(bd.length, 1); assert.deepStrictEqual(bd[0].who.sort(), [vs[0].key, vs[1].key].sort());
  const ph = hist.filter((h) => h.day === st.day && h.type === 'birthday');
  assert.strictEqual(ph.length, 1, '年表は 1 行');
  assert.ok(/さん・.+さんの誕生日パーティ/.test(ph[0].text), ph[0].text);
  for (const v of vs.slice(0, 2)) {
    assert.ok(life[v.key].xp > (life0[v.key] || { xp: 0 }).xp + 15, '経験値');
    assert.ok((life[v.key].gifts || []).some((g) => g.day === st.day), '贈り物');
  }
  assert.strictEqual(vs[0].oreMode, 'chest'); assert.ok(!vs[1].oreMode || vs[1].oreMode === 'keep');
  // 冬祭り（11/26〜）まで進める：行事が年表と今日の行事に出る。倉庫の人は鉱石を持たない
  node('tools/sim.js', '--days', '6', '--now', '2026-11-27T12:00:00+09:00');
  const st2 = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const hist2 = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'));
  const life2 = STORE.readLife(dir);
  assert.ok(st2.today.events.some((e) => e.id === 'winter'), JSON.stringify(st2.today.events));
  assert.ok(hist2.some((h) => h.event === 'winter' && /^冬祭り/.test(h.text)));
  const o0 = life2[vs[0].key].ores || {};
  assert.ok(!Object.values(o0).some((n) => n > 0), '倉庫に入れる人は鉱石を持たない');
  for (const k of Object.keys(life2)) for (const [it, n] of Object.entries(life2[k].ores || {})) assert.ok(['coal', 'iron', 'gold', 'diamond'].includes(it) && n >= 0, it);
});

// ---------- 引っ越し（tools/moveout.js）：本物の data を一時フォルダに写して試す（本物の data/ では動かさない） ----------
t('引っ越し：その人の id がどこにも残らない・空き家にもどる・前のコメントでは住み直さず、新しい「住みたい」で住める', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-moveout-'));
  const src = path.join(ROOT, 'data');
  fs.cpSync(src, dir, { recursive: true, filter: (p) => !['inbox', 'import'].includes(path.relative(src, p).split(/[\\/]/)[0]) });
  assert.ok(!fs.existsSync(path.join(dir, 'inbox')), 'inbox は写さない');
  assert.notStrictEqual(path.resolve(dir), path.resolve(src));
  const env = { ...process.env, TOWN_DATA: dir, TOWN_SALT_QUIET: '1', TOWN_VAULT: dir + '-vault' };
  delete env.TOWN_SALT; delete env.GITHUB_ACTIONS; delete env.TOWN_HIDDEN;
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  const realBefore = fs.readFileSync(path.join(src, 'villagers.json'), 'utf8');
  const readMoved = () => (fs.existsSync(path.join(src, 'moved.json')) ? fs.readFileSync(path.join(src, 'moved.json'), 'utf8') : null);
  const movedBefore = readMoved(); // 本番で引っ越しがあると、本物の data/ にも moved.json がある
  // 何日か動かして、関係・おしゃべり・建てた人の名簿などができてから試す
  node('tools/sim.js', '--days', '6', '--now', '2026-12-03T12:00:00+09:00');
  const readV = () => JSON.parse(fs.readFileSync(path.join(dir, 'villagers.json'), 'utf8'));
  const allText = () => {
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(dir);
    return Object.fromEntries(files.map((f) => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]));
  };
  // いちばん多く参照されている、名前のある人を選ぶ
  const vs0 = readV(), txt0 = allText();
  const count = (k) => Object.values(txt0).reduce((a, s) => a + s.split(k).length - 1, 0);
  const v = vs0.filter((x) => x.name && !x.hidden).sort((a, b) => count(b.key) - count(a.key))[0];
  assert.ok(v && count(v.key) > 5, '参照のある村人がいる');
  const K = v.key;
  // テストの塩で名前の印を合わせる（本物の印は本物の塩で作ってあるため）
  for (const x of vs0) if (x.key === K) { x.userHash = P.userHash(x.name); delete x.igId; delete x.igAlt; }
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify(vs0, null, 1) + '\n');
  const lifeBefore = STORE.readLife(dir);
  const home = lifeBefore[K].home;
  // --dry：一覧は出すが、何も書かない
  const snap = allText();
  const dry = node('tools/moveout.js', v.name, '--dry', '--now', '2026-12-03T13:00:00+09:00');
  assert.ok(/ためし/.test(dry) && dry.includes(K), dry);
  assert.deepStrictEqual(allText(), snap, '--dry では何も書かない');
  // 本番：ユーザー名で引っ越し
  const out = node('tools/moveout.js', '@' + v.name, '--now', '2026-12-03T13:00:00+09:00');
  assert.ok(/引っ越しました/.test(out), out);
  const after = allText();
  for (const f of ['villagers.json', 'world.json', 'social.json', 'life.json', 'state.json', 'mail.json', 'visits.json', 'decor.json', 'requests.json']) {
    if (after[f] != null) assert.ok(!after[f].includes(K), `${f} に id が残っている`);
  }
  for (const [f, s] of Object.entries(after)) if (f.startsWith('diary')) assert.ok(!s.includes(K), `${f} に日記が残っている`);
  const hist = JSON.parse(after['history.json']);
  assert.ok(!hist.some((h) => (h.who || []).includes(K)), '歴史の who に残っていない');
  assert.strictEqual(hist[hist.length - 1].type, 'moveout');
  assert.strictEqual(hist[hist.length - 1].text, `${v.display}さんが島を引っ越した。`);
  assert.ok(!readV().some((x) => x.key === K));
  const lifeAfter = STORE.readLife(dir);
  assert.ok(!lifeAfter[K]);
  if (home) assert.ok(Object.values(lifeAfter).filter((L) => L.home === home).length < Object.values(lifeBefore).filter((L) => L.home === home).length, '家に空きができた');
  const moved = JSON.parse(after['moved.json']);
  assert.ok(moved.some((m) => m.u === P.userHash(v.name)) && !after['moved.json'].includes(K) && !after['moved.json'].includes(v.name), 'moved.json は印だけ');
  // 引っ越したあとも町はふつうに動く
  node('tools/sim.js', '--now', '2026-12-04T12:00:00+09:00');
  assert.ok(!readV().some((x) => x.name === v.name));
  // 前の「住みたい」コメント（引っ越す前）だけでは住み直さない
  const inboxDir = path.join(dir, 'inbox'); fs.mkdirSync(inboxDir, { recursive: true });
  const inbox = path.join(inboxDir, 'instagram.json');
  const oldC = { id: 'c-old', text: '住みたい', timestamp: '2026-11-20T10:00:00+0000', username: v.name, from: { username: v.name } };
  fs.writeFileSync(inbox, JSON.stringify({ joinComments: [oldC] }));
  node('tools/join.js', '--now', '2026-12-04T13:00:00+09:00');
  assert.ok(!readV().some((x) => x.name === v.name), '前のコメントで住み直した');
  // 引っ越したあとの新しい「住みたい」：ふつうに新しく住む（「もう住んでいます」にならない）
  fs.writeFileSync(inbox, JSON.stringify({ joinComments: [oldC, { id: 'c-new', text: '住みたい ピッケル', timestamp: '2026-12-04T05:00:00+0000', username: v.name, from: { username: v.name } }] }));
  const jo = node('tools/join.js', '--now', '2026-12-04T15:00:00+09:00');
  assert.ok(/新しく 1 人/.test(jo), jo);
  const nv = readV().find((x) => x.name === v.name);
  assert.ok(nv, '新しく住んだ');
  const nl = STORE.readLife(dir)[nv.key];
  assert.ok(nl && nl.diary.length === 1 && /今日から村に住む/.test(nl.diary[0].text), '新しい暮らし・日記が 1 行目から');
  assert.strictEqual(readV().filter((x) => x.name === v.name).length, 1);
  // 本物の data/ は変わっていない
  assert.strictEqual(fs.readFileSync(path.join(src, 'villagers.json'), 'utf8'), realBefore, '本物の data/ をさわった');
  assert.strictEqual(readMoved(), movedBefore, '本物の data/moved.json をさわった');
});

t('引っ越しの保管と復元：30 日以内なら元の家・関係ごともどる・30 日を過ぎるともどせず消える', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-restore-'));
  const vault = dir + '-vault';
  const src = path.join(ROOT, 'data');
  fs.cpSync(src, dir, { recursive: true, filter: (p) => !['inbox', 'import'].includes(path.relative(src, p).split(/[\\/]/)[0]) });
  const env = { ...process.env, TOWN_DATA: dir, TOWN_SALT_QUIET: '1', TOWN_VAULT: vault };
  delete env.TOWN_SALT; delete env.GITHUB_ACTIONS; delete env.TOWN_HIDDEN;
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const fails = (f, ...a) => { try { node(f, ...a); return null; } catch (e) { return String(e.stderr || e.message); } };
  const realBefore = fs.readFileSync(path.join(src, 'villagers.json'), 'utf8');
  node('tools/sim.js', '--days', '6', '--now', '2026-12-03T12:00:00+09:00');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  // 名前のある人の印をテストの塩に合わせる（本物の印は本物の塩で作ってあるため）
  const vs = rd('villagers.json');
  for (const x of vs) if (x.name) x.userHash = P.userHash(x.name);
  fs.writeFileSync(path.join(dir, 'villagers.json'), JSON.stringify(vs, null, 1) + '\n');
  // まだ家がない町なので、家を 2 つ建てたことにして、名前のある人を 1 軒目に住ませる
  const cfg0 = rd('config.json');
  const houseT = Object.keys(cfg0.buildings).find((t) => cfg0.buildings[t].cap);
  const W0 = STORE.readWorld(dir), base = W0.buildings[0] || { x: 0, z: 0 };
  W0.buildings.push({ id: 'house_t1', type: houseT, x: base.x + 3, z: base.z + 3, day: 1 }, { id: 'house_t2', type: houseT, x: base.x - 3, z: base.z - 3, day: 1 });
  STORE.writeWorld(dir, W0, { clearR: ((cfg0.terrain && cfg0.terrain.clearBlocks) ?? 4) * 1.9 + 2.5 });
  const L0 = STORE.readLife(dir);
  const named = vs.filter((x) => x.name && !x.hidden && L0[x.key]);
  L0[named[0].key].home = 'house_t1';
  STORE.writeLife(dir, L0);
  const snap = () => ({ villagers: rd('villagers.json'), life: STORE.readLife(dir), social: rd('social.json'), state: rd('state.json'), world: STORE.readWorld(dir), history: rd('history.json') });
  const S0 = snap();
  const txt = JSON.stringify(S0);
  const v = S0.villagers.find((x) => x.key === named[0].key);
  assert.ok(txt.split(v.key).length > 3, '参照のある村人');
  assert.ok(v, '家のある人がいる');
  const K = v.key;
  node('tools/moveout.js', v.name, '--now', '2026-12-03T13:00:00+09:00');
  // 保管は data/ の外。暗号化されていて、名前も id も読めない
  const vf = fs.readdirSync(vault);
  assert.deepStrictEqual(vf, [P.userHash(v.name) + '.json']);
  const raw = fs.readFileSync(path.join(vault, vf[0]), 'utf8');
  assert.ok(!raw.includes(K) && !raw.includes(v.name) && !raw.includes(v.display), '保管は暗号化されている');
  assert.ok(!fs.readdirSync(dir).some((f) => /vault/.test(f)), 'data/ の下に保管を置かない');
  assert.ok(!JSON.stringify(rd('villagers.json')).includes(K));
  // --dry：何も書かない
  const mid = JSON.stringify(snap());
  const dry = node('tools/movein-restore.js', v.name, '--dry', '--now', '2026-12-10T12:00:00+09:00');
  assert.ok(/ためし/.test(dry) && /元の家/.test(dry), dry);
  assert.strictEqual(JSON.stringify(snap()), mid);
  assert.ok(fs.existsSync(path.join(vault, vf[0])));
  // もどす（7 日後）：引っ越しの前とほぼ同じ
  const out = node('tools/movein-restore.js', '@' + v.name, '--now', '2026-12-10T12:00:00+09:00');
  assert.ok(/もどりました/.test(out), out);
  const S1 = snap();
  assert.deepStrictEqual(S1.villagers, S0.villagers, '村人の並び・中身');
  assert.deepStrictEqual(S1.life, S0.life, '暮らし・日記・家（ほかの人の行動も）');
  assert.deepStrictEqual(S1.social, S0.social, '関係');
  assert.deepStrictEqual(S1.state, S0.state, 'state の名簿');
  assert.deepStrictEqual(S1.world.buildings, S0.world.buildings, '建てた人の名簿');
  assert.deepStrictEqual(S1.history.slice(0, S0.history.length), S0.history, '歴史の who');
  assert.deepStrictEqual(S1.history.slice(S0.history.length).map((h) => h.type), ['moveout', 'movein']);
  assert.ok(!(rd('moved.json')).some((m) => m.u === P.userHash(v.name)), 'moved.json の印を外す');
  assert.ok(!fs.existsSync(path.join(vault, vf[0])), 'もどしたら保管を消す');
  assert.ok(/見つかりません/.test(fails('tools/movein-restore.js', v.name)), '二重にはもどせない');
  // 家が埋まっていたら、空いている家へ：引っ越したあとに家を他の人で埋める
  node('tools/moveout.js', v.name, '--now', '2026-12-10T13:00:00+09:00');
  const cfg = rd('config.json');
  const L1 = STORE.readLife(dir);
  const home = S0.life[K].home;
  const capOf = (id) => cfg.buildings[S1.world.buildings.find((b) => b.id === id).type].cap;
  const others = Object.keys(L1).filter((k) => L1[k].home !== home);
  let filled = Object.values(L1).filter((L) => L.home === home).length;
  for (const k of others) { if (filled >= capOf(home)) break; L1[k].home = home; filled++; }
  STORE.writeLife(dir, L1);
  const out2 = node('tools/movein-restore.js', v.name, '--now', '2026-12-11T12:00:00+09:00');
  assert.ok(/埋まっていた/.test(out2), out2);
  const L2 = STORE.readLife(dir);
  assert.notStrictEqual(L2[K].home, home);
  assert.ok(L2[K].home == null || Object.values(L2).filter((L) => L.home === L2[K].home).length <= capOf(L2[K].home), '空いている家に入った');
  // 30 日を過ぎると、もどせない（保管も消える）
  node('tools/moveout.js', v.name, '--now', '2026-12-11T13:00:00+09:00');
  const e = fails('tools/movein-restore.js', v.name, '--now', '2027-01-11T13:00:01+09:00');
  assert.ok(e && /30 日を過ぎた/.test(e), e);
  assert.ok(!fs.existsSync(path.join(vault, vf[0])), '30 日を過ぎた保管は消える');
  assert.ok(!rd('villagers.json').some((x) => x.key === K));
  // 自動の片づけ（--purge）：30 日を過ぎた保管分だけ消す
  const w = rd('villagers.json').find((x) => x.name);
  node('tools/moveout.js', w.name, '--now', '2026-12-12T13:00:00+09:00');
  assert.ok(/0 件/.test(node('tools/movein-restore.js', '--purge', '--now', '2027-01-10T13:00:00+09:00')));
  assert.ok(/1 件/.test(node('tools/movein-restore.js', '--purge', '--now', '2027-01-12T13:00:01+09:00')));
  assert.deepStrictEqual(fs.readdirSync(vault), []);
  assert.strictEqual(fs.readFileSync(path.join(src, 'villagers.json'), 'utf8'), realBefore, '本物の data/ をさわった');
  assert.ok(!fs.existsSync(path.join(ROOT, '.vault')), 'リポジトリに保管を書いた');
});

// ---------- 手紙と家の飾り（tests/home_tests.js） ----------
require('./home_tests.js')({ t, at, ROOT });
// ---------- 誰かの家に遊びに行く（tests/visit_tests.js） ----------
require('./visit_tests.js')({ t, at, ROOT });
require('./treasure_tests.js')({ t, at, ROOT }); // 遊ぶの宝探し（金属探知機）

(async () => {
  for (const [name, fn] of asyncTests) { await fn(); ok++; console.log('OK  ' + name); }
  console.log(`\nぜんぶ通りました（${ok} 件）`);
})().catch((e) => { console.error(e); process.exit(1); });
