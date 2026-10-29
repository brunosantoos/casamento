/* Service worker do Nosso Casamento: instalação do app, cache dos arquivos estáticos e página offline.
 * Nunca guarda dados (tRPC/API/arquivos privados): tudo vem sempre do servidor, com permissão checada.
 * O index.html também não é guardado, para um deploy novo valer na hora. */
const STATIC_CACHE = "static-v2";

const OFFLINE_HTML = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nosso Casamento</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f7faf8;color:#16211c">
<div style="text-align:center;padding:24px"><div style="font-size:40px">💍</div><h1 style="font-size:20px;margin:8px 0">Sem conexão</h1>
<p style="color:#5f6b65;margin:0 0 16px">Assim que a internet voltar, o planejamento abre normalmente.</p>
<button onclick="location.reload()" style="background:#0f9d6e;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:600;cursor:pointer">Tentar de novo</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  ),
);

// /assets/ tem hash no nome (imutável); /icons/ e fontes mudam raramente
const isStatic = (url) => url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || /\.(woff2?|svg)$/.test(url.pathname)) && !url.pathname.startsWith("/api/");

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/trpc") || url.pathname.startsWith("/api") || url.pathname.startsWith("/webhooks")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
    return;
  }
  if (isStatic(url)) event.respondWith(cacheFirst(req));
});

// ───── Notificações push ─────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nosso Casamento", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Nosso Casamento", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      lang: "pt-BR",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        if ("navigate" in same) return same.navigate(target).catch(() => same.postMessage({ type: "navigate", url: target }));
        return;
      }
      return self.clients.openWindow(target);
    })(),
  );
});
