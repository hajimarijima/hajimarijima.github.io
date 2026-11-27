// 誰かの家に遊びに行く（決まりだけ。サイトと毎日の更新で共通。tools/visit.js・js/visit3d.js・js/visitroom.js・Worker の 7) が使う）
//   ・自分の村人が相手の家まで歩いて行き、中を見て回る。帰る時に「来た人ノート」へ決まった一言を残せる
//   ・相手の家の主には「○○さんが遊びに来たよ」と郵便受けに届く（次の毎日の更新で）
//   ・1 日に行ける回数は perDay まで（受け口の Worker が数える。毎日の更新でも数え直す）
//   ・村人どうしも、仲の良い人の家へ時々遊びに行く（年表に小さく残る）
import { DECOR, inGrid, cellsOf, blockedCell, localPos } from './decor.js';

export const VISIT_DEFAULTS = { perDay: 3, keep: 12, villagerPerDay: 3, villagerP: 0.12 };
export const visitCfg = (config) => ({ ...VISIT_DEFAULTS, ...((config && config.visit) || {}) });

// 来た人ノートの一言（選ぶだけ。自由に書く所はない）。番号で送る
export const NOTE_WORDS = ['おじゃましました！', 'すてきなお部屋だね', 'また遊びに来るね', 'いすの座り心地がよかった', '本だなの本がおもしろそう', '飾りがかわいい！', 'ゆっくりできたよ', 'こんどはうちにも来てね'];
export const noteOk = (n) => Number.isInteger(n) && n >= 0 && n < NOTE_WORDS.length;
export const noteText = (n) => (noteOk(n) ? NOTE_WORDS[n] : '');

// 郵便受けに届く知らせ
export function visitLetter(fromName, note) {
  const w = noteText(note);
  return `${fromName}さんが遊びに来たよ。` + (w ? `来た人ノートに「${w}」と書いてあった。` : '');
}
// 年表の 1 行（その日の村人どうしの分をまとめて 1 行）
export function visitHistText(list) {
  if (!list.length) return '';
  const s = list.slice(0, 3).map((x) => `${x.from}が${x.to}の家へ`).join('、');
  return `${s}遊びに行った${list.length > 3 ? `（ほか ${list.length - 3} 組）` : ''}。`;
}

// 家の中でできること（飾りの種類 → ボタンの言葉と、した時の一言）
export const ROOM_ACTS = {
  chair: { label: 'いすに座る', say: 'ひと休み。' },
  shelf: { label: '本だなを見る', say: ['「島の魚ずかん」をぱらぱら。', '「はじめての家づくり」を読んだ。', '「星のなまえ」を見つけた。'] },
  picture: { label: '絵を見る', say: '海と島の絵。きれいだなあ。' },
  plant: { label: '植物に水をやる', say: '葉っぱがつやつや。' },
  lamp: { label: 'ランプをつける', say: 'あかりがともった。' },
  desk: { label: '机を見る', say: '書きかけの手紙がある。のぞかないでおこう。' },
  bed: { label: 'ベッドを見る', say: 'ふかふかのふとん。' },
};

// ---------- 家の中を歩く（マス目。床に置いた物のマスは通れない。じゅうたんと壁の絵は通れる） ----------
// 戻り値 { g: inGrid, free: Set('i,j'), door: [i, j], items: [{ id, i, j, r, cells, x, z, yaw }] }
export function roomGrid(look, list) {
  const g = inGrid(look), used = new Set(), items = [];
  for (const [id, i, j, r = 0] of list || []) {
    const D = DECOR[id]; if (!D) continue;
    const cells = cellsOf(id, i, j, r), p = localPos('in', look, id, i, j, r);
    if (D.layer === 'floor') for (const [a, b] of cells) used.add(a + ',' + b);
    items.push({ id, i, j, r, cells, x: p.x, z: D.layer === 'wall' ? -((look && look.d) || 3) / 2 : p.z, yaw: p.yaw, layer: D.layer });
  }
  const free = new Set();
  let door = null;
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    if (!used.has(i + ',' + j)) free.add(i + ',' + j);
    if (!door && blockedCell('in', look, i, j) === 'door') door = [i, j];
  }
  if (!door) door = [Math.floor(g.cols / 2), g.rows - 1];
  free.add(door.join(','));
  return { g, free, door, items };
}
export const cellPos = (R, i, j) => ({ x: R.g.x0 + i * R.g.cell, z: R.g.z0 + j * R.g.cell });
export const cellAt = (R, x, z) => [Math.round((x - R.g.x0) / R.g.cell), Math.round((z - R.g.z0) / R.g.cell)];
// 4 方向の幅優先（ななめには行かない＝角で物の端をかすめない）。着けなければ null
export function roomPath(R, from, to) {
  const k = (c) => c[0] + ',' + c[1], goal = k(to);
  if (!R.free.has(goal)) return null;
  const prev = new Map([[k(from), null]]), q = [from];
  while (q.length) {
    const c = q.shift();
    if (k(c) === goal) { const out = []; let x = c; while (x) { out.unshift(x); x = prev.get(k(x)); } return out; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [c[0] + dx, c[1] + dz];
      if (!R.free.has(k(n)) || prev.has(k(n))) continue;
      prev.set(k(n), c); q.push(n);
    }
  }
  return null;
}
// 物のそばの立つマス（物のマスのとなりで、通れるマス）。前（向きの +z）を先に。from から行けるものだけ
export function standCell(R, item, from) {
  const fwd = [[0, 1], [1, 0], [0, -1], [-1, 0]][item.r % 4], own = new Set(item.cells.map((c) => c.join(',')));
  const cand = [];
  const cells = item.layer === 'wall' ? item.cells.map(([i]) => [i, -1]) : item.cells; // 壁の絵は、その下の床のマスの前に立つ
  for (const [a, b] of cells) for (const [dx, dz] of [fwd, [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = [a + dx, b + dz];
    if (own.has(n.join(',')) && item.layer !== 'wall') continue;
    if (R.free.has(n.join(',')) && !cand.some((c) => c[0] === n[0] && c[1] === n[1])) cand.push(n);
  }
  let best = null, bl = 1e9;
  for (const c of cand) { const p = roomPath(R, from, c); if (p && p.length < bl) { best = { cell: c, path: p }; bl = p.length; } }
  return best;
}
// いすに座る所：いすのまん中から前へ少し（深く座ると背もたれに体が入る。足は前の下へ向けるので、前のマスがふさがっていると座らない）
export const SEAT = { top: 0.51, fwd: 0.13 };
export function seatOf(R, chair) {
  const s = Math.sin(chair.yaw), c = Math.cos(chair.yaw);
  const front = [chair.i + Math.round(s), chair.j + Math.round(c)];
  return { x: chair.x + s * SEAT.fwd, z: chair.z + c * SEAT.fwd, yaw: chair.yaw, y: SEAT.top, front, ok: R.free.has(front.join(',')) };
}
