import { describe, it, expect, vi, afterEach } from 'vitest'
const query = vi.hoisted(() => vi.fn())
vi.mock('../db.js', () => ({ pool: { query } }))
import { beginSecurityAudit, finishSecurityAudit } from './audit.js'
import { PROCEDURE_POLICY } from '../auth/rbac/registry/index.js'
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks() })
describe('sensitive operation controls', () => {
  it('restricts shared key changes to administrator permissions', async () => {
    for (const action of ['create', 'update', 'remove']) {
      const requirement = await PROCEDURE_POLICY[`credentialPassphrases.${action}`].requirements[0]({}, {} as any)
      expect(requirement).toMatchObject({ module: 'admin.access' })
    }
  })
  it('stores only operation metadata and signals audit completion failures', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'event-id' }] })
    expect(await beginSecurityAudit('user', 'user@amnex.com', 'credentialPassphrases.update')).toBe('event-id')
    expect(query.mock.calls[0][1]).toEqual(['user', 'user@amnex.com', 'credentialPassphrases.update'])
    const alert = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    query.mockRejectedValueOnce(new Error('database password must not be logged'))
    await finishSecurityAudit('event-id', true)
    expect(alert).toHaveBeenCalledWith(JSON.stringify({ event: 'security.audit_completion_failed', auditId: 'event-id' }))
  })
})
