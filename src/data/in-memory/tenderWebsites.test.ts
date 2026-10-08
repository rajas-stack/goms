import { beforeEach, describe, expect, it } from 'vitest'
import { isHttpUrl } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'

describe('tender websites (local store)', () => {
  beforeEach(async () => { await resetLocalData() })

  it('accepts only absolute http(s) links', () => {
    expect(isHttpUrl('https://eproc.example.gov.in/nicgep')).toBe(true)
    expect(isHttpUrl('http://gem.gov.in')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('ftp://x.example.com')).toBe(false)
    expect(isHttpUrl('eproc.gov.in')).toBe(false)
  })

  it('creates, lists by name, updates and deletes websites', async () => {
    const gem = await repository.createTenderWebsite({ name: ' GeM ', url: 'https://gem.gov.in' })
    await repository.createTenderWebsite({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })
    expect((await repository.listTenderWebsites()).map(site => site.name)).toEqual(['E-Proc', 'GeM'])
    const renamed = await repository.updateTenderWebsite(gem.id, { name: 'GeM portal', url: 'https://gem.gov.in/' })
    expect(renamed).toMatchObject({ id: gem.id, name: 'GeM portal', url: 'https://gem.gov.in/' })
    await repository.deleteTenderWebsite(gem.id)
    expect((await repository.listTenderWebsites()).map(site => site.name)).toEqual(['E-Proc'])
  })

  it('rejects bad links, blank names and duplicate names', async () => {
    await expect(repository.createTenderWebsite({ name: 'Bad', url: 'javascript:alert(1)' })).rejects.toThrow(/http/)
    await expect(repository.createTenderWebsite({ name: '  ', url: 'https://ok.example.com' })).rejects.toThrow(/name/)
    await repository.createTenderWebsite({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })
    await expect(repository.createTenderWebsite({ name: 'e-proc', url: 'https://other.example.com' })).rejects.toThrow(/already exists/)
    expect(await repository.listTenderWebsites()).toHaveLength(1)
  })

  it('persists the edit lock and prevents changes until editing is unlocked', async () => {
    const credentials = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    const site = await repository.createTenderWebsite({ name: 'Portal', url: 'https://portal.example', credentials })
    await repository.setTenderWebsiteEditingLock(site.id, true)
    await expect(repository.updateTenderWebsite(site.id, { name: 'Changed', url: 'https://changed.example' })).rejects.toThrow('Unlock editing')
    expect((await repository.listTenderWebsites())[0]).toMatchObject({ name: 'Portal', editingLocked: true, credentials })
    await repository.setTenderWebsiteEditingLock(site.id, false)
    const updated = await repository.updateTenderWebsite(site.id, { name: 'Changed', url: site.url })
    expect(updated).toMatchObject({ name: 'Changed', editingLocked: false, credentials })
  })

  it('validates DSC eligibility and preserves a credential lock when changing only the link', async () => {
    const people = await repository.listOrgPeople()
    const senior = people.find(person => person.level === 0)!
    const junior = people.find(person => person.level === 3)!
    await expect(repository.createTenderWebsite({ name: 'Bad DSC', url: 'https://portal.example', dscEmployeeId: junior.id })).rejects.toThrow(/L0, L1, or L2/)
    const credentials = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    const site = await repository.createTenderWebsite({ name: 'Portal', url: 'https://portal.example', credentials, dscEmployeeId: senior.id })
    const saved = await repository.updateTenderWebsite(site.id, { name: site.name, url: 'https://portal.example/new' })
    expect(saved).toMatchObject({ credentials, dscEmployeeId: senior.id })
    await repository.deleteOrgPerson(senior.id)
    expect((await repository.listTenderWebsites())[0].dscEmployeeId).toBeNull()
  })
})
