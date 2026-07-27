import type { MapFeature } from './GeoMapView'

/** Village boundaries, bundled locally per state per taluka — converted
 *  offline from LGD village-boundary shapefiles via
 *  `scripts/generate-village-data.cjs` into
 *  src/assets/village-shapes/<stateCode>/<talukaCode>.json (kept distinct
 *  from src/assets/villages/, which holds villages.ts's unrelated flat
 *  [code, name] name-only fallback list, keyed only by taluka code).
 *
 *  Vite code-splits every taluka file into its own chunk, so opening a
 *  taluka only ever downloads that taluka's villages — same lazy-loading
 *  shape as taluka-shapes.ts, just one level deeper. No network fetch to an
 *  external host is involved, unlike the coverage-wide PMTiles source this
 *  replaced. */
const modules = import.meta.glob<{ default: { features: { properties: { name: string; code: string }; geometry: MapFeature['geometry'] }[] } }>(
  '../../assets/village-shapes/*/*.json',
)

const pathByKey = new Map(
  Object.keys(modules).map((p) => {
    const m = p.match(/([^/]+)\/([^/]+)\.json$/)!
    return [`${m[1]}/${m[2]}`, p] as const
  }),
)

/** Village polygons for one taluka, or [] if this state/taluka has no
 *  bundled boundary data (its zip wasn't part of the source set, or the
 *  taluka is one the LGD snapshot doesn't cover). Never throws. */
export async function loadVillageShapes(talukaCode: string, stateCode: number): Promise<MapFeature[]> {
  const path = pathByKey.get(`${stateCode}/${talukaCode}`)
  if (!path) return []
  const mod = await modules[path]()
  return mod.default.features.map((f) => ({ code: f.properties.code, name: f.properties.name, geometry: f.geometry }))
}
