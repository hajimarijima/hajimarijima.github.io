// 町の画面の下のパネル（せつめい・年表・島のいま）と、上のカードの文字。年表は前の「物語」と「歴史」をまとめたもの（history.html も同じ中身）
// 年表は config.episodes（動画の話ごと）。空なら history を日ごとにまとめて自動で作る（このファイルの作る関数は DOM を使わないのでテストでも使える）
import { esc, mdText, buildingLabel } from './common.js';
import { tagName } from './search.js';
import { icon, ICONS } from './icons.js';

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

// 歴史の 1 行の印（js/icons.js の線のアイコンの名前）。種類（type）→ 文の言葉 の順に決める
export function iconOf(h) {
  const t = h.type || '', x = h.text || '';
  if (t === 'start') return 'sprout';
  if (t === 'join') return 'user-plus';
  if (t === 'title') return 'crown';
  if (t === 'badge') return 'award';
  if (t.startsWith('vote') || t === 'base' || /投票/.test(x)) return 'vote';
  if (t === 'birthday' || /誕生日/.test(x)) return 'cake';
  if (t === 'night' || /夜|モンスター|ゾンビ|敵/.test(x)) return 'moon';
  if (/フォロワー/.test(x)) return 'users';
  if (/サメ/.test(x)) return 'shark';
  if (t === 'fish' || /釣/.test(x)) return 'fish';
  if (t === 'social') return h.kind === 'family' ? 'users' : 'heart';
  if (t === 'visit') return 'house'; // 仲の良い人の家へ遊びに行った（tools/visit.js）
  if (t === 'level') return 'shovel';
  if (t === 'craft') return 'pickaxe';
  if (t === 'find') return 'gem';
  if (t === 'first') return 'flag';
  if (/橋/.test(x)) return 'bridge';
  if (/動物|柵|狩|肉|子が生まれ/.test(x)) return 'paw-print';
  if (/食べ物/.test(x)) return 'apple';
  if (/チェスト/.test(x)) return 'package';
  if (t.startsWith('build') || /できた|建った|完成|建て/.test(x)) return /家/.test(x) ? 'house' : 'hammer';
  return 'map-pin';
}

// config.episodes の行の先頭の絵文字 → 線のアイコン（知らない絵文字はそのまま出す）
const EMO_ICON = {
  '🌱': 'sprout', '🏠': 'house', '🏡': 'house', '👑': 'crown', '🗳': 'vote', '🎂': 'cake', '🎣': 'fish', '🐟': 'fish',
  '🔨': 'hammer', '🌉': 'bridge', '🌙': 'moon', '⭐': 'award', '🏅': 'award', '🎁': 'gift', '❤': 'heart', '💕': 'heart',
  '🐖': 'paw-print', '🐷': 'paw-print', '🐄': 'paw-print', '🐔': 'paw-print', '🐑': 'paw-print', '🦈': 'shark', '🌊': 'waves',
  '⛺': 'tent', '⛏': 'pickaxe', '⚔': 'swords', '🚩': 'flag', '📌': 'map-pin', '📅': 'calendar-days', '🎬': 'book-open',
  '🍎': 'apple', '📦': 'package', '💎': 'gem', '👥': 'users', '🙋': 'user-plus', '☀': 'sun', '•': 'dot',
};
// 印を HTML に：アイコンの名前か、知っている絵文字なら線のアイコン。ほかは文字のまま
export const iconName = (x) => { const s = String(x || ''); return ICONS[s] ? s : EMO_ICON[s.replace(/️/g, '')] || ''; };
const ic = (x, size = 18) => { const n = iconName(x); return n ? icon(n, { size }) : esc(x); };

const shortMd = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '');

