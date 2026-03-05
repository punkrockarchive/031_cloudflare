// functions/api/line/push_weekly.ts（貼り付け用：初版最短）
// - 認証：x-api-key === env.PULL_API_KEY
// - body: { url?: string, text?: string }  ※url省略時は A-1 の発行APIを叩く運用に後で拡張
// - 送信：LINE Messaging API push

export const onRequestPost = async ({ request, env }) => {
  // 1) Admin auth
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) return new Response("Unauthorized", { status: 401 });

  // 2) Parse body
  const body = await request.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  const extra = String(body.text || "").trim();

  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_TARGET_GROUP_ID) {
    return new Response("Missing LINE env vars", { status: 500 });
  }
  if (!url) return new Response("Bad Request: url required", { status: 400 });

  const messageText =
    (extra ? extra + "\n" : "") +
    "📷 今週の写真を選んでください（タップで開きます）\n" +
    url;

  // 3) Push
  const payload = {
    to: env.LINE_TARGET_GROUP_ID,
    messages: [{ type: "text", text: messageText }],
  };

  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return new Response(`LINE push failed: ${resp.status} ${t}`, { status: 502 });
  }

  // 4) (Optional) minimal log to KV (LINE_KV)
  // await env.KV.put(`LINE_PUSH_LOG:${Date.now()}`, JSON.stringify({ url }), { expirationTtl: 60*60*24*30 });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
};