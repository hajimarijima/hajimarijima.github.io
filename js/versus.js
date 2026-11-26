// 一週間の対決投票（A vs B の 2 択。config.json の versus）。js/town.js・vote.html・badges.html・tools/versus.js・テストで共通（three は使わない）。
//   ・お題は config.versus.topics に並べる。前のお題が締め切られたら、次のお題（投稿の URL を貼ったもの）が始まる。
//   ・投稿の URL（postUrl）が空のうちは始まっていない扱い（帯も出さず、コメントも数えない）。
//   ・票の数え直しと締め切り・ごほうびは tools/versus.js（15 分ごとの受付 join.js）。ここは読み取りと表示だけ。
//   ・画面の決まった文言には、お題の言葉（商品名など）を入れない。お題・A と B の名前は config から出す。

const norm = (s) => String(s ?? '').normalize('NFKC').trim();
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SIDES = ['A', 'B'];
export const DEFAULT_COLORS = { A: '#d64541', B: '#3f78b8' };
const IG = /^https:\/\/(www\.)?instagram\.com\//;

// config.versus（enabled が false か、無い時は null）
export const versusCfg = (config) => (config && config.versus && config.versus.enabled !== false ? config.versus : null);
// お題の id（英数字と _。書いていなければ t1, t2…）
export const topicId = (t, i) => (t && /^[a-z0-9_]+$/.test(String(t.id || '')) ? String(t.id) : 't' + (i + 1));
// お題の一覧（id・A/B の名前・色・言葉・日数をそろえた形）
export function topicList(config) {
  const VC = versusCfg(config);
  if (!VC || !Array.isArray(VC.topics)) return [];
  const col = { ...DEFAULT_COLORS, ...(VC.colors || {}) };
  return VC.topics.map((t, i) => {
    if (!t || !t.A || !t.B) return null;
    const side = (k) => {
      const s = t[k] || {};
      const name = norm(s.name) || k;
      return { key: k, name, words: [name, ...(Array.isArray(s.words) ? s.words : [])].map(norm).filter(Boolean), color: s.color || col[k], title: norm(s.title) || `${name}の勝者` };
    };
    return { id: topicId(t, i), index: i, question: norm(t.question) || `${norm(t.A.name)} と ${norm(t.B.name)}、どっち？`, A: side('A'), B: side('B'), start: t.start || null, days: Number(t.days) > 0 ? Number(t.days) : (Number(VC.days) > 0 ? Number(VC.days) : 7), postUrl: String(t.postUrl || '').trim() };
  }).filter(Boolean);
}
export const topicById = (config, id) => topicList(config).find((t) => t.id === id) || null;
export const postReady = (url) => /instagram\.com\//.test(String(url || ''));

// コメントから A / B を読む。「A」「ａ」「B派」や、名前・言葉（config の words）でも。両方書いてあれば数えない（null）。
// 長い言葉から先に見て、見つけた所は消す（短い言葉が長い言葉の一部の時に、両方に数えないように）
export function pickOf(text, topic) {
  let t = norm(text).toUpperCase();
  if (!t || !topic) return null;
  const found = new Set();
  const words = SIDES.flatMap((k) => topic[k].words.map((w) => ({ k, w: norm(w).toUpperCase() }))).filter((x) => x.w).sort((a, b) => b.w.length - a.w.length);
  for (const { k, w } of words) if (t.includes(w)) { found.add(k); t = t.split(w).join(' '); }
  const re = /(^|[^A-Z])([AB])(?=[^A-Z]|$)/g;
  let m;
  while ((m = re.exec(t))) { found.add(m[2]); re.lastIndex = m.index + m[0].length; }
  return found.size === 1 ? [...found][0] : null;
}

// 割合（合わせて 100。票がない時は 50 / 50 の灰色）
export function shares(votes) {
  const a = (votes && votes.A) || 0, b = (votes && votes.B) || 0, n = a + b;
  if (!n) return { A: 50, B: 50, total: 0 };
  const pa = Math.round((a / n) * 1000) / 10;
  return { A: pa, B: Math.round((100 - pa) * 10) / 10, total: n };
}

// 称号：お題ごとに、A が勝った時・B が勝った時の 2 つ（id は vs_<お題の id>_a / _b）。config.titles.list とならべて使う
export const titleId = (topic, k) => `vs_${topic.id}_${String(k).toLowerCase()}`;
export function versusTitles(config) {
  const VC = versusCfg(config);
  if (!VC) return [];
  return topicList(config).flatMap((t) => SIDES.map((k) => ({
    id: titleId(t, k), name: t[k].title, desc: `対決「${t.question}」で${t[k].name}が勝った時に、${t[k].name}に投票した住人`,
    how: `対決投票「${t.question}」で${t[k].name}に投票して、勝つ`, icon: VC.titleIcon || '勝', img: '', versus: t.id,
  })));
}

