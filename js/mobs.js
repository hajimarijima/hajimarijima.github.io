// 夜に来る敵の模型（自作の箱型）。ゾンビ・スケルトン・クモ。
// ゾンビとスケルトンの肌や服は、ここで描く 16px のドット絵（左上が明るく右下が暗い陰で立体に見せる）。
import * as THREE from 'three';
import { pixelTex, px, pixelRng } from './blocks.js';

const M = (c) => new THREE.MeshLambertMaterial({ color: c });
const GLOW = (c) => new THREE.MeshBasicMaterial({ color: c }); // 暗くても見える目
const mats = {
  bone: M(0xe6e0cf), bone2: M(0xc9c2ad), dark: M(0x2a2622),
  sBody: M(0x3b2c2a), sBody2: M(0x2a1f1e), sStripe: M(0xb86a2a), sLeg: M(0x2f2322),
  eyeB: GLOW(0x9fe8ff), eyeR: GLOW(0xff5a48), eyeHi: GLOW(0xffffff), eyeZ: GLOW(0x9a2a1e),
  bow: M(0x7a5232), bow2: M(0x5a3a20), string: M(0xeae6da), shaft: M(0xc8a878), tip: M(0x8c9298), feather: M(0xe8e4dc),
  flame: new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.95 }),
  flame2: new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95 }),
  smoke: new THREE.MeshLambertMaterial({ color: 0x55504a, transparent: true, opacity: 0.6 }),
};
function b(w, h, d, m, x, y, z, p) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; p.add(o); return o; }
const pivot = (x, y, z, p) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
const tex = (k, draw) => new THREE.MeshLambertMaterial({ map: pixelTex('mob:' + k, draw) });

// ---------- ゾンビのドット絵（明るくやわらかい緑、少しとぼけた丸い目） ----------
const SK = ['#a6d67c', '#9fcf75', '#addc84', '#99c96f', '#b2df89'];   // 明るい若草色の肌（顔も手も同じ）
const pick = (R, a) => a[Math.floor(R() * a.length)];
function skin(g, R) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, SK));
  const x = Math.floor(R() * 12) + 1, y = Math.floor(R() * 12) + 1; px(g, x, y, '#93c26a'); // まだらは 1 つだけ（目立たない）
  for (let i = 0; i < 16; i++) { px(g, i, 0, '#c2e8a0'); px(g, 0, i, '#bce39a'); px(g, i, 15, '#84b660'); px(g, 15, i, '#88b964'); } // 左上明るく右下暗く
}
const zSkin = () => tex('zskin', skin);
const zTop = () => tex('ztop', (g, R) => { skin(g, R); for (let k = 0; k < 14; k++) px(g, Math.floor(R() * 16), Math.floor(R() * 16), pick(R, ['#5a4632', '#4e3c2a'])); }); // うすい髪
const zFace = () => tex('zface', (g, R) => {
  skin(g, R);
  // 丸い白目に小さな黒目（左右で少しずれて、とぼけた感じ）
  for (const [ex, px0, py0] of [[2, 4, 7], [9, 10, 6]]) {
    for (let x = ex; x < ex + 5; x++) for (let y = 4; y < 9; y++) { const cx = x - ex, cy = y - 4; if ((cx === 0 || cx === 4) && (cy === 0 || cy === 4)) continue; px(g, x, y, cy === 4 || cx === 4 ? '#dfe6d8' : '#fbfdf6'); }
    px(g, px0, py0, '#1c2218'); px(g, px0 + 1, py0, '#1c2218'); px(g, px0, py0 + 1, '#1c2218'); px(g, px0 + 1, py0 + 1, '#2a3224');
    px(g, px0, py0, '#3c4636'); // 黒目の光の向き
  }
  px(g, 7, 10, '#82aa70'); px(g, 8, 10, '#82aa70'); // 小さな鼻
  // 小さく開いた口
  for (let x = 6; x < 10; x++) for (let y = 12; y < 14; y++) px(g, x, y, y === 12 ? '#5a3a30' : '#3e2620');
  px(g, 6, 12, '#e8e2c8');
});
// 服：明るい水色のシャツと青いズボン。ほころびは小さく少しだけ
function rag(g, R, base, hi, lo, hole) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, base));
  for (let y = 4; y < 16; y += 6) for (let x = 0; x < 16; x++) if (R() < 0.35) px(g, x, y, '#00000018'); // 布のしわ
  for (const [hx, hy, w, h] of hole) {
    for (let y = hy; y < hy + h; y++) for (let x = hx; x < hx + w; x++) px(g, x, y, pick(R, SK));
    for (let x = hx; x < hx + w; x++) px(g, x, hy - 1, lo);
  }
  for (let i = 0; i < 16; i++) { px(g, i, 0, hi); px(g, 0, i, hi); px(g, i, 15, lo); px(g, 15, i, lo); }
}
const SHIRT = ['#5fb6c8', '#58adbf', '#66bdcf', '#52a5b8'];
const zShirt = () => tex('zshirt', (g, R) => rag(g, R, SHIRT, '#86d2e0', '#3f8798', []));
const zShirtB = () => tex('zshirtb', (g, R) => rag(g, R, SHIRT, '#86d2e0', '#3f8798', []));
const PANTS = ['#5a64b4', '#535daa', '#626cbc', '#4e57a2'];
const zPants = () => tex('zpants', (g, R) => rag(g, R, PANTS, '#7a84cc', '#3c4488', []));
// 腕：上は袖、下は肌。袖の端はまっすぐにそろえ、すぐ下の肌に細い影を 1 列入れて自然につなぐ
const zArm = () => tex('zarm', (g, R) => { skin(g, R); for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) px(g, x, y, y === 5 ? '#4a98aa' : pick(R, SHIRT)); for (let x = 0; x < 16; x++) { px(g, x, 0, '#86d2e0'); px(g, x, 6, '#93c26a'); } });
const six = (side, top, bottom, front, back) => [side, side, top, bottom, front, back || side];

