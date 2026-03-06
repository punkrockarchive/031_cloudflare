@echo off
REM ============================================================
REM run_weekly_push.bat
REM
REM Windows から週次送信スクリプト weekly_push.py を起動する
REM ラッパーです。
REM
REM 役割:
REM - カレントディレクトリをこの .bat 自身の場所へ移動する
REM - Python スクリプトを実行する
REM - 実行結果をコンソールで確認しやすいように pause する
REM
REM 想定利用:
REM - 手動実行
REM - Windows タスクスケジューラからの定期実行
REM ============================================================

@echo off

REM この .bat が置いてあるフォルダへ移動する
REM /d を付けることでドライブが違っていても移動できる
cd /d %~dp0

echo weekly push start

REM 共通本体の Python スクリプトを実行する
python weekly_push.py

echo weekly push end

REM 手動実行時に画面がすぐ閉じないよう一時停止する
pause
