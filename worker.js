/**
 * Cloudflare Worker 反向代理 + Web 终端一体化脚本
 * 绑定域名: cs.124568.xyz / order.124568.xyz
 */

const BINANCE_HTTP_POOLS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi.binance.vision"
];
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

    // 3. 处理 HTTP 接口 (/fapi/*, /api/*) - 极速国内直连反代与边缘缓存
    if (url.pathname.startsWith("/fapi") || url.pathname.startsWith("/api")) {
      const isKlines = url.pathname.includes("/klines");
      const baseHosts = env.UPSTREAM_API ? [env.UPSTREAM_API] : BINANCE_HTTP_POOLS;

      let lastError = null;
      for (const baseHost of baseHosts) {
        const targetHttpUrl = baseHost + url.pathname + url.search;
        const newHeaders = new Headers(request.headers);
        newHeaders.set("Host", new URL(baseHost).host);
        newHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

        try {
          const fetchOptions = {
            method: request.method,
            headers: newHeaders,
            body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined,
            redirect: "follow",
          };

          // 针对历史 K 线请求启用 Cloudflare 边缘缓存，大幅降低后续请求延迟至毫秒级
          if (isKlines && request.method === "GET") {
            fetchOptions.cf = { cacheTtl: 300, cacheEverything: true };
          }

          const response = await fetch(targetHttpUrl, fetchOptions);

          if (response.ok || response.status < 500) {
            const respHeaders = new Headers(response.headers);
            Object.keys(corsHeaders).forEach((k) => respHeaders.set(k, corsHeaders[k]));
            respHeaders.delete("content-security-policy");
            if (isKlines) {
              respHeaders.set("Cache-Control", "public, max-age=300");
            }

            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: respHeaders,
            });
          }
        } catch (err) {
          lastError = err;
        }
      }

      return new Response(JSON.stringify({ code: -1, msg: "Proxy Error: " + (lastError ? lastError.message : "Upstream failed") }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 4. 处理静态 JS 资源请求（如本地化图表库）
    if (url.pathname.endsWith(".js")) {
      const rawJsUrl = `https://raw.githubusercontent.com/luoflyin-lang/A/main${url.pathname}`;
      try {
        const jsResp = await fetch(rawJsUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });
        if (jsResp.ok) {
          return new Response(jsResp.body, {
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Cache-Control": "public, max-age=86400",
              ...corsHeaders,
            },
          });
        }
      } catch (e) {}
    }

    // 5. 访问主页或任何非 API 路径：根据域名/路径分发 cs.html 或 order.html（自动从 GitHub 保持最新）
    try {
      const isCs = url.hostname.startsWith("cs.") || url.pathname.startsWith("/cs");
      const targetFile = isCs ? "cs.html" : "order.html";
      const rawGithubUrl = `https://raw.githubusercontent.com/luoflyin-lang/A/main/${targetFile}`;
      const ghResp = await fetch(rawGithubUrl, { cf: { cacheTtl: 60, cacheEverything: true } });
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

    return new Response("Terminal is loading...", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders },
    });
  },
};
