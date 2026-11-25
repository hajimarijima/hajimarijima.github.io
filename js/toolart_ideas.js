// 道具の絵の「案」（16×16）。今の採用版（js/toolart.js）はさわらず、選んでもらうための 3 つの作風をここで描く。
// 選ばれた案を js/toolart.js へ差し替える。どれもここで描いた絵（写してはいない）。
//   案 A：マイクラに最も近い。頭が大きく、柄は 2 マス幅で太い。つるはしは角のない、なめらかな弓形。
//   案 B：太く丸みのある、かわいい作風。頭はさらに大きく、縁取りは太め（外の縁＋内側の濃い輪）。
//   案 C：細部が多い作風。金属の光沢、刃の縁の明るい線、柄の巻き革、頭と柄の留め金。
import { S, TOOL_PAL } from './toolart.js';

export const IDEAS = ['A', 'B', 'C'];
export const IDEA_KINDS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const LEATHER = ['#1e0f08', '#4a2414', '#73391f', '#9a5530', '#b8714a'].map(hex);
const BIND = ['#2a1d05', '#7a5a14', '#b98d24', '#e2bd4a', '#fff0a8'].map(hex);

// マスのまん中を、道具の軸にそった座標にする。u：柄の向き（右上が +）、v：直角の向き（右下が +）。まん中は (8, 8)
const uv = (x, y) => { const a = x + 0.5 - (y + 0.5), p = x + 0.5 + y + 0.5; return [a / Math.SQRT2, (p - 16) / Math.SQRT2]; };
const grid = (fn) => { const g = new Array(S * S).fill(null); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { if (x < 1 || y < 1 || x > 14 || y > 14) continue; const c = fn(x, y, ...uv(x, y)); if (c) g[y * S + x] = c; } return g; };
// 2 マス幅の柄（左下から）。明るい側は x + y = 15、暗い側は x + y = 16
const stick2 = (x, y, xTop) => (x >= 1 && x <= xTop ? (x + y === 15 ? 'w' : x + y === 16 ? 'b' : null) : null);

