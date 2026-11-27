// 遊ぶ（play.html）：自分の村人が島の浜と森で遊ぶ。釣り・宝探し・毎日のおてつだい。
// 自分の村人は js/mine.js（DM で届く専用のリンク）。記録は js/play/store.js（本番は受け口の Worker、見本はその場だけ）。
// つながっていない人は、見本の村人が釣りをしているのを見るだけ（「DM で『住みたい』と送ると…」の案内）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { nav, esc, showError, load } from '../common.js';
import { icon } from '../icons.js';
import { setTool, holdCan } from '../character.js';
import { whoami, atName, faceEl, withDemo } from '../mine.js';
import { buildScene, tickScene, fadeLeaves, WATER_Y, setWet } from './scene.js';
import { makeHero, reachOf, place, walkTo, tickHero, faceTo, rodTip } from './hero.js';
import { makeStore } from './store.js';
import { pickCatch, biteDelay, judgeHook, sizeWord, CHORES, jstHour, isNight, leftOf, beepInterval, beepPitch, detectWord, DETECT } from './rules.js';
import { makeDetector, holdDetector, coilPos, makeBeeper } from './detector.js';
import { makeBag } from './bag.js';
import { TIER_LOOK, gearStats, gearBoost, stoneIcon } from '../workshop.js';

nav('play.html');
const $ = (id) => document.getElementById(id);

