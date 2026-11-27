// 手紙と家の飾りのデータ（mail.html・home.html・me.html・villager.html で共通）。
//   data/mail.json・data/decor.json を読む（まだ無ければ空）。?demo-me=1 の見本では、手紙と飾りの見本を作る（何も保存しない）
import { villagerLetter, thanksLetter } from './letters.js';
import { DECOR, DECOR_IDS, cleanLayout, decorOn } from './decor.js';
import { makeRng } from './play/rules.js';

const get = (n) => fetch('data/' + n + '.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let mailP = null, decorP = null;
// 通報が重なって隠した手紙（hidden）と、この端末で通報した手紙は出さない
const reported = () => { try { return new Set(JSON.parse(localStorage.getItem('town.reported') || '[]')); } catch (e) { return new Set(); } };
export const loadMail = () => (mailP = mailP || get('mail').then((m) => { const r = reported(), x = m && Array.isArray(m.letters) ? m : { letters: [], day: 0 }; return { ...x, letters: x.letters.filter((L) => !L.hidden && !r.has(L.id)) }; }));
export const loadDecor = () => (decorP = decorP || get('decor').then((d) => d || {}));
let visitP = null;
export const loadVisits = () => (visitP = visitP || get('visits').then((m) => (m && Array.isArray(m.notes) ? m : { notes: [], day: 0 })));

// 見本の手紙：ほかの村人から 4 通（今日の分が 2 通）と、お礼の手紙 1 通
export function demoLetters(v, villagers, day, config = null) {
  const others = villagers.filter((x) => x.key !== v.key && !x.gone).slice(0, 6);
  const R = makeRng('demo-mail:' + v.key), r = () => R.next();
  const kinds = ['friend', 'best', 'known', 'family', 'friend'];
  const out = others.slice(0, 4).map((o, i) => ({ id: 'demo' + i, day: Math.max(0, day - (i < 2 ? 0 : i)), from: o.key, to: v.key, kind: 'villager', text: villagerLetter(kinds[i], { from: o.display, to: v.display, weather: i % 2 ? '晴れ' : '雨', job: ['wood', 'food', 'stone', 'smith'][i] }, r) }));
  if (others[4]) out.push({ id: 'demo-t', day: Math.max(0, day - 1), from: others[4].key, to: v.key, kind: 'thanks', ...(decorOn(config) ? { decor: 'bench', text: thanksLetter({ decor: DECOR.bench.name }, r) } : { gift: 'apple', text: thanksLetter({ gift: 'りんご' }, r) }) }); // 家を飾るが近日公開の間は飾りを添えない
  if (others[0]) out.push({ id: 'demo-s', day: Math.max(0, day - 1), from: v.key, to: others[0].key, kind: 'web', gift: 'apple', text: 'この前はありがとう！りんごをどうぞ。' });
  return out.sort((a, b) => a.day - b.day);
}
// 見本の飾り：いくつか持っていて、外に 4 つ・中に 4 つ置いてある
export function demoDecor(look) {
  const own = { flowerbed: 3, fence: 4, lantern: 1, bench: 1, barrel: 1, planter: 2, flag: 1, bed: 1, desk: 1, chair: 2, shelf: 1, rug: 1, picture: 1, lamp: 1, plant: 1 };
  const out = cleanLayout('out', [['flowerbed', 0, 0, 0], ['flowerbed', 1, 0, 0], ['lantern', 2, 2, 0], ['bench', 5, 0, 0], ['planter', 6, 2, 0], ['fence', 0, 2, 0], ['fence', 1, 2, 0]], look, own);
  const inn = cleanLayout('in', [['rug', 0, 1, 0], ['bed', 2, 0, 0], ['shelf', 0, 0, 0], ['picture', 1, 0, 0], ['chair', 1, 1, 1], ['plant', 0, 2, 0]], look, own);
  return { own, out, in: inn, got: [[0, 'bench', 'thanks'], [0, 'lantern', 'treasure'], [0, 'barrel', 'fish']] };
}
export const decorNames = DECOR_IDS.map((id) => [id, DECOR[id].name]);
// 家の見た目（住んでいる家。まだ家がない人は、ふつうの「家」の形で見本を見せる）
export function homeOf(v, D) {
  const L = (D.life || {})[v.key] || {}, b = L.home && (D.world.buildings || []).find((x) => x.id === L.home);
  const def = b && D.config.buildings[b.type];
  if (def && def.look && def.look.kind === 'house') return { b, look: def.look, real: true };
  const look = (D.config.buildings.house && D.config.buildings.house.look) || { kind: 'house', w: 4, d: 3.4, h: 2.2, wall: '#c9a777', roof: '#8a4a32', roofType: 'gable' };
  return { b: { id: 'demo-' + v.key, x: 0, z: 0, rot: 0, variant: 0 }, look, real: false };
}
