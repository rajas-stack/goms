import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { SessionImportWizard } from './SessionImportWizard'
import { adminImportApi } from './api'
import * as XLSX from 'xlsx'

function renderWizard() {
  const qc = new QueryClient()
  // SessionImportWizard renders a <Link>, which requires a Router context —
  // the plan's own worked example omitted this wrapper and would throw
  // immediately on render; MemoryRouter matches ImportWizard.test.tsx's own
  // established convention for this exact situation.
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SessionImportWizard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function fileFromSheets(name: string, sheets: Record<string, unknown[][]>): File {
  const workbook = XLSX.utils.book_new()
  for (const [title, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), title)
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return new File([buffer], name)
}

describe('SessionImportWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.spyOn(adminImportApi, 'validateSession').mockResolvedValue({
      domainOrder: ['taxClasses'],
      previews: [{ domain: 'taxClasses', preview: [{ rowNumber: 1, businessKey: 'GST18', action: 'create', errors: [] }] }],
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 1 },
      sessionCommitToken: 'tok1',
    })
    vi.spyOn(adminImportApi, 'commitSession').mockResolvedValue({ sessionId: 'sess1', summary: { toCreate: 1, toUpdate: 0, unchanged: 0, needsReview: 0, rejected: 0, total: 1 } })
  })

  it('auto-assigns a recognized sheet and enables Validate Session immediately', async () => {
    renderWizard()
    const file = fileFromSheets('taxes.xlsx', { 'Tax Classes': [['Code', 'Name', 'Rate %'], ['GST18', 'GST 18%', 18]] })
    fireEvent.change(screen.getByLabelText(/upload files/i), { target: { files: [file] } })
    // getByText throws here: "Tax Classes" matches both the sheet-title
    // cell and the resolved-assignment span ("taxClasses — Tax Classes") —
    // getAllByText avoids the "multiple elements" ambiguity, since either
    // match proves the sheet rendered.
    await waitFor(() => expect(screen.getAllByText(/Tax Classes/).length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: /validate session/i })).not.toBeDisabled()
  })

  it('disables Validate Session while an ambiguous sheet has no chosen assignment', async () => {
    renderWizard()
    const file = fileFromSheets('mystery.xlsx', { 'Random Sheet': [['Code', 'Name', 'Description', 'Active', 'Display Order'], ['X1', 'X', '', true, 0]] })
    fireEvent.change(screen.getByLabelText(/upload files/i), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText(/Random Sheet/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /validate session/i })).toBeDisabled()
  })

  it('runs the full validate -> commit flow and shows the completion summary', async () => {
    renderWizard()
    const file = fileFromSheets('taxes.xlsx', { 'Tax Classes': [['Code', 'Name', 'Rate %'], ['GST18', 'GST 18%', 18]] })
    fireEvent.change(screen.getByLabelText(/upload files/i), { target: { files: [file] } })
    await waitFor(() => screen.getByRole('button', { name: /validate session/i }))
    fireEvent.click(screen.getByRole('button', { name: /validate session/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /commit session/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /commit session/i }))
    fireEvent.click(await screen.findByRole('button', { name: /confirm commit/i }))
    await waitFor(() => expect(screen.getByText(/session complete/i)).toBeInTheDocument())
  })
})
