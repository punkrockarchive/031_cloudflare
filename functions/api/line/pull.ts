type Env = {
  KV: KVNamespace;
  PULL_API_KEY: string;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const req = context.request;
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!context.env.PULL_API_KEY || apiKey !== context.env.PULL_API_KEY) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const ack = url.searchParams.get("ack") === "1";

  const list = await context.env.KV.list({ prefix: "line:queue:user:" });
  const keys = list.keys.slice(0, limit);

  const items: Array<{ key: string; userId: string; receivedAt: number }> = [];

  for (const k of keys) {
    const v = await context.env.KV.get(k.name);
    if (!v) continue;
    try {
      const parsed = JSON.parse(v);
      items.push({ key: k.name, userId: parsed.userId, receivedAt: parsed.receivedAt });
    } catch {
      // 壊れたデータは無視
    }
  }

  // 取得後に削除（ack=1 のときだけ）
  if (ack) {
    await Promise.all(items.map((it) => context.env.KV.delete(it.key)));
  }

  return Response.json({
    count: items.length,
    ack,
    items,
    next_hint: ack
      ? "deleted returned keys"
      : "add &ack=1 to delete returned keys after successful processing on Pi",
  });
};