// functions/download.ts
// ------------------------------------------------------------
// A-5 Cloudflare：/download
// 役割：Cloudflare に保存せず、Google → Pi へそのまま中継DLする
//
// 期待するリクエスト:
//   GET /download?t=<signed-token>
//
// token の想定ペイロード:
//   sid : セッションID
//   mid : メディアID
//   exp : 期限（UNIX秒）
//   sig : HMAC署名
//
// この実装の考え方:
// - token を検証して正当なダウンロードだけを通す
// - sid から manifest を引く
// - manifest から mid に対応する Google downloadUrl を引く
// - Google のレスポンス body を arrayBuffer 化せず、そのまま返す
// - Cloudflare 側でファイル保存しない
// ------------------------------------------------------------

type Env = {
  // token 署名検証用の秘密鍵
  DOWNLOAD_HMAC_SECRET: string;

  // Google 側の取得に必要な Bearer token
  // 実運用では適切な発行・更新フローに差し替える
  GOOGLE_API_BEARER_TOKEN: string;

  // sid ごとの manifest を JSON 文字列で持つ簡易例
  // 初版では環境変数や固定値でもよいが、
  // 実運用では KV / D1 / Durable Objects 等へ移行しやすい設計にする
  DOWNLOAD_MANIFEST?: string;
};

type DownloadItem = {
  // A-4 で確定したメディアID
  mid: string;

  // Pi に保存するときのファイル名候補
  filename: string;

  // Content-Type の期待値（例: image/jpeg, video/mp4）
  mimeType?: string;

  // Google 側のダウンロードURL
  // 実運用では Photos API / Picker API の結果に合わせて差し替える
  downloadUrl: string;
};

type DownloadManifest = {
  sid: string;
  items: DownloadItem[];
};

// ------------------------------------------------------------
// Base64URL ユーティリティ
// token の payload / sig を扱うために使う
// ------------------------------------------------------------
function b64urlToText(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (input.length % 4)) % 4);

  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex");
  }

  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ------------------------------------------------------------
// 署名比較
// 文字列の単純比較でも動くが、構造を揃えるため専用関数化
// ------------------------------------------------------------
function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const aa = hexToBytes(a);
    const bb = hexToBytes(b);

    if (aa.length !== bb.length) return false;

    let diff = 0;
    for (let i = 0; i < aa.length; i++) {
      diff |= aa[i] ^ bb[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// token の中身
// 例：base64url(payloadJson).hexHmac
//
// payloadJson 例
// {
//   "sid":"2026-03-week1",
//   "mid":"media-001",
//   "exp":1772800000
// }
// ------------------------------------------------------------
type DownloadTokenPayload = {
  sid: string;
  mid: string;
  exp: number;
};

async function verifyAndParseDownloadToken(token: string, secret: string): Promise<DownloadTokenPayload> {
  // token は "payload.sig" の2要素を想定
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) {
    throw new Error("invalid token format");
  }

  // 署名対象は payloadPart そのもの
  const expectedSig = await hmacSha256Hex(secret, payloadPart);

  if (!timingSafeEqualHex(expectedSig, sigPart)) {
    throw new Error("invalid signature");
  }

  const payloadText = b64urlToText(payloadPart);
  const payload = JSON.parse(payloadText) as Partial<DownloadTokenPayload>;

  // 必須値チェック
  if (!payload.sid || !payload.mid || typeof payload.exp !== "number") {
    throw new Error("invalid payload");
  }

  // exp は UNIX秒で比較
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSec) {
    throw new Error("token expired");
  }

  return {
    sid: payload.sid,
    mid: payload.mid,
    exp: payload.exp,
  };
}

