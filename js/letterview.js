// 手紙 1 通の見た目（mail.html の郵便受け・村人のページの「手紙」・自分の村人の郵便受けで共通）
import { esc, faceCanvas, villagerUrl } from './common.js';
import { DECOR } from './decor.js';

// sent：送った手紙（相手の名前を出す）。isNew：新しい印
// report：「通報」ボタンを付ける（押した時のことは js/report.js の bindReports）
export function letterHtml(L, byKey, config, { isNew = false, sent = false, both = false, report = false } = {}) {
  const other = byKey[sent ? L.to : L.from], to = byKey[L.to];
  const link = (o) => (o ? `<a href="${villagerUrl(o)}">${esc(o.display)}</a>` : '<span class="muted">（もういない人）</span>');
  const giftName = L.gift ? (DECOR[L.gift] || (config.items || {})[L.gift] || {}).name || L.gift : '';
  const gift = L.gift ? `<span class="tag lgift">${DECOR[L.gift] ? '' : `<img class="pixel" src="icons/${esc(L.gift)}.png" alt="" width="16" height="16">`}${esc(giftName)}をそえて</span>` : '';
  const decor = L.decor && DECOR[L.decor] ? `<span class="tag lgift ldecor">お礼の飾り「${esc(DECOR[L.decor].name)}」</span>` : '';
  const how = { comment: 'コメントで', thanks: 'お礼の手紙', visit: '遊びに来たよ' }[L.kind] || '';
  const head = both ? `${link(byKey[L.from])}<span class="muted">から</span>${link(to)}<span class="muted">へ</span>` : (sent ? '<span class="muted">あて先</span>' : '') + link(other);
  return `<li class="letter${isNew ? ' new' : ''}" data-k="${esc(other ? other.key : '')}"><span class="lface"></span><div class="lbody">` +
    `<div class="lhead">${head}<span class="muted lday">${L.pending ? 'あしたの朝に届きます' : esc(L.day + '日目')}${how ? '・' + how : ''}</span>${isNew ? '<b class="lnew">新しい</b>' : ''}${report && L.id && !L.pending ? `<button type="button" class="lrep" data-id="${esc(L.id)}" aria-label="この手紙を通報する">通報</button>` : ''}</div>` +
    `<p class="ltext">${esc(L.text)}</p>${gift || decor ? `<div class="lgifts">${gift}${decor}</div>` : ''}</div></li>`;
}
export function addFaces(ul, byKey) {
  for (const li of ul.querySelectorAll('li.letter')) { const o = byKey[li.dataset.k]; if (o) faceCanvas(o, 36).then((c) => li.querySelector('.lface').append(c)).catch(() => {}); }
}
