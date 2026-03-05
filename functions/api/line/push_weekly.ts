/**
 * LINEグループへ「今週の投稿リンク」を送信するAPI
 *
 * エンドポイント
 *   POST /api/line/push_weekly
 *
 * リクエスト例
 * curl -X POST https://<your-domain>/api/line/push_weekly \
 *   -H "content-type: application/json" \
 *   -H "x-api-key: <PULL_API_KEY>" \
 *   -d '{"url":"https://example.com/u?t=test123","text":"今週分です！"}'
 *
 * 必須ENV
 *   LINE_CHANNEL_ACCESS_TOKEN  LINE Messaging API トークン
 *   LINE_TARGET_GROUP_ID       送信先グループID
 *   PULL_API_KEY               API呼び出し保護用キー
 *
 * 注意
 *   LINE_CHANNEL_SECRET はこのAPIでは使用しません
 */

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {

    /**
     * ------------------------------------------------------
     * 1. APIキー認証
     * ------------------------------------------------------
     * 外部から自由にLINE送信されないよう
     * x-api-key ヘッダで簡易認証する
     */
    const apiKey = request.headers.get("x-api-key") || "";

    if (apiKey !== env.PULL_API_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    /**
     * ------------------------------------------------------
     * 2. 環境変数の取得
     * ------------------------------------------------------
     * trim() を必ず入れる
     * → Cloudflare UI貼り付け時の改行混入対策
     */
    const accessToken = String(env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
    const groupId = String(env.LINE_TARGET_GROUP_ID || "").trim();

    /**
     * ENVが不足している場合
     */
    if (!accessToken || !groupId) {
      return new Response(
        JSON.stringify({
          error: "Missing LINE env vars",
          missing: {
            LINE_CHANNEL_ACCESS_TOKEN: !accessToken,
            LINE_TARGET_GROUP_ID: !groupId,
          },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    /**
     * ------------------------------------------------------
     * 3. リクエストBody取得
     * ------------------------------------------------------
     */
    const body = await request.json();

    const url = body.url;
    const text = body.text || "今週分です！";

    if (!url) {
      return new Response("url is required", { status: 400 });
    }

    /**
     * LINEへ送るメッセージ
     */
    const messageText = `${text}\n${url}`;

    /**
     * ------------------------------------------------------
     * 4. LINE Messaging APIへpush送信
     * ------------------------------------------------------
     */
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [
          {
            type: "text",
            text: messageText,
          },
        ],
      }),
    });

    /**
     * ------------------------------------------------------
     * 5. LINEエラー処理
     * ------------------------------------------------------
     */
    if (!resp.ok) {
      const errText = await resp.text();

      console.error("LINE push failed:", resp.status, errText);

      return new Response(
        JSON.stringify({
          error: "LINE push failed",
          status: resp.status,
          detail: errText,
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    /**
     * ------------------------------------------------------
     * 6. 成功レスポンス
     * ------------------------------------------------------
     */
    return new Response(
      JSON.stringify({
        ok: true,
      }),
      {
        headers: { "content-type": "application/json" },
      }
    );

  } catch (err) {

    /**
     * 予期しない例外
     */
    console.error("push_weekly error:", err);

    return new Response(
      JSON.stringify({
        error: "internal error",
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
};