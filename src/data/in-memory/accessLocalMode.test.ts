import { describe, expect, it } from 'vitest'
import { repository } from '@/data/repository'

// The local (in-browser) store has no server, no roles and no policy, so the Role & Access reads answer with neutral values
// and the screen shows its explicit empty states. (The remote repository is the one that talks to the access router.)
describe('InMemoryRepository — Role & Access reads (local mode: neutral values)', () => {
  it('has no people, no overrides, no unmatched overrides and no history', async () => {
    expect(await repository.getAccessReadiness()).toEqual([])
    expect(await repository.listRoleOverrides()).toEqual([])
    expect(await repository.listUnmatchedOverrides()).toEqual([])
    expect(await repository.listOverrideHistory()).toEqual([])
    expect(await repository.listOverrideHistory({ email: 'someone@amnex.com' })).toEqual([])
  })

  it('has an empty permission matrix', async () => {
    const matrix = await repository.getPermissionMatrix()
    expect(matrix.modules).toEqual([])
    expect(matrix.roles).toEqual([])
    expect(matrix.restrictions).toEqual([])
  })

  it('says a person has no role and no permissions, and is not a System Admin', async () => {
    const permissions = await repository.getEffectivePermissions('someone@amnex.com')
    expect(permissions).toEqual({ email: 'someone@amnex.com', roles: [], systemAdmin: false, modules: [], notes: [] })
  })
})
