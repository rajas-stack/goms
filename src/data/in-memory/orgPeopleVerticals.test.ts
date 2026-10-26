import { beforeEach, describe, expect, it } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

describe('Org people verticals (browser store)', () => {
  beforeEach(async () => { await resetLocalData() })

  it('round-trips verticals through create, update and list; people saved without them read as none', async () => {
    const seeded = (await repository.listOrgPeople())[0]
    expect(seeded.verticals ?? []).toEqual([])

    const created = await repository.createOrgPerson({ name: 'Vera Tical', level: 4, verticals: ['Traffic', 'Traffic', 'Data Fabric & AI'] })
    expect(created.verticals).toEqual(['Traffic', 'Data Fabric & AI'])
    await repository.updateOrgPerson(created.id, { designation: 'Lead' })
    expect((await repository.listOrgPeople()).find((p) => p.id === created.id)?.verticals).toEqual(['Traffic', 'Data Fabric & AI'])

    await repository.updateOrgPerson(created.id, { verticals: ['Transit (Mobility)'] })
    expect((await repository.listOrgPeople()).find((p) => p.id === created.id)?.verticals).toEqual(['Transit (Mobility)'])
  })
})