const zMats = { eyeW: new THREE.MeshLambertMaterial({ color: 0xf6f8f0, emissive: 0x5a5c54 }), pupil: new THREE.MeshLambertMaterial({ color: 0x1a2016 }) };
function zombie() {
  const root = new THREE.Group(), body = pivot(0, 0, 0, root);
  const sk = zSkin(), pa = zPants(), sh = zShirt(), shB = zShirtB(), ar = zArm();
  const legL = pivot(0.15, 0.8, 0, body), legR = pivot(-0.15, 0.8, 0, body);
  for (const l of [legL, legR]) { b(0.28, 0.8, 0.28, pa, 0, -0.4, 0, l); b(0.3, 0.1, 0.33, M(0x6a4a34), 0, -0.75, 0.03, l); }
  const torso = pivot(0, 0.8, 0, body);
  b(0.58, 0.74, 0.3, six(shB, sh, sh, sh, shB), 0, 0.37, 0, torso);
  // すその垂れた布（ぎざぎざに見えるよう少しずらして傾ける）
    const head = pivot(0, 0.74, 0, torso);
  const tp = zTop(), fc = zFace();
  b(0.58, 0.56, 0.56, six(sk, tp, sk, fc), 0, 0.28, 0, head); // 頭は少し大きめ（てっぺんの板はなし）
  // 丸い白目（たいまつの色に染まらないよう少し自分で光る）と、左右で少しずれた小さな黒目
  for (const [ex, pxx, pyy] of [[-0.127, -0.112, 0.29], [0.127, 0.112, 0.325]]) {
    b(0.16, 0.13, 0.02, zMats.eyeW, ex, 0.33, 0.285, head); b(0.13, 0.16, 0.02, zMats.eyeW, ex, 0.33, 0.285, head);
    b(0.075, 0.075, 0.02, zMats.pupil, pxx, pyy, 0.3, head);
  }
  for (const m of [pa, sh, shB]) m.emissive.setHex(0x1e2a1a); // 夜でも服の色が分かるよう少しだけ光らせる
  const skH = zSkin(); // 手の先（下の面）専用
  for (const m of [sk, tp, fc, ar, skH]) { m.emissive.setHex(0x2e4a20); m.color.setHex(0xdcf2e6); } // 少し青みを掛けて、たいまつの黄色を打ち消す
  skH.emissive.setHex(0x36562a); skH.color.setHex(0xcfeedd); // 肌は顔も手も同じ若草色に。たいまつで黄ばまないよう緑で少し光らせる
  const armL = pivot(0.4, 0.66, 0, torso), armR = pivot(-0.4, 0.66, 0, torso);
  const armM = six(ar, sh, skH, ar, ar); // 手の先（下の面）は肌だけ、肩（上の面）は服
  b(0.22, 0.74, 0.22, armM, 0, -0.33, 0, armL); b(0.22, 0.74, 0.22, armM, 0, -0.33, 0, armR);
  root.userData.mob = { type: 'zombie', parts: { body, torso, head, armL, armR, legL, legR } };
  return root;
}

