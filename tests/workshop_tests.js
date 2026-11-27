'use strict';
// 工房（持ち物をチェストへ送る・作る・交換所・宝箱・熟練度・激レア・1 枠の上限）：js/workshop.js・tools/workshop.js・worker.mjs の 8)・tools/play.js。tests/run_tests.js から読む
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = function workshopTests({ at, t, ROOT }) {
  const imp = (f) => import(require('url').pathToFileURL(path.join(ROOT, f)).href);
  const cfg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const seq = (list) => { let i = 0; return () => list[i++ % list.length]; };

  at('工房：1 枠の上限（木・石 64・魚や鉱石 16・激レア 8・道具 1）と、上限をこえた枠を消さずに分ける', async () => {
    const WS = await imp('js/workshop.js'), C = cfg();
    assert.deepStrictEqual(['log', 'cobble', 'planks', 'fish_aji', 'iron', 'berry', 'golden_fish', 'treasure_box', 'wood_axe'].map((k) => WS.stackOf(C, k)), [64, 64, 64, 16, 16, 16, 8, 8, 1]);
    for (const [k, v] of Object.entries(C.items)) assert.ok(Number.isInteger(v.stack) && v.stack >= 1 && v.stack <= 64, 'stack がある：' + k);
    const inv = [null, null, null];
    assert.strictEqual(WS.addTo(inv, 3, 'fish_aji', 40, C), 0);
    assert.deepStrictEqual(inv.map((s) => s && s.n), [16, 16, 8], '魚は 16 ずつ');
    const inv2 = [{ item: 'fish_aji', n: 40 }, null, null, null];
    WS.splitOver(inv2, 4, C);
    assert.deepStrictEqual(inv2.map((s) => s && s.n), [16, 16, 8, null], '前の 64 のまま持っていた分は枠を分ける');
    const inv3 = [{ item: 'golden_fish', n: 20 }, { item: 'wood_axe', dur: 3, max: 30 }];
    WS.splitOver(inv3, 2, C);
    assert.strictEqual(inv3[0].n, 20, '空きがなければ消さずにそのまま持つ');
    // 毎日の更新の持ち物（tools/inventory.js）も同じ上限
    const I = require(path.join(ROOT, 'tools', 'inventory.js'));
    I.setItemStacks(C.items);
    try {
      const a = [null, null];
      assert.strictEqual(I.addItem(a, 2, 'fish_saba', 40, 64), 8, '16 × 2 枠 = 32 まで');
      assert.strictEqual(I.addItem([null], 1, 'log', 70, 64), 6, '木は 64');
      const b = [{ item: 'berry', n: 30 }, null];
      I.splitOver(b, 2); assert.deepStrictEqual(b.map((s) => s && s.n), [16, 14]);
    } finally { I.setItemStacks(null); }
  });

  at('工房：レシピは熟練度（バッジ）で開く・持ち物の材料で作る（原木から板・棒）・前の道具はチェストへ', async () => {
    const WS = await imp('js/workshop.js'), C = cfg();
    const L1 = { level: 1, badges: {}, slots: 4, inv: [{ item: 'log', n: 3 }, null, null, null] };
    assert.strictEqual(WS.recipeLock(C, 'wood_fishing_rod', L1), null, '釣りざおは最初から');
    assert.ok(WS.recipeLock(C, 'wood_axe', L1), '斧はまだ');
    assert.strictEqual(WS.recipeLock(C, 'wood_axe', { ...L1, level: 2 }), null, 'Lv2 で木の斧');
    assert.match(WS.recipeLock(C, 'stone_fishing_rod', L1).text, /釣り人.*銅/);
    assert.strictEqual(WS.recipeLock(C, 'iron_fishing_rod', { badges: { fisher: 1 } }), null, '釣り人の銀で鉄の釣りざお');
    assert.ok(WS.recipeLock(C, 'diamond_pickaxe', { badges: { miner: 1 } }) && !WS.recipeLock(C, 'diamond_pickaxe', { badges: { miner: 2 } }), '石掘りの金でダイヤ');
    const store = {};
    const L = JSON.parse(JSON.stringify(L1));
    const r = WS.applyOp(C, L, { t: 'craft', recipe: 'wood_fishing_rod' }, store);
    assert.ok(r.ok, r.why);
    assert.ok(L.inv.some((s) => s && s.item === 'wood_fishing_rod' && s.dur === C.crafting.tiers.wood.durability));
    assert.strictEqual(WS.countOf(L.inv, 'log'), 2, '原木 1 → 板 4（板 1 と棒 3 に使い、余りは持ち物に）');
    assert.ok(!WS.applyOp(C, L, { t: 'craft', recipe: 'wood_fishing_rod' }, store).ok, '同じ物はもう作らない');
    const L2 = { badges: { fisher: 0 }, slots: 4, inv: [{ item: 'wood_fishing_rod', dur: 4, max: 30 }, { item: 'cobble', n: 2 }, { item: 'stick', n: 3 }, null] };
    assert.ok(WS.applyOp(C, L2, { t: 'craft', recipe: 'stone_fishing_rod' }, store).ok);
    assert.strictEqual(store.wood_fishing_rod, 1, '前の釣りざおは島のチェストへ');
    const L3 = { level: 1, badges: {}, slots: 3, inv: [null, null, null] };
    const f = WS.applyOp(C, L3, { t: 'craft', recipe: 'wood_fishing_rod' }, null);
    assert.ok(!f.ok && /材料/.test(f.why), '材料がなければ作れない');
  });

  at('工房：チェストへ送る・交換所（@fish・@legend・バッジの段）', async () => {
    const WS = await imp('js/workshop.js'), C = cfg();
    const L = { slots: 5, badges: {}, inv: [{ item: 'fish_aji', n: 5 }, { item: 'fish_saba', n: 4 }, { item: 'golden_fish', n: 1 }, { item: 'pearl', n: 2 }, null] };
    const store = { log: 1 };
    assert.ok(WS.applyOp(C, L, { t: 'send', items: [['fish_saba', 2]] }, store).ok);
    assert.strictEqual(store.fish_saba, 2); assert.strictEqual(WS.countOf(L.inv, 'fish_saba'), 2);
    assert.ok(!WS.applyOp(C, L, { t: 'send', items: [['fish_saba', 9]] }, store).ok, '持っているより多くは送れない');
    assert.ok(!WS.applyOp(C, L, { t: 'send', items: [['wood_axe', 1]] }, store).ok, '道具は送れない');
    assert.ok(!WS.applyOp(C, L, { t: 'send', items: [['fish_aji', 0]] }, store).ok && !WS.applyOp(C, L, { t: 'send', items: [['nope', 1]] }, store).ok);
    assert.ok(WS.applyOp(C, L, { t: 'trade', trade: 'fish_iron' }, null).ok, '魚どれでも 6 → 鉄');
    assert.strictEqual(WS.countOf(L.inv, 'iron'), 1); assert.strictEqual(WS.groupCount(C, L.inv, '@fish'), 1);
    assert.ok(!WS.applyOp(C, L, { t: 'trade', trade: 'pearl_diamond' }, null).ok, '真珠 → ダイヤは釣り人の銀から');
    assert.ok(WS.applyOp(C, { ...L, badges: { fisher: 1 } }, { t: 'trade', trade: 'pearl_diamond' }, null).ok);
    const r = WS.applyOp(C, L, { t: 'trade', trade: 'legend_diamond' }, null);
    assert.ok(r.ok && WS.countOf(L.inv, 'diamond') === 3 && WS.countOf(L.inv, 'golden_fish') === 0, '激レア 1 → ダイヤ 3');
    assert.ok(!WS.applyOp(C, L, { t: 'trade', trade: 'nope' }, null).ok && !WS.applyOp(C, L, { t: 'trade', trade: 'fish_coal', times: 99 }, null).ok);
    for (const T of C.workshop.trades) for (const k of [...Object.keys(T.give), ...Object.keys(T.get)]) assert.ok(k.startsWith('@') || C.items[k], '交換の表の物がある：' + k);
  });

  at('工房：宝箱の確率（段の合計 1・激レアは 1〜3%）・帯の止まる所が当たり・激レアの印と絵', async () => {
    const WS = await imp('js/workshop.js'), C = cfg();
    const T = WS.boxTiers(C);
    assert.deepStrictEqual(T.map((x) => x.id), ['common', 'uncommon', 'rare', 'epic', 'legend'], '段は 5 つ（白・緑・青・紫・黄）');
    assert.ok(Math.abs(T.reduce((a, x) => a + x.p, 0) - 1) < 1e-9, '段の見こみの合計は 1');
    const lp = T.find((x) => x.id === 'legend').p, G = C.workshop.legend;
    for (const p of [lp, G.fishP]) assert.ok(p >= 0.01 && p <= 0.03, '激レアは 1〜3%');
    assert.ok(G.treasureP >= G.fishP && G.treasureP <= 0.06, '宝探しは少し高い');
    const legends = Object.entries(C.items).filter(([, v]) => v.rarity === 'legend').map(([k]) => k);
    assert.ok(legends.length >= 9 && legends.length <= 13, '激レアは 8〜12 種＋特別な物');
    for (const k of [...legends, 'treasure_box', ...G.fish.map((x) => x[0]), ...G.treasure.map((x) => x[0])]) { assert.ok(fs.existsSync(path.join(ROOT, 'icons', k + '.png')), '絵がある：' + k); assert.ok(C.items[k], 'items にある：' + k); }
    for (const x of T.find((y) => y.id === 'legend').items) assert.strictEqual(C.items[x[0]].rarity, 'legend', '激レアの段は rarity: legend だけ');
    const R = (await imp('js/play/rules.js')).makeRng(7), cnt = {};
    for (let i = 0; i < 20000; i++) { const g = WS.rollBox(C, R.next); cnt[g.tier] = (cnt[g.tier] || 0) + 1; assert.ok(WS.boxOk(C, [g.item, g.n])); }
    for (const x of T) assert.ok(Math.abs(cnt[x.id] / 20000 - x.p) < 0.012, '本当の確率どおり：' + x.id);
    const got = { item: 'golden_fish', n: 1, tier: 'legend' }, strip = WS.boxStrip(C, R.next, got, 44, 37);
    assert.strictEqual(strip.length, 44); assert.deepStrictEqual(strip[37], ['golden_fish', 1, 'legend'], '止まる所が当たり');
    assert.ok(strip.filter((x) => x[2] === 'legend').length <= 6, '激レアはまれに混ざるだけ');
    assert.ok(!WS.boxOk(C, ['diamond', 99]) && !WS.boxOk(C, null));
    assert.strictEqual(WS.rollLegend(C, 'fish', () => 0.99), null);
    assert.ok(G.fish.some(([k]) => k === WS.rollLegend(C, 'fish', seq([0.001, 0.5]))));
    // 熟練度：次の段まで
    const nb = WS.badgeNext(C, { fished: 12, gathered: { wood: 0 } }), fi = nb.find((b) => b.id === 'fisher');
    assert.deepStrictEqual([fi.tier, fi.next, fi.left], [0, 50, 38]);
    assert.ok(C.badges.list.fisher && fs.existsSync(path.join(ROOT, 'icons', 'badge_fisher_3.png')), '釣り人のバッジ');
  });

  t('工房：受け口（worker.mjs）の決まりは js/workshop.js と同じ文字', () => {
    const SW = require(path.join(ROOT, 'tools', 'sync_workshop.js'));
    const a = SW.block(fs.readFileSync(path.join(ROOT, 'js', 'workshop.js'), 'utf8')), b = SW.block(fs.readFileSync(path.join(ROOT, 'tools', 'webhook', 'worker.mjs'), 'utf8'));
    assert.ok(a && a.length > 2000);
    assert.strictEqual(b, a, 'node tools/sync_workshop.js で写す');
  });

  at('工房：受け口の /shop/state・/shop/do・/box/open（抽選と止まる所は受け口）・釣りの激レア・宝を掘ると宝箱・pull', async () => {
    const W = await imp('tools/webhook/worker.mjs');
    W._resetSiteConfig(); W._resetSiteFiles();
    const store = new Map();
    const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
    const life = { bob: { level: 1, badges: {}, slots: 9, inv: [{ item: 'log', n: 2 }, { item: 'fish_aji', n: 6 }, { item: 'treasure_box', n: 1 }, null, null, null, null, null, null] } };
    let wsJson = { applied: {}, seen: [] };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/data/config.json')) return new Response(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'), { status: 200 });
      if (u.endsWith('/data/life.json')) return new Response(JSON.stringify(life), { status: 200 });
      if (u.endsWith('/data/workshop.json')) return new Response(JSON.stringify(wsJson), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    let rv = [0.5];
    const env = { TOWN_KV: kv, DM_QUEUE_TOKEN: 'q'.repeat(24), SITE_ORIGIN: 'https://isle.example', _rnd: () => rv.shift() ?? 0.5 };
    const call = async (p, tok, body) => { const res = await W.default.fetch(new Request('https://w.example' + p, { method: body === undefined ? 'GET' : 'POST', headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: () => {} }); return { status: res.status, j: await res.json().catch(() => null) }; };
    try {
      const tk = await W.issueMe(env, 'bob');
      let r = await call('/shop/state', tk);
      assert.strictEqual(r.status, 200); assert.strictEqual(r.j.slots, 9); assert.strictEqual(r.j.left, 20);
      assert.strictEqual((await call('/shop/state')).status, 401, '印なしは 401');
      // チェストへ送る：持っている分だけ
      r = await call('/shop/do', tk, { t: 'send', items: [['fish_aji', 9]] }); assert.strictEqual(r.status, 400); assert.match(r.j.why, /足りない/);
      r = await call('/shop/do', tk, { t: 'send', items: [['fish_aji', 2]] }); assert.strictEqual(r.status, 200);
      assert.strictEqual(r.j.inv.find((s) => s && s.item === 'fish_aji').n, 4, 'まだ届いていない頼みも引いて見せる');
      r = await call('/shop/do', tk, { t: 'send', items: [['fish_aji', 5]] }); assert.strictEqual(r.status, 400, '前の頼みの分も数える');
      r = await call('/shop/do', tk, { t: 'craft', recipe: 'wood_fishing_rod' }); assert.strictEqual(r.status, 200, r.j && r.j.why);
      assert.strictEqual((await call('/shop/do', tk, { t: 'craft', recipe: 'stone_axe' })).status, 400, 'バッジがないと石の斧は作れない');
      assert.strictEqual((await call('/shop/do', tk, { t: 'hack' })).status, 400);
      // 釣り：激レアは受け口が決める（_rnd が 0 なら当たり）
      const fk = cfg().fishing.seaFish[0][0], sz = cfg().fishing.sizes[fk];
      rv = [0, 0];
      r = await call('/play/fish', tk, { item: fk, cm: sz.min, legend: 'old_crown' });
      assert.ok(cfg().workshop.legend.fish.some(([k]) => k === r.j.legend), '画面が送った物ではなく、受け口が決めた物');
      // 宝を掘ると、その場で宝箱が開いて中身が入る（宝箱のままでは入れない。2 回目はなし）
      rv = [0.99, 0.9, 0.1];
      r = await call('/play/treasure', tk, {}); assert.strictEqual(r.j.box, 0); assert.strictEqual(r.j.legend, null);
      assert.strictEqual(r.j.tier, 'rare'); assert.ok(W.boxOk(cfg(), r.j.got), '中身は宝箱の段から');
      r = await call('/play/treasure', tk, {}); assert.strictEqual(r.j.got, null);
      // 宝箱を開ける：帯の stop が中身と同じ
      rv = [0.9, 0.1];
      r = await call('/box/open', tk, {});
      assert.strictEqual(r.status, 200, r.j && r.j.why);
      assert.strictEqual(r.j.op.tier, 'rare'); assert.deepStrictEqual(r.j.strip[r.j.stop].slice(0, 2), r.j.op.got);
      assert.ok(r.j.offset > 0.1 && r.j.offset < 0.9);
      assert.strictEqual((await call('/box/open', tk, {})).status, 400, '宝箱はもうない');
      // pull に頼みと宝箱・激レアが入る
      const pl = await call('/play/pull?days=1', null);
      assert.strictEqual(pl.status, 403);
      const res = await W.default.fetch(new Request('https://w.example/play/pull?days=1', { headers: { Authorization: 'Bearer ' + 'q'.repeat(24) } }), env, {});
      const pj = await res.json(), d = Object.keys(pj.shop)[0];
      assert.deepStrictEqual(pj.shop[d].bob.map((o) => o.t), ['send', 'craft', 'gain', 'gain', 'open'], 'もらった物も同じ列に時刻の順で');
      assert.strictEqual(pj.shop[d].bob[3].src, 'treasure'); assert.ok(!pj.shop[d].bob[3].items.some(([k]) => k === 'treasure_box'), '宝探しは中身だけ');
      assert.strictEqual(pj.shop[d].bob[2].src, 'fish'); assert.strictEqual(pj.shop[d].bob[2].items.length, 2, '魚と激レア');
      assert.strictEqual(pj.days[d].bob.box || 0, 0,'宝探しは宝箱を数えない（その場で開ける）'); assert.strictEqual(pj.days[d].bob.legend.length, 1);
      const PL = require(path.join(ROOT, 'tools', 'play.js'));
      const c = PL.clean(pj);
      assert.deepStrictEqual(c.shop[d].bob.map((o) => o.t), ['send', 'craft', 'gain', 'gain', 'open']);
      assert.strictEqual((await call('/shop/state', tk)).j.left, 17, 'もらった物は 1 日の回数に数えない'); assert.strictEqual(c.days[d].bob.box, 0);
      // 毎日の更新が入れたら（workshop.json の seen・applied）、受け口は二重に数えない
      wsJson = { seen: pj.shop[d].bob.map((o) => o.id) };
      W._resetSiteFiles();
      r = await call('/shop/state', tk);
      assert.strictEqual(r.j.ops.length, 0);
    } finally { globalThis.fetch = realFetch; W._resetSiteFiles(); W._resetSiteConfig(); }
  });

  at('工房：毎日の更新（tools/workshop.js）が手に入れた物と頼みを当てる・二重に当てない・年表に出す', async () => {
    const WSK = require(path.join(ROOT, 'tools', 'workshop.js'));
    const C = cfg();
    const S = {
      config: C, villagers: [{ key: 'bob', display: 'ボブ', joinedDay: 1 }],
      state: { store: {} }, life: { bob: { level: 1, badges: {}, slots: 6, inv: [{ item: 'fish_aji', n: 30 }, null, null, null, null, null], diary: [{ day: 5, text: '' }] } },
    };
    const d = '2026-11-27';
    const play = {
      shop: { [d]: { bob: [
        { id: 'gggg1', t: 'gain', src: 'fish', items: [['fish_saba', 1], ['golden_fish', 1]], at: d + 'T00:10:00Z' },
        { id: 'gggg2', t: 'gain', src: 'fish', items: [['old_boot', 1]], at: d + 'T00:20:00Z' },
        { id: 'gggg3', t: 'gain', src: 'treasure', items: [['treasure_box', 1]], at: d + 'T00:30:00Z' },
        { id: 'aaaa1', t: 'send', items: [['fish_aji', 3]], at: d + 'T01:00:00Z' },
        { id: 'aaaa2', t: 'open', got: ['diamond', 1], tier: 'rare', at: d + 'T02:00:00Z' },
        { id: 'aaaa3', t: 'send', items: [['fish_aji', 999]], at: d + 'T03:00:00Z' },
      ] } },
    };
    const H = [], hist = (type, text, x) => H.push({ type, text, ...x });
    const now = Date.parse(d + 'T03:00:00Z');
    const st = WSK.stepWorkshop(S, { day: 5, date: d, play, hist, now });
    const L = S.life.bob;
    assert.strictEqual(L.fished, 1, '釣った魚は釣り人のバッジに数える');
    assert.strictEqual(S.state.store.fish_aji, 3, 'チェストに入った');
    assert.ok(S.workshop.results.aaaa1.ok && S.workshop.results.aaaa2.ok && !S.workshop.results.aaaa3.ok, 'できない頼みは当てない');
    assert.strictEqual(L.inv.filter((s) => s && s.item === 'fish_aji').reduce((a, s) => a + s.n, 0) + (S.state.store.fish_aji || 0), 30, '魚の数は変わらない（枠を分けた分も）');
    assert.ok(L.inv.every((s) => !s || s.n <= 16 || s.item === 'golden_fish'), '1 枠 16 まで');
    assert.ok(H.some((h) => /ボブさんが激レアの黄金の魚を見つけた！/.test(h.text)), '激レアは年表に');
    assert.ok(H.some((h) => h.type === 'chest' && /ボブさんがアジ 3 個を島のチェストに入れた/.test(h.text)), 'チェストに入れたのも年表に');
    assert.ok(st.legend >= 1);
    const before = JSON.stringify([L.inv, S.state.store]);
    WSK.stepWorkshop(S, { day: 6, date: '2026-11-28', play, hist, now });
    assert.strictEqual(JSON.stringify([L.inv, S.state.store]), before, '同じ記録をもう一度読んでも二重に当てない');
    assert.ok(S.workshop.seen.includes('gggg1') && S.workshop.results.gggg3.ok);
    assert.ok(!L.inv.some((s) => s && s.item === 'treasure_box'), '宝箱は開けた分だけ減る');
  });

  t('工房：画面（play.html・js/play/bag.js）', () => {
    const html = fs.readFileSync(path.join(ROOT, 'play.html'), 'utf8'), bag = fs.readFileSync(path.join(ROOT, 'js', 'play', 'bag.js'), 'utf8'), main = fs.readFileSync(path.join(ROOT, 'js', 'play', 'main.js'), 'utf8');
    assert.ok(/data-tab="bag"/.test(html) && /id="bag"/.test(html), '持ち物のタブ');
    assert.ok(/confirmBox\('島のチェストへ送る'/.test(bag), '送る前に確かめる画面');
    assert.ok(/store\.openBox\(\)/.test(bag) && /j\.stop/.test(bag) && /j\.offset/.test(bag), '止まる所は受け口の答え');
    assert.ok(!/rollBox|Math\.random/.test(bag) && !/rollBox|rollLegend/.test(main), '画面で中身を決めない');
    assert.ok(/store\.last\.got/.test(main) && /chestUiTick/.test(main) && /タップで開ける/.test(main) && !/「宝箱」で開けられます/.test(main), '宝探しは掘った場で開けて中身を見せる（帯は回さない）');
    assert.ok(/出る物と確率を見る/.test(bag) && /あと <b>/.test(bag), '確率と、次の段まであと何回');
    assert.ok(!/(課金|購入|円で|￥|\$\d+円|ドルで)/.test(bag + main), '本物のお金で買う仕組みはない');
    assert.ok(!/いちばん乗り|いちばんに|最初に見つけ/.test(main), '宝探しは競争の言い方をしない');
    assert.ok(!/マイクラ|マインクラフト|CS:?GO|カウンターストライク/i.test(bag + main + fs.readFileSync(path.join(ROOT, 'js', 'workshop.js'), 'utf8')), '作品の名前を入れない');
  });
};
