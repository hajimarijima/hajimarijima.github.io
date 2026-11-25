'use strict';
// 種で決まる乱数。同じ種なら同じ並びになる。
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const r = mulberry32(typeof seed === 'string' ? hashStr(seed) : seed >>> 0);
  const api = {
    next: r,
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    range: (a, b) => a + r() * (b - a),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
    weighted(items) { // items: [[value, weight], ...]
      let sum = 0;
      for (const it of items) sum += it[1];
      let x = r() * sum;
      for (const it of items) { x -= it[1]; if (x < 0) return it[0]; }
      return items[items.length - 1][0];
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
  };
  return api;
}

const SKIN_COUNT = 200;
function skinFor(name) { return hashStr('skin:' + name) % SKIN_COUNT; }

module.exports = { hashStr, makeRng, skinFor, SKIN_COUNT };
