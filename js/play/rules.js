// 遊びのページ（play.html）の決まり。three.js も DOM も使わない（テストでも読む）。
// 釣りの魚の種類と大きさは、毎日の処理（tools/sim.js）と同じ config.fishing の決まり：
//   夜は hours.nightFishP の見こみで夜の魚、そうでなければ treasure.p → junk.p → 海の魚（seaFish）の重み。
//   大きさは tools/fishsize.js の rollSize と同じ式（config.fishing.sizes）。
// 1 日の回数などは config.play（なければ PLAY_DEFAULTS）。日付は日本時間。

export const PLAY_DEFAULTS = {
  fishPerDay: 5,      // 1 日に釣りざおを振れる回数（逃げても 1 回）
  chorePerDay: 5,     // 1 日のおてつだいの回数
  choreGoal: 300,     // みんなで集める 1 日の目標
  biteMin: 1.6,       // うきが沈むまで（秒）の短い方
  biteMax: 4.8,       // 長い方
  biteWindow: 0.85,   // 沈んでから引けば釣れる時間（秒）
  nightFrom: 18,      // 夜の魚が出る時刻（日本時間）
  nightTo: 5,
};
export const playCfg = (config) => ({ ...PLAY_DEFAULTS, ...((config && config.play) || {}) });

// 日本時間の日付（YYYY-MM-DD）と時
export const jstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
export const jstHour = (ms = Date.now()) => new Date(ms + 9 * 3600e3).getUTCHours();
export const isNight = (h, P = PLAY_DEFAULTS) => h >= P.nightFrom || h < P.nightTo;

// 文字から 32bit の数（同じ日なら、だれが開いても同じ宝の場所）
export function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 0〜1 を返す乱数（next）。seed を決めると毎回同じ並び
export function makeRng(seed = Date.now()) {
  let a = (typeof seed === 'number' ? seed : hashStr(seed)) >>> 0;
  return { next() { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } };
}
const mathRng = { next: () => Math.random() };

// tools/rand.js の weighted と同じ（[[値, 重み], ...]）
export function weighted(items, rng = mathRng) {
  let sum = 0;
  for (const it of items) sum += it[1];
  let x = rng.next() * sum;
  for (const it of items) { x -= it[1]; if (x < 0) return it[0]; }
  return items[items.length - 1][0];
}
// tools/fishsize.js の rollSize と同じ式
export function rollSize(sz, rng = mathRng) {
  if (!sz) return null;
  const min = +sz.min || 0, max = Math.max(min, +sz.max || min);
  const skew = sz.skew || 2;
  let cm;
  if (sz.bigMax > max && rng.next() < (sz.bigP ?? 0.02)) cm = max + (sz.bigMax - max) * Math.pow(rng.next(), 1.5);
  else cm = min + (max - min) * Math.pow(rng.next(), skew);
  return (sz.bigMax || max) < 10 ? Math.round(cm * 10) / 10 : Math.round(cm);
}
// 1 回の釣果。{ item, cm, kind: 'fish' | 'treasure' | 'junk', big }（浜で釣るので海の魚）
export function pickCatch(config, rng = mathRng, { night = false, sea = true } = {}) {
  const FC = (config && config.fishing) || {}, H = (config && config.hours) || {};
  let item;
  const nightList = sea && FC.seaNightFish ? FC.seaNightFish : H.nightFish;
  if (night && nightList && rng.next() < (H.nightFishP ?? 0)) item = weighted(nightList, rng);
  else if (FC.treasure && rng.next() < FC.treasure.p) item = weighted(FC.treasure.items, rng);
  else if (FC.junk && rng.next() < FC.junk.p) item = weighted(FC.junk.items, rng);
  else item = weighted((sea && FC.seaFish) || FC.fish || [['fish_aji', 1]], rng);
  const isFish = String(item).startsWith('fish_');
  const sz = isFish && FC.sizes ? FC.sizes[item] : null;
  const cm = sz ? rollSize(sz, rng) : null;
  const kind = isFish ? 'fish' : FC.treasure && FC.treasure.items.some(([k]) => k === item) ? 'treasure' : 'junk';
  return { item, cm, kind, big: !!(sz && cm > sz.max) };
}
// 大きさの言葉（その魚の範囲のどのあたりか）
export function sizeWord(item, cm, config) {
  const sz = config && config.fishing && config.fishing.sizes && config.fishing.sizes[item];
  if (!sz || cm == null) return '';
  if (cm > sz.max) return '大物';
  const k = (cm - sz.min) / Math.max(1, sz.max - sz.min);
  return k >= 0.7 ? '大きめ' : k >= 0.3 ? 'ふつう' : '小さめ';
}

