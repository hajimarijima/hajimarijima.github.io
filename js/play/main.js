// 遊ぶ（play.html）：自分の村人が島の浜と森で遊ぶ。釣り・宝探し・毎日のおてつだい。
// 自分の村人は js/mine.js（DM で届く専用のリンク）。記録は js/play/store.js（本番は受け口の Worker、見本はその場だけ）。
// つながっていない人は、見本の村人が釣りをしているのを見るだけ（「DM で『住みたい』と送ると…」の案内）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { nav, esc, showError, load } from '../common.js';
import { icon } from '../icons.js';
import { setTool } from '../character.js';
import { whoami, atName, faceEl, withDemo } from '../mine.js';
import { buildScene, tickScene, fadeLeaves, WATER_Y, setWet } from './scene.js';
import { makeHero, reachOf, place, walkTo, tickHero, faceTo, rodTip } from './hero.js';
import { makeStore } from './store.js';
import { pickCatch, biteDelay, judgeHook, sizeWord, CHORES, jstHour, isNight, leftOf } from './rules.js';

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
  const store = makeStore(W), P = store.P;
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

  // 宝箱（きょうの場所）
  const chest = S.placeChest(store.date);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.6; chest.g.add(hit);
  if (day.treasure) chest.g.userData.open = 1;

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
      `<p class="muted">${W.mode === 'live' ? '記録しました。' : W.mode === 'demo' ? '見本なので記録しません。' : ''}${leftText('fish')}</p><button type="button" class="btn pc-ok">つづける</button></div>`);
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
  const T = { found: !!day.treasure };
  function toTreasure() {
    H.mode = 'idle'; H.ch.userData.showFish = null; setTool(H.ch, null);
    place(H, S.camp.x, S.camp.z, Math.PI);
    bob.visible = false; line.visible = false; ring.material.opacity = 0; alert.hidden = true;
    camera.position.set(2 * zoomK(), 15 * zoomK(), 21 * zoomK()); controls.target.set(0, 1, -1); controls.minDistance = 8; controls.maxDistance = 34;
    left.hidden = true; bar.hidden = true; act.hidden = true;
    say(T.found ? 'きょうの宝箱はもう見つけました。また明日、別の所に出ます' : guest ? '島のどこかで宝箱が光っています（つながると、見つけた人として記録されます）' : '島のどこかで宝箱が光っています。ドラッグで島を回して、見つけたらタップ！');
  }
  async function foundChest() {
    if (T.found || T.busy) return;
    if (guest) { say('つながると、宝箱を開けられます（DM で「住みたい」と送ると専用のリンクが届きます）'); return; }
    T.busy = true;
    const st = S.standNear(chest, chest.r + 0.9, H.ch.position);
    // カメラを宝箱へ寄せる（宝箱と、歩いてくる村人が入るように、広場の側から）
    //   宝箱と、その前に立つ村人を横から見る（2 人が重ならない）。横の 2 つの向きのうち海に近い方（木の葉の中にカメラが入らない）
    if (st) {
      const dx = chest.x - st.x, dz = chest.z - st.z, dl = Math.hypot(dx, dz) || 1;
      let px = -dz / dl, pz = dx / dl;
      const mx = (chest.x + st.x) / 2, mz = (chest.z + st.z) / 2;
      if (px * mx + pz * mz < 0) { px = -px; pz = -pz; }
      controls.target.set(mx, 0.9, mz);
      camera.position.set(mx + px * 6 * zoomK() - (dx / dl) * 1.5, 3.8 * zoomK(), mz + pz * 6 * zoomK() - (dz / dl) * 1.5);
    }
    const path = st && S.findPath({ x: H.ch.position.x, z: H.ch.position.z }, st, chest);
    say('宝箱だ！');
    const open = async () => {
      faceTo(H, st ? st.yaw : H.yaw, async () => {
        T.found = true; T.openAt = clock.getElapsedTime();
        let r = { first: true };
        try { r = await store.claimTreasure(v.key); day = await store.today(); } catch (e) { say(e.message); }
        H.mode = 'cheer'; H.cheerAt = clock.getElapsedTime();
        const vs = await load('villagers').catch(() => []);
        const fv = r.finder && vs.find((x) => x.key === r.finder);
        onCardClose = () => { H.mode = 'idle'; T.busy = false; };
        showCard(`<div class="pc-fish"><div class="pc-img chestimg">${icon('gift', { size: 44 })}</div><h3>${r.first ? 'いちばん乗り！' : '宝箱を見つけた！'}</h3>` +
          `<p>${r.first ? `${esc(atName(v))} さんが、きょうの宝箱を最初に見つけました。` : `きょうのいちばん乗りは ${esc(fv ? atName(fv) : 'ほかの人')} さんでした。`}</p>` +
          `<p class="muted">${r.first ? (W.mode === 'live' ? '年表に名前と宝さがしのバッジがのります（次の毎日の更新で）。' : '見本なので記録しません。本番では年表に名前とバッジがのります。') : '明日はまた別の所に出ます。'}</p><button type="button" class="btn pc-ok">やったね</button></div>`);
        say('');
      });
    };
    if (path) walkTo(H, path, open); else open();
  }

  // ---------- おてつだい ----------
  let total = await store.choreTotal();
  function toChores() {
    H.mode = 'idle'; H.ch.userData.showFish = null; setTool(H.ch, null);
    place(H, S.camp.x, S.camp.z, Math.PI);
    bob.visible = false; line.visible = false; ring.material.opacity = 0; alert.hidden = true;
    camera.position.set(S.camp.x + 0.8, 1 + 9.5 * zoomK(), S.camp.z - 1 + 10.5 * zoomK()); controls.target.set(S.camp.x, 1, S.camp.z - 1); controls.minDistance = 6; controls.maxDistance = 26;
    act.hidden = true; left.hidden = guest; left.textContent = leftText('chore'); bar.hidden = false; choreBar();
    say(guest ? '木・岩・木の実のしげみ・畑をタップすると、村人がおてつだいに行きます（つながると遊べます）' : leftOf(day, P, 'chore') > 0 ? '木・岩・木の実のしげみ・畑をタップすると、おてつだいに行きます' : 'きょうのおてつだいはおしまい。ありがとう！');
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
        say(`${CH.verb}！ ${kind === 'field' ? '' : CH.name + ' +1　'}${leftText('chore')}`);
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
      if (PP.tool) PP.tool.rotation.x = Math.PI / 2 - 0.45;
      const sp = PP.tool && PP.tool.userData.spout;
      if (sp) for (dropAcc += dt * 26; dropAcc >= 1 && dropAt.length < DROP_N; dropAcc--) { sp.getWorldPosition(_sp); dropAt.push({ x: _sp.x + (Math.random() - 0.5) * 0.12, y: _sp.y, z: _sp.z + (Math.random() - 0.5) * 0.12, vy: -0.4 - Math.random() * 0.6 }); }
    }
    for (let i = dropAt.length - 1; i >= 0; i--) { const d = dropAt[i]; d.vy -= 9.8 * dt; d.y += d.vy * dt; if (d.y < 0.14) dropAt.splice(i, 1); }
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
    const targets = S.objs.filter((o) => (tab === 'chore' ? o.kind !== 'chest' && !o.id.startsWith('brock') : tab === 'treasure' ? o.kind === 'chest' : false)).map((o) => o.g);
    if (tab === 'fish') { if (F.state === 'wait' || F.state === 'bite') hook(); return; }
    const hits = ray.intersectObjects(targets, true);
    if (!hits.length) { if (tab === 'treasure' && !T.found) say('そこには ないみたい。島を回してさがそう'); return; }
    let g = hits[0].object; while (g && !g.userData.obj) g = g.parent;
    if (!g) return;
    if (tab === 'treasure') foundChest(); else doChore(g.userData.obj);
  });
  act.addEventListener('click', () => { if (F.state === 'ready') cast(); else hook(); });

  // ---------- タブ ----------
  const tabs = [...document.querySelectorAll('.ptab')];
  function setTab(k) {
    if (C.busy || T.busy || (tab === 'fish' && F.state !== 'ready' && F.state !== 'card')) { if (k !== tab) say('いまの遊びが終わってから切りかえてね'); return; }
    tab = k; card.hidden = true; onCardClose = null; H.path = []; H.turnTo = null;
    chest.g.visible = k === 'treasure'; // 宝箱（光の柱）は宝探しの時だけ
    tabs.forEach((b) => { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (k === 'fish') toFishing(); else if (k === 'treasure') toTreasure(); else toChores();
    renderInfo();
    try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])tab=[a-z]+&?/, '$1').replace(/[?&]$/, '') + (k === 'fish' ? '' : (location.search.replace(/([?&])tab=[a-z]+&?/, '$1').replace(/[?&]$/, '') ? '&' : '?') + 'tab=' + k)); } catch (e) { /* なくてもよい */ }
  }
  tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  async function renderInfo() {
    if (tab === 'fish') {
      const cs = await store.catches();
      info.innerHTML = `<h2>${icon('fish', { size: 20 })}<span>浜の釣り</span></h2><p class="muted">釣れる魚と大きさは、島の釣りと同じ決まりです（海の魚。夜は夜の魚も）。1 日 ${P.fishPerDay} 回まで（逃げても 1 回）。</p>` +
        (cs.length ? '<div class="pcatch">' + cs.map(([it, cm]) => `<span class="tag"><img class="pixel" src="icons/${esc(it)}.png" alt="" width="20" height="20">${esc((items[it] || {}).name || it)}${cm ? ` ${cm}cm` : ''}</span>`).join('') + '</div>' : `<p class="muted">${guest ? '' : 'きょうはまだ釣っていません。'}</p>`);
    } else if (tab === 'treasure') {
      info.innerHTML = `<h2>${icon('gift', { size: 20 })}<span>宝探し</span></h2><p class="muted">毎日 1 つ、島のどこかに光る宝箱が出ます。いちばんに見つけた人は、年表に名前と宝さがしのバッジがのります。森の奥・岩のかげ・浜のはしもさがしてみて。</p>`;
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
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime(), dt = Math.min(0.05, t - last); last = t;
    if (tab === 'fish') fishTick(t, dt);
    tickHero(H, dt, t);
    if (H.mode === 'work' && H.work && H.work.o.kind === 'tree') { const k = Math.sin(t * 20) * 0.012 * Math.max(0, Math.sin((t - H.work.t0) * 10)); H.work.o.g.userData.leaves.rotation.z = k; }
    waterTick(t, dt);
    if (T.openAt != null) chest.g.userData.open = Math.min(1, (t - T.openAt) / 0.8);
    tickScene(S, t);
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i], k = (t - p.t0) / 1.4; p.s.position.y += dt * 0.9; p.s.material.opacity = 1 - Math.max(0, k - 0.5) * 2; if (k >= 1) { S.scene.remove(p.s); pops.splice(i, 1); } }
    // おてつだいの間は、カメラが村人について行く（回した向き・遠さはそのまま）
    if (tab === 'chore') { _f.set(H.ch.position.x, 1, H.ch.position.z - 1).sub(controls.target).multiplyScalar(Math.min(1, dt * 3)); controls.target.add(_f); camera.position.add(_f); }
    controls.update();
    fadeLeaves(S, camera, H.ch.position, dt);
    renderer.render(S.scene, camera);
    // 名前の札（頭の上）と、浮きの「！」
    H.ch.updateMatrixWorld(); _v.set(0, 2.45, 0).applyMatrix4(H.ch.matrixWorld).project(camera);
    const r = renderer.domElement;
    tag.style.transform = `translate(${(_v.x * 0.5 + 0.5) * r.clientWidth}px, ${(-_v.y * 0.5 + 0.5) * r.clientHeight}px) translate(-50%, -100%)`;
    tag.hidden = _v.z > 1 || H.mode === 'show';
    if (!alert.hidden) { _v.copy(bob.position).setY(bob.position.y + 0.8).project(camera); alert.style.transform = `translate(${(_v.x * 0.5 + 0.5) * r.clientWidth}px, ${(-_v.y * 0.5 + 0.5) * r.clientHeight}px) translate(-50%, -100%)`; }
  });
  Object.assign(window.PLAY, { F, T, C, S, H, foundChest, doChore, setTab, cast, hook, chest }); // 確かめ用
  const q = new URLSearchParams(location.search).get('tab');
  setTab(['fish', 'treasure', 'chore'].includes(q) ? q : 'fish');
  if (guest) tabs.forEach((b) => { if (b.dataset.tab !== 'fish') b.title = 'つながると遊べます'; });
}

main().catch(showError);
