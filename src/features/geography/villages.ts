/** Villages (~640k nationwide) are two orders of magnitude too numerous to
 *  hold as real nodes in the in-memory tree the rest of this app uses — see
 *  `data/seed.ts` for why sub-districts stop there. Instead each taluka's
 *  villages live in their own tiny chunk, split by LGD sub-district code and
 *  loaded only when that taluka is actually opened. */
const modules = import.meta.glob<{ default: [string, string][] }>('../../assets/villages/*.json')

const pathByCode = new Map(
  Object.keys(modules).map((path) => [path.match(/([^/]+)\.json$/)![1], path] as const),
)

/** [village LGD code, village name] pairs for one taluka, or null if this
 *  taluka has no bundled village data (its district was created after the
 *  source LGD snapshot this was built from). */
export async function loadVillages(subdistrictCode: string): Promise<[string, string][] | null> {
  const path = pathByCode.get(subdistrictCode)
  if (!path) return null
  const mod = await modules[path]()
  return mod.default
}
