import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupRbacFixtures, makeSystemAdmin, rbacEmail, setRole } from '../../testHelpers/rbacFixtures.js'
import { decide } from './decide.js'
import { PROCEDURE_POLICY } from './registry/index.js'
import { loadUserFacts } from './userFacts.js'

/** Spec §3.4: System Admin is unrestricted. Whatever a procedure's registry requirements are, a System Admin is never refused
 *  for lack of permission. (A requirement may still reject malformed input — `module: 'input'` — which is not a permission.) */
const INPUTS: Record<string, unknown>[] = [
  {}, { entityType: 'bid' }, { entityType: 'contact' }, { key: 'taxClasses' }, { key: 'currencies' }, { key: 'approvalMatrix' },
  { patch: { hardwareCost: 1, floorPrice: 2, taxClassId: 'x', approvalStatus: 'approved' } }, { role: 'solutionLead', entityType: 'bid' },
]

beforeEach(async () => { await cleanupRbacFixtures(); makeSystemAdmin('root') })
afterEach(async () => { delete process.env.ADMIN_ALLOWED_EMAILS; await cleanupRbacFixtures() })

describe('System Admin has every permission, on every registered procedure', () => {
  const paths = Object.entries(PROCEDURE_POLICY).filter(([, e]) => !e.kind).map(([p]) => p)

  it('has a non-trivial registry to test', () => { expect(paths.length).toBeGreaterThan(150) })

  it.each(INPUTS.map((raw, i) => [i, raw] as const))('is never refused a permission (input shape #%i)', async (_i, raw) => {
    const user = await loadUserFacts(rbacEmail('root'))
    expect(user.roles).toEqual(['system_admin'])
    const refused: string[] = []
    for (const path of paths) {
      const { denial } = await decide(path, raw, user)
      if (denial && denial.module !== 'input') refused.push(`${path}: ${denial.module}/${denial.action}${denial.atom ? `/${denial.atom}` : ''}`)
    }
    expect(refused).toEqual([])
  })

  it('is refused nothing an ordinary role is granted either — the control group really is refused somewhere', async () => {
    await setRole('legal', 'legal')
    const legal = await loadUserFacts(rbacEmail('legal'))
    let refused = 0
    for (const path of paths) if ((await decide(path, {}, legal)).denial) refused++
    expect(refused).toBeGreaterThan(20)
  })
})
