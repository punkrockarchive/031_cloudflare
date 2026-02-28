export async function onRequestPost(context: any) {
  // まずは受信できることの確認（署名検証は次のステップで追加）
  return new Response("ok", { status: 200 });
}