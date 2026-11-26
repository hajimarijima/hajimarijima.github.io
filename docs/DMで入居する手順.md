# DM で入居する手順（権限が取れたら on にする）

インスタのアカウントに DM で「住みたい」と送ってもらうと、コメントの「住みたい」と同じように町に住み、返事の DM で家のリンクが届く仕組みです。
仕組みはもうできていて、**`data/config.json` の `dm.enabled` が `false` のあいだは何もしません**。
下の 1〜6 をして、最後に `dm.enabled` を `true` にするだけで動きます。

```
DM「住みたい」→ Meta の messages の Webhook → Cloudflare の受け口（KV に積む）→ GitHub の join（ig-dm）
  → join.js で入居（コメントと同じ関数）→ コミット → 受け口が Send API で返事
  「〇〇さん、はじまり島へようこそ！あなたの家はこちら → https://hajimarijima.github.io/?v=<村人の番号>」
```

- 先に **docs/すぐ反映する手順.md の 1〜5**（GitHub の鍵・Cloudflare・Worker・KV・Webhook）を済ませておきます。DM はその受け口（`tools/webhook/worker.mjs`）をそのまま使います。
- 合言葉・鍵は、ファイルに書かず、Cloudflare と GitHub の画面の入れる欄にだけ入れます。
- 公開リポジトリには、送り主の IGSID・ユーザー名・DM の文を書きません。村人のデータに入るのは、コメントの入居と同じ「塩入りの印」だけです（名前をかくす人は名前も入らない）。DM の中身は Cloudflare の KV に 23 時間だけ置かれ、返事をしたら消えます。

---

## 1. 権限：instagram_business_manage_messages

DM を読む・返すには、インスタの鍵（`IG_TOKEN`）にこの権限が要ります。

### 「インスタのログイン」（鍵が `IG` で始まる）の時

1. developers.facebook.com → My Apps → 町のアプリ → 左の **Instagram** → **API setup with Instagram login**。
2. **Permissions（権限）** に `instagram_business_basic` と **`instagram_business_manage_messages`** があることを確かめる（なければ **Add** / 追加）。
3. **Generate access tokens（アクセストークンを作る）** で町のアカウントをつなぎ直し、新しい鍵を作る（DM の権限の確認の画面が出たら許可）。
4. 新しい鍵を、GitHub の Secrets の `IG_TOKEN` と、Cloudflare の Worker の Secret の `IG_TOKEN` の **両方** に貼る。

### 「Facebook のログイン」（鍵が `EAA` などの時）

1. 鍵に `instagram_basic`・`instagram_manage_messages`・`pages_manage_metadata`・`pages_messaging` を付けて作り直す（Graph API エクスプローラ）。
2. DM を送るのは **Facebook ページの鍵（Page access token）** です。Worker の `IG_TOKEN` にはページの鍵を入れます。
3. インスタのアプリの **設定 → プライバシー → メッセージ** で「**メッセージへのアクセスを許可**（Allow access to messages / 接続されたツール）」をオンにする。

---

## 2. Webhook で messages を受け取る

docs/すぐ反映する手順.md の 5 で comments をオンにした所と同じ画面で、**messages** の **Subscribe** もオンにします。

- インスタのログイン：**Instagram → API setup with Instagram login → Configure webhooks** の一覧の **messages**。
- Facebook のログイン：**Webhooks → Instagram** の一覧の **messages**（ページの Webhook も要ることがある：Webhooks → Page → `messages`）。

アカウントでのオン（GitHub の Actions → **ig-check** → **webhook をオンにする**）がもう済んでいれば、もう一度しなくてよいことが多いですが、届かない時はもう一度動かしてください。
（ig-check が今オンにするのは `comments` です。DM が届かない時は Graph API エクスプローラで `POST /me/subscribed_apps?subscribed_fields=comments,messages` をする）

---

## 3. Advanced Access（アプリ審査）

- アプリが **開発中（Development）** のあいだは、**アプリの役割を持っている人（管理者・開発者・テスター）** の DM しか届きません。
- ほかの人の DM を受けるには、アプリを **Live** にして、`instagram_business_manage_messages`（Facebook のログインなら `instagram_manage_messages`）の **Advanced Access** をアプリ審査で取ります。ビジネスの確認（Business Verification）も聞かれます。
- 審査で出すもの（例）：
  - 使い方の説明：「フォロワーが DM で『住みたい』と送ると、町の島づくりのサイトに村人として登録し、その人の家のリンクを DM で 1 回だけ返す。こちらから先に DM は送らない」
  - 画面の録画：テスターのアカウントで DM を送る → 返事が届く → リンクを開くと家にカメラが寄る、まで
  - プライバシーポリシーの URL（DM の中身は 23 時間で消すこと・公開データには塩入りの印しか書かないことを書く）
- 返事は **相手が送ってから 24 時間の中** だけ送ります（Meta の決まり。受け口は 24 時間を過ぎた DM には返事しません）。

---

## 4. Worker（Cloudflare）に足すもの

Worker（town-webhook）→ **Settings** → **Variables and Secrets**。

