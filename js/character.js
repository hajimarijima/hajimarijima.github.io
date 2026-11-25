// マイクラのような四角い体を、64x64 のスキン画像から作る
import * as THREE from 'three';

const PX = 1 / 16;
const loader = new THREE.TextureLoader();
const texCache = {};
export function skinTexture(url) {
  if (!texCache[url]) {
    const t = loader.load(url);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
    texCache[url] = t;
  }
  return texCache[url];
}

// 箱の面ごとにスキンの場所を割り当てる（three の面の順: +x, -x, +y, -y, +z, -z）
function boxGeo(ox, oy, w, h, d, grow = 0) {
  const g = new THREE.BoxGeometry((w + grow) * PX, (h + grow) * PX, (d + grow) * PX);
  const rects = [
    [ox + d + w, oy + d, d, h], // +x = 左側（キャラの左）
    [ox, oy + d, d, h],         // -x = 右側
    [ox + d, oy, w, d],         // 上
    [ox + d + w, oy, w, d],     // 下
    [ox + d, oy + d, w, h],     // 正面
    [ox + 2 * d + w, oy + d, w, h], // 背中
  ];
  const uv = g.attributes.uv;
  rects.forEach(([x, y, rw, rh], f) => {
    const u0 = x / 64, u1 = (x + rw) / 64, v0 = 1 - y / 64, v1 = 1 - (y + rh) / 64;
    if (f === 3) { // 下の面は上下を返す
      uv.setXY(f * 4, u0, v1); uv.setXY(f * 4 + 1, u1, v1); uv.setXY(f * 4 + 2, u0, v0); uv.setXY(f * 4 + 3, u1, v0);
    } else {
      uv.setXY(f * 4, u0, v0); uv.setXY(f * 4 + 1, u1, v0); uv.setXY(f * 4 + 2, u0, v1); uv.setXY(f * 4 + 3, u1, v1);
    }
  });
  uv.needsUpdate = true;
  return g;
}

let GEO = null;
let charCount = 0;
function geos() {
  if (GEO) return GEO;
  GEO = {
    head: boxGeo(0, 0, 8, 8, 8), hat: boxGeo(32, 0, 8, 8, 8, 1),
    body: boxGeo(16, 16, 8, 12, 4), jacket: boxGeo(16, 32, 8, 12, 4, 0.5),
    rarm: boxGeo(40, 16, 4, 12, 4), rsleeve: boxGeo(40, 32, 4, 12, 4, 0.5),
    larm: boxGeo(32, 48, 4, 12, 4), lsleeve: boxGeo(48, 48, 4, 12, 4, 0.5),
    rleg: boxGeo(0, 16, 4, 12, 4), rpants: boxGeo(0, 32, 4, 12, 4, 0.5),
    lleg: boxGeo(16, 48, 4, 12, 4), lpants: boxGeo(0, 48, 4, 12, 4, 0.5),
  };
  return GEO;
}

