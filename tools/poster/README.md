# 投稿ツール（ブラウザで動かす）

YouTube と Instagram の API は使いません。
入っている Google Chrome を動かして、人がする操作をまねします。
Playwright は `npm install -g playwright` で入れたものを使います。ダウンロードはしません。

## 1. はじめに 1 回だけログインする

```
node tools/poster/post.js login
```

- Chrome が開きます。YouTube と Instagram のタブが出ます。
- 自分の手でログインしてください。
- 終わったら Chrome のウィンドウを閉じます。
- ログインは `.poster-profile/` に残ります。次からはログインしなくてよいです。
- このツールはパスワードをさわりません。
- `.poster-profile/` は git に上げません（.gitignore に入れてあります）。人に渡さないでください。
- Google が「安全でないブラウザ」と言ってログインできない時は、ふつうの Chrome で同じ操作ができるか確かめてください。

## 2. YouTube に上げる

```
node tools/poster/post.js youtube video/out.mp4 caption.txt --title "タイトル" --visibility private
```

- YouTube Studio の「作成 → 動画をアップロード」を使います。
- タイトルと説明を入れます。説明は caption.txt の中身です。
- `--title` がない時は、説明の 1 行目をタイトルにします。
- 「子ども向けではありません」を選びます。
- `--visibility` は private（非公開）・unlisted（限定公開）・public（公開）です。書かなければ非公開です。
- アップロードが終わるまで待ってから保存します。最後に動画の URL を出します。

## 3. Instagram にリールを上げる

```
node tools/poster/post.js instagram video/out.mp4 caption.txt
```

- 「作成 → 投稿 → ファイルを選ぶ → 切り取りは元の比率 → 次へ → キャプション → シェア」の順に進みます。

## 4. ためし（--dry-run）

```
node tools/poster/post.js youtube video/out.mp4 caption.txt --dry-run
node tools/poster/post.js instagram video/out.mp4 caption.txt --dry-run
node tools/poster/post.js dm someone message.txt --dry-run
```

- 最後の「保存」「シェア」「送信」の手前で止まります。
- そのときの画面を `tools/poster/shots/` に保存します。
- YouTube は止めても、下書きが Studio に残ることがあります。要らなければ Studio で消してください。

## 5. コメントを読む

```
node tools/poster/post.js comments https://www.instagram.com/p/XXXX/ --out data/inbox_comments.json
```

- 投稿のページを開いて、「さらにコメントを読み込む」「返信を表示」を押しながら全部読みます。
- 出てくる形は `[{ id, username, text, time, timestamp, from: { id, username } }]` です。
- `tools/people.js` の `registrationsFrom()` にそのまま渡せます。
- 注意：画面からは本当の ID が取れません。`from.id` にはユーザー名を入れています。
  名前を変えた人は、別の人として読まれます。API で読んだデータ（数字の ID）とは混ぜないでください。
- `tools/sim.js` に渡す時は `{ "joinComments": [ ...この中身... ] }` の形にしてください。
- 投稿の本文（キャプション）はコメントに入れません。

## 6. DM を送る

```
node tools/poster/post.js dm username message.txt
```

- instagram.com/direct で、その人とのチャットを始めて、message.txt の中身を送ります。
- 決まり：
  - 1 日（日本時間）に 20 件まで。
  - 送るあいだは 40〜90 秒（でたらめに決めます）あけます。早すぎる時は待ってから送ります。
  - 同じ人には 2 回送りません。送った記録は `tools/poster/dm_log.json` にあります。
- `--dry-run` の時は送らず、記録もしません。

## うまくいかない時

- 失敗すると、そのときの画面を `tools/poster/shots/error_...png` に保存します。
- 画面の表示（ボタンの名前）が変わると動かなくなります。日本語と英語の表示に合わせてあります。
- 「投稿用の Chrome がもう開いています」と出たら、そのウィンドウを閉じてからやり直してください。

## 気をつけること

- 自動で何回も投稿したり DM を送ったりすると、Instagram に止められることがあります（アカウントの制限）。
- 数は少なくしてください。1 日に何本も上げない。DM は本当に必要な人だけにしてください。
- 知らない人にたくさん DM を送るのは迷惑になります。返事をくれた人や参加した人だけにしてください。