// 年表の話の一覧（古い順）。{ no, date, title, icon, pop, lines: [{ icon, text, who: [key] }] }
export function buildEpisodes(config, history, villagers) {
  const eps = (config && Array.isArray(config.episodes)) ? config.episodes : [];
  if (eps.length) {
    return eps.map((e, i) => ({
      no: e.no ?? i + 1, date: e.date || '', title: e.title || '', icon: e.icon || 'book-open',
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
    const src = new Map(); // 行 → もとの歴史
    for (const h of hs) {
      if (h.type === 'join') {
        if (joinAt < 0) { joinAt = lines.length; lines.push({ icon: 'user-plus', text: '', who: [] }); }
        continue;
      }
      const l = { icon: iconOf(h), text: h.text || '', who: h.who || [] };
      src.set(l, h); lines.push(l);
    }
    if (joinAt >= 0) Object.assign(lines[joinAt], { text: `${joins.length}人が島に住みはじめた`, who: joins, join: true });
    // 話の題：始まり → 建物ができた → 投票で決まった → 引っこし → 夜 の順。題にした行は、閉じた時のおもな出来事には出さない（titleLine。同じことを 2 回書かない）
    const find = (t) => lines.find((l) => src.has(l) && src.get(l).type === t);
    const built = find('build'), res = find('vote_result'), night = find('night');
    let title, icon, titleLine = -1;
    if (hs.some((h) => h.type === 'start')) { title = '島のはじまり'; icon = 'sprout'; }
    else if (built) { title = built.text.replace(/[！!。\s]+$/, ''); icon = iconOf(src.get(built)); titleLine = lines.indexOf(built); }
    else if (res) { const m = res.text.match(/「([^」]+)」に決まった/); title = m ? `${m[1].replace(/^[A-Z]\s+/, '')}に決まった` : '投票で決まった日'; icon = 'vote'; if (m) titleLine = lines.indexOf(res); }
    else if (joins.length) { title = `${joins.length}人が引っこしてきた`; icon = 'user-plus'; titleLine = joinAt; }
    else if (night) { title = `${d}日目の夜`; icon = 'moon'; }
    else { title = `${d}日目の島`; icon = 'calendar-days'; }
    const pop = V.filter((v) => (v.joinedDay ?? 0) <= d).length;
    return { no: i + 1, date: shortMd(hs[0].date), day: d, title, icon, pop, lines, titleLine };
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
    return esc(l.text) + (show.length ? ' ' + show.map(chip).join('') + (who.length > show.length ? ` <span class="muted nb">ほか${who.length - show.length}人</span>` : '') : '');
  }
  // 文を「ただの文字」と「チップ」に分けながら置きかえる（チップの中の @名前 をもう一度チップにして、ボタンが入れ子になるのを防ぐ）
  let parts = [esc(l.text)];
  const sub = (re, fn) => { parts = parts.flatMap((p) => (typeof p !== 'string' ? [p] : p.split(re).map((x, i) => (i % 2 ? { h: fn(x) } : x)))); };
  sub(/(@[A-Za-z0-9._]{1,30})/, (x) => chipByName(x.slice(1), V));
  for (const v of who) {
    const nm = esc(v.display || '');
    if (nm) sub(new RegExp('(' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')'), () => chip(v));
  }
  // チップのすぐ後の「、」「。」などは、チップと離れないまとまりにする（「、」が行の先頭に来ないように）
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (typeof p === 'string') { out += p; continue; }
    const nx = parts[i + 1], m = typeof nx === 'string' ? nx.match(/^[、。，,．.）)」』！!？?・]+/) : null;
    if (m) { out += `<span class="nb">${p.h}${m[0]}</span>`; parts[i + 1] = nx.slice(m[0].length); } else out += p.h;
  }
  return out;
}

// 年表の絞り込み（歴史の種類）。前の歴史のページと同じ分け方
export const HIST_KINDS = [['all', 'すべて'], ['build', '建物'], ['vote', '投票'], ['join', '村人'], ['social', '関係・誕生日'], ['night', '夜'], ['event', 'そのほか']];
export function histKind(h) {
  const t = (h && h.type) || '';
  if (t.startsWith('vote')) return 'vote';
  if (t === 'social' || t === 'birthday' || t === 'visit') return 'social';
  if (t === 'build' || t === 'join' || t === 'night') return t;
  return 'event';
}
// 画面に出す歴史：拠点の投票は、投票の投稿の URL を貼るまで始まっていない（baseVote.needPost）ので「投票が始まった」の行は出さない
export function visibleHistory(history, config) {
  const cfg = config || {};
  const hide = (cfg.baseVote || {}).needPost && !/instagram\.com\//.test(String(cfg.votePostUrl || ''));
  return (history || []).filter((h) => !(hide && h.kind === 'base' && h.type === 'vote_open'));
}

// 年表（物語・歴史をまとめたもの）。新しい話を上に。閉じた時は話の題・住民数・おもな出来事（3 行まで）、
// 押して開くと、その日のできごと（歴史の行）を時刻つきで全部出す（開いた時はおもな出来事の行をかくすので、同じ文は 2 回出ない）。
// 上の小さなチップで絞り込む（setupChronicle）
export function timelineHtml(config, history, villagers) {
  const H = visibleHistory(history, config);
  const eps = buildEpisodes(config, H, villagers);
  if (!eps.length) return '<p class="muted">まだ年表はありません。</p>';
  const V = villagers || [];
  const byDay = new Map(), byDate = new Map();
  for (const h of H) {
    const d = h.day ?? 0; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(h);
    const md = shortMd(h.date); if (md) { if (!byDate.has(md)) byDate.set(md, []); byDate.get(md).push(h); }
  }
  const evOf = (e) => (e.day != null ? byDay.get(e.day) : byDate.get(e.date)) || [];
  const chips = '<div class="tlf" role="group" aria-label="できごとの絞り込み">' + HIST_KINDS.map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${k === 'all'}">${t}</button>`).join('') + '</div>';
  const items = eps.slice().reverse().map((e) => {
    const ev = evOf(e);
    const kinds = [...new Set(ev.map(histKind))].join(' ');
    const ls = e.lines.filter((l, i) => i !== e.titleLine);
    const head = ls.slice(0, 3), rest = ls.length - head.length;
    return `<li class="tl-ep" data-kinds="${kinds}"><span class="tl-ic" aria-hidden="true">${ic(e.icon, 22)}</span><details class="tl-body"><summary>` +
      `<div class="tl-no">第${esc(e.no)}話${e.date ? ` <span>${esc(e.date)}</span>` : ''}</div>` +
      `<div class="tl-title">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div>` +
      (e.pop != null ? `<div class="tl-pop">● 住民 ${esc(e.pop)}人</div>` : '') +
      (head.length ? '<ul class="tl-lines">' + head.map((l) => `<li><span class="li-ic" aria-hidden="true">${ic(l.icon)}</span><span>${lineHtml(l, V)}</span></li>`).join('') + (rest > 0 ? `<li class="muted tl-rest">ほか ${rest} 件</li>` : '') + '</ul>' : '') +
      (ev.length ? `<span class="tl-open"><span class="tl-o1">その日のできごと ${ev.length} 件を見る</span><span class="tl-o2">とじる</span>${icon('chevron-down', { size: 16 })}</span>` : '') +
      '</summary>' +
      (ev.length ? '<ul class="tl-ev">' + ev.map((h) => `<li data-k="${histKind(h)}"><span class="li-ic" aria-hidden="true">${ic(iconOf(h))}</span><span>${/^\d{1,2}:\d{2}$/.test(h.time || '') ? `<span class="tl-time">${esc(h.time)}</span>` : ''}${lineHtml({ text: h.text || '', who: h.who || [] }, V)}</span></li>`).join('') + '</ul>' : '') +
      '</details></li>';
  }).join('');
  return chips + '<ol class="tl">' + items + '</ol><p class="muted tl-none" hidden>この種類のできごとは、まだありません。</p>';
}

// 年表のチップの絞り込み（root の中の .tlf）。1 回だけつなぐ
export function setupChronicle(root) {
  if (!root || root.dataset.chron) return;
  root.dataset.chron = '1';
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.tlf button'); if (!b) return;
    const k = b.dataset.k, box = b.closest('.tlf').parentElement;
    box.querySelectorAll('.tlf button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    let shown = 0;
    box.querySelectorAll('.tl-ep').forEach((ep) => {
      let n = 0;
      ep.querySelectorAll('.tl-ev li').forEach((li) => { const on = k === 'all' || li.dataset.k === k; li.hidden = !on; if (on) n++; });
      ep.hidden = k !== 'all' && !n;
      const d = ep.querySelector('details'); if (d) d.open = k !== 'all' && n > 0;
      if (!ep.hidden) shown++;
    });
    const none = box.querySelector('.tl-none'); if (none) none.hidden = shown > 0;
  });
}

