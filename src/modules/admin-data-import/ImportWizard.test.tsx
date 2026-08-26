import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { adminImportApi } from './api'
import * as fileExport from '@/lib/file-export'
import { TEMPLATE_COLUMNS } from './templates'
import { ImportWizard } from './ImportWizard'

function renderWizard(domain = 'taxClasses') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/admin/data-import/${domain}`]}>
        <Routes>
          <Route path="/admin/data-import/:domain" element={<ImportWizard />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A real .xlsx File, so the test exercises the actual SheetJS parse path
 *  the browser hits rather than a stubbed parser. */
function taxClassesFile(rows: unknown[][]): File {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS.taxClasses[0].columns, ...rows]), 'Tax Classes')
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buffer], 'tax-classes.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

async function upload(rows: unknown[][]) {
  await userEvent.upload(screen.getByLabelText(/upload file/i), taxClassesFile(rows))
}

describe('ImportWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the preview grid with counts after a file is parsed and validated', async () => {
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [{ rowNumber: 1, businessKey: 'GST18', action: 'create', errors: [] }],
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 },
      commitToken: 'abc',
    } as any)

    renderWizard()
    await upload([['GST18', 'GST 18%', '', '18', 'Y', '0']])

    expect(await screen.findByText(/1 to create/i)).toBeInTheDocument()
    expect(screen.getByText('GST18')).toBeInTheDocument()
  })

  it('sends the parsed rows to validate with the importer field names', async () => {
    const validate = vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [], summary: { toCreate: 0, toUpdate: 0, unchanged: 0, rejected: 0, total: 0 }, commitToken: 'abc',
    } as any)

    renderWizard()
    await upload([['GST18', 'GST 18%', '', '18', 'Y', '0']])

    await vi.waitFor(() => expect(validate).toHaveBeenCalled())
    expect(validate.mock.calls[0][0]).toEqual({
      domain: 'taxClasses',
      rows: [{ code: 'GST18', name: 'GST 18%', description: '', ratePct: 18, active: true, displayOrder: 0 }],
    })
  })

  it('disables Commit Import when there are zero create/update rows', async () => {
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [], summary: { toCreate: 0, toUpdate: 0, unchanged: 0, rejected: 0, total: 0 }, commitToken: 'abc',
    } as any)

    renderWizard()
    await upload([])

    expect(await screen.findByRole('button', { name: /commit import/i })).toBeDisabled()
  })

  it('shows each rejected row\'s errors inline', async () => {
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [{ rowNumber: 2, businessKey: 'B', action: 'reject', errors: ['Name is required'] }],
      summary: { toCreate: 0, toUpdate: 0, unchanged: 0, rejected: 1, total: 1 },
      commitToken: 'abc',
    } as any)

    renderWizard()
    await upload([['B', '', '', '5', 'Y', '0']])

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
  })

  it('offers Download Error Report only when there are rejected rows', async () => {
    const downloadFile = vi.spyOn(fileExport, 'downloadFile').mockResolvedValue()
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [{ rowNumber: 2, businessKey: 'B', action: 'reject', errors: ['Name is required'] }],
      summary: { toCreate: 0, toUpdate: 0, unchanged: 0, rejected: 1, total: 1 },
      commitToken: 'abc',
    } as any)

    renderWizard()
    await upload([['B', '', '', '5', 'Y', '0']])
    await userEvent.click(await screen.findByRole('button', { name: /download error report/i }))

    expect(downloadFile).toHaveBeenCalledWith(
      expect.stringContaining('taxClasses'),
      'Row,Business Key,Errors\n2,B,"Name is required"\n',
      'text/csv',
    )
  })

  it('hides Download Error Report when nothing was rejected', async () => {
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [{ rowNumber: 1, businessKey: 'GST18', action: 'create', errors: [] }],
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 },
      commitToken: 'abc',
    } as any)

    renderWizard()
    await upload([['GST18', 'GST 18%', '', '18', 'Y', '0']])

    await screen.findByText(/1 to create/i)
    expect(screen.queryByRole('button', { name: /download error report/i })).not.toBeInTheDocument()
  })

  it('shows a confirmation modal naming the exact counts, then a result summary after commit', async () => {
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [{ rowNumber: 1, businessKey: 'GST18', action: 'create', errors: [] }],
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 },
      commitToken: 'abc',
    } as any)
    const commit = vi.spyOn(adminImportApi, 'commit').mockResolvedValue({
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 },
    } as any)

    renderWizard()
    await upload([['GST18', 'GST 18%', '', '18', 'Y', '0']])
    await userEvent.click(await screen.findByRole('button', { name: /commit import/i }))

    expect(screen.getByText(/this will create 1 and update 0 records/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /confirm commit/i }))

    expect(await screen.findByText(/1 created/i)).toBeInTheDocument()
    expect(commit.mock.calls[0][0]).toMatchObject({ domain: 'taxClasses', commitToken: 'abc' })
  })

  it('reports a stale-token conflict as a failure banner with a re-validate call to action', async () => {
    vi.spyOn(adminImportApi, 'validate').mockResolvedValue({
      preview: [{ rowNumber: 1, businessKey: 'GST18', action: 'create', errors: [] }],
      summary: { toCreate: 1, toUpdate: 0, unchanged: 0, rejected: 0, total: 1 },
      commitToken: 'abc',
    } as any)
    vi.spyOn(adminImportApi, 'commit').mockRejectedValue(
      new Error('This data has changed since it was previewed. Please re-validate before committing.'),
    )

    renderWizard()
    await upload([['GST18', 'GST 18%', '', '18', 'Y', '0']])
    await userEvent.click(await screen.findByRole('button', { name: /commit import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm commit/i }))

    expect(await screen.findByText(/please re-validate/i)).toBeInTheDocument()
  })

  it('surfaces a parse failure instead of silently sending zero rows', async () => {
    const validate = vi.spyOn(adminImportApi, 'validate')

    renderWizard()
    await userEvent.upload(screen.getByLabelText(/upload file/i), new File(['not a workbook'], 'x.xlsx'))

    expect(await screen.findByText(/could not read this file/i)).toBeInTheDocument()
    expect(validate).not.toHaveBeenCalled()
  })
})
