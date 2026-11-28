'use strict';
// 管理者用の村人（本番の島でテストプレイをするための村人）。みんなには見せない・公開のファイルにも書かない。
//   ・TOWN_STAFF（GitHub の secret。インスタのユーザー名をカンマ区切り）の人が DM で「住みたい」と送ると、村人に staff: true が付く
//     （tools/join.js。返事の DM には、ふつうの村人と同じ専用のリンク ?me= が入る）
//   ・staff の村人の行・暮らし・日記・工房の結果は、data/ の公開のファイル（villagers・life・diary・social・workshop・history）に書かない。
//     TOWN_SALT から作った鍵で暗号化して FILE に置く（外から見えるのは、だれかの暗号の箱があることだけ）
//   ・受付（join.js）と毎日の更新（sim.js）は、読む時に箱の中身を足し、書く時に公開の分からぬく（pub）。終わりに箱を書き（save）、受け口に送る（push）
//   ・staff の村人は：毎日の島の動きに出ない・ほかの村人と仲よくならない・称号をもらわない・町の歴史に書かない
//   ・自分の端末だけ：受け口（Worker）の /me が staff の中身を返し、js/common.js が自分の村人として足す（遊ぶページで遊べる）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = '.k.json';
const staffNames = (env = process.env) => String((env && env.TOWN_STAFF) || '').split(/[\s,]+/).map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
const isStaff = (v) => !!(v && v.staff);
const staffKeys = (villagers) => new Set((villagers || []).filter(isStaff).map((v) => v.key));
const key = () => crypto.createHmac('sha256', process.env.TOWN_SALT || 'town-dev-salt-NOT-SECRET').update('vault-key:staff').digest();

function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unseal(e) {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(e.iv, 'base64'));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8'));
}

// TOWN_STAFF の人に staff: true を付ける（一度付いたら外さない）。付けた数を返す
function markStaff(villagers, env = process.env) {
  const ns = new Set(staffNames(env));
  let n = 0;
  if (!ns.size) return 0;
  for (const v of villagers || []) if (v && !v.staff && ns.has(String(v.name || '').toLowerCase())) { v.staff = true; n++; }
  return n;
}

// 箱を開けて S に足す（villagers・life・workshop.results）。読めない時（鍵がちがう等）は足さない
const loaded = new WeakMap();
function load(S, DATA) {
  const p = path.join(DATA, FILE);
  if (!fs.existsSync(p)) return 0;
  let box = null;
  try { box = unseal(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (e) { console.log('管理者用の村人の箱を読めませんでした'); return 0; }
  const have = new Set((S.villagers || []).map((v) => v.key));
  let n = 0;
  for (const v of box.villagers || []) {
    if (have.has(v.key)) continue;
    S.villagers.push({ ...v, staff: true }); n++;
    if (box.life && box.life[v.key]) S.life[v.key] = box.life[v.key];
  }
  if (S.workshop && box.results) { S.workshop.results = S.workshop.results || {}; for (const [id, r] of Object.entries(box.results)) if (!S.workshop.results[id]) S.workshop.results[id] = r; }
  loaded.set(S, JSON.stringify(box));
  return n;
}

// 公開してよい分（staff をぬいた写し。S は変えない）
function pub(S) {
  const ks = staffKeys(S.villagers);
  if (!ks.size) return { villagers: S.villagers, life: S.life, social: S.social, workshop: S.workshop };
  const life = {}; for (const k in S.life) if (!ks.has(k)) life[k] = S.life[k];
  let social = S.social;
  if (social) {
    const pairs = {}; for (const [pk, p] of Object.entries(social.pairs || {})) if (!pk.split('|').some((k) => ks.has(k))) pairs[pk] = p;
    const view = {}; for (const [k, l] of Object.entries(social.view || {})) if (!ks.has(k)) view[k] = Array.isArray(l) ? l.filter((x) => !(x && ks.has(x.key || x.k || x.with))) : l;
    social = { ...social, pairs, view, talks: (social.talks || []).filter((t) => !((t && (t.who || t.keys || [])) || []).some((k) => ks.has(k))) };
  }
  let workshop = S.workshop;
  if (workshop && workshop.results) { const results = {}; for (const [id, r] of Object.entries(workshop.results)) if (!(r && ks.has(r.who))) results[id] = r; workshop = { ...workshop, results }; }
  return { villagers: S.villagers.filter((v) => !ks.has(v.key)), life, social, workshop };
}

// 箱の中身（staff の村人・暮らし・工房の結果）
function boxOf(S) {
  const ks = staffKeys(S.villagers);
  const box = { villagers: S.villagers.filter((v) => ks.has(v.key)), life: {}, results: {} };
  for (const k of ks) if (S.life[k]) box.life[k] = S.life[k];
  for (const [id, r] of Object.entries((S.workshop && S.workshop.results) || {})) if (r && ks.has(r.who)) box.results[id] = r;
  return box;
}

// 箱を書く（中身が変わった時だけ。iv が毎回ちがうので、同じ中身で書き直すとコミットが増える）。書いたら true
function save(S, DATA) {
  const box = boxOf(S);
  if (!box.villagers.length && !loaded.has(S)) return false;
  const s = JSON.stringify(box);
  if (loaded.get(S) === s) return false;
  fs.writeFileSync(path.join(DATA, FILE), JSON.stringify(seal(box)) + '\n');
  loaded.set(S, s);
  return true;
}

// 受け口に送る（自分の端末の /me が受け取る）。DM_QUEUE_URL / DM_QUEUE_TOKEN がない時は何もしない
async function push(S, { env = process.env, fetchFn = globalThis.fetch } = {}) {
  const url = String(env.DM_QUEUE_URL || '').trim().replace(/\/+$/, ''), token = String(env.DM_QUEUE_TOKEN || '').trim();
  const box = boxOf(S);
  if (!url || !token || !box.villagers.length || !fetchFn) return 0;
  const items = {};
  for (const v of box.villagers) {
    const results = {}; for (const [id, r] of Object.entries(box.results)) if (r.who === v.key) results[id] = r;
    items[v.key] = { villager: v, life: box.life[v.key] || null, results, at: new Date().toISOString() };
  }
  try {
    const r = await fetchFn(url + '/staff/put', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'town-staff' }, body: JSON.stringify({ items }) });
    if (!r.ok) { console.log('管理者用の村人を受け口に送れませんでした（' + r.status + '）'); return 0; }
    return Object.keys(items).length;
  } catch (e) { console.log('管理者用の村人を受け口に送れませんでした'); return 0; }
}

// 町の歴史から staff が出てくる行を消す（その場で消す。消した数を返す）
function scrubHistory(history, villagers) {
  const ks = staffKeys(villagers);
  if (!ks.size || !Array.isArray(history)) return 0;
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) if (((history[i] && history[i].who) || []).some((k) => ks.has(k))) { history.splice(i, 1); n++; }
  return n;
}

module.exports = { FILE, staffNames, isStaff, staffKeys, markStaff, load, pub, save, push, scrubHistory, seal, unseal };
