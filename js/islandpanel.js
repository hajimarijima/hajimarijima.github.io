// 町の画面の下のパネル（せつめい・物語・年表・島のいま）と、上のカードの文字
// 年表は config.episodes（動画の話ごと）。空なら history を日ごとにまとめて自動で作る（このファイルの作る関数は DOM を使わないのでテストでも使える）
import { esc, mdText } from './common.js';
import { tagName } from './search.js';

// 島の一言（上のカードの橙の小さな文字）。config.tagline が無ければ ''
export const taglineOf = (config) => String((config && config.tagline) || '').trim();

// 行の先頭の絵文字を分ける：「🏠 住人21人に」→ { icon: '🏠', text: '住人21人に' }
const EMO = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;
export function splitIcon(line) {
  if (line && typeof line === 'object') return { icon: String(line.icon || '•'), text: String(line.text || '') };
  const s = String(line ?? '').trim();
  const m = s.match(EMO);
  return m ? { icon: m[1], text: s.slice(m[0].length) } : { icon: '•', text: s };
}

// 歴史の 1 行の印
export function iconOf(h) {
  const t = h.type || '', x = h.text || '';
  if (t === 'start') return '🌱';
  if (t === 'join') return '🏠';
  if (t === 'title') return '👑';
  if (t === 'vote_open' || t === 'vote_result' || /投票/.test(x)) return '🗳';
  if (t === 'level') return '⭐';
  if (/誕生日/.test(x)) return '🎂';
  if (/釣/.test(x)) return '🎣';
  if (/できた|建った|完成/.test(x)) return '🔨';
  if (/橋/.test(x)) return '🌉';
  if (/夜|モンスター|ゾンビ|敵/.test(x)) return '🌙';
  return '📌';
}

const shortMd = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '');

