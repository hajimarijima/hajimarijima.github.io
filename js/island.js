// 島の形（サイト・sim.js・init.js・テストで共通。three.js を使わない）。
//   world.islands：[{ id, name, x, z, r, wob: [[ふれ幅, 回数, ずれ], ...], open }]
//     id 'main' はいつも行ける島。ほかの島は open（行けるようになった日）が入るまで行けない
//   world.bridges：[{ id, to, a: {x,z}, b: {x,z}, w, built }]（a は main の岸、b は向こうの島の岸）
//   world.islands がない古い world.json は、前の形（南の seaZ より先が海、あとは陸）として読む。
export const MAIN = 'main';

// 角度 ang の向きの、島のふちまでの半径
export function radiusAt(isl, ang) {
  let k = 1;
  for (const [amp, n, ph] of isl.wob || []) k += amp * Math.sin(n * ang + ph);
  return isl.r * k;
}
// 島のふちまでの距離（中は +、外は -）。ワールド座標
export function shoreDist(isl, x, z) {
  const dx = x - isl.x, dz = z - isl.z;
  return radiusAt(isl, Math.atan2(dz, dx)) - Math.hypot(dx, dz);
}
export const isOpen = (isl) => !!isl && (isl.id === MAIN || !!isl.open);
// (x, z) のある島（ふちから margin より内側）。なければ null
export function islandAt(world, x, z, margin = 0) {
  for (const isl of (world && world.islands) || []) if (shoreDist(isl, x, z) > margin) return isl;
  return null;
}
// 陸の上か。open：true なら、まだ行けない島は陸に数えない
export function onLand(world, x, z, margin = 0, { open = true } = {}) {
  if (!world || !world.islands) { // 前の形
    const half = (world && world.size ? world.size : 220) / 2;
    return z < (world ? world.seaZ : 34) - margin && Math.abs(x) < half - margin;
  }
  const isl = islandAt(world, x, z, margin);
  return !!isl && (!open || isOpen(isl));
}
// 村人が行ける所か（陸の上で、その島に行ける）
export const reachable = (world, x, z) => onLand(world, x, z, 0, { open: true });
// 島ごとの広さ（陸の面積のめやす）
export const areaOf = (isl) => Math.PI * isl.r * isl.r;
// 行ける島の中の、ふちから margin 以上内側の点を 1 つ（rand は 0〜1 を返す関数）。tries 回だめなら null
export function randomLand(world, rand, margin = 4, tries = 30) {
  const list = ((world && world.islands) || []).filter(isOpen);
  if (!list.length) return null;
  const tot = list.reduce((s, i) => s + areaOf(i), 0);
  for (let k = 0; k < tries; k++) {
    let u = rand() * tot, isl = list[0];
    for (const i of list) { if (u < areaOf(i)) { isl = i; break; } u -= areaOf(i); }
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * isl.r * 1.1;
    const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
    if (shoreDist(isl, x, z) > margin) return { x, z, island: isl.id };
  }
  return null;
}
// 島の中心から ang の向きの、ふちから inset 内側の点
export function shorePoint(isl, ang, inset = 0) {
  const r = radiusAt(isl, ang) - inset;
  return { x: isl.x + Math.cos(ang) * r, z: isl.z + Math.sin(ang) * r };
}
// 2 つの島を結ぶ橋の両はし（それぞれの岸から inset 陸の中へ入った所）。島の中心どうしを結ぶ線の上
export function bridgeEnds(a, b, inset = 2.5) {
  const ang = Math.atan2(b.z - a.z, b.x - a.x);
  return { a: shorePoint(a, ang, inset), b: shorePoint(b, ang + Math.PI, inset) };
}
// 点と橋（はばのある線）の距離
export function bridgeDist(br, x, z) {
  const vx = br.b.x - br.a.x, vz = br.b.z - br.a.z, L2 = vx * vx + vz * vz || 1;
  const u = Math.max(0, Math.min(1, ((x - br.a.x) * vx + (z - br.a.z) * vz) / L2));
  return Math.hypot(x - (br.a.x + vx * u), z - (br.a.z + vz * u));
}
// 島の名前（なければ ''）
export function islandName(world, x, z) {
  const isl = islandAt(world, x, z, -2);
  return isl && isl.id !== MAIN ? isl.name || '' : '';
}
