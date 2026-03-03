export const onRequestGet: PagesFunction<{
  GP_SESSIONS: KVNamespace;
  SIGNED_URL_SECRET_A: string;
}> = async (context) => {
  const { env, params } = context;

  const token = String(params.token || "");
  const sep = token.lastIndexOf("~");
  if (sep <= 0) return new Response("Not Found", { status: 404 });

  const payloadB64 = token.slice(0, sep);
  const sigB64 = token.slice(sep + 1);

  // 署名検証
  const expected = await hmacBase64Url(payloadB64, env.SIGNED_URL_SECRET_A);
  if (!timingSafeEqual(sigB64, expected)) return new Response("Not Found", { status: 404 });

  // payload decode
  let payload: any;
  try {
    const json = base64urlDecodeToString(payloadB64);
    payload = JSON.parse(json);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (payload?.v !== 2 || typeof payload?.sid !== "string" || typeof payload?.exp !== "number") {
    return new Response("Bad Request", { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return html("リンクの有効期限が切れています。LINEから最新リンクを開いてください。");

  // KV lookup
  const kv = (await env.GP_SESSIONS.get(payload.sid, "json")) as any;
  if (!kv?.pickerUri) return html("リンクが無効です。LINEから最新リンクを開いてください。");
  if (typeof kv.exp === "number" && kv.exp < now) return html("リンクの有効期限が切れています。LINEから最新リンクを開いてください。");

  // redirect
  return Response.redirect(kv.pickerUri, 302);
};

function html(message: string) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>フォトフレーム</title><body style="font-family:sans-serif;line-height:1.6;padding:24px">
  <h1>フォトフレーム</h1><p>${escapeHtml(message)}</p></body>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}

function base64urlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmacBase64Url(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}