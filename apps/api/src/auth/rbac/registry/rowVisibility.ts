import { accessFor, type UserFacts } from '@goms/domain'
import { sheetModule, type RowModule } from '../rows.js'

/** The Master Grid is derived: a role sees the union of the rows on the sheets it can read. (Every role has at least
 *  Read on all three sheet modules today, so this is a no-op until the matrix changes — but it is the enforcement
 *  point the spec's "rows visible = union of 1–3" rule needs.) */
export function filterRowsBySheet<T>(data: T, canReadModule: (module: RowModule) => boolean): T {
  if (!Array.isArray(data)) return data
  return data.filter((row) => !(typeof row === 'object' && row !== null) || canReadModule(sheetModule((row as any).sheet))) as T
}

export const maskGridRows = (data: unknown, user: UserFacts): unknown =>
  filterRowsBySheet(data, (module) => accessFor(user, module).level !== 'N')
