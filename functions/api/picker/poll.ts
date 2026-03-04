// functions/api/picker/poll.ts
// 目的：Pi がポーリングして、sid の取り込みキューを取得する。
// ルート：GET /api/picker/poll?sid=SID123
// 認証：x-api-key === env.PULL_API_KEY
// 初版方針：キューを “削除せず” 返す（Pi側で重複排除）。後で「返したら削除」へ変更可。

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  // 1) 認証
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2) sid を取得
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  if (!sid) {
    return new Response("Bad Request", { status: 400 });
  }

  // 3) KV からキューを読み出し
  const key = `PICK_QUEUE:${sid}`;
  const raw = await env.KV.get(key);
  const items = raw ? JSON.parse(raw) : [];

  // 4) 返す（削除はしない）
  return new Response(JSON.stringify({ ok: true, sid, items }), {
    headers: { "content-type": "application/json" },
  });
};