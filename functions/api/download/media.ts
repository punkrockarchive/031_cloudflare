// functions/api/download/media.ts
// 目的：Google Photos の baseUrl から画像を取得し、Cloudflare では保存せず Pi へストリーム転送する。
// ルート：GET /api/download/media?sid=SID123&mediaItemId=m1
// 認証：x-api-key === env.PULL_API_KEY
// 動作：KV(PICK_QUEUE:{sid}) から mediaItemId の baseUrl を探し、baseUrl + "=d" を fetch → upstream.body を返す。

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  // 1) 認証
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2) クエリ取得
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const mediaItemId = url.searchParams.get("mediaItemId");

  if (!sid || !mediaItemId) {
    return new Response("Bad Request", { status: 400 });
  }

  // 3) KVからキューを取得し、対象アイテムを探す
  const raw = await env.KV.get(`PICK_QUEUE:${sid}`);
  const items = raw ? JSON.parse(raw) : [];
  const item = items.find((x: any) => String(x.mediaItemId) === String(mediaItemId));

  if (!item?.baseUrl) {
    return new Response("Not Found", { status: 404 });
  }

  // 4) baseUrl から “ダウンロード用” URL を作る
  // Google Photos の baseUrl は期限付き（約60分）なので、Piは早めに取りに行く運用。
  // "=d" は「ダウンロード」用途。必要に応じて w/h 指定へ変更可能。
  const targetUrl = String(item.baseUrl) + "=d";

  // 5) upstream から取得（保存はしない）
  const upstream = await fetch(targetUrl, { redirect: "follow" });

  // upstream が失敗した場合：初版は502で返す（後で 401/403 を「選び直し」導線へ）
  if (!upstream.ok) {
    return new Response(`Upstream error: ${upstream.status}`, { status: 502 });
  }

  // 6) upstream のヘッダを引き継いでストリーム転送
  // 重要：no-store（キャッシュしない）
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, { status: 200, headers });
};