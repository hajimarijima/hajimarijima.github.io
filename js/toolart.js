// 道具の絵（16×16）。アイコン（tools/gen_icons.js）と、手に持つ 3D の道具（js/character.js の押し出し）で同じ絵を使う。
// 採用は「案 A」（マイクラに最も近い作風。js/toolart_ideas.js の A を元に、ここで描いた絵。写してはいない）：
//   柄は左下の角から右上へ斜めの 2 マス幅。明るい茶と暗い茶で、まわりに濃い縁取り。
//   頭は大きく、縁取りは頭のいちばん暗い色で 1 マス、外周すべて。左上が明るく右下が暗い。
//   つるはしは角のない、なめらかな弓形。
//   斧は柄の上の端の左に、縦長の大きな頭（4 マス幅×6 マス高さ）。刃は左向きで、頭の右は柄のすぐ横に沿う。
//   くわは柄の上の端から左へ、横 5 マス・厚さ 2 マスの頭が出て、左端が 1 マス下へ曲がって刃になる。
//   （マイクラの道具と同じ考え方の輪郭の大きさと置き方。絵は写していない）
export const S = 16;
export const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'];
export const TOOL_MATS = ['wood', 'stone', 'iron', 'gold', 'diamond'];
// [縁（いちばん暗い）, 暗, 中, 明, 光]
const HEX = {
  wood: ['#3a2508', '#7d5a26', '#a98339', '#d0ab5e', '#ecd08e'], // 板の色（柄より黄色く明るい）
  stone: ['#1a1b1d', '#45484c', '#686b70', '#8d9095', '#b3b6ba'],
  iron: ['#383e46', '#949da8', '#c9d0d7', '#eceff2', '#ffffff'],
  gold: ['#563200', '#b5750a', '#e6ad1c', '#fbd94a', '#fff4a6'],
  diamond: ['#05363c', '#11918d', '#2bd0c6', '#88f3eb', '#eafffd'],
  stick: ['#20130a', '#5a391a', '#8a5a2e', '#b07a42', '#c9955c'],
  guard: ['#1c140c', '#3d2b1b', '#5c432f', '#7a5c43', '#94765b'],
};
const toRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const TOOL_PAL = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, v.map(toRGB)]));

// マスのまん中を、道具の軸にそった座標にする。u：柄の向き（右上が +）、v：直角の向き（右下が +）。まん中は (8, 8)
const uv = (x, y) => { const a = x + 0.5 - (y + 0.5), p = x + 0.5 + y + 0.5; return [a / Math.SQRT2, (p - 16) / Math.SQRT2]; };
const grid = (fn) => { const g = new Array(S * S).fill(null); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { if (x < 1 || y < 1 || x > 14 || y > 14) continue; const c = fn(x, y, ...uv(x, y)); if (c) g[y * S + x] = c; } return g; };
// 2 マス幅の柄（左下から）。明るい側は x + y = 15、暗い側は x + y = 16
const stick2 = (x, y, xTop) => (x >= 1 && x <= xTop ? (x + y === 15 ? 'w' : x + y === 16 ? 'b' : null) : null);
const inRows = (rows, x, y) => rows.some(([yy, a, b]) => yy === y && x >= a && x <= b);

// 斧の頭の案（画面の行ごとに [y, x の始まり, x の終わり]）。柄の上の端に頭が重なり、柄の右は背だけ。
// 刃先はいちばん左の列（まっすぐな縦線）、上下の角だけ 1 マス外（左）へ張り出す。
export const AXE_IDEAS = {
  // どれも柄の上の端の左に、厚い四角い頭（5〜6 マス × 6〜7 マス）。下の縁は横にまっすぐで、右（背）は柄に沿う
  // 1：6×6。刃先は 4 マスの縦線、上下の角が 1 マス左へ張り出す。柄の先は頭の右上に隠れる
  1: { top: 11, rows: [[1, 4, 10], [2, 5, 11], [3, 5, 11], [4, 5, 10], [5, 5, 9], [6, 4, 8]] },
  // 2：7×7 の大きい頭。刃先は 5 マスの縦線
  2: { top: 11, rows: [[1, 3, 10], [2, 4, 11], [3, 4, 11], [4, 4, 10], [5, 4, 9], [6, 4, 8], [7, 3, 7]] },
  // 3：1 と同じ頭で、柄の先が頭の右上に 1 マス出る
  3: { top: 12, rows: [[1, 4, 10], [2, 5, 10], [3, 5, 10], [4, 5, 10], [5, 5, 9], [6, 4, 8]] },
  // 4：縦長の頭（刃の幅 4 マス×高さ 6 マス）。右側は斜めの柄のすぐ横に沿い、柄の先は頭の右上に 1 マス出る
  4: { top: 11, rows: [[2, 4, 8], [3, 4, 9], [4, 4, 10], [5, 4, 9], [6, 4, 8], [7, 4, 7]] },
};

// 3 を採用：頭が厚い四角で、柄の先が頭の右上に出るので「柄の片側に頭が付いている」のが黒い影でも分かる
export const AXE_CHOSEN = 4; // 4：縦長の頭（マイクラの斧と同じ置き方）

