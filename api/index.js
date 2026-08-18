export const config = {
  runtime: 'edge',
};

const BINANCE_HTTP_POOLS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi.binance.vision"
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default async function handler(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const isKlines = url.pathname.includes("/klines");
  let lastError = null;

  for (const baseHost of BINANCE_HTTP_POOLS) {
    const targetUrl = baseHost + url.pathname + url.search;
    const reqHeaders = new Headers();
    reqHeaders.set("Host", new URL(baseHost).host);
    reqHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    reqHeaders.set("Accept", "application/json, text/plain, */*");
    if (request.headers.get("X-MBX-APIKEY")) {
      reqHeaders.set("X-MBX-APIKEY", request.headers.get("X-MBX-APIKEY"));
    }
    if (request.headers.get("Content-Type")) {
      reqHeaders.set("Content-Type", request.headers.get("Content-Type"));
    }

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: reqHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined,
      });

      if (response.ok || response.status < 500) {
        const respHeaders = new Headers(response.headers);
        Object.keys(corsHeaders).forEach((k) => respHeaders.set(k, corsHeaders[k]));
        respHeaders.delete("content-security-policy");
        if (isKlines && request.method === "GET") {
          respHeaders.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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

  return new Response(JSON.stringify({ code: -1, msg: "Vercel Proxy Error: " + (lastError ? lastError.message : "Upstream failed") }), {
    status: 502,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

