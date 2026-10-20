import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ query: vi.fn(), mailbox: vi.fn(), gmail: vi.fn(), entity: vi.fn(), visible: vi.fn(), refresh: vi.fn(), audit: vi.fn(), manages: vi.fn(), admin: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: m.query } }))
vi.mock('./store.js', () => ({ loadEmailMailbox: m.mailbox, emailEvent: m.audit, inTransaction: async (fn: any) => fn({ query: m.query }) }))
vi.mock('./access.js', async original => ({ ...await original<typeof import('./access.js')>(), assertEmailAction: vi.fn(), emailActionAllowed: () => true, assertEmailEntity: m.entity, visibleEmailEntity: m.visible, refreshEmailActor: m.refresh, managesEmailOwner: m.manages }))
vi.mock('../auth/rbac/systemAdminOnly.js', () => ({ isSystemAdminEmail: m.admin }))
vi.mock('./gmail.js', async original => ({ ...await original<typeof import('./gmail.js')>(), gmailFor: m.gmail }))
import { authorizeEmailMailbox, authorizedEmailRelationships, contextEmails, recheckEmailAccess } from './service.js'
import type { EmailActor } from './access.js'
import { gmailMessage } from './gmail.js'
const actor = { email: 'me@amnex.com' } as EmailActor
const box = { id: 'mine', owner_email: actor.email, provider_email: actor.email, status: 'connected', credentials: {}, credential_revision: 'v1' } as any
const entity = { type: 'opportunity', id: 'opp' }
const msg = gmailMessage({ id: 'my-message', threadId: 'my-thread', internalDate: '1792404000000', payload: { headers: [{ name: 'Message-ID', value: '<delivered@example.com>' }] } })
const link = { id: 'link', mailbox_id: 'theirs', owner_email: 'colleague@amnex.com', item_kind: 'message', item_id: 'their-message', entity_type: 'opportunity', entity_id: 'opp', created_at: new Date(), internet_id: '<delivered@example.com>', participant_visible: true }
beforeEach(() => { vi.clearAllMocks(); m.query.mockResolvedValue({ rows: [] }); m.mailbox.mockResolvedValue(box); m.entity.mockResolvedValue(entity); m.visible.mockImplementation((_actor, ref) => Promise.resolve(ref.id === 'restricted' ? null : { ...ref, title: 'Allowed', path: '/allowed' })); m.refresh.mockResolvedValue(actor); m.manages.mockResolvedValue(false); m.admin.mockReturnValue(true) })
describe('mailbox isolation and recipient copies', () => {
  it('denies a colleague mailbox even to a portal admin without an explicit live grant', async () => {
    m.mailbox.mockResolvedValue({ ...box, owner_email: 'other@amnex.com' })
    await expect(authorizeEmailMailbox(actor, box.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(authorizeEmailMailbox(actor, box.id, { supervisor: true })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(m.gmail).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled()
  })
  it('checks approved scope, download permission and live reporting lines before privileged access', async () => {
    m.mailbox.mockResolvedValue({ ...box, owner_email: 'other@amnex.com' }); m.query.mockResolvedValue({ rows: [{ id: 'grant', kind: 'hod', allow_download: false }] })
    await expect(authorizeEmailMailbox(actor, box.id, { supervisor: true, entity })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    m.manages.mockResolvedValue(true)
    await authorizeEmailMailbox(actor, box.id, { supervisor: true, entity })
    expect(m.audit).toHaveBeenCalledWith(actor, 'supervisory_access', expect.objectContaining({ grantId: 'grant', entity }))
    await expect(authorizeEmailMailbox(actor, box.id, { supervisor: true, entity, action: 'download' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('maps a shared individual-message link to the delivered message and redacts restricted records', async () => {
    m.query.mockResolvedValue({ rows: [link, { ...link, id: 'secret', entity_id: 'restricted' }] })
    const links = await authorizedEmailRelationships(actor, box, { mailboxId: 'mine', kind: 'thread', id: 'my-thread' }, [msg])
    expect(links).toHaveLength(1)
    expect(links[0].item).toEqual({ mailboxId: 'mine', kind: 'message', id: 'my-message' })
    expect(JSON.stringify(links)).not.toMatch(/colleague@|their-message|restricted/)
  })
  it('never reads a source mailbox when the recipient has no delivered copy', async () => {
    m.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...link, item_kind: 'thread' }] })
    const request = vi.fn().mockResolvedValue({ messages: [] }); const conversation = vi.fn(); m.gmail.mockReturnValue({ request, conversation })
    expect((await contextEmails(actor, entity, ['mine'])).items).toEqual([])
    expect(m.gmail).toHaveBeenCalledExactlyOnceWith(box)
    expect(conversation).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(expect.stringContaining('rfc822msgid'))
  })
  it('rejects data fetched before a mailbox disconnect/reconnect changes its credentials', async () => {
    m.mailbox.mockResolvedValue({ ...box, credential_revision: 'v2' })
    await expect(recheckEmailAccess(actor, box)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
