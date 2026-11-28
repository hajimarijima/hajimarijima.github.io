#!/usr/bin/env node
'use strict';
// 称号バッジの絵（48x48 のドット絵）を作る → icons/title_<id>.png
// 形は「リボンつきのメダル」：上に丸いメダル（ふちはふくらみ、内側はくぼんだ皿）、下に 2 本のリボン。
// 光は左上から。ふちの左上は明るく、右下は暗い。真ん中の絵（16x16 くらい）は下の EMB に文字で描く。
// 技能バッジ（tools/gen_badges.js の丸いメダル・段つき）とは、リボンがあるので見分けられる。
// 新しい称号の絵を足す時は EMB と STYLE に id を足して node tools/gen_title_badges.js [見本.png]
const path = require('path');
const { writePNG } = require('./png');

const S = 48;
const OUT = path.join(__dirname, '..', 'icons');

// 絵の色（文字 → 色）。. は透明
const PAL = {
  W: [255, 255, 236], k: [34, 26, 30],
  G: [140, 220, 96], g: [74, 164, 62], d: [34, 104, 46],
  Y: [250, 226, 150], y: [214, 178, 100], o: [150, 112, 62],
  R: [255, 120, 100], r: [214, 50, 48], m: [132, 22, 36],
  B: [150, 214, 252], b: [62, 140, 222], n: [30, 76, 156],
  T: [214, 152, 88], t: [160, 102, 52], u: [98, 62, 34],
  A: [255, 238, 140], a: [240, 188, 48], e: [170, 112, 28],
  S: [222, 228, 236], s: [150, 160, 178], x: [92, 100, 122],
  P: [255, 176, 204], p: [236, 92, 142], q: [150, 36, 86],
};

const EMB = {
  // はじまりの村人：小さな島に芽と旗
  first_villager: [
    '...........r....',
    '...........rRR..',
    '...........rRRRr',
    '...........rRm..',
    '....G.G....u....',
    '...GgGgG...u....',
    '....gGd....u....',
    '.....d.....u....',
    '..YYYYdYYYYuYY..',
    '.YYWYYYYYYYYYyy.',
    'yYYYYYYYYYYYYyyo',
    'yyyyyyyyyyyyyooo',
    'bbyoooooooooooob',
    'bBbbbbbbBbbbbbBb',
    'bbnbbbbbbbbnbbbb',
  ],
  // りんご好き
  apple_lover: [
    '.......u........',
    '.......u.GGg....',
    '........uGgd....',
    '....rrr.u.rrr...',
    '...rRRRrrrrrrr..',
    '..rRWWRrrrrrrrm.',
    '..rRWRRrrrrrrrm.',
    '..rRRrrrrrrrrrm.',
    '..rrrrrrrrrrrrm.',
    '..rrrrrrrrrrrmm.',
    '..mrrrrrrrrrrmm.',
    '...mrrrrrrrrmm..',
    '....mmrrrrmmm...',
    '.....mmm.mmm....',
  ],
  // 釣り名人
  angler: [
    '................',
    '......bbbb......',
    '....bBBBBBBb..n.',
    '...bBWBBBBBbbnbn',
    '..bBkBBBBBBBbbbn',
    '.bBBBBBBBBBBbbn.',
    '.SSSSSSSSSSsbbn.',
    '..SSSSSSSSSsbbbn',
    '...sSSSSSSsn.nbn',
    '....ssssssn...n.',
    '......nnnn......',
  ],
  // 大物ハンター：王冠をかぶった魚
  big_catch: [
    '....a..a..a.....',
    '....aA.aA.aA....',
    '....aAAAAAAa....',
    '....eaaaaaae....',
    '......bbbb......',
    '....bBBBBBBb..n.',
    '...bBWBBBBBbbnbn',
    '..bBkBBBBBBBbbbn',
    '.bBBBBBBBBBBbbn.',
    '.SSSSSSSSSSsbbn.',
    '..SSSSSSSSSsbbbn',
    '...sSSSSSSsn.nbn',
    '....ssssssn...n.',
    '......nnnn......',
  ],
  // 橋の大工：木の橋と海
  bridge_builder: [
    'T..............T',
    'TTTTTTTTTTTTTTTT',
    'Tu.u.u.u.u.u.u.u',
    'TTTTTTTTTTTTTTTT',
    'tttttttttttttttt',
    'tttuuu....uuuttu',
    'ttu..........utu',
    'tu............uu',
    'tu............uu',
    'bBbbBbbbbBbbbBbb',
    'bbnbbbnbbbbnbbbn',
  ],
  // マイホーム：赤い屋根の家
  homeowner: [
    '.......mm.......',
    '......mRrm......',
    '.....mRRrrm.....',
    '....mRRRrrrm....',
    '...mRRRRrrrrm...',
    '..mRRRRRrrrrrm..',
    '.mmmmmmmmmmmmmm.',
    '..TTTTTTTTTTTt..',
    '..TBBbTTTuuuTt..',
    '..TBbbTTTuauTt..',
    '..TTTTTTTuuuTt..',
    '..tttttttuuutt..',
    '.oooooooooooooo.',
  ],
  // 古株：大きな古い木
  old_timer: [
    '.....gGGGg......',
    '...gGGGGGGggg...',
    '..gGGWGGGGggggd.',
    '.gGGGGGGGgggggd.',
    '.gGGGGGGggggggd.',
    '.ggGGGggggggddd.',
    '..gggggggggdddd.',
    '...ddgggdddddd..',
    '......Ttu.......',
    '......Ttu.......',
    '.....TTtuu......',
    '...TTTttuuuu....',
  ],
  // 人気者：ハート
  popular: [
    '..pppp....pppp..',
    '.pPPPPp..pPPPPp.',
    'pPWWPPPppPPPPPpq',
    'pPWPPPPPPPPPPPpq',
    'pPPPPPPPPPPPPppq',
    '.pPPPPPPPPPPppq.',
    '..pPPPPPPPPppq..',
    '...pPPPPPPppq...',
    '....pPPPPppq....',
    '.....pPPppq.....',
    '......ppqq......',
    '.......qq.......',
  ],
};

