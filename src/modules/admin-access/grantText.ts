import type { Level, Scope } from '@goms/domain'

/** Words for what a grant means, matching the generated permission matrix. Pure presentation of a server-computed grant:
 *  nothing here decides what anybody may do. */

export const scopeWord = (scope: Scope): string => (scope === 'own' ? 'own rows only' : scope === 'asg' ? 'assigned rows only' : '')

/** No access / Read only / Read + edit some fields (SET, ...) / Read + edit all, plus the row scope for the edit levels. */
export function levelText(level: Level, scope: Scope, sets: readonly string[]): string {
  const base = level === 'N' ? 'No access'
    : level === 'R' ? 'Read only'
    : level === 'P' ? `Read + edit some fields${sets.length ? ` (${sets.join(', ')})` : ''}`
    : 'Read + edit all'
  const word = level === 'P' || level === 'W' ? scopeWord(scope) : ''
  return word ? `${base} · ${word}` : base
}

export const grantChips = (grant: { create: boolean; delete: boolean }): string[] => [...(grant.create ? ['Create'] : []), ...(grant.delete ? ['Delete'] : [])]
