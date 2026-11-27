// 手紙の利用のきまり（terms.html に全文）。初めて手紙を書く時に出し、「同意する」を押した人だけが送れる。
//   きまりを変えたら TERMS_VERSION を上げる（同意し直してもらう）。受け口の Worker（worker.mjs の 6)）にも同じ番号がある（テストで同じか確かめる）
export const TERMS_VERSION = 1;
// 短いまとめ（手紙を書く所に出す）
export const TERMS_POINTS = [
  '手紙は、島のみんなが読める「公開」のものです。',
  '悪口、住所・電話・学校の名前・SNS の ID などの個人情報、会う約束、宣伝は書かないでね。',
  '運営は、きまりに合わない手紙を消したり、送れなくしたりできます。',
  '13 歳より下の人は、おうちの人と一緒に使ってね。',
  'こまった時は、Instagram の DM で運営に知らせてください。',
];
export const agreedOk = (t) => !!(t && Number(t.version) >= TERMS_VERSION);
// 通報がこの数たまると、毎日の更新で手紙を隠す（config.mail.reportHide で変えられる）
export const REPORT_HIDE = 3;
