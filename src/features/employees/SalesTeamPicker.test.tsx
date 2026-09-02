import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '@/lib/api'
import { SalesTeamPicker } from './SalesTeamPicker'
import type { SalesPerson } from '@/lib/types'

// The hosted E2E suite (e2e/26-task-enhancements.spec.ts) found that every
// SalesTeamPicker instance announces the same hardcoded aria-label
// regardless of context — a screen reader user editing "Reporting Manager
// (RM)" hears "Relationship owner / AMNEX representative" instead. These
// tests drive the real (unmocked) Combobox's accessible name directly,
// rather than through a mocked parent dialog, since every existing caller's
// test file replaces SalesTeamPicker with a bare mock.

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: '', name: 'Alice', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', notes: '', metadata: {}, createdAt: '', createdBy: null,
}

function stubApiHooks() {
  vi.spyOn(api, 'useSalesPersons').mockReturnValue(
    { data: [ALICE] } as unknown as ReturnType<typeof api.useSalesPersons>,
  )
  vi.spyOn(api, 'useCurrentPostings').mockReturnValue(
    { data: {} } as unknown as ReturnType<typeof api.useCurrentPostings>,
  )
}

describe('SalesTeamPicker — configurable accessible name', () => {
  it('defaults to "Relationship owner / AMNEX representative" when no ariaLabel is given', () => {
    stubApiHooks()
    render(<SalesTeamPicker value="" onChange={() => {}} />)

    expect(screen.getByLabelText('Relationship owner / AMNEX representative')).toBeInTheDocument()
  })

  it('uses the given ariaLabel for the Reporting Manager (RM) context', () => {
    stubApiHooks()
    render(<SalesTeamPicker value="" onChange={() => {}} ariaLabel="Reporting Manager (RM)" />)

    expect(screen.getByLabelText('Reporting Manager (RM)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Relationship owner / AMNEX representative')).not.toBeInTheDocument()
  })

  it('uses the given ariaLabel for the Sales person context', () => {
    stubApiHooks()
    render(<SalesTeamPicker value="" onChange={() => {}} ariaLabel="Sales person" />)

    expect(screen.getByLabelText('Sales person')).toBeInTheDocument()
  })
})