// ---- 形 ----
// 返す文字：'#' 頭、'e' 刃の縁（明るい線）、'f' 刃の溝（剣）、'w'/'b' 柄、'l'/'L' 巻き革、'k' 留め金、'g' つば・柄頭
function pickaxe(style) {
  // 弓形：まん中 (8, 8) からの距離 r と、柄の向きからの角度 th で決める。まん中が太く、先へ行くほど細い
  const R = { A: [7.0, 2.7, 1.3, 1.85], B: [7.3, 3.5, 2.0, 1.75], C: [7.0, 2.2, 1.0, 1.95] }[style];
  const [ro, thick, thin, thMax] = R;
  return grid((x, y, u, v) => {
    const r = Math.hypot(u, v), th = Math.abs(Math.atan2(v, u));
    const k = Math.min(1, th / thMax);
    const ri = ro - (thick - (thick - thin) * k * k);
    if (th <= thMax && r <= ro && r >= ri) {
      if (style === 'C' && r > ro - 0.75 && k > 0.35) return 'e'; // 先の外側の縁が光る
      return '#';
    }
    if (style === 'B') { // 先を丸く（小さな丸）
      for (const s of [-1, 1]) { const t = thMax * s, cu = Math.cos(t) * (ro - thin / 2), cv = Math.sin(t) * (ro - thin / 2); if (Math.hypot(u - cu, v - cv) <= thin * 0.62) return '#'; }
    }
    if (style === 'C' && Math.abs(u - (ro - thick / 2) + 0.2) <= 0.8 && Math.abs(v) <= 1.3) return 'k';
    if (style === 'C' && x + y >= 15 && x + y <= 16 && x <= 4) return x + y === 15 ? 'l' : 'L';
    return stick2(x, y, style === 'B' ? 9 : 10);
  });
}
function axe(style) {
  const P = { A: { uc: 3.9, half: 2.0, grow: 0.45, vmax: 5.9, back: 1.5 }, B: { uc: 3.8, half: 2.4, grow: 0.45, vmax: 6.3, back: 2.0 }, C: { uc: 4.0, half: 1.9, grow: 0.45, vmax: 5.8, back: 1.4 } }[style];
  return grid((x, y, u, v) => {
    const top = style === 'B' ? 6.9 : 7.3;
    // 刃：柄の左上の側（v が負）。外へ行くほど広がる
    if (v < -0.3 && -v <= P.vmax && Math.abs(u - P.uc) <= P.half + P.grow * -v) {
      if (style === 'B' && -v > P.vmax - 1.1 && Math.abs(u - P.uc) > P.half + P.grow * -v - 1.0) return null; // 角を丸く
      if (style === 'C' && -v > P.vmax - 0.8) return 'e'; // 研いだ刃の縁
      return '#';
    }
    // 背：柄の右下の側
    if (v >= -0.3 && v <= P.back + 0.5 && Math.abs(u - P.uc - 0.2) <= (style === 'B' ? 1.6 : 1.2)) return '#';
    if (style === 'C' && x + y >= 15 && x + y <= 16 && x <= 4) return x + y === 15 ? 'l' : 'L';
    if (u > top) return null;
    return stick2(x, y, 13);
  });
}
function shovel(style) {
  const P = { A: [4.2, 3.9, 2.8], B: [4.1, 4.1, 3.3], C: [4.3, 3.8, 2.6] }[style];
  const [uc, ru, rv] = P;
  return grid((x, y, u, v) => {
    // 先がまるい、すこし細長いスコップ（根元はまっすぐ）
    const du = u - uc, inBlade = du >= -ru * 0.75 && (du <= 0 ? Math.abs(v) <= rv * (1 - 0.15 * (-du / ru)) : (du / ru) ** 2 + (v / rv) ** 2 <= 1);
    if (inBlade) {
      if (style === 'C' && Math.abs(v) <= 0.45 && du > -ru * 0.5) return 'e'; // まん中のすじ
      if (style === 'C' && (du / ru) ** 2 + (v / rv) ** 2 > 0.62 && du > 0) return 'e'; // 先の縁
      return '#';
    }
    if (style === 'C' && du < -ru * 0.75 && du >= -ru * 0.75 - 1.0 && Math.abs(v) <= 1.1) return 'k'; // 首の留め金
    if (style === 'C' && x + y >= 15 && x + y <= 16 && x <= 3) return x + y === 15 ? 'l' : 'L';
    return stick2(x, y, style === 'B' ? 8 : 9);
  });
}
function hoe(style) {
  // 画面の上で考える：柄の先から左へ横に出る頭。左のはしは下へ曲がる
  const rows = {
    A: [[1, 5, 14], [2, 5, 13], [3, 5, 6], [4, 5, 6], [5, 5, 5]],
    B: [[1, 5, 13], [2, 4, 14], [3, 4, 13], [4, 4, 6], [5, 4, 6], [6, 5, 5]],
    C: [[1, 5, 14], [2, 5, 13], [3, 5, 6], [4, 5, 6], [5, 5, 6]],
  }[style];
  const inR = (x, y) => rows.some(([yy, a, b]) => yy === y && x >= a && x <= b);
  return grid((x, y) => {
    if (inR(x, y)) {
      if (style === 'B' && ((x === 5 && y === 1) || (x === 13 && y === 1) || (x === 4 && y === 2) || (x === 14 && y === 3))) return null;
      if (style === 'C' && y >= 4 && x === 5) return 'e'; // 刃の先の縁
      if (style === 'C' && y === 1 && x >= 11 && x <= 13) return 'k';
      return '#';
    }
    if (style === 'C' && x + y >= 15 && x + y <= 16 && x <= 4) return x + y === 15 ? 'l' : 'L';
    return stick2(x, y, style === 'B' ? 12 : 13);
  });
}
function sword(style) {
  const P = { A: { w: 1.45, tip: 7.6, end: 9.0, gw: 3.6 }, B: { w: 1.95, tip: 7.0, end: 8.9, gw: 3.9 }, C: { w: 1.4, tip: 7.6, end: 9.1, gw: 3.5 } }[style];
  return grid((x, y, u, v) => {
    const av = Math.abs(v);
    // 刃：先は三角にとがる（B は丸い）
    const wAt = u <= P.tip ? P.w : P.w * Math.max(0, (P.end - u) / (P.end - P.tip));
    if (u >= -2.0 && u <= P.end && av <= (style === 'B' && u > P.tip ? Math.sqrt(Math.max(0, P.w ** 2 - (u - P.tip) ** 2 * 1.6)) : wAt)) {
      if (style === 'C' && av <= 0.4 && u < P.tip - 0.5) return 'f'; // 溝
      if (style === 'C' && av > wAt - 0.7) return 'e'; // 刃の縁
      return '#';
    }
    if (u >= -3.2 && u < -2.0 && av <= P.gw) { if (style === 'B' && av > P.gw - 0.8 && (u < -2.8)) return null; return 'g'; } // つば
    if (u >= (style === 'B' ? -6.6 : -6.0) && u < -3.2 && av <= 0.75) return style === 'C' ? ((Math.floor((u + 6) * 1.4) % 2) ? 'l' : 'L') : (v < 0 ? 'w' : 'b'); // 握り
    if (u >= (style === 'B' ? -7.9 : -7.4) && u < (style === 'B' ? -6.6 : -6.0) && av <= (style === 'B' ? 1.3 : 1.15)) return 'g'; // 柄頭
    return null;
  });
}
const SHAPES = { pickaxe, axe, shovel, hoe, sword };

