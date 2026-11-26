import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeCharacter, animate, setTool, setAccent, setArmor, chibiOf } from './character.js';
import { armorLook, gearNames } from './smithing.js';
import { initAuth } from './auth.js';
import { loadAll, nav, esc, skinUrl, skinSrc, skinSlim, JOB, ACTION, RES, fmtDate, homeName, buildingLabel, showError, KIND, KIND_COLOR, MBTI, LETTER, mdText, villagerUrl, faceCanvas, emptyNote, lookDataUrl, loadImage, drawFigure, gaugeHtml, loadDiary, badgeList, badgeIcon, bestFishText, mbtiText } from './common.js';
import { BODIES, BODY_LABEL } from './skingen.js';
import { decodeHours, parseCode, hourOf, hourText } from './hours.js';
import { heldOf } from './invslots.js';
import { badgeCount } from './combat.js';

// 今の時刻（日本時間。?hour=N で決められる）の行動と、1 日の予定（同じ行動が続く所をまとめる）
function hourRows(L) {
  const arr = decodeHours(L.hours);
  if (arr.length !== 24) return [];
  const q = Number(new URLSearchParams(location.search).get('hour'));
  const h = Number.isFinite(q) && new URLSearchParams(location.search).has('hour') ? ((Math.floor(q) % 24) + 24) % 24 : (new Date().getUTCHours() + 9) % 24;
  const runs = [];
  arr.forEach((c, i) => {
    const t = hourText(parseCode(c)) || '—';
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.b = i; else runs.push({ a: i, b: i, t });
  });
  const plan = runs.map((r) => `${r.a}${r.b > r.a ? '〜' + r.b : ''}時 ${r.t}`).join('／');
  const rows = [['今していること', `${h}時・${hourText(hourOf(L, h)) || '—'}`], ['きょうの 24 時間', plan]];
  rows.push(['ねる所', (L.bed ? 'ベッド' : '木かげや地面') + (L.chrono ? `・${L.chrono}` : '')]);
  return rows;
}

nav('people.html');

