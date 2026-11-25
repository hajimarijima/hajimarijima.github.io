// 戦いの数字（ダメージ・クリティカル・ガード・たおした）。当たった所から数字がぽんと跳ねて浮き上がり、消える。
// 時間で決まる（同じ時刻なら同じ見た目）ので、止めた画面や巻き戻しでも同じ所に出る。
//   ft.begin() → ft.show(id, 世界の位置, 文字, 種類, 出てからの秒) を何回か → ft.end(camera)
//   種類：dmg 白／crit 黄〜橙（色と大きさだけで分ける。札はつけない）／guard ガード／kill たおした！／hurt 見張りが受けたダメージ（赤で小さく）
// 数字は字体に頼らず、5×7 のドット絵を canvas に自前で描く（ネットがなくても同じ見た目）
const LIFE = { dmg: 1.0, crit: 1.25, guard: 0.9, kill: 1.4, hurt: 0.9 };
// 数字のドット絵（5×7）。横に 1 つ太らせて 6×7 で描く
const GLYPH = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
};
// 種類ごとの 1 ドットの大きさと色（上から下へ、行ごとの色で立体感）
const PIX = {
  dmg: { s: 6, rows: ['#ffffff', '#ffffff', '#ffffff', '#f4f4f4', '#e6e6e6', '#d6d6d6', '#c4c4c4'], edge: '#1a1208' },
  crit: { s: 12, rows: ['#fff7a8', '#ffe45a', '#ffd23a', '#ffb428', '#ff9a1e', '#ff8418', '#f06a12'], edge: '#3a1200' },
  hurt: { s: 4, rows: ['#ff8a7a', '#ff6a5a', '#ff5a4a', '#f04a3a', '#e03a2e', '#cc2e24', '#b42420'], edge: '#2a0606' },
};
function drawNumber(cv, text, kind) {
  const P = PIX[kind], s = P.s, cw = 6, gap = 1, n = text.length;
  const W = n * cw + (n - 1) * gap + 2, H = 7 + 3; // まわりに 1 ドットの縁、下に 1 ドットのかげ
  cv.width = W * s; cv.height = H * s;
  const g = cv.getContext('2d'), on = [];
  for (let i = 0; i < n; i++) {
    const G = GLYPH[text[i]] || GLYPH['-'];
    for (let y = 0; y < 7; y++) for (let x = 0; x < cw; x++) if (G[y][x] === '1' || (x > 0 && G[y][x - 1] === '1')) on.push([1 + i * (cw + gap) + x, 1 + y, y]);
  }
  g.fillStyle = P.edge; // 縁（8 方向）と下のかげ
  for (const [x, y] of on) { g.fillRect((x - 1) * s, (y - 1) * s, 3 * s, 3 * s); g.fillRect((x - 1) * s, (y + 1) * s, 3 * s, 2 * s); }
  for (const [x, y, r] of on) { g.fillStyle = P.rows[r]; g.fillRect(x * s, y * s, s, s); }
}
let styled = false;
function addStyle() {
  if (styled) return; styled = true;
  const st = document.createElement('style');
  // ドット絵風：太い黒い縁取り（8 方向のかげを 2px ずつ）＋角ばった字
  const o = (c, w) => [[-w, 0], [w, 0], [0, -w], [0, w], [-w, -w], [w, -w], [-w, w], [w, w]].map(([x, y]) => `${x}px ${y}px 0 ${c}`).join(',');
  st.textContent = `
.ft-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 5; }
.ft { position: absolute; left: 0; top: 0; white-space: nowrap; font-family: "DotGothic16", "MS Gothic", "Osaka-Mono", monospace; font-weight: 700; line-height: 1; will-change: transform, opacity;
  text-shadow: ${o('#1a1208', 2)}, 0 4px 0 #1a1208; -webkit-font-smoothing: none; font-smooth: never; }
.ft.dmg { color: #ffffff; font-size: 42px; }
.ft.crit { color: #ffc22e; font-size: 84px; }
.ft canvas { display: block; image-rendering: pixelated; position: static !important; width: auto !important; height: auto !important; inset: auto !important; } /* ページ全体の canvas 指定（3D 画面用）に引っぱられないように */
.ft.guard { color: #bfe4ff; font-size: 22px; text-shadow: ${o('#0c2340', 2)}, 0 3px 0 #0c2340; }
.ft.kill { color: #fff1a8; font-size: 26px; text-shadow: ${o('#3a2400', 2)}, 0 4px 0 #3a2400; }
.ft.hurt { color: #ff5a4a; font-size: 18px; text-shadow: ${o('#2a0606', 2)}, 0 3px 0 #2a0606; }`;
  document.head.appendChild(st);
}

