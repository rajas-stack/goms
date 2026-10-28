import { describe, expect, it, vi } from 'vitest'
import { WhatsAppError, chatPhone, formatPhone, mentionIdsOf, oneAtATime, retryRead, sessionName, withMentionNames, type WhatsAppMessage } from './api'

describe('formatPhone', () => {
  it.each([
    ['917358769276', '+91 73587 69276'],
    ['14155550123', '+1 415-555-0123'],
    ['442079460958', '+44 207 946 0958'],
    ['971501234567', '+971 501 234 567'],
    ['+65 9123 4567', '+65 912 345 67'],
  ])('%s → %s', (raw, shown) => expect(formatPhone(raw)).toBe(shown))
  it('leaves what is not a phone number as plain digits', () => {
    expect(formatPhone('12345')).toBe('+12345')
    expect(chatPhone('102404972400823@lid')).toBe('+102404972400823')
    expect(chatPhone('917358769276@c.us')).toBe('+91 73587 69276')
  })
})

describe('retryRead', () => {
  const sleep = vi.fn(async (_ms: number) => {})
  it('retries passing failures (timeout, 503, engine not ready) until the read succeeds', async () => {
    const read = vi.fn().mockRejectedValueOnce(new WhatsAppError('slow', 0)).mockRejectedValueOnce(new WhatsAppError('down', 503))
      .mockRejectedValueOnce(new WhatsAppError('not ready', 409)).mockResolvedValue(['ok'])
    await expect(retryRead(read, 45_000, sleep)).resolves.toEqual(['ok'])
    expect(read).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000])
  })
  it('fails at once on a lasting error such as 404', async () => {
    const read = vi.fn().mockRejectedValue(new WhatsAppError('no chat', 404))
    await expect(retryRead(read, 45_000, sleep)).rejects.toThrow('no chat')
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('waits as long as a rate limit asks before retrying', async () => {
    const wait = vi.fn(async (_ms: number) => {})
    const read = vi.fn().mockRejectedValueOnce(new WhatsAppError('busy', 429, 30_000)).mockResolvedValue('ok')
    await expect(retryRead(read, 180_000, wait)).resolves.toBe('ok')
    expect(wait).toHaveBeenCalledWith(30_000)
  })
  it('runs media jobs one at a time, in order, and keeps going after a failure', async () => {
    const log: string[] = []
    const job = (name: string, fail = false) => () => new Promise<string>((resolve, reject) => {
      log.push(`start ${name}`)
      setTimeout(() => { log.push(`end ${name}`); if (fail) reject(new Error(name)); else resolve(name) }, 5)
    })
    const results = await Promise.allSettled([oneAtATime(job('a')), oneAtATime(job('b', true)), oneAtATime(job('c'))])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
  it('gives up when the next wait would pass the budget', async () => {
    const read = vi.fn().mockRejectedValue(new WhatsAppError('down', 503))
    await expect(retryRead(read, 1500, async () => {})).rejects.toThrow('down')
    expect(read).toHaveBeenCalledTimes(2) // waits 1 s, then a 2 s wait would end past 1.5 s
  })
})

describe('sessionName', () => {
  it('gives each company user an OpenWA-valid session name (letters, digits, hyphens; 3-50 chars)', () => {
    for (const email of ['shubham.mehra@amnex.com', 'a_b+c@amnex.com', `${'x'.repeat(80)}@amnex.com`, 'x@amnex.com']) {
      expect(sessionName(email)).toMatch(/^goms-[a-z0-9-]{1,45}$/)
    }
    expect(sessionName('shubham.mehra@amnex.com')).toMatch(/^goms-shubham-mehra-[a-z0-9]+$/)
  })

  it('never puts two users on one WhatsApp link, and is stable per user', () => {
    expect(sessionName('john.doe@amnex.com')).not.toBe(sessionName('john_doe@amnex.com'))
    expect(sessionName('john.doe@amnex.com')).not.toBe(sessionName('john-doe@amnex.com'))
    expect(sessionName(' John.Doe@amnex.com')).toBe(sessionName('john.doe@amnex.com'))
  })
})

describe('mentions', () => {
  it('reads the id objects WhatsApp Web sends and names the mentions it can, keeping the rest', () => {
    const message = { mentionedIds: [{ _serialized: '21947350007867@lid' }, '91504412459142@lid'] } as WhatsAppMessage
    expect(mentionIdsOf(message)).toEqual(['21947350007867@lid', '91504412459142@lid'])
    expect(withMentionNames('@21947350007867 @91504412459142 ok', new Map([['21947350007867', 'Abhinandan']]))).toBe('@Abhinandan @91504412459142 ok')
  })
})
