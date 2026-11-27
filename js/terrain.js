// どこまでも続く地形を描く（町の地図）。形は terrain_gen.js が決め、ここはカメラのまわりのチャンクだけを作って、離れたら捨てる。
// 軽くするための工夫（マイクラと同じ考え方）：
//   - 遠いチャンクほど簡単な形（LOD）：近くは 1 ブロックずつ、中くらいは 2×2、遠くは 4×4 をまとめた大きな箱
//   - 木と岩はチャンクごとに 1 つのメッシュにまとめる（見えない下の面は作らない）。遠くの木は幹と葉の塊 1 つだけで、影も落とさない
//   - 描く距離に上限をつけ、その手前から霧（フォグ）でかすませる
//   - 1 フレームに作るチャンクの数を決めて、カメラを動かしてもかくつかないようにする
import * as THREE from 'three';
import { BLOCK, CHUNK } from './terrain_gen.js';
import { makeChunkObjects } from './blocks.js';

// dgrass・dstone：敵の多い島の暗い草と石。ore_c・ore_i・ore_g：鉱石のまじった石（石炭・鉄・金）
const TOP = { grass: 0x7fb456, sand: 0xe3d29a, stone: 0x8d9095, snow: 0xf1f4f8, water: 0xc2b48a, dgrass: 0x4f7440, dstone: 0x62656c, ore_c: 0x5f6166, ore_i: 0xa98e78, ore_g: 0xb9a356 };
const SIDE = { grass: 0x8a6a46, sand: 0xd0bc84, stone: 0x767a80, snow: 0x9a9ea6, water: 0xa89a74, dgrass: 0x725c42, dstone: 0x5c5f66, ore_c: 0x4f5155, ore_i: 0x917a66, ore_g: 0x9e8b4a };
const WATER_Y = -0.3;
export const topY = (c) => (c.h >= 0 ? c.h * BLOCK : c.h * 1.1);

