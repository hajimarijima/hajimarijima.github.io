'use strict';
// 名前（インスタのユーザー名・表示名）から、女性か男性かをおおまかに当てる。見た目（スキン）を選ぶためだけに使う。
// 分かりやすい名前だけ当てて、どちらにもある名前（ゆうき・ひかる…）や分からない名前は null（今まで通りのスキン）。
// コメントで「女の子」「男性」などと書いてあれば、そちらを使う（tools/people.js）。
//   guessGender(name) → { gender: 'f' | 'm' | null, conf: 0〜1, why }   confidentGender(name) → 'f' | 'm' | null（確かな時だけ）
const SURE = 0.6; // これ以上の時だけスキンを変える

const F = `mayu mayumi yui yuka yuko yuna yuina yumi yumiko yuri yurika yuria yua yume aya ayaka ayano ayane ayumi ayami saki sakiko misaki
haruka haruna harumi nana nanami nanako rina rino rin riko rika risa rie emi emiko emma ema mio miho miki mika mina minami mai maiko maika
sakura hana hanako hinata hina hinako miku mikuru natsuki natsumi natsuko akane akari airi aiko ai ami asuka azusa chihiro chika chiaki
eri erika erina hitomi honoka kana kanako kanon kaori kaho karin kasumi kazumi keiko kokona kokoro koharu kumi kyoko mami mamiko manami
mana mao mariko mari marina maya megumi meru mei mimi mina minori mirai mitsuki miyu miyuki moe momo momoka momoko nao? nanoha nodoka
noa nozomi reina reiko riho rumi runa ruri sachiko sae sana saori sara sayaka sayuri seira shiho shiori sumire suzu suzuka tomoko tomomi
tomoka wakana yoko yoshiko yuzu yuzuha akiko junko kazuko michiko noriko sachi satomi shizuka tamaki tomoe yae yoshimi kotone kotomi
ichika itsuki? hikari mizuki? anna sarah emily lisa mary maria sophia olivia jessica rose lily amy`;
const M = `kenta kenji ken takuya takumi takeshi takahiro takashi ryusei ryuta ryo ryota ryoma ryosuke ryuji shota shun shunsuke shintaro
yuto yuta yusuke yuya yuma yudai yuichi yuji haruto hayato hiroto hiroki hiroshi hiroyuki daiki daisuke daichi kaito kaisei kazuki kazuya
kazuma kazuto sota souta sosuke ren riku rikuto taiga taichi taiki taisei tatsuya tetsuya tomoya tomoki naoki naoya kosuke koki kota kohei
kenichi kentaro keisuke keita keigo kei? masaki masato masaru masahiro makio minato mitsuru noboru osamu satoshi shinji shinya shingo
shuhei shunta sho shogo shohei sora? tsubasa yamato yoshiki yoshito yoshio yasuhiro yasushi yuki? genki goro hajime hideki hideo isamu
jun? junpei jiro ichiro taro saburo shiro kenzo eiji akira? atsushi go gaku hinata? itsuki? kakeru kanata koji kyosuke manabu minoru
naoto nobuyuki ryu sei? sho shuji soma tatsuki toshiki toshiya yohei yuhei yuito asahi haruki eito aoto akito ritsu rui? daigo
john mike michael david james tom thomas robert daniel kevin`;
// どちらにもある名前（当てない）
const BOTH = `yuki hikaru kaoru makoto nao rei aoi sora haru haruki? akira jun kei sei rui mizuki itsuki hinata yu yuu kazumi? masami hiromi
tomomi? natsu chihiro? shinobu tsukasa nagisa ran ryo? mikoto aki yoshimi? izumi kou kazu nozomu? rio ruka hayate? alex sam chris`;

const list = (s) => s.split(/\s+/).filter((w) => w && !w.endsWith('?'));
const ambiguous = new Set(list(BOTH)); // 「?」の付いた語は迷ったので外してある
const FEM = new Set(list(F).filter((w) => !ambiguous.has(w)));
const MAL = new Set(list(M).filter((w) => !ambiguous.has(w)));

