export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Webhook: POST /api/line/webhook は必ず 200 ok を返す
    if (url.pathname === "/api/line/webhook" && request.method === "POST") {
      return new Response("ok", { status: 200 });
    }

    // それ以外はトップだけHelloWorldを返す（今の挙動を保つ）
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("HelloWorld", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};