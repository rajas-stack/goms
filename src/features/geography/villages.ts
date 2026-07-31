/** Villages (~640k nationwide) are two orders of magnitude too numerous to
 *  hold as real nodes in the in-memory tree the rest of this app uses — see
 *  `data/seed.ts` for why sub-districts stop there. Instead each taluka's
 *  villages live in their own file under public/villages/, fetched only
 *  when that taluka is actually opened.
 *
 *  Served as a static asset and fetched at runtime rather than bundled via
 *  import.meta.glob — see village-shapes.ts for why (~6,350 files here hit
 *  the same CI build memory ceiling when Rollup treated each as a module). */

/** [village LGD code, village name] pairs for one taluka, or null if this
 *  taluka has no bundled village data (its district was created after the
 *  source LGD snapshot this was built from, or the request failed). */
export async function loadVillages(subdistrictCode: string): Promise<[string, string][] | null> {
  try {
    const res = await fetch(`/villages/${subdistrictCode}.json`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
