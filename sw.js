/* SayurBest Service Worker
   - Halaman (HTML): jaringan dulu, cadangan dari cache (selalu dapat versi terbaru jika online)
   - File statis (CSS/JS CDN, ikon): tampil dari cache lalu diperbarui di belakang layar
   - Gambar produk (ImageKit): cache dulu, maksimal 150 gambar
   - TIDAK menyentuh: Firestore, Meta Pixel, WhatsApp, dan halaman admin
   Ubah VERSION bila ingin memaksa semua pelanggan memuat ulang cache. */
const VERSION = 'v1';
const SHELL = `sayurbest-shell-${VERSION}`;
const STATIC = `sayurbest-static-${VERSION}`;
const IMAGES = `sayurbest-img-${VERSION}`;
const MAX_IMAGES = 150;
const PRECACHE = ['/', '/manifest.json'];
const STATIC_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'www.gstatic.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL).then(c => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, STATIC, IMAGES].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('admin')) return;            // admin selalu langsung ke jaringan

  if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
  if (url.origin === location.origin) return e.respondWith(staleWhileRevalidate(e, req, SHELL));
  if (url.hostname === 'ik.imagekit.io') return e.respondWith(imageCache(req));
  if (STATIC_HOSTS.includes(url.hostname)) return e.respondWith(staleWhileRevalidate(e, req, STATIC));
  // selain itu (Firestore, Pixel, WhatsApp, dll.) dibiarkan langsung ke jaringan
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);   // sinyal lemah: setelah 4 detik pakai cache
    const res = await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true }))
        || (await cache.match('/'))
        || new Response('<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2>Anda sedang offline</h2><p>Periksa koneksi internet lalu muat ulang halaman.</p></body>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(e, req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const update = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  e.waitUntil(update);
  return cached || (await update) || Response.error();
}

async function imageCache(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  let res;
  try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); }   // respons CORS agar hemat kuota penyimpanan
  catch (_) { try { res = await fetch(req); } catch (__) { return Response.error(); } }
  if (res.ok && res.type !== 'opaque') {
    cache.put(req.url, res.clone()).then(() => trimCache(cache));
  }
  return res;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_IMAGES) await Promise.all(keys.slice(0, keys.length - MAX_IMAGES).map(k => cache.delete(k)));
}