// かなの名前（ひらがなで持つ。カタカナもひらがなにして比べる）
const KF = new Set('まゆ まゆみ ゆい ゆか ゆこ ゆな ゆみ ゆり あや あやか あゆみ さき みさき はるか はるな なな ななみ りな りか りさ えみ みお みほ みき みか みな まい さくら はな はなこ ひな みく なつき なつみ あかね あかり あいり あい あみ あすか かな かなこ かおり かすみ ここな こはる まなみ まみ めぐみ もえ もも ももか ゆず さやか さおり しおり すみれ ともこ ようこ みゆ みゆき ほのか ひとみ ちか えり えりか'.split(' '));
const KM = new Set('けんた けんじ けん たくや たくみ たけし たかし りゅうせい りゅうた りょうた しょうた しゅん ゆうと ゆうた ゆうすけ ゆうや はると はやと ひろと ひろき ひろし だいき だいすけ かいと かずき かずや そうた れん りく たいが たいち たつや なおき こうすけ こうき こうた けいすけ けいた まさき まさと さとし しんじ しんや つばさ やまと たろう じろう いちろう はじめ かける'.split(' '));
const KBOTH = new Set('ゆうき ゆき ひかる かおる まこと なお れい あおい そら はる あきら じゅん けい みずき いつき ひなた ちひろ'.split(' '));

// 名前のうしろに付けがちな言葉（取ってから比べる）
const SUFFIX = ['official', 'offical', 'channel', 'chan', 'desu', 'san', 'kun', 'tan', 'sama', 'japan', 'jp', 'ch', 'tv', 'insta', 'ig', 'gram', 'photo', 'photos', 'daily', 'diary', 'life', 'love', 'days', 'cafe', 'blog', 'room', 'world'];
const PREFIX = ['its', 'im', 'the', 'mr', 'ms', 'miss', 'iam', 'i'];
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function tokens(name) {
  const s = toHira(String(name || '').normalize('NFKC').toLowerCase().replace(/^@/, ''));
  const out = [];
  for (let t of s.split(/[\s._\-\d・/|()（）!！?？~〜♡♥☆★*+]+/)) {
    if (!t) continue;
    if (SUFFIX.includes(t) || PREFIX.includes(t)) continue;
    // くっついた「〜chan」「〜official」も取る（mayuchan → mayu）
    let again = true;
    while (again) {
      again = false;
      for (const x of SUFFIX) if (t.length > x.length + 1 && t.endsWith(x)) { t = t.slice(0, -x.length); again = true; break; }
    }
    t = t.replace(/(ちゃん|くん|さん|です|だよ)$/, '');
    if (t) out.push(t);
  }
  return out;
}

// 1 つの語から当てる
function guessToken(t) {
  if (/^[ぁ-ゖー]+$/.test(t)) {
    if (KBOTH.has(t)) return { gender: null, conf: 0, why: 'どちらにもある名前 ' + t, stop: true };
    if (KF.has(t)) return { gender: 'f', conf: 0.9, why: t };
    if (KM.has(t)) return { gender: 'm', conf: 0.9, why: t };
    if (t.length >= 2 && t.endsWith('こ')) return { gender: 'f', conf: 0.65, why: '〜こ' };
    if (/(すけ|たろう|ろう)$/.test(t)) return { gender: 'm', conf: 0.7, why: '〜すけ・〜ろう' };
    return null;
  }
  if (/^[一-鿿々]+$/.test(t)) { // 漢字：終わりの字だけ（弱い）
    if (/(子|美|奈|菜|花|香|恵|愛|彩|華)$/.test(t)) return { gender: 'f', conf: 0.5, why: '漢字の終わり' };
    if (/(郎|介|輔|太|斗|翔|樹|也|哉|彦|雄|男)$/.test(t)) return { gender: 'm', conf: 0.5, why: '漢字の終わり' };
    return null;
  }
  if (!/^[a-z]+$/.test(t)) return null;
  if (ambiguous.has(t)) return { gender: null, conf: 0, why: 'どちらにもある名前 ' + t, stop: true };
  if (FEM.has(t)) return { gender: 'f', conf: 0.9, why: t };
  if (MAL.has(t)) return { gender: 'm', conf: 0.9, why: t };
  // 名前のあとに何か付いている（mayumayu・kentaro23 など）：4 文字以上の名前で始まり、残りが短い時
  let best = null;
  for (const [set, g] of [[FEM, 'f'], [MAL, 'm']]) for (const w of set) {
    if (w.length >= 4 && t.length > w.length && t.length - w.length <= 4 && t.startsWith(w) && (!best || w.length > best.w.length)) best = { w, g };
  }
  if (best) {
    const rest = t.slice(best.w.length);
    if (!ambiguous.has(rest) && !(best.g === 'f' ? MAL : FEM).has(rest)) return { gender: best.g, conf: 0.7, why: best.w + '…' };
  }
  // 終わりの音（弱い。これだけでは確かにしない）。〜ko・〜suke・〜taro は強め
  if (t.length >= 4 && /ko$/.test(t)) return { gender: 'f', conf: 0.65, why: '〜ko' };
  if (t.length >= 5 && /(suke|taro|ro)$/.test(t)) return { gender: 'm', conf: 0.65, why: '〜suke・〜ro' };
  if (t.length >= 4 && t.length <= 7 && /(mi|ka|na|e)$/.test(t)) return { gender: 'f', conf: 0.4, why: '終わりの音' };
  if (t.length >= 4 && t.length <= 7 && /(ta|to|ki|hiro|ya|o)$/.test(t)) return { gender: 'm', conf: 0.4, why: '終わりの音' };
  return null;
}

