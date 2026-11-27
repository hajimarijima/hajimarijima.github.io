// home.html の「遊びに行く」（仲のいい人の家へ）と「来た人ノート」（自分の家に来た人）。homepage.js から 1 回呼ぶ
import { esc, faceCanvas } from './common.js';
import { icon } from './icons.js';
import { api } from './mine.js';
import { visitCfg } from './visits.js';
import { visitHref, notebookHtml, addNoteFaces, demoVisits } from './visitlink.js';
import { loadVisits, homeOf } from './homedata.js';

export async function renderVisitCards(el, { W, D, H }) {
  if (!el || !W.villager) return;
  const v = W.villager, demo = W.mode === 'demo', C = visitCfg(D.config), day = D.state.day;
  const byKey = Object.fromEntries(D.villagers.map((x) => [x.key, x]));
  const myHome = (D.life[v.key] || {}).home;
  // 行ける家（家に住んでいる人。自分の家の人は除く）。仲のいい人を先に
  const rel = ((D.social.view || {})[v.key] || []).map((r) => r.other);
  const canGo = D.active.filter((x) => x.key !== v.key && !x.gone && homeOf(x, D).real && (D.life[x.key] || {}).home !== myHome);
  const friends = rel.map((k) => canGo.find((x) => x.key === k)).filter(Boolean).slice(0, 6);
  const rest = canGo.filter((x) => !friends.includes(x)).sort((a, b) => a.display.localeCompare(b.display, 'ja'));
  let left = C.perDay;
  if (demo) left = Math.max(0, C.perDay - demoVisits(day).length);
  else { try { left = (await api(D.config, '/visit/state')).left; } catch (e) { /* つながらない時は数だけ出さない */ left = null; } }
  const notes = H.real ? (await loadVisits()).notes.filter((n) => n.home === H.b.id) : [];
  const row = (x) => `<li data-k="${esc(x.key)}"><span class="lface"></span><b>${esc(x.display)}</b><a class="btn sub vgo" href="${visitHref(W, x.key)}">${icon('footprints', { size: 16 })}<span>遊びに行く</span></a></li>`;
  el.innerHTML = `<section class="card mecard visitcard"><h2 class="me-h">${icon('footprints', { size: 20 })}<span>遊びに行く</span>${left != null ? `<span class="muted vleft">きょうはあと ${left} 回</span>` : ''}</h2>` +
    '<p class="muted hnote">自分の村人が町を歩いて相手の家まで行き、中を見て回れます。帰る時に「来た人ノート」へ一言残せます。</p>' +
    (friends.length ? `<h3 class="hh3">仲のいい人の家</h3><ul class="vlist">${friends.map(row).join('')}</ul>` : '') +
    (rest.length ? `<div class="vpick"><select id="vsel" aria-label="遊びに行く家">${rest.map((x) => `<option value="${esc(x.key)}">${esc(x.display)}さんの家</option>`).join('')}</select><a class="btn sub" id="vselgo" href="${visitHref(W, rest[0].key)}">${icon('footprints', { size: 16 })}<span>行く</span></a></div>` : '') +
    (!friends.length && !rest.length ? '<p class="muted">まだ遊びに行ける家がありません。</p>' : '') + '</section>' +
    `<section class="card mecard visitcard"><h2 class="me-h">${icon('book-open', { size: 20 })}<span>来た人ノート</span></h2>` +
    (H.real ? notebookHtml(notes, byKey, { empty: 'まだだれも来ていません。' }) : '<p class="muted">家ができると、遊びに来た人の一言がここにのります。</p>') + '</section>';
  if (left === 0) for (const a of el.querySelectorAll('.vgo, #vselgo')) { a.removeAttribute('href'); a.classList.add('off'); a.setAttribute('aria-disabled', 'true'); }
  const sel = el.querySelector('#vsel'), go = el.querySelector('#vselgo');
  if (sel && go && left !== 0) sel.onchange = () => { go.href = visitHref(W, sel.value); };
  for (const li of el.querySelectorAll('.vlist li')) { const o = byKey[li.dataset.k]; if (o) faceCanvas(o, 32).then((c) => li.querySelector('.lface').append(c)).catch(() => {}); }
  addNoteFaces(el, byKey);
}