// 100・1000・1万 人目の村人：数字（左上が明るく、右下が暗い。ふちどりと影は badge() が付ける）
// 字は 9 ドットの高さ・線は 2 ドットの太さ（小さい画面でも読める）
const GLYPH = {
  '1w': ['..Bb.', '.BBb.', 'BBbb.', '..bb.', '..bb.', '..bb.', '..bb.', '..bb.', '.Bbbn'],
  '0w': ['.BBb.', 'BBnbb', 'Bb.bb', 'Bb.bb', 'Bb.bb', 'Bb.bb', 'Bb.bn', 'bbnbn', '.bnn.'],
  '1': ['.Bb.', 'BBb.', '.bb.', '.bb.', '.bb.', '.bb.', '.bb.', '.bb.', 'Bbbn'],
  '0': ['.Bb.', 'Bbbb', 'Bb.b', 'Bb.b', 'Bb.b', 'Bb.b', 'Bb.b', 'bbbn', '.bn.'],
  '万': ['BBBBBBBBb', '...Bb....', '...BbBBBb', '...Bb..bb', '..Bb...bb', '..Bb...bb', '.Bb....bn', 'Bb...bbbn', 'b....nnn.'],
};
const word = (keys) => GLYPH[keys[0]].map((_, y) => keys.map((k) => GLYPH[k][y]).join('.'));
EMB.villager_100 = word(['1w', '0w', '0w']);
EMB.villager_1000 = word(['1', '0', '0', '0']);
EMB.villager_10000 = word(['1', '万']);

// はじめての鉄・金・ダイヤ：宝石と延べ棒（光は左上から）
EMB.first_diamond = [
  '....WBBBBBBb....',
  '...WBBBBBBBbb...',
  '..BBWBBBBBbbbn..',
  '.BBBBBBBBbbbbnn.',
  'bbbbbbbbbbnnnnnn',
  '.bBBBBBbbbbbnnn.',
  '..bBBBBbbbbnnn..',
  '...bBBBbbbnnn...',
  '....bBBbbnnn....',
  '.....bBbnnn.....',
  '......bbnn......',
  '.......nn.......',
];
const ingot = (H, M, D) => [
  '...' + H + 'W' + 'W' + H.repeat(6) + M + '...',
  '..' + H + 'W' + H.repeat(7) + M + M + '..',
  '.' + H.repeat(10) + M.repeat(3) + '.',
  M.repeat(11) + D.repeat(5),
  M.repeat(10) + D.repeat(6),
  '.' + D.repeat(14) + '.',
];
EMB.first_iron = ['................', '................', '................', ...ingot('S', 's', 'x'), '................', '................', '................'];
EMB.first_gold = ['................', '................', '................', ...ingot('A', 'a', 'e'), '................', '................', '................'];

