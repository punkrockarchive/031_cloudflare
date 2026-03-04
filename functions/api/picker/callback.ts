export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json().catch(() => null) as any;
  if (!body?.sid || !Array.isArray(body?.items)) {
    return new Response("Bad Request", { status: 400 });
  }

  const sid = String(body.sid);
  const items = body.items.map((x: any) => ({
    mediaItemId: String(x.mediaItemId ?? ""),
    baseUrl: String(x.baseUrl ?? ""),
    mimeType: String(x.mimeType ?? ""),
    filename: String(x.filename ?? ""),
    createdAt: x.createdAt ?? null,
  })).filter((x: any) => x.mediaItemId && x.baseUrl);

  // 既存キューに追記（初版は配列でOK）
  const key = `PICK_QUEUE:${sid}`;
  const prevRaw = await env.KV.get(key);
  const prev = prevRaw ? JSON.parse(prevRaw) : [];
  const merged = [...prev, ...items];

  await env.KV.put(key, JSON.stringify(merged), { expirationTtl: 60 * 60 * 24 * 7 }); // 7日保持（適当でOK）
  return new Response(JSON.stringify({ ok: true, count: items.length, total: merged.length }), {
    headers: { "content-type": "application/json" },
  });
};