const toolMats = {
  wood: new THREE.MeshLambertMaterial({ color: 0x8a5a33 }),
  iron: new THREE.MeshLambertMaterial({ color: 0xb8bec6 }),
  basket: new THREE.MeshLambertMaterial({ color: 0xc89a55 }),
  berry: new THREE.MeshLambertMaterial({ color: 0xc0303a }),
  log: new THREE.MeshLambertMaterial({ color: 0x9b6b3d }),
  ironDark: new THREE.MeshLambertMaterial({ color: 0x5c636b }),
  ironTip: new THREE.MeshLambertMaterial({ color: 0xe8edf2 }),
  cloth: new THREE.MeshLambertMaterial({ color: 0x6b5236 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xff9a2a }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
  stone: new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }),
};
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function makeTool(kind) {
  const g = new THREE.Group();
  if (kind === 'axe') {
    g.add(box(0.06, 0.62, 0.06, toolMats.wood, 0, 0.2, 0));
    g.add(box(0.05, 0.16, 0.2, toolMats.iron, 0, 0.44, 0.1));
  } else if (kind === 'pick') {
    // 柄の先に、両側へ下向きに曲がってとがる頭（横から見ても「つるはし」と分かる太さ）
    g.add(box(0.07, 0.66, 0.07, toolMats.wood, 0, 0.21, 0));
    g.add(box(0.12, 0.13, 0.16, toolMats.ironDark, 0, 0.53, 0)); // 柄をはめる所
    for (const s of [1, -1]) {
      const arm = new THREE.Group(); arm.position.set(0, 0.54, s * 0.07); arm.rotation.x = s * 0.32; g.add(arm);
      arm.add(box(0.09, 0.1, 0.2, toolMats.iron, 0, 0, s * 0.1));
      const tip = box(0.07, 0.07, 0.14, toolMats.iron, 0, -0.01, s * 0.26); tip.rotation.x = s * 0.25; arm.add(tip);
      arm.add(box(0.045, 0.045, 0.06, toolMats.ironTip, 0, -0.03, s * 0.35));
    }
  } else if (kind === 'hoe') {
    g.add(box(0.06, 0.7, 0.06, toolMats.wood, 0, 0.24, 0));
    g.add(box(0.05, 0.06, 0.18, toolMats.iron, 0, 0.56, 0.08));
  } else if (kind === 'torch') {
    g.add(box(0.07, 0.6, 0.07, toolMats.wood, 0, 0.2, 0));
    g.add(box(0.11, 0.1, 0.11, toolMats.cloth, 0, 0.5, 0));
    const f = box(0.14, 0.2, 0.14, toolMats.flame, 0, 0.64, 0); f.castShadow = false; g.add(f);
    const f2 = box(0.08, 0.12, 0.08, toolMats.flameCore, 0, 0.78, 0); f2.castShadow = false; g.add(f2);
    g.userData.flame = [f, f2];
  } else if (kind === 'basket') {
    g.add(box(0.28, 0.18, 0.22, toolMats.basket, 0, -0.05, 0.12));
    g.add(box(0.08, 0.06, 0.08, toolMats.berry, 0.05, 0.06, 0.1));
  }
  return g;
}
function makeCarry(kind) {
  if (kind === 'wood') { const g = new THREE.Group(); g.add(box(0.5, 0.14, 0.14, toolMats.log, 0, 0, 0)); g.add(box(0.5, 0.14, 0.14, toolMats.log, 0, 0.14, 0.02)); return g; }
  if (kind === 'stone') return box(0.3, 0.24, 0.26, toolMats.stone);
  return makeTool('basket');
}

// キャラクターを作る。返す group の userData.parts でアニメさせる
export function makeCharacter(url, { scale = 1, oneHand = null } = {}) {
  const G = geos();
  const tex = skinTexture(url);
  const base = new THREE.MeshLambertMaterial({ map: tex });
  const over = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const body = new THREE.Group(); // 全体（しゃがむ時に下げる）
  root.add(body);
  const mk = (g, m) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x; };

  const head = new THREE.Group(); head.position.y = 24 * PX;
  const h1 = mk(G.head, base); h1.position.y = 4 * PX; head.add(h1);
  const h2 = mk(G.hat, over); h2.position.y = 4 * PX; head.add(h2);

  const torso = new THREE.Group(); torso.position.y = 18 * PX;
  torso.add(mk(G.body, base)); torso.add(mk(G.jacket, over));

  const limb = (g1, g2, x, y) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const a = mk(g1, base); a.position.y = -6 * PX; p.add(a);
    const b = mk(g2, over); b.position.y = -6 * PX; p.add(b);
    return p;
  };
  const rarm = limb(G.rarm, G.rsleeve, -6 * PX, 24 * PX); // キャラの右手は -x
  const larm = limb(G.larm, G.lsleeve, 6 * PX, 24 * PX);
  const rleg = limb(G.rleg, G.rpants, -2 * PX, 12 * PX);
  const lleg = limb(G.lleg, G.lpants, 2 * PX, 12 * PX);
  body.add(head, torso, rarm, larm, rleg, lleg);

  const hand = new THREE.Group(); hand.position.set(0, -11 * PX, 0.5 * PX); rarm.add(hand);
  const front = new THREE.Group(); front.position.set(0, 17 * PX, 4.5 * PX); body.add(front);
  root.scale.setScalar(scale);
  root.userData.seed = (charCount++ * 0.6180339) % 1;
  // 片手で振る人と両手で振る人がいる（oneHand で指定もできる）
  root.userData.oneHand = oneHand ?? root.userData.seed < 0.4;
  root.userData.balance = root.userData.seed < 0.2 ? 'out' : 'down';
  root.userData.parts = { torso, body, head, rarm, larm, rleg, lleg, hand, front, tool: null, toolKind: null, carry: null, carryKind: null };
  return root;
}

