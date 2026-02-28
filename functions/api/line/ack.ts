// functions/api/line/ack.ts
export async function onRequestPost(context: any) {
  const { request, env } = context;

  // 認証（pullと同じ x-api-key 方式に合わせる）
  const apiKey = request.headers.get("x-api-key") || "";
  if (!env.PULL_API_KEY || apiKey !== env.PULL_API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  // KV binding チェック
  if (!env.KV) {
    return new Response("KV binding missing", { status: 500 });
  }

  // body: { keys: string[] }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const keys: string[] = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length === 0) {
    return new Response(JSON.stringify({ deleted: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // 念のため prefix ガード（誤爆防止）
  const safeKeys = keys.filter((k) => typeof k === "string" && k.startsWith("line:queue:user:"));

  // 削除（まとめて）
  await Promise.allSettled(safeKeys.map((k) => env.KV.delete(k)));

  return new Response(JSON.stringify({ deleted: safeKeys.length }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}