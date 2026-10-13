export const productionSecurity = () => process.env.NODE_ENV === 'production' || process.env.SECURITY_ENFORCEMENT_ENABLED === 'true'

/** Production never silently inherits the permissive local development defaults. */
export function assertSecurityConfiguration() {
  if (!productionSecurity()) return
  for (const flag of ['AUTH_ENFORCEMENT_ENABLED', 'READ_AUTH_ENFORCEMENT_ENABLED']) {
    if (process.env[flag] !== undefined && process.env[flag] !== 'true') throw new Error(`${flag} must be true in production.`)
  }
  if (process.env.RBAC_MODE !== undefined && process.env.RBAC_MODE !== 'enforce') throw new Error('RBAC_MODE must be enforce in production.')
  if (!process.env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is required for production authentication.')
  const admins = (process.env.ADMIN_ALLOWED_EMAILS ?? '').split(',').map(email => email.trim()).filter(Boolean)
  if (!admins.length || admins.some(email => !/^[^@\s]+@amnex\.com$/i.test(email))) throw new Error('Configure verified Amnex ADMIN_ALLOWED_EMAILS before production enforcement.')
  for (const origin of (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)) {
    const url = new URL(origin.trim())
    if (url.protocol !== 'https:' || url.origin !== origin.trim() || url.username || url.password) throw new Error('Production CORS origins must be exact HTTPS origins.')
  }
}
