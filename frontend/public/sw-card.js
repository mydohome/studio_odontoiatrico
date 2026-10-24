// Service worker della fidelity card: la carta si riapre anche senza rete, con l'ultimo stato visto.
// Rete per prima (i timbri devono essere aggiornati); se manca la rete si usa la copia salvata.
// Non tocca altro che la pagina della carta, le sue risorse e i suoi dati.

const CACHE = 'carta-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

const mine = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith('/f/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/loyalty/') ||
    url.pathname.startsWith('/api/public/cards/') ||
    url.pathname === '/api/logo' ||
    url.pathname === '/favicon.svg')

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (!mine(url)) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      try {
        const res = await fetch(req)
        // Solo risposte buone: una carta disattivata (404) non deve restare in cache.
        if (res.ok) cache.put(req, res.clone())
        else if (res.status === 404) await cache.delete(req)
        return res
      } catch (err) {
        const hit = await cache.match(req, { ignoreSearch: false })
        // La pagina della carta (navigazione) usa la stessa copia dell'indirizzo richiesto.
        if (hit) return hit
        throw err
      }
    })(),
  )
})
