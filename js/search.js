// 村人さがし：インスタのユーザー名か、あだ名・表示名の一部で村人を見つける（大文字小文字・全角半角・先頭の @ は気にしない）
// 名前をかくしている人（hidden）は、あだ名（display）でだけ見つかる。ユーザー名では見つからず、インスタへのリンクも出さない。
// （このファイルは画面とテストの両方で使う。DOM は使わない）

// 入力をそろえる：NFKC・前後の空白を取る・小文字・先頭の @ を外す
export const normQ = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase().replace(/^@+/, '').trim();

// インスタのユーザー名として使える形（英数字・ピリオド・アンダーバー、30 文字まで）
const IG_RE = /^[a-z0-9._]{1,30}$/i;

// さがしてよい名前：かくしていない人はユーザー名と表示名、かくしている人は表示名（あだ名）だけ
export function searchKeys(v) {
  const keys = [normQ(v.display)];
  if (!v.hidden && v.name) keys.push(normQ(v.name));
  return keys.filter(Boolean);
}

// q に合う村人を、よく合う順に返す（ぴったり → 先頭が同じ → 途中に入っている）
export function searchVillagers(list, q, max = 20) {
  const n = normQ(q);
  if (!n) return [];
  const hits = [];
  for (const v of list) {
    let best = 9;
    for (const k of searchKeys(v)) {
      const r = k === n ? 0 : k.startsWith(n) ? 1 : k.includes(n) ? 2 : 9;
      if (r < best) best = r;
    }
    if (best < 9) hits.push({ v, r: best });
  }
  hits.sort((a, b) => a.r - b.r || (a.v.joinedDay || 0) - (b.v.joinedDay || 0));
  return hits.slice(0, max).map((h) => h.v);
}

// ?who=<名前> で開く人：ぴったり合う人だけ（共有したリンクで別の人が開かないように）
export function findExact(list, q) {
  const n = normQ(q);
  if (!n) return null;
  return list.find((v) => searchKeys(v).includes(n)) || null;
}

// インスタを見るリンク：かくしていない人で、ユーザー名の形のときだけ
export function igUrl(v) {
  if (!v || v.hidden || !v.name) return null;
  const u = normQ(v.name);
  return IG_RE.test(u) ? `https://www.instagram.com/${encodeURIComponent(u)}/` : null;
}
