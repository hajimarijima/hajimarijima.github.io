// 町の画面で「遊びに行く」（?visit=相手）：自分の村人が相手の家の扉まで歩いて行き、中に入る（js/visitroom.js）。帰る時は自分の家へ歩いて帰る。
//   村人どうしの「遊びに行った」（data/visits.json のきょうの分）は、昼すぎに相手の家の前へ行って立ち話をする。
//   town.js の updatePerson は、p.visit がある人を window.TOWN.visitStep にまかせる（パーティの p.party と同じやり方）
import { animate } from './character.js';
import { load, esc } from './common.js';
import { icon } from './icons.js';
import { whoami, api } from './mine.js';
import { visitCfg } from './visits.js';
import { residentsOf, homeLayoutFor, toWorldPos } from './decor.js';
import { loadDecor, loadVisits } from './homedata.js';
import { demoVisits, addDemoVisit, setDemoNote } from './visitlink.js';

const T = () => window.TOWN;
const qs = new URLSearchParams(location.search);
const VILLAGER_HOURS = [14, 16.5]; // 村人どうしが遊びに行く時間
const D = { life: null, decor: null, visits: null };

// 家の前の 2 つの点：小道の外（approach）と、扉の前（door）。家の向きに合わせて町の位置に
function doorPts(b, look) {
  const d = (look && look.d) || 3.4;
  return { approach: toWorldPos(b, { x: 0, z: d / 2 + 3.4 }), door: toWorldPos(b, { x: 0, z: d / 2 + 0.55 }) };
}
const isHouse = (b, config) => { const def = b && config.buildings[b.type]; return !!(def && def.look && def.look.kind === 'house'); };
const homeB = (key) => { const L = D.life[key], TW = T(); return L && L.home ? (TW.world.buildings || []).find((x) => x.id === L.home) : null; };

// ---------- 1 人分の 1 コマ ----------
function visitStep(p, dt, time) {
  const q = p.visit, W = T().walk;
  if (!q) return false;
  p.mode = 'visit'; p.ch.userData.lieY = 0; p.ch.userData.nod = 0;
  W.setTool(p.ch, null); W.setCarry(p.ch, null);
  if (q.phase === 'inside') { p.ch.visible = false; return true; }
  p.ch.visible = true;
  let pose = 'idle';
  if (q.route && q.ri0 < q.route.length) {
    const ri = p.ri; p.ri = q.ri0;
    const done = W.walkTo(p, q.route, dt);
    q.ri0 = done ? q.route.length : p.ri; p.ri = ri;
    if (!done) { pose = 'walk'; if (q.ri0 < q.route.length - 1) W.keepApart(p); } // 扉の前の最後の 1 本は、家にぶつかる扱いで押し出されないように keepApart しない
  } else if (q.face != null) {
    if (W.turnTo(p.ch, q.face, dt) < 0.03) { p.ch.rotation.y = q.face; if (q.arrive) { const f = q.arrive; q.arrive = null; f(p); } }
    pose = q.talk ? 'talk' : 'idle';
  } else if (q.arrive) { const f = q.arrive; q.arrive = null; f(p); }
  p.ch.position.set(p.pos.x, 0, p.pos.z);
  if (p.lod === 'full') animate(p.ch, pose, time + (q.seed || 0) * 10);
  return true;
}
function takeOver(p) {
  const TW = T();
  TW.walk.endChat && TW.walk.endChat(p);
  if (p.talk) { p.talk.on = false; p.talk = null; }
  if (p.bubble) p.bubble.hidden = true;
}
function release(p) { if (!p.visit) return; p.visit = null; p.ch.visible = true; if (p.mode === 'visit') p.mode = 'day'; T().reAct(p); }
// 歩く道：今いる所 → 家の前の小道の外 → 扉の前（最後はまっすぐ）
const routeTo = (from, pts) => T().walk.safeRoute({ ...from }, pts.approach).concat([pts.door]);

// ---------- 自分の村人が遊びに行く ----------
let banner = null;
function showBanner(html, btns = '') {
  if (!banner) { banner = document.createElement('div'); banner.className = 'vbanner'; banner.setAttribute('role', 'status'); document.body.append(banner); }
  banner.innerHTML = `<span>${html}</span>${btns}`;
  banner.hidden = false;
  return banner;
}
const hideBanner = (ms = 0) => setTimeout(() => { if (banner) banner.hidden = true; }, ms);

