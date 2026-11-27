// 村人の持ち物の枠（検索のカードと、くわしいページで共通。DOM は使わず HTML の文字を返す）
// 夜にはチェストへぜんぶ入れるので、L.held（その日の仕事のおわりに持っていた物）があればそれを出す。
// 古いデータで L.held がない時は、今の持ち物（L.inv。ふつうは道具だけ）を出す。

// 持ち物の枠に出す中身と、その説明
export function heldOf(L) {
  if (L && Array.isArray(L.held)) return { list: L.held, label: 'きのうの作業のおわりに持っていた物（夜にチェストへ入れる前）' };
  return { list: (L && L.inv) || [], label: '今の持ち物（集めた物は夜にチェストへ入れたあと）' };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 耐久の色（多い 緑・半分より下 黄・少ない 赤）
const durColor = (k) => (k > 0.5 ? '#4ec04e' : k > 0.2 ? '#e0c040' : '#d84a3a');

// 1 つの枠の中身 → { html, tip }
export function slotCell(s, items) {
  if (!s) return { html: '', tip: 'あき', empty: true };
  const it = items[s.item] || { name: s.item };
  const tool = s.dur !== undefined && s.max;
  const html = `<img class="pixel" src="icons/${esc(s.item)}.png" alt="" onerror="this.style.visibility='hidden'">` +
    (s.n > 1 ? `<span class="n">${s.n}</span>` : '') +
    (tool ? `<span class="dur"><i style="width:${Math.max(0, Math.min(100, (s.dur / s.max) * 100))}%;background:${durColor(s.dur / s.max)}"></i></span>` : '');
  const tip = it.name + (s.n > 1 ? ` ${s.n} 個` : '') + (tool ? `（耐久 ${s.dur}/${s.max}）` : '');
  return { html, tip, empty: false };
}

// 検索のカード用の小さな枠（開いている枠だけ。あいた枠は空っぽに見える）
export function slotsHtml(L, config) {
  const IC = config.inventory || {}, items = config.items || {};
  const n = (L && L.slots) || IC.base || 3;
  const { list } = heldOf(L);
  let h = '<div class="islots">';
  for (let i = 0; i < n; i++) {
    const c = slotCell(list[i], items);
    h += `<span class="islot${c.empty ? ' vacant' : ''}" title="${esc(c.tip)}" aria-label="${esc((i + 1) + ' 番：' + c.tip)}">${c.html}</span>`;
  }
  return h + '</div>';
}
