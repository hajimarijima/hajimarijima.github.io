import { loadAll, nav, esc, KIND, KIND_COLOR, faceCanvas, villagerUrl, showError, emptyNote } from './common.js';

nav('relations.html');

async function main() {
  const D = await loadAll();
  const S = D.social || {};
  const people = D.active.slice();
  const byKey = Object.fromEntries(people.map((v) => [v.key, v]));
  // 同じ家の人がとなりに来るように並べる
  const home = (k) => (D.life[k] && D.life[k].home) || 'zz';
  people.sort((a, b) => (home(a.key) < home(b.key) ? -1 : home(a.key) > home(b.key) ? 1 : a.joinedDay - b.joinedDay));
  const n = people.length;
  if (!n) { const m = document.querySelector('.relmap'); if (m) m.outerHTML = emptyNote(D.config); document.getElementById('detail').hidden = true; document.getElementById('events').innerHTML = '<li class="muted">まだありません。</li>'; return; }
  const pos = {};
  people.forEach((v, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 0.30 : 0.42; // 内と外に交互に置いて、名前がぶつからないように
    pos[v.key] = { x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r };
  });
  const edges = (S.edges || []).filter((e) => byKey[e.a] && byKey[e.b]);
  const svg = document.getElementById('lines');
  const map = document.getElementById('map');
  const lineEls = edges.map((e) => {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const p = pos[e.a], q = pos[e.b];
    l.setAttribute('x1', p.x * 1000); l.setAttribute('y1', p.y * 1000); l.setAttribute('x2', q.x * 1000); l.setAttribute('y2', q.y * 1000);
    l.setAttribute('stroke', KIND_COLOR[e.kind]);
    l.setAttribute('stroke-width', 2 + Math.max(0, e.s) / 30);
    if (e.kind === 'rival' || e.kind === 'crush') l.setAttribute('stroke-dasharray', '14 9');
    l.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(l);
    return { e, l };
  });
  const nodes = {};
  for (const v of people) {
    const d = document.createElement('button');
    d.type = 'button'; d.className = 'node';
    d.style.left = pos[v.key].x * 100 + '%'; d.style.top = pos[v.key].y * 100 + '%';
    d.innerHTML = `<span class="f"></span><span class="nm">${esc(v.display)}</span>`;
    faceCanvas(v, 32).then((c) => d.querySelector('.f').append(c));
    d.addEventListener('click', () => select(v.key));
    map.append(d); nodes[v.key] = d;
  }
  // 線が多すぎないように、最初は「友だち」の線を隠す（凡例を押すと出し入れできる。顔を押すとその人の線は全部出る）
  const shown = new Set(['family', 'best', 'rival', 'crush']);
  const legend = document.getElementById('legend');
  legend.innerHTML = Object.entries(KIND).filter(([k]) => k !== 'known').map(([k, t]) => `<button type="button" class="lg" data-k="${k}" aria-pressed="${shown.has(k)}"><i style="background:${KIND_COLOR[k]}"></i>${t}<small>${edges.filter((e) => e.kind === k).length}</small></button>`).join('') + '<span class="muted">押すと線を出し入れ</span>';
  legend.addEventListener('click', (ev) => { const b = ev.target.closest('.lg'); if (!b) return; const k = b.dataset.k; if (shown.has(k)) shown.delete(k); else shown.add(k); b.setAttribute('aria-pressed', shown.has(k)); paint(); });
  function paint() {
    for (const { e, l } of lineEls) {
      const touch = cur && (e.a === cur || e.b === cur);
      l.style.display = (cur ? touch : shown.has(e.kind)) ? '' : 'none';
    }
  }
  const detail = document.getElementById('detail');
  let cur = null;
  function select(k) {
    cur = cur === k ? null : k;
    paint();
    for (const key in nodes) nodes[key].classList.toggle('dim', !!cur && key !== cur && !edges.some((e) => (e.a === cur && e.b === key) || (e.b === cur && e.a === key)));
    if (!cur) { detail.innerHTML = '<p class="muted" style="margin:0">顔を押すと、ここに関係の一覧が出ます。</p>'; return; }
    const v = byKey[cur];
    const rels = ((S.view || {})[cur] || []).filter((r) => byKey[r.other] && r.kind !== 'known');
    detail.innerHTML = `<b><a href="${villagerUrl(v)}">${esc(v.display)}</a></b> の関係` + (rels.length ? '<ul class="rels">' + rels.map((r) => `<li><a href="${villagerUrl(byKey[r.other])}">${esc(byKey[r.other].display)}</a><span class="kind" style="background:${KIND_COLOR[r.kind]}">${KIND[r.kind]}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, r.s))}%;background:${KIND_COLOR[r.kind]}"></i></span></li>`).join('') + '</ul>' : '<p class="muted">まだ親しい人はいません。</p>');
  }
  paint();
  const ev = D.history.filter((h) => h.type === 'social').slice(-12).reverse();
  document.getElementById('events').innerHTML = ev.map((h) => `<li><span class="d">${h.day}日目</span><span>${esc(h.text)}</span></li>`).join('') || '<li>まだありません。</li>';
}
main().catch(showError);
