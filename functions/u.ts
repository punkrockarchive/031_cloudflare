// functions/u.ts
// A-3: /u?t=... を受ける Cloudflare Pages Function
// 役割:
// 1. token の存在確認
// 2. token の形式確認
// 3. HMAC-SHA256 で署名検証
// 4. 有効期限確認
// 5. sid を取り出す
// 6. sid に対応する pickerUri を取得する
// 7. 最終的に 302 redirect を返す

// 検証後に後続処理で使う最小の型
// sid: どの投稿単位か
// exp: token の有効期限（Unix time 秒）
type ParsedToken = {
  sid: string;
  exp: number;
};

// base64url 文字列を UTF-8 テキストへ戻す関数
// token の payload 部は URL に載せるため base64url 化されている想定
function b64urlToText(input: string) {
  // URL 安全形式の - と _ を通常の base64 形式へ戻す
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");

  // base64 の長さを 4 の倍数に揃えるために = を補う
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);

  // atob で base64 をデコードし、JSON 文字列へ戻す
  return atob(base64 + pad);
}

// message を secret で HMAC-SHA256 署名し、base64url 文字列へ変換して返す関数
// A-1 の token 発行側も、A-3 の検証側も、同じ方式である必要がある
async function hmacSHA256Base64Url(message: string, secret: string) {
  // 文字列を byte 配列へ変換するためのエンコーダ
  const enc = new TextEncoder();

  // HMAC-SHA256 用の秘密鍵を生成する
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // 指定 message に対する署名を計算する
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);

  // btoa に渡すため、バイト列をバイナリ文字列へ詰め直す
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);

  // base64 を URL 安全形式へ変換して返す
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// token を分解・検証し、利用可能な sid / exp を返す関数
// token 形式は「base64url(payload).sig」を想定する
async function parseAndVerifyToken(token: string, secret: string): Promise<ParsedToken> {
  // 「payload.署名」の2要素に分解する
  const [payloadB64, sig] = token.split(".");

  // 形式が崩れている場合は不正 token として扱う
  if (!payloadB64 || !sig) {
    throw new Error("invalid-token-format");
  }

  // payload 部に対して期待される署名を再計算する
  // ここが一致しなければ token 改ざんとみなす
  const expected = await hmacSHA256Base64Url(payloadB64, secret);
  if (sig !== expected) {
    throw new Error("invalid-signature");
  }

  // payload を base64url から JSON 文字列へ戻す
  const payloadText = b64urlToText(payloadB64);
  const payload = JSON.parse(payloadText);

  // sid と exp がない token は業務上使えないため不正扱い
  if (!payload.sid || !payload.exp) {
    throw new Error("invalid-token-payload");
  }

  // 有効期限を過ぎていたら期限切れとする
  if (Date.now() / 1000 > payload.exp) {
    throw new Error("expired-token");
  }

  // この時点で初めて sid を信用して後続処理へ渡せる
  return {
    sid: payload.sid,
    exp: payload.exp,
  };
}

// sid から pickerUri を取得する関数
// 初版はコード内の固定マップを返すだけにし、後で KV / API に差し替えやすい形へ分離しておく
async function getPickerUriBySid(sid: string, env: any): Promise<string | null> {
  // 初版の固定マップ例
  const sidMap: Record<string, string> = {
    "2026-03-week1": "https://photos.google.com/share/AAAA",
    "2026-03-week2": "https://photos.google.com/share/BBBB"
  };

  // sid に対応する URL があれば返し、無ければ null を返す
  return sidMap[sid] || null;

  // 将来の KV 版イメージ
  // const key = `SID:${sid}`;
  // return await env.LINE_KV.get(key);
}

// GET /u の本体
export const onRequestGet = async ({ request, env }) => {
  try {
    // 現在のURLから query parameter を取得する
    const url = new URL(request.url);

    // LINE などから渡される token を t パラメータから読む
    const token = url.searchParams.get("t");

    // token が無い場合は 400
    if (!token) {
      return new Response("Bad Request: token required", { status: 400 });
    }

    // 署名検証用 secret が設定されていない場合はサーバ設定不備
    if (!env.LINK_SIGNING_SECRET) {
      return new Response("Internal Error: missing secret", { status: 500 });
    }

    // token を検証し、安全に sid / exp を取り出す
    const parsed = await parseAndVerifyToken(token, env.LINK_SIGNING_SECRET);
    const sid = parsed.sid;

    // sid から最終遷移先 pickerUri を取得する
    const pickerUri = await getPickerUriBySid(sid, env);

    // 該当 sid の遷移先が未登録なら 404
    if (!pickerUri) {
      return new Response("Not Found: sid not found", { status: 404 });
    }

    // 最小限の運用ログを残す
    // token 全文や secret は絶対に出さない
    console.log(JSON.stringify({
      route: "/u",
      result: "redirect",
      sid,
      at: new Date().toISOString()
    }));

    // 正常時は pickerUri へ 302 リダイレクトする
    return Response.redirect(pickerUri, 302);

  } catch (e) {
    // Error オブジェクトからエラー識別文字列を取得する
    const msg = String((e as Error)?.message || e);

    // token 形式不正 / payload 不正
    if (msg.includes("invalid-token-format") || msg.includes("invalid-token-payload")) {
      return new Response("Bad Request: invalid token", { status: 400 });
    }

    // 署名不一致
    if (msg.includes("invalid-signature")) {
      return new Response("Forbidden: invalid signature", { status: 403 });
    }

    // 期限切れ
    if (msg.includes("expired-token")) {
      return new Response("Gone: token expired", { status: 410 });
    }

    // 想定外エラー
    console.log(JSON.stringify({
      route: "/u",
      result: "internal-error",
      error: msg,
      at: new Date().toISOString()
    }));

    return new Response("Internal Server Error", { status: 500 });
  }
};