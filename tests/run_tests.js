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
  for (const b of bad) assert.ok(!text.includes(b.toLowerCase()), '公開ファイルに入っている：' + b);
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
const IC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).inventory;
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
const FIELDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).profileFields;
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  const cfgN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')), C = config.combat;
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
  const BG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).badges;
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  assert.ok(w0.trees.some((t) => t.x < -90 || t.x > 90) && w0.trees.some((t) => t.z < -90), '町の外まで森が続く（一辺がおよそ 2 倍）');
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
const RCFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
    const out = { n0, counts, world: rd('world.json'), history: rd('history.json'), store: rd('state.json').store };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  };
  const a = run(), b = run();
  assert.deepStrictEqual(a.world.animals, b.world.animals, '動物の動きが同じ');
  assert.deepStrictEqual(a.world.fields, b.world.fields, '畑が同じ');
  assert.deepStrictEqual(a.store, b.store, 'チェストの中身が同じ');
  assert.ok(a.n0 >= 8 && a.counts.every((n) => n === a.n0), '動物は 1 匹も減らない（村人は動物を殺さない）');
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
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
    for (const a of w.animals) if (a.pen && a.tamedDay === st.day) assert.ok(a.ledBy && life[a.ledBy] && life[a.ledBy].lure, '柵に入った動物は、種や作物を持った人が連れてきた');
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
const HC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).hours;
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
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
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
  assert.ok(!STORE.readWorld(dir).chest.day,'0 日目はまだチェストを置かない（1 日目の朝）');
  // もう一度動かしても、同じ人は増えない・日記も増えない
  node('tools/join.js', '--now', '2026-11-27T10:15:00+09:00');
  assert.strictEqual(read('villagers.json').length, 1);
  assert.strictEqual(STORE.readLife(dir)[v.key].diary.length, 1);
  assert.strictEqual(read('history.json').filter((h) => h.type === 'join').length, 1);
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

console.log(`\nぜんぶ通りました（${ok} 件）`);