async function startMyVisit(hostKey) {
  const TW = T(), W = await whoami();
  if (!W.villager) { showBanner('遊びに行くには、自分の村人とつながってください。', `<a class="btn sub" href="me.html">${icon('circle-user', { size: 16 })}<span>自分の村人</span></a>`); return; }
  const me = W.villager, host = TW.villagers.find((v) => v.key === hostKey);
  const b = host && homeB(hostKey);
  if (!host || !b || !isHouse(b, TW.config)) { showBanner('その人の家が見つかりませんでした。'); hideBanner(5000); return; }
  if ((D.life[me.key] || {}).home === b.id) { showBanner('そこは自分の家です。'); hideBanner(4000); return; }
  const p = (TW.people || []).find((x) => x.v.key === me.key);
  if (!p) { showBanner(`${esc(me.display)}さんは、いま町にいないみたいです。`); hideBanner(5000); return; }
  // 1 日の回数（受け口が数える。見本はこの端末で数える）
  const C = visitCfg(TW.config), day = TW.state.day;
  let visit;
  try {
    if (W.mode === 'demo') {
      if (demoVisits(day).length >= C.perDay) throw Object.assign(new Error('limit'), { code: 'limit' });
      visit = { id: 'd' + Date.now().toString(36), to: hostKey }; addDemoVisit(day, visit);
    } else visit = (await api(TW.config, '/visit/go', { to: hostKey })).visit;
  } catch (e) {
    showBanner(e.code === 'limit' ? `きょう遊びに行ける回数（${C.perDay} 回）はおしまいです。また明日ね。` : '遊びに行けませんでした：' + esc(e.message)); hideBanner(6000); return;
  }
  const look = TW.config.buildings[b.type].look, pts = doorPts(b, look);
  takeOver(p);
  if (p.mode === 'sleep' || p.mode === 'gohome') { p.ch.rotation.y = Math.atan2(pts.approach.x - p.pos.x, pts.approach.z - p.pos.z); }
  p.visit = { phase: 'go', route: routeTo(p.pos, pts), ri0: 0, face: Math.atan2(b.x - pts.door.x, b.z - pts.door.z), seed: 0.3, arrive: () => enter(p, me, host, b, look, visit, W) };
  follow(p);
  const stop = showBanner(`${icon('footprints', { size: 16 })} ${esc(host.display)}さんの家へ向かっています`, '<button type="button" class="btn sub vb-stop">やめる</button>');
  stop.querySelector('.vb-stop').onclick = () => { release(p); following = null; hideBanner(); };
}
// カメラを、歩く人に合わせて動かす（回した向きと近さはそのまま）
let following = null;
function follow(p) {
  const TW = T();
  TW.lookAt(p.pos.x, p.pos.z, 15, p.ch.rotation.y + Math.PI + 0.5, 0.95, 0.6);
  following = { p, x: p.pos.x, z: p.pos.z };
}
function followTick() {
  requestAnimationFrame(followTick);
  if (!following) return;
  const { p } = following, TW = T(), dx = p.pos.x - following.x, dz = p.pos.z - following.z;
  if (dx || dz) { TW.controls.target.x += dx; TW.controls.target.z += dz; TW.camera.position.x += dx; TW.camera.position.z += dz; following.x = p.pos.x; following.z = p.pos.z; }
}
async function enter(p, me, host, b, look, visit, W) {
  const TW = T();
  p.visit.phase = 'inside'; following = null;
  showBanner(`${esc(host.display)}さんの家に入りました`); hideBanner(1500);
  const res = residentsOf(b, TW.villagers.filter((v) => !v.gone), D.life), lay = homeLayoutFor(b, look, res, D.decor || {}, TW.config);
  const notes = (D.visits.notes || []).filter((n) => n.home === b.id);
  const byKey = Object.fromEntries(TW.villagers.map((v) => [v.key, v]));
  const { openRoom } = await import('./visitroom.js');
  const note = await openRoom({ me, hostName: host.display, look, list: lay.in, seed: b.id, notes, byKey });
  // 来た人ノートの一言を送る（届くのは次の毎日の更新。見本はこの端末だけ）
  let msg = note == null ? 'またね！' : '来た人ノートに書きました（あしたの朝、相手に届きます）。';
  if (note != null) {
    try { if (W.mode === 'demo') { setDemoNote(TW.state.day, visit.id, note); msg = '来た人ノートに書きました（見本なので送っていません）。'; } else await api(TW.config, '/visit/note', { id: visit.id, note }); }
    catch (e) { msg = '一言を送れませんでした：' + e.message; }
  }
  goBack(p, b, look, msg);
}
// 扉の前から出て、自分の家（なければ出かける前の所の近く）へ歩いて帰る
function goBack(p, b, look, msg) {
  const TW = T(), pts = doorPts(b, look);
  p.pos = { ...pts.door }; p.ch.rotation.y = Math.atan2(pts.approach.x - pts.door.x, pts.approach.z - pts.door.z);
  const hb = homeB(p.v.key), mine = hb && isHouse(hb, TW.config) ? doorPts(hb, TW.config.buildings[hb.type].look) : null;
  const route = [pts.approach].concat(mine ? routeTo(pts.approach, mine) : []);
  p.visit = { phase: 'back', route, ri0: 0, face: mine ? Math.atan2(hb.x - mine.door.x, hb.z - mine.door.z) : null, seed: 0.3, arrive: (q) => { release(q); following = null; showBanner('家に着きました。'); hideBanner(2500); } };
  follow(p);
  showBanner(esc(msg) + '<br>家へ帰っています…'); hideBanner(7000);
}

