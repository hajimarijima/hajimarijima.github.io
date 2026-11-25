// 1 日 24 時間の行動（sim.js・サイト・テストで共通。three.js も DOM も使わない）。
//   L.hours は 24 個の行動の記号を、続く同じ記号をまとめた文字列で持つ（"sb*6,e,c:t12*2,..." ＝ ベッドで 6 時間 → 食べる → 木 t12 を 2 時間）。
//   記号：sb ベッドで寝る・st 木にもたれて寝る・sg 地面（床）で寝る・e 食べる・r 休む・k チェストへ運ぶ・cr:道具 作る・
//         c:木 木を切る・u:木 切り株を掘る・d:岩 岩を掘る・f 釣り・h:畑 収穫・ti:畑 耕す・te:畑 世話・gb:草むら 木の実・g 野原で集める・
//         n 動物の世話・w 見張り・l:square|site 整地・
//         （仕事のあとの時間）sp 散歩・tk:村人 おしゃべり・sv 池のそばで海をながめる・wf:畑 畑に水をやる・pt 柵の動物をなでる・hk:村人 荷物運びを手伝う
export const CODE_ACTION = { sb: 'sleep', st: 'sleep', sg: 'sleep', e: 'eat', r: 'rest', k: 'carry', cr: 'craft', c: 'chop', u: 'stump', d: 'dig', f: 'fish', h: 'harvest', ti: 'till', te: 'tend', gb: 'berry', g: 'forage', n: 'ranch', w: 'guard', l: 'level', sp: 'walk', tk: 'chat', sv: 'view', wf: 'water', pt: 'pet', hk: 'help' };
export const ACTION_CODE = { chop: 'c', stump: 'u', dig: 'd', fish: 'f', harvest: 'h', till: 'ti', tend: 'te', berry: 'gb', forage: 'g', ranch: 'n', guard: 'w', level: 'l', eat: 'e', rest: 'r', carry: 'k', craft: 'cr', walk: 'sp', chat: 'tk', view: 'sv', water: 'wf', pet: 'pt', help: 'hk' };
export const SLEEP_PLACE = { sb: 'bed', st: 'tree', sg: 'ground' };
// 画面に出す言葉（今していること）
export const ACTION_JA = { sleep: '寝ている', eat: 'ごはんを食べている', rest: '休んでいる', carry: 'チェストへ運んでいる', craft: '道具を作っている', chop: '木を切っている', stump: '切り株を掘っている', dig: '岩を掘っている', fish: '池で釣りをしている', harvest: '畑で収穫している', till: '畑を耕している', tend: '畑の世話をしている', berry: '木の実を集めている', forage: '草や実を集めている', ranch: '柵の動物の世話をしている', guard: '見張りをしている', level: '整地している', walk: '村のまわりを散歩している', chat: 'おしゃべりしている', view: '池のそばで海をながめている', water: '畑に水をやっている', pet: '柵の動物をなでている', help: '荷物運びを手伝っている' };
export const PLACE_JA = { bed: 'ベッドで', tree: '木にもたれて', ground: '地面で' };
export function hourText(x) {
  if (!x || !x.action) return '';
  if (x.action === 'sleep') return (PLACE_JA[x.place] || '') + '寝ている';
  if (x.action === 'craft' && x.target === 'bed') return 'ベッドを作っている';
  return ACTION_JA[x.action] || '';
}
// 仕事のあとの時間（とれる物はない）
export const FREE = new Set(['walk', 'chat', 'view', 'water', 'pet', 'help']);
export const WORK = new Set(['chop', 'stump', 'dig', 'fish', 'harvest', 'till', 'tend', 'berry', 'forage', 'ranch', 'guard', 'level']);

// 24 個 → まとめた文字列
export function encodeHours(arr) {
  const out = [];
  for (let i = 0; i < arr.length;) {
    let j = i + 1;
    while (j < arr.length && arr[j] === arr[i]) j++;
    out.push(j - i > 1 ? arr[i] + '*' + (j - i) : arr[i]);
    i = j;
  }
  return out.join(',');
}
// まとめた文字列 → 24 個（古いデータで無い時は空の配列）
export function decodeHours(s) {
  if (Array.isArray(s)) return s;
  if (!s) return [];
  const out = [];
  for (const part of String(s).split(',')) {
    const m = /^(.*)\*(\d+)$/.exec(part);
    const code = m ? m[1] : part, n = m ? Number(m[2]) : 1;
    for (let k = 0; k < n; k++) out.push(code);
  }
  return out;
}
// 記号 1 つ → { code, action, target, place }
export function parseCode(c) {
  if (!c) return { code: '', action: null, target: null, place: null };
  const i = c.indexOf(':');
  const code = i >= 0 ? c.slice(0, i) : c, target = i >= 0 ? c.slice(i + 1) : null;
  return { code, action: CODE_ACTION[code] || null, target, place: SLEEP_PLACE[code] || null };
}
// L と時刻（0〜23）から、その時間の行動
export function hourOf(L, h) {
  const arr = decodeHours(L && L.hours);
  if (!arr.length) return null;
  return parseCode(arr[((Math.floor(h) % 24) + 24) % 24]);
}

// ---------- 数の決まり（data/config.json の "hours"） ----------
// 道具の 1 時間の力（素手 < 木 < 石 < 鉄）。夜の外仕事は、たいまつがなければ遅い
export function powerOf(tier, H, { night = false, outdoor = false, torch = false } = {}) {
  const p = (H.power && (H.power[tier] ?? H.power.hand)) || 1;
  return night && outdoor && !torch ? p * H.nightSlow : p;
}
// 何人かで同じ木・岩をたたく：力を足す。仕事の量（need）に届いたら終わり。
// work = これまでの量、who = [{ key, pow }]。戻り値 { work, done, share: { key: 割合 } }
export function addWork(work, need, who) {
  const sum = who.reduce((a, w) => a + w.pow, 0);
  const total = (work || 0) + sum;
  const share = {};
  for (const w of who) share[w.key] = sum ? w.pow / sum : 0;
  return { work: total >= need - 1e-9 ? need : +total.toFixed(2), done: total >= need - 1e-9, share };
}
// 仕事が終わるまでの時間（1 時間ごとに力を足す）。テストと説明用
export function hoursToFinish(need, pows) {
  let w = 0, h = 0;
  while (w < need - 1e-9 && h < 999) { w += pows.reduce((a, b) => a + b, 0); h++; }
  return h;
}
// 寝る場所ごとの 1 時間の戻り（ベッドは早く戻る）
export function sleepGain(place, H) {
  return { sleepy: H.sleepDrop[place] ?? H.sleepDrop.ground, stamina: H.sleepStamina[place] ?? H.sleepStamina.ground, hp: H.sleepHp[place] ?? H.sleepHp.ground };
}
// その時刻が夜か（night: [始まり, 終わり] 例 [20, 5] → 20 時〜4 時台）
export function isNight(h, H) { const [a, b] = H.night; return a > b ? h >= a || h < b : h >= a && h < b; }
