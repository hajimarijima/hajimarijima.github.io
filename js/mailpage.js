// 手紙（mail.html）：自分の村人の郵便受け（届いた手紙）と、手紙を書く所・送った手紙。
//   送る：受け口（Worker の /mail/send）。1 日の数は受け口が数える。届くのは次の毎日の更新（tools/mail.js）。
//   コメント「手紙 @相手 本文」でも送れる。?demo-me=1 は見本（何も送らない）
import { loadAll, nav, esc, showError } from './common.js';
import { letterHtml, addFaces } from './letterview.js';
import { icon } from './icons.js';
import { whoami, api, atName, withDemo } from './mine.js';
import { heldOf } from './invslots.js';
import { checkLetter, mailCfg, LETTER_ERR, giftOk } from './letters.js';
import { DECOR, leftOf, decorOn, soonBadge } from './decor.js';
import { loadMail, loadDecor, demoLetters, demoDecor, homeOf } from './homedata.js';
import { TERMS_VERSION, TERMS_POINTS } from './terms.js';
import { bindReports } from './report.js';
// 見本の同意（この端末だけ。版が上がったら同意し直し）
const demoAgreed = (k) => { try { return Number(localStorage.getItem('town.termsDemo.' + k)) >= TERMS_VERSION; } catch (e) { return false; } };
const setDemoAgreed = (k) => { try { localStorage.setItem('town.termsDemo.' + k, String(TERMS_VERSION)); } catch (e) { /* 覚えられなくてもよい */ } };

nav('me.html');
const main = document.getElementById('main');
const seenKey = (k) => 'town.mailSeen.' + k;
const getSeen = (k) => { try { return Number(localStorage.getItem(seenKey(k))); } catch (e) { return NaN; } };
const setSeen = (k, d) => { try { localStorage.setItem(seenKey(k), String(d)); } catch (e) { /* 覚えられなくてもよい */ } };

