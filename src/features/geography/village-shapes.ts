import { PbfReader } from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'
import { PMTiles } from 'pmtiles'
import type { Geometry } from 'geojson'
import type { MapFeature } from './GeoMapView'

/** On-demand, all-India village boundaries via vector tiles — no village
 *  geometry is bundled with the app; tiles are fetched over HTTP range
 *  requests only for the taluka currently being viewed, then cached.
 *
 *  Source: LGD_Villages.pmtiles (Local Government Directory, via the
 *  india-geodata project), zoom 0–10, ~270MB total but PMTiles' directory
 *  index means a taluka view only ever pulls the handful of tiles (each tens
 *  of KB) covering its bounding box — the rest of the archive is never
 *  fetched. Every feature carries `subdt_lgd`, the same LGD sub-district code
 *  this app already uses as its taluka `code`, so joining is exact — no name
 *  matching needed. */

// Proxied through the dev server (see vite.config.ts) — the release host
// doesn't send CORS headers, so the browser can't range-fetch it directly.
const PMTILES_URL = '/geo-tiles/LGD_Villages.pmtiles'
const LAYER_NAME = 'LGD_Villages'
const ZOOM = 10

const pmtiles = new PMTiles(PMTILES_URL)

interface VillageProps {
  vil_lgd?: number
  subdt_lgd?: number
  state_lgd?: number
  vilname11?: string
  vilnam_soi?: string
}

function lon2x(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function lat2y(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

/** Every tile (x,y) at ZOOM covering a geometry's bounding box — usually one,
 *  occasionally a handful for a taluka that straddles a tile edge. */
function tilesCovering(geom: Geometry): { x: number; y: number }[] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  const visit = (coords: unknown): void => {
    const arr = coords as unknown[]
    if (typeof arr[0] === 'number') {
      const [lon, lat] = arr as [number, number]
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      return
    }
    for (const c of arr) visit(c)
  }
  visit((geom as { coordinates: unknown }).coordinates)

  const x0 = lon2x(minLon, ZOOM)
  const x1 = lon2x(maxLon, ZOOM)
  const y0 = lat2y(maxLat, ZOOM) // max lat -> smaller y
  const y1 = lat2y(minLat, ZOOM)
  const out: { x: number; y: number }[] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push({ x, y })
  }
  return out
}

async function fetchTileFeatures(x: number, y: number): Promise<VectorTile['layers'][string] | null> {
  const resp = await pmtiles.getZxy(ZOOM, x, y)
  if (!resp) return null
  const tile = new VectorTile(new PbfReader(new Uint8Array(resp.data)))
  return tile.layers[LAYER_NAME] ?? null
}

/** Per-taluka cache so revisiting a taluka in the same session is instant. */
const cache = new Map<string, Promise<MapFeature[]>>()

/** Village polygons for one taluka, matched by exact LGD sub-district code
 *  against the taluka's own real boundary (used to compute which tiles to
 *  fetch) — *and* by state LGD code, so a coincidental sub-district code
 *  collision between two states (LGD codes are meant to be unique, but the
 *  app's own district codes turned out not to be — see seed.ts's `dtKey`)
 *  can never stitch the wrong state's villages onto this taluka. Never
 *  throws — resolves to [] if the source has no coverage there. */
export async function loadVillageShapes(
  talukaGeometry: Geometry, talukaCode: string, stateCode: number,
): Promise<MapFeature[]> {
  const cacheKey = `${stateCode}_${talukaCode}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    const tiles = tilesCovering(talukaGeometry)
    const byVillage = new Map<string, MapFeature>()
    await Promise.all(tiles.map(async ({ x, y }) => {
      const layer = await fetchTileFeatures(x, y).catch(() => null)
      if (!layer) return
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const props = f.properties as VillageProps
        if (String(props.subdt_lgd ?? '') !== talukaCode) continue
        if (Number(props.state_lgd) !== stateCode) continue
        const name = props.vilname11?.trim() || props.vilnam_soi?.trim() || 'Unnamed village'
        const code = String(props.vil_lgd ?? `${x}_${y}_${i}`)
        if (byVillage.has(code)) continue
        byVillage.set(code, { code, name, geometry: f.toGeoJSON(x, y, ZOOM).geometry })
      }
    }))
    return [...byVillage.values()]
  })()

  cache.set(cacheKey, promise)
  return promise
}
