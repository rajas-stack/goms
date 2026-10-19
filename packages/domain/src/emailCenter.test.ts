import { describe, expect, it } from 'vitest'
import { replyRecipients, type EmailMessage } from './emailCenter.js'
const message: EmailMessage = { id: 'm', threadId: 't', subject: 'Bid', date: '2026-10-19T12:00:00Z', from: [{ email: 'client@example.com', name: 'Client' }], replyTo: [], to: [{ email: 'me@amnex.com', name: 'Me' }, { email: 'colleague@amnex.com', name: 'Colleague' }], cc: [{ email: 'colleague@amnex.com', name: 'Colleague' }, { email: 'oem@vendor.com', name: 'OEM' }], bcc: [{ email: 'private@amnex.com', name: 'Private' }], text: 'Please ask other@amnex.com as well.', snippet: '', labels: [], attachments: [], internetId: '<m@example.com>', references: '' }
describe('recipient-directed correspondence', () => {
  it('uses actual headers for reply-all, excluding the sender’s own identities and all Bcc recipients', () => {
    expect(replyRecipients(message, ['me@amnex.com'], true)).toEqual({ to: ['client@example.com', 'colleague@amnex.com'], cc: ['oem@vendor.com'], bcc: [] })
  })
  it('does not infer recipients or permissions from names and addresses in the body', () => {
    expect(replyRecipients(message, ['me@amnex.com'], true).to).not.toContain('other@amnex.com')
    expect(replyRecipients(message, ['me@amnex.com'], false)).toEqual({ to: ['client@example.com'], cc: [], bcc: [] })
  })
  it('honors the original authenticated message Reply-To header', () => {
    expect(replyRecipients({ ...message, replyTo: [{ email: 'reply@example.com', name: '' }] }, ['me@amnex.com'], false).to).toEqual(['reply@example.com'])
  })
})
