// 自分の村人：DM で「住みたい」と送ると届く、その人専用のリンク（?me=印）でつなぐ。Google ログインは使わない。
//   ・リンクを開くと、その端末（localStorage の town.me）に印を覚え、URL から印を消して「あなたは @○○ として島にいます」と出す。
//   ・以後、どのページから来ても、印を受け口（config.play.apiUrl の Worker・tools/webhook/worker.mjs の 5)）に送って自分の村人を確かめる。
//   ・別の端末では、もう一度 DM すると新しい印が届き、前の印は使えなくなる。「この端末から出る」で印を忘れる。
//   ・?demo-me=1：見本（つながった状態。何も保存しない・受け口にも送らない）。?k=村人 で見本の村人を選べる。
// メニューの「自分の村人」は、つながっていれば顔と名前、つながっていなければ DM 版の住み方の案内（./?join=dm）へ。
import { load, esc, skinSrc, loadImage, drawFace } from './common.js';
import { icon } from './icons.js';

const ME_KEY = 'town.me';
const qs = () => new URLSearchParams(location.search);
export const isDemo = () => qs().get('demo-me') === '1';
export const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9]{32}$/.test(t);
export function getToken() { try { const t = localStorage.getItem(ME_KEY); return validToken(t) ? t : null; } catch (e) { return null; } }
export function setToken(t) { try { localStorage.setItem(ME_KEY, t); return true; } catch (e) { return false; } }
export function clearToken() { try { localStorage.removeItem(ME_KEY); } catch (e) { /* なくてもよい */ } }
export const apiBase = (config) => String((config && config.play && config.play.apiUrl) || '').trim().replace(/\/+$/, '');

// 見本の村人：?k= か、レベル・称号が多い人（いなければ最初の人）
export function demoVillager(villagers, life, key) {
  const list = villagers || [];
  return list.find((v) => v.key === key) || list.slice().sort((a, b) => (((life || {})[b.key] || {}).level || 1) - (((life || {})[a.key] || {}).level || 1) || ((b.titles || []).length - (a.titles || []).length))[0] || null;
}

// 受け口に送る（印は Authorization にだけ入れる。URL には入れない）
export async function api(config, path, body) {
  const base = apiBase(config), tok = getToken();
  if (!base || !tok) throw new Error('つながっていません');
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + tok, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { clearToken(); throw Object.assign(new Error('このリンクはもう使えません（新しいリンクが届いた時は、そちらを開いてください）'), { code: 'expired' }); }
  if (!r.ok) throw Object.assign(new Error(j.error === 'limit' ? 'きょうの回数はおしまいです' : '受け口でつまずきました（' + r.status + '）'), { code: j.error || r.status, body: j });
  return j;
}

// 今の自分。{ mode: 'demo' | 'live' | 'none' | 'off', villager, me（受け口の /me の中身）, error }
//   'off'：受け口の URL（config.play.apiUrl）がまだ空（準備中）。'none'：つながっていない
let cur = null;
export function whoami() {
  if (cur) return cur;
  cur = (async () => {
    const config = await load('config').catch(() => ({}));
    const villagers = await load('villagers').catch(() => []);
    if (isDemo()) {
      const life = await load('life').catch(() => ({}));
      const v = demoVillager(villagers.filter((x) => !x.gone), life, qs().get('demo-k') || qs().get('k')); // demo-k：?k= を別の意味で使うページ（村人のページ・町の画面）での見本の村人
      return { mode: v ? 'demo' : 'none', villager: v, config, me: null };
    }
    const tok = getToken();
    if (!apiBase(config)) return { mode: tok ? 'off' : 'none', off: true, villager: null, config };
    if (!tok) return { mode: 'none', villager: null, config };
    try {
      const me = await api(config, '/me');
      const v = villagers.find((x) => x.key === me.villager) || null;
      return v ? { mode: 'live', villager: v, config, me } : { mode: 'none', villager: null, config, error: '村人が見つかりません（毎日の更新のあとで開き直してください）' };
    } catch (e) { return { mode: 'none', villager: null, config, error: e.message, expired: e.code === 'expired' }; }
  })();
  return cur;
}
export function forget() { clearToken(); cur = null; }

