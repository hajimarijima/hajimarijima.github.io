// スマホの幅（600px 以下）のメニュー：右上の ☰ ボタンを押すと、右から 7 つの画面のメニューが出る。
// PC の幅では今までどおり上の帯（css/style.css で ☰ をかくす）。今いる画面は橙。× ・外を押す・Esc で閉じる。
// いちばん下に「住むには」：町の画面なら案内のシート（js/joinsheet.js）を開き、ほかの画面からは町の画面で開く。
import { icon } from './icons.js';

export function setupMenu(head, items) {
  if (typeof document === 'undefined' || !head) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'menubtn';
  btn.setAttribute('aria-label', 'メニュー'); btn.title = 'メニュー';
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'sitemenu');
  btn.innerHTML = icon('menu', { size: 24 });
  head.append(btn);

  const wrap = document.createElement('div');
  wrap.className = 'sitemenu'; wrap.id = 'sitemenu'; wrap.hidden = true;
  wrap.innerHTML = '<div class="sm-back" data-close></div>' +
    '<nav class="sm-panel" role="dialog" aria-modal="true" aria-label="メニュー" tabindex="-1">' +
    `<div class="sm-head"><a class="sm-brand" href="./">はじまり島</a><button type="button" class="sm-x" data-close aria-label="閉じる" title="閉じる">${icon('x', { size: 22 })}</button></div>` +
    '<ul class="sm-list">' + items.map((it) => `<li><a href="${it.href}"${it.on ? ' class="on" aria-current="page"' : ''}>${icon(it.icon, { size: 22 })}<span>${it.text}</span>${icon('chevron-right', { size: 18, cls: 'sm-go' })}</a></li>`).join('') + '</ul>' +
    `<a class="sm-join" href="./?join=open" id="sm-join">${icon('house', { size: 20 })}<span>住むには</span></a>` +
    '</nav>';
  document.body.append(wrap);
  const panel = wrap.querySelector('.sm-panel');

  const open = () => {
    wrap.hidden = false; btn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('menu-open');
    requestAnimationFrame(() => { wrap.classList.add('on'); panel.focus({ preventScroll: true }); });
  };
  const close = (back = true) => {
    wrap.classList.remove('on'); btn.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('menu-open');
    setTimeout(() => { if (!wrap.classList.contains('on')) wrap.hidden = true; }, 200);
    if (back) btn.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => (wrap.hidden ? open() : close()));
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { // メニューの中だけで回す
      const f = [...panel.querySelectorAll('a[href], button')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  // 住むには：町の画面にいれば、その場で案内のシートを開く
  wrap.querySelector('#sm-join').addEventListener('click', (e) => {
    if (window.TOWN_JOIN && window.TOWN_JOIN.open) { e.preventDefault(); close(false); window.TOWN_JOIN.open(); }
  });
  // PC の幅に広げたら閉じる
  const mq = window.matchMedia && window.matchMedia('(min-width: 601px)');
  if (mq && mq.addEventListener) mq.addEventListener('change', (m) => { if (m.matches && !wrap.hidden) close(false); });
  window.TOWN_MENU = { open, close }; // 確かめ用
}
