import { describe, expect, it } from 'vitest'
import { buildEmailMime, gmailMessage } from './gmail.js'
import type { EmailCompose } from '@goms/domain'
const compose: EmailCompose = { mailboxId: 'box', from: 'me@amnex.com', to: ['client@example.com'], cc: [], bcc: [], subject: 'बोली', text: 'Hello\nworld', attachments: [], requestId: 'request' }
describe('Gmail content and MIME safety', () => {
  it('keeps Unicode, attachments and header syntax intact', () => {
    const data = buildEmailMime({ ...compose, attachments: [{ name: 'quote.pdf', mimeType: 'application/pdf', data: Buffer.from('test document').toString('base64') }] })
    const mime = Buffer.from(data.raw, 'base64url').toString('utf8')
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('बोली').toString('base64')}?=`)
    expect(mime).toContain("filename*=UTF-8''quote.pdf")
    expect(mime).toContain(Buffer.from('Hello\nworld').toString('base64'))
    expect(mime).toContain(Buffer.from('test document').toString('base64'))
    expect(data).not.toHaveProperty('threadId')
  })
  it('rejects header injection and malformed attachment data', () => {
    expect(() => buildEmailMime({ ...compose, subject: 'Hello\r\nBcc: attacker@example.com' })).toThrow('single line')
    expect(() => buildEmailMime({ ...compose, attachments: [{ name: 'x', mimeType: 'text/plain', data: 'not valid!!' }] })).toThrow('invalid file data')
  })
  it('sets reply threading only in the same authorized Gmail mailbox', () => {
    const message = gmailMessage({ id: 'm1', threadId: 'thread1', internalDate: '1792404000000', payload: { headers: [{ name: 'Message-ID', value: '<original@example.com>' }] } })
    const input = { ...compose, reply: { item: { mailboxId: 'box', kind: 'thread' as const, id: 'thread1' }, messageId: 'm1', mode: 'reply' as const } }
    const same = buildEmailMime(input, { message, sameMailbox: true })
    expect(same.threadId).toBe('thread1')
    expect(Buffer.from(same.raw, 'base64url').toString()).toContain('In-Reply-To: <original@example.com>')
    expect(buildEmailMime(input, { message, sameMailbox: false })).not.toHaveProperty('threadId')
    expect(buildEmailMime({ ...input, reply: { ...input.reply, mode: 'forward' } }, { message, sameMailbox: true })).not.toHaveProperty('threadId')
  })
  it('does not load remote HTML, scripts or images when converting mail to text', () => {
    const parsed = gmailMessage({ id: 'm1', threadId: 't1', internalDate: '1792404000000', payload: { mimeType: 'text/html', headers: [{ name: 'From', value: '"Joshi, Shamik" <SHAMIK@AMNEX.COM>' }], body: { data: Buffer.from('<script>steal()</script><p>Hello &amp; welcome</p><img src="https://tracking.example.com">').toString('base64url') } } })
    expect(parsed.text).toBe('Hello & welcome\n')
    expect(parsed.from).toEqual([{ email: 'shamik@amnex.com', name: 'Joshi, Shamik' }])
    expect(parsed.text).not.toMatch(/script|tracking|steal/)
  })
  it('extracts live attachment identifiers without persisting their contents', () => {
    const parsed = gmailMessage({ id: 'm1', threadId: 't1', internalDate: '1792404000000', payload: { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Text').toString('base64url') } }, { partId: '1', mimeType: 'application/pdf', filename: 'RFP.pdf', body: { attachmentId: 'attachment1', size: 42 } }] } })
    expect(parsed.attachments).toEqual([{ id: 'attachment1', partId: '1', messageId: 'm1', name: 'RFP.pdf', mimeType: 'application/pdf', size: 42 }])
    expect(parsed.attachments[0]).not.toHaveProperty('data')
  })
})
