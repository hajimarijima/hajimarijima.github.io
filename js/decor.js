// 家を飾る：飾りの種類・置き場所のマス・置き方の確かめ（tools/decor.js・サイト・テストで共通。three.js も DOM も使わない）
//   飾りは島での活動（釣り・おてつだい・宝探し・行事・手紙のお礼）で手に入れ、data/decor.json に人ごとに持つ：
//     { 村人: { own: { 飾り: 数 }, out: [[飾り, i, j, 向き]], in: [[飾り, i, j, 向き]], got: [[日, 飾り, わけ]], earned: ['日付:わけ'] } }
//   out は家の外（扉の前の庭）、in は家の中。i は横、j は縦のマス。向きは 0〜3（90 度ずつ）。
//   家の向きの決まりは beds.js と同じ（+z が扉の側。x' = x cos + z sin、z' = -x sin + z cos）。
export const CELL = 0.9; // 1 マスの大きさ（町の 1 ブロックの半分くらい）

// 飾りの種類。size は [横, 縦] のマス。layer：同じ layer の物どうしは重ねられない（じゅうたんの上に家具、壁に絵）
export const DECOR = {
  // 家の外
  flowerbed: { name: '花壇', place: 'out', size: [1, 1], layer: 'floor', from: 'chore' },
  fence: { name: '柵', place: 'out', size: [1, 1], layer: 'floor', from: 'chore' },
  flag: { name: '旗', place: 'out', size: [1, 1], layer: 'floor', from: 'event' },
  lantern: { name: 'ランタン', place: 'out', size: [1, 1], layer: 'floor', from: 'treasure' },
  bench: { name: 'ベンチ', place: 'out', size: [2, 1], layer: 'floor', from: 'thanks' },
  barrel: { name: '魚のたる', place: 'out', size: [1, 1], layer: 'floor', from: 'fish' },
  planter: { name: '植木ばち', place: 'out', size: [1, 1], layer: 'floor', from: 'fish' },
  // 家の中
  bed: { name: 'ベッド', place: 'in', size: [1, 2], layer: 'floor', from: 'thanks' },
  desk: { name: '机', place: 'in', size: [2, 1], layer: 'floor', from: 'chore' },
  chair: { name: 'いす', place: 'in', size: [1, 1], layer: 'floor', from: 'chore' },
  shelf: { name: '本だな', place: 'in', size: [1, 1], layer: 'floor', from: 'treasure' },
  lamp: { name: '置きランプ', place: 'in', size: [1, 1], layer: 'floor', from: 'treasure' },
  plant: { name: '観葉植物', place: 'in', size: [1, 1], layer: 'floor', from: 'fish' },
  rug: { name: 'じゅうたん', place: 'in', size: [2, 2], layer: 'rug', from: 'fish' },
  picture: { name: '絵', place: 'in', size: [1, 1], layer: 'wall', from: 'event' },
};
export const DECOR_IDS = Object.keys(DECOR);
export const isDecor = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(DECOR, id);
// 手に入れたわけ
export const EARN = { fish: '釣り', chore: 'おてつだい', treasure: '宝探し', event: '島の行事', thanks: '手紙のお礼', gift: '手紙にそえてもらった' };
export const poolOf = (why) => DECOR_IDS.filter((id) => DECOR[id].from === why);
export const DECOR_DEFAULTS = { maxOwn: 9, fishP: 0.5, choreP: 0.5, choreMin: 3, keepGot: 12 };
export const decorCfg = (config) => ({ ...DECOR_DEFAULTS, ...((config && config.decor) || {}) });
// 家を飾るが開いているか（config.decor.enabled。false の間は「近日公開」）と、その間の案内の文
export const decorOn = (config) => !(config && config.decor && config.decor.enabled === false);
export const decorSoonText = (config) => String((config && config.decor && config.decor.openNote) || '島がもっと大きくなったら、家を飾れるようになります。');
// メニューやボタンの「家を飾る」に付ける「近日」の印（閉じている間だけ）
export const SOON_BADGE = '<b class="soon">近日</b>';
export const soonBadge = (config) => (decorOn(config) ? '' : SOON_BADGE);
// もとからある家具（家を飾るが閉じている間の家の中。遊びに行った時もこれを見る）。入らない物は cleanLayout が捨てる
export const BASIC_ROOM = [['bed', 0, 0, 0], ['shelf', 1, 0, 0], ['desk', 2, 0, 3], ['chair', 1, 1, 0], ['picture', 2, 0, 0], ['lamp', 2, 2, 0]];
// 家の飾り（町・村人のページ・遊びに行った家で共通）。閉じている間は、外は何もなし・中はもとからある家具
export function homeLayoutFor(b, look, residents, decor, config) {
  if (decorOn(config)) return houseLayout(b, look, residents, decor);
  const who = residents && residents[0] ? residents[0].key : '';
  return { out: [], in: cleanLayout('in', BASIC_ROOM, look).map((e) => [...e, who]) };
}

