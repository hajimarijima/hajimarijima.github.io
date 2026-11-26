# コメントがついたら、すぐ町に反映する受け口（Cloudflare Workers）

置き方の手順（画面でコピペする方法）は **`docs/すぐ反映する手順.md`** にあります。

## しくみ

```
インスタにコメント → Meta の Webhook → この Worker（署名を確かめる）
  → GitHub に repository_dispatch（ig-comment）→ Actions の join → コミット → GitHub Pages
```

- `worker.mjs`：受け口の本体（Cloudflare の画面の `worker.js` にそのまま貼ってよい）。
  - `GET`：Meta の確かめ（`hub.mode=subscribe`・`hub.verify_token`・`hub.challenge`）。
  - `POST`：`X-Hub-Signature-256` を app secret で確かめ、`comments` / `live_comments` の時だけ GitHub に頼む。すぐ `200` を返す。
  - KV（`TOWN_KV`）があれば、`DEBOUNCE_SECONDS`（既定 30 秒）に 1 回だけ頼む。なくても、Actions の順番待ち（`town-join`）が 1 つにまとめる。
  - 2 分ごとの見回り（Cron Trigger・任意）：Webhook が届かない時の代わり。`IG_TOKEN`・`IG_USER_ID`・KV があれば、最近の投稿のコメントの数だけ見て、増えていたら頼む（1 回の見回りでインスタの API 1 回）。
  - 2 分ごとの見回りは、フォロワー数も読んで KV に置く（コメントの数も見る時は API 1 回で両方）。`GET /stats` が `{"followers":123,"at":"…"}` を返す（`Access-Control-Allow-Origin: https://hajimarijima.github.io`・`Cache-Control: max-age=60`）。サイトは `config.json` の `liveStatsUrl` にこの URL を入れると読む。
  - DM で入居（`docs/DMで入居する手順.md`。サイトの `data/config.json` の `dm.enabled` が `true` の時だけ）：`messages` の Webhook で入居の言葉の DM だけ、User Profile API で username・フォローしているかを引いて KV に積み（23 時間）、GitHub に `ig-dm` を頼む（中身は送らない）。`GET /dm/queue`・`POST /dm/done` は `Authorization: Bearer DM_QUEUE_TOKEN` で join.yml（`tools/dm.js`）だけが使う。`/dm/done` で Send API の返事を送り、KV から消す。
- `wrangler.toml.example`：コマンド（`npx wrangler deploy`）で置く人向けの見本。
- コメントの中身・名前は、Worker のどこにも残さない（GitHub に渡すのは投稿の ID だけ）。

## Secrets の名前（値は Cloudflare の画面で入れる。コードに書かない）

| 名前 | 中身 | 要る？ |
|---|---|---|
| `META_VERIFY_TOKEN` | 自分で決めた合言葉（Meta の Webhook の Verify Token と同じ） | 要る |
| `META_APP_SECRET` | Meta のアプリの App secret | 要る |
| `IG_APP_SECRET` | インスタのログインのアプリの Instagram app secret | インスタのログインの時 |
| `GH_DISPATCH_TOKEN` | GitHub の fine-grained token（このリポジトリだけ・Contents: Read and write） | 要る |
| `IG_TOKEN` / `IG_USER_ID` | GitHub の Secrets と同じ | 2 分ごとの見回りを使う時だけ |
| `DM_QUEUE_TOKEN` | 自分で決めた 16 字以上の合言葉（GitHub の Secrets にも同じ値）。DM の入居では `IG_TOKEN`（DM の権限入り）と KV も要る | DM で入居を使う時だけ |

テスト：`node tests/run_tests.js`（署名・中身の読み取り・GET の確かめを、にせの値で確かめる）。
