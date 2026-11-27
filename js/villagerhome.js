// 村人のページ（villager.html）の「家」（飾った家の外と中の 3D）と「手紙」（その人に届いた手紙）。villager.js からは renderVillagerHome を 1 回呼ぶだけ
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { letterHtml, addFaces } from './letterview.js';
import { loadMail, loadDecor, homeOf } from './homedata.js';
import { residentsOf, homeLayoutFor, decorOn } from './decor.js';
import { makeHomeView } from './decor3d.js';

export async function renderVillagerHome(v, D) {
  const byKey = Object.fromEntries(D.villagers.map((x) => [x.key, x]));
  const [mail, decor] = await Promise.all([loadMail(), loadDecor()]);
  // 手紙（届いた分。新しい順に 10 通まで）
  const ms = document.getElementById('mailsec');
  if (ms) {
    const recv = mail.letters.filter((L) => L.to === v.key).reverse().slice(0, 10);
    const ul = document.getElementById('letters');
    ul.innerHTML = recv.length ? recv.map((L) => letterHtml(L, byKey, D.config, { isNew: L.day === D.state.day, report: true })).join('') : '<li class="muted">まだ手紙は届いていません。</li>';
    addFaces(ul, byKey);
    import('./report.js').then((m) => m.bindReports(ul, D.config)).catch(() => {});
    ms.hidden = false;
  }
  // 家（住んでいる家がある時だけ。飾りがなくても郵便受けは見える）
  const hs = document.getElementById('homesec'), H = homeOf(v, D);
  if (!hs || !H.real) return;
  const res = residentsOf(H.b, D.active, D.life), lay = homeLayoutFor(H.b, H.look, res, decor, D.config);
  const flag = mail.letters.some((L) => res.some((x) => x.key === L.to) && L.day === D.state.day);
  hs.hidden = false;
  const n = lay.out.length + lay.in.length;
  document.getElementById('homenote').textContent = !decorOn(D.config) ? 'もとからある家具の家です。家を飾るのは近日公開。' : n ?`飾りが ${n} 個あります。` + (res.length > 1 ? `（${res.map((x) => x.display).join('・')} の家）` : '') : 'まだ飾りはありません。';
  const view = makeHomeView(document.getElementById('homeview'), { look: H.look, b: H.b, controls: OrbitControls });
  const tabs = document.getElementById('hometabs');
  const set = (t) => { for (const b of tabs.querySelectorAll('button')) { b.classList.toggle('on', b.dataset.t === t); b.setAttribute('aria-selected', b.dataset.t === t); } view.show(t, lay, flag); };
  tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) set(b.dataset.t); };
  set('out');
  // 遊びに行く（自分の村人とつながっている時。自分の家・同じ家の人の家には出さない）と、来た人ノート
  const [{ whoami }, VL, { loadVisits }] = await Promise.all([import('./mine.js'), import('./visitlink.js'), import('./homedata.js')]);
  let W = await whoami();
  if (W.mode === 'demo' && W.villager && res.some((x) => x.key === W.villager.key)) { const o = D.active.find((x) => !res.some((y) => y.key === x.key)); W = o ? { ...W, villager: o } : W; } // 見本で自分の家を見ている時は、ほかの人として
  const box = document.createElement('div'); box.className = 'vvisit';
  const notes = (await loadVisits()).notes.filter((n) => n.home === H.b.id);
  const can = W.villager && !res.some((x) => x.key === W.villager.key);
  box.innerHTML = (can ? `<div class="me-btns">${VL.visitBtn(W, v.key, '')}</div>` : '') +
    `<h3 class="hh3">来た人ノート</h3>${VL.notebookHtml(notes, byKey)}`;
  hs.querySelector('.card') ? hs.querySelector('.card').append(box) : hs.append(box);
  VL.addNoteFaces(box, byKey);
}
