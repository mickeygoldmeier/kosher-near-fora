/* Kosher Near Melcombe Place
 * List + map over a fixed set of certified kosher venues, sorted by live distance.
 * The list is the product; the map is an enhancement and the app stays usable without it.
 */
(function () {
"use strict";

var FORA = window.KNF.FORA, SOURCES = window.KNF.SOURCES, V = window.KNF.VENUES;

/* ---------------------------------------------------------------- tiles ---
 * Provider is isolated here so an outage or policy change is a one-line fix.
 * Stadia uses domain-based auth: the github.io host is allowlisted in their
 * dashboard, so no API key lives in this repo. localhost is exempt.
 */
var TILE_PROVIDERS = {
  stadia: {
    light: "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png",
    dark:  "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://stadiamaps.com/attribution/" target="_blank" rel="noopener">Stadia Maps</a> ' +
      '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  },
  // Fallback. Needs a free key appended as ?key=... ; see README.
  carto: {
    light: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    dark:  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    maxZoom: 20,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> ' +
      '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  }
};
var PROVIDER = TILE_PROVIDERS.stadia;

/* Routing runs on the same account as the tiles — Stadia hosts Valhalla, so the
 * domain allowlist covers both and no key goes in this repo.
 * Routes from Fora are precomputed into data.js (v.rt), so the common case needs
 * no network at all; this endpoint is only used once you share your location. */
var ROUTE_URL = "https://api.stadiamaps.com/route/v1";

/* --------------------------------------------------------------- state --- */
var origin = { lat: FORA.lat, lng: FORA.lng };
var filter = "all", query = "", view = "list";
var lastFix = null;

/* -------------------------------------------------------------- helpers --- */
/* Distances are WALKING distances, not straight lines.
 *
 * Every venue carries wd/wt: metres and seconds on the real pedestrian network
 * from Fora, precomputed with Valhalla over OpenStreetMap data. Straight-line
 * distance understates a real walk here by about 38% — Reuben's is 534 m as the
 * crow flies and 741 m on foot — which made the old numbers look wrong against
 * the map.
 *
 * When you share your location the origin moves and the precomputed routes no
 * longer apply, so we fall back to estimating from the straight line using the
 * factors measured across this dataset. Those values are shown with a "≈".
 */
var CROW_TO_WALK = 1.38;   // measured mean over the 60 routes (range 1.25–1.44)
var WALK_MPS     = 1.385;  // ≈5.0 km/h including crossings and waits
var TRANSIT_KMH  = 12;     // door-to-door inner London, including both walking legs

function crowKm(a, b) {
  var R = 6371, r = Math.PI / 180;
  var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
function atFora() {
  return Math.abs(origin.lat - FORA.lat) < 1e-6 && Math.abs(origin.lng - FORA.lng) < 1e-6;
}
function fmtDist(m) {
  return m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km";
}
function fmtMins(mins) {
  if (mins < 60) return mins + " min";
  var h = Math.floor(mins / 60), r = mins % 60;
  return r ? h + " h " + r + " m" : h + " h";
}
/* Past about 35 minutes nobody walks it, so quote the journey people will make. */
function fmtTime(v) {
  var walkMin = Math.max(1, Math.round(v._s / 60));
  if (walkMin <= 35) return fmtMins(walkMin) + " walk";
  var transitMin = Math.max(5, Math.round(v._m / 1000 / TRANSIT_KMH * 60));
  return "≈ " + fmtMins(transitMin) + " by tube/bus";
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

var BAKE_DELI = /bakery|deli|greengrocer|butcher|fishmonger|ice cream/i;
var TAGS = {
  meat:  ["t-meat",  "Meat"],
  dairy: ["t-dairy", "Dairy"],
  parev: ["t-parev", "Parev"],
  pack:  ["t-pack",  "Supermarket aisle"],
  shop:  ["t-shop",  "Kosher grocery"]
};
var LINK_ICON = '<svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
  '<path d="M3 1h6v6M9 1L1.5 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

function matches(v) {
  if (query) {
    var hay = (v.n + " " + v.k + " " + v.a + " " + v.pc).toLowerCase();
    if (hay.indexOf(query) === -1) return false;
  }
  switch (filter) {
    case "meat":  return v.t === "meat";
    case "dairy": return v.t === "dairy";
    case "parev": return v.t === "parev";
    case "super": return v.t === "shop" || v.t === "pack";
    case "bake":  return BAKE_DELI.test(v.k);
    case "walk":  return v._s <= 20 * 60;
    default:      return true;
  }
}
function visible() {
  var exact = atFora();
  V.forEach(function (v) {
    if (exact && v.wd) {
      v._m = v.wd; v._s = v.wt; v._exact = true;
    } else {
      var m = crowKm(origin, v) * 1000 * CROW_TO_WALK;
      v._m = m; v._s = m / WALK_MPS; v._exact = false;
    }
  });
  return V.filter(matches).sort(function (a, b) { return a._m - b._m; });
}

/* The authority badge is the point of the app: it appears on the card AND in
   the map popup, never only one of them. */
function bodyFor(v) {
  var s = SOURCES[v.s], auth = s[0], url = s[1];
  var tag = TAGS[v.t];
  var q = encodeURIComponent(v.n + ", " + v.a + ", " + v.pc + ", London");
  return '<div class="tags">' +
      '<span class="tag ' + tag[0] + '">' + tag[1] + "</span>" +
      '<a class="hechsher" href="' + url + '" target="_blank" rel="noopener" title="Check this on the ' +
        esc(auth) + ' directory">' + esc(auth) + " " + LINK_ICON + "</a>" +
    "</div>" +
    '<p class="v-addr">' + esc(v.a) + ' &middot; <span class="pc">' + esc(v.pc) + "</span></p>" +
    (v.h ? '<p class="v-note">' + esc(v.h) + "</p>" : "") +
    (v.note ? '<p class="v-note">' + esc(v.note) + "</p>" : "") +
    '<div class="v-acts">' +
      // in-app walking line, and the handoff to Google Maps for turn-by-turn
      '<button class="route-btn" type="button" data-route="' + V.indexOf(v) + '">Show route</button>' +
      '<a class="primary" href="https://www.google.com/maps/dir/?api=1&destination=' + q +
        '&travelmode=walking" target="_blank" rel="noopener">Google Maps</a>' +
      (v.tel ? '<a href="tel:' + v.tel + '">Call</a>' : "") +
    "</div>";
}
function distLabel(v) { return (v._exact ? "" : "≈ ") + fmtDist(v._m); }

function card(v, idx) {
  return '<li class="venue">' +
    '<div class="v-top">' +
      '<div style="flex:1;min-width:0"><h3 class="v-name">' + esc(v.n) +
        '<span class="v-kind">' + esc(v.k) + "</span></h3></div>" +
      '<div class="v-dist"><span class="n">' + distLabel(v) + "</span>" +
        '<span class="walk">' + fmtTime(v) + "</span></div>" +
    "</div>" + bodyFor(v) +
    '<button class="show-map" type="button" data-idx="' + idx + '">Show on map</button>' +
  "</li>";
}
function popupFor(v) {
  return '<h3 class="v-name">' + esc(v.n) + '<span class="v-kind">' + esc(v.k) + "</span></h3>" +
    '<div class="v-dist" style="text-align:left;margin-top:4px"><span class="n">' + distLabel(v) +
      '</span> <span class="walk" style="display:inline">&middot; ' + fmtTime(v) + "</span></div>" +
    bodyFor(v);
}

/* Banded by walking time, which is what decides whether you'd actually go. */
var BANDS = [
  { max: 20 * 60, title: "Walk from the desk",
    note: "Twenty minutes or less on foot from Melcombe Place." },
  { max: 60 * 60, title: "One stop out",
    note: "Too far to walk at lunchtime — a short hop on the Jubilee, Bakerloo or Northern line." },
  { max: Infinity, title: "The north-west cluster",
    note: "Golders Green, Temple Fortune and Hendon — where almost all of London's kosher food actually is. Worth it for dinner, not for lunch." }
];

function renderList(shown) {
  var box = document.getElementById("results");
  if (!shown.length) {
    box.innerHTML = '<p class="empty">Nothing matches that. Try clearing the search or switching back to <b>Everything</b>.</p>';
    return;
  }
  var html = "", prev = -1;
  BANDS.forEach(function (b) {
    var inBand = shown.filter(function (v) { return v._s <= b.max && v._s > prev; });
    prev = b.max;
    if (!inBand.length) return;
    html += '<section class="band">' +
      '<div class="band-head"><h2>' + b.title + '</h2><span class="count">' + inBand.length + "</span></div>" +
      '<p class="band-note">' + b.note + "</p>" +
      '<ul class="list">' + inBand.map(function (v) { return card(v, V.indexOf(v)); }).join("") + "</ul>" +
    "</section>";
  });
  box.innerHTML = html;
}

/* ----------------------------------------------------------------- map --- */
var map = null, tileLayer = null, cluster = null, foraMarker = null,
    gpsMarker = null, gpsCircle = null, markerFor = {}, tileErrors = 0;

var darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
function isDark() {
  var explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return darkMQ.matches;
}
function tileUrl() { return isDark() ? PROVIDER.dark : PROVIDER.light; }

function pin(cls, extra) {
  return L.divIcon({
    className: "pin pin-" + cls + (extra ? " " + extra : ""),
    html: "<span></span>",
    iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14]
  });
}
function mapNote(msg) {
  var el = document.getElementById("mapNote");
  if (!msg) { el.classList.remove("show"); el.textContent = ""; return; }
  el.textContent = msg;
  el.classList.add("show");
}

var TILE_FAIL_MSG = "Map tiles aren’t loading, so the map may be blank or show placeholder squares. " +
  "Everything else — the list, the distances and the kashrut links — still works.";

/* An unauthorised tile server does not fail the way you would hope: Stadia
   answers 401 with a perfectly valid 512×512 PNG that says "401 Invalid
   Authentication". An <img> renders it happily, so Leaflet reports tileload,
   not tileerror, and the user gets a grid of error tiles with no explanation.
   Read one tile's real status instead. */
function probeTiles() {
  var url = tileUrl()
    .replace("{z}", "13").replace("{x}", "4092").replace("{y}", "2723").replace("{r}", "");
  fetch(url, { mode: "cors", cache: "no-store" })
    .then(function (r) {
      // The service worker swaps an error tile for a blank 200, so check its flag too.
      if (!r.ok || r.headers.get("X-Tile-Unavailable")) mapNote(TILE_FAIL_MSG);
    })
    .catch(function () { /* offline: cached tiles may still be fine, say nothing */ });
}

function buildMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true, tap: true });

  tileLayer = L.tileLayer(tileUrl(), {
    maxZoom: PROVIDER.maxZoom,
    attribution: PROVIDER.attribution,
    crossOrigin: "anonymous"   // CORS, not opaque — see sw.js
  }).addTo(map);

  tileLayer.on("tileerror", function () {
    if (++tileErrors === 8) mapNote(TILE_FAIL_MSG);
  });
  probeTiles();

  darkMQ.addEventListener("change", function () { tileLayer.setUrl(tileUrl()); });

  cluster = L.markerClusterGroup({
    maxClusterRadius: 45,
    disableClusteringAtZoom: 18,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    chunkedLoading: false,
    iconCreateFunction: function (c) {
      return L.divIcon({
        html: "<div>" + c.getChildCount() + "</div>",
        className: "marker-cluster",
        iconSize: [44, 44]
      });
    }
  });
  map.addLayer(cluster);

  foraMarker = L.marker([FORA.lat, FORA.lng], {
    icon: pin("fora"), zIndexOffset: 1000, title: FORA.name
  }).bindPopup("<h3 class='v-name'>Fora, Melcombe Place<span class='v-kind'>Your office</span></h3>" +
               "<p class='v-addr'>Distances are measured from here unless you share your location.</p>");
  foraMarker.addTo(map);

  map.on("click", function () { clearRoute(); mapNote(""); });

  map.setView([51.5455, -0.1855], 12);
  fitToVenues(visible());
}

function fitToVenues(shown) {
  if (!map) return;
  var pts = shown.map(function (v) { return [v.lat, v.lng]; });
  pts.push([origin.lat, origin.lng]);
  if (pts.length < 2) { map.setView(pts[0], 14); return; }
  map.fitBounds(L.latLngBounds(pts).pad(0.08), { animate: false });
}

function renderMarkers(shown) {
  if (!cluster) return;
  cluster.clearLayers();
  markerFor = {};
  shown.forEach(function (v) {
    var m = L.marker([v.lat, v.lng], { icon: pin(v.t), title: v.n + " — " + distLabel(v) });
    m.bindPopup(function () { return popupFor(v); }, { maxWidth: 280, autoPanPadding: [16, 16] });
    markerFor[V.indexOf(v)] = m;
    cluster.addLayer(m);
  });
}

/* ---------------------------------------------------------------- route ---
 * Routes from Fora ship with the app as encoded polylines (precision 5), so
 * tapping Route works instantly and offline. From a live position we ask Stadia
 * instead, and its Valhalla response uses precision 6.
 */
function decodePolyline(str, precision) {
  var factor = Math.pow(10, precision), index = 0, lat = 0, lng = 0, out = [];
  while (index < str.length) {
    var shift, result, b;
    shift = result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

var routeCasing = null, routeLine = null;
function clearRoute() {
  [routeCasing, routeLine].forEach(function (l) { if (l) map.removeLayer(l); });
  routeCasing = routeLine = null;
}
function drawRoute(pts) {
  clearRoute();
  // a casing under the line keeps it readable over both basemaps
  routeCasing = L.polyline(pts, { color: "#000", opacity: .35, weight: 9, lineJoin: "round" }).addTo(map);
  routeLine = L.polyline(pts, {
    color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1B5E4B",
    weight: 5, opacity: .95, lineJoin: "round", dashArray: null
  }).addTo(map);
  map.fitBounds(L.latLngBounds(pts).pad(0.15));
}

function showRoute(idx) {
  var v = V[idx];
  setView("map");
  setTimeout(function () {                       // not rAF: it never fires in a hidden tab
    map.invalidateSize();

    if (atFora() && v.rt) {                       // precomputed: instant, offline
      drawRoute(decodePolyline(v.rt, 5));
      mapNote("Walking route to " + v.n + " — " + fmtDist(v._m) + ", " + fmtTime(v) + ".");
      return;
    }
    mapNote("Working out the route…");
    fetch(ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [{ lat: origin.lat, lon: origin.lng }, { lat: v.lat, lon: v.lng }],
        costing: "pedestrian",
        directions_options: { units: "kilometers" }
      })
    }).then(function (r) {
      if (!r.ok) throw new Error("route " + r.status);
      return r.json();
    }).then(function (d) {
      var leg = d.trip.legs[0], s = d.trip.summary;
      drawRoute(decodePolyline(leg.shape, 6));
      mapNote("Walking route to " + v.n + " — " + fmtDist(s.length * 1000) +
              ", " + fmtMins(Math.max(1, Math.round(s.time / 60))) + " on foot.");
    }).catch(function () {
      clearRoute();
      mapNote("Couldn’t fetch a route from where you are. The distance and the " +
              "Google Maps button both still work.");
    });
  }, 0);
}

function showOnMap(idx) {
  setView("map");
  var go = function () {
    var m = markerFor[idx];
    if (!m) {
      // filtered out of the current view — clear the filter and try again
      filter = "all"; query = "";
      document.getElementById("q").value = "";
      syncChips();
      render();
      m = markerFor[idx];
      if (!m) return;
    }
    cluster.zoomToShowLayer(m, function () { m.openPopup(); });
  };
  // let the tab become visible so Leaflet can measure itself first
  setTimeout(function () { map.invalidateSize(); go(); }, 0);
}

/* --------------------------------------------------------------- render --- */
function render() {
  var shown = visible();
  if (view === "list") renderList(shown);
  else renderMarkers(shown);
}

/* ------------------------------------------------------------ view tabs --- */
var tabList = document.getElementById("tabList"), tabMap = document.getElementById("tabMap");
function setView(v) {
  if (view === v && map) return;
  view = v;
  tabList.setAttribute("aria-selected", String(v === "list"));
  tabMap.setAttribute("aria-selected", String(v === "map"));
  document.getElementById("listView").hidden = v !== "list";
  document.getElementById("mapView").hidden = v !== "map";
  if (v === "map") {
    if (!map) buildMap();
    render();
    setTimeout(function () { map.invalidateSize(); }, 0);
  } else {
    render();
  }
}
tabList.addEventListener("click", function () { setView("list"); });
tabMap.addEventListener("click", function () { setView("map"); });

/* ------------------------------------------------------------- controls --- */
function syncChips() {
  [].forEach.call(document.querySelectorAll(".chip"), function (c) {
    c.setAttribute("aria-pressed", String(c.dataset.f === filter));
  });
}
document.getElementById("chips").addEventListener("click", function (e) {
  var btn = e.target.closest(".chip");
  if (!btn) return;
  filter = btn.dataset.f;
  syncChips();
  render();
  if (view === "map") fitToVenues(visible());
});
document.getElementById("q").addEventListener("input", function (e) {
  query = e.target.value.trim().toLowerCase();
  render();
});
document.getElementById("results").addEventListener("click", function (e) {
  var show = e.target.closest(".show-map");
  if (show) { showOnMap(Number(show.dataset.idx)); return; }
  var route = e.target.closest(".route-btn");
  if (route) showRoute(Number(route.dataset.route));
});
// the same Route button also appears inside map popups
document.getElementById("map").addEventListener("click", function (e) {
  var route = e.target.closest(".route-btn");
  if (!route) return;
  e.stopPropagation();
  showRoute(Number(route.dataset.route));
});

/* ---------------------------------------------------------- geolocation --- */
var dot = document.getElementById("dot"),
    originName = document.getElementById("originName"),
    locBtn = document.getElementById("locBtn"),
    resetBtn = document.getElementById("resetBtn");

function applyFix(pos) {
  // Underground fixes can be wildly wrong; keep the last good one instead.
  if (pos.coords.accuracy > 500 && lastFix) return;
  lastFix = pos;
  origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  originName.textContent = "where you are now";
  dot.classList.add("live");
  locBtn.hidden = true;
  resetBtn.hidden = false;
  if (map) {
    var ll = [origin.lat, origin.lng];
    if (!gpsMarker) {
      gpsMarker = L.marker(ll, { icon: pin("gps"), zIndexOffset: 900, title: "You are here" }).addTo(map);
      gpsCircle = L.circle(ll, { radius: pos.coords.accuracy, color: "#A8321F", weight: 1, opacity: .5, fillOpacity: .08 }).addTo(map);
    } else {
      gpsMarker.setLatLng(ll);
      gpsCircle.setLatLng(ll).setRadius(pos.coords.accuracy);
    }
  }
  render();
}
function locate() {
  if (!navigator.geolocation) {
    locBtn.textContent = "Location unavailable";
    locBtn.disabled = true;
    return;
  }
  locBtn.textContent = "Locating…";
  locBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(function (pos) {
    locBtn.disabled = false;
    locBtn.textContent = "Use my location";
    applyFix(pos);
  }, function (err) {
    locBtn.disabled = false;
    if (err.code === 1) {            // PERMISSION_DENIED — Chrome will not re-prompt
      locBtn.textContent = "Location blocked";
      locBtn.disabled = true;
      mapNote("Location is blocked for this site. Re-allow it in Chrome’s site settings, " +
              "or carry on — everything is measured from Fora instead.");
    } else if (err.code === 3) {     // TIMEOUT
      locBtn.textContent = "Timed out — tap to retry";
    } else {
      locBtn.textContent = "Try location again";
    }
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}
locBtn.addEventListener("click", locate);
resetBtn.addEventListener("click", function () {
  origin = { lat: FORA.lat, lng: FORA.lng };
  originName.textContent = FORA.name;
  dot.classList.remove("live");
  locBtn.hidden = false; locBtn.disabled = false; locBtn.textContent = "Use my location";
  resetBtn.hidden = true;
  if (gpsMarker) { map.removeLayer(gpsMarker); map.removeLayer(gpsCircle); gpsMarker = gpsCircle = null; }
  render();
});

// In an installed app, locating on launch is expected — but only if permission
// was already granted, so we never prompt unbidden on first open.
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: "geolocation" }).then(function (st) {
    if (st.state === "granted") locate();
    else if (st.state === "denied") { locBtn.textContent = "Location blocked"; locBtn.disabled = true; }
  }).catch(function () { /* Safari and friends: ignore */ });
}

/* ------------------------------------------------------------- Shabbat --- */
(function () {
  var day = new Date().getDay();
  var box = document.getElementById("shabbat"), txt = document.getElementById("shabbatText");
  if (day === 5) {
    txt.innerHTML = "<b>It's Friday.</b> Kosher kitchens close early for Shabbat — most stop serving between " +
                    "14:00 and 15:00. Call before you set off.";
    box.classList.add("show");
  } else if (day === 6) {
    txt.innerHTML = "<b>It's Shabbat.</b> Everything on this list is closed today. Supermarket kosher aisles are " +
                    "your only option until after nightfall.";
    box.classList.add("show");
  }
})();

/* ------------------------------------------------ service worker + boot --- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" })
      .catch(function (e) { console.warn("SW registration failed:", e); });
  });
  var reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

syncChips();
render();
})();
