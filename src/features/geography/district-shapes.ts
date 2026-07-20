import type { Geometry } from 'geojson'

interface RawDistrictFile {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: { name: string; code: string }; geometry: Geometry }[]
}

/** One lazy-loadable module per state — Vite code-splits each into its own
 *  chunk, so opening a state's Geography tab only ever downloads that one
 *  state's district boundaries, not all of India's. Built by dissolving the
 *  national sub-district layer (datta07/INDIAN-SHAPEFILES, MIT) by LGD
 *  district code — every feature's `code` is the LGD district code, matching
 *  this app's district node `code` exactly (no name matching needed). */
const modules = import.meta.glob<{ default: RawDistrictFile }>('../../assets/districts/*.json')

const keyByCode = new Map(
  Object.keys(modules).map((path) => [Number(path.match(/(\d+)\.json$/)![1]), path] as const),
)

/** Loads the raw district shapes for one state, or null if this state has no
 *  bundled boundary data (data is 2011-census vintage — newer states/UTs
 *  created since then, like Ladakh or Telangana, may not have a file). */
export async function loadStateDistrictShapes(stateCode: number): Promise<RawDistrictFile | null> {
  const path = keyByCode.get(stateCode)
  if (!path) return null
  const mod = await modules[path]()
  return mod.default
}
