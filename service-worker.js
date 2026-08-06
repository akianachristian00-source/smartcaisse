// SmartCaisse — Service Worker minimal
// Permet l'installation en tant qu'application (PC, Android, iPhone)
// et un chargement plus rapide au retour sur le site.

const CACHE_NAME = 'smartcaisse-v1';
const FICHIERS_A_METTRE_EN_CACHE = ['./index.html', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FICHIERS_A_METTRE_EN_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Réseau en priorité (données toujours à jour), cache en secours si hors-ligne
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
