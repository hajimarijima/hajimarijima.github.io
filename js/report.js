// 手紙の「通報」（mail.html・村人のページ・自分の村人の郵便受けで共通）。受け口の Worker（/mail/report）に記録する。
//   通報が config.mail.reportHide（js/terms.js の REPORT_HIDE）件たまると、毎日の更新（tools/mail.js）で隠す。運営は tools/mail.js remove で消せる
//   押した人の画面では、その手紙はすぐ見えなくなる（この端末に覚える）
import { whoami, api } from './mine.js';

const KEY = 'town.reported';
function remember(id) { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!a.includes(id)) a.push(id); localStorage.setItem(KEY, JSON.stringify(a.slice(-300))); } catch (e) { /* 覚えられなくてもよい */ } }

export function bindReports(root, config) {
  if (!root || root.dataset.rep) return;
  root.dataset.rep = '1';
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('.lrep'); if (!b) return;
    // 1 回目は「本当に？」、2 回目で送る（まちがえて押しても送らない）
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '通報する？（もう一度押す）'; setTimeout(() => { if (b.isConnected && !b.disabled) { delete b.dataset.sure; b.textContent = '通報'; } }, 4000); return; }
    b.disabled = true; b.textContent = '送っています…';
    const W = await whoami(), li = b.closest('li');
    const done = (t) => { if (li) { li.classList.add('lgone'); li.innerHTML = `<p class="muted">${t}</p>`; } };
    if (!W.villager) { b.textContent = '通報するには、自分の村人とつながってね'; return; }
    if (W.mode === 'demo') { remember(b.dataset.id); done('通報しました（見本なので送っていません）。この手紙は、もう出ません。'); return; }
    try { await api(config, '/mail/report', { id: b.dataset.id }); remember(b.dataset.id); done('通報しました。運営が確かめます。この手紙は、もう出ません。'); }
    catch (err) { b.disabled = false; delete b.dataset.sure; b.textContent = err.code === 'limit' ? 'きょうの通報はおしまいです' : '送れませんでした'; }
  });
}