async function main() {
  const W = await whoami();
  const config = W.config || (await load('config'));
  const items = config.items || {};
  const guest = !W.villager;
  const life = await load('life').catch(() => ({}));
  const v = W.villager || { key: 'sample', display: '見本の村人', skin: 7 };
  const L = (life && life[v.key]) || {};
  const store = makeStore(W, L), P = store.P;
  let day = await store.today();

  // ---------- 上の欄：だれが遊んでいるか ----------
  const who = $('whobox');
  if (guest) {
    who.innerHTML = `<div class="pguest card"><p><b>DM で「${esc(config.joinWord || '住みたい')}」と送ると、あなた専用のリンクが届きます。</b>開くと、自分の村人で遊べます。今は見本の村人が釣りをしているのを見られます。</p>` +
      `<div class="pg-btns"><a class="btn" href="./?join=dm">${icon('send', { size: 18 })}<span>DM の案内を見る</span></a><a class="btn sub" href="play.html?demo-me=1">見本で遊んでみる</a></div>` +
      (W.error ? `<p class="err">${esc(W.error)}</p>` : '') + '</div>';
  } else {
    who.innerHTML = `<div class="pwho"><span class="pw-face"></span><span class="pw-t"><b>${esc(atName(v))}</b><small>Lv${L.level || 1}${W.mode === 'demo' ? '・<span class="demo">見本（保存しません）</span>' : ''}</small></span><a class="pw-me" href="${withDemo('me.html')}">自分の村人</a></div>`;
    who.querySelector('.pw-face').append(faceEl(v, 40));
  }

  // ---------- 3D ----------
  const stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  const S = buildScene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = 1.36; controls.minDistance = 5; controls.maxDistance = 34;
  const H = makeHero(v);
  S.scene.add(H.ch);
  // 道具ごとの届く所（体と道具がいちばん前へ出る所）。物の半分にこれを足した所に立つ
  const REACH = { tree: reachOf(H, 'chop', CHORES.tree.tool), rock: reachOf(H, 'dig', CHORES.rock.tool), bush: reachOf(H, 'gather', CHORES.bush.tool), field: reachOf(H, 'water', CHORES.field.tool) };
  REACH.field = { ...REACH.field, front: Math.min(REACH.field.front, 0.35) }; // じょうろの口は畑の上へ出す（低い畑なので体だけ外にいればよい）
  const HALF = { tree: 0.5, rock: 0.5, bush: 0.63, field: 1.1 }; // 畑は枠の外まで // しげみは実の粒が面から出ている分まで
  window.PLAY = { S, H, REACH, camera, controls, renderer }; // 確かめ用
  const rodKind = 'rod:' + ((/^(stone|iron|gold|diamond)_fishing_rod$/.exec(((L.inv || []).find((s) => s && /fishing_rod$/.test(s.item)) || {}).item || '') || [])[1] || 'wood');

  // 浮きと糸
  const bob = new THREE.Group();
  const bm = (c) => new THREE.MeshLambertMaterial({ color: c });
  const bb = (w, h, d, m, y) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.y = y; o.castShadow = true; bob.add(o); return o; };
  bb(0.16, 0.12, 0.16, bm(0xf4f4f0), 0.0); bb(0.16, 0.12, 0.16, bm(0xd83a2c), 0.12); bb(0.04, 0.1, 0.04, bm(0x2b2620), 0.23);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; S.scene.add(ring);
  bob.visible = false; S.scene.add(bob);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xf6f6f6 }));
  line.visible = false; S.scene.add(line);
  const alert = document.createElement('div'); alert.className = 'pbite'; alert.textContent = '！'; alert.hidden = true; stage.append(alert);
  const tag = document.createElement('div'); tag.className = 'nametag ptag'; tag.textContent = v.display; stage.append(tag);

  // 宝箱（きょうの場所。地面の中にうまっていて、掘り出すまで見えない）
  const chest = S.placeChest(store.date);

  // ---------- 画面の部品 ----------
  const act = $('act'), msg = $('pmsg'), left = $('left'), card = $('pcard'), bar = $('cbar'), info = $('pinfo');
  const say = (t) => { msg.textContent = t; msg.hidden = !t; };
  const showCard = (html) => { card.innerHTML = `<button type="button" class="pc-x" aria-label="閉じる">${icon('x', { size: 20 })}</button>` + html; card.hidden = false; act.hidden = true; say(''); alert.hidden = true; card.querySelector('.pc-x').onclick = closeCard; card.querySelector('.pc-ok')?.addEventListener('click', closeCard); };
  let onCardClose = null;
  function closeCard() { card.hidden = true; const f = onCardClose; onCardClose = null; if (f) f(); }
  const zoomK = () => (stage.clientWidth < stage.clientHeight ? 1.4 : 1); // たての画面は横が狭いので、少し遠くから
  const leftText = (k) => `きょう あと ${leftOf(day, P, k)} 回`;
  let tab = 'fish';

  // ---------- 釣り ----------
  const F = { state: 'ready', t0: 0, biteAt: 0, land: null, from: null };
  function toFishing() {
    place(H, S.fishSpot.x, S.fishSpot.z, S.fishSpot.yaw);
    setTool(H.ch, rodKind); H.mode = 'rod'; H.rod = { phase: 'ready', k: 0 }; H.ch.userData.showFish = null;
    F.state = 'ready'; bob.visible = false; line.visible = false; ring.material.opacity = 0;
    const fx = Math.sin(S.fishSpot.yaw), fz = Math.cos(S.fishSpot.yaw);
    F.land = new THREE.Vector3(S.fishSpot.x + fx * 4.4, WATER_Y, S.fishSpot.z + fz * 4.4);
    // 村人の左うしろから、沖の浮きまで入るように
    // 村人の右ななめ前から（顔と竿と、沖の浮きが入るように）
    //   たての画面（スマホ）は横が狭いので、少し後ろから・村人寄りを見る
    const tall = stage.clientWidth < stage.clientHeight, back = tall ? 1.35 : 1, ahead = tall ? 1.1 : 2.0;
    camera.position.set(S.fishSpot.x + (-fx * 2.2 - fz * 5.6) * back, 3.0 * back, S.fishSpot.z + (-fz * 2.2 + fx * 5.6) * back);
    controls.target.set(S.fishSpot.x + fx * ahead, 0.9, S.fishSpot.z + fz * ahead);
    controls.minDistance = 4; controls.maxDistance = 14;
    fishUi();
  }
  function fishUi() {
    left.textContent = leftText('fish'); left.hidden = guest; bar.hidden = true;
    const n = leftOf(day, P, 'fish');
    if (guest) { act.hidden = true; say('見本の村人が釣りをしています'); return; }
    act.hidden = false;
    if (F.state === 'ready') { act.disabled = n <= 0; act.innerHTML = n > 0 ? `${icon('fish', { size: 22 })}<span>竿を振る</span>` : '<span>きょうはおしまい（また明日）</span>'; say(n > 0 ? '「竿を振る」で浮きを投げます。浮きが沈んだらすぐ「引く！」' : ''); }
    else if (F.state === 'wait' || F.state === 'bite') { act.disabled = false; act.innerHTML = `<span>引く！</span>`; act.classList.add('hot'); }
    else { act.disabled = true; }
    if (F.state !== 'wait' && F.state !== 'bite') act.classList.remove('hot');
  }
  function cast() {
    if (F.state !== 'ready' || leftOf(day, P, 'fish') <= 0) return;
    F.state = 'windup'; F.t0 = clock.getElapsedTime(); H.rod = { phase: 'windup', k: 0 }; say(''); fishUi();
  }
  async function hook() {
    if (F.state !== 'wait' && F.state !== 'bite') return;
    const now = clock.getElapsedTime();
    finish(judgeHook(now, F.biteAt, P.biteWindow));
  }
  async function finish(res) {
    F.state = 'hook'; F.t0 = clock.getElapsedTime(); H.rod = { phase: 'hook', k: 0 }; alert.hidden = true; fishUi();
    const night = isNight(jstHour(), P);
    const got = res === 'hit' ? pickCatch(config, undefined, { night, sea: true }) : null;
    F.got = got; F.res = res;
    try { day = await store.useFish(got ? { item: got.item, cm: got.cm } : null); } catch (e) { say(e.message); }
    left.textContent = leftText('fish');
    renderInfo();
  }
  function fishTick(t, dt) {
    const k = t - F.t0;
    if (guest) { guestFish(t); return; }
    if (F.state === 'windup') { H.rod.k = Math.min(1, k / 0.45); if (k >= 0.45) { F.state = 'throw'; F.t0 = t; H.rod = { phase: 'throw', k: 0 }; F.from = rodTip(H) || F.land.clone(); } }
    else if (F.state === 'throw') {
      H.rod.k = Math.min(1, k / 0.3);
      const u = Math.min(1, k / 0.75); bob.visible = true; line.visible = true;
      bob.position.lerpVectors(F.from, F.land, u); bob.position.y = F.from.y + (WATER_Y - F.from.y) * u + Math.sin(u * Math.PI) * 1.6;
      if (u >= 1) { F.state = 'wait'; F.t0 = t; F.biteAt = t + biteDelay(P); H.rod = { phase: 'wait', k: 0 }; fishUi(); say('浮きが沈むのを待って…'); ring.material.opacity = 0.6; ring.scale.setScalar(1); }
    } else if (F.state === 'wait' || F.state === 'bite') {
      const sink = t >= F.biteAt && t < F.biteAt + P.biteWindow ? Math.sin(Math.min(1, (t - F.biteAt) / 0.25) * Math.PI * 0.5) : 0;
      if (sink > 0 && F.state === 'wait') { F.state = 'bite'; alert.hidden = false; say('今だ！'); }
      bob.position.set(F.land.x, WATER_Y + Math.sin(t * 2.2) * 0.03 - sink * 0.2, F.land.z);
      if (t >= F.biteAt + P.biteWindow + 0.05) finish('late');
    } else if (F.state === 'hook') {
      H.rod.k = Math.min(1, k / 0.45);
      const u = Math.min(1, k / 0.6), tip = rodTip(H);
      if (tip) { bob.position.lerpVectors(F.land, tip, u * 0.85); bob.position.y = WATER_Y + (tip.y - 0.3 - WATER_Y) * u; }
      if (k >= 0.7) {
        bob.visible = false; line.visible = false; ring.material.opacity = 0;
        const g = F.got;
        if (g && g.kind === 'fish') { H.mode = 'show'; H.ch.userData.showFish = { cm: g.cm, key: g.item }; faceTo(H, Math.atan2(camera.position.x - H.ch.position.x, camera.position.z - H.ch.position.z)); } // その場でこちらを向いて、魚を見せる
        else { H.mode = 'rod'; H.rod = { phase: 'ready', k: 0 }; }
        F.state = 'card'; fishCard(); fishUi();
      }
    }
    if (line.visible) { const tip = rodTip(H); if (tip) line.geometry.setFromPoints([tip, bob.position.clone().setY(bob.position.y + 0.27)]); }
    if (ring.material.opacity > 0) { ring.position.set(F.land.x, WATER_Y + 0.01, F.land.z); const s = F.state === 'bite' ? 1 + ((t * 2) % 1) * 2.2 : 1 + Math.sin(t * 2) * 0.1; ring.scale.setScalar(s); ring.material.opacity = F.state === 'bite' ? 0.7 * (1 - ((t * 2) % 1)) : 0.35; }
  }
  function fishCard() {
    const g = F.got;
    const back = () => { H.mode = 'rod'; H.ch.userData.showFish = null; H.rod = { phase: 'ready', k: 0 }; F.state = 'turn'; fishUi(); faceTo(H, S.fishSpot.yaw, () => { F.state = 'ready'; fishUi(); }); };
    onCardClose = back;
    if (!g) { showCard(`<div class="pc-miss">${icon('waves', { size: 40 })}<h3>${F.res === 'early' ? '早すぎた！' : 'おそかった…'}</h3><p>魚に逃げられました。${F.res === 'early' ? '浮きが沈んでから引こう。' : '浮きが沈んだら、すぐ引こう。'}</p><p class="muted">${leftText('fish')}</p><button type="button" class="btn pc-ok">もう一度</button></div>`); return; }
    const nm = (items[g.item] || {}).name || g.item;
    const best = g.kind === 'fish' && L.fishBest && L.fishBest[g.item] && g.cm > L.fishBest[g.item][0];
    showCard(`<div class="pc-fish"><div class="pc-img"><img class="pixel" src="icons/${esc(g.item)}.png" alt="" width="64" height="64"></div>` +
      `<h3>${esc(nm)}${g.kind === 'fish' ? ` <b class="pc-cm">${g.cm}cm</b>` : ''}</h3>` +
      `<p class="pc-tags">${g.kind === 'fish' ? `<span class="tag">${esc(sizeWord(g.item, g.cm, config))}</span>` : `<span class="tag">${g.kind === 'treasure' ? '宝物' : '落とし物'}</span>`}${g.big ? '<span class="tag hot">大物！</span>' : ''}${best ? '<span class="tag hot">自己ベスト</span>' : ''}</p>` +
      legendLine() +
      `<p class="muted">${W.mode === 'live' ? '記録しました。' : W.mode === 'demo' ? '見本なので記録しません。' : ''}${leftText('fish')}</p><button type="button" class="btn pc-ok">つづける</button></div>`);
  }
  // 激レアが出た時の 1 行（抽選は受け口。store.last に答えが入る）
  function legendLine() {
    const lg = store.last && store.last.legend, sn = store.last && store.last.stone; // ストーン（防具の穴にはめる石）も受け口が決める
    return (lg ? `<p class="pc-legend"><img class="pixel" src="icons/${esc(lg)}.png" alt="" width="32" height="32"><span><b class="tag legend">激レア</b> ${esc((items[lg] || {}).name || lg)}も見つけた！</span></p>` : '') +
      (sn ? `<p class="pc-legend pc-stone" style="--sc:${sn.u ? '#ff7a3d' : (TIER_LOOK[sn.c] || TIER_LOOK.common).color}"><img class="pixel" src="icons/${esc(stoneIcon(sn))}.png" alt="" width="32" height="32"><span><b class="tag">${sn.u ? 'ユニーク' : esc((TIER_LOOK[sn.c] || TIER_LOOK.common).name)}</b> ストーンも見つけた！（持ち物の「防具」ではめられます）</span></p>` : '');
  }
  // 見本（つながっていない人）：決まった周期で投げて待って釣り上げる
  function guestFish(t) {
    const c = t % 7;
    if (c < 0.45) { H.rod = { phase: 'windup', k: c / 0.45 }; bob.visible = false; line.visible = false; H.mode = 'rod'; H.ch.userData.showFish = null; F.from = null; }
    else if (c < 1.2) { if (!F.from) F.from = rodTip(H) || F.land.clone(); H.rod = { phase: 'throw', k: Math.min(1, (c - 0.45) / 0.3) }; const u = Math.min(1, (c - 0.45) / 0.75); bob.visible = true; line.visible = true; bob.position.lerpVectors(F.from, F.land, u); bob.position.y = F.from.y + (WATER_Y - F.from.y) * u + Math.sin(u * Math.PI) * 1.6; }
    else if (c < 4.2) { H.rod = { phase: 'wait', k: 0 }; const sink = c > 3.6 ? Math.sin(Math.min(1, (c - 3.6) / 0.25) * Math.PI / 2) : 0; bob.position.set(F.land.x, WATER_Y + Math.sin(t * 2.2) * 0.03 - sink * 0.2, F.land.z); }
    else if (c < 4.9) { H.rod = { phase: 'hook', k: Math.min(1, (c - 4.2) / 0.45) }; const tip = rodTip(H), u = Math.min(1, (c - 4.2) / 0.6); if (tip) { bob.position.lerpVectors(F.land, tip, u * 0.85); bob.position.y = WATER_Y + (tip.y - 0.3 - WATER_Y) * u; } }
    else { bob.visible = false; line.visible = false; H.mode = 'show'; H.ch.userData.showFish = { cm: 28, key: 'fish_aji' }; }
    if (line.visible) { const tip = rodTip(H); if (tip) line.geometry.setFromPoints([tip, bob.position.clone().setY(bob.position.y + 0.27)]); }
  }

  // ---------- 宝探し ----------
  //   宝は島のどこかの地面の中（日付で決まる所。見た目の目印はない）。地面をタップすると村人がそこへ歩く。
  //   村人は金属探知機を持って歩き、宝に近いほど「ピッ」の間が短く・高くなる（rules.js の beepInterval・beepPitch）。
  //   宝のすぐ上（DETECT.dig の中）で「掘る」が出る。掘ると宝箱が出てきて、記録は今までと同じ（store.claimTreasure）
  const T = { found: !!day.treasure, busy: false, near: false, nextBeep: 0, d: 99 };
  const det = makeDetector(); det.visible = false; S.scene.add(det);
  const beeper = makeBeeper();
  const DIG_R = reachOf(H, 'dig', 'shovel:iron'); // シャベルを振り下ろした時に、いちばん前へ出る所
  // タップした所の印（地面の上の小さな輪。少しずつ消える）
  const mark = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2; mark.position.y = 0.02; S.scene.add(mark);
  // 掘った穴と、わきの土の山
  const holeG = new THREE.Group(); holeG.visible = false; S.scene.add(holeG);
  { const dm = new THREE.MeshLambertMaterial({ color: 0x3b2614 }), sm = new THREE.MeshLambertMaterial({ color: 0x7a4e2c });
    const hole = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 1.2), dm); hole.position.y = 0.011; hole.receiveShadow = true; holeG.add(hole);
    const pile = new THREE.Group(); holeG.add(pile); holeG.userData.pile = pile;
    for (const [w, h, x, z] of [[0.34, 0.2, 0, 0], [0.26, 0.14, 0.22, 0.12], [0.22, 0.12, -0.18, 0.14]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), sm); b.position.set(x, h / 2, z); b.castShadow = true; b.receiveShadow = true; pile.add(b); } }
  // 画面の右上：探知機の画面（ランプと、あいまいな言葉）と、音のボタン
  const dpan = document.createElement('div'); dpan.className = 'pdet'; dpan.hidden = true;
  dpan.innerHTML = '<span class="pd-meter"><i class="pd-lamp"></i><b class="pd-w"></b></span><button type="button" class="pd-snd"></button>';
  stage.append(dpan);
  const lampEl = dpan.querySelector('.pd-lamp'), wordEl = dpan.querySelector('.pd-w'), sndBtn = dpan.querySelector('.pd-snd');
  let soundPref = null; try { soundPref = localStorage.getItem('play.detSound'); } catch (e) { /* なくてもよい */ }
  function sndUi() {
    sndBtn.classList.toggle('hot', !beeper.on && !beeper.ready);
    sndBtn.innerHTML = beeper.on ? '<span class="pd-ic on"></span><span>音を消す</span>' : `<span class="pd-ic"></span><span>${beeper.ready ? '音を出す' : '音が出ます'}</span>`;
    sndBtn.setAttribute('aria-pressed', beeper.on ? 'true' : 'false');
  }
  sndBtn.addEventListener('click', () => {
    if (beeper.on) beeper.stop(); else beeper.start();
    try { localStorage.setItem('play.detSound', beeper.on ? 'on' : 'off'); } catch (e) { /* なくてもよい */ }
    sndUi(); if (tab === 'treasure' && !T.found && !T.busy) say(beeper.on ? '地面をタップして歩こう。宝に近いほど「ピッ」が速くなります' : '音を消しました（ランプの点めつでもさがせます）');
  });
  function treasureMsg() {
    if (T.found) return 'きょうの宝はもう掘り出しました。また明日、別の所にうまります';
    if (!beeper.on && !beeper.ready && soundPref === 'on') return '地面をタップして歩こう（タップすると探知機の音が鳴ります）';
    if (!beeper.on && !beeper.ready && soundPref !== 'off') return '右上の「音が出ます」を押してから、地面をタップして歩こう';
    return '地面をタップして歩こう。宝に近いほど「ピッ」が速くなります';
  }
  function toTreasure() {
    H.mode = 'idle'; H.ch.userData.showFish = null; setTool(H.ch, null);
    place(H, S.camp.x, S.camp.z, Math.PI);
    bob.visible = false; line.visible = false; ring.material.opacity = 0; alert.hidden = true;
    camera.position.set(S.camp.x + 1.2, 1 + 6.2 * zoomK(), S.camp.z - 1 + 7.4 * zoomK()); controls.target.set(S.camp.x, 1, S.camp.z - 1); controls.minDistance = 4; controls.maxDistance = 28; // 探知機が見えるくらい近くから（回す・遠ざけるのは自由）
    left.hidden = true; bar.hidden = true; act.hidden = true; act.classList.remove('hot');
    det.visible = !T.found; dpan.hidden = false; T.nextBeep = 0; T.near = false;
    sndUi(); say(treasureMsg());
  }
  const WALK_EX = 0.4;
  function walkHere(x, z) {
    // 海・物の上なら、近くの歩ける所へ。探知機を前に出して歩くので、物からはふだんより WALK_EX あける（腕・柄が物に入らない）
    let to = null;
    if (S.walkable(x, z, undefined, WALK_EX)) to = { x, z };
    else for (let r = 0.3; r <= 2.4 && !to; r += 0.3) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (S.walkable(px, pz, undefined, WALK_EX)) { to = { x: px, z: pz }; break; } }
    if (!to) { say('そこへは行けないみたい'); return; }
    const from = { x: H.ch.position.x, z: H.ch.position.z };
    const path = S.findPath(from, to, undefined, WALK_EX) || S.findPath(from, to);
    if (!path) { say('そこへは行けないみたい'); return; }
    mark.position.set(to.x, 0.02, to.z); mark.material.opacity = 0.85; mark.userData.t0 = clock.getElapsedTime();
    H.turnTo = null; walkTo(H, path, () => {});
    if (!T.found) say('');
  }
  async function dig() {
    if (T.found || T.busy || !T.near) return;
    if (guest) { say('つながると、宝を掘り出せます（DM で「住みたい」と送ると専用のリンクが届きます）'); return; }
    T.busy = true; act.hidden = true; act.classList.remove('hot'); H.path = []; say('');
    // 宝の所に向かって、シャベルが届く所に立つ（出てくる宝箱にも重ならない）
    const st = S.standNear(chest, Math.max(DIG_R.front, chest.r + 0.55), H.ch.position);
    const go = st && S.findPath({ x: H.ch.position.x, z: H.ch.position.z }, st, chest);
    const start = () => faceTo(H, st ? st.yaw : H.yaw, () => {
      det.visible = false; setTool(H.ch, 'shovel:iron');
      H.mode = 'work'; H.work = { pose: 'dig', o: { kind: 'ground' }, t0: clock.getElapsedTime() }; say('掘っています…');
      // 土の山は宝の横（あとで宝箱を横から見るカメラの側。島のまん中から外向き）に積む
      const dx = chest.x - H.ch.position.x, dz = chest.z - H.ch.position.z, dl = Math.hypot(dx, dz) || 1;
      let px = -dz / dl, pz = dx / dl; if (px * chest.x + pz * chest.z < 0) { px = -px; pz = -pz; }
      holeG.position.set(chest.x, 0, chest.z); holeG.rotation.y = 0;
      holeG.userData.pile.position.set(px * 0.95, 0, pz * 0.95); holeG.userData.pile.scale.setScalar(0.01); holeG.visible = true; T.digAt = clock.getElapsedTime();
      setTimeout(found, 2300);
    });
    if (go) walkTo(H, go, start); else start();
  }
  async function found() {
    H.mode = 'idle'; H.work = null; setTool(H.ch, null);
    T.found = true; T.riseAt = clock.getElapsedTime(); T.near = false; T.reveal = true; // reveal の間はカメラが村人について行かない
    dpan.hidden = true; // 開けている間は探知機の札を消す（村人と宝箱にかからない）
    chest.g.rotation.y = Math.atan2(H.ch.position.x - chest.x, H.ch.position.z - chest.z); // 前（留め金）を村人へ
    chest.g.position.y = -0.9; chest.g.visible = true; chest.passable = false;
    // 宝箱と村人を横から見る（下に出るカードに隠れないよう、2 人が画面の上の方に入る向き）。横の 2 つの向きのうち島のまん中から外向きの方
    { const dx = chest.x - H.ch.position.x, dz = chest.z - H.ch.position.z, dl = Math.hypot(dx, dz) || 1;
      let px = -dz / dl, pz = dx / dl; const mx = (chest.x + H.ch.position.x) / 2, mz = (chest.z + H.ch.position.z) / 2;
      if (px * chest.x + pz * chest.z < 0) { px = -px; pz = -pz; }
      const K = zoomK();
      // 村人と 3D の宝箱は画面のまん中あたりに（下には開ける宝箱、上には開けたあとのカードが出る）
      // 横に少しずらして、村人と 3D の宝箱を画面のまん中（2D の宝箱と飛び出す中身の所）からよける
      const sx = (dx / dl) * 1.1 * K, sz = (dz / dl) * 1.1 * K;
      controls.target.set(mx + sx, -0.5 * K, mz + sz); camera.position.set(mx + sx + px * 6.8 * K - (dx / dl) * 1.2, 4.0 * K, mz + sz + pz * 6.8 * K - (dz / dl) * 1.2); }
    say('宝箱だ！');
    let r = { first: true };
    try { r = await store.claimTreasure(v.key); day = await store.today(); } catch (e) { say(e.message); }
    // 掘り出した宝箱は、画面の真ん中の下に出てきて止まる。タップするとパカッと開き、中身（受け口が決めた物）がポンと飛び出す。
    // 持ち物には中身が入る（宝箱のままでは入れない）
    const got = store.last && store.last.got, look = TIER_LOOK[(store.last && store.last.tier) || 'common'] || TIER_LOOK.common;
    say('');
    Object.assign(PC, { got, look, inAt: clock.getElapsedTime() + 0.35, openAt: null, popped: false });
    pcItem.src = got ? `icons/${got[0]}.png` : 'icons/treasure_box.png'; pcItem.style.opacity = '0';
    pcLid.src = 'icons/chest_lid.png'; pch.style.setProperty('--tc', look.color); pch.classList.remove('open'); pch.hidden = false;
  }
  // ---------- 掘り出した宝箱（画面の上に出す 2D の宝箱。動きは clock で毎コマ決める） ----------
  const pch = document.createElement('div'); pch.className = 'pchest'; pch.hidden = true;
  pch.innerHTML = '<i class="pcx-beam"></i><i class="pcx-glow"></i><img class="pixel pcx-item" alt="" width="64" height="64">' +
    '<button type="button" class="pcx-box" aria-label="宝箱を開ける"><img class="pixel pcx-base" src="icons/chest_base.png" alt="" width="128" height="128"><img class="pixel pcx-lid" src="icons/chest_lid.png" alt="" width="128" height="128"></button>' +
    '<span class="pcx-hint">タップで開ける</span>';
  stage.append(pch);
  const pcBox = pch.querySelector('.pcx-box'), pcLid = pch.querySelector('.pcx-lid'), pcItem = pch.querySelector('.pcx-item'), pcGlow = pch.querySelector('.pcx-glow'), pcHint = pch.querySelector('.pcx-hint'), pcBeam = pch.querySelector('.pcx-beam');
  new Image().src = 'icons/chest_lid_open.png'; // 開いたふたを先に読んでおく
  const PC = { got: null, look: null, inAt: null, openAt: null, popped: false };
  pcBox.addEventListener('click', () => {
    if (PC.inAt == null || PC.openAt != null || clock.getElapsedTime() < PC.inAt + 0.45) return;
    PC.openAt = clock.getElapsedTime(); pch.classList.add('open');
    T.openAt = PC.openAt; // 3D の宝箱のふたもいっしょに開く
    H.mode = 'cheer'; H.cheerAt = PC.openAt;
    const { got, look } = PC;
    setTimeout(() => {
      // 宝探しは競争ではない（だれでも毎日 1 回掘り出せる）。順位や「いちばん」は出さない
      card.classList.add('ptop'); // カードは上に出す（下の宝箱と、飛び出した中身にかからない）
      onCardClose = () => { pch.hidden = true; PC.inAt = null; card.classList.remove('ptop'); H.mode = 'idle'; T.busy = false; T.reveal = false; if (tab === 'treasure') dpan.hidden = false; say(treasureMsg()); };
      const gn = got ? `${(items[got[0]] || {}).name || got[0]}${got[1] > 1 ? ` ×${got[1]}` : ''}` : '';
      showCard(`<div class="pc-fish"><div class="pc-img${got ? '' : ' chestimg'}">${got ? `<img class="pixel" src="icons/${esc(got[0])}.png" alt="" width="64" height="64">` : icon('gift', { size: 44 })}</div>` +
        `<h3>${got ? `${esc(gn)}<br>が出てきた！` : '見つけた！'}</h3>` +
        (got ? `<p class="pc-tags"><span class="tag" style="background:${look.color};color:#1a1830">${esc(look.name)}</span></p>` : '') +
        `<p>${got ? '持ち物に入ります。' : ''}${W.mode === 'live' ? '明日はまた別の所にうまります。' : '（見本なので記録しません）'}</p>` + legendLine() +
        `<button type="button" class="btn pc-ok">やったね</button></div>`);
    }, 1500);
  });
  const clamp01 = (x) => Math.max(0, Math.min(1, x)), easeBack = (u) => 1 + 2.2 * Math.pow(u - 1, 3) + 1.2 * Math.pow(u - 1, 2);
  function chestUiTick(t) {
    if (pch.hidden || PC.inAt == null) return;
    // 下から出てきて止まる（少し行きすぎてもどる）。開ける前は、ときどきカタカタゆれる
    const u = clamp01((t - PC.inAt) / 0.45), y = (1 - easeBack(u)) * 160;
    const waiting = PC.openAt == null && u >= 1;
    const rot = waiting && Math.sin(t * 1.9) > 0.55 ? Math.sin(t * 28) * 4 : 0;
    let pop = 0;
    if (PC.openAt != null) { const k = t - PC.openAt; pop = Math.max(0, 1 - k / 0.35) * 0.08; }
    pcBox.style.opacity = t < PC.inAt ? '0' : '1';
    pcBox.style.transform = `translate3d(0,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${(1 + pop).toFixed(3)})`;
    pcHint.style.opacity = waiting ? String(0.75 + 0.25 * Math.sin(t * 5)) : '0';
    if (PC.openAt == null) { pcLid.style.transform = waiting && rot ? 'translate3d(0,-4px,0)' : ''; pcGlow.style.opacity = '0'; pcItem.style.opacity = '0'; pcBeam.style.opacity = '0'; return; }
    const k = t - PC.openAt;
    // ふた：少し持ち上がってから、パカッと開く（開いた勢いで少しのびて、もどる）
    if (k < 0.12) pcLid.style.transform = `translate3d(0,${-Math.round(k / 0.12 * 2) * 4}px,0)`;
    else { if (!PC.popped) { PC.popped = true; pcLid.src = 'icons/chest_lid_open.png'; } const b = clamp01((k - 0.12) / 0.4); pcLid.style.transform = `scale(1,${(1 + Math.sin(b * Math.PI) * 0.18 * (1 - b)).toFixed(3)})`; }
    const lb = clamp01((k - 0.12) / 0.3); pcBeam.style.opacity = String(lb * (0.85 + 0.15 * Math.sin(k * 6))); pcBeam.style.transform = `scale(${(0.6 + 0.4 * lb).toFixed(3)},${lb.toFixed(3)})`; // 開いた口から光
    // 中身：口から上へポンと出て、ふわふわ浮く。うしろに段の色の光
    const k2 = k - 0.15;
    if (k2 > 0) {
      const v2 = clamp01(k2 / 0.5), iy = -(30 + 150 * easeBack(v2)) + (k2 > 0.5 ? Math.sin((k2 - 0.5) * 2.6) * 4 : 0), s = 0.4 + 0.9 * clamp01(k2 / 0.3);
      pcItem.style.opacity = '1'; pcItem.style.transform = `translate3d(-50%,${iy.toFixed(1)}px,0) scale(${s.toFixed(3)})`;
      pcGlow.style.opacity = String(Math.min(0.9, k2 * 3) * (0.8 + 0.2 * Math.sin(k2 * 5))); pcGlow.style.transform = `translate3d(-50%,${iy.toFixed(1)}px,0) scale(${(0.6 + 0.6 * clamp01(k2 / 0.4)).toFixed(3)})`;
    }
  }
  // 物の中か（探知機の輪・柄が入らないように。物はどれも回していない箱：半分の幅と高さ）
  const OBJ_HALF = { tree: 0.5, rock: 0.5, bush: 0.63, field: 1.12 }, OBJ_TOP = { tree: 99, rock: 1.4, bush: 1.2, field: 0.22 };
  const solidAt = (x, y, z, pad) => S.objs.some((o) => !o.passable && OBJ_HALF[o.kind] && y < OBJ_TOP[o.kind] && Math.abs(o.x - x) < OBJ_HALF[o.kind] + pad && Math.abs(o.z - z) < OBJ_HALF[o.kind] + pad);
  // 毎コマ：探知機を構えて、宝までの距離で「ピッ」とランプ
  function treasureTick(t, dt) {
    const walking = H.path.length > 0;
    if (det.visible) holdDetector(det, H, t, walking, dt, solidAt);
    if (mark.material.opacity > 0) mark.material.opacity = Math.max(0, 0.85 - (t - mark.userData.t0) * 0.6);
    if (T.digAt != null && T.riseAt == null) holeG.userData.pile.scale.setScalar(Math.min(1, 0.15 + (t - T.digAt) / 2.0));
    if (T.riseAt != null) chest.g.position.y = -0.9 + 0.9 * Math.min(1, (t - T.riseAt) / 0.7);
    if (T.found) { wordEl.textContent = '反応なし'; lampEl.style.opacity = 0.25; det.userData.flash = 0; act.hidden = true; return; }
    const c = coilPos(det), dc = Math.hypot(c.x - chest.x, c.z - chest.z), dh = Math.hypot(H.ch.position.x - chest.x, H.ch.position.z - chest.z);
    const d = det.visible ? Math.min(dc, dh) : dh; T.d = d;
    const now = performance.now();
    if (!T.busy && now >= T.nextBeep) {
      T.nextBeep = Math.max(now - 40, T.nextBeep) + beepInterval(d); T.flashAt = t; // 前の予定から数える（コマの間でずれがたまらない）
      beeper.beep(beepPitch(d), DETECT.beepMs);
    }
    const f = T.flashAt != null ? Math.max(0, 1 - (t - T.flashAt) / 0.09) : 0;
    det.userData.flash = f;
    lampEl.style.opacity = 0.25 + 0.75 * f; lampEl.dataset.lv = d <= DETECT.dig ? '3' : d <= 4 ? '2' : d <= 8 ? '1' : '0';
    wordEl.textContent = detectWord(d);
    const near = d <= DETECT.dig && !walking && !T.busy;
    if (near !== T.near) {
      T.near = near; act.hidden = !near; act.disabled = false;
      if (near) { act.innerHTML = `${icon('shovel', { size: 22 })}<span>掘る</span>`; act.classList.add('hot'); say('この下に何かある！「掘る」を押そう'); }
      else act.classList.remove('hot');
    }
  }

  // ---------- おてつだい ----------
  let total = await store.choreTotal();
  function toChores() {
    H.mode = 'idle'; H.ch.userData.showFish = null; setTool(H.ch, null);
    place(H, S.camp.x, S.camp.z, Math.PI);
    bob.visible = false; line.visible = false; ring.material.opacity = 0; alert.hidden = true;
    camera.position.set(S.camp.x + 0.8, 1 + 9.5 * zoomK(), S.camp.z - 1 + 10.5 * zoomK()); controls.target.set(S.camp.x, 1, S.camp.z - 1); controls.minDistance = 6; controls.maxDistance = 26;
    act.hidden = true; left.hidden = guest; left.textContent = leftText('chore'); bar.hidden = false; choreBar();
    say(guest ? '木・岩・しげみ・畑をタップ（つながると遊べます）' : leftOf(day, P, 'chore') > 0 ? '木・岩・しげみ・畑をタップしておてつだい' : 'きょうのおてつだいはおしまい。ありがとう！'); // 390 幅でも 1 行に収まる長さ
  }
  function choreBar() {
    const pct = Math.min(100, (total / P.choreGoal) * 100);
    bar.innerHTML = `<span class="cb-t">みんなで集めた きょうの合計 <b>${total}</b> / ${P.choreGoal}${W.mode === 'live' ? '' : '<small>（仮の数）</small>'}</span><span class="cb-bar"><i style="width:${pct}%"></i></span>`;
  }
  const C = { busy: false };
  function doChore(o) {
    if (C.busy) return;
    if (guest) { say('つながると、自分の村人で集められます'); return; }
    if (leftOf(day, P, 'chore') <= 0) { say('きょうのおてつだいはおしまい。また明日！'); return; }
    const kind = o.kind, R = REACH[kind], CH = CHORES[kind];
    const st = S.standNear(o, HALF[kind] + R.front + 0.04, H.ch.position);
    if (!st) { say('そこへは行けないみたい'); return; }
    const path = S.findPath({ x: H.ch.position.x, z: H.ch.position.z }, st, o);
    if (!path) { say('そこへは行けないみたい'); return; }
    C.busy = true; setTool(H.ch, CH.tool); say(CH.go || `${CH.name}を集めに行きます`);
    walkTo(H, path, () => faceTo(H, st.yaw, () => {
      H.mode = 'work'; H.work = { pose: CH.pose, o, t0: clock.getElapsedTime() }; say(CH.doing || `${CH.name}を集めています…`);
      setTimeout(async () => {
        H.mode = 'idle'; H.work = null;
        try { day = await store.useChore(kind); total = await store.choreTotal(); } catch (e) { say(e.message); C.busy = false; return; }
        if (kind === 'field') setWet(o, 1); else pop(CH.item, o);
        if (kind === 'bush') { const bs = o.g.userData.berries.children.filter((b) => b.visible); bs.slice(0, 3).forEach((b) => { b.visible = false; }); }
        left.textContent = leftText('chore'); choreBar();
        say(`${CH.verb}！ ${kind === 'field' ? '' : CH.name + ' +1　'}${leftText('chore')}${store.last && store.last.box ? '　きょうのおてつだいをぜんぶしたので、宝箱を 1 つもらった！' : ''}`);
        C.busy = false; renderInfo();
      }, 2200);
    }));
  }
  // 水やり：じょうろの口から水の粒が落ち、当たった畑の土が少しずつ濃くなる
  const DROP_N = 60, drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.11, 0.05), new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.85 }), DROP_N);
  drops.frustumCulled = false; drops.count = 0; S.scene.add(drops);
  const dropAt = [], _m = new THREE.Matrix4(), _sp = new THREE.Vector3();
  let dropAcc = 0;
  function waterTick(t, dt) {
    const w = H.mode === 'work' && H.work && H.work.o.kind === 'field' ? H.work : null;
    if (w) {
      setWet(w.o, Math.max(w.o.g.userData.wet, (t - w.t0) / 2.0));
      // じょうろを持つ右手を畑の上へ前に出し、口を前下へ向ける（「水やり」の形は両手を少し出すだけなので、ここで右手を足す）
      const PP = H.ch.userData.parts;
      PP.rarm.rotation.x = -1.35 + Math.sin(t * 1.6) * 0.06; PP.rarm.rotation.z = 0.12;
      holdCan(H.ch, H.ch.rotation.y); // 取っ手が上・胴は立ち・口は前（畑）の前下
      const sp = PP.tool && PP.tool.userData.spout;
      if (sp) for (dropAcc += dt * 26; dropAcc >= 1 && dropAt.length < DROP_N; dropAcc--) { sp.getWorldPosition(_sp); const f = 0.8 + Math.random() * 0.5, yw = H.ch.rotation.y; dropAt.push({ x: _sp.x + (Math.random() - 0.5) * 0.1, y: _sp.y, z: _sp.z + (Math.random() - 0.5) * 0.1, vx: Math.sin(yw) * f, vz: Math.cos(yw) * f, vy: -0.2 - Math.random() * 0.4 }); } // 口の先から正面へ
    }
    for (let i = dropAt.length - 1; i >= 0; i--) { const d = dropAt[i]; d.vy -= 9.8 * dt; d.y += d.vy * dt; d.x += (d.vx || 0) * dt; d.z += (d.vz || 0) * dt; if (d.y < 0.14) dropAt.splice(i, 1); }
    drops.count = dropAt.length;
    dropAt.forEach((d, i) => { _m.makeTranslation(d.x, d.y, d.z); drops.setMatrixAt(i, _m); });
    drops.instanceMatrix.needsUpdate = true;
  }
  // 集めた物の絵がふわっと上がる
  const pops = [];
  const texCache = {};
  function pop(item, o) {
    const tx = texCache[item] || (texCache[item] = new THREE.TextureLoader().load(`icons/${item}.png`, (t) => { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; }));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthTest: false }));
    s.scale.setScalar(0.8); s.position.set((o.x + H.ch.position.x) / 2, 1.6, (o.z + H.ch.position.z) / 2); s.renderOrder = 10;
    S.scene.add(s); pops.push({ s, t0: clock.getElapsedTime() });
  }

  // ---------- タップ（ドラッグと分ける） ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 600) { down = null; return; }
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (tab === 'fish') { if (F.state === 'wait' || F.state === 'bite') hook(); return; }
    if (tab === 'treasure') {
      // 地面（y=0）のタップした所へ歩く。前に「音を出す」にしていた人は、最初のタップで音を出す（ブラウザの決まりで、操作のあとから鳴らせる）
      if (soundPref === 'on' && !beeper.ready) { beeper.start(); sndUi(); }
      if (T.busy || !card.hidden) return;
      const p = ray.ray.intersectPlane(groundPlane, new THREE.Vector3());
      if (p) walkHere(p.x, p.z);
      return;
    }
    const targets = S.objs.filter((o) => o.kind !== 'chest' && !o.id.startsWith('brock')).map((o) => o.g);
    const hits = ray.intersectObjects(targets, true);
    if (!hits.length) return;
    let g = hits[0].object; while (g && !g.userData.obj) g = g.parent;
    if (!g) return;
    doChore(g.userData.obj);
  });
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  act.addEventListener('click', () => { if (tab === 'treasure') dig(); else if (F.state === 'ready') cast(); else hook(); });

  // ---------- タブ ----------
  const tabs = [...document.querySelectorAll('.ptab')];
  function setTab(k) {
    if (C.busy || T.busy || (tab === 'fish' && F.state !== 'ready' && F.state !== 'card')) { if (k !== tab) say('いまの遊びが終わってから切りかえてね'); return; }
    tab = k; card.hidden = true; onCardClose = null; H.path = []; H.turnTo = null;
    chest.g.visible = k === 'treasure' && T.riseAt != null; // 宝箱は、宝探しで掘り出したあとだけ見える
    holeG.visible = k === 'treasure' && T.digAt != null;
    det.visible = false; dpan.hidden = true; mark.material.opacity = 0; T.near = false;
    tabs.forEach((b) => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    // 持ち物（工房）：3D の代わりに持ち物の欄を出す
    const isBag = k === 'bag';
    stage.hidden = isBag; info.hidden = isBag; bagEl.hidden = !isBag;
    if (isBag) { H.mode = 'idle'; setTool(H.ch, null); left.hidden = true; bar.hidden = true; act.hidden = true; say(''); bag.refresh(); }
    else if (k === 'fish') toFishing(); else if (k === 'treasure') toTreasure(); else toChores();
    if (!isBag) renderInfo();
    try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])tab=[a-z]+&?/, '$1').replace(/[?&]$/, '') + (k === 'fish' ? '' : (location.search.replace(/([?&])tab=[a-z]+&?/, '$1').replace(/[?&]$/, '') ? '&' : '?') + 'tab=' + k)); } catch (e) { /* なくてもよい */ }
  }
  tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  async function renderInfo() {
    if (tab === 'fish') {
      const cs = await store.catches();
      info.innerHTML = `<h2>${icon('fish', { size: 20 })}<span>浜の釣り</span></h2><p class="muted">釣れる魚と大きさは、島の釣りと同じ決まりです（海の魚。夜は夜の魚も）。1 日 ${P.fishPerDay} 回まで（逃げても 1 回）。</p>` +
        (cs.length ? '<div class="pcatch">' + cs.map(([it, cm]) => `<span class="tag"><img class="pixel" src="icons/${esc(it)}.png" alt="" width="20" height="20">${esc((items[it] || {}).name || it)}${cm ? ` ${cm}cm` : ''}</span>`).join('') + '</div>' : `<p class="muted">${guest ? '' : 'きょうはまだ釣っていません。'}</p>`);
    } else if (tab === 'treasure') {
      info.innerHTML = `<h2>${icon('gift', { size: 20 })}<span>宝探し</span></h2><p class="muted">毎日 1 つ、島のどこかの地面の中に宝箱がうまっています。村人は金属探知機を持っていて、宝に近づくほど「ピッ、ピッ」の間が短くなります。地面をタップして歩き、音が「ピピピピ…」と続けて鳴る所で「掘る」。掘り出すとその場で宝箱が開いて、中の物が 1 つ持ち物に入ります（まれに激レアの物も）。宝はみんなが 1 日 1 回ずつ掘り出せます。</p><p class="muted">音が出ない時は、右上のランプの点めつと、携帯なら小さな震えでもわかります。</p>`;
    } else {
      info.innerHTML = `<h2>${icon('trees', { size: 20 })}<span>毎日のおてつだい</span></h2><p class="muted">木・石・木の実を集めたり、畑に水をやったり。1 日 ${P.chorePerDay} 回までできます。みんなで集めた合計が ${P.choreGoal} に届くと、島のみんなが助かります。</p>`;
    }
  }

  // ---------- 動かす ----------
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  const clock = new THREE.Clock();
  const _v = new THREE.Vector3(), _f = new THREE.Vector3();
  let last = 0;
  function frame() {
    const t = clock.getElapsedTime(), dt = Math.min(0.05, t - last); last = t;
    if (tab === 'fish') fishTick(t, dt);
    tickHero(H, dt, t);
    if (tab === 'treasure') treasureTick(t, dt);
    if (H.mode === 'work' && H.work && H.work.o.kind === 'tree') { const k = Math.sin(t * 20) * 0.012 * Math.max(0, Math.sin((t - H.work.t0) * 10)); H.work.o.g.userData.leaves.rotation.z = k; }
    waterTick(t, dt);
    if (T.openAt != null) chest.g.userData.open = Math.min(1, (t - T.openAt) / 0.8);
    chestUiTick(t);
    tickScene(S, t);
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i], k = (t - p.t0) / 1.4; p.s.position.y += dt * 0.9; p.s.material.opacity = 1 - Math.max(0, k - 0.5) * 2; if (k >= 1) { S.scene.remove(p.s); pops.splice(i, 1); } }
    // おてつだいの間は、カメラが村人について行く（回した向き・遠さはそのまま）
    if (tab === 'chore' || (tab === 'treasure' && !T.reveal)) { _f.set(H.ch.position.x, 1, H.ch.position.z - 1).sub(controls.target).multiplyScalar(Math.min(1, dt * 3)); controls.target.add(_f); camera.position.add(_f); }
    controls.update();
    fadeLeaves(S, camera, H.ch.position, dt);
    renderer.render(S.scene, camera);
    // 名前の札（頭の上）と、浮きの「！」
    H.ch.updateMatrixWorld(); _v.set(0, 2.45, 0).applyMatrix4(H.ch.matrixWorld).project(camera);
    const r = renderer.domElement;
    tag.style.transform = `translate(${(_v.x * 0.5 + 0.5) * r.clientWidth}px, ${(-_v.y * 0.5 + 0.5) * r.clientHeight}px) translate(-50%, -100%)`;
    tag.hidden = _v.z > 1 || H.mode === 'show' || (tab === 'treasure' && T.reveal); // 宝箱を開けている間は名札を隠す（飛び出した中身に重ならない）
    if (!alert.hidden) { _v.copy(bob.position).setY(bob.position.y + 0.8).project(camera); alert.style.transform = `translate(${(_v.x * 0.5 + 0.5) * r.clientWidth}px, ${(-_v.y * 0.5 + 0.5) * r.clientHeight}px) translate(-50%, -100%)`; }
  }
  renderer.setAnimationLoop(frame);
  Object.assign(window.PLAY, { frame, F, T, C, S, H, dig, walkHere, doChore, setTab, cast, hook, chest, det, beeper }); // 確かめ用
  // 防具のくらし「歩く速さ」を自分の村人に効かせる（持ち物が変わったら合わせなおす）
  const gearSpeed = (s) => { H.speedMul = gearBoost(gearStats(config, (s && s.gear) || null), 'walk'); };
  const bagEl = $('bag'), bag = makeBag({ root: bagEl, store, config, L, guest, mode: W.mode, onChange: () => gearSpeed(bag.state) });
  window.PLAY.bag = bag; // 確かめ用
  if (!guest) store.shop().then(gearSpeed).catch(() => {});
  const q = new URLSearchParams(location.search).get('tab');
  setTab(['fish', 'treasure', 'chore', 'bag'].includes(q) ? q : 'fish');
  if (guest) tabs.forEach((b) => { if (b.dataset.tab !== 'fish') b.title = 'つながると遊べます'; });
}

main().catch(showError);
