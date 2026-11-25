'use strict';
// 岩の中身（ブロックごとの種類）。岩ごとに「種 + 岩の id」で決まるので、何度動かしても同じになる。
// 文字：s 石 / c 石炭 / i 鉄鉱石 / g 金鉱石 / d ダイヤ。0 番目が最初に掘られる（いちばん上）。
const { makeRng } = require('./rand');

const ORE_ITEM = { c: 'coal', i: 'iron', g: 'gold', d: 'diamond' };
const RARE = new Set(['i', 'g', 'd']); // 見つけたら履歴に残す
const DEFAULT = { coal: 0.14, iron: 0.08, gold: 0.025, diamond: 0.008 };

function genBlocks(seed, rock, ores) {
  const p = { ...DEFAULT, ...(ores || {}) };
  const R = makeRng(seed + ':ore:' + rock.id);
  let s = '';
  for (let i = 0; i < rock.max; i++) {
    const x = R.next();
    // 上のほう（外がわ）は石が多く、下の芯ほど鉱石が出やすい
    const deep = 0.6 + 0.8 * (i / Math.max(1, rock.max - 1));
    if (x < p.diamond * deep) s += 'd';
    else if (x < (p.diamond + p.gold) * deep) s += 'g';
    else if (x < (p.diamond + p.gold + p.iron) * deep) s += 'i';
    else if (x < (p.diamond + p.gold + p.iron + p.coal) * deep) s += 'c';
    else s += 's';
  }
  return s;
}
const ensureBlocks = (seed, rock, ores) => { if (!rock.blocks || rock.blocks.length !== rock.max) rock.blocks = genBlocks(seed, rock, ores); return rock.blocks; };

module.exports = { genBlocks, ensureBlocks, ORE_ITEM, RARE };