// 島の建物（建った順）。「〇日目 家 2号」
export function buildOrderHtml(world, config) {
  const bs = ((world && world.buildings) || []).slice().sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
  if (!bs.length) return '<p class="muted">まだ建物はありません（みんなテントでくらしています）。</p>';
  return '<ol class="bldorder">' + bs.map((b) => `<li><span class="muted">${esc(b.day ?? 0)}日目</span> ${esc(buildingLabel(b, world, config))}</li>`).join('') + '</ol>';
}

// 島のいまの「最近のできごと」：年表のいちばん新しい話のおもな出来事（n 行まで）。<li> の並び。無ければ ''
export function latestLinesHtml(config, history, villagers, n = 3) {
  const eps = buildEpisodes(config, visibleHistory(history, config), villagers);
  const e = eps[eps.length - 1]; if (!e) return '';
  const V = villagers || [];
  return e.lines.slice(0, n).map((l) => `<li class="ev-li"><span class="li-ic" aria-hidden="true">${ic(l.icon)}</span><span>${lineHtml(l, V)}</span></li>`).join('');
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
      hs.map((h) => `<p><span class="li-ic" aria-hidden="true">${ic(iconOf(h))}</span><span class="st-txt">${h.time ? `<span class="muted">${esc(h.time)}</span> ` : ''}${lineHtml({ text: h.text || '', who: h.who || [] }, V)}</span></p>`).join('') + '</article>';
  }).join('');
  return out + `<p class="more"><a href="history.html">年表をぜんぶ読む</a></p>`;
}