// 形：'#' 頭、'e' 刃先の明るい線、'w'/'b' 柄、'g' つば・柄頭（剣）。縁取りは自動で付ける
function pickaxe() {
  // 弓形：まん中 (8, 8) からの距離 r と、柄の向きからの角度 th で決める。まん中が太く、先へ行くほど細い
  const ro = 7.0, thick = 2.7, thin = 1.3, thMax = 1.85;
  return grid((x, y, u, v) => {
    const r = Math.hypot(u, v), th = Math.abs(Math.atan2(v, u));
    const k = Math.min(1, th / thMax);
    if (th <= thMax && r <= ro && r >= ro - (thick - (thick - thin) * k * k)) return '#';
    return stick2(x, y, 10);
  });
}
function axe(idea = AXE_CHOSEN) {
  const A = AXE_IDEAS[idea] || AXE_IDEAS[AXE_CHOSEN];
  const edgeX = Math.min(...A.rows.map((r) => r[1])) + 1; // 刃先の縦線の列（角は 1 つ左）
  return grid((x, y) => {
    if (inRows(A.rows, x, y)) return x <= edgeX && !inRows(A.rows, x - 1, y) ? 'e' : '#';
    return stick2(x, y, A.top);
  });
}
function shovel() {
  const uc = 4.2, ru = 3.9, rv = 2.8;
  return grid((x, y, u, v) => {
    // 先がまるい、すこし細長いスコップ（根元はまっすぐ）
    const du = u - uc;
    if (du >= -ru * 0.75 && (du <= 0 ? Math.abs(v) <= rv * (1 - 0.15 * (-du / ru)) : (du / ru) ** 2 + (v / rv) ** 2 <= 1)) return '#';
    return stick2(x, y, 9);
  });
}
function hoe() {
  // 柄の先から左へ横に出る頭。左のはしは下へ曲がる
  // 柄の上の端（右上）から左へ、横 5 マス・厚さ 2 マスの頭。上の段は柄の先にかぶさる。左端は 1 マス下へ曲がって刃になる
  const rows = [[2, 7, 13], [3, 7, 11], [4, 7, 7]];
  return grid((x, y) => (inRows(rows, x, y) ? '#' : stick2(x, y, 12)));
}
function sword() {
  const w = 1.45, tip = 7.6, end = 9.0, gw = 3.6;
  return grid((x, y, u, v) => {
    const av = Math.abs(v);
    const wAt = u <= tip ? w : w * Math.max(0, (end - u) / (end - tip)); // 先は三角にとがる
    if (u >= -2.0 && u <= end && av <= wAt) return '#';
    if (u >= -3.2 && u < -2.0 && av <= gw) return 'g'; // つば
    if (u >= -6.0 && u < -3.2 && av <= 0.75) return v < 0 ? 'w' : 'b'; // 握り
    if (u >= -7.4 && u < -6.0 && av <= 1.15) return 'g'; // 柄頭
    return null;
  });
}
const SHAPES = { pickaxe, axe, shovel, hoe, sword };

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
// 16×16 の RGBA（Uint8Array）。kind：pickaxe / axe / shovel / hoe / sword、mat：wood / stone / iron / gold / diamond
// opt.axe：斧の案の番号（比べる画像用。ふだんは AXE_CHOSEN）
export function toolPixels(kind, mat, opt = {}) {
  const g = kind === 'axe' ? axe(opt.axe) : SHAPES[kind]();
  const P = TOOL_PAL[mat] || TOOL_PAL.iron, ST = TOOL_PAL.stick, GD = TOOL_PAL.guard;
  const metal = mat === 'iron' || mat === 'gold' || mat === 'diamond';
  const px = new Uint8Array(S * S * 4);
  const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : g[y * S + x]);
  const put = (x, y, c) => { const i = (y * S + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const isHead = (c) => c === '#' || c === 'e';
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 縁取り：外周すべてに 1 マス。頭のとなりは頭のいちばん暗い色、それ以外は柄（つば）の濃い色
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (at(x, y)) continue;
    const ns = N4.map(([dx, dy]) => at(x + dx, y + dy)).filter(Boolean);
    if (!ns.length) continue;
    put(x, y, ns.some(isHead) ? P[0] : ns.includes('g') ? GD[0] : ST[0]);
  }
  const out = (x, y) => !at(x, y);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = at(x, y); if (!c) continue;
    if (c === 'w') { put(x, y, (x + y) % 4 === 1 && kind !== 'sword' ? ST[4] : ST[3]); continue; }
    if (c === 'b') { put(x, y, ST[1]); continue; }
    if (c === 'e') { put(x, y, P[4]); continue; } // 研いだ刃先：1 マスの明るい線
    const pal = c === 'g' ? GD : P;
    // 左上が外なら明るく、右下が外なら暗く（いちばん暗い＝縁、暗、中、明、光）
    const ul = out(x - 1, y) || out(x, y - 1), dr = out(x + 1, y) || out(x, y + 1);
    let t = ul && !dr ? 3 : dr && !ul ? 1 : 2;
    if (out(x - 1, y) && out(x, y - 1) && !dr) t = 4;
    if (c === '#') {
      const n = (hash(mat + kind + x + ',' + y) % 1000) / 1000;
      if (mat === 'wood' && t === 2 && (x + 2 * y) % 5 === 0) t = 1; // 木目
      if (mat === 'stone' && t === 2 && n > 0.62) t = 1; // まだら
      if (mat === 'stone' && t === 2 && n < 0.18) t = 3;
      if ((mat === 'iron' || mat === 'gold') && t === 2 && (x - y + 16) % 5 === 0) t = 3; // 光のすじ
      if (mat === 'diamond' && t === 2 && (x + y) % 3 === 0) t = 3; // 面
      if (kind === 'hoe' && out(x - 1, y) && y >= 3 && metal) t = 4; // くわの刃の先
    }
    put(x, y, pal[t]);
  }
  return px;
}