// メダルのふちの色・リボンの色
const STYLE = {
  villager_100: { rim: [184, 112, 58], ribbon: [70, 150, 70] },
  villager_1000: { rim: [196, 204, 216], ribbon: [58, 120, 210] },
  villager_10000: { rim: [240, 190, 52], ribbon: [204, 52, 58], sparkle: true },
  first_villager: { rim: [240, 190, 52], ribbon: [204, 52, 58], sparkle: true },
  apple_lover: { rim: [196, 204, 216], ribbon: [214, 64, 64] },
  angler: { rim: [196, 204, 216], ribbon: [58, 120, 210] },
  big_catch: { rim: [240, 190, 52], ribbon: [40, 92, 190], sparkle: true },
  bridge_builder: { rim: [184, 112, 58], ribbon: [60, 140, 200] },
  homeowner: { rim: [184, 112, 58], ribbon: [214, 120, 48] },
  old_timer: { rim: [196, 204, 216], ribbon: [70, 150, 70] },
  popular: { rim: [240, 190, 52], ribbon: [220, 90, 150] },
  first_iron: { rim: [196, 204, 216], ribbon: [90, 100, 120] },
  first_gold: { rim: [240, 190, 52], ribbon: [204, 52, 58] },
  first_diamond: { rim: [240, 190, 52], ribbon: [40, 160, 200], sparkle: true },
};

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
// f>1 は明るく（少し黄色み）、f<1 は暗く（少し青み）
function tone(c, f) {
  if (f >= 1) { const k = f - 1; return [c[0] * f + k * 50, c[1] * f + k * 34, c[2] * f + k * 6]; }
  const k = 1 - f; return [c[0] * f - k * 8, c[1] * f - k * 4, c[2] * f + k * 30];
}

