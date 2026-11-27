// 家の前の郵便受け（町の画面・村人のページ・家を飾るページで共通）。新しい手紙（今日の分）があると赤い旗が立つ。
// 前（投入口）は +z。家の前の小道の右の、道路に近いマスに立つ（js/decor.js の MAILBOX_CELL）
import * as THREE from 'three';
import { part } from './decor3d.js';

export function makeMailbox({ flag = false, seed = 'mb' } = {}) {
  const g = new THREE.Group();
  // 足もとの石と、木の柱（角を少し面取りしたように 2 段）
  part(g, 0.34, 0.08, 0.34, 0x8f8b84, 0, 0.04, 0);
  part(g, 0.26, 0.05, 0.26, 0xa8a49c, 0, 0.105, 0);
  part(g, 0.13, 0.98, 0.13, 0x7a5232, 0, 0.6, 0);
  part(g, 0.15, 0.06, 0.15, 0x5e3e24, 0, 0.3, 0);
  part(g, 0.3, 0.05, 0.3, 0x6b4628, 0, 1.1, 0); // 台
  // 箱（丸い屋根を 3 段で）
  const body = 0x3f6fa8, dark = 0x2c5080;
  part(g, 0.34, 0.26, 0.56, body, 0, 1.255, 0);
  part(g, 0.3, 0.06, 0.56, body, 0, 1.415, 0);
  part(g, 0.2, 0.04, 0.56, 0x5584bf, 0, 1.46, 0);
  for (const z of [-0.2, 0.2]) part(g, 0.36, 0.3, 0.035, dark, 0, 1.28, z); // 帯
  // 前のふた・投入口・取っ手
  part(g, 0.3, 0.3, 0.03, 0x4a7cb6, 0, 1.27, 0.29);
  part(g, 0.18, 0.035, 0.02, 0x1d2a3a, 0, 1.34, 0.31);
  part(g, 0.05, 0.05, 0.04, 0xd8c27a, 0, 1.2, 0.315);
  // 名前の札
  part(g, 0.02, 0.1, 0.24, 0xf2ead6, -0.18, 1.24, 0); // 左の横（旗は右）
  // 旗（右の横。根元を軸に回る）。立っている＝新しい手紙。帯（x 0.18 まで）に当たらないよう少し外
  const piv = new THREE.Group(); piv.position.set(0.205, 1.25, -0.12); g.add(piv);
  const arm = part(piv, 0.03, 0.34, 0.03, 0xb8b8b8, 0, 0.15, 0);
  part(piv, 0.025, 0.13, 0.16, 0xd8302c, 0, 0.26, 0.09);
  part(piv, 0.027, 0.04, 0.17, 0xa82420, 0, 0.21, 0.095);
  arm.userData.keep = true;
  piv.rotation.x = flag ? 0 : Math.PI / 2; // 寝かせる時は前へ倒す
  g.userData.flag = piv; g.userData.flagUp = !!flag;
  if (flag) {
    // 少しゆれる（町の画面の動きのループにさわらずに、描く時に角度を変える）
    const tip = piv.children[1];
    tip.onBeforeRender = () => { piv.rotation.z = Math.sin(performance.now() / 380 + seed.length) * 0.08; };
  }
  return g;
}
export function setMailboxFlag(mb, up) {
  const piv = mb.userData.flag; if (!piv) return;
  piv.rotation.x = up ? 0 : Math.PI / 2; mb.userData.flagUp = !!up;
}