async function main() {
  const D = await loadAll();
  const key = new URLSearchParams(location.search).get('k');
  const v = D.active.find((x) => x.key === key) || D.active[0];
  if (!v) { document.getElementById('main').innerHTML = '<h1>村人</h1>' + emptyNote(D.config) + '<p class="muted"><a href="./">町を見る</a></p>'; return; }
  const L = D.life[v.key] || { gathered: { wood: 0, stone: 0, food: 0 }, built: [], diary: [] };
  document.title = v.display + ' | はじまり島';
  // プロフィールの欄は、config.json の ui.profileSection が true の時だけ出す（今は出さない）
  const ps = document.getElementById('profsec');
  if (ps) ps.hidden = !(D.config.ui && D.config.ui.profileSection);
  document.getElementById('name').textContent = v.display;
  // 称号のバッジ（名前のすぐ下。説明もそえる）
  // 絵（48 ドット）・名前・説明を並べる。技能バッジ（銅・銀・金・ダイヤ）は持ち物の下の「バッジ」に出る
  const tl = badgeList(v, D.config).filter((b) => b.kind === 'title'), nameEl = document.getElementById('name');
  if (tl.length) {
    const box = document.createElement('div'); box.className = 'titles badges';
    box.innerHTML = tl.map((b) => `<figure class="badge"${b.desc ? ` title="${esc(b.desc)}"` : ''}>${badgeIcon(b, 48)}<figcaption><b>${esc(b.name)}</b>${b.desc ? `<small>${esc(b.desc)}</small>` : ''}</figcaption></figure>`).join('') +
      '<a class="bdgall" href="badges.html">バッジをぜんぶ見る</a>';
    nameEl.after(box);
  }
  document.getElementById('info').innerHTML = [
    ['参加した日', v.joinedAt && /^\d{2}:\d{2}$/.test(v.joinedAt) ? `${fmtDate(v.joined)} ${v.joinedAt} に島に来た（${v.joinedDay}日目）` : `${fmtDate(v.joined)}（${v.joinedDay}日目）`],
    // 誕生日・好きな食べ物（「住みたい 誕生日3月14日 りんご」で書いた値。書いていない人は島が決めた値）。プロフィールの欄を出す時はそちらに出る
    ...(ps && !ps.hidden ? [] : [...(v.birthday ? [['誕生日', mdText(v.birthday)]] : []), ...(v.profile && v.profile.food ? [['好きな食べ物', v.profile.food]] : []), ...(mbtiText(v, D.config) ? [['MBTI', mbtiText(v, D.config).replace('MBTI：', '')]] : [])]),
    ['今の仕事', `${JOB[L.job] || 'まだなし'}${L.action ? '（' + ACTION[L.action] + '）' : ''}${L.smith && L.job !== 'smith' ? '・村の鍛冶職人' : ''}`],
    ['装備', gearNames(L, D.config.items).join('・') || 'なし（素手）'],
    ...hourRows(L),
    ['住んでいる家', homeName(L, D.world, D.config, D.state)],
    ['最初の道具', startToolText(v, L, D.config)],
    ['体力', gaugeHtml('heart', L.hp, (D.config.needs || {}).max || 20) + (L.restWhy === 'weak' ? ' <small class="muted">休んで戻している</small>' : '')],
    ['おなか', gaugeHtml('food', L.hunger, (D.config.needs || {}).max || 20)],
    ['スキン', v.look ? `${esc(BODY_LABEL[v.look.body] || '')}・${v.look.seed} 番（プロフィールで選んだ見た目）` : `${v.skin} 番`],
    ['体型', v.body === 'chibi' ? '2 頭身' : '通常'],
    ...(bestFishText(L, D.config) ? [['釣り', bestFishText(L, D.config)]] : []),
  ].map(([k, val]) => `<dt>${k}</dt><dd>${k === 'スキン' || k === '体力' || k === 'おなか' ? val : esc(val)}</dd>`).join('') + (v.hidden ? '<dt>表示</dt><dd>名前をかくしてあだ名で出しています</dd>' : '');
  document.getElementById('stats').innerHTML = ['wood', 'stone', 'food'].map((r) => `<div class="stat"><b>${Math.floor(L.gathered[r])}</b><small>${RES[r]}</small></div>`).join('');
  const built = L.built.map((id) => D.world.buildings.find((b) => b.id === id)).filter(Boolean);
  document.getElementById('built').innerHTML = built.length ? built.map((b) => `<span class="tag">${esc(buildingLabel(b, D.world, D.config))}（${b.day}日目）</span>`).join(' ') : 'まだありません。';
  // 釣った一番大きな魚（魚ごとに 1 つ。島の記録を持っている魚には印）
  const fb = Object.entries(L.fishBest || {}).sort((a, b) => b[1][0] - a[1][0]);
  const fsec = document.getElementById('fishsec');
  if (fsec && fb.length) {
    const top = (D.state.fishing && D.state.fishing.top) || {};
    fsec.hidden = false;
    document.getElementById('fishbest').innerHTML = fb.map(([it, [cm, day]]) => {
      const rec = top[it] && top[it][0] && top[it][0][1] === v.key;
      return `<span class="tag">${esc((D.config.items[it] || {}).name || it)} ${cm}cm（${day}日目）${rec ? ' ★島の記録' : ''}</span>`;
    }).join(' ');
  }
  const diary = await loadDiary(v.key, L);
  document.getElementById('diary').innerHTML = diary.slice().reverse().map((d) => `<li><span class="d">${d.day}日目</span><span>${esc(d.text)}</span></li>`).join('') || '<li>まだ日記がありません。</li>';

  // 持ち物
  renderInventory(L, D.config, v);
  renderSocial(v, D);
  renderProfile(v, D.config, { day: D.state.day, L });

  // 3D の姿
  const el = document.getElementById('viewer');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(1.6, 1.6, 3.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2; controls.maxDistance = 7;
  controls.autoRotate = true; controls.autoRotateSpeed = 1.6;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 4, 3); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.1, 24), new THREE.MeshLambertMaterial({ color: 0x86b85a }));
  ground.position.y = -0.05; scene.add(ground);
  const ch = makeCharacter(skinSrc(v), { scale: 1, slim: skinSlim(v), chibi: chibiOf(v) });
  scene.add(ch);
  if (v.profile && v.profile.color) setAccent(ch, v.profile.color);
  setArmor(ch, armorLook(L.gear, D.config.smithing)); // 鍛冶職人が作った防具（帽子・服・くつ）
  let tool = { level: 'hoe', chop: 'axe', dig: 'pick', dig_last: 'pick', till: 'hoe', tend: 'hoe', berry: 'basket', apple: 'basket', harvest: 'basket', forage: 'basket', fish: 'rod', ranch: 'basket', smith: 'hammer' }[L.action];
  if (tool && ['axe', 'pick', 'hoe', 'rod'].includes(tool)) tool += ':' + (L.toolTier && L.toolTier !== 'hand' ? L.toolTier : 'wood'); // 道具の素材で色と形を変える
  setTool(ch, tool || null);
  let mode = 'idle';
  const pose = { chop: 'chop', dig: 'dig', dig_last: 'dig', till: 'dig', berry: 'gather', apple: 'gather', harvest: 'gather', tend: 'gather', forage: 'gather', smith: 'smith' }[L.action] || 'idle';
  renderer.domElement.addEventListener('click', () => { mode = mode === 'idle' ? pose : 'idle'; });
  function resize() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => { animate(ch, mode, clock.getElapsedTime()); controls.update(); renderer.render(scene, camera); });
  const hint = document.createElement('div');
  hint.className = 'hint'; hint.textContent = 'タップで仕事の動き'; el.appendChild(hint);
}
// 関係の一覧と最近の立ち話
function renderSocial(v, D) {
  const byKey = Object.fromEntries(D.villagers.map((x) => [x.key, x]));
  const rels = ((D.social.view || {})[v.key] || []).filter((r) => byKey[r.other]);
  const ul = document.getElementById('rels');
  if (!rels.length) ul.innerHTML = '<li class="muted">まだ親しい人はいません。いっしょに働くと仲よくなります。</li>';
  for (const r of rels) {
    const o = byKey[r.other];
    const li = document.createElement('li');
    const pct = Math.max(0, Math.min(100, r.s));
    li.innerHTML = `<span class="face"></span><a href="${villagerUrl(o)}">${esc(o.display)}</a>` +
      `<span class="kind" style="background:${KIND_COLOR[r.kind]}">${KIND[r.kind]}</span>` +
      `<span class="bar" title="仲のよさ ${r.s}"><i style="width:${pct}%;background:${KIND_COLOR[r.kind]}"></i></span>`;
    faceCanvas(o, 28).then((c) => li.querySelector('.face').append(c));
    ul.append(li);
  }
  const talks = (D.social.talks || []).filter((t) => t.a === v.key || t.b === v.key).slice(-6).reverse();
  document.getElementById('talks').innerHTML = talks.map((t) => {
    const other = byKey[t.a === v.key ? t.b : t.a];
    return `<li><div class="d">${t.day}日目・${esc(other ? other.display : '')}と</div>` + t.lines.map(([w, s]) => `<div class="line${w === v.key ? ' me' : ''}"><b>${esc((byKey[w] || {}).display || '')}</b><span>${esc(s)}</span></div>`).join('') + '</li>';
  }).join('') || '<li class="muted">まだ立ち話をしていません。</li>';
}

