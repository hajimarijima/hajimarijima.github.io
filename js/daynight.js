// 昼と夜（町の地図と動画で共通）。時刻 h（0〜24、日本時間）で空・太陽と月・星・光・窓とたいまつを変える。
import * as THREE from 'three';
import { WINDOW_MAT, TORCH_MAT, LAMP_MAT } from './world3d.js';

// 日本時間の今の時刻（時間の小数）
export function jstHour(d = new Date()) { return ((d.getUTCHours() + 9) % 24) + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; }
// ?time= の値：morning / day / evening / night か、"21" "6:30" のような時刻。だめなら null
export function parseTime(q) {
  if (q == null || q === '') return null;
  const named = { morning: 6.6, asa: 6.6, day: 12, noon: 12, hiru: 12, evening: 18.2, dusk: 18.2, yugata: 18.2, night: 22, yoru: 22, midnight: 0 };
  if (named[q] != null) return named[q];
  const m = String(q).match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  return m ? (Number(m[1]) % 24) + (Number(m[2] || 0) / 60) : null;
}
const sstep = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
// 暗さ 0（昼）〜 1（夜）
export function darkness(h) { return h < 12 ? 1 - sstep(4.6, 6.8, h) : sstep(17.2, 19.4, h); }
export function phaseName(h) { const n = darkness(h); if (n > 0.6) return '夜'; if (h < 12 && n > 0.02) return '朝'; if (h >= 12 && n > 0.02) return '夕方'; return h < 10 ? '朝' : h < 16 ? '昼' : '夕方'; }
// 朝焼け・夕焼けの強さ
const glow = (h) => Math.max(0, 1 - Math.abs(h - 18.1) / 1.5) + Math.max(0, 1 - Math.abs(h - 5.9) / 1.3);

const C = { day: new THREE.Color(0xbcd9ea), dusk: new THREE.Color(0xf2a273), night: new THREE.Color(0x0f1a36) };
const sunDay = new THREE.Color(0xfff2dc), sunLow = new THREE.Color(0xffb27a), moon = new THREE.Color(0x9fb6ff);
const hemiDay = new THREE.Color(0xf2f6ff), hemiNight = new THREE.Color(0x5a6a9a);