| 名前 | 種類 | 入れる値 |
|---|---|---|
| `DM_QUEUE_TOKEN` | Secret | 自分で決めた長い合言葉（英数字 30 字くらい。**16 字より短いと使えない**）。手順 5 の GitHub にも同じ値 |
| `IG_TOKEN` | Secret | 手順 1 の DM の権限の入った鍵（Facebook のログインならページの鍵） |
| `DM_SEND_ID` | Variable（任意） | 返事を送る `/{id}/messages` の id。ふつうは入れない（既定 `me`）。Facebook のログインで `me` が通らない時はページの ID |
| `DM_CONFIG_URL` | Variable（任意） | DM の設定を読む所。ふつうは入れない（既定 `https://hajimarijima.github.io/data/config.json`） |

- **KV（`TOWN_KV`）は必須**（DM を積んでおく所）。docs/すぐ反映する手順.md の 3-2。
- `GH_DISPATCH_TOKEN` があると、DM が来た時にすぐ join が動きます（なくても 15 分ごとの join が拾います）。
- `tools/webhook/worker.mjs` を新しくしたので、Worker の中身をもう一度まるごと貼って **Deploy** してください。

受け口は、サイトの `data/config.json` の `dm` を 5 分ごとに読みます。`dm.enabled` が `false` なら DM は積みません。`dm.words` の言葉が入っていない DM（ふつうの話）も積みません。

---

## 5. GitHub に足すもの

リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**。

| 名前 | 入れる値 |
|---|---|
| `DM_QUEUE_URL` | Worker の URL（例 `https://town-webhook.〇〇.workers.dev`。後ろの `/` はあってもなくてもよい） |
| `DM_QUEUE_TOKEN` | 手順 4 と同じ合言葉 |

join.yml はもう DM を読むようになっています（`node tools/dm.js pull` → `node tools/join.js` → コミット → `node tools/dm.js done`）。
Secrets がないあいだ、または `dm.enabled` が `false` のあいだは「DM は見ません」と出るだけで、ほかの受付はふつうに動きます。

---

## 6. テスターで試す（審査の前に）

1. developers.facebook.com → 町のアプリ → **App roles（アプリの役割）→ Roles** → **Add people** で、試す人のインスタのアカウントを **Instagram Tester**（インスタのテスター）に足す。
2. 試す人のインスタ：**設定 → アプリとウェブサイト → テスターへの招待** で承認する。
3. `data/config.json` の `dm.enabled` を `true` にしてコミット（GitHub の画面で鉛筆のボタン → `"enabled": false` を `true` に → Commit changes）。サイトに出るまで 1〜2 分待つ。
4. 試す人のアカウントで、町のアカウントをフォローしてから、DM で「住みたい」と送る。
5. Cloudflare の Worker の **Logs** に「DM：積みました 1」→ GitHub の **Actions → join** が `repository_dispatch` で動く → ログに「DM：1 件・新しく住んだ人 1 人」→「DM の返事：1 件を渡しました・送れた 1 件」。
6. 返事の DM のリンクを開くと、その人の家にカメラが寄って、村人のカードが開く。
7. もう一度「住みたい」と送ると、新しい家は作らず「もう住んでいます」と元の家のリンクが返る。フォローを外して別のアカウントで送ると「フォローしてからもう一度」と返る。

Meta の画面の **messages** の **Test**（テスト送信）は本物の人ではないので、名前が引けず「もう一度送ってね」になるか、何もしません。それで正しい動きです。

うまくいかない時：
- Worker のログに「DM：送り主のプロフィールを読めませんでした 400/403」→ 鍵に DM の権限がない・テスターの承認がまだ。
- 「DM：返事を送れませんでした 400/403」→ 鍵の種類（Facebook のログインならページの鍵）・`DM_SEND_ID`・24 時間を過ぎていないか。
- join のログに「受け口から DM を読めませんでした（403）」→ GitHub と Worker の `DM_QUEUE_TOKEN` が同じか。
- 「DM：TOWN_KV か IG_TOKEN がないので受けられません」→ 手順 4。

---

## 設定（data/config.json の dm）

| 項目 | 既定 | 意味 |
|---|---|---|
| `enabled` | `false` | `true` で DM の入居が動く |
| `words` | `住みたい・すみたい・入居・入村` | DM で読む言葉（「住みたくない」「入居しない」は読まない） |
| `readOptions` | `true` | コメントと同じ書き方（`住みたい ピッケル 12月11日 りんご INFP`）で道具・誕生日・好きな食べ物・MBTI も読む |
| `requireFollow` | `true` | フォローしている人だけ住める（分からなかった時は通す。もう住んでいる人は見ない） |
| `siteUrl` / `houseUrl` | `https://hajimarijima.github.io/` / `{site}?v={id}` | 返事に入れる家のリンク |
| `messages` | | 返事の文（`welcome`・`already`・`notFollowing`・`retry`。`{name}`・`{url}`・`{word}` が入る） |
| `howTo` / `howToSteps` | | サイトの「住み方」に使える文。`enabled` が `true` の時だけ、町のページの「村人になるには」の後ろに `howTo` が出る |

同じ人がコメントと DM の両方で来ても、村人は 1 人です（インスタの ID の印、なければユーザー名の印で同じ人と分かる。コメントと DM で ID の形がちがう時は、名前で見つけて、その ID の印も覚える）。