// ---------- マス ----------
// 家の外：扉の前の庭。横 7 × 縦 3。まん中の列は家の前の小道（置けない）。郵便受けは小道の右の、いちばん道路に近いマス
export const OUT_COLS = 7, OUT_ROWS = 3, PATH_COL = 3;
export const MAILBOX_CELL = [4, 2];
export function outGrid(look) {
  const d = (look && look.d) || 3;
  return { cols: OUT_COLS, rows: OUT_ROWS, cell: CELL, x0: -((OUT_COLS - 1) / 2) * CELL, z0: d / 2 + 0.1 + CELL / 2 };
}
// 家の中：床（はば w・奥行き d）に入るだけ。j = 0 が奥の壁ぎわ、いちばん大きい j が扉の側
export function inGrid(look) {
  const w = (look && look.w) || 3, d = (look && look.d) || 3;
  const cols = Math.max(1, Math.floor((w - 0.5) / CELL)), rows = Math.max(1, Math.floor((d - 0.5) / CELL));
  return { cols, rows, cell: CELL, x0: -((cols - 1) / 2) * CELL, z0: -((rows - 1) / 2) * CELL };
}
export const gridOf = (place, look) => (place === 'in' ? inGrid(look) : outGrid(look));
// 置けないマス（外：小道・郵便受け・金床のそば、中：扉の前）
export function blockedCell(place, look, i, j) {
  if (place === 'out') {
    if (i === PATH_COL) return 'path';
    if (i === MAILBOX_CELL[0] && j === MAILBOX_CELL[1]) return 'mailbox';
    if (look && look.props === 'anvil' && j === 0 && i >= 5) return 'anvil';
    return null;
  }
  const g = inGrid(look);
  if (j === g.rows - 1 && Math.abs(g.x0 + i * g.cell) < 0.6) return 'door';
  return null;
}
// 向きを入れた大きさ（奇数の向きは横と縦が入れかわる）
export const sizeOf = (id, r = 0) => { const s = (DECOR[id] || { size: [1, 1] }).size; return r % 2 ? [s[1], s[0]] : [s[0], s[1]]; };
// 置いた物がふさぐマス
export function cellsOf(id, i, j, r = 0) {
  const [sw, sd] = sizeOf(id, r), out = [];
  for (let a = 0; a < sw; a++) for (let b = 0; b < sd; b++) out.push([i + a, j + b]);
  return out;
}
// 家の中心から見た、置いた物の中心（x, z）と向き（yaw）
export function localPos(place, look, id, i, j, r = 0) {
  const g = gridOf(place, look), [sw, sd] = sizeOf(id, r);
  const x = g.x0 + (i + (sw - 1) / 2) * g.cell, z = g.z0 + (j + (sd - 1) / 2) * g.cell;
  return { x, z, yaw: (r % 4) * (Math.PI / 2) };
}
// 家の向きで町の位置に（beds.js と同じ回し方）
export function toWorldPos(b, p) {
  const rot = (b && b.rot) || 0, c = Math.cos(rot), s = Math.sin(rot);
  return { x: b.x + p.x * c + p.z * s, z: b.z - p.x * s + p.z * c, yaw: rot + (p.yaw || 0) };
}
export function mailboxLocal(look) { const g = outGrid(look); return { x: g.x0 + MAILBOX_CELL[0] * g.cell, z: g.z0 + MAILBOX_CELL[1] * g.cell, yaw: 0 }; }

