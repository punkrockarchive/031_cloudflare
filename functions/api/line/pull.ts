// functions/api/line/pull.ts
type Env = {
  KV: KVNamespace;
  PULL_API_KEY: string; // 共有鍵（推奨）
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const req = context.request;
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!context.env.PULL_API_KEY || apiKey !== context.env.PULL_API_KEY) {
    return new Response("unauthorized", { status: 401 });
  }

  // line:queue:user:* を最大 N 件取り出す（KVは prefix list が可能）
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  const list = await context.env.KV.list({ prefix: "line:queue:user:" });
  const keys = list.keys.slice(0, limit);

  const items: Array<{ key: string; userId: string; receivedAt: number }> = [];

  for (const k of keys) {
    const v = await context.env.KV.get(k.name);
    if (!v) continue;
    try {
      const parsed = JSON.parse(v);
      items.push({ key: k.name, userId: parsed.userId, receivedAt: parsed.receivedAt });
    } catch {}
  }

  return Response.json({ count: items.length, items });
};