// functions/api/picker/callback.ts
// 目的：Google Photos Picker の選択結果（items）を受け取り、KV(LINE_KV) に取り込みキューとして保存する。
// ルート：POST /api/picker/callback
// 認証：x-api-key === env.PULL_API_KEY（初版最短。外部公開しない運用）
// 保存：KVキー PICK_QUEUE:{sid} に JSON配列で追記（TTL=7日）

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  // 1) 認証（Pi/管理者だけが叩く想定）
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2) JSON Body を読む
  // 期待：{ sid: "SID123", items: [{ mediaItemId, baseUrl, ... }] }
  const body = (await request.json().catch(() => null)) as any;
  if (!body?.sid || !Array.isArray(body?.items)) {
    return new Response("Bad Request", { status: 400 });
  }

  const sid = String(body.sid);

  // 3) items を最小スキーマへ正規化（空データは落とす）
  const items = body.items
    .map((x: any) => ({
      mediaItemId: String(x.mediaItemId ?? ""),
      baseUrl: String(x.baseUrl ?? ""),
      mimeType: String(x.mimeType ?? ""),
      filename: String(x.filename ?? ""),
      createdAt: x.createdAt ?? null,
    }))
    .filter((x: any) => x.mediaItemId && x.baseUrl);

  // 4) 既存キューを読み、追記して保存
  // 初版最短：配列でOK（後で “キューを1件ずつ” に分割しても良い）
  const key = `PICK_QUEUE:${sid}`;
  const prevRaw = await env.KV.get(key);
  const prev = prevRaw ? JSON.parse(prevRaw) : [];

  const merged = [...prev, ...items];

  // 5) KVへ保存（投稿期限が週末まで想定なので、とりあえず7日）
  await env.KV.put(key, JSON.stringify(merged), {
    expirationTtl: 60 * 60 * 24 * 7, // 7 days
  });

  // 6) 結果を返す
  return new Response(
    JSON.stringify({ ok: true, count: items.length, total: merged.length }),
    { headers: { "content-type": "application/json" } },
  );
};