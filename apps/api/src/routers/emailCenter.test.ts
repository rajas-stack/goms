import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn(), identities: vi.fn(), mailbox: vi.fn(), event: vi.fn(), actor: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: m.query } }))
vi.mock('../email/access.js', async original => ({ ...await original<typeof import('../email/access.js')>(), emailActor: m.actor, visibleEmailEntity: vi.fn(async () => null), assertEmailAction: vi.fn(), assertEmailEntity: vi.fn() }))
vi.mock('../email/service.js', async original => ({ ...await original<typeof import('../email/service.js')>(), authorizeEmailMailbox: m.mailbox, recheckEmailAccess: vi.fn() }))
vi.mock('../email/store.js', () => ({ loadEmailMailbox: m.mailbox, emailEvent: m.event, inTransaction: async (fn: any) => fn({ query: m.query }) }))
vi.mock('../email/gmail.js', async original => ({ ...await original<typeof import('../email/gmail.js')>(), gmailFor: () => ({ identities: m.identities, request: m.request }) }))
import { emailCenterRouter } from './emailCenter.js'
const boxId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const box = { id: boxId, owner_email: 'me@amnex.com' }
const input = { mailboxId: boxId, from: box.owner_email, to: ['client@example.com'], cc: [], bcc: [], subject: 'Tender', text: 'Hello', attachments: [], requestId, confirmed: true as const }
const caller = () => emailCenterRouter.createCaller({ authHeader: 'Bearer app-session' })
beforeEach(() => { vi.clearAllMocks(); m.actor.mockResolvedValue({ email: box.owner_email }); m.mailbox.mockResolvedValue(box); m.identities.mockResolvedValue([{ email: box.owner_email }]); m.query.mockResolvedValue({ rows: [{ request_id: requestId }] }); m.request.mockResolvedValue({ id: 'sent1' }) })
describe('explicit and duplicate-safe Gmail writes', () => {
  it('requires explicit send confirmation and never accepts client OAuth tokens', async () => {
    await expect(caller().send({ ...input, confirmed: false } as any)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().send({ ...input, accessToken: 'forbidden' } as any)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(m.request).not.toHaveBeenCalled()
  })
  it('uses only verified Gmail send-as identities', async () => {
    await expect(caller().send({ ...input, from: 'spoof@amnex.com' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(m.request).not.toHaveBeenCalled()
  })
  it('sends once and returns the recorded message for a repeated request', async () => {
    expect(await caller().send(input)).toEqual({ messageId: 'sent1' })
    m.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ status: 'sent', provider_message_id: 'sent1' }] })
    expect(await caller().send(input)).toEqual({ messageId: 'sent1' })
    expect(m.request).toHaveBeenCalledOnce()
    expect(m.request).toHaveBeenCalledWith('messages/send', 'POST', expect.any(Object))
  })
  it('does not retry an ambiguous send, and blocks resubmission until Sent is checked', async () => {
    m.request.mockRejectedValueOnce(new Error('Network interrupted'))
    await expect(caller().send(input)).rejects.toThrow('Network interrupted')
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("status='unknown'"), [boxId, requestId])
    m.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ status: 'unknown' }] })
    await expect(caller().send(input)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(m.request).toHaveBeenCalledOnce()
  })
  it('refuses to overwrite a draft edited in Gmail since it was opened', async () => {
    m.request.mockResolvedValue({ message: { id: 'new-version', threadId: 't1', internalDate: '1792404000000' } })
    await expect(caller().saveDraft({ ...input, confirmed: undefined, draftId: 'draft1', draftMessageId: 'old-version' } as any)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const { confirmed, ...draft } = input
    await expect(caller().saveDraft({ ...draft, draftId: 'draft1', draftMessageId: 'old-version' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(m.request.mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true)
  })
  it('retains revocation controls without exposing a record scope after access is removed', async () => {
    m.query.mockResolvedValue({ rows: [{ id: requestId, mailbox_id: boxId, provider_email: box.owner_email, owner_email: box.owner_email, grantee: 'supervisor@amnex.com', kind: 'hod', entity_type: 'opportunity', entity_id: 'restricted-opportunity', expires_at: new Date(), created_at: new Date(), status: 'approved' }] })
    const grants = await caller().grants()
    expect(grants[0]).toMatchObject({ id: requestId, entity: null, scopeUnavailable: true })
    expect(JSON.stringify(grants)).not.toContain('restricted-opportunity')
  })

})
