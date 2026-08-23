export async function onRequest(context) {
  const { request, env, next } = context;
  const kv = env.KLINE_REPLAY_KV || env.TRADE_KV;

  const newRequest = new Request(request);
  newRequest.headers.delete("accept-encoding");

  const response = await next(newRequest);
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/html")) {
    let syncedData = {};
    const syncKeys = [
      "sim_trades_history", "sim_balance_r", "bn_theme",
      "bn_key", "bn_pref", "bn_pendbr", "bn_watch", "bn_proxy",
      "eth_session", "eth_mistakes", "eth_kline_numbers"
    ];

    try {
      if (kv) {
        for (const k of syncKeys) {
          const val = await kv.get(k);
          if (val !== null && val !== undefined) {
            syncedData[k] = val;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch from KV in middleware:", e);
    }

    const newHeaders = new Headers(response.headers);
    newHeaders.delete("content-length");
    newHeaders.delete("etag");
    newHeaders.set("cache-control", "no-store, no-cache, must-revalidate");

    const transformedResponse = new HTMLRewriter()
      .on("head", {
        element(element) {
          element.append(`
            <script>
              try {
                const syncedData = ${JSON.stringify(syncedData)};
                // 1. 若云端有数据，注入戱 localStorage
                Object.keys(syncedData).forEach(k => {
                  if (syncedData[k] !== null && syncedData[k] !== undefined && syncedData[k] !== "") {
                    localStorage.setItem(k, syncedData[k]);
                  }
                });

                // 2. 若本地存在诅绂旧��+x~但亡端为空，自动将拧洙罞上报同步至亡端
                const localTrades = localStorage.getItem('sim_trades_history');
                const localBal = localStorage.getItem('sim_balance_r');
                if (localTrades && localTrades !== '[]' && (!syncedData['wsim_trades_history'] || syncedData['sim_trades_history'] === '[]')) {
                  fetch('/api/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'sim_trades_history', value: localTrades })
                  });
                  if (localBal) {
                    fetch('/api/sync', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: 'sim_balance_r', value: localBal })
                    });
                  }
                }
              } catch (e) {
                console.error('Failed to pre-populate local storage from KV', e);
              }

              // 3. 劫持厞生方法，任何变动自动私级启动同步臱 Cloudflare KV
              (function() {
                const originalSetItem = localStorage.setItem;
                const originalRemoveItem = localStorage.removeItem;
                const originalClear = localStorage.clear;
                let syncTimeout = null;
                const pendingSync = {};
                const trackedKeys = ${JSON.stringify(syncKeys)};

                localStorage.setItem = function(key, value) {
                  originalSetItem.call(localStorage, key, value);
                  if (trackedKeys.includes(key)) {
                    pendingSync[key] = value;
                    if (syncTimeout) clearTimeout(syncTimeout);
                    syncTimeout = setTimeout(() => {
                      const keys = Object.keys(pendingSync);
                      keys.forEach(k => {
                        const val = pendingSync[k];
                        delete pendingSync[k];
                        fetch('/api/sync', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ key: k, value: val })
                        }).catch(err => console.error('Cloudflare KV Sync failed for ' + k + ':', err));
                      });
                    }, 400);
                  }
                };

                localStorage.removeItem = function(key) {
                  originalRemoveItem.call(localStorage, key);
                  if (trackedKeys.includes(key)) {
                    if (pendingSync[key] !== undefined) {
                      delete pendingSync[key];
                    }
                    fetch('/api/sync', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: key, value: null })
                    }).catch(err => console.error('Cloudflare KV Sync deletion failed for ' + key + ':', err));
                  }
                };

                localStorage.clear = function() {
                  originalClear.call(localStorage);
                  trackedKeys.forEach(key => {
                    if (pendingSync[key] !== undefined) {
                      delete pendingSync[key];
                    }
                    fetch('/api/sync', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: key, value: null })
                    }).catch(err => console.error('Cloudflare KV Sync clear failed for ' + key + ':', err));
                  });
                };
              })();
            </script>
          `, { html: true });
        }
      })
      .transform(new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      }));

    return transformedResponse;
  }

  return response;
}
