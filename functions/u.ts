/**
 * /u?t=<payloadB64>~<sigB64>
 *
 * - Laravel が発行した署名付きトークンを検証（HMAC-SHA256）
 * - payload.sid をキーに Workers KV (GP_SESSIONS) から { pickerUri, exp } を取得
 * - pickerUri に 302 リダイレクトする
 *
 * デバッグ:
 *   ?dbg=1 を付けると KV 取得の可否や raw プレビュー等を JSON で返す（秘密は出さない）
 */

export const onRequestGet: PagesFunction<{
  // Pages の「設定 > バインディング」で
  // KV名前空間の変数名を GP_SESSIONS にしていること
  GP_SESSIONS: KVNamespace;

  // Pages の「設定 > 環境変数」で SIGNED_URL_SECRET_A を設定していること
  SIGNED_URL_SECRET_A: string;
}> = async (context) => {
  // デプロイ反映確認用（好きな文字列でOK。毎回変える）
  const BUILD = "u.ts-2026-03-03-0805";

  const { env, request } = context;

  // URL解析（クエリ取得用）
  const url = new URL(request.url);

  // dbg=1 のとき、KV取得状態をJSONで返す（原因切り分け用）
  const dbg = url.searchParams.get("dbg") === "1";

  // token: "<payloadB64>~<sigB64>"
  const token = url.searchParams.get("t") || "";

  // token 形式チェック
  const sep = token.lastIndexOf("~");
  if (sep <= 0) {
    // token が無い or 区切りがおかしい
    return new Response("Not Found", { status: 404 });
  }

  const payloadB64 = token.slice(0, sep);
  const sigB64 = token.slice(sep + 1);

  // 署名検証（payloadB64 を secret で HMAC したものが sigB64 と一致するか）
  const expected = await hmacBase64Url(payloadB64, env.SIGNED_URL_SECRET_A);
  if (!timingSafeEqual(sigB64, expected)) {
    // 署名不一致（情報漏えいを避けるため 404）
    return new Response("Not Found", { status: 404 });
  }

  // payload decode (base64url → JSON)
  let payload: any;
  try {
    payload = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // payload の最低限のバリデーション
  // v=2 / sid / exp が存在するか
  if (payload?.v !== 2 || typeof payload?.sid !== "string" || typeof payload?.exp !== "number") {
    return new Response("Bad Request", { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  // トークン自体の期限チェック
  if (payload.exp < now) {
    return html("リンクの有効期限が切れています。LINEから最新リンクを開いてください。");
  }

  /**
   * ここから KV 取得パート（重要）
   * - get(..., "json") は環境差分で挙動が読みづらいので text で確実に取る
   * - JSON 文字列を parse して pickerUri / exp を取り出す
   */
  // KVから取得（textで確実に読む）
  const raw = await env.GP_SESSIONS.get(payload.sid);

  // dbg=1 のときは KVの実体を確認（秘密は出さない）
  if (dbg) {
    return new Response(
      JSON.stringify(
        {
          sid: payload.sid,
          hasRaw: !!raw,
          rawPreview: raw ? raw.slice(0, 160) : null,
          now,
          payloadExp: payload.exp,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-dpf-build": BUILD,
        },
      }
    );
  }

  if (!raw) return html("リンクが無効です。LINEから最新リンクを開いてください。");

  // KVの値は「JSONオブジェクト」または「JSON文字列（＝二重JSON）」の可能性があるため吸収する
  const parsed = parseKvMaybeDoubleJson(raw);

  const pickerUri = parsed?.pickerUri;
  const exp = parsed?.exp;

  if (!pickerUri || typeof pickerUri !== "string") {
    return html("リンクが無効です。LINEから最新リンクを開いてください。");
  }
  if (typeof exp === "number" && exp < now) {
    return html("リンクの有効期限が切れています。LINEから最新リンクを開いてください。");
  }

  return Response.redirect(pickerUri, 302);
};

/** ユーザー向け簡易HTML（スマホでも読める） */
function html(message: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>フォトフレーム</title><body style="font-family:sans-serif;line-height:1.6;padding:24px">
<h1>フォトフレーム</h1><p>${escapeHtml(message)}</p></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

/** HTMLエスケープ（最低限） */
function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ] as string)
  );
}

/** base64url → 文字列（UTF-8） */
function base64urlDecodeToString(b64url: string): string {
  // base64url → base64
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);

  // atob → bytes → UTF-8
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * HMAC-SHA256(message, secret) を base64url で返す
 * - message は payloadB64（＝ base64url文字列そのもの）
 */
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

  // bytes → binary string → base64
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);

  // base64 → base64url
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * timing-safe 文字列比較（簡易版）
 * - 署名比較の微妙な差を漏らさないため
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * KVの値が以下どちらでも同じ形にするためのパーサ
 * 1) {"pickerUri":"...","exp":...}  ← 通常のJSON
 * 2) "{\"pickerUri\":\"...\",\"exp\":...}" ← JSON文字列（二重JSON）
 */
function parseKvMaybeDoubleJson(raw: string): any | null {
  try {
    const first = JSON.parse(raw);

    // 二重JSON：最初のparse結果が文字列なら、もう一回parseする
    if (typeof first === "string") {
      try {
        return JSON.parse(first);
      } catch {
        return null;
      }
    }

    // 通常JSON：オブジェクトのはず
    return first;
  } catch {
    return null;
  }
}