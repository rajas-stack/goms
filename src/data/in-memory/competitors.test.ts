import { beforeEach, describe, expect, it } from 'vitest'
import { getFullSnapshot, repository, resetLocalData, restoreFromBackup } from '@/data/repository'

describe('competitors (local store)', () => {
  beforeEach(async () => { await resetLocalData() })

  it('creates, lists by name, updates and deletes competitors', async () => {
    const sas = await repository.createCompetitor({ name: ' SAS ', offerings: ['MDM', 'mdm'] })
    await repository.createCompetitor({ name: 'Informatica' })
    expect((await repository.listCompetitors()).map(item => item.name)).toEqual(['Informatica', 'SAS'])
    expect(sas.offerings).toEqual(['MDM'])
    const updated = await repository.updateCompetitor(sas.id, { name: 'SAS Institute', website: 'sas.com' })
    expect(updated).toMatchObject({ id: sas.id, name: 'SAS Institute', website: 'https://sas.com', offerings: [] })
    await repository.deleteCompetitor(sas.id)
    expect((await repository.listCompetitors()).map(item => item.name)).toEqual(['Informatica'])
  })

  it('rejects duplicate names and unknown ids', async () => {
    const sas = await repository.createCompetitor({ name: 'SAS' })
    await expect(repository.createCompetitor({ name: 'sas' })).rejects.toThrow(/already exists/)
    const other = await repository.createCompetitor({ name: 'Oracle' })
    await expect(repository.updateCompetitor(other.id, { name: 'SAS' })).rejects.toThrow(/already exists/)
    await expect(repository.updateCompetitor(sas.id, { name: 'SAS' })).resolves.toMatchObject({ name: 'SAS' })
    await expect(repository.deleteCompetitor('missing')).rejects.toThrow(/no longer exists/)
  })

  it('survives a snapshot round trip and tolerates snapshots without competitors', async () => {
    await repository.createCompetitor({ name: 'SAS' })
    const snapshot = getFullSnapshot()
    restoreFromBackup(JSON.parse(JSON.stringify(snapshot)))
    expect((await repository.listCompetitors()).map(item => item.name)).toEqual(['SAS'])
    const { competitors: _drop, ...legacy } = JSON.parse(JSON.stringify(snapshot))
    restoreFromBackup(legacy)
    expect(await repository.listCompetitors()).toEqual([])
  })
})
