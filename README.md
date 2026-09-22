# Kosher Near Melcombe Place

Certified kosher food around **Fora, Melcombe Place** (London NW1 6JJ), sorted by live distance,
with every listing linked to the kashrut authority that licenses it.

A static, installable web app. No build step, no framework, no bundler.

## What it is

- **60 venues**, each licensed by KLBD, KF Kosher or SKA — plus supermarket kosher sections,
  clearly labelled as such.
- **List view** grouped into distance bands (walk from the desk / one stop out / the north-west cluster),
  with filters for meat, dairy, parev & fish, supermarkets and bakeries & delis.
- **Map view** — Leaflet with real street tiles, colour-coded pins and clustering.
- **Real walking distances**, routed over OpenStreetMap pedestrian data from Melcombe Place — not
  straight lines. Straight-line distance understates a walk here by about 38% (Reuben's is 534 m as the
  crow flies but 741 m on foot), which is why the numbers now agree with the map.
- **Distances from your actual position** when you grant location — estimated in that case, and marked `≈`.
- **Works offline.** The app shell and recently-viewed map tiles are cached, which matters on the
  Underground. The first load must be online.

## The rule this list follows

Nothing is included on reputation. A venue appears only if it is on a UK kashrut authority's own
published list, and every entry links to that list so you can check it yourself.

Two venues were deliberately **excluded** for failing this test despite being well known locally:
**B Kosher** and **Kay's Delicatessen** — neither appears on the KLBD, KF or SKA directories, and
B Kosher's own site does not state a supervising authority. If you can point me at their hechsher
they go straight back in.

Supervision lapses. **Check the badge before you order.**

Data last verified against the authority directories on **22 September 2026**.

### Sources

| Authority | Directory |
|---|---|
| KLBD — Kosher London Beth Din | <https://kosher.org.uk/kosher-places/> |
| KF Kosher — Kehillas Federation | <https://kfkosher.org/establishments-catering/> |
| SKA — Sephardi Kashrut Authority | <https://www.ska.org.uk/licensees> |
| Western Marble Arch Synagogue | <https://www.marblearch.org.uk/visit-us/central-london-kosher-guide/> |
| Chabad of Bloomsbury | <https://www.chabadw1.org/> |

## Installing it on a phone

Open the site in Chrome on Android → menu → **Install app**. Android packages it as a WebAPK, so it
gets a real launcher icon and app-drawer entry and opens without browser chrome.

On iOS it is Share → **Add to Home Screen** (no install prompt; Safari does not offer one).

## How distances are calculated

Each venue carries `wd` (metres) and `wt` (seconds) on the real pedestrian network from Fora,
precomputed with [Valhalla](https://valhalla1.openstreetmap.de/) over OpenStreetMap data and baked into
`data.js`. No routing happens at runtime, so it works offline.

Anything over a 35-minute walk is quoted as an approximate door-to-door tube/bus journey at 12 km/h
(inner London, including both walking legs) rather than an unusable walking time.

When you share your location the origin moves and the precomputed routes no longer apply. The app then
estimates from the straight line using factors measured across these 60 routes — ×1.38 for distance,
5.0 km/h for speed — and marks those values `≈`.

To re-route after editing coordinates, re-run the Valhalla precompute (see git history for the script)
and update `wd`/`wt`.

## Map tiles

Tiles come from **Stadia Maps**, using their light (`alidade_smooth`) and dark
(`alidade_smooth_dark`) styles, switched to match the system theme.

Stadia uses **domain-based authentication**, so there is no API key in this repository. The deploy
domain must be added to the property allowlist in the Stadia dashboard or tiles will not load.
`localhost` is exempt, so local development works with no setup.

Required attribution (rendered on the map, do not remove — it is a licence term):

> © Stadia Maps © OpenMapTiles © OpenStreetMap

### Swapping provider

Providers live in one constant at the top of `app.js`:

```js
var PROVIDER = TILE_PROVIDERS.stadia;   // or .carto
```

A CARTO fallback is already defined. CARTO began requiring API keys in August 2026, so append
`?key=…` to those URL templates if you switch. Note that a CARTO key sits in client-side JS and is
therefore public.

`tile.openstreetmap.org` is **not** an option here: the OSMF tile usage policy forbids offline use
and prefetching, which is exactly what the service worker does.

## Layout

```
index.html    markup
app.css       styles, including the light/dark token system
data.js       window.KNF = { FORA, SOURCES, VENUES }
app.js        list, filters, map, geolocation
sw.js         offline caching
manifest.json PWA manifest
vendor/       Leaflet 1.9.4, leaflet.markercluster 1.5.3 (vendored, not CDN)
fonts/        Archivo, Source Sans 3, IBM Plex Mono (self-hosted)
icons/        PWA icons, generated from the SVGs with `sips`
```

All paths are **relative** — the app is served from a subdirectory on GitHub Pages, so a leading `/`
would break assets, the service worker scope and `start_url`.

## Developing

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

**Bump `SHELL` in `sw.js` on every deploy.** It is the cache name, and it is what replaces the app
for people who already have it installed. Navigation is network-first with a fallback, so a stale
shell should not survive a deploy — but the version bump is what clears the old assets.

Regenerating icons after editing the SVGs:

```bash
sips -s format png -Z 512 icons/icon-512.svg      --out icons/icon-512.png
sips -s format png -Z 192 icons/icon-512.svg      --out icons/icon-192.png
sips -s format png -Z 512 icons/icon-maskable.svg --out icons/icon-maskable-512.png
sips -s format png -Z 180 icons/icon-512.svg      --out icons/apple-touch-icon.png
```

`sips` rasterises an SVG at its intrinsic size before resampling, so keep `width="512" height="512"`
on the source or the output will be a blurry upscale.

## Licence

Code: MIT. Venue data is compiled from the public directories listed above and is not authoritative —
always confirm with the certifying authority.
