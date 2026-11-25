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

// scene に空の飾り（太陽・月・星）を足して、set(h) で時刻を変える
export function makeSky(scene, { hemi, sun, sunDist = 60, radius = 190, lightAnchors = [], maxLights = 8, nightBoost = 0 } = {}) {
  // nightBoost：夜の明るさを足す（動画では敵や見張りが見えるように 0.4 ほど）
  const sunMesh = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial({ color: 0xfff1a8, fog: false }));
  const moonMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0xe8ecf6, fog: false }));
  for (const m of [sunMesh, moonMesh]) { m.castShadow = false; m.receiveShadow = false; scene.add(m); }
  // 星
  const N = 500, pos = new Float32Array(N * 3);
  let a = 12345; const rnd = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < N; i++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(1 - rnd() * 0.9);
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * radius; pos[i * 3 + 1] = Math.cos(ph) * radius + 10; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * radius;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(sg, starMat); scene.add(stars);
  // 街灯・たいまつの明かり（数を決めて先に作る：あとで数が変わるとシェーダーを作り直すので）
  const lamps = [];
  for (let i = 0; i < maxLights; i++) { const l = new THREE.PointLight(0xffb45a, 0, 14, 1.6); l.castShadow = false; scene.add(l); lamps.push(l); }
  const api = { n: 0, h: 12, sunMesh, moonMesh, stars, anchors: lightAnchors.slice() };
  // カメラに近い明かりから使う
  api.placeLights = (camPos) => {
    const list = api.anchors.slice().sort((p, q) => (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2 - ((q.x - camPos.x) ** 2 + (q.z - camPos.z) ** 2));
    lamps.forEach((l, i) => { const p = list[i]; if (p) l.position.set(p.x, p.y, p.z); l.visible = !!p; });
  };
  api.set = (h, center = { x: 0, z: 0 }) => {
    h = ((h % 24) + 24) % 24;
    const n = darkness(h), g = glow(h);
    api.n = n; api.h = h;
    const sky = C.day.clone().lerp(C.night, n).lerp(C.dusk, Math.min(0.75, g * 0.75) * (1 - n * 0.6));
    if (scene.background && scene.background.isColor) scene.background.copy(sky); else scene.background = sky.clone();
    if (scene.fog) scene.fog.color.copy(sky);
    // 太陽は 6 時に東（+x）から出て 18 時に西へ沈む。夜は反対側に月
    const th = ((h - 6) / 12) * Math.PI;
    const dir = (t) => new THREE.Vector3(Math.cos(t), Math.sin(t), 0.45).normalize();
    const sd = dir(th), md = dir(th + Math.PI);
    sunMesh.position.set(center.x + sd.x * radius * 0.9, sd.y * radius * 0.9, center.z + sd.z * radius * 0.9);
    moonMesh.position.set(center.x + md.x * radius * 0.9, md.y * radius * 0.9, center.z + md.z * radius * 0.9);
    sunMesh.visible = sd.y > -0.08; moonMesh.visible = md.y > -0.08 && n > 0.2;
    sunMesh.material.color.setHex(g > 0.3 ? 0xffb070 : 0xfff1a8);
    const useSun = sd.y > 0.02;
    const L = useSun ? sd : md;
    if (sun) {
      const el = Math.max(0.18, L.y);
      sun.position.set(center.x + L.x * sunDist, Math.max(8, el * sunDist), center.z + L.z * sunDist);
      sun.target.position.set(center.x, 0, center.z); sun.target.updateMatrixWorld();
      sun.color.copy(useSun ? sunDay.clone().lerp(sunLow, Math.min(1, g)) : moon);
      sun.intensity = useSun ? 1.9 * Math.min(1, 0.25 + sd.y * 1.6) * (1 - n * 0.7) : (0.7 + nightBoost * 0.9) * Math.min(1, n * 1.4);
    }
    if (hemi) { hemi.intensity = 1.1 - n * (0.64 - nightBoost * 0.7); hemi.color.copy(hemiDay.clone().lerp(hemiNight, n).lerp(new THREE.Color(0xffb88a), Math.min(1, g) * 0.55 * (1 - n))); hemi.groundColor.setHex(n > 0.5 ? 0x2a3324 : 0x6a7a4a); }
    starMat.opacity = Math.max(0, n * 1.1 - 0.15);
    stars.position.set(center.x, 0, center.z);
    // 窓・たいまつ・街灯
    const lit = sstep(0.25, 0.7, n);
    WINDOW_MAT.emissive.setHex(0xffb84a).multiplyScalar(lit * 0.95);
    TORCH_MAT.emissive.setHex(0xff8a20).multiplyScalar(0.25 + lit * 0.9);
    LAMP_MAT.emissive.setHex(0xffd27a).multiplyScalar(lit);
    for (const l of lamps) l.intensity = lit * 9 * (1 + nightBoost * 1.5);
    return api;
  };
  return api;
}
