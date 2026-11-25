// data/ の分け方（サイトと sim.js で共通）。
// 日記と locks（持ち物の枠がいつ開くか）は life.json から出して、人ごとに data/diary/NN.json へ分ける（最初に読む life.json を小さくする）。
// 人数が多くても毎日のファイルの書きこみが増えすぎないように、名前から決まる 64 組に分けて、1 組 1 ファイルにする。
// 中身は { 村人のキー: { diary: 日ごとの行の配列 [{ day, date, text }], locks } }。村人のページを開いた時だけ、その人の組のファイルを読む。
export const DIARY_GROUPS = 64;
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const diaryGroup = (key) => fnv(String(key)) % DIARY_GROUPS;
export const diaryFile = (g) => 'diary/' + String(g).padStart(2, '0') + '.json';
export const diaryPath = (key) => diaryFile(diaryGroup(key));
