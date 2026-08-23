export async function onRequestGet(context) {
  return new Response(JSON.stringify({ status: "active", binding_exists: !!(context.env.KLINE_REPLAY_KV || context.env.TRADE_KV) }), {
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.KLINE_REPLAY_KV || env.TRADE_KV;
  try {
    const { key, value } = await request.json();
    const allowedKeys = [
      "sim_trades_history", "sim_balance_r", "bn_theme",
      "bn_key", "bn_pref", "bn_pendbr", "bn_watch", "bn_proxy",
      "eth_session", "eth_mistakes", "eth_kline_numbers"
    ];
    if (allowedKeys.includes(key)) {
      if (!kv) {
        throw new Error("KV namespace is not bound");
      }
      if (value === null || value === undefined || value === "") {
        await kv.delete(key);
      } else {
        await kv.put(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Invalid key" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