// ---------- スケルトン：細い骨と弓。少し離れた所で止まって矢を放つ ----------
// 弓は腕の向きによらず縦のまま（向きは腕の左右の向きだけ合わせる）。弦は両端から「引く点」への 2 本の線で V 字になり、
// 引く点は右手と一緒に動く。放すと（pull 0）まっすぐに戻る。弓の本体は回したり伸ばしたりしない
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _eu = new THREE.Euler(), _v = new THREE.Vector3(), _np = new THREE.Vector3(), _d = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _Yd = new THREE.Vector3(0, -1, 0);
const BOW_TIPS = [new THREE.Vector3(0, 0.36, -0.03), new THREE.Vector3(0, -0.36, -0.03)];
function setBow(g, P, pull) {
  const bow = P.bow;
  _q.setFromEuler(P.armL.rotation).invert(); _q2.setFromEuler(_eu.set(0, P.armL.rotation.y, 0));
  bow.quaternion.copy(_q).multiply(_q2);
  _np.set(0, 0, -0.03 - 0.3 * Math.min(1, pull)); // 引く点：弓の面の中で、引くほど体の方へ
  if (pull > 0) {
    // 右手の先を引く点へ向ける（届かない分は肩を少し後ろへ引く）。手と弦がいっしょに動く
    const A = P.armR; A.userData.base ??= A.position.clone();
    g.updateMatrixWorld(true);
    _v.copy(_np); bow.localToWorld(_v); A.parent.worldToLocal(_v); // 引く点（胴の中の座標）
    const B = A.userData.base, dx = _v.x - B.x, dy = _v.y - B.y, dz = _v.z - B.z, L = 0.74;
    const s = Math.max(0, Math.min(0.3, Math.sqrt(Math.max(0, L * L - dx * dx - dy * dy)) - dz));
    A.position.set(B.x, B.y, B.z - s);
    _d.set(dx, dy, dz + s).normalize(); A.quaternion.setFromUnitVectors(_Yd, _d);
  }
  bow.userData.string.forEach((s, i) => {
    const T = BOW_TIPS[i]; _d.subVectors(_np, T); const len = _d.length();
    s.position.copy(T).addScaledVector(_d, 0.5); s.scale.set(1, len / 0.34, 1); s.quaternion.setFromUnitVectors(_Y, _d.normalize());
  });
  P.nock.position.set(0.035, _np.y, _np.z + 0.33); P.nock.rotation.set(0, 0, 0);
}
function makeBow() {
  const g = new THREE.Group();
  const seg = [[0, 0, 0.12, 0], [0, 0.17, 0.09, 0.35], [0, -0.17, 0.09, -0.35], [0, 0.31, 0.03, 0.75], [0, -0.31, 0.03, -0.75]];
  for (const [x, y, z, r] of seg) b(0.05, 0.18, 0.05, r === 0 ? mats.bow2 : mats.bow, x, y, z, g).rotation.x = -r;
  const s1 = b(0.015, 0.34, 0.015, mats.string, 0, 0.19, -0.03, g), s2 = b(0.015, 0.34, 0.015, mats.string, 0, -0.19, -0.03, g);
  g.userData.string = [s1, s2];
  return g;
}
export function makeArrow() {
  const g = new THREE.Group();
  b(0.035, 0.035, 0.66, mats.shaft, 0, 0, 0, g);
  b(0.07, 0.07, 0.1, mats.tip, 0, 0, 0.36, g);
  b(0.012, 0.09, 0.14, mats.feather, 0, 0, -0.28, g); b(0.09, 0.012, 0.14, mats.feather, 0, 0, -0.28, g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// 骨のドット絵：左上が明るく右下が暗い。ところどころ黄ばみと細いひび
const boneTex = (k, base, hi, lo) => tex(k, (g, R) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, base));
  for (let i = 0; i < 6; i++) px(g, Math.floor(R() * 16), Math.floor(R() * 16), lo);
  for (let i = 0; i < 16; i++) { px(g, i, 0, hi); px(g, 0, i, hi); px(g, i, 15, lo); px(g, 15, i, lo); }
});
const BONE = ['#f8f1dc', '#f3ead2', '#fbf5e3', '#efe5cb']; // 明るいアイボリー（象牙色）
const sBone = () => boneTex('bone', BONE, '#fffbee', '#c4b59c'); // 陰はうす茶灰色
const sJoint = () => boneTex('joint', ['#e6dbc0', '#e0d4b8', '#eadfc6'], '#f8f1dc', '#b8a98f');
// 頭がいの正面：くぼんだ目（奥は暗い）、鼻の穴、歯の並び
const sSkull = () => tex('skullf', (g, R) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, BONE));
  for (let i = 0; i < 16; i++) { px(g, i, 0, '#fffbee'); px(g, 0, i, '#fdf7e6'); px(g, 15, i, '#c4b59c'); }
  for (const ex of [2, 9]) for (let x = ex; x < ex + 5; x++) for (let y = 4; y < 9; y++) { const cx = x - ex, cy = y - 4; if ((cx === 0 || cx === 4) && (cy === 0 || cy === 4)) continue; px(g, x, y, cy === 0 ? '#6a5f4f' : '#2a241c'); } // 丸い大きな目のくぼみ
  px(g, 7, 10, '#2a251e'); px(g, 8, 10, '#2a251e'); px(g, 7, 11, '#3a342a'); // 鼻
  for (let x = 5; x < 11; x++) px(g, x, 13, x % 2 ? '#8a7c66' : '#b3a58c'); // 歯（細く短い線）
  for (let x = 0; x < 16; x++) px(g, x, 15, '#c4b59c');
});
function skeleton() {
  const root = new THREE.Group(), body = pivot(0, 0, 0, root);
  const bn = sBone(), jt = sJoint();
  const legL = pivot(0.14, 0.88, 0, body), legR = pivot(-0.14, 0.88, 0, body);
  for (const l of [legL, legR]) {
    b(0.13, 0.42, 0.13, bn, 0, -0.21, 0, l); b(0.17, 0.09, 0.17, jt, 0, -0.44, 0.005, l); // ふともも・ひざ
    b(0.12, 0.4, 0.12, bn, 0, -0.66, 0, l); b(0.18, 0.07, 0.28, jt, 0, -0.845, 0.05, l); // すね・足
  }
  const torso = pivot(0, 0.88, 0, body);
  b(0.44, 0.13, 0.2, jt, 0, 0.03, 0, torso); // 腰の骨
  b(0.1, 0.64, 0.1, bn, 0, 0.38, -0.08, torso); // 背骨
  // あばら：左右の骨と前の骨で「輪」にして、すき間から中が見えるように（ぺたんとした板にしない）
  for (let i = 0; i < 4; i++) {
    const y = 0.3 + i * 0.12, w = 0.38 - i * 0.025;
    for (const sx of [1, -1]) b(0.06, 0.065, 0.26, bn, sx * (w / 2 - 0.03), y, 0.01, torso);
    b(w, 0.065, 0.06, bn, 0, y, 0.12, torso);
  }
  b(0.08, 0.44, 0.05, jt, 0, 0.48, 0.16, torso); // 胸の骨（前へ少し出す）
  b(0.62, 0.11, 0.18, jt, 0, 0.76, 0, torso); // 肩
  const head = pivot(0, 0.81, 0, torso);
  // 頭がい：一回り大きく、角を落とした形（横に広い箱と縦に高い箱を組む。前の面は奥行きをずらして重ねない）
  const skull = sSkull();
  b(0.54, 0.5, 0.52, six(bn, bn, jt, skull), 0, 0.3, 0, head);
  b(0.6, 0.4, 0.46, six(bn, bn, jt, bn), 0, 0.3, 0, head);
  b(0.46, 0.56, 0.46, six(bn, bn, jt, bn), 0, 0.3, 0, head);
  b(0.38, 0.1, 0.38, jt, 0, 0.02, 0.04, head); // あご（頭より細い）
  // 目の光：くぼみの奥の小さな点（明るすぎない青白）
  for (const ex of [0.13, -0.13]) { b(0.11, 0.09, 0.02, mats.eyeB, ex, 0.32, 0.265, head); b(0.09, 0.11, 0.02, mats.eyeB, ex, 0.32, 0.265, head); } // 丸い青白い光（少し大きめ）
  const armL = pivot(0.33, 0.72, 0, torso), armR = pivot(-0.33, 0.72, 0, torso);
  for (const a of [armL, armR]) { b(0.1, 0.36, 0.1, bn, 0, -0.18, 0, a); b(0.12, 0.07, 0.12, jt, 0, -0.37, 0, a); b(0.09, 0.32, 0.09, bn, 0, -0.55, 0.005, a); b(0.11, 0.08, 0.11, jt, 0, -0.73, 0.01, a); }
  const bow = makeBow(); bow.position.set(0, -0.74, 0.02); armL.add(bow); // 弓は左手。腕の向きに合わせて、いつも縦に持つ（animateMob で傾きを戻す）
  const nock = makeArrow(); bow.add(nock); // つがえた矢（弓の子。矢筈は弦を引く点に合わせる）
  for (const m of [bn, jt, skull]) m.emissive.setHex(0x4a4232); // 夜でも骨と分かるよう、ほんの少し自分で光らせる
  root.userData.mob = { type: 'skeleton', parts: { body, torso, head, armL, armR, legL, legR, bow, nock } };
  return root;
}
// ---------- クモ：低く平たい胴、赤い目 8 つ、胴の横から張り出して膝で折れる細い脚 8 本 ----------
// 毛のざらつき：暗い茶黒に、上の面は明るい毛先、下の面ほど暗く
const FUR = ['#7a5e48', '#715641', '#83654d', '#6b513e']; // 明るめの茶色
function fur(g, R, top) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = pick(R, FUR);
    if (!top && y > 10) c = R() < 0.6 ? '#54402f' : '#4b3a2b'; // 横の面：下ほど暗い
    px(g, x, y, c);
  }
  for (let i = 0; i < (top ? 34 : 18); i++) px(g, Math.floor(R() * 16), Math.floor(R() * (top ? 16 : 9)), pick(R, ['#a5856a', '#9a7b60', '#b08f72'])); // 毛先
  for (let i = 0; i < 16; i++) { px(g, i, 0, top ? '#b8977a' : '#9a7b60'); px(g, 15, i, '#4a3828'); }
}
const spTop = () => tex('sptop', (g, R) => fur(g, R, true));
const spSide = () => tex('spside', (g, R) => fur(g, R, false));
const spBot = () => tex('spbot', (g, R) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, pick(R, ['#3e2f24', '#433327', '#3a2c21'])); });
// 腹の上：くすんだ赤茶の山形の模様（目立ちすぎない）
const spAbd = () => tex('spabd', (g, R) => {
  fur(g, R, true);
  for (let r = 0; r < 3; r++) { const y = 3 + r * 4; for (let d = 0; d < 4 - r; d++) { px(g, 7 - d, y + d, '#9a5a3a'); px(g, 8 + d, y + d, '#9a5a3a'); } }
  px(g, 7, 2, '#a8653f'); px(g, 8, 2, '#a8653f');
});
const spLeg = () => tex('spleg', (g, R) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(g, x, y, y < 5 ? pick(R, ['#9a7b60', '#8f7258']) : y > 11 ? '#4a3828' : pick(R, ['#6f5541', '#694f3d']));
  for (let x = 0; x < 16; x += 3) px(g, x, 4, '#b8977a'); // 毛
});
function spider() {
  const root = new THREE.Group(), body = pivot(0, 0.235, 0, root);
  const T = spTop(), S = spSide(), Bm = spBot(), LG = spLeg(), AB = spAbd();
  for (const m of [T, S, LG, AB]) m.emissive.setHex(0x2a1e14); // 夜でも茶色と毛の模様が見えるよう、少しだけ自分で光らせる
  b(0.6, 0.28, 0.5, six(S, T, Bm, S), 0, 0.02, 0.2, body); // 頭胸（低く平たい。頭は少し大きめ）
  const abd = pivot(0, 0.04, -0.02, body);
  b(0.7, 0.34, 0.6, six(S, AB, Bm, S), 0, 0.06, -0.36, abd); // 腹（丸く短め）
  b(0.52, 0.07, 0.44, six(S, AB, Bm, S), 0, 0.265, -0.36, abd); // 腹の上の丸み（角を落として見せる）
  // 赤い目 8 つ：下の列に大きな 2 つと小さな 2 つ、上の列に小さな 4 つ
  // 大きな丸い目 2 つ（白い光の点つき）＋小さな目 6 つ。目は顔より少し前に出して、面を重ねない
  for (const sx of [1, -1]) { b(0.13, 0.13, 0.02, mats.eyeR, sx * 0.1, 0.05, 0.46, body); b(0.11, 0.15, 0.02, mats.eyeR, sx * 0.1, 0.05, 0.46, body); b(0.15, 0.11, 0.02, mats.eyeR, sx * 0.1, 0.05, 0.46, body); b(0.035, 0.035, 0.02, mats.eyeHi, sx * 0.1 - 0.03, 0.08, 0.475, body); }
  for (const [x, y, sz] of [[0.215, 0.04, 0.045], [-0.215, 0.04, 0.045], [0.05, 0.14, 0.04], [-0.05, 0.14, 0.04], [0.17, 0.13, 0.035], [-0.17, 0.13, 0.035]]) b(sz, sz, 0.02, mats.eyeR, x, y, 0.46, body);
  b(0.06, 0.09, 0.06, LG, 0.06, -0.14, 0.42, body); b(0.06, 0.09, 0.06, LG, -0.06, -0.14, 0.42, body); // 小さなきば
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const s = i < 4 ? 1 : -1, k = i % 4;
    const hip = pivot(s * 0.25, 0.02, 0.36 - k * 0.14, body);
    const base = -s * (0.75 - k * 0.5); // 前の脚は前へ、後ろの脚は後ろへ広がる
    hip.rotation.y = base;
    const up = pivot(0, 0, 0, hip); up.rotation.z = s * 0.75; // 胴から上へ上がる
    b(0.5, 0.045, 0.045, LG, s * 0.25, 0, 0, up); // 細い脚
    b(0.075, 0.075, 0.075, LG, s * 0.5, 0, 0, up); // ひざだけ少し太い
    const low = pivot(s * 0.5, 0, 0, up); low.rotation.z = -s * 1.9; // ひざで折れて、下へ降りて地面につく
    b(0.62, 0.035, 0.035, LG, s * 0.31, 0, 0, low);
    legs.push({ hip, up, low, s, k, base, grp: (k + (s > 0 ? 0 : 1)) % 2 });
  }
  root.userData.mob = { type: 'spider', parts: { body, abd, legs } };
  return root;
}
// 敵の大きさ（村人は 1.9 倍。並べて違和感がないよう、少しだけ大きく）
export const MOB_SCALE = 2.0;
export function makeMob(type) { const g = type === 'skeleton' ? skeleton() : type === 'spider' ? spider() : zombie(); g.scale.setScalar(MOB_SCALE); return g; }

