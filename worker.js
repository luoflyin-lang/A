/**
 * Cloudflare Worker 反向代理 + Web 终端一体化脚本
 * 绑定域名: order.124568.xyz
 * 
 * 功能:
 * 1. 访问 https://order.124568.xyz/ 直接加载最新交易终端
 * 2. 访问 https://order.124568.xyz/fapi/* 自动代理到 https://fapi.binance.com/fapi/* (带 CORS)
 * 3. 访问 wss://order.124568.xyz/ws/* 自动代理到 wss://fstream.binance.com/ws/* (WebSocket 长连接)
 */

const BINANCE_HTTP = "https://fapi.binance.com";
const BINANCE_WS = "wss://fstream.binance.com";

// CORS 跨域响应头
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

    // 2. 处理 WebSocket 请求 (如 /ws/ 或带有 Upgrade 头的请求)
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      let targetWsUrl;
      if (url.pathname.startsWith("/ws")) {
        targetWsUrl = BINANCE_WS + url.pathname + url.search;
      } else {
        targetWsUrl = BINANCE_WS + "/ws" + url.pathname + url.search;
      }

      // Cloudflare 原生 WebSocket 转发
      return fetch(targetWsUrl, {
        headers: request.headers,
      });
    }

    // 3. 处理 HTTP API 请求 (/fapi/*)
    if (url.pathname.startsWith("/fapi") || url.pathname.startsWith("/api")) {
      const targetHttpUrl = BINANCE_HTTP + url.pathname + url.search;
      
      const newHeaders = new Headers(request.headers);
      newHeaders.set("Host", "fapi.binance.com");
      newHeaders.delete("cf-connecting-ip");
      newHeaders.delete("x-forwarded-for");

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

    // 4. 根路径或其它路径：从 GitHub 实时获取最新的 order.html（或返回备用）
    if (url.pathname === "/" || url.pathname === "/order.html" || url.pathname === "/index.html") {
      try {
        // 从 GitHub 仓库获取最新代码，无需每次重新部署 Worker 即可自动热更新！
        const rawGithubUrl = "https://raw.githubusercontent.com/luoflyin-lang/A/main/order.html";
        const ghResp = await fetch(rawGithubUrl, { cf: { cacheTtl: 60 } });
        if (ghResp.ok) {
          const html = await ghResp.text();
          return new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, max-age=60",
              ...corsHeaders,
            },
          });
        }
      } catch (e) {}

      return new Response("Order Terminal Proxy is running. Please access via GitHub or check URL.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders },
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
