// functions/api/line/webhook.ts
// Cloudflare Pages Functions (TypeScript)

type Env = {
  LINE_CHANNEL_SECRET: string;
  KV: KVNamespace;
};

type LineWebhookBody = {
  destination?: string;
  events: Array<{
    type: string;
    timestamp?: number;
    source?: {
      type: "user" | "group" | "room";
      userId?: string;
      groupId?: string;
      roomId?: string;
    };
    mode?: string;
    webhookEventId?: string;
    deliveryContext?: { isRedelivery?: boolean };
    // follow / message などは追加フィールドがあるが、ここでは保存目的なので any で受ける
    [k: string]: any;
  }>;
};

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa はブラウザ互換で Cloudflare で使える
  return btoa(binary);
}

async function verifyLineSignature(
  rawBody: string,
  channelSecret: string,
  headerSignature: string | null
): Promise<boolean> {
  if (!headerSignature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = base64FromArrayBuffer(mac);

  // LINEの仕様：HMAC-SHA256 → Base64 が X-Line-Signature と一致するか :contentReference[oaicite:3]{index=3}
  return expected === headerSignature;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const req = context.request;
  const rawBody = await req.text();

  const signature =
    req.headers.get("x-line-signature") ?? req.headers.get("X-Line-Signature");

  const secret = context.env.LINE_CHANNEL_SECRET;
  const ok = await verifyLineSignature(rawBody, secret, signature);

  if (!ok) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const now = Date.now();

  // 受信イベントを丸ごと保存（後で解析可能）
  const eventKey = `line:webhook:${now}:${crypto.randomUUID()}`;
  await context.env.KV.put(eventKey, rawBody, { expirationTtl: 60 * 60 * 24 * 7 }); // 7日

  // userId を抽出して別キーでも保存（follow/message どちらでも source.userId で取れることが多い） :contentReference[oaicite:4]{index=4}
  const userIds = new Set<string>();
  for (const ev of body.events ?? []) {
    const uid = ev?.source?.userId;
    if (uid) userIds.add(uid);
  }

  // “新規で見つけたuserId” だけを積むキュー（Piがpullする）
  for (const uid of userIds) {
    const qKey = `line:queue:user:${now}:${uid}`;
    await context.env.KV.put(
      qKey,
      JSON.stringify({ userId: uid, receivedAt: now }),
      { expirationTtl: 60 * 60 * 24 * 30 } // 30日
    );

    // 最新状態（重複吸収用）
    await context.env.KV.put(`line:user:last:${uid}`, JSON.stringify({ userId: uid, lastSeenAt: now }), {
      expirationTtl: 60 * 60 * 24 * 365,
    });
  }

  return new Response("ok", { status: 200 });
};