// 残りの時間の文（「あと 3 日」「あと 5 時間」「締め切りました」）
export function leftText(closesAt, now = Date.now()) {
  const ms = Date.parse(closesAt) - now;
  if (!(ms > 0)) return '締め切りました';
  if (ms >= 86400e3) return `あと ${Math.ceil(ms / 86400e3)} 日`;
  if (ms >= 3600e3) return `あと ${Math.ceil(ms / 3600e3)} 時間`;
  return `あと ${Math.max(1, Math.ceil(ms / 60e3))} 分`;
}
const jstMd = (iso) => { const d = new Date(Date.parse(iso) + 9 * 3600e3); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}時`; };

// 今出す対決：投票中（current）か、締め切って 1 日以内の結果（done の最後）。どちらもなければ null
export function bandData(state, config, now = Date.now()) {
  if (!versusCfg(config)) return null;
  const V = state && state.versus;
  if (!V) return null;
  const cur = V.current;
  if (cur) {
    const t = topicById(config, cur.id);
    if (t && !postReady(t.postUrl)) return null; // config で URL を消した（始まっていない扱いに戻す）
    return { mode: 'open', v: cur, topic: t, post: (t && t.postUrl) || cur.postUrl || '' };
  }
  const last = (V.done || [])[V.done ? V.done.length - 1 : 0];
  if (last && last.closedAt && now - Date.parse(last.closedAt) < 86400e3) return { mode: 'result', v: last, topic: topicById(config, last.id), post: '' };
  return null;
}

// 赤と青の割合バー（町の地図の上と、投票のページの上）。big：投票のページ用の大きい形
export function bandHtml(state, config, { now = Date.now(), big = false } = {}) {
  const b = bandData(state, config, now);
  return b ? cardHtml(b, { now, big }) : '';
}
// これまでの対決（新しい順）。投票のページの「これまでの投票」の上に出す
export function pastHtml(state, config) {
  const done = ((state && state.versus && state.versus.done) || []).slice().reverse();
  if (!versusCfg(config) || !done.length) return '';
  return '<div class="duelpast">' + done.map((v) => cardHtml({ mode: 'result', v, post: '' }, { big: true, link: false })).join('') + '</div>';
}
function cardHtml(b, { now = Date.now(), big = false, link = true } = {}) {
  const v = b.v, s = shares(v.votes);
  const col = { A: (v.A && v.A.color) || DEFAULT_COLORS.A, B: (v.B && v.B.color) || DEFAULT_COLORS.B };
  const nm = { A: (v.A && v.A.name) || 'A', B: (v.B && v.B.name) || 'B' };
  const n = { A: (v.votes && v.votes.A) || 0, B: (v.votes && v.votes.B) || 0 };
  const seg = (k) => `<i class="duel-seg duel-${k}" style="width:${s[k]}%;background:${escH(col[k])}${s.total ? '' : ';opacity:.45'}"><em>${s.total ? s[k] + '%' : ''}</em></i>`;
  let head, foot;
  if (b.mode === 'open') {
    const closed = Date.parse(v.closesAt) <= now;
    head = `<span class="duel-tag">対決投票</span><span class="duel-q">${escH(v.question)}</span>`;
    foot = `<span class="duel-n" style="color:${escH(col.A)}"><b>${n.A}</b>票</span>` +
      `<span class="duel-left">${closed ? '締め切りました（集計中）' : escH(leftText(v.closesAt, now)) + `<small>（${escH(jstMd(v.closesAt))}まで）</small>`}</span>` +
      `<span class="duel-n" style="color:${escH(col.B)}"><b>${n.B}</b>票</span>`;
  } else {
    const res = v.winner ? `${escH(nm[v.winner])}の勝ち！` : (s.total ? '引き分け' : '票が入りませんでした');
    head = `<span class="duel-tag">対決の結果</span><span class="duel-q">${escH(v.question)} <b class="duel-win">${res}</b></span>`;
    foot = `<span class="duel-n" style="color:${escH(col.A)}"><b>${n.A}</b>票</span><span class="duel-left">${v.rewarded ? `住人 ${v.rewarded} 人にごほうび` : ''}${v.closedAt ? `<small>（${escH(jstMd(v.closedAt))}締め切り）</small>` : ''}</span><span class="duel-n" style="color:${escH(col.B)}"><b>${n.B}</b>票</span>`;
  }
  const names = `<span class="duel-names"><b style="color:${escH(col.A)}">${escH(nm.A)}</b><span class="duel-vs">VS</span><b style="color:${escH(col.B)}">${escH(nm.B)}</b></span>`;
  const how = b.mode === 'open' && Date.parse(v.closesAt) > now ? `<span class="duel-how">インスタの投稿に「${escH(nm.A)}」か「${escH(nm.B)}」とコメントして投票（1 人 1 票）</span>` : '';
  const inner = `<span class="duel-head">${head}</span>${names}<span class="duel-bar" role="img" aria-label="${escH(`${nm.A} ${n.A}票（${s.A}%）、${nm.B} ${n.B}票（${s.B}%）`)}">${seg('A')}${seg('B')}</span><span class="duel-foot">${foot}</span>${how}`;
  const cls = 'duel' + (big ? ' duel-big' : '') + (b.mode === 'result' ? ' duel-done' : '');
  const href = b.post && IG.test(b.post) ? b.post : '';
  return href && link ? `<a class="${cls}" href="${escH(href)}" target="_blank" rel="noopener">${inner}</a>`
    : big || !link ? `<div class="${cls}">${inner}</div>` : `<a class="${cls}" href="vote.html#duel">${inner}</a>`;
}