export function setTool(ch, kind) {
  const P = ch.userData.parts;
  if (P.toolKind === kind) return;
  if (P.tool) P.hand.remove(P.tool);
  P.tool = kind ? makeTool(kind) : null; P.toolKind = kind;
  if (P.tool) { P.tool.rotation.x = Math.PI / 2; P.hand.add(P.tool); }
}
// 好きな色を服の差し色に（スカーフと帯）
export function setAccent(ch, color) {
  const P = ch.userData.parts;
  if (P.accent) { P.torso.remove(P.accent); P.accent = null; }
  if (!color) return;
  const m = new THREE.MeshLambertMaterial({ color });
  const g = new THREE.Group();
  const scarf = box(8.8 * PX, 1.6 * PX, 4.8 * PX, m, 0, 5.4 * PX, 0); g.add(scarf);
  const tail = box(1.6 * PX, 3 * PX, 0.8 * PX, m, 2 * PX, 3.4 * PX, 2.6 * PX); g.add(tail);
  const belt = box(8.7 * PX, 1.2 * PX, 4.7 * PX, m, 0, -5.2 * PX, 0); g.add(belt);
  P.torso.add(g); P.accent = g;
}
export function setCarry(ch, kind) {
  const P = ch.userData.parts;
  if (P.carryKind === kind) return;
  if (P.carry) P.front.remove(P.carry);
  P.carry = kind ? makeCarry(kind) : null; P.carryKind = kind;
  if (P.carry) P.front.add(P.carry);
}

// 見張りの盾（木の板に鉄のふち）。左腕に付け、矢が来たら前に上げる
const shieldMats = { wood: new THREE.MeshLambertMaterial({ color: 0x8a5a32 }), wood2: new THREE.MeshLambertMaterial({ color: 0x744a28 }), rim: new THREE.MeshLambertMaterial({ color: 0x6a7078 }), boss: new THREE.MeshLambertMaterial({ color: 0xb8bec4 }) };
export function setShield(ch, on) {
  const P = ch.userData.parts;
  if (!!P.shield === on) return;
  if (P.shield) { P.larm.remove(P.shield); P.shield = null; return; }
  const g = new THREE.Group(); g.position.set(0.5 * PX, -9 * PX, 0);
  // 腕の向き（-y）が前を向いた時に、板が前を向くように：厚みは y
  for (let i = 0; i < 3; i++) g.add(box(0.14, 0.05, 0.5, i % 2 ? shieldMats.wood2 : shieldMats.wood, -0.14 + i * 0.14, 0, 0));
  g.add(box(0.46, 0.06, 0.05, shieldMats.rim, 0, 0, 0.24)); g.add(box(0.46, 0.06, 0.05, shieldMats.rim, 0, 0, -0.24));
  g.add(box(0.1, 0.08, 0.1, shieldMats.boss, 0, -0.04, 0));
  P.larm.add(g); P.shield = g;
}

// 打った時に飛ぶかけら（石・木くず）
const chipMats = { stone: new THREE.MeshLambertMaterial({ color: 0x8d9298 }), wood: new THREE.MeshLambertMaterial({ color: 0xc89a5e }) };
const chipGeo = new THREE.BoxGeometry(1.4 * PX, 1.4 * PX, 1.4 * PX);
function chips(P, kind, p, hx, hy, hz) {
  if (!P.chips) {
    P.chips = new THREE.Group();
    for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(chipGeo, chipMats.stone); m.castShadow = false; P.chips.add(m); }
    P.body.parent.add(P.chips);
  }
  P.chips.visible = p >= 0 && p < 1;
  if (!P.chips.visible) return;
  P.chips.children.forEach((m, i) => {
    m.material = chipMats[kind];
    const a = (i / 5) * Math.PI * 1.6 - 0.8 + kind.length; // 横へ広がる向き
    const sp = 0.55 + (i % 3) * 0.2;
    m.position.set(hx + Math.sin(a) * sp * p * 0.6, hy + (0.9 + (i % 2) * 0.4) * p - 2.2 * p * p, hz - Math.cos(a) * sp * p * 0.25 - 0.15 * p);
    m.rotation.set(p * 7 + i, p * 5, 0);
    m.scale.setScalar(1 - p * 0.5);
  });
}

