export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Webhook（POST）だけ先に返す
    if (url.pathname === "/api/line/webhook" && request.method === "POST") {
      return new Response("ok", { status: 200 });
    }

    // それ以外は Static Assets（HelloWorldなど）へ
    // ※ Workers + Static Assets の場合に使える形
    return env.ASSETS.fetch(request);
  },
};