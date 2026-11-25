// Firebase の設定（空の見本）。
// Firebase のコンソールで「ウェブアプリ」を作ったあとに出る値を入れてください（README の「Google ログイン」を参照）。
// ここに入れる apiKey などは公開されても問題のない値です（守りは firestore.rules で行います）。
// 空のままなら、ログインのボタンは「準備中」になり、サイトはそのまま動きます。
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
};
// Firebase の読みこみ先（版を固定）
export const FIREBASE_VERSION = '10.12.2';
