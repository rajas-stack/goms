import { allocateDirectoryNumber, BUILTIN_DIRECTORY_RANGES, ensureCategoryRanges, type DirectoryRange } from '@goms/domain'
import type { Employee } from '@/lib/types'

/** Account Mapping people are the Client Departments category. */
export const EMPLOYEE_CATEGORY = 'clientDepartment'

/** Ranges for every Directory Types code, then a number for each filled (non-vacant) Account Mapping
 *  person that lacks one, in list order. Existing numbers and ranges are never changed. */
export function backfillDirectoryIds(employees: readonly Employee[], ranges: readonly DirectoryRange[], directoryTypeCodes: readonly string[]) {
  let all = ensureCategoryRanges(ranges.length ? ranges : BUILTIN_DIRECTORY_RANGES, directoryTypeCodes)
  let clientRange = all.find(r => r.categoryKey === EMPLOYEE_CATEGORY)!
  // Never re-issue a number someone already holds, even if the stored counter is missing or behind.
  const highest = Math.max(clientRange.rangeStart - 1, ...employees.map(e => e.directoryNumber ?? 0).filter(n => n <= clientRange.rangeEnd))
  clientRange = { ...clientRange, nextValue: Math.max(clientRange.nextValue, highest + 1) }
  const numbered = employees.map((e) => {
    if (e.vacant || e.directoryNumber != null) return e
    const { number, range } = allocateDirectoryNumber(clientRange)
    clientRange = range
    return { ...e, directoryNumber: number }
  })
  all = all.map(r => (r.categoryKey === EMPLOYEE_CATEGORY ? clientRange : r))
  return { employees: numbered, ranges: [...all] }
}
