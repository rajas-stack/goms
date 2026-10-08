import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A tiny stand-in for the two corrigendum tables: every row is stored as a
 *  JSON string (like a DB round trip) and read back on each query, so the
 *  tests below exercise the router's real SQL + mapping end to end without a
 *  live Postgres. Only the statements this router issues are understood. */
const store = vi.hoisted(() => ({ corrigenda: new Map<string, string>(), changes: new Map<string, string>(), seq: 0, audit: 0 }))
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { bidCorrigendaRouter } from './bidCorrigenda.js'

const bidId = '00000000-0000-4000-8000-0000000000b1'
const uuid = () => `00000000-0000-4000-8000-${String(++store.seq).padStart(12, '0')}`
const rows = (m: Map<string, string>) => [...m.values()].map((v) => JSON.parse(v))
const save = (m: Map<string, string>, row: any) => { m.set(row.id, JSON.stringify(row)); return row }

async function fakeQuery(sql: string, params: any[] = []) {
  const s = sql.replace(/\s+/g, ' ').trim()
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s)) return { rows: [] }
  if (s.startsWith('INSERT INTO commercial_audit_logs')) { store.audit++; return { rows: [] } }
  if (s.startsWith('UPDATE bids')) return { rows: [] }
  if (s.startsWith('INSERT INTO bid_corrigenda')) {
    const dup = rows(store.corrigenda).some((r) => r.bid_id === params[0] && r.corrigendum_number === params[1])
    if (dup) throw Object.assign(new Error('dup'), { code: '23505' })
    return { rows: [save(store.corrigenda, {
      id: uuid(), bid_id: params[0], corrigendum_number: params[1], source_document_id: params[2], detected_at: '2026-10-08T00:00:00.000Z',
      reviewed_at: null, reviewed_by: null, published_date: null, received_date: null, effective_date: null, affected_sections: [],
      impact_level: 'medium', technical_impact: false, commercial_impact: false, bid_date_impact: false, submission_date_impact: false,
      review_owner_id: null, review_status: 'pending', remarks: '',
    })] }
  }
  const setMatch = s.match(/^UPDATE bid_corrigenda SET (.+) WHERE id=\$1 RETURNING \*$/)
  if (setMatch) {
    const row = rows(store.corrigenda).find((r) => r.id === params[0])
    if (!row) return { rows: [] }
    const next = { ...row }
    for (const part of setMatch[1].split(', ')) {
      const [col, ref] = part.split('=')
      next[col] = params[Number(ref.slice(1)) - 1]
    }
    return { rows: [save(store.corrigenda, next)] }
  }
  if (s.startsWith('INSERT INTO bid_corrigendum_changes')) {
    const [corrigendumId, fieldKey, currentValue, proposedValue, kind, clauseTitle, module, classification, impact, sourceRef] = params
    return { rows: [save(store.changes, {
      id: uuid(), corrigendum_id: corrigendumId, field_key: fieldKey, current_value: currentValue, proposed_value: proposedValue,
      decision: 'pending', decided_at: null, decided_by: null, kind, clause_title: clauseTitle, affected_module: module,
      classification, impact_level: impact, source_ref: sourceRef, created_at: store.seq,
    })] }
  }
  if (s.startsWith('SELECT * FROM bid_corrigenda WHERE bid_id=$1')) {
    return { rows: rows(store.corrigenda).filter((r) => r.bid_id === params[0]).sort((a, b) => a.corrigendum_number - b.corrigendum_number) }
  }
  if (s.startsWith('SELECT * FROM bid_corrigenda WHERE id=$1')) return { rows: rows(store.corrigenda).filter((r) => r.id === params[0]) }
  if (s.startsWith('SELECT * FROM bid_corrigendum_changes WHERE corrigendum_id=$1')) {
    return { rows: rows(store.changes).filter((r) => r.corrigendum_id === params[0]).sort((a, b) => a.created_at - b.created_at) }
  }
  if (s.startsWith('SELECT * FROM bid_corrigendum_changes WHERE id=$1')) return { rows: rows(store.changes).filter((r) => r.id === params[0]) }
  if (s.startsWith('UPDATE bid_corrigendum_changes SET decision=$1')) {
    const row = rows(store.changes).find((r) => r.id === params[2])
    save(store.changes, { ...row, decision: params[0], decided_at: '2026-10-08T00:00:00.000Z', decided_by: params[1] })
    return { rows: [] }
  }
  if (s.startsWith('SELECT 1 FROM bid_corrigendum_changes')) {
    return { rows: rows(store.changes).filter((r) => r.corrigendum_id === params[0] && r.decision === 'pending') }
  }
  if (s.startsWith('UPDATE bid_corrigenda SET reviewed_at')) return { rows: [] }
  if (s.startsWith('SELECT 1 FROM bid_milestones')) return { rows: [] }
  throw new Error(`Unexpected SQL in test: ${s}`)
}

const caller = () => bidCorrigendaRouter.createCaller({ user: { email: 'bids@amnex.com', isAmnexAccount: true, emailVerified: true } } as any)
const ORIGINAL = 'Bid submission end date: 15 Oct 2026, 15:00 hrs.'
const C1 = 'Bid submission end date: 30 Oct 2026, 15:00 hrs.'
const C2 = 'Bid submission end date: 14 Nov 2026, 15:00 hrs.'
const dateClause = (before: string, after: string) => ({
  fieldKey: 'dates.submission', currentValue: before, proposedValue: after, kind: 'clause' as const,
  clauseTitle: 'Bid Submission End Date', affectedModule: 'dates' as const, classification: 'date_changed' as const, impactLevel: 'high' as const,
})

