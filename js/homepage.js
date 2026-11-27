// 家を飾る（home.html）：持っている飾りを、家の外（扉の前の庭）と中のマスに置く。向きは 90 度ずつ回せる。
//   保存は受け口（Worker の /me/decor）。町の家の見た目に出るのは次の毎日の更新から（tools/decor.js が持っている数とマスを確かめる）。
//   ?demo-me=1 は見本（何も保存しない）
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadAll, nav, esc, showError } from './common.js';
import { icon } from './icons.js';
import { whoami, api, withDemo } from './mine.js';
import { DECOR, EARN, gridOf, blockedCell, sizeOf, cleanLayout, takenBy, leftOf, residentsOf, houseLayout, MAILBOX_CELL, PATH_COL, decorOn, decorSoonText, SOON_BADGE, soonBadge } from './decor.js';
import { makeHomeView, decorIcon } from './decor3d.js';
import { loadDecor, loadMail, demoDecor, homeOf } from './homedata.js';

nav('me.html');
const main = document.getElementById('main');

async function run() {
  const [W, D] = await Promise.all([whoami(), loadAll()]);
  if (!W.villager) {
    main.innerHTML = `<h1>家を飾る ${soonBadge(D.config)}</h1><section class="card mecard"><p>家を飾るには、自分の村人とつながってください。</p><div class="me-btns"><a class="btn" href="me.html">${icon('circle-user', { size: 18 })}<span>自分の村人</span></a><a class="btn sub" href="home.html?demo-me=1">見本を見る</a></div></section>`;
    return;
  }
  const v = W.villager, demo = W.mode === 'demo', config = D.config;
  const H = homeOf(v, D), look = H.look;
  if (!decorOn(config)) { soonPage(W, D, H, demo); return; }
  const all = await loadDecor();
  let mine = all[v.key] || (demo ? demoDecor(look) : { own: {}, out: [], in: [], got: [] });
  // 受け口に保存してあって、まだ毎日の更新に入っていない並べ方
  if (!demo) { try { const s = await api(config, '/mail/state'); if (s.decor && (!mine.at || s.decor.at > mine.at)) mine = { ...mine, out: cleanLayout('out', s.decor.out, look, mine.own), in: cleanLayout('in', s.decor.in, look, mine.own) }; } catch (e) { /* つながらない時は町のデータのまま */ } }
  let lay = { out: (mine.out || []).map((e) => e.slice(0, 4)), in: (mine.in || []).map((e) => e.slice(0, 4)) };
  // 同じ家に住むほかの人の飾り（そのマスは使えない）。町と同じく、来た日の順に重ねて決める
  const others = { out: [], in: [] };
  if (H.real) {
    const res = residentsOf(H.b, D.active, D.life);
    const hl = houseLayout(H.b, look, res, { ...all, [v.key]: { ...mine, out: lay.out, in: lay.in } });
    for (const p of ['out', 'in']) { others[p] = hl[p].filter((e) => e[4] !== v.key); lay[p] = hl[p].filter((e) => e[4] === v.key).map((e) => e.slice(0, 4)); }
  }
  const mail = await loadMail();
  const flag = (mail.letters || []).some((L) => L.to === v.key && L.day === D.state.day);
  let tab = new URLSearchParams(location.search).get('tab') === 'in' ? 'in' : 'out', pick = null, sel = null;

  main.innerHTML = '<h1>家を飾る</h1>' + (demo ? '<p><span class="demo">見本の画面（保存しません）</span></p>' : '') +
    (H.real ? '' : '<p class="muted hnote">まだ家がありません（テントにいます）。家ができると、ここで並べた飾りが町の家に出ます。今は見本の家で並べられます。</p>') +
    '<div class="htabs" role="tablist"><button type="button" role="tab" data-t="out">家の外</button><button type="button" role="tab" data-t="in">家の中</button></div>' +
    '<div class="hgrid2"><div class="card hviewcard"><div class="hview" id="hview"></div><p class="muted hhint">ドラッグで回して見られます</p></div>' +
    '<div class="card hplancard"><div class="hplanhead"><b id="hpt"></b><span class="muted" id="hpn"></span></div><div class="hplanwrap"><div class="hhouse" id="hhouse"></div><div class="hplan" id="hplan"></div><div class="hdoor" id="hdoor"></div></div>' +
    `<div class="hsel" id="hsel" hidden><span id="hseln"></span><button type="button" class="btn sub" id="hrot">${icon('rotate-cw', { size: 16 })}<span>回す</span></button><button type="button" class="btn sub" id="hdel">${icon('trash-2', { size: 16 })}<span>しまう</span></button></div>` +
    '<h3 class="hh3">持っている飾り</h3><div class="hpal" id="hpal"></div>' +
    `<div class="me-save"><button type="button" class="savebtn" id="hsave">保存</button><span class="muted" id="hmsg" role="status"></span></div></div></div>` +
    '<div id="visitcards"></div>' + // 遊びに行く・来た人ノート（js/visitcards.js）
    `<section class="card mecard"><h2 class="me-h">${icon('gift', { size: 20 })}<span>飾りの手に入れ方</span></h2><ul class="hhow">${Object.entries({ fish: '遊ぶページで釣りをすると、ときどき', chore: 'おてつだいを 3 回すると、ときどき', treasure: '宝箱を見つけた日', event: '島の行事に出た日', thanks: '手紙を送ると、お礼の手紙に添えて' }).map(([k, t]) => `<li><b>${esc(EARN[k])}</b><span>${esc(t)}：${Object.keys(DECOR).filter((id) => DECOR[id].from === k).map((id) => esc(DECOR[id].name)).join('・')}</span></li>`).join('')}</ul>` +
    ((mine.got || []).length ? `<p class="muted">最近手に入れた飾り：${mine.got.slice().reverse().map(([d, id, why]) => `${esc(DECOR[id] ? DECOR[id].name : id)}（${d}日目・${esc(EARN[why] || '')}）`).join('、')}</p>` : '') + '</section>' +
    `<div class="me-btns"><a class="btn sub" href="${withDemo('me.html')}">${icon('circle-user', { size: 18 })}<span>自分の村人へ</span></a><a class="btn sub" href="${withDemo('mail.html')}">${icon('mail', { size: 18 })}<span>手紙</span></a></div>`;

  const view = makeHomeView(main.querySelector('#hview'), { look, b: H.b, controls: OrbitControls });
  import('./visitcards.js').then((m) => m.renderVisitCards(main.querySelector('#visitcards'), { W, D, H })).catch((e) => console.error(e));
  const plan = main.querySelector('#hplan'), pal = main.querySelector('#hpal'), selBox = main.querySelector('#hsel'), msg = main.querySelector('#hmsg');
  const say = (t) => { msg.textContent = t; };
  const taken = () => takenBy(others[tab]);
  function draw() {
    for (const b of main.querySelectorAll('.htabs button')) { b.classList.toggle('on', b.dataset.t === tab); b.setAttribute('aria-selected', b.dataset.t === tab); }
    const g = gridOf(tab, look);
    main.querySelector('#hpt').textContent = tab === 'out' ? '扉の前の庭（上が家）' : '家の中（上が奥の壁・下が扉）';
    main.querySelector('#hpn').textContent = pick ? `「${DECOR[pick].name}」を置くマスを選んでね` : 'マスを押すと、置いた物を選べます';
    main.querySelector('#hhouse').hidden = tab !== 'out';
    main.querySelector('#hdoor').hidden = tab !== 'in';
    plan.style.setProperty('--cols', g.cols); plan.style.setProperty('--rows', g.rows);
    let h = '';
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
      const bl = blockedCell(tab, look, i, j);
      h += `<button type="button" class="hcell${bl ? ' bl-' + bl : ''}" data-i="${i}" data-j="${j}" aria-label="${i + 1} 列 ${j + 1} 段${bl === 'path' ? '（小道）' : bl === 'mailbox' ? '（郵便受け）' : bl === 'door' ? '（扉の前）' : ''}">${bl === 'path' ? '<i>道</i>' : bl === 'door' ? '<i>扉</i>' : ''}</button>`;
    }
    const ov = (e, cls) => { const [id, i, j, r] = e, [sw, sd] = sizeOf(id, r), wall = DECOR[id].layer === 'wall'; return `<span class="hitem ${cls} ly-${DECOR[id].layer}" style="left:${(i / g.cols) * 100}%;top:${(j / g.rows) * 100}%;width:${(sw / g.cols) * 100}%;height:${((wall ? 0.42 : sd) / g.rows) * 100}%"><img src="${decorIcon(id)}" alt="${esc(DECOR[id].name)}">${wall ? '' : `<b class="hdir" style="transform:rotate(${r * 90}deg)" aria-hidden="true">▼</b>`}</span>`; };
    h += others[tab].map((e) => ov(e, 'other')).join('');
    h += lay[tab].map((e, k) => ov(e, sel === k ? 'mine on' : 'mine')).join('');
    if (tab === 'out') h += `<span class="hitem mbox" style="left:${(MAILBOX_CELL[0] / g.cols) * 100}%;top:${(MAILBOX_CELL[1] / g.rows) * 100}%;width:${100 / g.cols}%;height:${100 / g.rows}%">${icon('mail', { size: 18 })}</span>`;
    plan.innerHTML = h;
    // パレット（このページの側に置ける物だけ）
    const ids = Object.keys(DECOR).filter((id) => DECOR[id].place === tab && (mine.own || {})[id]);
    pal.innerHTML = ids.length ? ids.map((id) => { const n = leftOf(mine.own, lay.out, lay.in, id); return `<button type="button" class="hpi${pick === id ? ' on' : ''}" data-id="${id}"${n ? '' : ' disabled'} title="${esc(DECOR[id].name)}"><img src="${decorIcon(id)}" alt=""><span>${esc(DECOR[id].name)}</span><small>あと ${n}</small></button>`; }).join('')
      : `<p class="muted">${tab === 'out' ? '家の外' : '家の中'}の飾りはまだ持っていません。下の「手に入れ方」を見てね。</p>`;
    selBox.hidden = sel == null;
    if (sel != null) { const e = lay[tab][sel]; main.querySelector('#hseln').textContent = `「${DECOR[e[0]].name}」`; main.querySelector('#hrot').disabled = DECOR[e[0]].layer === 'wall'; }
    view.show(tab, { out: [...others.out, ...lay.out], in: [...others.in, ...lay.in] }, flag);
  }
  const fits = (list) => cleanLayout(tab, list, look, mine.own, taken()).length === list.length;
  main.querySelector('.htabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; pick = null; sel = null; say(''); draw(); };
  pal.onclick = (e) => { const b = e.target.closest('.hpi'); if (!b || b.disabled) return; pick = pick === b.dataset.id ? null : b.dataset.id; sel = null; say(''); draw(); };
  plan.onclick = (e) => {
    const c = e.target.closest('.hcell'); if (!c) return;
    const i = +c.dataset.i, j = +c.dataset.j;
    if (pick) {
      const next = [...lay[tab], [pick, i, j, 0]];
      if (!fits(next)) { const nb = [...lay[tab], [pick, i, j, 1]]; if (sizeOf(pick, 0)[0] !== sizeOf(pick, 0)[1] && fits(nb)) { lay[tab] = nb; } else { say(DECOR[pick].layer === 'wall' ? '絵は奥の壁ぎわ（いちばん上の段）にかけられます' : 'そこには置けません（はみ出す・ほかの物と重なる・小道や扉の前）'); return; } }
      else lay[tab] = next;
      sel = lay[tab].length - 1;
      if (!leftOf(mine.own, lay.out, lay.in, pick)) pick = null;
      say(''); draw(); return;
    }
    // 置いた物を選ぶ（同じマスに重なっていれば、押すたびに 壁 → 家具 → じゅうたん）
    const hits = lay[tab].map((e, k) => ({ e, k })).filter(({ e }) => { const [id, a, b, r] = e, [sw, sd] = sizeOf(id, r); return i >= a && i < a + sw && j >= b && j < b + sd; });
    const order = { wall: 0, floor: 1, rug: 2 };
    hits.sort((x, y) => order[DECOR[x.e[0]].layer] - order[DECOR[y.e[0]].layer]);
    const cur = hits.findIndex((h) => h.k === sel);
    sel = hits.length ? hits[(cur + 1) % hits.length].k : null;
    draw();
  };
  main.querySelector('#hrot').onclick = () => {
    if (sel == null) return;
    const list = lay[tab].slice(), e = list[sel].slice(); e[3] = (e[3] + 1) % 4; list[sel] = e;
    // 長い物は、回したらはみ出す時に少しずらしてみる
    const tries = [[0, 0], [-1, 0], [0, -1], [-1, -1]];
    for (const [di, dj] of tries) { const l2 = list.slice(); l2[sel] = [e[0], Math.max(0, e[1] + di), Math.max(0, e[2] + dj), e[3]]; const rest = l2.filter((_, k) => k !== sel); if (fits([...rest, l2[sel]])) { lay[tab] = [...rest.slice(0, sel), l2[sel], ...rest.slice(sel)]; say(''); draw(); return; } }
    say('回すと入りません');
  };
  main.querySelector('#hdel').onclick = () => { if (sel == null) return; lay[tab].splice(sel, 1); sel = null; say('しまいました'); draw(); };
  main.querySelector('#hsave').onclick = async () => {
    say('保存しています…');
    try {
      if (demo) { say('見本なので保存していません（本番では、次の毎日の更新で町の家に出ます）。'); return; }
      await api(config, '/me/decor', { out: lay.out, in: lay.in });
      say('保存しました。次の毎日の更新（朝 6 時）で、町の家に出ます。');
    } catch (err) { say('保存できませんでした：' + err.message); }
  };
  draw();
}

// 家を飾るが「近日公開」の間（config.decor.enabled が false）：飾りの置き場・持ち物・保存は出さず、案内だけ。遊びに行く・来た人ノートはそのまま
function soonHtml(config, demo) {
  return `<h1>家を飾る ${SOON_BADGE}</h1>` + (demo ? '<p><span class="demo">見本の画面</span></p>' : '') +
    `<section class="card soon-card"><div class="soon-ic" aria-hidden="true">${icon('house', { size: 34 })}</div><div><h2 class="me-h">もうすぐ開きます</h2><p>${esc(decorSoonText(config))}</p></div></section>` +
    '<div id="visitcards"></div>' +
    `<div class="me-btns"><a class="btn sub" href="${withDemo('me.html')}">${icon('circle-user', { size: 18 })}<span>自分の村人へ</span></a><a class="btn sub" href="${withDemo('mail.html')}">${icon('mail', { size: 18 })}<span>手紙</span></a></div>`;
}
function soonPage(W, D, H, demo) {
  main.innerHTML = soonHtml(D.config, demo);
  import('./visitcards.js').then((m) => m.renderVisitCards(main.querySelector('#visitcards'), { W, D, H })).catch((e) => console.error(e));
}

run().catch(showError);
