import { describe, expect, it } from 'vitest'
import { BID_STAGES, bidStageChangeError, builtInBidStageFor, isAtOrAfterSubmitted, resolveBidStages } from './bids.js'
import { bidTrackerMasterSeed } from './bidTrackerFields.js'

const seed = bidTrackerMasterSeed('bidStages').map(([code, name], displayOrder) => ({ code, name, active: true, displayOrder }))
// "Under Evaluation" added after Submitted, "Site Survey" after Qualification (orders 1.5 / 4.5 sit between neighbours).
const rows = [...seed, { code: 'Under Evaluation', name: 'Under Evaluation', active: true, displayOrder: 4.5 }, { code: 'Site Survey', name: 'Site Survey', active: false, displayOrder: 1.5 }]

describe('user-extendable bid stages', () => {
  it('seeds the built-in stages and resolves to BID_STAGES before the master loads', () => {
    expect(seed.map(r => r.code)).toEqual(BID_STAGES.map(s => s.key))
    expect(resolveBidStages([]).map(s => [s.key, s.label, s.order, s.closed])).toEqual(BID_STAGES.map(s => [s.key, s.label, s.order, s.closed]))
  })

  it('orders built-in and added stages by the master, keeping built-in rules', () => {
    const stages = resolveBidStages(rows.map(r => (r.code === 'submitted' ? { ...r, name: 'Bid Submitted', active: false } : r)))
    expect(stages.map(s => s.key)).toEqual(['solutioning', 'qualification', 'Site Survey', 'preBidQueries', 'commercialProposal', 'submitted', 'Under Evaluation', 'goApproved', 'dropped'])
    const submitted = stages.find(s => s.key === 'submitted')!
    expect([submitted.label, submitted.active, submitted.builtIn]).toEqual(['Bid Submitted', true, true])
    expect(stages.find(s => s.key === 'Site Survey')).toMatchObject({ active: false, builtIn: false, closed: false })
  })

  it('reads an added stage as the open built-in stage before it (Go gate, timeline)', () => {
    const stages = resolveBidStages(rows)
    expect(builtInBidStageFor('Site Survey', stages)).toBe('qualification')
    expect(builtInBidStageFor('Under Evaluation', stages)).toBe('submitted')
    expect(builtInBidStageFor('unknown', stages)).toBe('solutioning')
    expect(isAtOrAfterSubmitted('Under Evaluation', stages)).toBe(true)
    expect(isAtOrAfterSubmitted('Site Survey', stages)).toBe(false)
    expect(isAtOrAfterSubmitted('Under Evaluation')).toBe(false)
    expect(isAtOrAfterSubmitted('submitted')).toBe(true)
    expect(isAtOrAfterSubmitted('commercialProposal', stages)).toBe(false)
  })

  it('locks codes and built-in stages; an added stage some bid is at cannot be deleted', () => {
    const goApproved = { code: 'goApproved', name: 'Go Approved' }
    const added = { code: 'Under Evaluation', name: 'Under Evaluation' }
    expect(bidStageChangeError(goApproved, { remove: true })).toMatch(/can't be deleted/)
    expect(bidStageChangeError(goApproved, { active: false })).toMatch(/can't be deactivated/)
    expect(bidStageChangeError(goApproved, { code: 'go' })).toMatch(/code can't change/)
    expect(bidStageChangeError(goApproved, { code: 'goApproved', active: true })).toBeNull()
    expect(bidStageChangeError(added, { remove: true, inUse: 2 })).toMatch(/stage of 2 bids/)
    expect(bidStageChangeError(added, { remove: true, inUse: 0 })).toBeNull()
    expect(bidStageChangeError(added, { active: false })).toBeNull()
  })
})