async function run() {
  const [W, D] = await Promise.all([whoami(), loadAll()]);
  const config = D.config, M = mailCfg(config);
  if (!W.villager) {
    main.innerHTML = `<h1>手紙</h1><section class="card mecard"><p>手紙を書くには、自分の村人とつながってください。</p><div class="me-btns"><a class="btn" href="me.html">${icon('circle-user', { size: 18 })}<span>自分の村人</span></a><a class="btn sub" href="mail.html?demo-me=1">見本を見る</a></div></section>`;
    return;
  }
  const v = W.villager, demo = W.mode === 'demo', day = D.state.day;
  const byKey = Object.fromEntries(D.villagers.map((x) => [x.key, x]));
  const mail = await loadMail();
  let letters = mail.letters.slice();
  if (demo && !letters.some((L) => L.to === v.key)) letters = letters.concat(demoLetters(v, D.active, day, config));
  const recv = letters.filter((L) => L.to === v.key).reverse();
  const seen = getSeen(v.key);
  const isNew = (L) => (Number.isFinite(seen) ? L.day > seen : L.day >= day);
  const nNew = recv.filter(isNew).length;
  // 送れる数と、きょう送った手紙（受け口から。見本は数えるだけ）
  let state = { sent: [], left: M.perDay, agreed: demoAgreed(v.key) };
  if (!demo) { try { const s = await api(config, '/mail/state'); state = { sent: (s.mail && s.mail.sent) || [], left: s.mail ? s.mail.left : M.perDay, agreed: !!(s.terms && s.terms.agreed) }; } catch (e) { state.err = e.message; } }
  const needT = !state.agreed && (mail.needTerms || {})[v.key] != null; // コメントで送ろうとしたが、同意していなかった
  const L0 = D.life[v.key] || {};
  const H = homeOf(v, D), dec = (await loadDecor())[v.key] || (demo ? demoDecor(H.look) : { own: {}, out: [], in: [] });
  const gifts = [...new Map(heldOf(L0).list.filter((s) => s && giftOk(s.item) && (s.n || 0) > 0).map((s) => [s.item, s])).values()];
  const decorGifts = !decorOn(config) ? [] : Object.keys(dec.own || {}).filter((id) => leftOf(dec.own, dec.out, dec.in, id) > 0);
  const rel = ((D.social.view || {})[v.key] || []).filter((r) => byKey[r.other] && !byKey[r.other].gone).map((r) => r.other);
  const pre = new URLSearchParams(location.search).get('to');
  const others = D.active.filter((x) => x.key !== v.key && !x.gone).sort((a, b) => a.display.localeCompare(b.display, 'ja'));
  const opt = (x) => `<option value="${esc(x.key)}"${x.key === pre ? ' selected' : ''}>${esc(atName(x))}</option>`;
  const sent0 = letters.filter((L) => L.from === v.key).reverse();
  main.innerHTML = '<h1>手紙</h1>' + (demo ? '<p><span class="demo">見本の画面（送りません）</span></p>' : '') +
    `<section class="card mecard mailbox"><h2 class="me-h">${icon('mail', { size: 20 })}<span>郵便受け</span>${nNew ? `<b class="lnew">新しい手紙 ${nNew} 通</b>` : ''}</h2>` +
    (recv.length ? `<ul class="letters" id="recv">${recv.map((L) => letterHtml(L, byKey, config, { isNew: isNew(L), report: true })).join('')}</ul>` : '<p class="muted">まだ手紙は届いていません。だれかに書いてみよう。</p>') + '</section>' +
    `<section class="card mecard"><h2 class="me-h">${icon('pencil', { size: 20 })}<span>手紙を書く</span></h2>` +
    // 手紙のきまり（初めての時と、きまりが変わった時）。「同意する」を押すまで書く所は出さない
    `<div class="agree" id="agree"${state.agreed ? ' hidden' : ''}>${needT ? '<p class="mf-guide">コメントの「手紙」は、このきまりに同意してから届くようになります。</p>' : ''}<p>手紙を送る前に、きまりを読んでね。</p><ol class="terms">${TERMS_POINTS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` +
    `<div class="me-btns"><button type="button" class="savebtn" id="agreebtn">同意する</button><a href="${withDemo('terms.html')}">きまりをくわしく読む</a></div><p class="muted mf-msg" id="agmsg" role="status"></p></div>` +
    `<form id="wf" class="mailform" novalidate${state.agreed ? '' : ' hidden'}>` +
    `<label class="mf-row"><span class="mf-k">あて先</span><select id="wto" required><option value="">えらぶ</option>${rel.length ? `<optgroup label="仲のいい人">${rel.map((k) => opt(byKey[k])).join('')}</optgroup>` : ''}<optgroup label="島のみんな">${others.filter((x) => !rel.includes(x.key)).map(opt).join('')}</optgroup></select></label>` +
    `<label class="mf-row mf-text"><span class="mf-k">本文</span><textarea id="wtext" rows="3" maxlength="${M.maxLen}" placeholder="短い手紙（${M.maxLen} 字まで）"></textarea><small class="mf-cnt" id="wcnt">0/${M.maxLen}</small></label>` +
    `<label class="mf-row"><span class="mf-k">そえる物</span><select id="wgift"><option value="">なし</option>${gifts.length ? `<optgroup label="持ち物">${gifts.map((s) => `<option value="${esc(s.item)}">${esc(((config.items || {})[s.item] || {}).name || s.item)}（${s.n} 個）</option>`).join('')}</optgroup>` : ''}${decorGifts.length ? `<optgroup label="家の飾り（置いていない物）">${decorGifts.map((id) => `<option value="${id}">${esc(DECOR[id].name)}</option>`).join('')}</optgroup>` : ''}</select></label>` +
    `<div class="me-save"><button type="submit" class="savebtn" id="wsend">送る</button><span class="muted" id="wleft"></span></div><p class="muted mf-msg" id="wmsg" role="status"></p>` +
    `<p class="muted mf-note">手紙は相手の村人のページにも出るので、島のみんなが読めます。とげのある言葉・URL・電話番号は送れません。届くのは次の毎日の更新（朝 6 時）です。インスタのコメントで「<b>手紙 @相手 本文</b>」と書いても送れます。</p></form></section>` +
    `<section class="card mecard"><h2 class="me-h">${icon('send', { size: 20 })}<span>送った手紙</span></h2><ul class="letters" id="sent"></ul></section>` +
    `<div class="me-btns"><a class="btn sub" href="${withDemo('me.html')}">${icon('circle-user', { size: 18 })}<span>自分の村人へ</span></a><a class="btn sub" href="${withDemo('home.html')}">${icon('house', { size: 18 })}<span>家を飾る</span>${soonBadge(config)}</a></div>`;
  const recvUl = main.querySelector('#recv'); if (recvUl) { addFaces(recvUl, byKey); bindReports(recvUl, config); }
  // 同意する（受け口に版と日時を残す。見本はこの端末だけ）
  const agBox = main.querySelector('#agree');
  main.querySelector('#agreebtn').onclick = async () => {
    const m = main.querySelector('#agmsg');
    try {
      if (demo) setDemoAgreed(v.key); else await api(config, '/mail/agree', { version: TERMS_VERSION });
      state.agreed = true; agBox.hidden = true; main.querySelector('#wf').hidden = false; main.querySelector('#wto').focus();
    } catch (e) { m.textContent = '同意を送れませんでした：' + e.message; }
  };
  const sentUl = main.querySelector('#sent');
  const pending = () => state.sent.map((L) => ({ ...L, from: v.key, day, kind: 'pending', pending: true }));
  const drawSent = () => {
    const list = [...pending().reverse(), ...sent0];
    sentUl.innerHTML = list.length ? list.map((L) => letterHtml(L, byKey, config, { sent: true })).join('') : '<li class="muted">まだ送っていません。</li>';
    addFaces(sentUl, byKey);
  };
  drawSent();
  setSeen(v.key, day); // 開いたら「読んだ」にする（新しい印は次に開いた時から消える）
  // 書く
  const f = main.querySelector('#wf'), ta = f.querySelector('#wtext'), cnt = f.querySelector('#wcnt'), msg = f.querySelector('#wmsg'), left = f.querySelector('#wleft'), btn = f.querySelector('#wsend');
  const upLeft = () => { left.textContent = state.err ? state.err : `きょうはあと ${state.left} 通送れます`; btn.disabled = state.left <= 0 || !!state.err; };
  upLeft();
  ta.addEventListener('input', () => { const n = Array.from(ta.value).length; cnt.textContent = `${n}/${M.maxLen}`; cnt.classList.toggle('over', n > M.maxLen); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const to = f.querySelector('#wto').value, gift = f.querySelector('#wgift').value || null;
    if (!to) { msg.textContent = LETTER_ERR.to; return; }
    if (to === v.key) { msg.textContent = LETTER_ERR.self; return; }
    const c = checkLetter(ta.value, config);
    if (!c.ok) { msg.textContent = LETTER_ERR[c.error] || '送れませんでした'; return; }
    if (state.left <= 0) { msg.textContent = LETTER_ERR.limit; return; }
    msg.textContent = '送っています…'; btn.disabled = true;
    try {
      if (demo) { state.sent.push({ id: 'd' + Date.now(), to, text: c.text, gift }); state.left--; msg.textContent = `見本なので送っていません（本番では、あしたの朝 ${byKey[to].display} さんの郵便受けに届きます）。`; }
      else { const r = await api(config, '/mail/send', { to, text: c.text, gift }); state.sent.push(r.letter); state.left = r.left; msg.textContent = `送りました。あしたの朝、${byKey[to].display} さんの郵便受けに届きます。`; }
      ta.value = ''; ta.dispatchEvent(new Event('input')); drawSent();
    } catch (err) {
      if (err.code === 'terms') { state.agreed = false; agBox.hidden = false; f.hidden = true; main.querySelector('#agmsg').textContent = 'きまりが新しくなりました。読んで、もう一度「同意する」を押してね。'; }
      msg.textContent = err.code && LETTER_ERR[err.code] ? LETTER_ERR[err.code] : '送れませんでした：' + err.message;
    }
    upLeft();
  };
}

run().catch(showError);
