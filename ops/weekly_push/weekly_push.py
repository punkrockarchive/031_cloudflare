"""
weekly_push.py

Cloudflare Pages の
POST /api/line/push_weekly
を呼び出して、LINE グループへ投稿リンクを送信する運用スクリプト。

設計方針
- Windows / Raspberry Pi 共通で動作
- 設定値は config.json に外出し
- cron / タスクスケジューラから実行可能

このスクリプトの役割
1. config.json を読む
2. Cloudflare Pages の push_weekly API に POST する
3. 応答結果を標準出力へ表示する
"""

import json
import urllib.request
from pathlib import Path
from datetime import datetime

# ------------------------------------------------------------
# 設定ファイルの場所を決める
# ------------------------------------------------------------
# __file__ は「この weekly_push.py 自身のパス」
# resolve().parent で「このファイルが置いてあるフォルダ」を取得する
BASE_DIR = Path(__file__).resolve().parent

# 同じフォルダにある config.json を読む前提
CONFIG_PATH = BASE_DIR / "config.json"

# 設定ファイルが無ければ即エラーにする
# → 実行時に「設定が不足している」ことを早めに分かるようにする
if not CONFIG_PATH.exists():
    raise FileNotFoundError("config.json が見つかりません")

# config.json を UTF-8 で読み込み、辞書オブジェクトへ変換する
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

# ------------------------------------------------------------
# Cloudflare Pages API に送る POST ボディを作る
# ------------------------------------------------------------
# push_weekly API が期待している JSON は以下
# {
#   "url": "...LINEで送りたい投稿リンク...",
#   "text": "...メッセージ本文..."
# }
#
# json.dumps(...) で JSON 文字列へ変換し、
# encode("utf-8") で HTTP 送信用の bytes に変換する
payload = json.dumps({
    "url": config["post_url"],
    "text": config["text"]
}).encode("utf-8")

# ------------------------------------------------------------
# HTTP リクエストを組み立てる
# ------------------------------------------------------------
# push_url:
#   Cloudflare Pages 側の A-2 API
#
# x-api-key:
#   Cloudflare Pages 側の簡易認証用ヘッダ
#
# content-type:
#   JSON を送るので application/json
req = urllib.request.Request(
    url=config["push_url"],
    data=payload,
    method="POST",
    headers={
        "content-type": "application/json",
        "x-api-key": config["pull_api_key"]
    }
)

# ------------------------------------------------------------
# 実行開始ログ
# ------------------------------------------------------------
print("=== weekly_push start ===")
print("time:", datetime.now().isoformat())

# ------------------------------------------------------------
# Cloudflare Pages API を呼び出す
# ------------------------------------------------------------
try:
    # API 呼び出し成功時
    with urllib.request.urlopen(req) as res:
        # レスポンス本文を UTF-8 文字列へ戻す
        body = res.read().decode("utf-8")

        # 例:
        # {"ok":true}
        print("response:", body)

# 例外時:
# - URL が間違っている
# - APIキーが違う
# - ネットワーク障害
# - Cloudflare 側で 500 が発生
except Exception as e:
    print("ERROR:", str(e))

# ------------------------------------------------------------
# 実行終了ログ
# ------------------------------------------------------------
print("=== weekly_push end ===")
