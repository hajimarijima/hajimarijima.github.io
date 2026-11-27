// 自分の村人（me.html）：DM で届いた専用のリンクでつながった人の、村人の姿・名前・レベル・称号・持ち物と、設定（鉱石の持ち方）。
// つながっていない人には「DM で『住みたい』と送ると、あなた専用のリンクが届きます」の案内。?demo-me=1 で見本。
import * as THREE from 'three';
import { nav, esc, load, titleBadges, bestFishText, JOB, showError } from './common.js';
import { icon } from './icons.js';
import { slotsHtml } from './invslots.js';
import { makeCharacter, animate, setAccent, setArmor, chibiOf } from './character.js';
import { armorLook } from './smithing.js';
import { kitLook } from './workshop.js';
import { skinSrc, skinSlim } from './common.js';
import { whoami, atName, api, forget, withDemo } from './mine.js';
import { ORE_MODES, validOreMode } from './play/rules.js';

nav('me.html');
const main = document.getElementById('main');

async function run() {
  const W = await whoami();
  const config = W.config || (await load('config'));
  const word = config.joinWord || '住みたい';
  if (!W.villager) {
    main.innerHTML = `<h1>自分の村人</h1><section class="card mecard"><div class="me-lead">${icon('link', { size: 28 })}<p><b>DM で「${esc(word)}」と送ると、あなた専用のリンクが届きます。</b></p></div>` +
      `<ol class="me-steps"><li>インスタで町のアカウントに DM で「${esc(word)}」と送る</li><li>返事の DM に、あなた専用のリンクが届く</li><li>そのリンクを開くと、その端末で自分の村人として遊べる・設定できる</li></ol>` +
      (W.error ? `<p class="err">${esc(W.error)}</p>` : '') +
      (W.off ? '<p class="muted"><span class="demo">準備中</span> 専用のリンクの受け口を準備しています。もうしばらく待ってね。</p>' : '') +
      `<div class="me-btns"><a class="btn" href="./?join=dm">${icon('send', { size: 18 })}<span>DM の案内を開く</span></a><a class="btn sub" href="me.html?demo-me=1">見本を見る</a></div>` +
      '<p class="muted">別のスマホで遊ぶ時は、そのスマホでもう一度 DM すると新しいリンクが届きます（前のリンクは使えなくなります）。リンクは人に教えないでね。</p></section>';
    return;
  }
  const v = W.villager;
  const life = await load('life').catch(() => ({}));
  const L = life[v.key] || {};
  const lv = L.level || 1, xp = L.xp || 0, base = L.xpBase || 0, nxt = L.xpNext || 1;
  const pct = Math.max(0, Math.min(100, ((xp - base) / Math.max(1, nxt - base)) * 100));
  const demo = W.mode === 'demo';
  const tb = titleBadges(v, config, L);
  const fish = bestFishText(L, config);
  main.innerHTML = `<h1>自分の村人</h1>` + (demo ? '<p><span class="demo">見本の画面（保存しません）</span></p>' : '') +
    `<section class="card mecard meprof"><div class="me-view" id="meview"></div><div class="me-main">` +
    `<h2 class="me-name">${esc(atName(v))}</h2><p class="muted me-you">あなたは ${esc(atName(v))} として島にいます</p>` +
    `<div class="lvrow"><b class="lv">Lv${lv}</b><div class="xpbar"><i style="width:${pct}%"></i></div><span class="muted">${esc(JOB[L.job] || 'まだ作業なし')}</span></div>` +
    (tb ? `<div class="me-row"><span class="me-k">称号・バッジ</span>${tb}</div>` : '<div class="me-row"><span class="me-k">称号・バッジ</span><span class="muted">まだありません</span></div>') +
    `<div class="me-row"><span class="me-k">持ち物</span>${slotsHtml(L, config)}</div>` +
    (fish ? `<div class="me-row"><span class="me-k">釣り</span><span>${esc(fish.replace('いちばんの大物：', ''))}</span></div>` : '') +
    `<div class="me-btns"><a class="btn" href="${withDemo('play.html')}">${icon('gamepad-2', { size: 18 })}<span>遊ぶ</span></a><a class="btn sub" href="./?v=${encodeURIComponent(v.key)}">${icon('house', { size: 18 })}<span>家を見る</span></a><a class="btn sub" href="villager.html?k=${encodeURIComponent(v.key)}">くわしく</a></div>` +
    '</div></section>' +
    `<h2 class="me-h">${icon('sliders-horizontal', { size: 20 })}<span>設定</span></h2>` +
    `<section class="card mecard"><form id="setf"><fieldset class="me-set"><legend>鉱石（石炭・鉄・金など）を掘った時</legend>` +
    Object.entries(ORE_MODES).map(([k, t]) => `<label class="me-opt"><input type="radio" name="ore" value="${k}"><span><b>${esc(t)}</b><small>${k === 'self' ? '自分の持ち物に入れて、自分で使う' : '島の倉庫に入れて、みんなで使う'}</small></span></label>`).join('') +
    `</fieldset><fieldset class="me-set me-bday"><legend>誕生日</legend>` +
    `<div class="me-bdrow"><label><select id="bdm" aria-label="誕生日の月">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select><span>月</span></label>` +
    `<label><select id="bdd" aria-label="誕生日の日"></select><span>日</span></label></div>` +
    '<small class="muted">その日の夕方、島の広場でみんながパーティを開いてくれます。コメント「誕生日 3/14」でも変えられます。</small>' +
    `</fieldset><div class="me-save"><button type="submit" class="savebtn">保存</button><span class="muted" id="setmsg" role="status"></span></div>` +
    '<p class="muted">保存した設定は、次の日の島の暮らしから使われます。</p></form></section>' +
    '<div id="mepost"></div>' + // 郵便受けと家を飾る（js/mepost.js）
    `<section class="card mecard me-out"><p class="muted">この端末で自分の村人として遊ぶのをやめる時は「この端末から出る」。もう一度遊ぶには、DM のリンクを開き直します。</p><button type="button" class="btn sub" id="out">${icon('log-out', { size: 18 })}<span>この端末から出る</span></button><span class="muted" id="outmsg"></span></section>`;

  // 設定
  const cur = (W.me && W.me.settings && W.me.settings.oreMode) || (demo ? demoOre : null) || 'self';
  const radios = [...main.querySelectorAll('input[name="ore"]')];
  radios.forEach((r) => { r.checked = r.value === cur; });
  // 誕生日（月・日のえらぶ欄。今の誕生日：web で保存した日 → 島の村人の誕生日）
  const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const bdm = main.querySelector('#bdm'), bdd = main.querySelector('#bdd');
  const fillD = () => { const keep = +bdd.value || 1, n = DAYS[+bdm.value - 1]; bdd.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join(''); bdd.value = String(Math.min(keep, n)); };
  const bd0 = (demo && demoBd) || (W.me && W.me.settings && W.me.settings.birthday) || v.birthday || '01-01';
  bdm.value = String(+bd0.slice(0, 2) || 1); fillD(); bdd.value = String(+bd0.slice(3, 5) || 1);
  bdm.onchange = fillD;
  const bdVal = () => String(bdm.value).padStart(2, '0') + '-' + String(bdd.value).padStart(2, '0');
  main.querySelector('#setf').onsubmit = async (e) => {
    e.preventDefault();
    const val = (radios.find((r) => r.checked) || {}).value, m = main.querySelector('#setmsg');
    if (!validOreMode(val)) { m.textContent = 'どちらかを選んでね'; return; }
    const bd = bdVal(), bdJa = `${+bdm.value}月${+bdd.value}日`;
    m.textContent = '保存しています…';
    try {
      if (demo) { demoOre = val; demoBd = bd; m.textContent = `見本なので保存していません（本番では「${ORE_MODES[val]}」・誕生日 ${bdJa} を覚えます）。`; return; }
      await api(config, '/me/settings', { oreMode: val, birthday: bd });
      m.textContent = `保存しました（${ORE_MODES[val]}・誕生日 ${bdJa}）。`;
    } catch (err) { m.textContent = '保存できませんでした：' + err.message; }
  };
  main.querySelector('#out').onclick = () => {
    const m = main.querySelector('#outmsg');
    if (demo) { m.textContent = '見本なので、何も消していません。'; return; }
    if (!confirm('この端末から出ますか？（もう一度遊ぶには、DM のリンクを開き直します）')) return;
    forget(); location.replace('me.html');
  };
  viewer(document.getElementById('meview'), v, L, config);
  import('./mepost.js').then((m) => m.renderMePost(document.getElementById('mepost'), W)).catch((e) => console.warn('郵便受け', e));
}
let demoOre = null, demoBd = null;

// 村人の 3D の姿（ゆっくり回る。ドラッグで回せる）
function viewer(el, v, L, config) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.append(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 4, 3); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 24), new THREE.MeshLambertMaterial({ color: 0x86b85a }));
  ground.position.y = -0.06; scene.add(ground);
  const ch = makeCharacter(skinSrc(v), { slim: skinSlim(v), chibi: chibiOf(v) });
  if (v.profile && v.profile.color) setAccent(ch, v.profile.color);
  setArmor(ch, { ...armorLook(L.gear, config.smithing), ...kitLook(L) });
  scene.add(ch);
  cam.position.set(0, 1.35, 5.2); cam.lookAt(0, 1.0, 0);
  let yaw = 0.5, drag = null;
  el.addEventListener('pointerdown', (e) => { drag = e.clientX; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (drag != null) { yaw += (e.clientX - drag) * 0.012; drag = e.clientX; } });
  el.addEventListener('pointerup', () => { drag = null; });
  const size = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', size); size();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => { const t = clock.getElapsedTime(); if (drag == null) yaw += 0.006; ch.rotation.y = yaw; animate(ch, 'idle', t); renderer.render(scene, cam); });
}

run().catch(showError);