// ---- ぬり ----
// 左上が明るく、右下が暗い。B は縁の内側にもう 1 段濃い輪（太い縁取り）と大きな光。C は軸にそった光沢のすじ
export function ideaPixels(style, kind, mat) {
  const g = SHAPES[kind](style);
  const P = TOOL_PAL[mat] || TOOL_PAL.iron, ST = TOOL_PAL.stick, GD = style === 'C' ? BIND : TOOL_PAL.guard;
  const metal = mat !== 'wood' && mat !== 'stone';
  const px = new Uint8Array(S * S * 4);
  const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? null : g[y * S + x]);
  const put = (x, y, c) => { const i = (y * S + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const isHead = (c) => c === '#' || c === 'e' || c === 'f';
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N8 = N4.concat([[1, 1], [-1, -1], [1, -1], [-1, 1]]);
  // 外の縁：A・C は上下左右、B は斜めも（太く丸く見える）
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (at(x, y)) continue;
    const ns = (style === 'B' ? N8 : N4).map(([dx, dy]) => at(x + dx, y + dy)).filter(Boolean);
    if (!ns.length) continue;
    put(x, y, ns.some(isHead) ? P[0] : ns.includes('g') || ns.includes('k') ? GD[0] : ns.includes('l') || ns.includes('L') ? LEATHER[0] : ST[0]);
  }
  const out = (x, y) => !at(x, y);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = at(x, y); if (!c) continue;
    if (c === 'w') { put(x, y, style === 'B' ? ST[3] : (x + y) % 4 === 1 && kind !== 'sword' ? ST[4] : ST[3]); continue; }
    if (c === 'b') { put(x, y, ST[1]); continue; }
    if (c === 'l') { put(x, y, x % 2 ? LEATHER[3] : LEATHER[2]); continue; }
    if (c === 'L') { put(x, y, x % 2 ? LEATHER[1] : LEATHER[2]); continue; }
    const pal = c === 'g' || c === 'k' ? GD : P;
    const ul = out(x - 1, y) || out(x, y - 1), dr = out(x + 1, y) || out(x, y + 1);
    let t = ul && !dr ? 3 : dr && !ul ? 1 : 2;
    if (out(x - 1, y) && out(x, y - 1) && !dr) t = 4;
    if (style === 'B') {
      // 内側の濃い輪：外の縁のすぐ内側の右下側は「暗」、左上側も少し落とす。光は大きめの 2×2
      if (dr) t = 1;
      else if (ul) t = 3;
      if (isHead(c) && !ul && !dr && (out(x - 2, y) || out(x, y - 2)) && !(out(x + 2, y) || out(x, y + 2))) t = 4;
    }
    if (c === 'e') t = metal || mat === 'stone' ? 4 : 3; // 刃の縁の明るい線
    if (c === 'f') t = 1; // 溝
    if (c === '#') {
      if (mat === 'wood' && t === 2 && (x + 2 * y) % 5 === 0) t = 1; // 木目
      if (style === 'A' && metal && t === 2 && (x - y + 16) % 5 === 0) t = 3; // 光のすじ
      if (style === 'C' && metal && t === 2) { const [u] = uv(x, y); t = (Math.floor(u * 1.3 + x * 0.2) % 3 === 0) ? 3 : 2; } // 光沢
      if (style === 'C' && mat === 'wood' && t === 2 && (x + y) % 3 === 0) t = 3;
    }
    put(x, y, pal[t]);
  }
  return px;
}
