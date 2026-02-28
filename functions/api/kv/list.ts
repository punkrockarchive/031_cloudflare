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
  const prefix = url.searchParams.get("prefix") ?? "line:";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  const list = await context.env.KV.list({ prefix, limit });
  return Response.json({
    prefix,
    count: list.keys.length,
    keys: list.keys.map((k) => k.name),
    cursor: list.cursor ?? null,
    list_complete: list.list_complete ?? true,
  });
};