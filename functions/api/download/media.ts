export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const mediaItemId = url.searchParams.get("mediaItemId");
  if (!sid || !mediaItemId) return new Response("Bad Request", { status: 400 });

  const raw = await env.KV.get(`PICK_QUEUE:${sid}`);
  const items = raw ? JSON.parse(raw) : [];
  const item = items.find((x: any) => String(x.mediaItemId) === String(mediaItemId));
  if (!item?.baseUrl) return new Response("Not Found", { status: 404 });

  // baseUrl は60分で切れる前提なので、Pi側は早めに取りに行く :contentReference[oaicite:7]{index=7}
  const targetUrl = String(item.baseUrl) + "=d"; // ダウンロード指定（必要に応じて調整）
  const upstream = await fetch(targetUrl, { redirect: "follow" });

  // upstream が 401/403 なら「選び直し」系の扱いにする（後でD-3へ） :contentReference[oaicite:8]{index=8}
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
  }

  // ストリーム転送（保存しない）
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: 200, headers });
};