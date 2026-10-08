import type { CorrigendumAffectedModule } from '@goms/domain'
import type { BidCorrigendum } from '@/lib/types'
import type { CorrigendumChangeInput, CreateCorrigendumInput } from './model'

/** QA fixture: an original tender plus C1 and C2. Covers one PQ, one
 *  manpower, one milestone/date, one payment-term and one BoQ quantity change,
 *  and C2 re-modifies the submission date C1 already moved. Used by the tests
 *  and by the dev-only "Load sample corrigenda" action (local mode). */

export const SAMPLE_ORIGINAL_TENDER: Record<string, { title: string; module: CorrigendumAffectedModule; text: string }> = {
  'pq.turnover': {
    title: 'PQ 2.1 — Average Annual Turnover', module: 'pq',
    text: 'The bidder shall have an average annual turnover of ₹100 Crore from ITS / Smart City projects over the last three financial years.',
  },
  'manpower.pm': {
    title: 'Key Personnel — Project Manager', module: 'manpower',
    text: 'Project Manager: 1 No., B.E./B.Tech with MBA, minimum 15 years of experience including 2 ITS projects.',
  },
  'dates.submission': {
    title: 'Bid Submission End Date', module: 'dates',
    text: 'Bid submission end date: 15 Oct 2026, 15:00 hrs.',
  },
  'payment.golive': {
    title: 'Payment Schedule — Go-Live', module: 'payment_terms',
    text: '40% of CAPEX on Go-Live; balance 60% in equal quarterly instalments over 5 years of O&M.',
  },
  'boq.cctv': {
    title: 'BoQ Item 3.4 — CCTV Cameras', module: 'boq',
    text: 'Supply, installation and commissioning of 500 Nos. of 4MP IP bullet cameras.',
  },
}

const T = SAMPLE_ORIGINAL_TENDER
const clause = (key: string, before: string, after: string, extra: Omit<CorrigendumChangeInput, 'fieldKey' | 'currentValue' | 'proposedValue'>): CorrigendumChangeInput => ({
  fieldKey: key, currentValue: before, proposedValue: after, kind: 'clause',
  clauseTitle: T[key].title, affectedModule: T[key].module, ...extra,
})

export const SAMPLE_C1_DATE = 'Bid submission end date: 30 Oct 2026, 15:00 hrs.'
export const SAMPLE_C1_TURNOVER = T['pq.turnover'].text.replace('₹100 Crore', '₹75 Crore')

export const sampleC1 = (bidId: string): CreateCorrigendumInput => ({
  bidId, corrigendumNumber: 1,
  register: {
    publishedDate: '2026-09-22', receivedDate: '2026-09-23', effectiveDate: '2026-09-22',
    affectedSections: ['pq', 'manpower', 'dates'], impactLevel: 'high',
    technicalImpact: true, commercialImpact: false, bidDateImpact: true, submissionDateImpact: true,
    reviewStatus: 'reviewed', remarks: 'Turnover relaxed after pre-bid representations; submission extended by 15 days.',
  },
  changes: [
    clause('pq.turnover', T['pq.turnover'].text, SAMPLE_C1_TURNOVER, {
      classification: 'qualification_relaxed', impactLevel: 'high', sourceRef: 'Corrigendum 01, Page 2, Sl. 1',
    }),
    clause('manpower.pm', T['manpower.pm'].text, T['manpower.pm'].text.replace('minimum 15 years', 'minimum 12 years'), {
      classification: 'qualification_relaxed', impactLevel: 'medium', sourceRef: 'Corrigendum 01, Page 3, Sl. 4',
    }),
    clause('dates.submission', T['dates.submission'].text, SAMPLE_C1_DATE, {
      classification: 'date_changed', impactLevel: 'high', sourceRef: 'Corrigendum 01, Page 1, Sl. 0',
    }),
  ],
})

export const SAMPLE_C2_DATE = 'Bid submission end date: 14 Nov 2026, 15:00 hrs.'

export const sampleC2 = (bidId: string): CreateCorrigendumInput => ({
  bidId, corrigendumNumber: 2,
  register: {
    publishedDate: '2026-10-14', receivedDate: '2026-10-14', effectiveDate: '2026-10-15',
    affectedSections: ['dates', 'payment_terms', 'boq'], impactLevel: 'high',
    technicalImpact: true, commercialImpact: true, bidDateImpact: true, submissionDateImpact: true,
    reviewStatus: 'action_required', remarks: 'Re-price BoQ for the added cameras; revisit cash-flow for the new payment split.',
  },
  changes: [
    // Re-modifies the clause C1 already changed — C1's value is the "before".
    clause('dates.submission', SAMPLE_C1_DATE, SAMPLE_C2_DATE, {
      classification: 'date_changed', impactLevel: 'high', sourceRef: 'Corrigendum 02, Page 1, Sl. 1',
    }),
    clause('payment.golive', T['payment.golive'].text, '30% of CAPEX on Go-Live; balance 70% in equal quarterly instalments over 5 years of O&M.', {
      classification: 'commercial_changed', impactLevel: 'critical', sourceRef: 'Corrigendum 02, Page 4, Clause 18.2',
    }),
    clause('boq.cctv', T['boq.cctv'].text, T['boq.cctv'].text.replace('500 Nos.', '750 Nos.'), {
      classification: 'quantity_changed', impactLevel: 'high', sourceRef: 'Corrigendum 02, Annexure B, Item 3.4',
    }),
  ],
})

type Creator = (input: CreateCorrigendumInput) => Promise<BidCorrigendum>

/** Records C1 then C2 on one bid. Refuses a bid that already has corrigenda,
 *  so the sample can never mix into (or collide with) real records. */
export async function loadSampleCorrigenda(
  bidId: string, existing: readonly Pick<BidCorrigendum, 'id'>[], create: Creator,
): Promise<BidCorrigendum[]> {
  if (existing.length) throw new Error('This bid already has corrigenda — load the sample on a bid without any.')
  const c1 = await create(sampleC1(bidId))
  const c2 = await create(sampleC2(bidId))
  return [c1, c2]
}