// ---------- 置き方を確かめる ----------
// list：[[飾り, i, j, 向き]]。own：持っている数。taken：ほかの人（同じ家の人）がふさいでいる { layer: Set('i,j') }
// 戻り値：通った物だけの list（持っていない・はみ出す・重なる・置けないマスの物は捨てる。上から順に）
export function cleanLayout(place, list, look, own = null, taken = null) {
  const g = gridOf(place, look), used = {}, cnt = {}, out = [];
  for (const L of Object.keys(taken || {})) used[L] = new Set(taken[L]);
  for (const e of Array.isArray(list) ? list.slice(0, 40) : []) {
    if (!Array.isArray(e)) continue;
    const [id, i, j] = e, r = ((e[3] | 0) % 4 + 4) % 4;
    if (!isDecor(id) || DECOR[id].place !== place || !Number.isInteger(i) || !Number.isInteger(j)) continue;
    if (own && (cnt[id] || 0) >= (own[id] || 0)) continue;
    const D = DECOR[id], cells = cellsOf(id, i, j, r);
    if (cells.some(([a, b]) => a < 0 || b < 0 || a >= g.cols || b >= g.rows || blockedCell(place, look, a, b))) continue;
    if (D.layer === 'wall' && j !== 0) continue; // 絵は奥の壁にだけかける
    const set = used[D.layer] || (used[D.layer] = new Set());
    if (cells.some(([a, b]) => set.has(a + ',' + b))) continue;
    for (const [a, b] of cells) set.add(a + ',' + b);
    cnt[id] = (cnt[id] || 0) + 1;
    out.push([id, i, j, r]);
  }
  return out;
}
// list がふさいでいるマス { layer: ['i,j'] }（同じ家の人の物をよけるため）
export function takenBy(list) {
  const t = {};
  for (const [id, i, j, r] of list || []) { if (!isDecor(id)) continue; const L = DECOR[id].layer; for (const [a, b] of cellsOf(id, i, j, r)) (t[L] = t[L] || []).push(a + ',' + b); }
  return t;
}
// ある所に置けるか（今の list に足して確かめる）
export function canPlace(place, list, look, own, id, i, j, r = 0, taken = null) {
  const next = [...(list || []), [id, i, j, r]];
  return cleanLayout(place, next, look, own, taken).length === next.length;
}
// まだ置いていない数
export function leftOf(own, out, inn, id) { return Math.max(0, ((own || {})[id] || 0) - [...(out || []), ...(inn || [])].filter((e) => e[0] === id).length); }

// 家に住む人の順（welcome.js の assignHomes と同じ：来た日の順）
export function residentsOf(b, villagers, life) {
  return (villagers || []).filter((v) => life && life[v.key] && life[v.key].home === b.id).sort((a, c) => (a.joinedDay ?? 0) - (c.joinedDay ?? 0));
}
// 1 つの家の飾り（住む人の順に重ねる。先の人が置いたマスは、後の人は使えない）。戻り値 { out: [[飾り, i, j, 向き, 村人]], in: [...] }
export function houseLayout(b, look, residents, decor) {
  const res = { out: [], in: [] };
  for (const place of ['out', 'in']) {
    let taken = {};
    for (const v of residents) {
      const D = (decor || {})[v.key];
      if (!D) continue;
      const ok = cleanLayout(place, D[place], look, D.own, taken);
      for (const e of ok) res[place].push([...e, v.key]);
      const t = takenBy(ok);
      for (const L of Object.keys(t)) taken[L] = [...(taken[L] || []), ...t[L]];
    }
  }
  return res;
}
