import type { Geometry } from 'geojson'

interface RawTalukaFile {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: { name: string; code: string }; geometry: Geometry }[]
}

/** One lazy-loadable module per state — Vite code-splits each into its own
 *  chunk, so opening a state only ever downloads that one state's taluka
 *  boundaries. Source: datta07/INDIAN-SHAPEFILES (MIT), national sub-district
 *  polygons, simplified and split by census state code. Each feature's `code`
 *  is the LGD sub-district code, matching this app's taluka node `code`. */
const modules = import.meta.glob<{ default: RawTalukaFile }>('../../assets/talukas/*.json')

const keyByCode = new Map(
  Object.keys(modules).map((path) => [Number(path.match(/(\d+)\.json$/)![1]), path] as const),
)

/** Loads the raw taluka shapes for one state, or null if this state has no
 *  bundled boundary data. */
export async function loadStateTalukaShapes(stateCode: number): Promise<RawTalukaFile | null> {
  const path = keyByCode.get(stateCode)
  if (!path) return null
  const mod = await modules[path]()
  return mod.default
}
