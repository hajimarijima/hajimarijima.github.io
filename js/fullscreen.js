// 町の画面（#map）だけを画面いっぱいにする。Fullscreen API が使える所はそれも使い、
// 使えない所（iPhone の Safari など）は CSS（html.fs-on → .map を position:fixed で画面いっぱい）だけで広げる。
// 全画面の間は右上に「シャッフル」「写真」「もどる」。Esc・ブラウザの戻るでも元にもどる。
import { icon } from './icons.js';

const S = { on: false, native: false, scroll: 0 };
const root = document.documentElement;
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canNative = () => !!(root.requestFullscreen || root.webkitRequestFullscreen);
const redraw = () => { dispatchEvent(new Event('resize')); requestAnimationFrame(() => dispatchEvent(new Event('resize'))); }; // 町（renderer・camera）を今の大きさで描き直す

function enter() {
  if (S.on) return;
  S.on = true; S.scroll = scrollY;
  if (window.TOWN_MENU) window.TOWN_MENU.close(false);
  root.classList.add('fs-on');
  try { history.pushState({ townFs: 1 }, ''); } catch (e) { /* なくてもよい */ }
  if (canNative()) {
    const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
    S.native = true;
    if (p && p.catch) p.catch(() => { S.native = false; }); // ことわられても CSS の全画面のまま
  }
  redraw();
  document.querySelector('.fs-back')?.focus({ preventScroll: true });
}

function exit(fromPop) {
  if (!S.on) return;
  S.on = false;
  root.classList.remove('fs-on');
  if (fsEl()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* なくてもよい */ } }
  S.native = false;
  if (!fromPop && history.state && history.state.townFs) { try { history.back(); } catch (e) { /* なくてもよい */ } }
  redraw();
  scrollTo(0, S.scroll || 0);
  document.querySelector('.fs-open')?.focus({ preventScroll: true });
}

function setup() {
  const map = document.getElementById('map');
  if (!map) return;
  // 全画面にするボタン（町の右上の角）
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'fs-open';
  open.setAttribute('aria-label', '町を全画面で見る'); open.title = '全画面';
  open.innerHTML = icon('maximize', { size: 20 });
  open.addEventListener('click', enter);
  // 全画面の間だけ出す右上のボタン
  const bar = document.createElement('div');
  bar.className = 'fs-bar';
  bar.innerHTML = `<button type="button" class="fs-btn fs-rand" aria-label="ランダムな人の家へ" title="シャッフル">${icon('dices', { size: 22 })}</button>`
    + `<button type="button" class="fs-btn fs-photo" aria-label="写真をとる" title="写真をとる">${icon('camera', { size: 20 })}</button>`
    + `<button type="button" class="fs-back" aria-label="全画面をやめてもどる">${icon('x', { size: 18 })}<span>もどる</span></button>`;
  map.append(open, bar);
  const rand = document.getElementById('randbtn');
  const fr = bar.querySelector('.fs-rand');
  fr.addEventListener('click', () => rand && rand.click()); // 検索欄の横のサイコロと同じ動き
  if (rand) { const sync = () => { fr.disabled = rand.disabled; }; sync(); new MutationObserver(sync).observe(rand, { attributes: true, attributeFilter: ['disabled'] }); }
  else fr.hidden = true;
  const photo = document.getElementById('photobtn');
  const fp = bar.querySelector('.fs-photo');
  if (photo) fp.addEventListener('click', () => photo.click()); else fp.hidden = true;
  bar.querySelector('.fs-back').addEventListener('click', () => exit());
  // 「島のこと」は全画面をやめてから下へ
  map.querySelector('.scroll-more')?.addEventListener('click', (e) => {
    if (!S.on) return;
    e.preventDefault(); exit();
    setTimeout(() => document.getElementById('info')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  });
  const onFs = () => { if (!fsEl() && S.on && S.native) exit(); else redraw(); }; // ブラウザの Esc で全画面がとけた時
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  addEventListener('popstate', () => { if (S.on) exit(true); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !S.on || root.classList.contains('photo-on')) return; // 写真モードの Esc は写真モードが使う
    if (document.querySelector('.joinsheet:not([hidden]), .vroom:not([hidden]), .modal:not([hidden])')) return;
    exit();
  });
  addEventListener('orientationchange', () => setTimeout(redraw, 120)); // 向きが変わった時も大きさを合わせ直す
  window.TOWN_FS = { enter, exit, state: S }; // 確かめ用
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
}