// 年表の話の一覧（古い順）。{ no, date, title, icon, pop, lines: [{ icon, text, who: [key] }] }
export function buildEpisodes(config, history, villagers) {
  const eps = (config && Array.isArray(config.episodes)) ? config.episodes : [];
  if (eps.length) {
    return eps.map((e, i) => ({
      no: e.no ?? i + 1, date: e.date || '', title: e.title || '', icon: e.icon || '🎬',
      pop: e.pop ?? null, url: e.url || '',
      lines: (e.lines || []).map((l) => ({ ...splitIcon(l), who: [] })),
    }));
  }
  const V = villagers || [];
  const byDay = new Map();
  for (const h of history || []) {
    const d = h.day ?? 0;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(h);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  return days.map((d, i) => {
    const hs = byDay.get(d);
    const lines = [];
    const joins = hs.filter((h) => h.type === 'join').flatMap((h) => h.who || []);
    let joinAt = -1;
    for (const h of hs) {
      if (h.type === 'join') {
        if (joinAt < 0) { joinAt = lines.length; lines.push({ icon: '🏠', text: '', who: [] }); }
        continue;
      }
      lines.push({ icon: iconOf(h), text: h.text || '', who: h.who || [] });
    }
    if (joinAt >= 0) Object.assign(lines[joinAt], { text: `${joins.length}人が島に住みはじめた`, who: joins, join: true });
    const has = (t) => hs.some((h) => h.type === t);
    const res = hs.find((h) => h.type === 'vote_result');
    const title = has('start') ? '島のはじまり' : res ? '投票で決まった日' : joins.length ? `${joins.length}人が引っこしてきた` : `${d}日目の島`;
    const icon = has('start') ? '🌱' : res ? '🗳' : joins.length ? '🏠' : '📅';
    const pop = V.filter((v) => (v.joinedDay ?? 0) <= d).length;
    return { no: i + 1, date: shortMd(hs[0].date), day: d, title, icon, pop, lines };
  });
}

// 村人の丸いチップ（押すとその人の所へ飛ぶ）
const chip = (v) => `<button type="button" class="vchip" data-key="${esc(v.key)}">${esc(tagName(v))}</button>`;
const chipByName = (name, V) => {
  const n = name.toLowerCase();
  const v = V.find((x) => !x.hidden && String(x.name || '').toLowerCase() === n);
  return v ? chip(v) : `<span class="vchip off">@${esc(name)}</span>`;
};
// 行の文：書いてある @名前 と、出てくる村人の名前をチップにする
function lineHtml(l, V) {
  const who = (l.who || []).map((k) => V.find((v) => v.key === k)).filter(Boolean);
  if (l.join) {
    const show = who.slice(0, 6);
    return esc(l.text) + (show.length ? ' ' + show.map(chip).join('') + (who.length > show.length ? `<span class="muted"> ほか${who.length - show.length}人</span>` : '') : '');
  }
  let s = esc(l.text);
  for (const v of who) {
    const nm = esc(v.display || '');
    if (nm && s.includes(nm)) s = s.split(nm).join(chip(v));
  }
  return s.replace(/@([A-Za-z0-9._]{1,30})/g, (_, n) => chipByName(n, V));
}

export function timelineHtml(config, history, villagers) {
  const eps = buildEpisodes(config, history, villagers);
  if (!eps.length) return '<p class="muted">まだ年表はありません。</p>';
  const V = villagers || [];
  return '<ol class="tl">' + eps.map((e) => `<li class="tl-ep"><span class="tl-ic" aria-hidden="true">${esc(e.icon)}</span><div class="tl-body">` +
    `<div class="tl-no">第${esc(e.no)}話${e.date ? ` <span>${esc(e.date)}</span>` : ''}</div>` +
    `<div class="tl-title">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div>` +
    (e.pop != null ? `<div class="tl-pop">● 住民 ${esc(e.pop)}人</div>` : '') +
    (e.lines.length ? '<ul class="tl-lines">' + e.lines.map((l) => `<li><span class="li-ic" aria-hidden="true">${esc(l.icon)}</span><span>${lineHtml(l, V)}</span></li>`).join('') + '</ul>' : '') +
    '</div></li>').join('') + '</ol>';
}

// 物語：歴史を日ごとの読み物に（新しい日を上に。古い日は歴史のページで）
export function storyHtml(history, villagers, { maxDays = 14 } = {}) {
  const V = villagers || [];
  const byDay = new Map();
  for (const h of history || []) { const d = h.day ?? 0; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(h); }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  if (!days.length) return '<p class="muted">まだ物語はありません。</p>';
  const out = days.slice(0, maxDays).map((d) => {
    const hs = byDay.get(d);
    const date = hs[0].date ? mdText(hs[0].date.slice(5)) : '';
    return `<article class="story-day"><h3>${d}日目 <span class="muted">${esc(date)}</span></h3>` +
      hs.map((h) => `<p><span class="li-ic" aria-hidden="true">${iconOf(h)}</span><span class="st-txt">${h.time ? `<span class="muted">${esc(h.time)}</span> ` : ''}${lineHtml({ text: h.text || '', who: h.who || [] }, V)}</span></p>`).join('') + '</article>';
  }).join('');
  return out + `<p class="more"><a href="history.html">歴史をぜんぶ読む</a></p>`;
}

// コメントの書き方の例
export function howCommentHtml(config) {
  const w = (config && config.joinWord) || '住みたい';
  const job = !(config && config.jobChange && config.jobChange.enabled === false);
  const rows = [
    ['💬', `「${w}」`, '町に住む（フォローしてから）'],
    ['🧰', `「${w} ピッケル 12/11 りんご」`, '最初の道具・誕生日・好きな食べ物もいっしょに'],
    ['🎂', '「誕生日 12/11」', 'あとから誕生日を変える'],
    ...(job ? [['🎣', '「仕事 釣り」', '仕事を変える（1 日の回数に決まりあり）']] : []),
    ['🗳', '「A」「B」', '投票の投稿に書くと 1 票'],
  ];
  return rows.map(([i, c, t]) => `<li><span class="hi">${i}</span><span><b class="cmt">${esc(c)}</b> ${esc(t)}</span></li>`).join('');
}

// 島の建物（種類ごとの数）
export function buildingsText(world, config) {
  const n = {};
  for (const b of (world && world.buildings) || []) n[b.type] = (n[b.type] || 0) + 1;
  const parts = Object.entries(n).map(([t, c]) => `${((config.buildings || {})[t] || {}).name || t}${c > 1 ? ' ×' + c : ''}`);
  return parts.length ? parts.join('・') : 'まだ建物はありません（みんなテントでくらしています）';
}

// タブの切りかえ（選んだタブはこのブラウザに覚えておく）
export function setupTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const show = (name, focus) => {
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const p = document.getElementById('tab-' + t.dataset.tab);
      if (p) p.hidden = !on;
      if (on && focus) t.focus();
    }
    try { localStorage.setItem('town.tab', name); } catch (e) { /* 覚えられなくてもよい */ }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true); }
    });
  });
  let first = new URLSearchParams(location.search).get('tab');
  if (!first) { try { first = localStorage.getItem('town.tab'); } catch (e) { first = null; } }
  show(tabs.some((t) => t.dataset.tab === first) ? first : tabs[0].dataset.tab);
  return show;
}