function chunkGeometry(gen, ci, cj, step) {
  const pos = [], nor = [], col = [];
  const C = new THREE.Color(), D = new THREE.Color();
  const rep = (i, j) => gen.cell(i + (step >> 1), j + (step >> 1)); // まとめた箱の代表のブロック
  const quad = (a, b, c, d, n, color) => { for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(color.r, color.g, color.b); } };
  const i0 = ci * CHUNK, j0 = cj * CHUNK, S = step * BLOCK;
  for (let a = 0; a < CHUNK; a += step) for (let b = 0; b < CHUNK; b += step) {
    const i = i0 + a, j = j0 + b, c = rep(i, j), y = topY(c);
    const x0 = i * BLOCK, z0 = j * BLOCK, x1 = x0 + S, z1 = z0 + S;
    // 上の面：1 ブロックずつ少しだけ色をゆらして、ブロックらしく
    const jit = step === 1 ? ((((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000) / 1000 - 0.5 : 0;
    C.setHex(TOP[c.kind]).multiplyScalar(1 + jit * 0.07);
    if (c.kind === 'grass' && c.w > 0) { const f = gen.forest(x0, z0); C.multiplyScalar(1 - f * 0.12); } // 森の中は少し暗い草
    quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], C);
    // 横の面：となりが低い所だけ
    for (const [dx, dz, n, shade] of [[1, 0, [1, 0, 0], 0.8], [-1, 0, [-1, 0, 0], 0.8], [0, 1, [0, 0, 1], 0.7], [0, -1, [0, 0, -1], 0.7]]) {
      const nc = rep(i + dx * step, j + dz * step), ny = topY(nc);
      if (ny >= y) continue;
      D.setHex(SIDE[c.kind]).multiplyScalar(shade);
      if (dx === 1) quad([x1, y, z0], [x1, y, z1], [x1, ny, z1], [x1, ny, z0], n, D);
      if (dx === -1) quad([x0, y, z1], [x0, y, z0], [x0, ny, z0], [x0, ny, z1], n, D);
      if (dz === 1) quad([x1, y, z1], [x0, y, z1], [x0, ny, z1], [x1, ny, z1], n, D);
      if (dz === -1) quad([x0, y, z0], [x1, y, z0], [x1, ny, z0], [x0, ny, z0], n, D);
      // 草のブロックは、横の面の上 1 段だけ緑（マイクラの草ブロック）
      if ((c.kind === 'grass' || c.kind === 'dgrass') && step === 1 && y - ny > 0.5) {
        const g = new THREE.Color(TOP[c.kind]).multiplyScalar(shade * 0.92), yy = y - 0.35, e = 0.01;
        if (dx === 1) quad([x1 + e, y, z0], [x1 + e, y, z1], [x1 + e, yy, z1], [x1 + e, yy, z0], n, g);
        if (dx === -1) quad([x0 - e, y, z1], [x0 - e, y, z0], [x0 - e, yy, z0], [x0 - e, yy, z1], n, g);
        if (dz === 1) quad([x1, y, z1 + e], [x0, y, z1 + e], [x0, yy, z1 + e], [x1, yy, z1 + e], n, g);
        if (dz === -1) quad([x0, y, z0 - e], [x1, y, z0 - e], [x1, yy, z0 - e], [x0, yy, z0 - e], n, g);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

// radius：描くチャンクの半径。lod：[1 ブロックずつの半径, 2×2 の半径]（それより遠くは 4×4）
export function makeTerrainView(scene, gen, { radius = 8, lod = [2, 5], perFrame = 3, treeNear = 3, rockNear = 4, shadow = true } = {}) {
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const chunks = new Map(); // key → { mesh, step, ci, cj }
  const objCache = new Map();
  const group = new THREE.Group(); scene.add(group);
  // 水：カメラについて動く 1 枚の水面。陸は水面より上なので、低い所（海・川・湖）だけに見える
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x3f8fc8, transparent: true, opacity: 0.86 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true;
  const span = (radius * 2 + 3) * CHUNK * BLOCK; water.scale.set(span, span, 1); scene.add(water);
  let center = null;
  const objMeshes = new Map(); // チャンク → 木と岩をまとめた 1 つのメッシュ（近い・遠いで形がちがう）
  const keyOf = (ci, cj) => ci + ',' + cj;
  const stepFor = (d) => (d <= lod[0] ? 1 : d <= lod[1] ? 2 : 4);
  const objectsOf = (ci, cj) => { const k = keyOf(ci, cj); let o = objCache.get(k); if (!o) { o = gen.chunkObjects(ci, cj); objCache.set(k, o); if (objCache.size > 2000) objCache.delete(objCache.keys().next().value); } return o; };
  // 木と岩：チャンクごとに 1 つのメッシュ（その中の箱を全部まとめた形）。近いチャンクは細かい木と岩、遠いチャンクは簡単な木だけ。
  // カメラが動いたら、変わったチャンクだけ作り直す（1 フレームに perFrame 個まで）
  function updateObjects() {
    for (const [k, c] of objMeshes) if (Math.max(Math.abs(c.ci - center.ci), Math.abs(c.cj - center.cj)) > radius) { group.remove(c.g); c.g.userData.dispose(); objMeshes.delete(k); }
    const todo = [];
    for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
      const d = Math.max(Math.abs(di), Math.abs(dj)), lite = d > treeNear, rocks = d <= rockNear, k = keyOf(center.ci + di, center.cj + dj), c = objMeshes.get(k);
      if (!c || c.lite !== lite || c.rocks !== rocks) todo.push({ d, k, c, lite, rocks, ci: center.ci + di, cj: center.cj + dj });
    }
    todo.sort((a, b) => a.d - b.d);
    for (const t of todo.slice(0, perFrame * 2)) {
      const o = objectsOf(t.ci, t.cj);
      const g = makeChunkObjects(t.rocks ? o.trees.concat(o.rocks) : o.trees, { lite: t.lite, shadow: shadow && !t.lite });
      if (t.c) { group.remove(t.c.g); t.c.g.userData.dispose(); }
      group.add(g); objMeshes.set(t.k, { g, lite: t.lite, rocks: t.rocks, ci: t.ci, cj: t.cj });
    }
    api.counts = { chunks: chunks.size, objChunks: objMeshes.size, objPending: Math.max(0, todo.length - perFrame * 2) };
  }
  const api = {
    gen, counts: {},
    // 毎フレーム呼ぶ。p はカメラの見ている所（controls.target）
    update(p) {
      const ci = Math.floor(p.x / (CHUNK * BLOCK)), cj = Math.floor(p.z / (CHUNK * BLOCK));
      if (!center || center.ci !== ci || center.cj !== cj) {
        center = { ci, cj };
        // 遠くなったチャンクは捨てる
        for (const [k, c] of chunks) if (Math.max(Math.abs(c.ci - ci), Math.abs(c.cj - cj)) > radius + 1) { group.remove(c.mesh); c.mesh.geometry.dispose(); chunks.delete(k); }
      }
      water.position.x = (ci + 0.5) * CHUNK * BLOCK; water.position.z = (cj + 0.5) * CHUNK * BLOCK;
      // 作る・作り直す（近い順に、1 フレームに perFrame 個まで）
      const todo = [];
      for (let di = -radius; di <= radius; di++) for (let dj = -radius; dj <= radius; dj++) {
        const d = Math.max(Math.abs(di), Math.abs(dj)), step = stepFor(d), k = keyOf(ci + di, cj + dj), c = chunks.get(k);
        if (!c || c.step !== step) todo.push({ d, di, dj, step, k, c });
      }
      // まだ何もないチャンクは、先にいちばん簡単な形（4×4）ですぐ埋める（水だけの穴が見えないように）。そのあと近い順に細かくする
      const missing = todo.filter((t) => !t.c && t.step !== 4).sort((a, b) => a.d - b.d).slice(0, perFrame * 6).map((t) => ({ ...t, step: 4 }));
      todo.sort((a, b) => a.d - b.d);
      const work = missing.length ? missing.concat(todo.filter((t) => !t.c && t.step === 4).slice(0, perFrame * 6)) : todo.slice(0, perFrame);
      for (const t of work) {
        const geo = chunkGeometry(gen, ci + t.di, cj + t.dj, t.step);
        if (t.c) { group.remove(t.c.mesh); t.c.mesh.geometry.dispose(); }
        const mesh = new THREE.Mesh(geo, groundMat);
        mesh.receiveShadow = shadow; mesh.castShadow = shadow && t.step === 1; mesh.matrixAutoUpdate = false;
        group.add(mesh); chunks.set(t.k, { mesh, step: t.step, ci: ci + t.di, cj: cj + t.dj });
        t.c = chunks.get(t.k);
      }
      updateObjects();
      api.pending = Math.max(0, todo.length - work.length);
      return api;
    },
    heightAt: (x, z) => gen.heightAt(x, z),
  };
  return api;
}
