// Google ログイン（Firebase Authentication）と、自分の村人のプロフィールの読み書き（Firestore）。
// 設定（js/firebase-config.js）が空なら mode: 'off' を返して、何も読みこまない。
// DM で届いた招待リンク（?invite=印）で開いた時は、ログインすると useInvite でそのまま村人とつながる。
// ?demo-login=code / ?demo-login=linked / ?demo-login=invite を付けると、見本の偽ログインになる（保存はしない。画面の確かめ用）。
// 保存するのは uid と村人の key だけ。メールアドレスは読まない・書かない。
import { firebaseConfig, FIREBASE_VERSION } from './firebase-config.js';

const CODE_CHARS = 'ACDEFGHJKLMNPQRTUVWXY34679';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export const enabled = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export async function initAuth(villagerKey, onChange) {
  const demo = new URLSearchParams(location.search).get('demo-login');
  if (demo) return demoAuth(demo, villagerKey, onChange);
  if (!enabled()) { const a = { mode: 'off' }; onChange(a); return a; }
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [{ initializeApp }, AU, FS] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = initializeApp(firebaseConfig);
  const auth = AU.getAuth(app), db = FS.getFirestore(app);
  const A = {
    mode: 'live', user: null, linked: null, code: null,
    signIn: () => AU.signInWithPopup(auth, new AU.GoogleAuthProvider()),
    signOut: () => AU.signOut(auth),
    async load(key) { const d = await FS.getDoc(FS.doc(db, 'profiles', key)); return d.exists() ? d.data() : {}; },
    // 招待の印を使う：印に「自分が使った」と書き、同じ書きこみで自分を村人につなぐ（firestore.rules が確かめる）
    async useInvite(token) {
      const iref = FS.doc(db, 'invites', token);
      const inv = await FS.getDoc(iref);
      if (!inv.exists()) throw new Error('このリンクは使えません（切れたか、使い終わっています）');
      const d = inv.data();
      if (d.usedBy) throw new Error('このリンクはもう使われています');
      if (d.expiresAt && d.expiresAt.toMillis() < Date.now()) throw new Error('このリンクは切れています（7 日間）');
      const b = FS.writeBatch(db);
      b.update(iref, { usedBy: A.user.uid, usedAt: FS.serverTimestamp() });
      b.set(FS.doc(db, 'users', A.user.uid), { villager: d.villager, invite: token, linkedAt: FS.serverTimestamp() }, { merge: true });
      await b.commit();
      A.linked = d.villager; A.code = null;
      return d.villager;
    },
    async save(key, pub, priv) {
      await FS.setDoc(FS.doc(db, 'profiles', key), { ...pub, updatedAt: FS.serverTimestamp() });
      if (priv && Object.keys(priv).length) await FS.setDoc(FS.doc(db, 'private', key), { ...priv, updatedAt: FS.serverTimestamp() });
    },
  };
  AU.onAuthStateChanged(auth, async (u) => {
    A.user = u ? { uid: u.uid } : null; // 名前やメールは使わない
    A.linked = null; A.code = null;
    if (u) {
      const ref = FS.doc(db, 'users', u.uid);
      const me = await FS.getDoc(ref);
      const data = me.exists() ? me.data() : {};
      if (data.villager) A.linked = data.villager;
      else if (data.code) A.code = data.code;
      else if (!new URLSearchParams(location.search).get('invite')) {
        // 一度だけ使うコードを作る（招待リンクで来た時は、コードを使わずに印でつなぐので作らない）（ほかの人と重なったら作り直す）
        for (let i = 0; i < 4 && !A.code; i++) {
          const c = newCode();
          try { await FS.setDoc(FS.doc(db, 'linkCodes', c), { uid: u.uid, at: FS.serverTimestamp() }); A.code = c; } catch { /* 重なり */ }
        }
        if (A.code) await FS.setDoc(ref, { code: A.code, codeAt: FS.serverTimestamp() }, { merge: true });
      }
    }
    onChange(A);
  });
  return A;
}

// 見本の偽ログイン（保存しない）
function demoAuth(kind, villagerKey, onChange) {
  const A = {
    mode: 'demo', user: null, linked: null, code: null,
    signIn() { A.user = { uid: 'demo-uid' }; if (kind === 'linked') A.linked = villagerKey; else if (kind !== 'invite') A.code = '7K3Q'; onChange(A); },
    async useInvite() { await new Promise((r) => setTimeout(r, 400)); A.linked = villagerKey; A.code = null; return villagerKey; },
    signOut() { A.user = null; A.linked = null; A.code = null; onChange(A); },
    async load() { return {}; },
    async save() { return 'demo'; },
  };
  onChange(A);
  return A;
}
