'use strict';
// 誰かの家に遊びに行く（js/visits.js・tools/visit.js・worker.mjs の 7)・tools/play.js・js/visit3d.js・js/visitroom.js）。tests/run_tests.js から読む
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = function visitTests({ t, at, ROOT }) {
  const imp = (f) => import(require('url').pathToFileURL(path.join(ROOT, f)).href);
  const cfg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));

  at('遊びに行く：家の中のマス目（物のマスは通らない・じゅうたんは通れる）・立つ所・いすに座る所', async () => {
    const VS = await imp('js/visits.js');
    const DC = await imp('js/decor.js');
    const look = { w: 4, d: 3.4 };
    // 3×3。奥：本だな・絵、まん中：いす（右向き）、左下：植物。扉は下のまん中
    const list = [['shelf', 0, 0, 0], ['picture', 1, 0, 0], ['rug', 1, 1, 0], ['chair', 0, 1, 1], ['plant', 2, 2, 0]];
    const R = VS.roomGrid(look, list);
    assert.deepStrictEqual(R.door, [1, 2]);
    assert.ok(!R.free.has('0,0') && !R.free.has('0,1') && !R.free.has('2,2'), '床の物のマスは通れない');
    assert.ok(R.free.has('1,0') && R.free.has('1,1') && R.free.has('2,1'), '絵の下・じゅうたんの上は通れる');
    const p = VS.roomPath(R, R.door, [2, 0]);
    assert.ok(p && p.length === 4, 'いちばん短い道');
    for (let k = 1; k < p.length; k++) assert.strictEqual(Math.abs(p[k][0] - p[k - 1][0]) + Math.abs(p[k][1] - p[k - 1][1]), 1, 'ななめに行かない');
    assert.ok(p.every((c) => R.free.has(c.join(','))));
    assert.strictEqual(VS.roomPath(R, R.door, [0, 0]), null, '物のマスへは行けない');
    // 立つ所：本だなの前（下のマス）は いす なので、となりの通れるマス
    const shelf = R.items.find((x) => x.id === 'shelf');
    const st = VS.standCell(R, shelf, R.door);
    assert.ok(st && R.free.has(st.cell.join(',')) && Math.abs(st.cell[0] - 0) + Math.abs(st.cell[1] - 0) === 1);
    // いす：右向き（r=1）なので前は i+1。前のマスが空いていれば座れる。座る所は背もたれ（-z 側 0.2）から離れている
    const chair = R.items.find((x) => x.id === 'chair');
    const seat = VS.seatOf(R, chair);
    assert.deepStrictEqual(seat.front, [1, 1]); assert.ok(seat.ok);
    const back = { x: chair.x - Math.sin(chair.yaw) * 0.2, z: chair.z - Math.cos(chair.yaw) * 0.2 };
    assert.ok(Math.hypot(seat.x - back.x, seat.z - back.z) - 0.035 >= 0.125 + 0.03 + 0.1, '背中（体の奥行きの半分＋上着）が背もたれに入らない');
    // 座った時の脚（太さ 4px を水平に）の下は、座面より上
    const PX = 1 / 16, hip = 12 * PX, half = 2 * PX + 0.006, bodyY = VS.SEAT.top + half - hip;
    assert.ok(hip + bodyY - 2 * PX >= VS.SEAT.top, '脚が座面に入らない');
    assert.ok(VS.SEAT.top <= 0.51 + 1e-9 && VS.SEAT.top >= 0.5, 'いすの模型の座ぶとんの上（0.51）');
    // 前がふさがったいすには座らない
    const R2 = VS.roomGrid(look, [['chair', 0, 1, 1], ['plant', 1, 1, 0]]);
    assert.ok(!VS.seatOf(R2, R2.items[0]).ok);
    // 一言は選ぶだけ・禁止語なし
    const LT = await imp('js/letters.js');
    assert.ok(VS.NOTE_WORDS.length >= 6 && VS.NOTE_WORDS.every((w) => !LT.hasNg(w) && w.length <= 20));
    assert.ok(VS.noteOk(0) && !VS.noteOk(VS.NOTE_WORDS.length) && !VS.noteOk(-1) && !VS.noteOk('1'));
    assert.ok(/村人1さんが遊びに来たよ/.test(VS.visitLetter('村人1', 2)) && /また遊びに来るね/.test(VS.visitLetter('村人1', 2)));
    assert.ok(/が.+の家へ遊びに行った/.test(VS.visitHistText([{ from: 'A', to: 'B' }])));
    for (const id of Object.keys(VS.ROOM_ACTS)) assert.ok(DC.DECOR[id] && DC.DECOR[id].place === 'in', '家の中の飾り：' + id);
  });

  t('遊びに行く：毎日の更新（web の分・1 日の数・一言・郵便受け・村人どうし・年表・ノートの数）', () => {
    const V = require(path.join(ROOT, 'tools', 'visit.js'));
    const VS = require(path.join(ROOT, 'js', 'visits.js'));
    const c = cfg();
    const houseType = Object.keys(c.buildings).find((k) => c.buildings[k].look && c.buildings[k].look.kind === 'house' && c.buildings[k].cap);
    const mk = (key, joinedDay = 0) => ({ key, name: key, display: '村人' + key, joinedDay });
    const villagers = [mk('a'), mk('b'), mk('c'), mk('d'), mk('z', 99)];
    const life = {};
    for (const v of villagers) life[v.key] = { diary: [{ day: 5, text: '' }], home: null };
    life.b.home = 'h1'; life.c.home = 'h1'; life.d.home = 'h2'; life.a.home = 't1';
    const world = { buildings: [{ id: 'h1', type: houseType, x: 0, z: 0, rot: 0 }, { id: 'h2', type: houseType, x: 20, z: 0, rot: 0 }, { id: 't1', type: 'tent', x: 40, z: 0 }] };
    const history = [], hist = (type, text, extra) => history.push({ day: 5, type, text, ...(extra || {}) });
    const S = { config: c, villagers, life, world, state: { day: 5 }, social: { pairs: { 'a|d': { s: 90, w: 0 }, 'b|d': { s: 80, w: 0 } } }, mail: { letters: [], seen: [] }, visits: null };
    const play = { visits: { '2026-12-01': { a: [{ id: 'V1', to: 'b', note: 1 }, { id: 'V2', to: 'd' }, { id: 'V3', to: 'b' }, { id: 'V4', to: 'd' }, { id: 'V5', to: 'a' }], b: [{ id: 'V6', to: 'c' }, { id: 'V7', to: 'z' }] } } };
    V.stepVisit(S, { day: 5, play, R: () => 0.99, hist });
    const web = S.visits.notes.filter((n) => n.kind === 'web');
    assert.deepStrictEqual(web.map((n) => [n.from, n.to, n.home, n.note]), [['a', 'b', 'h1', 1], ['a', 'd', 'h2', null], ['a', 'b', 'h1', null]], '1 日 3 回まで・自分あて・同じ家の人・まだいない人には行かない');
    const L = S.mail.letters.filter((x) => x.kind === 'visit');
    assert.ok(L.some((x) => x.from === 'a' && x.to === 'b' && /村人aさんが遊びに来たよ/.test(x.text) && x.text.includes(VS.NOTE_WORDS[1])), '家の主の郵便受けに届く（一言つき）');
    assert.ok(L.some((x) => x.from === 'a' && x.to === 'c'), '同じ家に住む人みんなに');
    assert.ok(life.a.diary[0].text.includes('の家へ遊びに行った') && life.b.diary[0].text.includes('村人aが遊びに来た'));
    // あとから一言が付いた分は書き足す。同じ分は 2 回数えない
    play.visits['2026-12-01'].a[1].note = 3;
    const n0 = S.visits.notes.length, l0 = S.mail.letters.length;
    V.stepVisit(S, { day: 5, play, R: () => 0.99, hist });
    assert.strictEqual(S.visits.notes.length, n0); assert.strictEqual(S.mail.letters.length, l0);
    assert.strictEqual(S.visits.notes.find((n) => n.id === 'wV2').note, 3);
    // 村人どうし：仲のいい人の家へ（テントの人の所へは行かない）。年表に 1 行
    const S2 = { ...S, visits: null, mail: { letters: [], seen: [] } }; history.length = 0;
    let k = 0; const R = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
    for (let d = 6; d < 80; d++) V.stepVisit(S2, { day: d, R, hist });
    const vv = S2.visits.notes.filter((n) => n.kind === 'villager');
    assert.ok(vv.length > 0, '村人どうしも遊びに行く');
    assert.ok(vv.every((n) => n.to !== 'a' && (S2.life[n.from].home !== n.home) && VS.noteOk(n.note)));
    assert.ok(history.length > 0 && history.every((h) => h.type === 'visit' && h.who.length >= 2 && /遊びに行った/.test(h.text)));
    const per = {}; for (const n of S2.visits.notes) per[n.home] = (per[n.home] || 0) + 1;
    assert.ok(Object.values(per).every((x) => x <= VS.VISIT_DEFAULTS.keep), '家ごとに keep 件まで');
    assert.ok(!S2.mail.letters.length, '村人どうしの分は郵便受けに入れない');
  });

  at('遊びに行く：受け口（/visit/go の数・/visit/note・/visit/state・pull）と play.js', async () => {
    const W = await imp('tools/webhook/worker.mjs');
    const VS = await imp('js/visits.js');
    assert.strictEqual(W.NOTE_COUNT, VS.NOTE_WORDS.length, '一言の数は js/visits.js と同じ');
    assert.strictEqual(W.VISIT_DEF.perDay, VS.VISIT_DEFAULTS.perDay);
    W._resetSiteConfig();
    const store = new Map();
    const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
    const QT = 'q'.repeat(24), env = { TOWN_KV: kv, DM_QUEUE_TOKEN: QT, SITE_ORIGIN: 'https://isle.example' };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => (String(u).endsWith('/data/config.json') ? new Response(JSON.stringify({ ...cfg(), visit: { perDay: 2 } }), { status: 200 }) : new Response('{}', { status: 404 }));
    const call = async (p, tok, body) => { const r = await W.default.fetch(new Request('https://w.example' + p, { method: body === undefined ? 'GET' : 'POST', headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
    try {
      const ta = await W.issueMe(env, 'alice');
      assert.strictEqual((await call('/visit/go', null, { to: 'bob' })).status, 401);
      assert.strictEqual((await call('/visit/go', ta, { to: 'alice' })).j.error, 'to', '自分の家はだめ');
      let r = await call('/visit/go', ta, { to: 'bob' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.j.left, 1);
      const id = r.j.visit.id;
      assert.strictEqual((await call('/visit/go', ta, { to: 'carol' })).j.left, 0);
      r = await call('/visit/go', ta, { to: 'dan' }); assert.strictEqual(r.status, 429); assert.strictEqual(r.j.error, 'limit');
      assert.strictEqual((await call('/visit/note', ta, { id, note: 99 })).status, 400, '一言は決まった中から');
      assert.strictEqual((await call('/visit/note', ta, { id: 'nope', note: 1 })).status, 404);
      assert.strictEqual((await call('/visit/note', ta, { id, note: 2 })).status, 200);
      assert.strictEqual((await call('/visit/note', ta, { id, note: 3 })).status, 409, '一言は 1 回だけ');
      r = await call('/visit/state', ta); assert.strictEqual(r.j.visits.length, 2); assert.strictEqual(r.j.left, 0);
      const op = await W.default.fetch(new Request('https://w.example/visit/go', { method: 'OPTIONS' }), env, {}); assert.strictEqual(op.status, 204);
      r = await call('/play/pull?days=1', QT);
      const d = W.jstDate();
      assert.strictEqual(r.j.visits[d].alice.length, 2); assert.strictEqual(r.j.visits[d].alice[0].note, 2);
      const PL = require(path.join(ROOT, 'tools', 'play.js'));
      const cl = PL.clean({ ...r.j, visits: { ...r.j.visits, bad: {}, [d]: { ...r.j.visits[d], '../x': [{ id: 'abcd', to: 'b' }] } } });
      assert.deepStrictEqual(Object.keys(cl.visits), [d]); assert.deepStrictEqual(Object.keys(cl.visits[d]), ['alice']);
      assert.strictEqual(cl.visits[d].alice[0].note, 2); assert.ok(!('note' in cl.visits[d].alice[1]));
      assert.ok(!('visits' in PL.clean({ days: {} })), '遊びに行った分がない時は前と同じ形');
    } finally { globalThis.fetch = realFetch; W._resetSiteConfig(); }
  });

  t('遊びに行く：ページ・3D のファイル・town.js は 1 行だけ・言葉の決まり', () => {
    const files = ['js/visits.js', 'js/visit3d.js', 'js/visitroom.js', 'js/visitlink.js', 'js/visitcards.js', 'tools/visit.js', 'css/visit.css'];
    const all = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    assert.ok(!/マイクラ|マインクラフト/.test(all), '作品の名前を入れない');
    const town = fs.readFileSync(path.join(ROOT, 'js', 'town.js'), 'utf8');
    assert.strictEqual(town.split('\n').filter((l) => /visitStep|visit3d/.test(l)).length, 1,'town.js は p.visit の人を visit3d.js にまかせる 1 行だけ');
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(/js\/visit3d\.js/.test(idx) && /css\/visit\.css/.test(idx));
    for (const f of ['home.html', 'villager.html']) assert.ok(/css\/visit\.css/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
    const sim = fs.readFileSync(path.join(ROOT, 'tools', 'sim.js'), 'utf8');
    assert.ok(/require\('\.\/visit'\)\.stepVisit/.test(sim) && /write\('visits\.json'/.test(sim));
    assert.ok(/data\/visits\.json/.test(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily.yml'), 'utf8')));
    // 歩く時は進む向きを向く（家の中：向きを回してから進む。町：town.js の walkTo を使う）
    const room = fs.readFileSync(path.join(ROOT, 'js', 'visitroom.js'), 'utf8');
    assert.ok(/Math\.abs\(da\) < 0\.35\)/.test(room) && /walkTo\(p, q\.route/.test(fs.readFileSync(path.join(ROOT, 'js', 'visit3d.js'), 'utf8')));
  });
};