// 朝日で燃える火と煙（ゾンビの子にして一緒に動く）
function burnFx(g, t, k) {
  let F = g.userData.fire;
  if (!F) {
    F = new THREE.Group(); F.userData.parts = [];
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), i % 3 ? mats.flame : mats.flame2); F.add(m); F.userData.parts.push(m); }
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mats.smoke.clone()); F.add(m); F.userData.parts.push(m); }
    g.add(F); g.userData.fire = F;
  }
  F.visible = k > 0 && k < 1;
  const R = pixelRng('fire' + g.id);
  F.userData.parts.forEach((m, i) => {
    const sx = (R() - 0.5) * 0.6, sz = (R() - 0.5) * 0.4, ph = R();
    if (i < 10) { // 炎：体のまわりで上へゆらぐ
      const u = (t * 2.2 + ph) % 1;
      m.position.set(sx, 0.3 + R() * 1.4 + u * 0.5, sz); m.scale.set(1 - u * 0.6, (1 - u) * 1.4 + 0.3, 1 - u * 0.6);
      m.visible = true;
    } else { // 煙：上へのぼって薄くなる
      const u = (t * 0.6 + ph) % 1;
      m.position.set(sx * 1.4, 1.6 + u * 2.2, sz); m.scale.setScalar(0.6 + u * 1.6); m.material.opacity = 0.55 * (1 - u);
    }
  });
}