// 空の色（高さで変わるグラデーション）：天頂・地平線・地平線の下。昼・朝焼け/夕焼け・夜
const SKY = {
  day: { top: new THREE.Color(0x4f8fd6), hor: new THREE.Color(0xc4e2f2), bot: new THREE.Color(0xb8d4e2) },
  dusk: { top: new THREE.Color(0x3a4f8c), hor: new THREE.Color(0xf5a25e), bot: new THREE.Color(0xc98a6a) },
  night: { top: new THREE.Color(0x03081a), hor: new THREE.Color(0x14223f), bot: new THREE.Color(0x0c1428) },
};
// 太陽・月のまわりのやわらかい光（丸いぼかしの絵）
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.12, 'rgba(255,255,255,0.45)'); r.addColorStop(0.35, 'rgba(255,255,255,0.14)'); r.addColorStop(0.7, 'rgba(255,255,255,0.04)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// 空の丸天井（カメラについて動く）。色は uniform で、太陽の向きのまわりと、朝夕は太陽の側の地平線を明るくする
const DOME_VS = 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DOME_FS = [
  'uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 glowCol; uniform float glowAmt; varying vec3 vDir;',
  'void main(){',
  '  vec3 d = normalize(vDir); float y = d.y;',
  '  vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(hor, bot, smoothstep(0.0, 0.2, -y));',
  '  float s = max(dot(d, sunDir), 0.0);',
  '  c += glowCol * glowAmt * (pow(s, 6.0) * 0.32 + pow(s, 48.0) * 0.5);',
  '  vec2 a = normalize(d.xz + 1e-5), b = normalize(sunDir.xz + 1e-5);',
  '  float band = (1.0 - smoothstep(0.0, 0.35, abs(y))) * pow(max(dot(a, b), 0.0), 2.0);',
  '  c += glowCol * glowAmt * band * 0.25;',
  '  gl_FragColor = vec4(c, 1.0);',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');
function makeDome(radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glowCol: { value: new THREE.Color() }, glowAmt: { value: 0 } },
    vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}

// scene に空の飾り（太陽・月・星）を足して、set(h) で時刻を変える。
// dome: true で、高さで色の変わる空・四角い太陽と光の輪（町の地図）。false は前の形（色だけの空と箱の太陽。動画）
export function makeSky(scene, { hemi, sun, sunDist = 60, radius = 190, lightAnchors = [], maxLights = 8, nightBoost = 0, dome = false, camera = null } = {}) {
  // nightBoost：夜の明るさを足す（動画では敵や見張りが見えるように 0.4 ほど）
  let sunMesh, moonMesh, sunGlow = null, moonGlow = null, domeMesh = null;
  if (dome) {
    domeMesh = makeDome(radius * 1.05); scene.add(domeMesh);
    const sq = (size, color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false, transparent: true })); m.renderOrder = -6; m.frustumCulled = false; return m; };
    sunMesh = sq(radius * 0.06, 0xfff6d0); moonMesh = sq(radius * 0.06, 0xe8ecf6);
    const gt = glowTexture();
    const glow = (s, color, op) => { const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); g.scale.setScalar(s); g.renderOrder = -7; g.frustumCulled = false; return g; };
    sunGlow = glow(radius * 0.42, 0xffe6a8, 0.5); moonGlow = glow(radius * 0.3, 0xa8b8ff, 0.5);
    for (const m of [sunMesh, moonMesh, sunGlow, moonGlow]) scene.add(m);
    scene.background = null;
  } else {
    sunMesh = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial({ color: 0xfff1a8, fog: false }));
    moonMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0xe8ecf6, fog: false }));
    for (const m of [sunMesh, moonMesh]) { m.castShadow = false; m.receiveShadow = false; scene.add(m); }
  }
  // 星
  const N = 600, pos = new Float32Array(N * 3);
  let a = 12345; const rnd = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const sr = dome ? radius * 0.98 : radius;
  for (let i = 0; i < N; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(1 - rnd() * 0.9);
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * sr; pos[i * 3 + 1] = Math.cos(ph) * sr + 10; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sr;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(sg, starMat); stars.renderOrder = -8; stars.frustumCulled = false; scene.add(stars);
  // 街灯・たいまつの明かり（数を決めて先に作る：あとで数が変わるとシェーダーを作り直すので）
  const lamps = [];
  for (let i = 0; i < maxLights; i++) { const l = new THREE.PointLight(0xffb45a, 0, 14, 1.6); l.castShadow = false; scene.add(l); lamps.push(l); }
  const api = { n: 0, h: 12, sunMesh, moonMesh, stars, dome: domeMesh, anchors: lightAnchors.slice(), sunDir: new THREE.Vector3(0, 1, 0), horizon: new THREE.Color() };
  // カメラに近い明かりから使う
  api.placeLights = (camPos) => {
    // off：今は消えている明かり（手に持っていないたいまつなど）
    const list = api.anchors.filter((p) => !p.off).sort((p, q) => (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2 - ((q.x - camPos.x) ** 2 + (q.z - camPos.z) ** 2));
    lamps.forEach((l, i) => { const p = list[i]; if (p) l.position.set(p.x, p.y, p.z); l.visible = !!p; });
  };
  // 空の丸天井と太陽・月の板をカメラに合わせる（毎フレーム）
  api.follow = (cam) => {
    if (!domeMesh) return;
    const c = cam.position;
    domeMesh.position.copy(c); stars.position.set(c.x, c.y - 10, c.z);
    const R = radius * 0.92;
    const sd = api.sunDir;
    sunMesh.position.set(c.x + sd.x * R, c.y + sd.y * R, c.z + sd.z * R); sunGlow.position.copy(sunMesh.position);
    moonMesh.position.set(c.x - sd.x * R, c.y - sd.y * R, c.z - sd.z * R); moonGlow.position.copy(moonMesh.position);
    sunMesh.lookAt(c); moonMesh.lookAt(c);
  };
  api.set = (h, center = { x: 0, z: 0 }) => {
    h = ((h % 24) + 24) % 24;
    const n = darkness(h), g = glow(h);
    api.n = n; api.h = h;
    const dk = Math.min(0.85, g * 0.85) * (1 - n * 0.6);
    const mixSky = (k) => SKY.day[k].clone().lerp(SKY.night[k], n).lerp(SKY.dusk[k], dk);
    const hor = mixSky('hor');
    api.horizon.copy(hor);
    if (domeMesh) {
      const U = domeMesh.material.uniforms;
      U.top.value.copy(mixSky('top')); U.hor.value.copy(hor); U.bot.value.copy(mixSky('bot'));
      if (scene.fog) scene.fog.color.copy(hor);
    } else {
      const sky = C.day.clone().lerp(C.night, n).lerp(C.dusk, Math.min(0.75, g * 0.75) * (1 - n * 0.6));
      if (scene.background && scene.background.isColor) scene.background.copy(sky); else scene.background = sky.clone();
      if (scene.fog) scene.fog.color.copy(sky);
    }
    // 太陽は 6 時に東（+x）から出て 18 時に西へ沈む。夜は反対側に月
    const th = ((h - 6) / 12) * Math.PI;
    const dir = (t) => new THREE.Vector3(Math.cos(t), Math.sin(t), 0.45).normalize();
    const sd = dir(th), md = dir(th + Math.PI);
    api.sunDir.copy(sd);
    if (domeMesh) {
      const U = domeMesh.material.uniforms;
      U.sunDir.value.copy(sd.y > -0.2 ? sd : md);
      U.glowCol.value.setHex(g > 0.15 ? 0xffa060 : 0xfff0c8);
      U.glowAmt.value = sd.y > -0.2 ? Math.max(0.35, Math.min(1, g)) * (1 - n * 0.8) : 0.12 * n;
      sunMesh.material.color.setHex(g > 0.3 ? 0xffc890 : 0xfff6d8);
      sunGlow.material.color.setHex(g > 0.3 ? 0xff9a50 : 0xffe6a8);
      sunGlow.material.opacity = 0.9 * (1 - n * 0.9);
      sunMesh.visible = sunGlow.visible = sd.y > -0.08;
      moonMesh.visible = moonGlow.visible = md.y > -0.08 && n > 0.2;
      moonGlow.material.opacity = 0.5 * n;
    } else {
      sunMesh.position.set(center.x + sd.x * radius * 0.9, sd.y * radius * 0.9, center.z + sd.z * radius * 0.9);
      moonMesh.position.set(center.x + md.x * radius * 0.9, md.y * radius * 0.9, center.z + md.z * radius * 0.9);
      sunMesh.visible = sd.y > -0.08; moonMesh.visible = md.y > -0.08 && n > 0.2;
      sunMesh.material.color.setHex(g > 0.3 ? 0xffb070 : 0xfff1a8);
      stars.position.set(center.x, 0, center.z);
    }
    const useSun = sd.y > 0.02;
    const L = useSun ? sd : md;
    if (sun) {
      // 影の向き：光は空の太陽（夜は月）と同じ向きから当てる（低すぎると影が長くなりすぎるので、少しだけ持ち上げる）
      const v = new THREE.Vector3(L.x, Math.max(dome ? 0.12 : 0.18, L.y), L.z);
      if (dome) v.normalize();
      sun.position.set(center.x + v.x * sunDist, Math.max(8, v.y * sunDist), center.z + v.z * sunDist);
      sun.target.position.set(center.x, 0, center.z); sun.target.updateMatrixWorld();
      sun.color.copy(useSun ? sunDay.clone().lerp(sunLow, Math.min(1, g)) : moon);
      sun.intensity = useSun ? 1.9 * Math.min(1, 0.25 + sd.y * 1.6) * (1 - n * 0.7) : (0.7 + nightBoost * 0.9) * Math.min(1, n * 1.4);
    }
    if (hemi) { hemi.intensity = 1.1 - n * (0.64 - nightBoost * 0.7); hemi.color.copy(hemiDay.clone().lerp(hemiNight, n).lerp(new THREE.Color(0xffb88a), Math.min(1, g) * 0.55 * (1 - n))); hemi.groundColor.setHex(n > 0.5 ? 0x2a3324 : 0x6a7a4a); }
    starMat.opacity = Math.max(0, n * 1.1 - 0.15);
    // 窓・たいまつ・街灯
    const lit = sstep(0.25, 0.7, n);
    WINDOW_MAT.emissive.setHex(0xffb84a).multiplyScalar(lit * 0.95);
    TORCH_MAT.emissive.setHex(0xff8a20).multiplyScalar(0.25 + lit * 0.9);
    LAMP_MAT.emissive.setHex(0xffd27a).multiplyScalar(lit);
    for (const l of lamps) l.intensity = lit * 9 * (1 + nightBoost * 1.5);
    if (camera) api.follow(camera);
    return api;
  };
  return api;
}