function badge(id) {
  const st = STYLE[id], rows = EMB[id];
  const px = new Uint8Array(S * S * 4);
  const put = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = clamp(c[0]); px[i + 1] = clamp(c[1]); px[i + 2] = clamp(c[2]); px[i + 3] = a; };
  const get = (x, y) => { const i = (y * S + x) * 4; return px[i + 3] ? [px[i], px[i + 1], px[i + 2]] : null; };

  // ---- リボン 2 本（メダルの下から斜めに垂れる。先は V に切れこむ） ----
  const rb = st.ribbon;
  for (const side of [-1, 1]) {
    for (let y = 28; y < 47; y++) {
      const t = (y - 28) / 18, cx = 24 + side * (5 + t * 6), w = 4.2;
      for (let x = Math.floor(cx - w - 1); x <= Math.ceil(cx + w + 1); x++) {
        const u = (x - (cx - w)) / (2 * w); // 0=左 1=右
        if (u < 0 || u > 1) continue;
        // 先の V の切れこみ
        if (y > 41 && Math.abs(u - 0.5) * 2 < (y - 41) / 5.5) continue;
        let f = u < 0.18 ? 1.28 : u > 0.82 ? 0.62 : 1.0 - (u - 0.5) * 0.3;
        if (Math.abs(u - 0.5) < 0.08) f *= 0.86; // まん中の折り目
        if (side > 0) f *= 0.92; // 右のリボンは少し影
        put(x, y, tone(rb, f));
      }
    }
  }
  // リボンのふちどり
  outline(px, put, [32, 18, 26]);

  // ---- メダル ----
  const cx = 23.5, cy = 20.5, R = 19.5, RI = 15.2, L = [-0.68, -0.73], base = st.rim;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d > R + 0.5) continue;
    const nx = dx / (d || 1), ny = dy / (d || 1), lit = nx * L[0] + ny * L[1];
    if (d > R - 0.8) { put(x, y, tone(base, 0.26)); continue; } // 外のふち
    if (d > RI) { // 輪：外側半分はふくらみ、内側は内へ落ちる
      const u = (d - RI) / (R - RI);
      let f = u > 0.42 ? 1 + 0.55 * lit : 0.86 - 0.42 * lit;
      if (u > 0.42 && u < 0.62) f += 0.12 + 0.14 * Math.max(0, lit); // 輪の頂の光
      // 輪のぎざぎざ（メダルらしく 24 本の刻み）
      const ang = Math.atan2(dy, dx); if (u > 0.62 && Math.cos(ang * 24) > 0.55) f *= 0.86;
      put(x, y, tone(base, f)); continue;
    }
    if (d > RI - 0.9) { put(x, y, tone(base, 0.3)); continue; } // 内のふち
    // くぼんだ皿：左上は影、右下は明るい（くぼみ）。真ん中は少し明るく
    const f = 0.9 - 0.16 * lit * (d / RI) + 0.06 * (1 - d / RI);
    put(x, y, tone(base.map((v, i) => v * 0.3 + [244, 232, 204][i] * 0.7), f));
  }
  // 皿の左上の小さな光（つや）
  for (const [sx, sy] of [[15, 9], [16, 9], [14, 10]]) put(sx, sy, tone(base, 1.5));

  // ---- 真ん中の絵：影 → ふちどり → 絵 ----
  const eh = rows.length, ew = Math.max(...rows.map((r) => r.length));
  const at = (x, y) => (y >= 0 && y < eh && x >= 0 && x < ew ? PAL[rows[y][x]] || null : null);
  const ox = Math.round(cx - ew / 2 + 0.5), oy = Math.round(cy - eh / 2 + 0.5);
  for (let y = -1; y <= eh + 1; y++) for (let x = -1; x <= ew + 1; x++) { // 右下に落ちる影
    if (at(x, y) || !at(x - 1, y - 1)) continue;
    const X = ox + x + 1, Y = oy + y + 1, c = get(X, Y); if (c) put(X, Y, c.map((v) => v * 0.55));
  }
  for (let y = -1; y <= eh; y++) for (let x = -1; x <= ew; x++) {
    if (at(x, y)) continue;
    if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) put(ox + x, oy + y, [28, 22, 30]);
  }
  for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) { const c = at(x, y); if (c) put(ox + x, oy + y, c); }

  // きらり（金のメダルだけ）
  if (st.sparkle) for (const [sx, sy] of [[6, 7], [41, 11]]) {
    put(sx, sy, [255, 255, 255]);
    for (const [ax, ay] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(sx + ax, sy + ay, [255, 246, 196]);
  }
  return px;
}

// 透明でない所のまわりを 1 ドット ふちどる（いま描いてある物だけ）
function outline(px, put, c) {
  const has = (x, y) => x >= 0 && y >= 0 && x < S && y < S && px[(y * S + x) * 4 + 3] > 0;
  const edge = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (!has(x, y) && (has(x + 1, y) || has(x - 1, y) || has(x, y + 1) || has(x, y - 1))) edge.push([x, y]);
  for (const [x, y] of edge) put(x, y, c);
}

function main() {
  const made = [];
  for (const id of Object.keys(EMB)) {
    const px = badge(id);
    writePNG(path.join(OUT, `title_${id}.png`), S, S, px);
    made.push(px);
  }
  console.log(`${made.length} 枚つくりました（icons/title_*.png）`);
  const sheet = process.argv[2];
  if (sheet) { // 見本：4 倍に広げて、明るい地と暗い地に並べる
    const Z = 4, gap = 8, cols = made.length, W = cols * (S * Z + gap) + gap, H = 2 * (S * Z + gap) + gap;
    const out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4, dark = y > H / 2; out[o] = dark ? 44 : 246; out[o + 1] = dark ? 50 : 240; out[o + 2] = dark ? 62 : 226; out[o + 3] = 255; }
    made.forEach((px, n) => {
      for (let row = 0; row < 2; row++) {
        const bx = gap + n * (S * Z + gap), by = gap + row * (S * Z + gap);
        for (let y = 0; y < S * Z; y++) for (let x = 0; x < S * Z; x++) {
          const s = (Math.floor(y / Z) * S + Math.floor(x / Z)) * 4; if (!px[s + 3]) continue;
          const o = ((by + y) * W + bx + x) * 4; out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2];
        }
      }
    });
    writePNG(sheet, W, H, out);
  }
}

if (require.main === module) main();
module.exports = { EMB, STYLE };
