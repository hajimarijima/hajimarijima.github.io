'use strict';
// 手紙と家の飾り（js/letters.js・js/decor.js・tools/mail.js・tools/decor.js・worker.mjs の 6)・tools/play.js）。tests/run_tests.js から読む
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = function homeTests({ t, at, ROOT }) {
  const imp = (f) => import(require('url').pathToFileURL(path.join(ROOT, f)).href);
  const cfg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));

  at('家を飾る：マス・置けない所・重なり・持っている数・壁の絵・回した大きさ・住む人の順', async () => {
    const DC = await imp('js/decor.js');
    const look = { w: 4, d: 3.4 };
    const og = DC.outGrid(look), ig = DC.inGrid(look);
    assert.deepStrictEqual([og.cols, og.rows], [7, 3]);
    assert.deepStrictEqual([ig.cols, ig.rows], [3, 3]);
    assert.ok(og.z0 - DC.CELL / 2 >= look.d / 2, '庭のマスは家の壁の外');
    assert.ok(Math.abs(ig.x0) + DC.CELL / 2 <= look.w / 2 && Math.abs(ig.z0) + DC.CELL / 2 <= look.d / 2, '中のマスは壁の内側');
    for (let j = 0; j < 3; j++) assert.strictEqual(DC.blockedCell('out', look, DC.PATH_COL, j), 'path', '小道は置けない');
    assert.strictEqual(DC.blockedCell('out', look, ...DC.MAILBOX_CELL), 'mailbox');
    assert.strictEqual(DC.blockedCell('in', look, 1, ig.rows - 1), 'door', '扉の前は置けない');
    const own = { flowerbed: 2, bench: 1, rug: 1, bed: 1, picture: 1, chair: 1 };
    // 重なり・持っている数・はみ出し・小道
    const out = DC.cleanLayout('out', [['flowerbed', 0, 0, 0], ['flowerbed', 0, 0, 0], ['flowerbed', 1, 0, 0], ['flowerbed', 2, 0, 0], ['bench', 2, 1, 0], ['bench', 5, 1, 0], ['bed', 0, 1, 0], ['nope', 0, 2, 0]], look, own);
    assert.deepStrictEqual(out, [['flowerbed', 0, 0, 0], ['flowerbed', 1, 0, 0], ['bench', 5, 1, 0]], '重なり・3 つ目・小道にかかるベンチ・中の物・知らない物は捨てる');
    assert.deepStrictEqual(DC.cleanLayout('out', [['bench', 6, 0, 0]], look, own), [], 'はみ出す');
    assert.deepStrictEqual(DC.cleanLayout('out', [['bench', 6, 0, 1]], look, own), [['bench', 6, 0, 1]], '回すと縦に入る');
    // 家の中：じゅうたんの上に家具、絵は奥の壁だけ
    const inn = DC.cleanLayout('in', [['rug', 0, 0, 0], ['bed', 0, 0, 0], ['chair', 1, 0, 0], ['picture', 2, 1, 0], ['picture', 2, 0, 0]], look, own);
    assert.deepStrictEqual(inn, [['rug', 0, 0, 0], ['bed', 0, 0, 0], ['chair', 1, 0, 0], ['picture', 2, 0, 0]]);
    // 位置：2 マスの物は 2 マスのまん中。家の向きで回す（beds.js と同じ）
    const p = DC.localPos('out', look, 'bench', 5, 1, 0);
    assert.ok(Math.abs(p.x - (og.x0 + 5.5 * DC.CELL)) < 1e-9 && Math.abs(p.z - (og.z0 + DC.CELL)) < 1e-9);
    const w = DC.toWorldPos({ x: 10, z: 5, rot: Math.PI / 2 }, { x: 0, z: 2, yaw: 0 });
    assert.ok(Math.abs(w.x - 12) < 1e-9 && Math.abs(w.z - 5) < 1e-9, '扉が +x を向く家の前は +x');
    // 同じ家の人：先に来た人のマスは後の人は使えない
    const vs = [{ key: 'b', joinedDay: 3 }, { key: 'a', joinedDay: 1 }], life = { a: { home: 'h1' }, b: { home: 'h1' } };
    const res = DC.residentsOf({ id: 'h1' }, vs, life);
    assert.deepStrictEqual(res.map((x) => x.key), ['a', 'b']);
    const hl = DC.houseLayout({ id: 'h1' }, look, res, { a: { own: { flowerbed: 1 }, out: [['flowerbed', 0, 0, 0]], in: [] }, b: { own: { flowerbed: 2 }, out: [['flowerbed', 0, 0, 0], ['flowerbed', 1, 0, 0]], in: [] } });
    assert.deepStrictEqual(hl.out, [['flowerbed', 0, 0, 0, 'a'], ['flowerbed', 1, 0, 0, 'b']]);
    assert.ok(DC.canPlace('out', [], look, own, 'flowerbed', 0, 0) && !DC.canPlace('out', [], look, own, 'flowerbed', DC.PATH_COL, 0));
    assert.strictEqual(DC.leftOf(own, out, [], 'flowerbed'), 0);
    for (const id of DC.DECOR_IDS) assert.ok(DC.EARN[DC.DECOR[id].from], '手に入れ方がある：' + id);
  });

  at('手紙：本文の決まり（長さ・禁止語・URL）・コメントの読み取り・村人どうしの文の型', async () => {
    const LT = await imp('js/letters.js');
    const c = cfg();
    assert.ok(LT.checkLetter('こんにちは！また釣りに行こうね', c).ok);
    assert.strictEqual(LT.checkLetter('  ', c).error, 'empty');
    assert.strictEqual(LT.checkLetter('あ'.repeat(LT.mailCfg(c).maxLen + 1), c).error, 'long');
    assert.ok(LT.checkLetter('あ'.repeat(LT.mailCfg(c).maxLen), c).ok);
    for (const s of ['しね', 'シネ', 'ｼﾈ', 'し ね', 'バカ', 'ﾊﾞｶじゃないの', 'きもい！', 'ウザい', 'FUCK']) assert.strictEqual(LT.checkLetter(s, c).error, 'ng', s);
    for (const s of ['ばかりしてる', 'くずもちおいしい', 'かすてら食べた', '生かす', 'いちねんたった', 'ばかでかい魚']) assert.ok(LT.checkLetter(s, c).ok, s);
    for (const s of ['https://x.example', 'www.example.com を見て', '@someone に会った', '090-1234-5678']) assert.strictEqual(LT.checkLetter(s, c).error, 'url', s);
    assert.strictEqual(LT.checkLetter('a\nb\nc\nd\ne\nf', c).error, 'lines');
    assert.strictEqual(LT.checkLetter('a\n\n\n\nb', c).text, 'a\n\nb', '改行は 2 つまでにそろえる');
    assert.ok(LT.hasNg('りんご', ['りんご']), 'config.mail.ngWords も見る');
    assert.deepStrictEqual(LT.parseLetterComment('手紙 @hanako_01 こんにちは！'), { to: 'hanako_01', body: 'こんにちは！' });
    assert.deepStrictEqual(LT.parseLetterComment('てがみ　はなこ　また遊ぼう'), { to: 'はなこ', body: 'また遊ぼう' });
    assert.strictEqual(LT.parseLetterComment('手紙'), null);
    assert.strictEqual(LT.parseLetterComment('住みたい'), null);
    assert.ok(LT.giftOk('apple') && LT.giftOk('fish_aji') && !LT.giftOk('wood_pickaxe') && !LT.giftOk('iron_mail'));
    // 型の組み合わせ：どれも禁止語がなく、名前が入る
    const R = (await imp('js/play/rules.js')).makeRng(7);
    for (const kind of ['family', 'best', 'friend', 'crush', 'rival', 'known', 'x']) for (let i = 0; i < 30; i++) {
      const s = LT.villagerLetter(kind, { from: 'たろう', to: 'はなこ', job: ['wood', 'stone', 'food', 'smith', null][i % 5], weather: ['晴れ', '雨', 'くもり'][i % 3], built: i % 4 ? '' : '井戸' }, () => R.next());
      assert.ok(s.length > 8 && !/\{\w+\}/.test(s) && !LT.hasNg(s), s);
    }
    const th = LT.thanksLetter({ gift: 'りんご', decor: 'ベンチ' }, () => 0.1);
    assert.ok(/りんご/.test(th) && /ベンチ/.test(th));
  });

  t('手紙と家の飾り：毎日の更新（web・コメント・お礼・村人どうし・持ち物を添える・飾りを手に入れる・並べ方）', () => {
    const MAIL = require(path.join(ROOT, 'tools', 'mail.js'));
    const DEC = require(path.join(ROOT, 'tools', 'decor.js'));
    const P = require(path.join(ROOT, 'tools', 'people.js'));
    const c = cfg(); c.decor = { ...c.decor, enabled: true }; // 家を飾るが開いている時の形（今の config は「近日公開」）
    const mk = (key, name, joinedDay = 0) => ({ key, name, display: name, joinedDay, igId: P.igHash('id-' + key), userHash: P.userHash(name) });
    const villagers = [mk('a', 'alice'), mk('b', 'bob'), mk('c', 'carol'), mk('z', 'zed', 99)];
    const life = {};
    for (const v of villagers) life[v.key] = { inv: [{ item: 'apple', n: 2 }, null, null], slots: 3, diary: [{ day: 5, text: '' }], home: null };
    const S = { config: c, villagers, life, state: { day: 5, date: '2026-12-01', weather: '晴れ' }, history: [{ day: 5, kind: 'festival', event: 'winter', text: '島の行事', who: ['b'] }, { day: 5, kind: 'event', text: 'チェストを置いた' }], world: { buildings: [] }, social: { pairs: { 'a|b': { s: 60, w: 0, family: 0 }, 'b|c': { s: 25, w: 0, family: 0 } } }, mail: null, decor: null };
    const now = Date.parse('2026-12-01T05:00:00+09:00');
    S.inbox = { joinComments: [
      { id: '1', text: '手紙 @bob こんにちは', timestamp: new Date(now - 3600e3).toISOString(), from: { id: 'id-a', username: 'alice' } },
      { id: '2', text: '手紙 @bob ばか', timestamp: new Date(now - 3500e3).toISOString(), from: { id: 'id-a', username: 'alice' } },
      { id: '3', text: '手紙 @carol また', timestamp: new Date(now - 3400e3).toISOString(), from: { id: 'id-a', username: 'alice' } },
      { id: '4', text: '手紙 @carol 3通目', timestamp: new Date(now - 3300e3).toISOString(), from: { id: 'id-a', username: 'alice' } },
      { id: '5', text: '手紙 @zed まだ来ていない人', timestamp: new Date(now - 3200e3).toISOString(), from: { id: 'id-b', username: 'bob' } },
      { id: '6', text: '手紙 @carol 古いコメント', timestamp: new Date(now - 3 * 86400e3).toISOString(), from: { id: 'id-b', username: 'bob' } },
    ] };
    const play = {
      days: { '2026-11-30': { a: { fish: 2, chores: 0, treasure: true, catches: [['fish_aji', 20]] } } },
      mail: { '2026-11-30': { a: [{ id: 'W1', to: 'c', text: 'りんごをどうぞ', gift: 'apple' }, { id: 'W2', to: 'a', text: '自分あて', gift: null }] } },
      decor: { a: { out: [['lantern', 0, 0, 0], ['lantern', 1, 0, 0], ['bench', 2, 1, 0]], in: [], at: '2026-11-30T10:00:00Z' } },
      terms: { a: { version: 99, at: '2026-11-30T09:00:00Z' } }, // 手紙のきまりに同意した人（コメントの手紙は同意した人だけ）
    };
    S.inbox.joinComments.push({ id: '7', text: '手紙 @alice 同意していない人', timestamp: new Date(now - 3100e3).toISOString(), from: { id: 'id-c', username: 'carol' } });
    let n = 0; const R = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    S.decor = { a: { own: { lantern: 1 }, out: [], in: [], got: [], earned: [] } };
    const TP = ['lantern', 'shelf', 'lamp'], nT = () => TP.reduce((x, id) => x + (S.decor.a.own[id] || 0), 0);
    DEC.stepDecor(S, { day: 5, play });
    assert.strictEqual(nT(), 2, '宝探しで宝の飾りを 1 つ');
    assert.deepStrictEqual(S.decor.a.out, S.decor.a.own.lantern >= 2 ? [['lantern', 0, 0, 0], ['lantern', 1, 0, 0]] : [['lantern', 0, 0, 0]], '持っている数だけ・小道にかかる物は置かない');
    assert.ok(Object.values(S.decor.b.own).reduce((x, y) => x + y, 0) >= 1, '行事に出た人は飾りをもらう');
    assert.ok(!S.decor.c, 'ただの出来事（kind event）では飾りはもらえない');
    DEC.stepDecor(S, { day: 5, play });
    assert.strictEqual(nT(), 2, '同じ日・同じわけでは 1 回だけ');
    MAIL.stepMail(S, { day: 5, play, since: now - 86400e3, R });
    const L = S.mail.letters;
    const web = L.find((x) => x.id === 'wW1');
    assert.ok(web && web.to === 'c' && web.gift === 'apple' && web.kind === 'web');
    assert.strictEqual(life.a.inv[0].n, 1, '添えたりんごは送った人から減る'); assert.ok(life.c.inv.some((s) => s && s.item === 'apple' && s.n === 3), '相手に入る');
    assert.ok(!L.some((x) => x.id === 'wW2'), '自分あては届けない');
    const cm = L.filter((x) => x.kind === 'comment');
    assert.deepStrictEqual(cm.map((x) => [x.from, x.to, x.text]), [['a', 'b', 'こんにちは'], ['a', 'c', 'また']], '禁止語ははじく・web と合わせて 1 日 3 通まで・まだいない人・古いコメントは読まない');
    assert.ok(L.some((x) => x.kind === 'thanks' && x.from === 'c' && x.to === 'a' && x.decor), '添え物をもらった人は飾りを添えてお礼');
    assert.ok(!L.some((x) => x.kind === 'comment' && x.from === 'c') && S.mail.needTerms.c === 5, 'きまりに同意していない人のコメントは届けず、案内する');
    assert.ok(life.b.diary[0].text.includes('aliceから手紙が届いた'));
    const before = L.length;
    MAIL.stepMail(S, { day: 5, play, since: now - 86400e3, R });
    assert.ok(!S.mail.letters.slice(before).some((x) => x.kind === 'web' || x.kind === 'comment'), '同じ手紙は 2 回届けない');
    // 村人どうし：仲のいい 2 人の間だけ。型の文
    const S2 = { ...S, inbox: null, mail: null };
    for (let d = 6; d < 60; d++) MAIL.stepMail(S2, { day: d, R });
    const vl = S2.mail.letters.filter((x) => x.kind === 'villager');
    assert.ok(vl.length > 0, '村人どうしも書く');
    assert.ok(vl.every((x) => ['a', 'b', 'c'].includes(x.from) && ['a', 'b', 'c'].includes(x.to) && x.from !== x.to));
    const per = {}; for (const x of S2.mail.letters) per[x.to] = (per[x.to] || 0) + 1;
    assert.ok(Object.values(per).every((k) => k <= 15), '受け取った人ごとに keep 通まで');
    // 飾りを手紙に添える：置いていない物だけ
    S.decor.a.own.flowerbed = 1; S.decor.a.out.push(['flowerbed', 1, 0, 0]);
    assert.ok(!DEC.give(S, 'a', 'b', 'flowerbed', 5), '置いている物はあげられない');
    S.decor.a.own.flowerbed = 2;
    assert.ok(DEC.give(S, 'a', 'b', 'flowerbed', 5) && S.decor.b.own.flowerbed >= 1);
    assert.strictEqual(MAIL.findTo(villagers, '@ALICE').key, 'a');
  });

  at('手紙と家の飾り：受け口（/mail/send の数・禁止語・/mail/state・/me/decor・pull）と play.js', async () => {
    const W = await imp('tools/webhook/worker.mjs');
    const LT = await imp('js/letters.js');
    assert.deepStrictEqual(W.NG_WORDS, LT.NG_WORDS, '禁止語は js/letters.js と同じ');
    assert.deepStrictEqual(W.NG_OK, LT.NG_OK);
    assert.deepStrictEqual(W.MAIL_DEF, { perDay: LT.MAIL_DEFAULTS.perDay, maxLen: LT.MAIL_DEFAULTS.maxLen });
    for (const s of ['やあ', 'シネ', 'ばかりだね', 'https://a.b', 'あ'.repeat(81), '', 'a\n\n\n\nb', 'ﾊﾞｶ']) assert.deepStrictEqual(W.checkLetter(s, {}), LT.checkLetter(s, {}), '同じ決まり：' + s);
    W._resetSiteConfig();
    const store = new Map();
    const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
    const QT = 'q'.repeat(24), env = { TOWN_KV: kv, DM_QUEUE_TOKEN: QT, SITE_ORIGIN: 'https://isle.example' };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => (String(u).endsWith('/data/config.json') ? new Response(JSON.stringify({ ...cfg(), mail: { perDay: 2 } }), { status: 200 }) : new Response('{}', { status: 404 }));
    const call = async (p, tok, body) => { const r = await W.default.fetch(new Request('https://w.example' + p, { method: body === undefined ? 'GET' : 'POST', headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} }); return { status: r.status, j: await r.json().catch(() => null), h: r.headers }; };
    try {
      const ta = await W.issueMe(env, 'alice');
      assert.strictEqual((await call('/mail/send', null, { to: 'bob', text: 'hi' })).status, 401);
      let r0 = await call('/mail/send', ta, { to: 'bob', text: 'hi' }); assert.strictEqual(r0.status, 403); assert.strictEqual(r0.j.error, 'terms', 'きまりに同意するまで送れない');
      assert.strictEqual((await call('/mail/state', ta)).j.terms.agreed, false);
      assert.strictEqual((await call('/mail/agree', ta, { version: 0 })).status, 400, '古い版には同意できない');
      r0 = await call('/mail/agree', ta, { version: W.TERMS_VER }); assert.strictEqual(r0.status, 200); assert.ok(r0.j.terms.at);
      assert.strictEqual(JSON.parse(store.get('tm:alice')).version, W.TERMS_VER, '同意と日時と版を村人ごとに残す');
      assert.strictEqual((await call('/mail/send', ta, { to: 'alice', text: 'hi' })).j.error, 'to', '自分あてはだめ');
      assert.strictEqual((await call('/mail/send', ta, { to: 'bob', text: 'ばか' })).j.error, 'ng');
      assert.strictEqual((await call('/mail/send', ta, { to: 'bob', text: 'あ'.repeat(81) })).j.error, 'long');
      assert.strictEqual((await call('/mail/send', ta, { to: 'bob', text: 'やあ', gift: 'iron_sword' })).j.error, 'gift');
      let r = await call('/mail/send', ta, { to: 'bob', text: ' やあ ', gift: 'apple' });
      assert.strictEqual(r.status, 200); assert.strictEqual(r.j.letter.text, 'やあ'); assert.strictEqual(r.j.left, 1);
      assert.strictEqual(r.h.get('Access-Control-Allow-Origin'), 'https://isle.example');
      assert.strictEqual((await call('/mail/send', ta, { to: 'carol', text: 'またね', gift: 'bench' })).j.left, 0);
      r = await call('/mail/send', ta, { to: 'carol', text: '3 通目' }); assert.strictEqual(r.status, 429); assert.strictEqual(r.j.error, 'limit');
      r = await call('/mail/state', ta); assert.strictEqual(r.j.mail.sent.length, 2); assert.strictEqual(r.j.mail.left, 0); assert.strictEqual(r.j.decor, null);
      assert.strictEqual((await call('/me/decor', ta, { out: [['rocket', 0, 0, 0]], in: [] })).status, 400, '知らない飾り');
      assert.strictEqual((await call('/me/decor', ta, { out: [['bench', 0, 0, 9]], in: [] })).status, 400, '向きは 0〜3');
      r = await call('/me/decor', ta, { out: [['bench', 0, 0, 1]], in: [['rug', 0, 0, 0]] }); assert.strictEqual(r.status, 200);
      const op = await W.default.fetch(new Request('https://w.example/mail/send', { method: 'OPTIONS' }), env, {}); assert.strictEqual(op.status, 204);
      // 通報：同じ人は 1 回。ほかの人の分は足す
      const tb = await W.issueMe(env, 'bob');
      assert.strictEqual((await call('/mail/report', ta, { id: '../x' })).status, 400);
      assert.strictEqual((await call('/mail/report', ta, { id: 'v5-1' })).j.n, 1);
      assert.strictEqual((await call('/mail/report', ta, { id: 'v5-1' })).j.n, 1, '同じ人は 1 回');
      assert.strictEqual((await call('/mail/report', tb, { id: 'v5-1' })).j.n, 2);
      r = await call('/play/pull?days=1', QT);
      const d = W.jstDate();
      assert.strictEqual(r.j.reports['v5-1'], 2); assert.strictEqual(r.j.terms.alice.version, W.TERMS_VER);
      const PL0 = require(path.join(ROOT, 'tools', 'play.js')).clean(r.j);
      assert.strictEqual(PL0.reports['v5-1'], 2); assert.strictEqual(PL0.terms.alice.version, W.TERMS_VER);
      assert.strictEqual(r.j.mail[d].alice.length, 2); assert.deepStrictEqual(r.j.decor.alice.out, [['bench', 0, 0, 1]]);
      const PL = require(path.join(ROOT, 'tools', 'play.js'));
      const cl = PL.clean({ ...r.j, mail: { ...r.j.mail, bad: {} }, decor: { ...r.j.decor, '../x': { out: [] } } });
      assert.deepStrictEqual(Object.keys(cl.mail), [d]); assert.deepStrictEqual(Object.keys(cl.decor), ['alice']);
      assert.strictEqual(cl.mail[d].alice[0].gift, 'apple');
      assert.ok(!('mail' in PL.clean({ days: {} })), '手紙がない時は前と同じ形');
    } finally { globalThis.fetch = realFetch; W._resetSiteConfig(); }
  });

  at('手紙のきまり（同意書）と通報：版がそろう・terms.html の中身・通報で隠す・運営が消す・止める', async () => {
    const TM = await imp('js/terms.js'), W = await imp('tools/webhook/worker.mjs');
    assert.strictEqual(W.TERMS_VER, TM.TERMS_VERSION, '版は js/terms.js と Worker で同じ');
    assert.ok(TM.agreedOk({ version: TM.TERMS_VERSION }) && !TM.agreedOk({ version: TM.TERMS_VERSION - 1 }) && !TM.agreedOk(null), '版が上がったら同意し直す');
    const h = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
    for (const w of ['公開', '悪口', '住所', '電話', '学校', 'SNS', '会う約束', '宣伝', '消したり', '送れないように', '13 歳', 'おうちの人', 'Instagram の DM', '出会うための場所ではありません', '連絡先', 'いやがらせ', 'えっちな話', 'なりすます', 'お金のやりとり', '第 2 版']) assert.ok(h.includes(w), 'terms.html：' + w);
    assert.ok(TM.TERMS_VERSION >= 2 && TM.TERMS_POINTS.some((s) => /出会うための場所ではありません/.test(s) && /連絡先/.test(s)) && TM.TERMS_POINTS.some((s) => /なりすまし/.test(s) && /お金/.test(s)), '短いきまりにも出会い・不適切なことの禁止');
    // 出会い・連絡先の交換につながる言葉ははじく（ふつうの言葉は通す）。Worker も同じ
    const LT2 = await imp('js/letters.js');
    for (const s of ['LINE交換しよ', 'ライン教えて', 'カカオやってる？', '今度会おうよ', 'どこで会える？', '裏垢あるよ', 'オフ会しない？', 'ディスコードで話そ', 'パパ活', '連絡先おしえて']) { assert.strictEqual(LT2.checkLetter(s, {}).error, 'ng', s); assert.strictEqual(W.checkLetter(s, {}).error, 'ng', 'worker：' + s); }
    for (const s of ['オンラインで遊んだ', 'スタートラインに立った', 'カカオ豆のチョコ', 'また島で遊ぼうね', 'あえていうなら']) { assert.ok(LT2.checkLetter(s, {}).ok, s); assert.ok(W.checkLetter(s, {}).ok, 'worker：' + s); }
    assert.ok(!/マイクラ|マインクラフト/.test(h));
    // 通報で隠す・運営の道具
    const MAIL = require(path.join(ROOT, 'tools', 'mail.js'));
    const S = { config: { mail: { reportHide: 2 } }, mail: { letters: [{ id: 'a1', from: 'x', to: 'y', text: 'ok' }, { id: 'a2', from: 'x', to: 'y', text: 'いや' }], reports: { a1: 1, a2: 2 } } };
    MAIL.applyReports(S);
    assert.ok(!S.mail.letters[0].hidden && S.mail.letters[1].hidden, '通報が reportHide 件で隠す');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'town-mail-'));
    fs.writeFileSync(path.join(dir, 'mail.json'), JSON.stringify(S.mail));
    assert.ok(/a2/.test(MAIL.admin(['reported'], dir)));
    assert.ok(/消しました/.test(MAIL.admin(['remove', 'a2'], dir)));
    MAIL.admin(['ban', 'x'], dir);
    const M = JSON.parse(fs.readFileSync(path.join(dir, 'mail.json'), 'utf8'));
    assert.deepStrictEqual(M.letters.map((L) => L.id), ['a1']); assert.deepStrictEqual(M.banned, ['x']);
    assert.ok(/つかい方/.test(MAIL.admin(['remove', '../x'], dir)));
    fs.rmSync(dir, { recursive: true, force: true });
    // ページ：同意するまで書く所を出さない・通報ボタン
    const mp = fs.readFileSync(path.join(ROOT, 'js', 'mailpage.js'), 'utf8');
    assert.ok(/\/mail\/agree/.test(mp) && /terms\.html/.test(mp) && /bindReports/.test(mp));
    assert.ok(/class="lrep"/.test(fs.readFileSync(path.join(ROOT, 'js', 'letterview.js'), 'utf8')));
  });

  at('家を飾る「近日公開」（config.decor.enabled false）：飾りは手に入らず、家の中はもとからある家具・手紙はそのまま', async () => {
    const DC = await imp('js/decor.js');
    const DEC = require(path.join(ROOT, 'tools', 'decor.js'));
    const MAIL = require(path.join(ROOT, 'tools', 'mail.js'));
    const c = cfg();
    assert.strictEqual(c.decor.enabled, false, '今は近日公開'); assert.ok(/島がもっと大きく/.test(c.decor.openNote));
    assert.ok(!DC.decorOn(c) && DC.decorOn({ ...c, decor: { ...c.decor, enabled: true } }) && DC.decorOn({}), 'enabled を書かなければ開いている');
    assert.ok(DC.soonBadge(c).includes('近日') && DC.soonBadge({}) === '');
    // 家の飾り：閉じている間は、持っている飾りでなく、もとからある家具（外は何もなし）
    const look = c.buildings.house.look, b = { id: 'h1', x: 0, z: 0, rot: 0 };
    const res = [{ key: 'a' }], decor = { a: { own: { lantern: 1, plant: 1 }, out: [['lantern', 0, 0, 0]], in: [['plant', 0, 0, 0]] } };
    const off = DC.homeLayoutFor(b, look, res, decor, c), on = DC.homeLayoutFor(b, look, res, decor, { ...c, decor: { enabled: true } });
    assert.deepStrictEqual(off.out, []); assert.ok(off.in.some((e) => e[0] === 'chair') && off.in.some((e) => e[0] === 'shelf') && off.in.every((e) => e[4] === 'a'), 'いす・本だながある');
    assert.strictEqual(off.in.length, DC.cleanLayout('in', DC.BASIC_ROOM, look).length, '入る物はみな置ける');
    assert.deepStrictEqual(on, DC.houseLayout(b, look, res, decor), 'true にすれば今の形');
    // 毎日の更新：釣り・宝探し・行事でも飾りは増えず、web で置いた並べ方も入れない。お礼の手紙に飾りは添えない
    const P = require(path.join(ROOT, 'tools', 'people.js'));
    const mk = (key, name) => ({ key, name, display: name, joinedDay: 0, igId: P.igHash('id-' + key), userHash: P.userHash(name) });
    const villagers = [mk('a', 'alice'), mk('c', 'carol')], life = {};
    for (const v of villagers) life[v.key] = { inv: [{ item: 'apple', n: 2 }, null, null], slots: 3, diary: [{ day: 5, text: '' }], home: null };
    const S = { config: c, villagers, life, state: { day: 5, date: '2026-12-01' }, history: [{ day: 5, kind: 'festival', event: 'winter', text: '島の行事', who: ['a', 'c'] }], world: { buildings: [] }, social: { pairs: {} }, mail: null, decor: { a: { own: { lantern: 1 }, out: [], in: [], got: [], earned: [] } }, inbox: { joinComments: [] } };
    const play = { days: { '2026-11-30': { a: { catches: [['fish_aji', 20]], chores: 9, treasure: true } } }, mail: { '2026-11-30': { a: [{ id: 'W1', to: 'c', text: 'りんごをどうぞ', gift: 'apple' }, { id: 'W2', to: 'c', text: 'ランタンをどうぞ', gift: 'lantern' }] } }, decor: { a: { out: [['lantern', 0, 0, 0]], in: [], at: '2026-11-30T10:00:00Z' } }, terms: { a: { version: 99, at: '2026-11-30T09:00:00Z' } } };
    const before = JSON.stringify(S.decor);
    DEC.stepDecor(S, { day: 5, play });
    let n = 0; const R = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    MAIL.stepMail(S, { day: 5, play, since: Date.parse('2026-11-30T00:00:00Z'), R });
    assert.strictEqual(JSON.stringify(S.decor), before, '飾りは増えも減りもしない（データはそのまま残る）');
    const L = S.mail.letters;
    assert.ok(L.some((x) => x.id === 'wW1' && x.gift === 'apple'), '手紙と持ち物の添え物はそのまま');
    assert.ok(!L.some((x) => x.id === 'wW2' && x.gift), '飾りは添えられない');
    assert.ok(L.some((x) => x.kind === 'thanks') && !L.some((x) => x.decor) && !L.some((x) => /飾り/.test(x.text)), 'お礼の手紙に飾りは添えない');
    // ページ：閉じている間は案内カード（置き場・持ち物・保存は出さない）。「近日」の印
    const hp = fs.readFileSync(path.join(ROOT, 'js', 'homepage.js'), 'utf8');
    assert.ok(/if \(!decorOn\(config\)\) \{ soonPage/.test(hp) && /soon-card/.test(hp) && /decorSoonText/.test(hp) && /visitcards/.test(hp));
    for (const f of ['js/mepost.js', 'js/mailpage.js']) assert.ok(/soonBadge\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
    for (const f of ['js/decor3d.js', 'js/villagerhome.js', 'js/visit3d.js']) assert.ok(/homeLayoutFor\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
  });

  t('手紙と家の飾り：ページ・3D のファイル・言葉の決まり', () => {
    const files = ['mail.html', 'home.html', 'js/letters.js', 'js/decor.js', 'js/decor3d.js', 'js/mailbox3d.js', 'js/mailpage.js', 'js/homepage.js', 'js/homedata.js', 'js/letterview.js', 'js/mepost.js', 'js/villagerhome.js', 'tools/mail.js', 'tools/decor.js', 'css/home.css'];
    const all = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    assert.ok(!/マイクラ|マインクラフト/.test(all), '作品の名前を入れない');
    for (const f of ['mail.html', 'home.html']) { const h = fs.readFileSync(path.join(ROOT, f), 'utf8'); assert.ok(/noindex/.test(h) && /css\/home\.css/.test(h)); }
    const town = fs.readFileSync(path.join(ROOT, 'js', 'town.js'), 'utf8');
    assert.ok(/loadHomeDecor\(D\)/.test(town) && /homeDecorSolids\(HD\)/.test(town) && /addHomeDecor\(scene, HD/.test(town), '町の画面は 3 つ呼ぶだけ');
    const sim = fs.readFileSync(path.join(ROOT, 'tools', 'sim.js'), 'utf8');
    assert.ok(/require\('\.\/decor'\)\.stepDecor/.test(sim) && /require\('\.\/mail'\)\.stepMail/.test(sim) && /write\('mail\.json'/.test(sim));
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8');
    assert.ok(/tools\/play\.js pull/.test(yml) && /data\/mail\.json/.test(yml));
    const vh = fs.readFileSync(path.join(ROOT, 'villager.html'), 'utf8');
    assert.ok(/id="mailsec"/.test(vh) && /id="homesec"/.test(vh));
  });
};
