// 空の雲：薄く平たい箱を何枚か重ねた、落ち着いた形（マイクラの雲のように）。
// 上の面は明るく、下の面は少し暗い。少し透けて、ゆっくり一方向へ流れる。決まった種で同じ形になる
import * as THREE from 'three';

const geo = new THREE.BoxGeometry(1, 1, 1);
// 箱の面の順：+x, -x, +y（上）, -y（下）, +z, -z
function cloudMats(op) {
  const m = (c) => new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: op, depthWrite: true, fog: false });
  const side = m(0xe9edf2), top = m(0xffffff), bottom = m(0xd6dce4);
  return { list: [side, side, top, bottom, side, side], all: [side, top, bottom] };
}

// opts: count（雲の数）, area（広がる範囲の半径）, height（高さ）, seed, speed（流れる速さ）, opacity
export function makeClouds(scene, { count = 14, area = 160, height = 70, seed = 11, speed = 1.2, opacity = 0.82, scale = 1 } = {}) {
  let s = seed;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const mats = cloudMats(opacity);
  const group = new THREE.Group(); group.renderOrder = -4;
  const clouds = [];
  for (let i = 0; i < count; i++) {
    const c = new THREE.Group();
    // 大きな平たい板を 1 枚、その上と横に少し小さい板を 1〜3 枚（どれも同じ厚み）。ぼこぼこさせない
    const W = (14 + R() * 18) * scale, D = (8 + R() * 10) * scale, H = 2.2 * scale;
    const add = (w, d, x, y, z) => { const b = new THREE.Mesh(geo, mats.list); b.scale.set(w, H, d); b.position.set(x, y, z); b.castShadow = false; b.receiveShadow = false; c.add(b); };
    add(W, D, 0, 0, 0);
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const w = W * (0.35 + R() * 0.35), d = D * (0.4 + R() * 0.4);
      add(w, d, (R() - 0.5) * (W - w), k === 0 ? H * 0.9 : -H * 0.12 * k, (R() - 0.5) * (D - d) + (k === 0 ? 0 : (R() < 0.5 ? -1 : 1) * D * 0.45));
    }
    c.position.set((R() - 0.5) * 2 * area, height + R() * 12 * scale, (R() - 0.5) * 2 * area);
    group.add(c); clouds.push(c);
  }
  scene.add(group);
  const api = {
    group,
    // t：秒。x の向きへ流れ、端まで行ったら反対の端から出てくる
    update(t, center = { x: 0, z: 0 }) {
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        if (c.userData.x0 === undefined) c.userData.x0 = c.position.x;
        const x = ((c.userData.x0 + t * speed + area) % (2 * area) + 2 * area) % (2 * area) - area;
        c.position.x = center.x + x;
        if (c.userData.z0 === undefined) c.userData.z0 = c.position.z;
        c.position.z = center.z + c.userData.z0;
      }
    },
    // 夜は暗く、夕方は少し赤く（色は空に合わせて外から渡す）
    tint(color, op = opacity) { for (const m of mats.all) { m.color.copy(color); m.opacity = op; } mats.all[0].color.multiplyScalar(0.93); mats.all[2].color.multiplyScalar(0.88); },
  };
  return api;
}