// ------------------------------------------------------------
// sid から manifest を取得する
// 初版は env.DOWNLOAD_MANIFEST を読む簡易版
//
// 実運用での差し替え候補:
// - KV: key = DOWNLOAD_MANIFEST:<sid>
// - D1: sid ごとの items テーブル
// - Durable Objects: セッションの一時状態
// ------------------------------------------------------------
async function getManifestBySid(sid: string, env: Env): Promise<DownloadManifest> {
  if (!env.DOWNLOAD_MANIFEST) {
    throw new Error("DOWNLOAD_MANIFEST is not set");
  }

  // 初版は env に JSON 配列または JSON オブジェクトを置く想定
  // 例1: { "2026-03-week1": { "sid":"2026-03-week1", "items":[...] } }
  // 例2: [ { "sid":"2026-03-week1", "items":[...] } ]
  const raw = JSON.parse(env.DOWNLOAD_MANIFEST) as Record<string, DownloadManifest> | DownloadManifest[];

  if (Array.isArray(raw)) {
    const found = raw.find((x) => x.sid === sid);
    if (!found) throw new Error("manifest not found");
    return found;
  }

  const found = raw[sid];
  if (!found) {
    throw new Error("manifest not found");
  }
  return found;
}

// ------------------------------------------------------------
// manifest の中から対象メディアを探す
// ------------------------------------------------------------
function findItemByMid(manifest: DownloadManifest, mid: string): DownloadItem {
  const item = manifest.items.find((x) => x.mid === mid);
  if (!item) {
    throw new Error("download item not found");
  }
  return item;
}

// ------------------------------------------------------------
// Content-Disposition の簡易生成
// Pi 側で保存名を扱いやすくする
// ------------------------------------------------------------
function buildContentDisposition(filename: string): string {
  // 非ASCIIを完全対応するなら RFC 5987 形式へ拡張可
  // 初版は最低限のエスケープのみ
  const safe = filename.replace(/"/g, "");
  return `attachment; filename="${safe}"`;
}

// ------------------------------------------------------------
// HTTP エラー応答の共通化
// ログを出しすぎず、原因はレスポンス文字列で追える程度にする
// ------------------------------------------------------------
function jsonError(message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error: message }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

// ------------------------------------------------------------
// メイン処理
// ------------------------------------------------------------
export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    // 1) token を取得
    const url = new URL(request.url);
    const token = url.searchParams.get("t") || "";

    if (!token) {
      return jsonError("missing token", 400);
    }

    // 2) token 署名検証 + sid / mid / exp を取り出す
    const parsed = await verifyAndParseDownloadToken(token, env.DOWNLOAD_HMAC_SECRET);

    // 3) sid から manifest を取得
    const manifest = await getManifestBySid(parsed.sid, env);

    // 4) manifest から対象メディアを取得
    const item = findItemByMid(manifest, parsed.mid);

    // 5) Google 側へ fetch
    //    重要：ここで arrayBuffer() / blob() へ変換しない
    //    body をそのまま返すことで「保存しない中継DL」を実現する
    const upstream = await fetch(item.downloadUrl, {
      method: "GET",
      headers: {
        // Google 側が Bearer token を要求する想定
        "authorization": `Bearer ${env.GOOGLE_API_BEARER_TOKEN}`,
      },
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      const reason = await upstream.text().catch(() => "");
      return jsonError(
        `google fetch failed: ${upstream.status} ${reason}`,
        502
      );
    }

    // 6) Pi に返すヘッダを組み立てる
    //    upstream の値をなるべく引き継ぎつつ、保存名などは明示する
    const headers = new Headers();
    headers.set("cache-control", "no-store");
    headers.set(
      "content-type",
      upstream.headers.get("content-type") || item.mimeType || "application/octet-stream"
    );

    // Content-Length は upstream にあれば引き継ぐ
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) {
      headers.set("content-length", contentLength);
    }

    // Pi 側で保存ファイル名を扱いやすいように Content-Disposition を付与
    headers.set("content-disposition", buildContentDisposition(item.filename));

    // 7) Google の body をそのまま返す
    //    ここが A-5 の本体
    return new Response(upstream.body, {
      status: 200,
      headers,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";

    // 想定されるエラーは 4xx として返す
    if (
      message === "invalid token format" ||
      message === "invalid signature" ||
      message === "invalid payload" ||
      message === "token expired" ||
      message === "manifest not found" ||
      message === "download item not found" ||
      message === "missing token"
    ) {
      return jsonError(message, 400);
    }

    // 環境変数不足や JSON 不正などは 500 扱い
    return jsonError(message, 500);
  }
};