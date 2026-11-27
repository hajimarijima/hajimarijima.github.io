// 自分の村人（me.html）の「郵便受け」と「家を飾る」の欄。me.js からは renderMePost を 1 回呼ぶだけ
import { loadAll } from './common.js';
import { icon } from './icons.js';
import { withDemo } from './mine.js';
import { letterHtml, addFaces } from './letterview.js';
import { loadMail, loadDecor, demoLetters, demoDecor, homeOf } from './homedata.js';
import { DECOR, decorOn, soonBadge } from './decor.js';

export async function renderMePost(el, W) {
  if (!el || !W || !W.villager) return;
  const D = await loadAll(), v = W.villager, demo = W.mode === 'demo';
  const byKey = Object.fromEntries(D.villagers.map((x) => [x.key, x]));
  let letters = (await loadMail()).letters;
  if (demo && !letters.some((L) => L.to === v.key)) letters = letters.concat(demoLetters(v, D.active, D.state.day, D.config));
  const recv = letters.filter((L) => L.to === v.key).reverse();
  let seen = NaN; try { seen = Number(localStorage.getItem('town.mailSeen.' + v.key)); } catch (e) { /* なくてもよい */ }
  const isNew = (L) => (Number.isFinite(seen) ? L.day > seen : L.day >= D.state.day);
  const nNew = recv.filter(isNew).length;
  const needT = ((await loadMail()).needTerms || {})[v.key] != null; // コメントで手紙を送ろうとしたが、きまりに同意していない
  const dec = (await loadDecor())[v.key] || (demo ? demoDecor(homeOf(v, D).look) : null);
  const nOwn = dec ? Object.values(dec.own || {}).reduce((a, b) => a + b, 0) : 0, nPut = dec ? (dec.out || []).length + (dec.in || []).length : 0;
  el.className = 'mepost';
  el.innerHTML = `<h2 class="me-h">${icon('mail', { size: 20 })}<span>郵便受け</span>${nNew ? `<b class="lnew">新しい手紙 ${nNew} 通</b>` : ''}</h2>` +
    `<section class="card mecard">${needT ? `<p class="mf-guide">コメントの「手紙」が届いていません。<a href="${withDemo('mail.html')}">手紙のページ</a>で、手紙のきまりに同意してね。</p>` : ''}${recv.length ? `<ul class="letters">${recv.slice(0, 2).map((L) => letterHtml(L, byKey, D.config, { isNew: isNew(L), report: true })).join('')}</ul>${recv.length > 2 ? `<p class="muted">ほかに ${recv.length - 2} 通</p>` : ''}` : '<p class="muted">まだ手紙は届いていません。</p>'}` +
    `<div class="me-btns"><a class="btn" href="${withDemo('mail.html')}">${icon('mail', { size: 18 })}<span>手紙を読む・書く</span></a><a class="btn sub" href="${withDemo('home.html')}">${icon('house', { size: 18 })}<span>家を飾る</span>${soonBadge(D.config)}</a></div>` +
    (!decorOn(D.config) ? '<p class="muted">家を飾るのは近日公開です。島がもっと大きくなったら開きます。</p></section>'
      : `<p class="muted">家の飾り：${nOwn ? `${nOwn} 個持っていて、${nPut} 個置いています` : 'まだありません（釣り・おてつだい・宝探し・行事・手紙のお礼で手に入ります）'}${dec && (dec.got || []).length ? `。最近：${DECOR[dec.got[dec.got.length - 1][1]].name}` : ''}</p></section>`);
  const ul = el.querySelector('.letters'); if (ul) { addFaces(ul, byKey); import('./report.js').then((m) => m.bindReports(ul, D.config)).catch(() => {}); }
}