describe('bidCorrigenda register + clause history (API layer)', () => {
  beforeEach(() => {
    store.corrigenda.clear(); store.changes.clear(); store.seq = 0; store.audit = 0
    vi.clearAllMocks()
    db.query.mockImplementation(fakeQuery)
    db.connect.mockResolvedValue({ query: db.query, release: db.release })
  })

  it('persists register fields and clause details, and returns them on a fresh read', async () => {
    await caller().create({
      bidId, corrigendumNumber: 1,
      register: { publishedDate: '2026-09-22', affectedSections: ['pq', 'dates'], impactLevel: 'high', bidDateImpact: true, reviewStatus: 'reviewed', remarks: 'Extended' },
      changes: [
        dateClause(ORIGINAL, C1),
        { fieldKey: 'pq.turnover', currentValue: '₹100 Crore', proposedValue: '₹75 Crore', kind: 'clause', affectedModule: 'pq', classification: 'qualification_relaxed' },
      ],
    })
    const [c1] = await caller().listForBid({ bidId })
    expect(c1).toMatchObject({
      corrigendumNumber: 1, publishedDate: '2026-09-22', affectedSections: ['pq', 'dates'], impactLevel: 'high',
      bidDateImpact: true, technicalImpact: false, reviewStatus: 'reviewed', remarks: 'Extended', status: 'pending_review',
    })
    expect(c1.changes.map((c) => [c.fieldKey, c.kind, c.affectedModule, c.classification])).toEqual([
      ['dates.submission', 'clause', 'dates', 'date_changed'], ['pq.turnover', 'clause', 'pq', 'qualification_relaxed'],
    ])
  })

  it('keeps the original and both versions when C2 re-modifies C1 (history survives reopen)', async () => {
    await caller().create({ bidId, corrigendumNumber: 1, changes: [dateClause(ORIGINAL, C1)] })
    await caller().create({ bidId, corrigendumNumber: 2, changes: [dateClause(C1, C2)] })
    const list = await caller().listForBid({ bidId })
    const versions = list.flatMap((c) => c.changes.filter((ch) => ch.fieldKey === 'dates.submission').map((ch) => [c.corrigendumNumber, ch.currentValue, ch.proposedValue]))
    expect(versions).toEqual([[1, ORIGINAL, C1], [2, C1, C2]])
  })

  it('updates only the register, audit-logs it, and never rewrites change rows', async () => {
    const created = await caller().create({ bidId, corrigendumNumber: 1, changes: [dateClause(ORIGINAL, C1)] })
    const updated = await caller().updateRegister({ corrigendumId: created.id, patch: { reviewStatus: 'closed', reviewOwnerId: 'dtm-7', remarks: 'Done' } })
    expect(updated).toMatchObject({ reviewStatus: 'closed', reviewOwnerId: 'dtm-7', remarks: 'Done' })
    expect(updated.changes).toEqual(created.changes)
    expect(store.audit).toBe(1)
    const sql = db.query.mock.calls.map((c) => String(c[0])).find((q) => q.startsWith('UPDATE bid_corrigenda SET review_'))
    expect(sql).toBe('UPDATE bid_corrigenda SET review_owner_id=$2, review_status=$3, remarks=$4 WHERE id=$1 RETURNING *')
  })

  it('accepting a clause change records the decision without touching milestones or protection', async () => {
    const created = await caller().create({ bidId, corrigendumNumber: 1, changes: [dateClause(ORIGINAL, C1)] })
    const decided = await caller().reviewChange({ changeId: created.changes[0].id, decision: 'accepted' })
    expect(decided.decision).toBe('accepted')
    const sql = db.query.mock.calls.map((c) => String(c[0]))
    expect(sql.some((q) => q.includes('bid_milestones') || q.includes('protected_values'))).toBe(false)
  })

  it('validates input with zod before touching the database', async () => {
    await expect(caller().create({ bidId, corrigendumNumber: 1, register: { impactLevel: 'severe' as any }, changes: [dateClause(ORIGINAL, C1)] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().create({ bidId, corrigendumNumber: 1, register: { publishedDate: '14/10/2026' }, changes: [dateClause(ORIGINAL, C1)] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().create({ bidId, corrigendumNumber: 1, changes: [{ ...dateClause(ORIGINAL, C1), affectedModule: 'finance' as any }] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().updateRegister({ corrigendumId: 'not-a-uuid', patch: {} })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.connect).not.toHaveBeenCalled()
  })

  it('rejects the same clause twice in one corrigendum and rolls back', async () => {
    await expect(caller().create({ bidId, corrigendumNumber: 1, changes: [dateClause(ORIGINAL, C1), dateClause(ORIGINAL, C2)] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
    expect(store.corrigenda.size).toBe(0)
  })

  it('reads legacy milestone change rows (pre-migration defaults) as Dates field changes', async () => {
    await caller().create({ bidId, corrigendumNumber: 1, changes: [{ fieldKey: 'tenderLink', currentValue: '', proposedValue: 'https://x' }] })
    const [c] = await caller().listForBid({ bidId })
    expect(c.changes[0]).toMatchObject({ kind: 'field', clauseTitle: 'Tender Link', affectedModule: 'other', classification: 'modified' })
  })
})