// うきが沈むまでの秒
export const biteDelay = (P = PLAY_DEFAULTS, rng = mathRng) => P.biteMin + (P.biteMax - P.biteMin) * rng.next();
// 引いた時：沈む前は 'early'（早すぎて逃げた）、沈んでから window 秒の間は 'hit'、そのあとは 'late'（逃げた）
export function judgeHook(tapAt, biteAt, windowSec = PLAY_DEFAULTS.biteWindow) {
  if (tapAt < biteAt) return 'early';
  return tapAt <= biteAt + windowSec ? 'hit' : 'late';
}

// おてつだい：木・石・木の実・畑に水やり（go は「〜しに行きます」、doing は「〜しています」の前）
export const CHORES = {
  tree: { item: 'log', name: '木材', verb: '木を切った', tool: 'axe:wood', pose: 'chop' },
  rock: { item: 'cobble', name: '石', verb: '石を掘った', tool: 'pick:wood', pose: 'dig' },
  bush: { item: 'berry', name: '木の実', verb: '木の実をつんだ', tool: 'basket', pose: 'gather' },
  field: { item: 'wheat', name: '畑の水やり', verb: '畑に水をやった', tool: 'can', pose: 'water', go: '畑に水をやりに行きます', doing: '畑に水をやっています…' },
};
// 見本の「みんなの合計」（日付で決まる仮の数）
export const demoChoreTotal = (date, goal = PLAY_DEFAULTS.choreGoal) => Math.round(goal * (0.35 + (hashStr('chore' + date) % 1000) / 1000 * 0.3));
// きょうの宝の場所（spots 個の候補のうち、日付で 1 つ）
export const treasureIndex = (date, n) => (n > 0 ? hashStr('treasure:' + date) % n : 0);

// きょうの宝のうまっている所（日付で決まる。だれが開いても同じ所）。ok(x, z) が通る所を、島の中（-R〜R）から乱数で探す
export function treasureSpot(date, ok, R = 14, tries = 600) {
  const rng = makeRng('treasure-spot:' + date);
  for (let i = 0; i < tries; i++) { const x = Math.round(((rng.next() * 2 - 1) * R) * 10) / 10, z = Math.round(((rng.next() * 2 - 1) * R) * 10) / 10; if (ok(x, z)) return { x, z }; }
  return null;
}
// 金属探知機：いちばん近い宝までの距離（マス）で「ピッ」の間隔（ms）と高さ（Hz）が変わる。
//   near 以下はほぼ続けて鳴る（minMs）。far より遠いとゆっくり（maxMs）。間は距離にそって まっすぐ変わる。
//   dig：宝のすぐ上（この距離の中）で「掘る」が出る
export const DETECT = { near: 1, far: 16, minMs: 70, maxMs: 1400, lowHz: 1250, highHz: 2300, beepMs: 45, dig: 1.6 };
const k01 = (d, D) => Math.max(0, Math.min(1, (d - D.near) / (D.far - D.near)));
export const beepInterval = (d, D = DETECT) => Math.round(D.minMs + (D.maxMs - D.minMs) * k01(d, D));
export const beepPitch = (d, D = DETECT) => Math.round(D.highHz - (D.highHz - D.lowHz) * k01(d, D));
// 探知機の画面の言葉（数字で距離を出さない。あいまいに）
export const detectWord = (d, D = DETECT) => (d <= D.dig ? 'この下だ！' : d <= 4 ? 'すごく近い' : d <= 8 ? '近い' : d <= 12 ? '反応あり' : 'かすか');

// きょうの記録の空の形（Firestore の players/{村人}/days/{日付} と同じ項目）
export const emptyDay = () => ({ fish: 0, chores: 0, treasure: false });
export const leftOf = (day, P, kind) => Math.max(0, (kind === 'fish' ? P.fishPerDay : P.chorePerDay) - ((day && day[kind === 'fish' ? 'fish' : 'chores']) || 0));

// 鉱石の持ち方（プロフィールの oreMode）。sim の対応はあとで（今は保存と表示だけ）
export const ORE_MODES = { self: '自分で持つ', storage: '倉庫に入れる' };
export const validOreMode = (m) => Object.prototype.hasOwnProperty.call(ORE_MODES, m);
