import { accessFor, treeAllows } from '@goms/domain'
import { TRPCError } from '@trpc/server'
import { isAmnexAccount, verifyIdentity } from '../auth/identity.js'
import { isSystemAdminEmail } from '../auth/rbac/systemAdminOnly.js'
import { loadUserFacts } from '../auth/rbac/userFacts.js'
import { resolveForEmail } from '../lib/rbacTreeStore.js'
import { RbacDenial } from '../auth/rbac/denial.js'
import type { Context } from '../trpc.js'
import type { ProfileMapping, ProfileScope } from './mapping.js'

export async function profileScopes(user: { email: string }): Promise<Set<ProfileScope>> {
  const facts = await loadUserFacts(user.email)
  const tree = await resolveForEmail(user.email, facts.roles)
  const scopes = new Set<ProfileScope>()
  if (accessFor(facts, 'am.contacts').level !== 'N' && treeAllows(tree, 'accountMapping.directory', 'view')) scopes.add('contacts')
  if (accessFor(facts, 'team.org').level !== 'N' && treeAllows(tree, 'teams', 'view')) scopes.add('internal')
  if (accessFor(facts, 'team.sales').level !== 'N' && treeAllows(tree, 'teams.sales', 'view')) scopes.add('sales')
  return scopes
}
export async function assertProfileMappingAccess(user: { email: string }, mapping: ProfileMapping) {
  if (!(await profileScopes(user)).has(mapping.scope ?? 'contacts')) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view this employee image.' })
}

/** Private photos and shared configuration always authenticate, including in staged/development RBAC modes. */
export async function assertProfileAccess(user: { email: string }, admin = false, edit = false) {
  if (!isAmnexAccount(user.email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Sign in with your approved company account.' })
  // Reuse the existing role/tree caches so a directory of thumbnails does not multiply permission queries.
  let allowed: boolean
  if (admin) {
    const facts = await loadUserFacts(user.email, true)
    const tree = await resolveForEmail(user.email, facts.roles, true)
    allowed = isSystemAdminEmail(user.email) && treeAllows(tree, 'settings.system.storage', edit ? 'edit' : 'view')
  } else allowed = (await profileScopes(user)).size > 0
  if (!allowed) throw new TRPCError({ code: 'FORBIDDEN', message: admin ? 'Profile Images configuration requires DMS administrator access.' : 'You do not have permission to view People images.',
    cause: new RbacDenial('Profile Images access denied.', { module: admin ? 'admin.access' : 'am.contacts', action: edit ? 'update' : 'read' }) })
}
export async function profileActor(ctx: Context, admin = false, edit = false) {
  const user = await verifyIdentity(ctx.authHeader)
  await assertProfileAccess(user, admin, edit)
  return user
}