// コメントの書き方の例
export function howCommentHtml(config) {
  const w = (config && config.joinWord) || '住みたい';
  const job = !(config && config.jobChange && config.jobChange.enabled === false);
  const rows = [ // 印は js/icons.js の線のアイコン
    ['message-circle', `「${w}」`, '町に住む（フォローしてから）'],
    ['backpack', `「${w} ピッケル 12/11 りんご」`, '最初の道具・誕生日・好きな食べ物もいっしょに'],
    ['cake', '「誕生日 12/11」', 'あとから誕生日を変える'],
    ...(job ? [['fish', '「作業 釣り」', '作業を変える（1 日の回数に決まりあり）']] : []),
    ['vote', '「A」「B」', '投票の投稿に書くと 1 票'],
  ];
  return rows.map(([i, c, t]) => `<li><span class="hi">${icon(i, { size: 18 })}</span><span><b class="cmt">${esc(c)}</b> ${esc(t)}</span></li>`).join('');
}

// 島の決まり（せつめいのタブ）。動物と海の決まり（config.hunting・config.sea）
export function islandRulesHtml(config) {
  const rows = [];
  if (!config || !config.hunting || config.hunting.enabled !== false) rows.push(['paw-print', '動物は攻撃すると逃げます。肉を取るには、柵で囲ってから。']);
  if (!config || !config.sea || config.sea.sharks !== 0) rows.push(['shark', '海にはサメがいて、村人は海に入れません（釣りは浜から）。']);
  // 夜の魔物（config.nightFoes）：3 つ目の大きな島だけ。アイコンはまだ無い（空のまま）
  if (!config || !config.nightFoes || config.nightFoes.enabled !== false) rows.push(['', '夜になると、海の向こうの大きな島に魔物が出ます。海とサメがいるので、村には来ません。']);
  return rows.map(([i, t]) => `<li><span class="hi">${i ? icon(i, { size: 18 }) : ''}</span><span>${esc(t)}</span></li>`).join('');
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
  if (first === 'story') first = 'timeline'; // 物語のタブは年表にまとめた
  show(tabs.some((t) => t.dataset.tab === first) ? first : tabs[0].dataset.tab);
  setupChronicle(root);
  // 「年表で見る」（島のいま）：年表のタブにして、いちばん新しい話を開く
  if (!root.dataset.goto) {
    root.dataset.goto = '1';
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-goto="timeline"]'); if (!a) return;
      e.preventDefault(); show('timeline');
      const d = root.querySelector('#tab-timeline .tl-ep:not([hidden]) details'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
  return show;
}