// 両手で道具を持つための腕の向き（手が体の真ん中に寄る）
const GRIP = 0.42;

// pose: 'idle' | 'talk' | 'walk' | 'chop' | 'dig' | 'gather' | 'carry'
export function animate(ch, pose, t) {
  const P = ch.userData.parts;
  const seed = ch.userData.seed || 0;
  P.body.position.y = 0; P.body.rotation.set(0, 0, 0);
  P.head.rotation.set(0, 0, 0);
  P.head.position.y = 24 * PX; P.torso.position.y = 18 * PX;
  P.rarm.position.y = 24 * PX; P.larm.position.y = 24 * PX;
  for (const k of ['rarm', 'larm', 'rleg', 'lleg']) P[k].rotation.set(0, 0, 0);
  if (P.chips) P.chips.visible = false;
  if (P.tool) P.tool.rotation.x = Math.PI / 2;
  // 呼吸：上半身だけが小さく上下する（人ごとに周期をずらす）
  const breathe = (amp) => {
    const b = Math.sin((t / (3.2 + seed * 1.6) + seed) * Math.PI * 2) * amp * PX;
    P.head.position.y += b; P.torso.position.y += b * 0.6; P.rarm.position.y += b; P.larm.position.y += b;
  };
  if (pose === 'walk' || pose === 'carry') {
    const s = Math.sin(t * 9) * 0.7;
    P.rleg.rotation.x = s; P.lleg.rotation.x = -s;
    if (pose === 'carry') { P.rarm.rotation.x = -1.2; P.larm.rotation.x = -1.2; P.rarm.rotation.z = 0.12; P.larm.rotation.z = -0.12; }
    else { P.rarm.rotation.x = -s * 0.9; P.larm.rotation.x = s * 0.9; }
    P.body.position.y = Math.abs(Math.cos(t * 9)) * 0.03;
  } else if (pose === 'dig' || pose === 'chop') {
    // 振りかぶる → 振り下ろす → 当たって小さく止まる → もどす
    const dig = pose === 'dig';
    const c = (t * (dig ? 1.3 : 1.6)) % 1;
    const H0 = dig ? 0.45 : 0.5, H1 = dig ? 0.65 : 0.75, H2 = dig ? 0.76 : 0.85; // 振り下ろし開始・当たる・止まり終わり
    const up = dig ? -3.0 : -2.5, hit = dig ? -0.85 : -1.45, rest = dig ? -0.9 : -1.1;
    let a, lean, twist = 0, recoil = 0;
    if (c < H0) { const k = c / H0; const e = k * k * (3 - 2 * k); a = rest + (up - rest) * e; lean = -0.1 * e; twist = (dig ? 0 : 0.35) * e; }
    else if (c < H1) { const k = (c - H0) / (H1 - H0); const e = k * k; a = up + (hit - up) * e; lean = -0.1 + (dig ? 0.42 : 0.3) * e; twist = (dig ? 0 : 0.35) - (dig ? 0 : 0.45) * e; }
    else if (c < H2) { const k = (c - H1) / (H2 - H1); recoil = Math.sin(k * Math.PI) * 0.12; a = hit - recoil; lean = dig ? 0.32 : 0.2; twist = dig ? 0 : -0.1; }
    else { const k = (c - H2) / (1 - H2); const e = k * k * (3 - 2 * k); a = hit + (rest - hit) * e; lean = (dig ? 0.32 : 0.2) * (1 - e); twist = (dig ? 0 : -0.1) * (1 - e); }
    // 手首を返す量：振り下ろしで前へ返し、当たったところで止める
    const k1 = c < H0 ? -0.45 * (c / H0) : c < H1 ? -0.45 + 0.85 * ((c - H0) / (H1 - H0)) : c < H2 ? 0.4 : 0.4 * (1 - (c - H2) / (1 - H2));
    if (ch.userData.oneHand) {
      // 片手：利き手で振り、手首を返す。もう片方はバランスを取る（前に出す）か、体の横に下ろす
      P.rarm.rotation.set(a, 0, 0.1);
      if (P.tool) P.tool.rotation.x = Math.PI / 2 + k1;
      if (ch.userData.balance === 'out') { const q = c < H1 ? Math.min(1, c / H0) : 1 - (c - H1) / (1 - H1); P.larm.rotation.set(-0.9 * q + 0.2, 0, -0.35 - 0.25 * q); }
      else P.larm.rotation.set(0.15 + lean * 0.3, 0, -0.08);
      P.body.rotation.y = twist + (dig ? 0.12 : 0.08); // 利き手側に少しひねる
    } else {
      P.rarm.rotation.set(a, 0, GRIP); P.larm.rotation.set(a - 0.05, 0, -GRIP);
      if (P.tool) P.tool.rotation.x = Math.PI / 2 + k1 * 0.5;
    }
    P.body.rotation.x = lean; P.body.rotation.y = twist;
    // 前に体重をかける足の開き
    P.rleg.rotation.x = 0.28 - lean * 0.4; P.lleg.rotation.x = -0.32 - lean * 0.4;
    P.body.position.y = -Math.abs(lean) * 0.08;
    P.head.rotation.x = 0.2 + lean * 0.3; // 当てる所を見る
    const p = c >= H1 ? (c - H1) / 0.28 : -1;
    if (dig) chips(P, 'stone', p, 0, 3 * PX, 19 * PX); else chips(P, 'wood', p, 0, 13 * PX, 15 * PX);
  } else if (pose === 'gather') {
    // （下の共通処理で盾を上げる）
    const c = Math.sin(t * 3);
    P.body.position.y = -0.18; P.body.rotation.x = 0.35;
    P.rleg.rotation.x = -0.7; P.lleg.rotation.x = -0.7;
    P.rarm.rotation.x = -1.0 + c * 0.35; P.larm.rotation.x = -0.9 - c * 0.35;
    P.head.rotation.x = 0.3;
    breathe(0.25);
  } else {
    // 立っている：呼吸＋ときどき周りを見る・伸びをする（人ごとに違う）
    breathe(0.35);
    const per = 8 + seed * 5, u = ((t / per) + seed * 3.7) % 1;
    P.rarm.rotation.z = -0.05; P.larm.rotation.z = 0.05;
    const sw = Math.sin(t * 1.4 + seed * 6) * 0.05;
    P.rarm.rotation.x = sw; P.larm.rotation.x = -sw;
    if (pose === 'talk') {
      // 話す：うなずきと身ぶり
      P.head.rotation.x = Math.max(0, Math.sin(t * 5 + seed * 9)) * 0.12;
      const g = Math.max(0, Math.sin(t * 2.3 + seed * 4));
      P.rarm.rotation.x = -0.5 - g * 0.6; P.rarm.rotation.z = 0.25;
      P.head.rotation.y = Math.sin(t * 0.7 + seed) * 0.1;
    } else if (u < 0.22) {
      // 首を回して周りを見る
      const k = u / 0.22;
      P.head.rotation.y = Math.sin(k * Math.PI * 2) * 0.7;
      P.head.rotation.x = -0.05;
    } else if (u > 0.55 && u < 0.7 && seed > 0.3) {
      // 伸び
      const k = Math.sin(((u - 0.55) / 0.15) * Math.PI);
      P.rarm.rotation.set(-2.9 * k, 0, 0.25 * k); P.larm.rotation.set(-2.9 * k, 0, -0.25 * k);
      P.body.rotation.x = -0.12 * k; P.head.rotation.x = -0.3 * k;
      P.head.position.y += 0.4 * k * PX;
    } else {
      P.head.rotation.y = Math.sin(t * 0.4 + seed * 5) * 0.15;
    }
  }
  // 盾を持っていて矢が来ている時は、左腕を前に上げて盾で受ける（少し身をかがめる）
  if (P.shield && ch.userData.block) { P.larm.rotation.set(-1.45, 0.25, -0.2); P.body.rotation.x = Math.max(P.body.rotation.x, 0.12); P.head.rotation.x = -0.1; }
  else if (P.shield) P.larm.rotation.set(-1.0, 0.2, -0.15); // 盾を前に構えておく
}