export function makeFloatText(THREE) {
  addStyle();
  const layer = document.createElement('div'); layer.className = 'ft-layer'; document.body.appendChild(layer);
  const pool = new Map(), used = new Set(), v = new THREE.Vector3();
  let items = [], shakeAmt = 0;
  return {
    begin() { items = []; shakeAmt = 0; },
    // 出てからの秒 age が 0〜寿命の間だけ見せる
    show(id, pos, text, kind = 'dmg', age = 0) {
      const life = LIFE[kind] || 1;
      if (age < 0 || age > life) return;
      items.push({ id, x: pos.x, y: pos.y, z: pos.z, text: String(text), kind, age, life });
      if (kind === 'crit') shakeAmt = Math.max(shakeAmt, Math.max(0, 1 - age / 0.3));
    },
    // 画面をゆらす量（クリティカルの直後だけ）。カメラを少しずらして描き、描いたら戻す
    shake(camera, t) {
      if (shakeAmt <= 0) return null;
      const a = 0.16 * shakeAmt, keep = camera.position.clone();
      camera.position.x += Math.sin(t * 71) * a; camera.position.y += Math.cos(t * 83) * a * 0.7;
      return () => camera.position.copy(keep);
    },
    // w, h：描く所の大きさ、ox, oy：描く所の左上（画面の中の位置）
    end(camera, w = innerWidth, h = innerHeight, ox = 0, oy = 0) {
      used.clear();
      for (const it of items) {
        v.set(it.x, it.y, it.z).project(camera);
        if (v.z > 1 || v.z < -1) continue;
        let el = pool.get(it.id);
        if (!el) { el = document.createElement('div'); el.innerHTML = '<span></span><canvas></canvas>'; layer.appendChild(el); pool.set(it.id, el); }
        if (el.dataset.k !== it.kind) { el.className = 'ft ' + it.kind; el.dataset.k = it.kind; }
        if (el.dataset.t !== it.text || el.dataset.d !== it.kind) {
          const num = PIX[it.kind] && /^-?\d+$/.test(it.text);
          el.firstChild.textContent = num ? '' : it.text; el.lastChild.style.display = num ? '' : 'none';
          if (num) drawNumber(el.lastChild, it.text, it.kind);
          el.dataset.t = it.text; el.dataset.d = it.kind;
        }
        // ぽんと跳ねる（はじめ大きく → 少し縮む）→ 浮き上がる → 最後に薄くなる
        const k = it.age / it.life, pop = it.age < 0.08 ? 0.5 + it.age / 0.08 * 0.9 : it.age < 0.2 ? 1.4 - (it.age - 0.08) / 0.12 * 0.4 : 1;
        const hop = Math.sin(Math.min(1, it.age / 0.35) * Math.PI) * (it.kind === 'crit' ? 26 : 16);
        const rise = k * (it.kind === 'hurt' ? 30 : 46);
        const drift = ((it.id.length * 7 + it.id.charCodeAt(it.id.length - 1)) % 5 - 2) * 6 * k;
        const x = ox + (v.x + 1) / 2 * w + drift, y = oy + (1 - v.y) / 2 * h - hop - rise;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
        el.style.opacity = String(k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1);
        el.style.display = '';
        used.add(it.id);
      }
      for (const [id, el] of pool) if (!used.has(id)) el.style.display = 'none';
    },
  };
}
