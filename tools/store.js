'use strict';
// data/ の読み書き（sim.js・init.js・テストで共通）。
//   world.json：木と岩は地図の文字（js/tilemap.js）で保存し、読む時にいつもの一覧へ戻す。
//   life.json：日記をぬいて保存し、日記は人ごとのファイル data/diary/*.json に分ける（js/datafiles.js）。
const fs = require('fs');
const path = require('path');
const TM = require('../js/tilemap.js');
const DF = require('../js/datafiles.js');

const readJSON = (p, d) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d);
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1) + '\n');

function readWorld(dir) { return TM.decodeWorld(readJSON(path.join(dir, 'world.json'))); }
function writeWorld(dir, world, opt) { writeJSON(path.join(dir, 'world.json'), TM.encodeWorld(world, opt)); }

const groupRaw = new Map(); // 読んだ時の組のファイルの中身（書く時に、変わったかを比べる）
function readLife(dir) {
  const life = readJSON(path.join(dir, 'life.json'), {});
  const groups = {};
  for (let g = 0; g < DF.DIARY_GROUPS; g++) {
    const p = path.join(dir, DF.diaryFile(g)), raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    groupRaw.set(p, raw); groups[g] = raw ? JSON.parse(raw) : {};
  }
  for (const k in life) {
    const L = life[k];
    if (Array.isArray(L.diary)) continue; // 古い形（日記が life.json の中）
    const d = groups[DF.diaryGroup(k)][k] || {};
    L.diary = d.diary || [];
    if (d.locks) L.locks = d.locks;
    delete L.diaryLast; delete L.diaryN;
  }
  return life;
}
// 人ごとの日記と「持ち物の枠がいつ開くか」（locks：村人のページでしか使わない）は、64 組のファイルへ。中身が変わった組だけ書く
function writeLife(dir, life) {
  const ddir = path.join(dir, 'diary');
  fs.mkdirSync(ddir, { recursive: true });
  const slim = {}, groups = Array.from({ length: DF.DIARY_GROUPS }, () => []);
  for (const k in life) {
    const { diary = [], locks, ...rest } = life[k];
    slim[k] = { ...rest, diaryLast: diary[diary.length - 1] || null, diaryN: diary.length };
    groups[DF.diaryGroup(k)].push(JSON.stringify(k) + ':' + JSON.stringify(locks ? { diary, locks } : { diary }));
  }
  groups.forEach((rows, g) => {
    const p = path.join(dir, DF.diaryFile(g)), s = '{\n' + rows.join(',\n') + '\n}\n';
    if (!rows.length && !groupRaw.get(p) && !fs.existsSync(p)) return;
    if (groupRaw.get(p) !== s) { fs.writeFileSync(p, s); groupRaw.set(p, s); }
  });
  // 1 人 1 行（空白を入れず小さく、差分は人ごとに見える）
  fs.writeFileSync(path.join(dir, 'life.json'), '{\n' + Object.keys(slim).map((k) => JSON.stringify(k) + ':' + JSON.stringify(slim[k])).join(',\n') + '\n}\n');
}
module.exports = { readWorld, writeWorld, readLife, writeLife, readJSON };