// MBTI と誕生日の入力（ここでは保存しない。コメント用の文を作るだけ）
// 公開しているプロフィールの表示（項目の定義から作る。文字は必ずエスケープ）
function profileValues(v) { return { ...(v.profile || {}), ...(v.look ? { look: v.look.body + ':' + v.look.seed + ':' + (v.lookRerolls || 0) } : {}), ...(v.body ? { body: v.body } : {}), ...(v.mbti ? { mbti: v.mbti } : {}), ...(v.birthday ? { birthday: v.birthday } : {}) }; }
// 最初の道具（参加した時に選ぶ。選ばなかった人は、人が少ない仕事の道具）
const startOpt = (config, id) => ((config.startTools && config.startTools.options) || []).find((o) => o.id === id);
function startToolText(v, L, config) {
  const o = startOpt(config, v.startTool || L.startTool);
  if (!o) return 'まだなし';
  return `木の${o.label}（${o.job}が得意）${!v.startTool && L.startAuto ? '・自動で決まった' : ''}`;
}
// 「最初の道具」を変えられるのは、参加した日の間に 1 回だけ
const startLocked = (v, day) => !!v.startToolChanged || (day != null && day > Math.max(1, v.joinedDay)); // 0 日目に来た人は 1 日目まで
function showValue(f, val) {
  if (f.type === 'monthday') return esc(mdText(val));
  if (f.type === 'color') return `<span class="swatch" style="background:${/^#[0-9a-f]{6}$/i.test(val) ? val : '#ccc'}"></span>`;
  if (f.type === 'skin') { const [b, s] = String(val).split(':'); return esc((BODY_LABEL[b] || '') + '・' + s + ' 番'); }
  if (f.type === 'shape') return esc((f.labels || {})[val] || val);
  if (f.id === 'mbti') return `${esc(val)}（${esc(String(val).split('').map((c) => LETTER[c] || '').join('・'))}）`;
  return esc(val);
}
function renderProfileView(v, config) {
  const vals = profileValues(v);
  const rows = (config.profileFields || []).filter((f) => f.public && vals[f.id] !== undefined && vals[f.id] !== '');
  document.getElementById('profview').innerHTML = rows.length ? rows.map((f) => `<dt>${esc(f.label)}</dt><dd>${showValue(f, vals[f.id])}</dd>`).join('') : '<dt>プロフィール</dt><dd>まだ登録されていません。</dd>';
}
// Google ログインで自分の村人を書きかえる
function renderAuth(v, config, ctx = {}) {
  const box = document.getElementById('authbox'), form = document.getElementById('profedit');
  const fields = config.profileFields || [];
  const word = (config.firebase && config.firebase.linkWord) || 'つなぐ';
  const invite = new URLSearchParams(location.search).get('invite');
  let inviteTried = false;
  const render = (A) => {
    form.hidden = true;
    if (A.mode === 'off') { box.innerHTML = '<button type="button" class="gbtn" disabled>Google でログイン（準備中）</button><p class="muted">ログインで書きかえる仕組みは準備中です。今は下の「コメントで送る」を使ってください。</p>'; return; }
    const tag = A.mode === 'demo' ? '<span class="demo">見本の画面（保存しません）</span>' : '';
    if (!A.user) { box.innerHTML = tag + (invite ? '<p><b>DM の招待リンクで開きました。</b>Google でログインすると、そのままこの村人とつながります（コードは要りません）。</p>' : '') + '<button type="button" class="gbtn" id="gin">Google でログイン</button><p class="muted">ログインすると、自分の村人のプロフィールを書きかえられます。メールアドレスは保存しません。</p>'; box.querySelector('#gin').onclick = () => A.signIn(); return; }
    const out = '<button type="button" class="linkbtn" id="gout">ログアウト</button>';
    if (A.linked && A.linked !== v.key) { box.innerHTML = tag + `<p>あなたは<a href="villager.html?k=${encodeURIComponent(A.linked)}">別の村人</a>とつながっています。そのページで書きかえられます。</p>` + out; box.querySelector('#gout').onclick = () => A.signOut(); return; }
    if (!A.linked && invite && !inviteTried) {
      inviteTried = true;
      box.innerHTML = tag + '<p>招待リンクで、この村人とつないでいます…</p>';
      A.useInvite(invite).then(() => render(A)).catch((e) => { box.innerHTML = tag + '<p class="err">' + esc(e.message) + '</p><p class="muted">招待リンクを付けずにこのページを開き直すと、予備の「つなぐ」コードの方法でつなげます。</p>'; });
      return;
    }
    if (!A.linked) {
      const text = `${word} ${A.code || '----'}`;
      box.innerHTML = tag + `<p><b>あと一歩：</b>あなたがどの村人か確かめるため、この文を<b>インスタの登録投稿にコメント</b>してください。次の毎日の更新でつながります（一度だけ使えるコードです）。</p><div class="profout"><code>${esc(text)}</code><button type="button" id="ccopy">コピー</button></div><p class="muted" id="cmsg"></p>` + out;
      box.querySelector('#ccopy').onclick = async () => { try { await navigator.clipboard.writeText(text); box.querySelector('#cmsg').textContent = 'コピーしました。'; } catch { box.querySelector('#cmsg').textContent = '長押しでコピーしてください。'; } };
      box.querySelector('#gout').onclick = () => A.signOut(); return;
    }
    box.innerHTML = tag + '<p>この村人とつながっています。下で書きかえて「保存」を押すと、次の毎日の更新で町に反映されます。</p>' + out;
    box.querySelector('#gout').onclick = () => A.signOut();
    const cur = startOpt(config, v.startTool || (ctx.L && ctx.L.startTool));
    const vals0 = { look: 'none:' + v.skin + ':' + (v.lookRerolls || 0),...profileValues(v), ...(cur ? { startTool: cur.label } : {}) };
    const locked = new Set(fields.filter((f) => f.once === 'joinDay' && startLocked(v, ctx.day)).map((f) => f.id));
    // 見た目の引き直しを使った回数：村人の記録（毎日の更新）と、保存したプロフィールの大きい方（開き直しても戻らない）
    Promise.resolve(A.load ? A.load(v.key) : {}).catch(() => ({})).then((saved) => {
      const sv = window.ProfileFields.parseLookValue(saved && saved.look);
      const lookUsed = Math.max(v.lookRerolls || 0, sv ? sv.used : 0);
      if (sv && sv.used) vals0.look = saved.look; // 保存した見た目（まだ町に反映されていなくても）
      buildForm(form, fields, vals0, async (vals) => {
        for (const id of locked) delete vals[id];
        const r = await A.save(v.key, window.ProfileFields.publicOnly(fields, vals), window.ProfileFields.privateOnly(fields, vals));
        return r === 'demo' ? '見本なので保存していません（本番では Firestore に保存されます）。' : '保存しました。次の更新で町に反映されます。';
      }, locked, { lookUsed });
      form.hidden = false;
    });
  };
  initAuth(v.key, render).catch((e) => { box.innerHTML = '<p class="err">ログインの準備でつまずきました：' + esc(e.message) + '</p>'; });
}
// 項目の定義から入力欄を作る
function buildForm(form, fields, vals, onSave, locked = new Set(), { lookUsed = 0 } = {}) {
  const PFm = window.ProfileFields;
  form.innerHTML = fields.map((f) => {
    const id = 'f_' + f.id, val = vals[f.id] ?? '';
    let input;
    if (f.type === 'select') input = `<select id="${id}"${locked.has(f.id) ? ' disabled' : ''}><option value="">えらばない</option>${f.options.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'shape') input = `<select id="${id}">${(f.options || []).map((o) => `<option value="${esc(o)}"${o === (val || 'normal') ? ' selected' : ''}>${esc((f.labels || {})[o] || o)}</option>`).join('')}</select>`;
    else if (f.type === 'monthday') { const [m, d] = String(val).split('-'); input = `<span class="md"><select id="${id}_m"><option value="">--</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${+m === i + 1 ? ' selected' : ''}>${i + 1}月</option>`).join('')}</select><select id="${id}_d"><option value="">--</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${+d === i + 1 ? ' selected' : ''}>${i + 1}日</option>`).join('')}</select></span>`; }
    else if (f.type === 'color') input = `<input type="color" id="${id}" value="${/^#[0-9a-f]{6}$/i.test(val) ? val : '#7cb342'}"><label class="nocolor"><input type="checkbox" id="${id}_none"${val ? '' : ' checked'}>えらばない</label>`;
    else if (f.type === 'number') input = `<input type="number" id="${id}" value="${esc(val)}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}>`;
    else if (f.type === 'date') input = `<input type="date" id="${id}" value="${esc(val)}">`;
    else if (f.type === 'skin') input = `<span class="lookpick"><canvas class="pixel" id="${id}_c" width="16" height="32"></canvas><span><select id="${id}_b">${BODIES.map((b) => `<option value="${b}">${BODY_LABEL[b]}</option>`).join('')}</select> <button type="button" class="btn sub" id="${id}_r">別のを引く</button><input type="hidden" id="${id}" value="${esc(val)}"><small class="muted" id="${id}_t"></small></span></span>`;
    else input = `<input type="text" id="${id}" maxlength="${f.max || 30}" value="${esc(val)}"><small class="cnt" data-for="${id}"></small>`;
    return `<div class="fld"><label for="${id}">${esc(f.label)}${f.public ? '' : '<span class="priv">非公開</span>'}</label>${input}${locked.has(f.id) ? '<small class="muted">もう変えられません（参加した日に 1 回だけ）</small>' : f.note ? `<small class="muted">${esc(f.note)}</small>` : ''}<small class="ferr" id="${id}_err"></small></div>`;
  }).join('') + '<div class="fld"><button type="submit" class="savebtn">保存</button><span class="muted" id="fmsg"></span></div>';
  // 見た目：体の種類を選ぶ。体の種類を変えた時だけ「別のを引く」を 1 回押せる（使ったら押せない）。下の絵がその見た目
  for (const f of fields.filter((x) => x.type === 'skin')) {
    const id = 'f_' + f.id, hid = form.querySelector('#' + id), sel = form.querySelector('#' + id + '_b'), cv = form.querySelector('#' + id + '_c'), btn = form.querySelector('#' + id + '_r');
    const st = PFm.parseLookValue(hid.value) || { body: 'none', seed: 0, used: 0 };
    st.used = Math.max(st.used, lookUsed);
    const body0 = st.body;
    const write = () => { hid.value = `${st.body}:${st.seed}:${st.used}`; };
    const show = () => {
      sel.value = st.body;
      const L = lookDataUrl({ body: st.body, seed: st.seed });
      loadImage(L.url).then((img) => { const g = cv.getContext('2d'); g.clearRect(0, 0, 16, 32); drawFigure(g, img, false, 1, 0, 0, L.slim); });
      form.querySelector('#' + id + '_t').textContent = L.traits.filter((t) => !t.startsWith('体')).slice(0, 4).join('・');
      const can = PFm.rerollAllowed({ used: st.used, bodyChanged: st.body !== body0 });
      btn.disabled = !can;
      btn.textContent = st.used ? '引き直しは使いました' : '別のを引く';
      btn.title = st.used ? '' : can ? '1 回だけ引き直せます' : '体の種類を変えると、1 回だけ引き直せます';
    };
    sel.onchange = () => { st.body = sel.value; write(); show(); };
    btn.onclick = () => { if (!PFm.rerollAllowed({ used: st.used, bodyChanged: st.body !== body0 })) return; st.seed = Math.floor(Math.random() * 1e9); st.used = 1; write(); show(); };
    write(); show();
  }
  for (const c of form.querySelectorAll('.cnt')) { const inp = form.querySelector('#' + c.dataset.for); const up = () => { c.textContent = `${Array.from(inp.value).length}/${inp.maxLength}`; }; inp.addEventListener('input', up); up(); }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const raw = {};
    for (const f of fields) {
      const id = 'f_' + f.id;
      if (f.type === 'monthday') { const m = form.querySelector('#' + id + '_m').value, d = form.querySelector('#' + id + '_d').value; raw[f.id] = m && d ? `${m}-${d}` : ''; }
      else if (f.type === 'color') raw[f.id] = form.querySelector('#' + id + '_none').checked ? '' : form.querySelector('#' + id).value;
      else raw[f.id] = form.querySelector('#' + id).value;
    }
    const { ok, errors } = PFm.validate(fields, raw);
    for (const f of fields) form.querySelector('#f_' + f.id + '_err').textContent = errors[f.id] || '';
    const msg = form.querySelector('#fmsg');
    if (Object.keys(errors).length) { msg.textContent = '直すところがあります。'; return; }
    msg.textContent = '保存しています…';
    try { msg.textContent = await onSave(ok); } catch (err) { msg.textContent = '保存できませんでした：' + err.message; }
  };
}