function guessGender(name) {
  const hits = [];
  for (const t of tokens(name)) {
    const r = guessToken(t);
    if (!r) continue;
    if (r.stop && !hits.length) return { gender: null, conf: 0, why: r.why };
    if (r.gender) hits.push(r);
  }
  if (!hits.length) return { gender: null, conf: 0, why: '分からない' };
  const gs = new Set(hits.map((h) => h.gender));
  if (gs.size > 1) return { gender: null, conf: 0, why: '女性と男性の名前が両方ある' };
  const top = hits.sort((a, b) => b.conf - a.conf)[0];
  return { gender: top.gender, conf: top.conf, why: top.why };
}
const confidentGender = (name) => { const r = guessGender(name); return r.gender && r.conf >= SURE ? r.gender : null; };

// コメントの「女の子」「女性」「♀」/「男の子」「男性」「♂」。1 文字の「女」「男」は、前後が区切り（空白・記号・はじめ・終わり・です）の時だけ（男前・女王などは読まない）。
// 両方書いてあれば null。strict：住んでいる人のあとからのコメント用。コメントがほぼその言葉だけの時だけ読む
const W_F = /女の子|女のこ|おんなのこ|女性|女子|♀/, W_M = /男の子|男のこ|おとこのこ|男性|男子|♂/;
const SEP = '(?:^|[\\s、,，。！!？?・/／:：「」()（）])';
const END = '(?=$|[\\s、,，。！!？?・/／「」()（）]|です|だよ|でーす)';
const ONE_F = new RegExp(SEP + '女' + END), ONE_M = new RegExp(SEP + '男' + END);
function parseGenderWord(text, { strict = false } = {}) {
  const t = String(text || '').normalize('NFKC').replace(/[@#＃][^\s、,]+/g, ' ');
  if (strict && !/^\s*(?:(?:私|わたし|僕|ぼく|俺|おれ)は)?\s*(女の子|女のこ|おんなのこ|女性|女子|女|♀|男の子|男のこ|おとこのこ|男性|男子|男|♂)\s*(です|だよ|でーす|です。)?[!！。]*\s*$/.test(t)) return null;
  const f = W_F.test(t) || ONE_F.test(t), m = W_M.test(t) || ONE_M.test(t);
  return f && !m ? 'f' : m && !f ? 'm' : null;
}
// looseFood などで、ほかの言葉と取りちがえないように消す時に使う
const GENDER_WORDS = ['女の子', '女のこ', 'おんなのこ', '女性', '女子', '男の子', '男のこ', 'おとこのこ', '男性', '男子', '♀', '♂'];

module.exports = { guessGender, confidentGender, parseGenderWord, GENDER_WORDS, tokens, SURE };
