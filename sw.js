// Offline support: keeps a copy of the app and the Cantos on the phone.
// On every release: bump the number here AND the ?v= on style.css and app.js in index.html.
const VERSION = 'vorago-2';
const SHELL = [
  './', 'index.html', 'style.css?v=2', 'app.js?v=2', 'manifest.webmanifest', 'assets/splash.jpg',
  'assets/fonts/bodoni-moda-normal.woff2', 'assets/fonts/bodoni-moda-italic.woff2',
  'assets/fonts/crimson-pro-normal.woff2', 'assets/fonts/crimson-pro-italic.woff2',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's short-term copy so a new version really gets the new files
  const requests = SHELL.map((u) => new Request(u, { cache: 'reload' }));
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Only clear Vorago's own old copies: Retia and other apps on letstryitmkn.github.io share this storage
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vorago-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files; the GitHub API and the AI/search links are left alone
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes('/packs/') ? networkFirst(req) : cacheFirstThenUpdate(req));
});

// Cantos: the newest text when online, the saved copy when offline or the signal is too slow
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const saved = await cache.match(req, { ignoreSearch: true });
    if (saved) return saved;
    throw e;
  }
}

// App files: open instantly from the saved copy, refresh it in the background
async function cacheFirstThenUpdate(req) {
  const cache = await caches.open(VERSION);
  const saved = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => saved);
  return saved || fresh;
}
