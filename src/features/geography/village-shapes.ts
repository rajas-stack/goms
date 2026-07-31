import type { MapFeature } from './GeoMapView'

/** Village boundaries, bundled locally per state per taluka — converted
 *  offline from LGD village-boundary shapefiles via
 *  `scripts/generate-village-data.cjs` into
 *  public/village-shapes/<stateCode>/<talukaCode>.json (kept distinct
 *  from public/villages/, which holds villages.ts's unrelated flat
 *  [code, name] name-only fallback list, keyed only by taluka code).
 *
 *  Served as a static asset and fetched at runtime rather than bundled via
 *  import.meta.glob: with ~6,450 files here, Rollup treating each as its
 *  own module (to parse, hold, and render) blew the CI runner's memory
 *  ceiling — a bigger --max-old-space-size didn't help since the limit was
 *  the container's actual memory, not V8's heap. fetch() keeps the same
 *  lazy-loading shape (one request per taluka, only when opened) without
 *  Rollup ever touching this JSON. */
type VillageShapesFile = {
  features: { properties: { name: string; code: string }; geometry: MapFeature['geometry'] }[]
}

/** Village polygons for one taluka, or [] if this state/taluka has no
 *  bundled boundary data (its zip wasn't part of the source set, the
 *  taluka is one the LGD snapshot doesn't cover, or the request failed).
 *  Never throws. */
export async function loadVillageShapes(talukaCode: string, stateCode: number): Promise<MapFeature[]> {
  try {
    const res = await fetch(`/village-shapes/${stateCode}/${talukaCode}.json`)
    if (!res.ok) return []
    const data: VillageShapesFile = await res.json()
    return data.features.map((f) => ({ code: f.properties.code, name: f.properties.name, geometry: f.geometry }))
  } catch {
    return []
  }
}