// 顔の小さな絵（canvas）
export function faceEl(v, size = 22) {
  const c = document.createElement('canvas'); c.width = c.height = size; c.className = 'pixel mineface';
  loadImage(skinSrc(v)).then((img) => drawFace(c.getContext('2d'), img, size)).catch(() => {});
  return c;
}
export const atName = (v) => (v ? (v.hidden ? v.display : '@' + v.display) : '');
// 見本の印（?demo-me=1）を、遊ぶ・自分の村人のリンクに引きつぐ
export const withDemo = (href) => (isDemo() ? href + (href.includes('?') ? '&' : '?') + 'demo-me=1' + (qs().get('k') ? '&k=' + encodeURIComponent(qs().get('k')) : '') : href);

// どのページでも：?me= の印を覚える → メニューの「自分の村人」を顔と名前に
export async function setupMine() {
  if (typeof document === 'undefined') return;
  const q = qs(), tok = q.get('me');
  let fresh = false;
  if (tok !== null) {
    const demo = isDemo(); // 見本（?demo-me=1&me=x）は覚えずに「あなたは…」だけ出す
    if (demo) fresh = true;
    else if (validToken(tok)) { fresh = setToken(tok); cur = null; }
    q.delete('me'); // 印は URL に残さない（履歴・共有・スクリーンショットに出さない）
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    if (demo) { /* 下で出す */ } else if (!validToken(tok)) showWelcome(null, 'このリンクは形がちがいます。DM で届いたリンクをそのまま開いてください。');
    else if (!fresh) showWelcome(null, 'この端末では印を覚えられませんでした（プライベートブラウズでは覚えられないことがあります）。');
  }
  for (const a of document.querySelectorAll('a[href="play.html"], a[href="me.html"]')) a.setAttribute('href', withDemo(a.getAttribute('href')));
  const W = await whoami();
  decorateMenu(W);
  if (fresh) showWelcome(W);
}
function decorateMenu(W) {
  for (const a of document.querySelectorAll('a[href^="me.html"]')) {
    const span = a.querySelector('span');
    if (W.villager) {
      const old = a.querySelector('svg.ic:not(.sm-go)'); if (old) old.replaceWith(faceEl(W.villager, a.closest('.sm-list') ? 24 : 18));
      if (span) { span.textContent = W.villager.display; span.title = '自分の村人：' + W.villager.display; span.classList.add('minename'); }
      a.setAttribute('aria-label', '自分の村人：' + W.villager.display);
    } else if (!W.off || !getToken()) {
      // つながっていない：DM 版の住み方の案内へ（町の画面で ?join=dm）
      a.setAttribute('href', './?join=dm');
      a.title = 'DM で「住みたい」と送ると、あなた専用のリンクが届きます';
    }
  }
}
// 「あなたは @○○ として島にいます」（リンクを開いた時だけ）
function showWelcome(W, err) {
  const box = document.createElement('div');
  box.className = 'minewelcome'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'mw-t');
  const v = W && W.villager;
  box.innerHTML = '<div class="mw-back" data-close></div><section class="mw-card card" tabindex="-1">' +
    `<button type="button" class="mw-x" data-close aria-label="閉じる">${icon('x', { size: 20 })}</button>` +
    (v ? `<div class="mw-face"></div><h2 id="mw-t">あなたは<br><b class="mw-name">${esc(atName(v))}</b><br>として島にいます</h2>` +
      '<p class="muted">この端末で、自分の村人として遊べます。リンクは人に教えないでね。別のスマホでは、もう一度 DM で「住みたい」と送ると新しいリンクが届きます（前のリンクは使えなくなります）。</p>' +
      `<div class="mw-btns"><a class="btn" href="${withDemo('play.html')}">${icon('gamepad-2', { size: 18 })}<span>遊ぶ</span></a><a class="btn sub" href="${withDemo('me.html')}">${icon('circle-user', { size: 18 })}<span>自分の村人</span></a></div>`
      : `<h2 id="mw-t">リンクを開けませんでした</h2><p>${esc(err || (W && W.error) || (W && W.off ? '受け口の準備中です。もうしばらく待ってね。' : '村人とつながりませんでした。'))}</p><div class="mw-btns"><a class="btn" href="./?join=dm">DM の案内を見る</a></div>`) +
    '</section>';
  document.body.append(box);
  if (v) box.querySelector('.mw-face').append(faceEl(v, 64));
  const close = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  requestAnimationFrame(() => box.querySelector('.mw-card').focus({ preventScroll: true }));
}
export { showWelcome as _showWelcome };