function renderProfile(v, config, ctx) {
  renderProfileView(v, config);
  renderAuth(v, config, ctx);
  const word = config.profileWord || 'プロフ';
  const sm = document.getElementById('pmbti'), mo = document.getElementById('pmonth'), da = document.getElementById('pday');
  sm.innerHTML = '<option value="">えらぶ</option>' + MBTI.map((m) => `<option>${m}</option>`).join('');
  mo.innerHTML = '<option value="">--</option>' + Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}月</option>`).join('');
  const fillDays = () => { const n = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(+mo.value || 1) - 1]; const cur = da.value; da.innerHTML = '<option value="">--</option>' + Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join(''); if (+cur <= n) da.value = cur; };
  if (v.mbti) { sm.value = v.mbti; const [m, d] = (v.birthday || '').split('-'); mo.value = String(+m || ''); fillDays(); da.value = String(+d || ''); } else fillDays();
  const out = document.getElementById('ptext'), btn = document.getElementById('pcopy'), msg = document.getElementById('pmsg'), form = document.getElementById('pform');
  const update = () => {
    const ok = sm.value && mo.value && da.value;
    out.textContent = ok ? `${word} ${sm.value} ${String(mo.value).padStart(2, '0')}${String(da.value).padStart(2, '0')}` : '上の 3 つを選ぶと、ここに文ができます';
    btn.disabled = !ok;
    // 送り先は config.profileForm.url で差し替えられる（{text} が作った文になる）
    const url = config.profileForm && config.profileForm.url;
    form.hidden = !(ok && url);
    if (ok && url) form.href = url.replace('{text}', encodeURIComponent(out.textContent));
  };
  for (const el of [sm, da]) el.addEventListener('change', update);
  mo.addEventListener('change', () => { fillDays(); update(); });
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(out.textContent); msg.textContent = 'コピーしました。インスタの登録投稿にコメントしてください。'; }
    catch { const r = document.createRange(); r.selectNodeContents(out); getSelection().removeAllRanges(); getSelection().addRange(r); msg.textContent = '選んだ状態にしました。長押しでコピーしてください。'; }
  });
  update();
}

function renderInventory(L, config, v) {
  const IC = config.inventory, items = config.items;
  const slots = L.slots || IC.base, level = L.level || 1, xp = L.xp || 0;
  document.getElementById('lv').textContent = 'Lv' + level;
  const base = L.xpBase || 0, nxt = L.xpNext || 1;
  document.getElementById('xpbar').style.width = Math.max(0, Math.min(100, ((xp - base) / Math.max(1, nxt - base)) * 100)) + '%';
  document.getElementById('slotsnum').textContent = `枠 ${slots}/${IC.max}`;
  document.getElementById('nextslot').textContent = (L.next || '') + (L.trips ? `（倉庫への往復 これまで ${L.trips} 回）` : '');
  const box = document.getElementById('inv');
  const info = document.getElementById('invinfo');
  const locks = L.locks || [];
  // 夜にチェストへ入れる前（その日の仕事のおわり）の中身。古いデータは今の持ち物
  const held = heldOf(L);
  // 使える枠と、次に開く 2 マスまで（鍵のマスを全部は並べない）。のこりは一行で
  const showLocked = Math.min(2, IC.max - slots);
  for (let i = 0; i < slots + showLocked; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'slot';
    let tip = '';
    if (i < slots) {
      const s = held.list[i];
      if (s) {
        const it = items[s.item] || { name: s.item };
        cell.innerHTML = `<img class="pixel" src="icons/${s.item}.png" alt="">` + (s.n > 1 ? `<span class="n">${s.n}</span>` : '') +
          (s.dur !== undefined ? `<span class="dur"><i style="width:${(s.dur / s.max) * 100}%;background:${s.dur / s.max > 0.5 ? '#4ec04e' : s.dur / s.max > 0.2 ? '#e0c040' : '#d84a3a'}"></i></span>` : '');
        tip = it.name + (s.n ? ` ${s.n} 個` : '') + (s.dur !== undefined ? `（耐久 ${s.dur}/${s.max}）` : '');
      } else { tip = 'あき'; cell.classList.add('vacant'); }
    } else {
      const lk = locks[i - slots];
      cell.classList.add('locked');
      cell.innerHTML = '<img class="pixel lockimg" src="icons/lock.png" alt="">' + (lk ? `<span class="cond">${lk.short}</span>` : '');
      tip = lk ? lk.label : 'まだ開いていない枠';
    }
    cell.title = tip; cell.setAttribute('aria-label', tip);
    cell.addEventListener('click', () => { info.textContent = (i + 1) + ' 番の枠：' + tip; });
    box.append(cell);
  }
  const more = IC.max - slots - showLocked;
  if (more > 0) { const p = document.createElement('p'); p.className = 'invmore'; p.textContent = `ほかに あと ${more} 枠。レベルや住んだ日数で開きます。`; box.after(p); }
  info.textContent = held.label + '。枠を押すと中身が出ます。点線の枠は次に開く条件です。';
  // 夜の見張りで倒した敵
  let tail = info;
  if (L.kills && L.kills.total) {
    const NM = { zombie: 'ゾンビ', skeleton: 'スケルトン', spider: 'クモ' };
    const parts = Object.keys(NM).filter((k) => L.kills[k]).map((k) => `${NM[k]} ${L.kills[k]}`).join('・');
    const p = document.createElement('p'); p.className = 'invmore';
    p.textContent = `夜の見張りで倒した敵 ${L.kills.total} 体（${parts}）。`;
    tail.after(p); tail = p;
  }
  renderBadges(L, config, tail, v);
}

// バッジ：もらったものは絵で並べ、次の段までの残りを添える。まだのものは一番近い 2 つだけ「あと いくつ」
// 称号バッジ（名前の下に出す）がある人は、はじまりの住人（founder）を重ねて出さない（町のカードと同じ。common.js の titleBadges）
function renderBadges(L, config, after, v) {
  const BG = config.badges; if (!BG) return;
  const got = L.badges || {}, box = document.createElement('div'); box.className = 'badges';
  const near = [];
  const hasTitle = badgeList(v, config).some((b) => b.kind === 'title');
  for (const [id, B] of Object.entries(BG.list)) {
    if (B.founder && hasTitle) continue;
    const t = got[id] ?? -1;
    if (t < 0) {
      if (!B.founder) { const n = badgeCount(L, B.stat); near.push({ B, left: B.tiers[0] - n, r: n / B.tiers[0] }); }
      continue;
    }
    const n = B.founder ? 0 : badgeCount(L, B.stat), unit = B.unit || '';
    const title = B.founder ? B.name : `${B.name}（${BG.tierNames[t]}）`;
    const next = !B.founder && t < B.tiers.length - 1 ? `次の${BG.tierNames[t + 1]}まで あと ${B.tiers[t + 1] - n}${unit}` : '';
    const src = B.founder ? `icons/badge_${id}.png` : `icons/badge_${id}_${t}.png`;
    const tip = B.founder ? `${B.name}：${B.note}` : `${title}：${B.note} ${n}${unit}${next ? '。' + next : ''}`;
    const el = document.createElement('figure'); el.className = 'badge'; el.title = tip;
    el.innerHTML = `<img class="pixel" src="${src}" alt="" width="48" height="48"><figcaption>${esc(title)}${next ? `<small>${esc(next)}</small>` : ''}</figcaption>`;
    box.append(el);
  }
  const p = document.createElement('p'); p.className = 'invmore';
  near.sort((a, b) => b.r - a.r);
  const rest = near.slice(0, 2).map(({ B, left }) => `「${B.name}」の銅まで あと ${left}${B.unit || ''}`).join('、');
  p.textContent = (box.children.length ? 'バッジ。' : 'バッジはまだありません。') + (rest ? rest + '。' : '');
  after.after(p);
  if (box.children.length) p.after(box);
}

main().catch(showError);
