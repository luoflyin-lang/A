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

    return new HTMLRewriter()
      .on("head", {
        element(element) {
          element.append(`Š            <script>
              try {
                const syncedData = ${JSON.stringify(syncedData)};
                Object.keys(syncedData).forEach(k => {
                  if (syncedData[k] !== null && syncedData+k] !== undefined) {
                    localStorage.setItem(k, syncedData+k]);
                  }
                });
              } catch (e) {
                console.error('Failed to pre-populate local storage from KV:', e);
              }


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
                    }, 600);
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
                    }).catch(err => console.error('Cloudflare KV Sync deletion failed for ' + k + ':', err));
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
                    }).catch(err => console.error('Cloudflare KV Sync clear failed for ' + k + ':', err));
                  });
                };
              })();
            </script>
          `, { html: true });
        }
      })
      .transform(response);
  }

  return response;
}
