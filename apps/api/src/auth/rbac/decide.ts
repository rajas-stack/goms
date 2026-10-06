import {
  accessFor, allows, atomLabel, canReadAtom, isMaskedAtom, moduleLabel, type UserFacts,
} from '@goms/domain'
import { DenyCall } from './denial.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import type { Check, PolicyEntry } from './registry/types.js'

export interface Denial { module: string; action: string; atom?: string; message: string }

/** Does `user` satisfy one check? Returns the denial, or null when allowed. */
export function evaluateCheck(check: Check, user: UserFacts): Denial | null {
  const label = moduleLabel(check.module)
  const deny = (what: string, atom?: string): Denial => ({
    module: check.module, action: check.action, atom, message: `You don't have permission to ${what}.`,
  })

  if (check.action === 'read') {
    const modules = check.anyOf ?? [check.module]
    return modules.some((m) => accessFor(user, m, check.row).level !== 'N') ? null : deny(`view ${label}`)
  }
  const access = accessFor(user, check.module, check.row)
  if (check.action === 'create') return access.create ? null : deny(`create in ${label}`)
  if (check.action === 'delete') return access.delete ? null : deny(`delete from ${label}`)

  if (access.level !== 'P' && access.level !== 'W') return deny(`edit ${label}`)
  if (check.atoms === undefined) return access.all ? null : deny(`edit ${label}`)
  for (const atom of check.atoms) {
    if (!allows(access, atom)) return deny(`edit ${atomLabel(atom)}`, atom)
    // A role cannot edit a field it is not allowed to read.
    if (isMaskedAtom(atom) && !canReadAtom(user.roles, atom)) return deny(`edit ${atomLabel(atom)}`, atom)
  }
  return null
}

export async function decide(path: string, raw: unknown, user: UserFacts): Promise<{ denial: Denial | null; entry: PolicyEntry | undefined }> {
  const entry = PROCEDURE_POLICY[path]
  if (!entry) {
    return { entry, denial: { module: 'unregistered', action: 'call', message: `No access policy is registered for ${path}.` } }
  }
  if (entry.kind) return { entry, denial: null }
  for (const requirement of entry.requirements) {
    let check: Check | null
    try {
      check = await requirement(raw, user)
    } catch (e) {
      if (e instanceof DenyCall) return { entry, denial: { module: 'input', action: 'call', message: e.message } }
      throw e
    }
    if (!check) continue
    const denial = evaluateCheck(check, user)
    if (denial) return { entry, denial }
  }
  return { entry, denial: null }
}
