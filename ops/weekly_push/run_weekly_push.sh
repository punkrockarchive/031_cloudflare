#!/bin/bash
# ============================================================
# run_weekly_push.sh
#
# Raspberry Pi / Linux から週次送信スクリプト weekly_push.py を
# 起動するラッパーです。
#
# 役割:
# - カレントディレクトリをこの .sh 自身の場所へ移動する
# - Python スクリプトを実行する
#
# 想定利用:
# - 手動実行
# - cron からの定期実行
# ============================================================

# この .sh が置いてあるフォルダへ移動する
cd "$(dirname "$0")"

echo "weekly push start"

# 共通本体の Python スクリプトを実行する
python3 weekly_push.py

echo "weekly push end"
