/* Service worker for Kosher Near Melcombe Place.
 *
 * Vendored: Leaflet 1.9.4, leaflet.markercluster 1.5.3.
 * BUMP SHELL ON EVERY DEPLOY — it is what replaces the cached app.
 */
var SHELL = "knf-shell-v3";
var TILES = "knf-tiles-v1";          // never bumped; self-trimming

var TILE_HOSTS  = ["tiles.stadiamaps.com", "basemaps.cartocdn.com"];
var TILE_MAX    = 400;                       // ~15 MB of @2x PNGs
var TILE_TTL_MS = 6 * 24 * 60 * 60 * 1000;   // 6 days, under Stadia's 7-day cap
var NAV_TIMEOUT = 3000;

var PRECACHE = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data.js",
  "./manifest.json",
  "./vendor/leaflet.js",
  "./vendor/leaflet.css",
  "./vendor/leaflet.markercluster.js",
  "./vendor/MarkerCluster.css",
  "./vendor/MarkerCluster.Default.css",
  "./vendor/images/layers.png",
  "./vendor/images/layers-2x.png",
  "./vendor/images/marker-shadow.png",
  "./fonts/archivo-var.woff2",
  "./fonts/source-sans-3-var.woff2",
  "./fonts/ibm-plex-mono-400.woff2",
  "./fonts/ibm-plex-mono-500.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n !== SHELL && n !== TILES) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isTile(url) { return TILE_HOSTS.indexOf(url.hostname) !== -1; }

/* 1x1 transparent PNG, served in place of a provider's error tile. */
var BLANK_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
function blankTile() {
  var bin = atob(BLANK_PNG), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } });
}

/* Trim lazily. cache.keys() on every put is O(n) per tile and stutters panning. */
var putsSinceTrim = 0;
function trimSoon(cache) {
  if (++putsSinceTrim < 25) return;
  putsSinceTrim = 0;
  cache.keys().then(function (keys) {
    var over = keys.length - TILE_MAX;
    for (var i = 0; i < over; i++) cache.delete(keys[i]);   // insertion order ≈ oldest first
  });
}

function handleTile(request) {
  return caches.open(TILES).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) {
        var at = Number(hit.headers.get("sw-cached-at") || 0);
        if (Date.now() - at < TILE_TTL_MS) return hit;
        cache.delete(request);
      }
      // Pass the ORIGINAL request through: rebuilding it drops the referrer and
      // Stadia's domain auth then 401s every tile.
      return fetch(request).then(function (res) {
        // An unauthorised tile server answers 401 with a valid PNG that reads
        // "401 Invalid Authentication". Left alone it renders as a grid of error
        // tiles, so swap it for a blank one and let the page explain instead.
        if (res.type !== "opaque" && res.status !== 200) return blankTile();
        // crossOrigin:'anonymous' on the layer means these are CORS, not opaque,
        // so status is readable and we never cache a 401 as if it were a tile.
        if (res.type !== "opaque" && res.status === 200) {
          res.clone().blob().then(function (body) {
            var h = new Headers(res.headers);
            h.set("sw-cached-at", String(Date.now()));
            cache.put(request, new Response(body, { status: 200, headers: h }));
            trimSoon(cache);
          });
        }
        return res;
      }).catch(function () {
        return hit || Response.error();
      });
    });
  });
}

/* Network-first with a timeout, falling back to the cached shell. This is what
   stops a stale shell surviving a redeploy — cache-first navigation is the trap. */
function handleNavigation(request) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      caches.match("./index.html").then(function (c) { resolve(c || fetch(request)); });
    }, NAV_TIMEOUT);

    fetch(request).then(function (res) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      caches.open(SHELL).then(function (c) { c.put("./index.html", res.clone()); });
      resolve(res);
    }).catch(function () {
      if (settled) return;
      settled = true; clearTimeout(timer);
      caches.match("./index.html").then(function (c) {
        resolve(c || new Response("Offline and nothing cached yet.", {
          status: 503, headers: { "Content-Type": "text/plain" }
        }));
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (req.mode === "navigate") { e.respondWith(handleNavigation(req)); return; }
  if (isTile(url))             { e.respondWith(handleTile(req)); return; }

  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.status === 200 && res.type === "basic") {
            var copy = res.clone();
            caches.open(SHELL).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }
  // Everything else (authority directory links, map providers' other hosts) — straight to network.
});
