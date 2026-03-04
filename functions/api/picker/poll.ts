export const onRequestGet = async ({ request, env }) => {
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey !== env.PULL_API_KEY) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  if (!sid) return new Response("Bad Request", { status: 400 });

  const key = `PICK_QUEUE:${sid}`;
  const raw = await env.KV.get(key);
  const items = raw ? JSON.parse(raw) : [];

  return new Response(JSON.stringify({ ok: true, sid, items }), {
    headers: { "content-type": "application/json" },
  });
};