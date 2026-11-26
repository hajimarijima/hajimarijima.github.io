#!/usr/bin/env node
'use strict';
// data/config.json の votePostUrl（投票の投稿）と joinPostUrl（住みたいの投稿）を書きかえる。
// Actions の「投稿の URL を変える」（.github/workflows/set-post.yml）から動く。手でも動かせる：
//   VOTE_URL="https://www.instagram.com/p/XXXX/" JOIN_URL="" node tools/set_post.js
// VOTE_URL：空なら変えない。「消す」なら空にする（Secrets の IG_VOTE_MEDIA に戻る）
// JOIN_URL：空なら変えない。URL なら joinPostUrl のならびに足す（前の投稿も受け付けつづける）。「消す」ならならびを空にする
// ファイルの形（ほかの行・字下げ）はそのまま、その値のところだけ書きかえる。
const fs = require('fs');
const path = require('path');
const { postCode } = require('./instagram');

const CONFIG = path.join(__dirname, '..', 'data', 'config.json');
const CLEAR = /^(消す|けす|クリア|clear|none|なし)$/i;

// 貼った URL を、きれいな形にする（?igsh=… などを落とす）。インスタの投稿でなければ null
function cleanUrl(url) {
  const c = postCode(url);
  if (!c) return null;
  const kind = /\/(reel|reels)\//i.test(String(url)) ? 'reel' : 'p';
  return `https://www.instagram.com/${kind}/${c}/`;
}

const VALUE = '("(?:[^"\\\\]|\\\\.)*"|null|\\[[^\\]]*\\])';
function setKey(text, key, value, afterKey) {
  const re = new RegExp(`("${key}"\\s*:\\s*)${VALUE}`);
  const js = JSON.stringify(value).replace(/","/g, '", "');
  if (re.test(text)) return text.replace(re, (m, head) => head + js);
  // まだ無い時は afterKey の行のあとに足す
  const after = new RegExp(`(\\n([ \\t]*)"${afterKey}"\\s*:\\s*${VALUE},?)`);
  const m = text.match(after);
  if (m) {
    const comma = m[1].endsWith(',');
    const rep = (comma ? m[1] : m[1] + ',') + `\n${m[2]}"${key}": ${js}` + (comma ? ',' : '');
    return text.replace(after, () => rep);
  }
  const o = JSON.parse(text); o[key] = value; return JSON.stringify(o, null, 2) + '\n';
}

// text：config.json の中身。返すのは { text, changes（日本語の説明）}。悪い URL は Error
function applyPostUrls(text, voteUrl, joinUrl) {
  const cfg = JSON.parse(text);
  const changes = [];
  const v = String(voteUrl || '').trim(), j = String(joinUrl || '').trim();
  if (v) {
    if (CLEAR.test(v)) { text = setKey(text, 'votePostUrl', '', 'account'); changes.push('投票の投稿の URL を消した'); }
    else {
      const u = cleanUrl(v);
      if (!u) throw new Error(`投票の投稿の URL がインスタの投稿に見えません：${v}（例 https://www.instagram.com/p/XXXXXXXX/）`);
      text = setKey(text, 'votePostUrl', u, 'account'); changes.push(`投票の投稿 → ${u}`);
    }
  }
  if (j) {
    let list = (Array.isArray(cfg.joinPostUrl) ? cfg.joinPostUrl : [cfg.joinPostUrl]).map((s) => String(s || '').trim()).filter(Boolean);
    if (CLEAR.test(j)) { list = []; changes.push('住みたいの投稿の URL を消した'); }
    else {
      const u = cleanUrl(j);
      if (!u) throw new Error(`住みたいの投稿の URL がインスタの投稿に見えません：${j}（例 https://www.instagram.com/p/XXXXXXXX/）`);
      if (list.some((x) => postCode(x) === postCode(u))) changes.push(`住みたいの投稿 ${u} はもう入っています`);
      else { list.push(u); changes.push(`住みたいの投稿に足した → ${u}（ぜんぶで ${list.length} 件）`); }
    }
    text = setKey(text, 'joinPostUrl', list.length === 0 ? '' : list.length === 1 ? list[0] : list, 'votePostUrlNote');
  }
  JSON.parse(text); // こわれていないか
  return { text, changes };
}

function main() {
  const v = process.env.VOTE_URL || '', j = process.env.JOIN_URL || '';
  if (!v.trim() && !j.trim()) { console.error('URL が空です。投票の投稿か住みたいの投稿の URL を貼ってください'); process.exit(1); }
  const before = fs.readFileSync(CONFIG, 'utf8');
  let r;
  try { r = applyPostUrls(before, v, j); } catch (e) { console.error(e.message); process.exit(1); }
  if (r.text !== before) fs.writeFileSync(CONFIG, r.text);
  for (const c of r.changes) console.log(c);
  if (r.text === before) console.log('config.json は変わりませんでした');
}
module.exports = { cleanUrl, applyPostUrls, setKey };
if (require.main === module) main();