// mode: 'walk'（近づく）| 'hit'（たたかれてひるむ）| 'flee'（逃げる）| 'burn'（朝日で燃える）| 'shoot'（スケルトンが弓を引いて放つ。k: 0..1 の 1 回分）
export function animateMob(g, mode, t, k = 0) {
  const { type, parts: P } = g.userData.mob;
  const seed = (g.id % 7) * 0.9;
  if (type === 'spider') {
    // 歩く：4 本ずつ交互に（左の 1・3 本目と右の 2・4 本目が一組）。上げた脚を前へ運び、地面の脚は後ろへ
    const moving = mode === 'walk' || mode === 'flee', sp = mode === 'flee' ? 15 : 9;
    P.legs.forEach((L) => {
      const ph = t * sp + seed + (L.grp ? Math.PI : 0);
      const lift = moving ? Math.max(0, Math.sin(ph)) : 0, sw = moving ? Math.cos(ph) : 0;
      L.hip.rotation.y = L.base + L.s * 0.22 * sw;
      L.up.rotation.z = L.s * (0.75 + 0.3 * lift + (moving ? 0 : Math.sin(t * 1.5 + L.k) * 0.03));
      L.low.rotation.z = -L.s * (1.9 + 0.15 * lift);
    });
    if (mode === 'punch' && P.legs) for (const L of P.legs) if (L.k === 0) { const r = Math.sin(Math.min(1, k / 0.45) * Math.PI); L.up.rotation.z = L.s * (0.75 + 0.7 * r); } // 前脚を振り上げる
    P.body.position.y = 0.235 + (moving ? Math.abs(Math.sin(t * sp + seed)) * 0.025 : 0) + (mode === 'hit' ? Math.sin(k * Math.PI) * 0.2 : 0);
    P.abd.rotation.x = Math.sin(t * 2 + seed) * 0.06;
    P.body.rotation.x = mode === 'hit' ? -0.4 * Math.sin(k * Math.PI) : 0;
    if (mode === 'punch') { const j = k < 0.3 ? -k / 0.3 : k < 0.45 ? -1 + ((k - 0.3) / 0.15) * 2.2 : 1.2 * (1 - (k - 0.45) / 0.55); P.body.rotation.x = -0.35 * Math.max(0, -j) + 0.25 * Math.max(0, j); P.body.position.z = 0.25 * Math.max(0, j); } // 身を起こしてから飛びかかってかむ
    else P.body.position.z = 0;
  } else if (type === 'zombie') {
    // 腕を前に出し、左右にふらふら揺れながら歩く
    const sp = mode === 'flee' ? 9 : 3.6, still = mode === 'burn';
    const s = still ? 0 : Math.sin(t * sp + seed) * 0.42;
    P.legL.rotation.x = s; P.legR.rotation.x = -s;
    P.armL.rotation.set(-1.45 + Math.sin(t * 2.1 + seed) * 0.12, 0, 0.06); P.armR.rotation.set(-1.32 - Math.sin(t * 1.7 + seed) * 0.14, 0, -0.08);
    P.body.rotation.z = Math.sin(t * sp / 2 + seed) * 0.11;
    P.head.rotation.set(0.1, Math.sin(t * 0.9 + seed) * 0.2, 0.18 + Math.sin(t * 1.3) * 0.08);
    P.body.position.y = Math.abs(Math.cos(t * sp + seed)) * 0.04;
    P.torso.rotation.x = 0.08 + (mode === 'hit' ? -0.55 * Math.sin(k * Math.PI) : 0) + (mode === 'flee' ? 0.2 : 0);
    if (still) { P.armL.rotation.x = -1.0 - Math.sin(t * 9) * 0.5; P.armR.rotation.x = -1.2 + Math.sin(t * 8) * 0.5; P.body.rotation.z = Math.sin(t * 7) * 0.15; } // 燃えてもがく
    if (mode === 'punch') {
      // なぐる：右腕を上へ振りかぶって（0〜0.35）、前へ振り下ろす（0.35〜0.5）。体ごと前へのめる
      const wind = k < 0.35 ? k / 0.35 : 0, down = k >= 0.35 && k < 0.5 ? (k - 0.35) / 0.15 : k >= 0.5 ? Math.max(0, 1 - (k - 0.5) / 0.5) : 0;
      P.armR.rotation.set(-1.4 - wind * 1.2 + down * 0.9, 0, -0.08 - wind * 0.1);
      P.armL.rotation.x = -1.5 + down * 0.25;
      P.torso.rotation.x = 0.08 - wind * 0.18 + down * 0.32;
      P.body.position.z = down * 0.22; P.legL.rotation.x = -0.3 * down; P.legR.rotation.x = 0.35 * down;
    } else P.body.position.z = 0;
  } else {
    const sp = mode === 'flee' ? 11 : 6.5;
    const moving = mode === 'walk' || mode === 'flee';
    const s = moving ? Math.sin(t * sp + seed) * 0.6 : 0;
    P.legL.rotation.x = s; P.legR.rotation.x = -s;
    P.body.position.y = moving ? Math.abs(Math.cos(t * sp + seed)) * 0.04 : 0;
    P.torso.rotation.set(0.05 + (mode === 'hit' ? -0.6 * Math.sin(k * Math.PI) : 0) + (mode === 'flee' ? 0.25 : 0), 0, 0);
    P.head.rotation.y = 0; P.body.rotation.y = 0;
    if (mode === 'shoot') {
      // 弓を前へ、右手で弦を引いて（0〜0.6）、放つ（0.6）。少し体を横に向ける
      const pull = k < 0.6 ? Math.min(1, k / 0.5) : Math.max(0, 1 - (k - 0.6) * 6);
      P.body.rotation.y = 0.35; P.head.rotation.y = -0.35;
      P.armL.rotation.set(-1.55, -0.35, 0);
      P.armR.rotation.set(-1.5 + pull * 0.1, 0.45 - pull * 0.35, 0);
      P.armR.position.z = -pull * 0.18;
      P.nock.visible = k < 0.6;
      setBow(g, P, pull);
    } else {
      P.armR.position.z = 0;
      P.armL.rotation.set(moving ? -s * 0.6 - 0.3 : -0.4, 0, 0); P.armR.rotation.set(moving ? s * 0.8 : 0.1, 0, 0);
      P.nock.visible = false;
      setBow(g, P, 0);
    }
  }
  g.visible = true;
  if (mode === 'burn') {
    g.scale.setScalar(MOB_SCALE * (1 - Math.max(0, k - 0.5) * 1.6)); // 燃えてから、最後に小さくなって消える
    g.position.y = 0;
    burnFx(g, t, k);
  } else if (g.userData.fire) g.userData.fire.visible = false;
}

