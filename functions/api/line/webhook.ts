export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/line/webhook" && request.method === "POST") {
      return new Response("ok", { status: 200 });
    }

    // それ以外は 404（HelloWorld は一旦捨ててもOK）
    return new Response("Not Found", { status: 404 });
  },
};