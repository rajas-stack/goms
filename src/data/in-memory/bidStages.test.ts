import { beforeEach, describe, expect, it } from 'vitest'
import { BID_STAGES } from '@goms/domain'
import { getFullSnapshot, repository, resetLocalData, restoreFromBackup } from '@/data/repository'

const stages = () => repository.listMaster('bidStages')
const addStage = (name: string, displayOrder: number) =>
  repository.createMaster('bidStages', { code: name, name, description: '', active: true, displayOrder } as never)
async function newBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus', submissionDate: '2099-01-15' })
  return repository.createBid(opp.id)
}

describe('Bid Stages master (browser store)', () => {
  beforeEach(async () => { await resetLocalData() })

  it('seeds the built-in stages, also into a snapshot saved before Bid Stages existed', async () => {
    expect((await stages()).map(s => s.code)).toEqual(BID_STAGES.map(s => s.key))
    const old = structuredClone(getFullSnapshot())
    delete (old.commercialCalculator.masters as Record<string, unknown>).bidStages
    restoreFromBackup(old)
    expect((await stages()).map(s => s.name)).toEqual(BID_STAGES.map(s => s.label))
  })

  it('keeps built-in stages and every code; an added stage some bid is at cannot be deleted', async () => {
    const goApproved = (await stages()).find(s => s.code === 'goApproved')!
    await expect(repository.deleteMaster('bidStages', goApproved.id)).rejects.toThrow("can't be deleted")
    await expect(repository.setMasterActive('bidStages', goApproved.id, false)).rejects.toThrow("can't be deactivated")
    await expect(repository.updateMaster('bidStages', goApproved.id, { code: 'go' })).rejects.toThrow("code can't change")
    expect((await repository.updateMaster('bidStages', goApproved.id, { name: 'Won', displayOrder: 9 })).name).toBe('Won')

    const added = await addStage('Under Evaluation', 5)
    const bid = await newBid()
    await repository.updateBid(bid.id, { stageKey: 'Under Evaluation' })
    await expect(repository.deleteMaster('bidStages', added.id)).rejects.toThrow('stage of 1 bid')
    await repository.setMasterActive('bidStages', added.id, false)
    await repository.updateBid(bid.id, { stageKey: 'solutioning' })
    await repository.deleteMaster('bidStages', added.id)
    expect((await stages()).some(s => s.id === added.id)).toBe(false)
  })

  it('allows Go from an added stage placed after Submitted, not from one before it', async () => {
    await addStage('Site Survey', 0.5)
    await addStage('Under Evaluation', 4.5)
    const bid = await newBid()
    await repository.updateBid(bid.id, { stageKey: 'Site Survey' })
    await expect(repository.updateBid(bid.id, { decision: 'go' })).rejects.toThrow(/before the bid reaches Submitted/)
    await repository.updateBid(bid.id, { stageKey: 'Under Evaluation' })
    expect((await repository.updateBid(bid.id, { decision: 'go' })).stageKey).toBe('goApproved')
  })
})
