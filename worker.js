/**
 * Cloudflare Worker 反向代理 + Web 终端一体化脚本
 * 绑定域名: order.124568.xyz
 * 
 * 功能:
 * 1. 访问 https://order.124568.xyz/ 直接加载最新交易终端 (实时同步 GitHub)
 * 2. 支持 WebSocket 长连接代理
 * 3. 支持可配置的上游 API 网关转发
 */

const BINANCE_HTTP = "https://fapi.binance.com";
const BINANCE_WS = "wss://fstream.binance.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 处理 OPTIONS 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. 处理 WebSocket 长连接
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      let targetWsUrl = url.pathname.startsWith("/ws")
        ? BINANCE_WS + url.pathname + url.search
        : BINANCE_WS + "/ws" + url.pathname + url.search;

      return fetch(targetWsUrl, { headers: request.headers });
    }

    // 3. 处理 HTTP API 请求 (/fapi/*, /api/*)
    if (url.pathname.startsWith("/fapi") || url.pathname.startsWith("/api")) {
      const targetHttpUrl = (env.UPSTREAM_API || BINANCE_HTTP) + url.pathname + url.search;
      const newHeaders = new Headers(request.headers);
      newHeaders.set("Host", new URL(env.UPSTREAM_API || BINANCE_HTTP).host);
      newHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

      try {
        const response = await fetch(targetHttpUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined,
          redirect: "follow",
        });

        const respHeaders = new Headers(response.headers);
        Object.keys(corsHeaders).forEach((k) => respHeaders.set(k, corsHeaders[k]));
        respHeaders.delete("content-security-policy");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ code: -1, msg: "Proxy Error: " + err.message }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    // 4. 访问主页直接加载最新终端（自动从 GitHub 保持最新）
    if (url.pathname === "/" || url.pathname === "/order.html" || url.pathname === "/index.html") {
      try {
        const ghResp = await fetch("https://raw.githubusercontent.com/luoflyin-lang/A/main/order.html", { cf: { cacheTtl: 60 } });
        if (ghResp.ok) {
          const html = await ghResp.text();
          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60", ...corsHeaders },
          });
        }
      } catch (e) {}

      return new Response("Order Terminal Proxy Ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders },
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
