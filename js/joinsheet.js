// 「住み方の案内」シート（町の画面）。最初に開いた人に下から出す。上のカードの「住むには」でいつでも開ける。
// config.dm.enabled が true の時は DM で住む案内、false の間はコメントで住む案内（?join=dm で DM 版、?join=comment でコメント版を確かめられる）。
// 一度閉じたら、このブラウザでは自分からは出さない（localStorage の town.joinSeen）。
import { load, esc } from './common.js';
import { icon, applyIcons } from './icons.js';

const SEEN = 'town.joinSeen';
const getSeen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch (e) { return false; } };
const setSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch (e) { /* 覚えられなくてもよい */ } };

// 中身（DOM を使わないのでテストでも使える）。mode: 'dm' か 'comment'
export function joinMode(config, qs) {
  const q = qs && qs.get ? qs.get('join') : null;
  if (q === 'dm') return 'dm';
  if (q === 'comment') return 'comment';
  return config && config.dm && config.dm.enabled === true ? 'dm' : 'comment';
}
export function joinSheetHtml(config, mode) {
  const C = config || {};
  const acct = String(C.account || '').replace(/^@+/, '') || 'comment_de_sodatsu';
  const word = C.joinWord || '住みたい';
  const prof = /^https:\/\//.test(String(C.profileUrl || '')) ? C.profileUrl : `https://www.instagram.com/${acct}/`;
  const dmUrl = `https://ig.me/m/${encodeURIComponent(acct)}`;
  const dm = mode === 'dm';
  const steps = dm
    ? [['user-plus', `インスタで <b>@${esc(acct)}</b> をフォローします。`],
      ['send', `DM で「<b>${esc(word)}</b>」と送ります。`],
      ['house', 'すぐに家が建ち、<b>あなた専用のリンク</b>が DM で届きます。開くと、その端末で自分の村人として遊べます。']]
    : [['user-plus', `インスタで <b>@${esc(acct)}</b> をフォローします。`],
      ['message-circle', `最新のリールに「<b>${esc(word)}</b>」とコメントします。`],
      ['clock', '15 分ほどで家が建ちます。上の欄で @ユーザー名 をさがすと、あなたの家へ行けます。']];
  const opt = `道具・誕生日・好きな食べ物もいっしょに書けます（例「${esc(word)} ピッケル 12/11 りんご」）。`;
  const main = dm
    ? `<a class="js-main" id="js-dm" href="${esc(dmUrl)}" target="_blank" rel="noopener">${icon('copy', { size: 20 })}<span>コピーして DM を開く</span></a>` +
      `<a class="js-sub" href="${esc(prof)}" target="_blank" rel="noopener">${icon('instagram', { size: 20 })}<span>インスタのアカウントを開く</span></a>`
    : `<a class="js-main" href="${esc(prof)}" target="_blank" rel="noopener">${icon('instagram', { size: 20 })}<span>インスタのアカウントを開く</span></a>` +
      `<button type="button" class="js-sub" id="js-copy">${icon('copy', { size: 20 })}<span>『${esc(word)}』をコピー</span></button>`;
  const already = dm
    ? `同じように DM で「${esc(word)}」と送ると、新しい家ではなく<b>元の家のリンク</b>と、新しい専用のリンクが届きます（前の専用のリンクは使えなくなります）。家はインスタのアカウントにひもづいているので、別のスマホからでも戻れます。`
    : `もう一度コメントしても、新しい家は建たず<b>元の家</b>のままです。家はインスタのアカウントにひもづいているので、別のスマホからでも上の欄で @ユーザー名 をさがせば戻れます。`;
  return `<div class="js-grab" aria-hidden="true"></div>` +
    `<button type="button" class="js-x" aria-label="閉じる" title="閉じる">${icon('x', { size: 22 })}</button>` +
    `<div class="js-badge" aria-hidden="true">${icon('house', { size: 30 })}</div>` +
    `<h2 class="js-title" id="js-title">インスタで住む</h2>` +
    `<ol class="js-steps">${steps.map(([ic, t], i) => `<li><span class="js-n">${i + 1}</span><span class="js-t">${t}</span>${icon(ic, { size: 20, cls: 'js-ic' })}</li>`).join('')}</ol>` +
    `<p class="js-opt">${opt}</p>` +
    `<div class="js-btns">${main}</div>` +
    `<p class="js-toast" id="js-toast" role="status" aria-live="polite"></p>` +
    `<div class="js-already"><b class="js-ah">${icon('info', { size: 18 })}もう住んでいる人は</b><p>${already}</p></div>` +
    `<button type="button" class="js-later" id="js-later">まずは島を見てみる</button>`;
}

// クリップボードに入れる（だめな時は古いやり方）
function copyText(s) {
  try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s).then(() => true, () => oldCopy(s)); } catch (e) { /* 下へ */ }
  return Promise.resolve(oldCopy(s));
}
function oldCopy(s) {
  try {
    const t = document.createElement('textarea'); t.value = s; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch (e) { return false; }
}

async function setup() {
  applyIcons(document); // 上のカード・タブ・せつめいのアイコン
  let config = {};
  try { config = await load('config'); } catch (e) { /* 読めなくても案内は出す */ }
  const qs = new URLSearchParams(location.search);
  const mode = joinMode(config, qs);
  const word = config.joinWord || '住みたい';
  const wrap = document.createElement('div');
  wrap.className = 'joinsheet'; wrap.hidden = true;
  wrap.innerHTML = `<div class="js-back" data-close></div><section class="js-card" role="dialog" aria-modal="true" aria-labelledby="js-title" tabindex="-1">${joinSheetHtml(config, mode)}</section>`;
  document.body.append(wrap);
  const card = wrap.querySelector('.js-card');
  let back = null;
  const say = (t) => { const el = wrap.querySelector('#js-toast'); el.textContent = t; };
  const open = () => {
    back = document.activeElement; wrap.hidden = false; say('');
    requestAnimationFrame(() => { wrap.classList.add('on'); card.focus({ preventScroll: true }); });
  };
  const close = () => {
    setSeen(); wrap.classList.remove('on');
    setTimeout(() => { wrap.hidden = true; }, 220);
    if (back && back.focus) back.focus({ preventScroll: true });
  };
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close], .js-x, #js-later')) close(); });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { // シートの中だけで回す
      const f = [...card.querySelectorAll('a[href], button')]; if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  // DM：先にコピーしてから、そのまま DM の画面へ（a の href で開くので、ポップアップ止めにかからない）
  wrap.querySelector('#js-dm')?.addEventListener('click', () => { copyText(word).then((ok) => say(ok ? `「${word}」をコピーしました。DM に貼りつけて送ってね` : `「${word}」と打って送ってね`)); setSeen(); });
  wrap.querySelector('#js-copy')?.addEventListener('click', () => { copyText(word).then((ok) => say(ok ? `「${word}」をコピーしました。リールのコメントに貼りつけてね` : `コピーできませんでした。「${word}」と打ってね`)); });
  document.getElementById('joinbtn')?.addEventListener('click', open);
  window.TOWN_JOIN = { open, close, mode }; // 確かめ用
  // 最初に開いた人だけ。DM の返事のリンク（?v=）・人さがし（?who=）で来た人には出さない。?join= の時はいつも出す
  if (qs.get('join') || (!getSeen() && !qs.get('v') && !qs.get('who') && !qs.has('me'))) setTimeout(open, 600);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
}
