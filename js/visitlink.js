// 「遊びに行く」ボタンと「来た人ノート」の見た目（村人のページ・home.html で共通）。歩いて行く所と家の中は js/visit3d.js・js/visitroom.js
import { esc, faceCanvas, villagerUrl } from './common.js';
import { icon } from './icons.js';
import { noteText } from './visits.js';

// 町の画面へ（?visit=相手）。見本は demo-k で自分の村人を渡す（?k= は町の画面では使わない）
export function visitHref(W, host) {
  const base = 'index.html?intro=0&visit=' + encodeURIComponent(host);
  return W && W.mode === 'demo' ? base + '&demo-me=1&demo-k=' + encodeURIComponent(W.villager.key) : base;
}
export const visitBtn = (W, host, name) => `<a class="btn vgo" href="${visitHref(W, host)}">${icon('footprints', { size: 18 })}<span>${esc(name ? name + 'さんの家へ' : '')}遊びに行く</span></a>`;

// 来た人ノート（新しい順）。notes：[{ day, from, note, kind }]
export function notebookHtml(notes, byKey, { max = 8, empty = 'まだだれも来ていません。' } = {}) {
  const list = notes.slice().reverse().slice(0, max);
  if (!list.length) return `<p class="muted vnempty">${esc(empty)}</p>`;
  return '<ul class="vnote">' + list.map((n) => {
    const o = byKey[n.from], w = noteText(n.note);
    return `<li data-k="${esc(o ? o.key : '')}"><span class="lface"></span><div><div class="lhead">${o ? `<a href="${villagerUrl(o)}">${esc(o.display)}</a>` : '<span class="muted">（もういない人）</span>'}<span class="muted lday">${esc((n.day ?? '') + '日目')}${n.pending ? '・あしたの朝にのります' : ''}</span></div>` +
      `<p class="vword">${w ? '「' + esc(w) + '」' : '<span class="muted">（一言なし）</span>'}</p></div></li>`;
  }).join('') + '</ul>';
}
export function addNoteFaces(el, byKey) {
  for (const li of el.querySelectorAll('.vnote li')) { const o = byKey[li.dataset.k]; if (o) faceCanvas(o, 32).then((c) => li.querySelector('.lface').append(c)).catch(() => {}); }
}
// 見本で遊びに行った分（この端末だけ。何も送らない）
const dk = (day) => 'town.visitDemo.' + day;
export function demoVisits(day) { try { return JSON.parse(localStorage.getItem(dk(day)) || '[]'); } catch (e) { return []; } }
export function addDemoVisit(day, x) { try { const a = demoVisits(day); a.push(x); localStorage.setItem(dk(day), JSON.stringify(a)); } catch (e) { /* 覚えられなくてもよい */ } }
export function setDemoNote(day, id, note) { try { const a = demoVisits(day), x = a.find((y) => y.id === id); if (x) { x.note = note; localStorage.setItem(dk(day), JSON.stringify(a)); } } catch (e) { /* 同じ */ } }
