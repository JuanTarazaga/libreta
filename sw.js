// Service worker: guarda la app entera para que funcione sin conexión.
// Al cambiar cualquier fichero, sube VERSION para que el iPad baje la nueva.
const VERSION = "libreta-v2";
const ARCHIVOS = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/db.js", "js/model.js", "js/store.js", "js/ink.js", "js/render.js", "js/ui.js",
  "js/editor.js", "js/herramientas.js", "js/paneles.js", "js/library.js", "js/pdfio.js", "js/backup.js", "js/noteful.js",
  "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "vendor/pdf-lib.min.js", "vendor/fflate.js",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// primero la caché (instantáneo y sin red); si hay red, se refresca por detrás
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const guardado = await c.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request).then((r) => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return guardado || (await red) || new Response("Offline", { status: 503 });
  }));
});