// たたかれた時に赤く光る（a: 0..1）。色は敵ごとに別の材質にしてから変える（ほかの敵まで光らないように）
// 森の端まで走って行ってから、少しずつ薄くなって消える（a＝1 で見える、0 で消える）。その場でパッとは消さない
export function fadeMob(g, a) {
  a = Math.max(0, Math.min(1, a));
  if ((g.userData.fade ?? 1) !== a) {
    if (!g.userData.flash) flashMob(g, 0);
    g.userData.fade = a;
    for (const { m } of g.userData.flash.list) { m.transparent = a < 1; m.opacity = a; m.depthWrite = a > 0.6; }
    g.traverse((o) => { if (o.isMesh) o.castShadow = a > 0.5; });
  }
  if (a < 1) g.visible = a > 0.01; // animateMob が毎コマ visible を true に戻すので、薄い間は毎回決める
}
export function flashMob(g, a) {
  const P = g.userData.mob.parts;
  if (!g.userData.flash) {
    const list = [];
    P.body.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) if (m.emissive) list.push({ m, base: m.emissive.clone() });
    });
    g.userData.flash = { list, a: -1 };
  }
  const F = g.userData.flash;
  if (Math.abs(F.a - a) < 0.02) return;
  F.a = a;
  for (const { m, base } of F.list) m.emissive.setRGB(base.r + 0.3 * a, base.g + 0.02 * a, base.b + 0.01 * a);
}

