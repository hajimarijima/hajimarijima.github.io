#!/usr/bin/env node
'use strict';
// 参加の登録（「参加したい」コメント）・投票の集計・フォロワー取り込み・名前かくしを、見本の JSON で確かめる。
// 使い方: node tests/run_tests.js   （本物の data/ はさわらない。一時フォルダで動かす）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('assert');
const P = require('../tools/people');

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
  assert.ok(st.vote && st.vote.milestone === 10, '投票が開く');
  // 投票の時刻を見本に合わせて、コメントを入れて 3 日進める
  st.vote.opensAt = sample.vote.opensAt; st.vote.closesAt = sample.vote.closesAt;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));
  fs.writeFileSync(inbox, JSON.stringify({ followers: sample.followers, joinComments: sample.joinComments, voteComments: sample.voteComments }));
  node('tools/sim.js', '--inbox', inbox);
  st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.deepStrictEqual(st.vote.votes, sample.expect.votes);
  node('tools/sim.js', '--inbox', inbox, '--days', '2');
  st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.strictEqual(st.vote, null);
  const d = st.decisions[0];
  assert.deepStrictEqual(d.votes, sample.expect.votes);
  assert.ok(d.key === 'A' || d.key === 'B', '同点の A と B のどちらか（くじ引き）');
  assert.strictEqual(d.tie, true);
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
    const w = fs.readFileSync(path.join(dir, 'world.json'), 'utf8') + fs.readFileSync(path.join(dir, 'life.json'), 'utf8');
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
  const life = JSON.parse(fs.readFileSync(path.join(dir, 'life.json'), 'utf8'));
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
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
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
  fs.copyFileSync(path.join(ROOT, 'data', 'config.json'), path.join(dir, 'config.json'));
  const env = { ...process.env, TOWN_DATA: dir };
  const node = (f, ...a) => execFileSync(process.execPath, [path.join(ROOT, f), ...a], { env, encoding: 'utf8' });
  node('tools/init.js', '--demo'); node('tools/sim.js', '--demo', '--days', '30');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const h = rd('history.json').filter((x) => x.type === 'night');
  assert.ok(h.length >= 5, '夜のできごとが履歴にある');
  assert.ok(h.every((x) => /日目の夜、/.test(x.text)));
  assert.strictEqual(rd('villagers.json').length, 20);
  const life = rd('life.json');
  for (const k in life) for (const d of life[k].diary) if (/ケガで、今日は家で休んだ/.test(d.text)) assert.ok(life[k].diary.some((e) => e.day === d.day - 1 && /ケガをした/.test(e.text)), 'ケガの次の日だけ休む');
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
  const w0 = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'));
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
t('投票：序盤（10・25 人）は普通の村の建物だけ。時計台などの特別な建物は後の節目', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const plain = new Set(['hut', 'house', 'well', 'storehouse', 'fence', 'workshop', 'watch', 'garden', 'plaza', 'shop', 'lamps', 'wall']);
  for (const m of config.milestones.filter((x) => x.at <= 25)) for (const o of m.options) assert.ok(plain.has(o.build), `${m.at} 人の ${o.build}`);
  const ct = config.milestones.find((m) => m.options.some((o) => o.build === 'clocktower'));
  assert.ok(ct && ct.at >= 50, '時計台は 50 人以降');
});

console.log(`\nぜんぶ通りました（${ok} 件）`);