// ---------- 村人どうし（data/visits.json のきょうの分）。昼すぎに相手の家の前で立ち話 ----------
const V = { on: false, who: new Map() };
function villagerTick() {
  const TW = T(), h = TW.hourNow(), inH = h >= VILLAGER_HOURS[0] && h < VILLAGER_HOURS[1];
  if (inH && !V.on) {
    V.on = true;
    const today = (D.visits.notes || []).filter((n) => n.day === TW.state.day && n.kind === 'villager');
    for (const n of today) {
      const p = (TW.people || []).find((x) => x.v.key === n.from), b = homeB(n.to);
      if (!p || p.visit || p.party || p.photo || p.mode !== 'day' || !b || !isHouse(b, TW.config)) continue;
      const pts = doorPts(b, TW.config.buildings[b.type].look);
      // 扉の前から少し横（郵便受けと反対の側）で、扉の方を向いて話す
      const side = toWorldPos(b, { x: -0.9, z: ((TW.config.buildings[b.type].look || {}).d || 3.4) / 2 + 1.1 });
      takeOver(p);
      const instant = h > VILLAGER_HOURS[0] + 0.3;
      if (instant) { p.pos = { ...side }; }
      p.visit = { phase: 'villager', route: instant ? [] : T().walk.safeRoute({ ...p.pos }, pts.approach).concat([side]), ri0: 0, face: Math.atan2(pts.door.x - side.x, pts.door.z - side.z), talk: true, seed: (n.day % 7) / 7 };
      V.who.set(n.from, p);
    }
  } else if (!inH && V.on) {
    V.on = false;
    for (const p of V.who.values()) if (p.visit && p.visit.phase === 'villager') release(p);
    V.who.clear();
  }
}

async function start() {
  const TW = T();
  [D.life, D.decor, D.visits] = await Promise.all([load('life').catch(() => ({})), loadDecor(), loadVisits()]);
  TW.visitStep = visitStep;
  window.TOWN_VISIT = { V, D, startMyVisit }; // 確かめ用
  requestAnimationFrame(followTick);
  setInterval(villagerTick, 1000); villagerTick();
  const host = qs.get('visit');
  if (host) startMyVisit(host);
}
// 町ができるのを待つ
(function wait(n = 0) {
  const TW = T();
  if (TW && TW.walk && TW.people && TW.state && TW.world && TW.lookAt && TW.controls) { start(); return; }
  if (n < 900) setTimeout(() => wait(n + 1), 100);
})();