// 当たった所に飛ぶ火花（黄・白）と、小さな煙。ドット絵らしく小さな四角で。p: 0..1（1 で消える）
const sparkMats = [new THREE.MeshBasicMaterial({ color: 0xfff1a0 }), new THREE.MeshBasicMaterial({ color: 0xffb03a }), new THREE.MeshBasicMaterial({ color: 0xffffff })];
const sparkGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09), puffGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
export function makeHitFx() {
  const g = new THREE.Group(); g.userData.parts = [];
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(sparkGeo, sparkMats[i % 3]); g.add(m); g.userData.parts.push(m); }
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(puffGeo, new THREE.MeshLambertMaterial({ color: 0x8a847c, transparent: true, opacity: 0.5, depthWrite: false })); g.add(m); g.userData.parts.push(m); }
  g.visible = false;
  return g;
}
export function hitFxAt(fx, x, y, z, p, seed = 0) {
  fx.visible = p >= 0 && p < 1;
  if (!fx.visible) return;
  fx.position.set(x, y, z);
  fx.userData.parts.forEach((m, i) => {
    const a = i * 2.39 + seed * 1.7;
    if (i < 9) { // 火花：まわりへはじけて、少し落ちる
      const r = (0.35 + (i % 3) * 0.22) * Math.min(1, p * 2.4);
      m.position.set(Math.cos(a) * r, Math.sin(a * 1.3) * r * 0.7 + 0.25 * p - 0.6 * p * p, Math.sin(a) * r);
      m.scale.setScalar(Math.max(0.01, 1.3 - p * 1.4)); m.visible = p < 0.7;
    } else { // 煙：ふわっと上へ広がって消える
      const q = Math.min(1, p * 1.2);
      m.position.set(Math.cos(a) * 0.25 * q, 0.15 + q * 0.6, Math.sin(a) * 0.25 * q);
      m.scale.setScalar(0.6 + q * 1.4); m.material.opacity = 0.5 * (1 - q);
    }
  });
}

// 矢の飛び方：放物線で飛んで、地面や柵に刺さる。u: 0..1（1 で刺さる）
export function arrowAt(arrow, from, to, u, arc = 1.6) {
  const k = Math.min(1, u);
  const x = from.x + (to.x - from.x) * k, z = from.z + (to.z - from.z) * k;
  const y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * arc;
  arrow.position.set(x, y, z);
  const dy = (to.y - from.y) + Math.cos(k * Math.PI) * Math.PI * arc, dl = Math.hypot(to.x - from.x, to.z - from.z);
  arrow.rotation.order = 'YXZ';
  arrow.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  arrow.rotation.x = -Math.atan2(dy, dl);
}
