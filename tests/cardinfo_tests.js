'use strict';
// 村人カードのプロフィール：性別・ひとこと・趣味・好きな色（本人が書く）と、仲のよい人・住んで何日目・誕生日まで・星座・気分・宝物（記録から）
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

module.exports = ({ t, at, ROOT }) => {
  const P = require(path.join(ROOT, 'tools', 'people.js'));
  const X = require(path.join(ROOT, 'tools', 'profile_extra.js'));
  const PF = require(path.join(ROOT, 'js', 'profile-fields.js'));
  const cfg = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

  t('名札つきの性別・ひとこと・趣味・好きな色を読む（禁止語は通さない・ほかの読み取りとまざらない）', () => {
    const s = X.splitExtras('住みたい 性別 ひみつ 趣味 釣り 色 みずいろ ひとこと よろしくね！');
    assert.deepStrictEqual([s.rest, s.gender, s.hobby, s.color, s.message], ['住みたい', 's', '釣り', '#3fb4de', 'よろしくね!']);
    for (const [w, g] of [['男', 'm'], ['男性', 'm'], ['男の子', 'm'], ['女', 'f'], ['女性', 'f'], ['おんなのこ', 'f'], ['秘密', 's'], ['ないしょ', 's']]) assert.strictEqual(X.splitExtras('性別 ' + w).gender, g, w);
    assert.ok(!X.splitExtras('ひとこと しね').message, '禁止語（プロフィール）');
    assert.ok(!X.splitExtras('ひとこと うぜえ').message, '禁止語（手紙のきまり）');
    assert.ok(!X.splitExtras('ひとこと https://x.com を見て').message, 'URL');
    assert.ok(!X.splitExtras('趣味 ばか').hobby);
    assert.strictEqual(Array.from(X.splitExtras('ひとこと ' + 'あ'.repeat(40)).message).length, 20, '20 字まで');
    // 色は決まった名前だけ。揺れも受け付ける。「青空」や名札なしの「水色」は読まない
    for (const [w, n] of [['ブルー', '青'], ['あお', '青'], ['ライトブルー', '水色'], ['桃色', 'ピンク'], ['ネイビー', '紺'], ['ホワイト', '白'], ['きみどり', '黄緑']]) assert.strictEqual(PF.colorOf(w).name, n, w);
    assert.strictEqual(X.splitExtras('好きな色は青です').color, PF.colorOf('青').hex);
    assert.ok(!X.splitExtras('色 青空').color && !X.splitExtras('住みたい 水色').color);
    // ひとことの中の日付・色は、ほかの値にしない
    const m = X.splitExtras('住みたい ピッケル 12/11 カレー ひとこと 12/25が誕生日 色は水色');
    assert.deepStrictEqual([m.rest, m.message, m.color], ['住みたい ピッケル 12/11 カレー', '12/25が誕生日 色は水色', undefined]);
  });

  t('コメントで性別・ひとこと・趣味・好きな色を入れ、あとから変える（道具・食べ物は今までどおり）', () => {
    const cm = (text, ts) => ({ from: { id: '81', username: 'card_u' }, text, timestamp: ts });
    const o = { word: '住みたい', startTools: cfg.startTools };
    const vs = [];
    const c1 = [cm('住みたい ピッケル 女の子 12/11 カレー 趣味 釣り 色 ピンク ひとこと よろしくね', '2026-11-01T00:00:00Z')];
    for (const r of P.registrationsFrom(c1, '住みたい', cfg.startTools)) P.upsertVillager(vs, { ...r, joined: 'x', joinedDay: 1, source: 'comment' }, new Set());
    P.applyCommentProfiles(vs, c1, o);
    const v = vs[0];
    assert.deepStrictEqual([v.startTool, v.gender, v.birthday, v.profile.food, v.profile.hobby, v.profile.color, v.profile.message], ['pickaxe', 'f', '12-11', 'カレー', '釣り', PF.colorOf('ピンク').hex, 'よろしくね']);
    // 住んだあと：「性別 男」「ひとこと …」「趣味 …」「色 …」で変わる。禁止語のひとことは変えない。趣味の「釣り」で道具は変わらない
    const c2 = [...c1, cm('性別 男', '2026-11-02T00:00:00Z'), cm('ひとこと 釣りが好きです', '2026-11-02T01:00:00Z'), cm('色 ブルー', '2026-11-02T02:00:00Z'), cm('ひとこと くたばれ', '2026-11-02T03:00:00Z')];
    assert.ok(P.applyCommentProfiles(vs, c2, o));
    assert.deepStrictEqual([v.gender, v.profile.message, v.profile.color, v.startTool], ['m', '釣りが好きです', PF.colorOf('青').hex, 'pickaxe']);
    P.applyCommentProfiles(vs, [...c2, cm('性別 ひみつ', '2026-11-03T00:00:00Z')], o);
    assert.strictEqual(v.gender, 's');
    assert.strictEqual(P.fitGenderSkin(v), false, 'ひみつの人はスキンを変えない');
    assert.strictEqual(vs.length, 1);
  });

  t('住んでいる人の DM「性別 女の子」「ひとこと よろしく」でも変わる（入居の言葉がなくてよい）', () => {
    const D = require(path.join(ROOT, 'tools', 'dm.js'));
    const config = { ...cfg, dm: { ...(cfg.dm || {}), enabled: true, readOptions: true } };
    const S = { villagers: [] };
    P.upsertVillager(S.villagers, { igId: '91', username: 'dm_card', joined: 'x', joinedDay: 1, source: 'comment' }, new Set());
    const r = D.dmJoins(S, [{ id: 'm1', igsid: '91', username: 'dm_card', text: '性別 女の子', at: '2026-11-05T00:00:00Z' }, { id: 'm2', igsid: '91', username: 'dm_card', text: 'ひとこと よろしく', at: '2026-11-05T00:01:00Z' }], { config, hidden: new Set(), date: 'x', day: 3 });
    assert.deepStrictEqual([S.villagers[0].gender, S.villagers[0].profile.message, r.registered.length, r.replies[0].kind, r.replies[0].text], ['f', 'よろしく', 0, 'profile', null]);
    // 住んでいない人の同じ DM は、だれも住ませず消すだけ
    const r2 = D.dmJoins(S, [{ id: 'm3', igsid: '92', username: 'nobody', text: '性別 男', at: '2026-11-05T00:00:00Z' }], { config, hidden: new Set(), date: 'x', day: 3 });
    assert.deepStrictEqual([r2.registered.length, r2.replies[0].kind, S.villagers.length], [0, 'ignore', 1]);
  });

  at('受け口はプロフィールの名札で始まる DM も積む・説明文に書き方がある', async () => {
    const W = await imp('tools/webhook/worker.mjs');
    assert.ok(W.dmProfileHit('性別 女の子') && W.dmProfileHit('ひとこと よろしく') && W.dmProfileHit('色 水色') && W.dmProfileHit('MBTI ENFP'));
    assert.ok(!W.dmProfileHit('こんにちは') && !W.dmProfileHit('今日の色がきれい'));
    assert.ok(W.dmProfileHit('女の子') && W.dmProfileHit('男の子です') && W.dmProfileHit('性別女の子') && W.dmProfileHit('誕生日1018') && W.dmProfileHit('INFP'));
    assert.ok(!W.dmProfileHit('女の子と遊んだ') && !W.dmProfileHit('INFPです？教えて'));
    const C = await imp('js/common.js');
    const j = C.joinText(cfg);
    assert.ok(/性別/.test(j) && /ひとこと/.test(j) && /趣味/.test(j) && /色 水色/.test(j));
    assert.ok(/性別/.test(cfg.dm.howTo) && /ひとこと/.test(cfg.dm.howTo));
  });

  at('カードの値：星座・誕生日まで・住んで何日目・気分・宝物（激レアが先）・仲のよい人・好きな色', async () => {
    const K = await imp('js/cardinfo.js');
    assert.deepStrictEqual(K.FAV_COLORS, PF.FAV_COLORS.map((c) => [c.name, c.hex]), 'サイトとツールで同じ色');
    assert.deepStrictEqual(['01-19', '01-20', '03-21', '07-23', '11-22', '11-23', '12-21', '12-22'].map(K.zodiac), ['やぎ座', 'みずがめ座', 'おひつじ座', 'しし座', 'さそり座', 'いて座', 'いて座', 'やぎ座']);
    const now = new Date('2026-11-27T03:00:00Z'); // 日本時間 11/27
    assert.deepStrictEqual([K.daysToBirthday('11-27', now), K.daysToBirthday('11-28', now), K.daysToBirthday('11-26', now), K.daysToBirthday(null, now)], [0, 1, 364, null]);
    assert.strictEqual(K.birthdayRest('12-11', now), '誕生日まであと 14 日');
    assert.deepStrictEqual([K.livedDays({ joinedDay: 3 }, { day: 5 }), K.livedDays({ joinedDay: 0 }, { day: 1 }), K.livedDays({}, { day: 0 })], [3, 1, 0]);
    const max = { needs: { max: 20 } };
    assert.deepStrictEqual([K.moodText({ hp: 20, hunger: 20 }, max), K.moodText({ hp: 20, hunger: 3 }, max), K.moodText({ hp: 4, hunger: 20 }, max), K.moodText({ hp: 15, hunger: 15 }, max)], ['ごきげん', 'おなかペコペコ', 'へとへと', 'まあまあ']);
    // 宝物：激レア（rarity: legend）がまだなくても動く。あれば最優先で ★
    const items = { log: { name: '原木', value: { wood: 1 } }, wood_pickaxe: { name: '木のつるはし', tool: 'pickaxe', value: { wood: 3 } }, gem: { name: '虹の石', rarity: 'legend', value: {} } };
    const L = { inv: [{ item: 'log', n: 3 }, { item: 'wood_pickaxe' }, null] };
    assert.deepStrictEqual(K.treasureOf(L, { items }), { id: 'wood_pickaxe', name: '木のつるはし', legend: false });
    assert.deepStrictEqual(K.treasureOf({ inv: [...L.inv, { item: 'gem' }] }, { items }), { id: 'gem', name: '虹の石', legend: true });
    assert.strictEqual(K.treasureOf({ inv: [] }, { items }), null);
    assert.ok(K.treasureOf(require(path.join(ROOT, 'data', 'life.json'))[Object.keys(require(path.join(ROOT, 'data', 'life.json')))[0]] || {}, cfg) !== undefined);
    // 仲のよい人：pairScore と同じ点（s＋家族 50＋好きな人 60）の高い順。今いない人・点 0 の人は出さない
    const vs = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, display: k.toUpperCase() }));
    const social = { pairs: { 'a|b': { s: 30 }, 'a|c': { s: 5, crush: 1 }, 'a|d': { s: 0 }, 'a|z': { s: 99 }, 'b|c': { s: 80 } } };
    assert.deepStrictEqual(K.bestFriends(vs[0], social, vs).map((f) => [f.v.key, f.s]), [['c', 65], ['b', 30]]);
    // 性別・好きな色は、本人が書いた人だけ
    assert.deepStrictEqual([K.genderText({}), K.genderText({ gender: 'f' }), K.genderText({ gender: 's' }), K.favColor({}), K.favColor({ profile: { color: '#3FB4DE' } }), K.colorName('#3fb4de')], ['', '女の子', 'ひみつ', null, '#3fb4de', '水色']);
    assert.ok(K.favEdge('#f2f2ee') !== '#f2f2ee' && K.favEdge('#2f6fd6') === '#2f6fd6', '白は少し濃くしてふちにする');
  });
};
