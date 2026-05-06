const CACHE_NAME = "budget-pwa-v5"
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./vendor/supabase.min.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-1024.png",
  "./splash/launch-640x1136.png",
  "./splash/launch-750x1334.png",
  "./splash/launch-828x1792.png",
  "./splash/launch-1125x2436.png",
  "./splash/launch-1170x2532.png",
  "./splash/launch-1179x2556.png",
  "./splash/launch-1242x2208.png",
  "./splash/launch-1242x2688.png",
  "./splash/launch-1284x2778.png",
  "./splash/launch-1290x2796.png"
]

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", event => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== "GET" || url.origin !== self.location.origin) return

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached

      return fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match("./index.html"))
    })
  )
})
