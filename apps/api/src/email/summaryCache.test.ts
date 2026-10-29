import { beforeEach, describe, expect, it } from 'vitest'
import type { EmailSummary } from '@goms/domain'
import { cachedSummary, clearSummaryCache, rememberSummary } from './summaryCache.js'

const summary = (subject: string) => ({ id: 'm1', threadId: 't1', subject, date: '2026-10-28T00:00:00.000Z', from: [], participants: [], snippet: '', labels: [], messageCount: 1 }) as EmailSummary
const box = { id: 'mailbox-a', credential_revision: 'rev-1' }

describe('inbox summary cache', () => {
  beforeEach(() => clearSummaryCache())

  it('reuses a summary only while the thread version (historyId) is unchanged', () => {
    rememberSummary(box, 't1', '100', summary('Hello'))
    expect(cachedSummary(box, 't1', '100')?.subject).toBe('Hello')
    expect(cachedSummary(box, 't1', '101')).toBeUndefined()
    expect(cachedSummary(box, 't1', undefined)).toBeUndefined()
  })

  it('never shares entries across mailboxes or after a reconnect', () => {
    rememberSummary(box, 't1', '100', summary('Hello'))
    expect(cachedSummary({ id: 'mailbox-b', credential_revision: 'rev-1' }, 't1', '100')).toBeUndefined()
    expect(cachedSummary({ ...box, credential_revision: 'rev-2' }, 't1', '100')).toBeUndefined()
  })

  it('keeps at most 5000 entries, dropping the least recently used', () => {
    for (let i = 0; i < 5001; i++) rememberSummary(box, `t${i}`, '1', summary(`s${i}`))
    expect(cachedSummary(box, 't0', '1')).toBeUndefined()
    expect(cachedSummary(box, 't5000', '1')?.subject).toBe('s5000')
  })
})
