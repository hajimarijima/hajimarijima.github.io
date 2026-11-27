// 遊ぶ（play.html）の「持ち物」：自分の持ち物・島のチェストへ送る・作る・交換所・宝箱（帯が流れて止まる演出）・熟練度（バッジ）。
// 決まりは js/workshop.js。できるかどうかの表示は画面でも出すが、本当に確かめて積むのは受け口（store.shopDo・openBox）。
// 宝箱の中身・帯の並び・止まる所は受け口が先に決めて返す。画面はそれに合わせて止めるだけ。
import { esc } from '../common.js';
import { icon } from '../icons.js';
import { wsCfg, wsTool, wsName, isLegend, invCounts, craftUse, recipeLock, badgeNext, applyOp, boxTiers, groupCount, WS_GROUPS, WS_TIER_ORDER, TIER_LOOK, pct } from '../workshop.js';

const KIND_ORDER = ['fishing_rod', 'axe', 'pickaxe', 'shovel', 'hoe', 'sword'];
const KIND_NAME = { fishing_rod: '釣りざお', axe: '斧', pickaxe: 'つるはし', shovel: 'シャベル', hoe: 'くわ', sword: '剣' };

export function makeBag({ root, store, config, L, guest, mode, onChange }) {
  const W = wsCfg(config), BG = config.badges || {}, TN = BG.tierNames || ['銅', '銀', '金', 'ダイヤ'];
  const nm = (k) => (WS_GROUPS[k] || wsName(config, k));
  const img = (k, s = 32) => `<img class="pixel" src="icons/${esc(k)}.png" alt="" width="${s}" height="${s}" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const rcls = (k) => (isLegend(config, k) ? ' r-legend' : k === 'treasure_box' ? ' r-rare' : ''); // 激レアは黄色く光らせる（村人カードの★と同じ rarity: legend）
  let S = null, sub = 'send', pick = {}, sel = null, busy = false, msg = '';

  async function refresh() {
    try { S = await store.shop(); } catch (e) { S = null; msg = e.message; }
    render();
  }
  const counts = () => invCounts(S ? S.inv : []);
  const tryOp = (op) => { if (!S) return { ok: false, why: '読みこみ中' }; const T = { ...L, inv: S.inv.map((s) => (s ? { ...s } : null)), slots: S.slots }; return applyOp(config, T, op, null); };

  function render() {
    if (!S) { root.innerHTML = `<h2>${icon('backpack', { size: 20 })}<span>持ち物</span></h2><p class="muted">${esc(msg || '読みこんでいます…')}</p>`; return; }
    const slots = Array.from({ length: S.slots }, (_, i) => S.inv[i] || null);
    const pend = (S.ops || []).filter((o) => o.ok);
    root.innerHTML = `<h2>${icon('backpack', { size: 20 })}<span>持ち物</span><small class="bg-left">${S.demo ? '<span class="demo">見本（保存しません）</span>' : `きょう あと ${S.left} 回たのめる`}</small></h2>` +
      `<div class="bg-slots">${slots.map((s) => s ? `<span class="bg-slot${rcls(s.item)}" title="${esc(nm(s.item))}">${img(s.item)}${wsTool(s.item) ? (s.max ? `<i class="bg-dur" style="width:${Math.round((s.dur / s.max) * 100)}%"></i>` : '') : `<b>${s.n}</b>`}</span>` : '<span class="bg-slot empty"></span>').join('')}</div>` +
      ((S.gains && S.gains.length) || pend.length ? `<p class="muted bg-note">${icon('clock', { size: 14 })}<span>まだ島に届いていない分も入れて見せています（次の毎日の更新・朝 6 時に本当に動きます）。</span></p>` : '') +
      (msg ? `<p class="bg-msg" role="status">${esc(msg)}</p>` : '') +
      `<div class="bg-tabs" role="tablist">${[['send', 'package', 'チェストへ'], ['craft', 'hammer', '作る'], ['trade', 'rotate-cw', '交換所'], ['box', 'gift', '宝箱'], ['skill', 'award', '熟練度']].map(([k, ic, t]) => `<button type="button" class="bg-tab${sub === k ? ' on' : ''}" data-sub="${k}" role="tab" aria-selected="${sub === k}">${icon(ic, { size: 16 })}<span>${t}</span></button>`).join('')}</div>` +
      `<div class="bg-body">${body()}</div>`;
    root.querySelectorAll('.bg-tab').forEach((b) => b.addEventListener('click', () => { sub = b.dataset.sub; msg = ''; render(); }));
    wire();
  }

  // ---------- チェストへ送る ----------
  function sendBody() {
    const c = counts(), list = Object.entries(c).filter(([k, n]) => n > 0).sort((a, b) => (isLegend(config, a[0]) - isLegend(config, b[0])) || (a[0] < b[0] ? -1 : 1));
    if (!list.length) return '<p class="muted">送れる物がありません（道具は送れません）。</p>';
    const total = Object.values(pick).reduce((a, b) => a + b, 0);
    return `<p class="muted">いらない物を選んで、島のチェストへ送れます。送った物は島のみんなの材料になります（もどせません）。</p>` +
      `<ul class="bg-list">${list.map(([k, n]) => { const p = Math.min(pick[k] || 0, n); return `<li class="bg-row${rcls(k)}"><span class="bg-ic">${img(k, 28)}</span><span class="bg-nm">${esc(nm(k))}<small>${n} 個</small></span><span class="bg-step"><button type="button" data-k="${esc(k)}" data-d="-1" aria-label="へらす"${p <= 0 ? ' disabled' : ''}>−</button><b>${p}</b><button type="button" data-k="${esc(k)}" data-d="1" aria-label="ふやす"${p >= n ? ' disabled' : ''}>＋</button><button type="button" class="bg-all" data-k="${esc(k)}" data-d="all">ぜんぶ</button></span></li>`; }).join('')}</ul>` +
      `<button type="button" class="btn bg-go" data-act="send"${total ? '' : ' disabled'}>${icon('package', { size: 18 })}<span>${total ? `${total} 個をチェストへ送る…` : '送る物を選んでね'}</span></button>`;
  }
  // ---------- 作る ----------
  function craftBody() {
    const CC = config.crafting || {}, R = CC.recipes || {}, c = counts();
    const keys = Object.keys(R).filter((k) => wsTool(k));
    if (!sel || !R[sel]) sel = keys.find((k) => !recipeLock(config, k, L)) || keys[0];
    const cell = (k) => { const lock = recipeLock(config, k, L), ok = !lock && tryOp({ t: 'craft', recipe: k }).ok; return `<button type="button" class="bg-rc${sel === k ? ' on' : ''}${lock ? ' lock' : ok ? ' can' : ''}" data-rc="${esc(k)}" title="${esc(nm(k))}">${img(k, 28)}${lock ? '<i class="bg-lk"></i>' : ''}</button>`; };
    const rows = KIND_ORDER.map((kind) => { const ks = keys.filter((k) => R[k].tool === kind).sort((a, b) => WS_TIER_ORDER.indexOf(R[a].tier) - WS_TIER_ORDER.indexOf(R[b].tier)); return ks.length ? `<div class="bg-rk"><span>${KIND_NAME[kind] || kind}</span><div>${ks.map(cell).join('')}</div></div>` : ''; }).join('');
    const r = R[sel], lock = recipeLock(config, sel, L), p = craftUse(c, r, CC), t = tryOp({ t: 'craft', recipe: sel });
    const mats = Object.entries(r.from).map(([k, n]) => `<span class="bg-mat${(c[k] || 0) >= n ? ' ok' : ''}">${img(k, 20)}${esc(nm(k))} ${n}<small>（${c[k] || 0}）</small></span>`).join('');
    return `<p class="muted">持ち物の材料で道具を作ります。板・棒が足りない時は原木から作ります（原木 1 → 板 4・板 2 → 棒 4）。良い道具は、熟練度（バッジ）が上がると作れるようになります。</p>` +
      `<div class="bg-rgrid">${rows}</div>` +
      `<div class="bg-rd${isLegend(config, sel) ? ' r-legend' : ''}"><span class="bg-ic big">${img(sel, 40)}</span><div><b>${esc(nm(sel))}</b><div class="bg-mats">${mats}</div>` +
      (lock ? `<p class="bg-why">${esc(lock.text)}</p>` : !p.ok ? `<p class="bg-why">材料が足りない：${esc(Object.entries(p.missing).map(([k, n]) => `${nm(k)} あと ${n}`).join('・'))}</p>` : !t.ok ? `<p class="bg-why">${esc(t.why)}</p>` : '') +
      `<button type="button" class="btn bg-go" data-act="craft"${lock || !t.ok ? ' disabled' : ''}>${icon('hammer', { size: 18 })}<span>作る…</span></button></div></div>`;
  }
  // ---------- 交換所 ----------
  function tradeBody() {
    const inv = S.inv, T = W.trades || [];
    return `<p class="muted">集めた物を、別の物と交換できます（お金は使いません）。「どれでも」は、持っている中から多い物を使います。</p><ul class="bg-list">` + T.map((x) => {
      const need = x.need ? ((L.badges && L.badges[x.need.badge]) ?? -1) < x.need.tier : false, t = tryOp({ t: 'trade', trade: x.id });
      const side = (o, give) => Object.entries(o).map(([k, n]) => { const have = give ? (k.startsWith('@') ? groupCount(config, inv, k) : counts()[k] || 0) : null; return `<span class="bg-tr${give && have < n ? ' lack' : ''}${rcls(k)}">${k === '@fish' ? img('fish_aji', 24) : k === '@legend' ? img('star_shard', 24) : img(k, 24)}<span>${esc(nm(k))} ×${n}${give ? `<small>（${have}）</small>` : ''}</span></span>`; }).join('');
      const B = x.need && BG.list && BG.list[x.need.badge];
      // 1 行：出す物 → もらう物 → 交換するボタン（バッジが要る時の一言は下の行）
      return `<li class="bg-trade"><div class="bg-trs">${side(x.give, true)}<span class="bg-arrow">→</span>${side(x.get, false)}</div>` +
        `<button type="button" class="btn sub bg-go" data-act="trade" data-id="${esc(x.id)}"${t.ok ? '' : ' disabled'}>交換<span class="bg-dots">…</span></button>` +
        (need && B ? `<small class="bg-why bg-trn">「${esc(B.name)}」の${TN[x.need.tier]}バッジから</small>` : '') + '</li>';
    }).join('') + '</ul>';
  }
  // ---------- 宝箱 ----------
  function boxBody() {
    const n = counts().treasure_box || 0;
    const odds = boxTiers(config).map((t) => { const L2 = TIER_LOOK[t.id] || { name: t.id, color: '#999' }, sum = t.items.reduce((a, x) => a + (x[2] ?? 1), 0); return `<tr><th><i class="bg-dot" style="background:${L2.color}"></i>${esc(L2.name)}</th><td class="bg-pct">${pct(t.p)}</td><td><div class="bg-oi">${t.items.map(([k, m, w]) => `<span title="${esc(nm(k))}${m > 1 ? ' ×' + m : ''}・この段の中で ${pct((w ?? 1) / sum)}">${img(k, 20)}${m > 1 ? `<small>×${m}</small>` : ''}</span>`).join('')}</div></td></tr>`; }).join('');
    return `<div class="bg-box"><span class="bg-ic big r-rare">${img('treasure_box', 48)}</span><div><b>宝箱 × ${n}</b><p class="muted">おてつだいを 1 日ぜんぶすると 1 つ・交換所（魚 8 匹）でももらえます。開けると、何かが 1 つ出てきます。</p>` +
      `<button type="button" class="btn bg-go" data-act="open"${n > 0 && !busy ? '' : ' disabled'}>${icon('gift', { size: 18 })}<span>${n > 0 ? '宝箱を開ける' : '宝箱がありません'}</span></button></div></div>` +
      `<details class="bg-odds"><summary>出る物と確率を見る</summary><table>${odds}</table><p class="muted">中身は、開けた時に受け口（サーバー）が決めます。宝箱や鍵をお金で買うことはできません。</p></details>`;
  }
  // ---------- 熟練度（バッジ） ----------
  function skillBody() {
    const U = W.unlock || {}, kinds = U.kinds || {}, tiers = U.tiers || {};
    const list = badgeNext(config, L).filter((b) => Object.values(kinds).includes(b.id) || b.id === 'builder');
    return `<p class="muted">熟練度は村人のバッジ（${TN.join('・')}）です。段が上がると、良い道具が作れるようになります。</p><ul class="bg-list">` + list.map((b) => {
      const opens = Object.entries(kinds).filter(([, id]) => id === b.id).map(([k]) => KIND_NAME[k]).join('・');
      const nextOpen = b.nextTier == null ? '' : Object.entries(tiers).filter(([, t]) => t === b.nextTier).map(([t]) => (config.crafting.tiers[t] || {}).name).join('・');
      const ic = b.tier >= 0 ? `<img class="pixel" src="icons/badge_${esc(b.id)}_${b.tier}.png" alt="" width="40" height="40">` : `<img class="pixel bg-off" src="icons/badge_${esc(b.id)}_0.png" alt="" width="40" height="40">`;
      const w = b.next ? Math.min(100, Math.round((b.count / b.next) * 100)) : 100;
      return `<li class="bg-skill">${ic}<div><b>${esc(b.name)}${b.tier >= 0 ? `<small>${TN[b.tier]}</small>` : ''}</b><small>${esc(b.note)} ${b.count}${esc(b.unit)}</small>` +
        `<span class="bg-bar"><i style="width:${w}%"></i></span>` +
        `<small class="bg-nx">${b.next == null ? 'いちばん上の段です' : `次の${TN[b.nextTier]}まで あと <b>${b.left}</b>${esc(b.unit.trim() || '回')}`}${opens && nextOpen ? `（${esc(nextOpen)}の${esc(opens)}が作れる）` : ''}</small></div></li>`;
    }).join('') + '</ul>';
  }
  const body = () => (guest ? '<p class="muted">つながると、自分の持ち物で遊べます（DM で「住みたい」と送ると専用のリンクが届きます）。</p>' : '') +
    (sub === 'send' ? sendBody() : sub === 'craft' ? craftBody() : sub === 'trade' ? tradeBody() : sub === 'box' ? boxBody() : skillBody());

  function wire() {
    root.querySelectorAll('.bg-step button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k, n = counts()[k] || 0;
      pick[k] = b.dataset.d === 'all' ? n : Math.max(0, Math.min(n, (pick[k] || 0) + Number(b.dataset.d)));
      render();
    }));
    root.querySelectorAll('.bg-rc').forEach((b) => b.addEventListener('click', () => { sel = b.dataset.rc; render(); }));
    root.querySelectorAll('.bg-go').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b.dataset.id)));
  }

  // ---------- 確かめる画面 ----------
  function confirmBox(title, html, okText) {
    return new Promise((done) => {
      const m = document.createElement('div'); m.className = 'bmodal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.innerHTML = `<div class="bm-box card"><h3>${esc(title)}</h3>${html}<div class="bm-btns"><button type="button" class="btn sub bm-no">やめる</button><button type="button" class="btn bm-ok">${esc(okText)}</button></div></div>`;
      const end = (v) => { m.remove(); done(v); };
      m.querySelector('.bm-no').onclick = () => end(false); m.querySelector('.bm-ok').onclick = () => end(true);
      m.addEventListener('click', (e) => { if (e.target === m) end(false); });
      document.body.append(m); m.querySelector('.bm-ok').focus();
    });
  }
  const itemsHtml = (list) => `<ul class="bm-items">${list.map(([k, n]) => `<li class="${rcls(k).trim()}">${img(k, 28)}<span>${esc(nm(k))}</span><b>×${n}</b></li>`).join('')}</ul>`;
  async function act(kind, id) {
    if (busy || guest) return;
    let op, ok;
    if (kind === 'send') {
      const items = Object.entries(pick).filter(([, n]) => n > 0).map(([k, n]) => [k, n]);
      if (!items.length) return;
      ok = await confirmBox('島のチェストへ送る', itemsHtml(items) + '<p class="muted">送った物は島のみんなの材料になり、もどせません。年表に「チェストに入れた」とのります。</p>', '送る');
      op = { t: 'send', items };
    } else if (kind === 'craft') {
      const r = config.crafting.recipes[sel];
      ok = await confirmBox(`${nm(sel)}を作る`, `<div class="bm-make">${img(sel, 40)}<span>使う材料</span></div>` + itemsHtml(Object.entries(r.from)) + '<p class="muted">同じ種類の古い道具は、島のチェストに入れます。</p>', '作る');
      op = { t: 'craft', recipe: sel };
    } else if (kind === 'trade') {
      const T = (W.trades || []).find((x) => x.id === id);
      ok = await confirmBox('交換する', '<p>わたす物</p>' + itemsHtml(Object.entries(T.give)) + '<p>もらう物</p>' + itemsHtml(Object.entries(T.get)), '交換する');
      op = { t: 'trade', trade: id };
    } else if (kind === 'open') return openBox();
    if (!ok) return;
    busy = true; msg = '送っています…'; render();
    try {
      const j = await store.shopDo(op);
      S = j; pick = {};
      msg = kind === 'send' ? `${j.text}をチェストへ送りました。` : kind === 'craft' ? `${j.text}を作りました！` : `${j.text}と交換しました。`;
      if (!S.demo) msg += '（島に入るのは次の毎日の更新）';
    } catch (e) { msg = e.message; }
    busy = false; render(); if (onChange) onChange();
  }

  // ---------- 宝箱を開ける：画面の下に宝箱が出てきて、ゆれて開き、そこから帯が流れ出す。だんだん遅くなり、真ん中の線で止まる ----------
  //   動きはぜんぶ performance.now と requestAnimationFrame で進める（止まる所は受け口の答え：j.stop・j.offset）
  let audio = null;
  const ac = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { audio = null; } return audio; };
  function tone(f, ms, vol = 0.05, type = 'square', at = 0) { const a = audio; if (!a) return; const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + at; o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000); o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + ms / 1000 + 0.02); }
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeOut = (u) => 1 - Math.pow(1 - u, 3), easeBack = (u) => { const c = 1.6; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  async function openBox() {
    if (busy || guest) return;
    busy = true; ac(); render();
    let j;
    try { j = await store.openBox(); } catch (e) { busy = false; msg = e.message; render(); return; }
    S = { ...S, ...j };
    const strip = j.strip, stop = j.stop, got = j.op.got, tier = j.op.tier, look = TIER_LOOK[tier] || TIER_LOOK.common;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ov = document.createElement('div'); ov.className = 'roul'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '宝箱を開ける');
    ov.innerHTML = `<div class="rl-res" aria-live="polite"></div>` +
      `<div class="rl-win"><div class="rl-strip">${strip.map(([k, n, t]) => `<span class="rl-cell t-${esc(t)}">${img(k, 40)}${n > 1 ? `<b>×${n}</b>` : ''}</span>`).join('')}</div><i class="rl-line"></i></div>` +
      `<div class="rl-chest"><i class="rl-burst"></i><i class="rl-beam"></i><img class="pixel rl-base" src="icons/chest_base.png" alt="" width="128" height="128"><img class="pixel rl-lid" src="icons/chest_lid.png" alt="" width="128" height="128"></div>` +
      `<button type="button" class="btn rl-ok" hidden>受け取る</button>`;
    document.body.append(ov);
    const win = ov.querySelector('.rl-win'), el = ov.querySelector('.rl-strip'), cells = el.children, chest = ov.querySelector('.rl-chest'), lid = chest.querySelector('.rl-lid'), beam = chest.querySelector('.rl-beam'), burst = chest.querySelector('.rl-burst');
    new Image().src = 'icons/chest_lid_open.png'; // 開いたふたを先に読んでおく（入れかえた時にちらつかない）
    const pitch = cells[1].offsetLeft - cells[0].offsetLeft, cw = cells[0].offsetWidth, ww = win.clientWidth;
    const target = stop * pitch + j.offset * cw - ww / 2;
    // 時間割（ms）：宝箱が上がる → ゆれる → ふたがパカッと開く → 中から光 → 帯が宝箱から出る → 流れる（だんだん遅く）
    const T = reduce ? { up: 0, shake: 0, open: 200, out: 250, spin: 1200 } : { up: 500, shake: 700, open: 420, out: 450, spin: 5600 };
    const tOpen = T.up + T.shake, tOut = tOpen + T.open, tSpin = tOut + T.out, tEnd = tSpin + T.spin;
    window.PLAY_ROUL = { target, pitch, cw, ww, stop, got, tier, tEnd }; // 確かめ用
    let lastCell = -1, popped = false;
    const t0 = performance.now();
    win.style.opacity = '0';
    await new Promise((done) => {
      const step = (now) => {
        const t = now - t0;
        // 宝箱：下から上がる → ゆれる（ふたがカタカタ浮く）→ ふたがパカッと開く → 中から光
        const up = T.up ? clamp01(t / T.up) : 1, sh = clamp01((t - T.up) / Math.max(1, T.shake));
        const rot = t < tOpen && t > T.up ? Math.sin(t / 30) * 6 * sh : 0;
        const pop = t >= tOpen ? Math.max(0, 1 - (t - tOpen) / 380) : 0;
        chest.style.transform = `translate3d(0,${(1 - easeBack(up)) * 160}%,0) rotate(${rot}deg) scale(${1 + pop * 0.08})`;
        const lo = clamp01((t - tOpen) / Math.max(1, T.open)); // ふたが開く進み
        if (t < tOpen) {
          // ゆれる間：ふたが少しだけ浮いてはもどる（4px＝1 ドットずつ）
          const rattle = t > T.up && Math.sin(t / 45) > 0.55 ? -4 * Math.ceil(sh * 1.5) : 0;
          lid.style.transform = `translate3d(0,${rattle}px,0)`;
        } else if (lo < 0.3) {
          lid.style.transform = `translate3d(0,${-Math.round(lo / 0.3 * 3) * 4}px,0)`; // 閉じたまま持ち上がる
        } else {
          if (!popped) { popped = true; lid.src = 'icons/chest_lid_open.png'; tone(520, 70, 0.05, 'square'); tone(880, 120, 0.05, 'triangle', 0.05); tone(1320, 160, 0.04, 'triangle', 0.12); }
          const b = (lo - 0.3) / 0.7, k = 1 + Math.sin(Math.min(1, b) * Math.PI) * 0.18 * (1 - b); // 開いた勢いで少しのびて、もどる
          lid.style.transform = `scale(1,${k.toFixed(3)})`;
        }
        // 中からの光：ふたが開いた時に立ち上がり、帯が出たあとは少し落ち着く
        const li = popped ? clamp01((t - tOpen - T.open * 0.3) / 260) : 0;
        beam.style.opacity = String(li * (t > tSpin ? Math.max(0.45, 1 - (t - tSpin) / 1500) : 1));
        beam.style.transform = `scale(${(0.5 + 0.5 * easeOut(li)).toFixed(3)},${easeOut(li).toFixed(3)})`;
        burst.style.opacity = String(t < tOpen ? sh * 0.35 : Math.max(0.35, popped ? Math.max(pop, li * 0.9) : 0.35));
        burst.style.transform = `scale(${t < tOpen ? 0.6 + sh * 0.25 : 0.9 + li * 0.35})`;
        // 帯：宝箱の口から上へのびて出てくる
        const o = clamp01((t - tOut) / Math.max(1, T.out)), oe = easeOut(o);
        win.style.opacity = String(o > 0 ? Math.min(1, o * 2) : 0);
        win.style.transform = `translate3d(0,${(1 - oe) * 70}px,0) scale(${0.12 + 0.88 * oe},${0.3 + 0.7 * oe})`;
        // 流れる：はじめ速く、だんだん遅く（4 乗のゆるめ）
        const u = clamp01((t - tSpin) / T.spin), x = target * (1 - Math.pow(1 - u, 4)) - (o < 1 ? (1 - oe) * 40 : 0);
        el.style.transform = `translate3d(${-x}px,0,0)`;
        const c = Math.floor((x + ww / 2) / pitch);
        if (t >= tSpin && c !== lastCell) { lastCell = c; tone(1650 + (c % 2) * 120, 18, 0.03); }
        if (t < tEnd) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    const winCell = cells[stop]; winCell.classList.add('win');
    ov.style.setProperty('--tc', look.color); ov.classList.add('done', 't-' + tier);
    if (tier === 'legend') { ov.classList.add('legend'); [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 280, 0.06, 'triangle', i * 0.11)); tone(2637, 500, 0.04, 'sine', 0.5); }
    else tone(tier === 'epic' ? 1480 : tier === 'rare' ? 1320 : 990, 160, 0.05, 'triangle');
    ov.querySelector('.rl-res').innerHTML = `<span class="rl-tag">${esc(look.name)}</span><b>${esc(nm(got[0]))}${got[1] > 1 ? ` ×${got[1]}` : ''}</b><small>${S.demo ? '見本なので保存しません。' : '持ち物に入ります（島に届くのは次の毎日の更新）。'}</small>`;
    const ok = ov.querySelector('.rl-ok'); ok.hidden = false; ok.focus();
    ok.onclick = () => { ov.remove(); busy = false; msg = `宝箱から${nm(got[0])}${got[1] > 1 ? ` ×${got[1]}` : ''}が出てきた！`; render(); if (onChange) onChange(); };
  }

  return { refresh, render, get state() { return S; }, openBox, act, setSub(k) { sub = k; render(); } };
}
