import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { CommercialAndFilesTab } from './CommercialAndFilesTab'

const money = { valueAmount: '6.20', valueUnit: 'crore', emdAmount: '12.40', emdUnit: 'lakh' }

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Bus' })
  return repository.createBid(opp.id)
}
function renderTab(bidId: string, opportunity = money) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><CommercialAndFilesTab bidId={bidId} opportunity={opportunity} /></QueryClientProvider>)
}
const pdf = (name = 'tender.pdf', size = 2048) => {
  const file = new File(['x'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('CommercialAndFilesTab', () => {
  beforeEach(async () => {
    await resetLocalData()
  })

  it('shows estimated cost and EMD, with a dash when a figure is missing', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    expect(await screen.findByText('6.20 crore')).toBeInTheDocument()
    expect(screen.getByText('12.40 lakh')).toBeInTheDocument()
  })

  it('shows a dash for missing figures', async () => {
    const bid = await makeBid()
    renderTab(bid.id, { valueAmount: '', valueUnit: 'lakh', emdAmount: '', emdUnit: 'lakh' })
    expect(await screen.findAllByText('—')).toHaveLength(2)
  })

  it('lists existing documents with version and size', async () => {
    const bid = await makeBid()
    const { uploadId } = await repository.requestDocumentUploadUrl({
      entityType: 'bid', entityId: bid.id, filename: 'DRDO_Tender.pdf', contentType: 'application/pdf', sizeBytes: 2048, version: 'v1.0',
    })
    await repository.confirmDocumentUpload(uploadId)
    renderTab(bid.id)
    expect(await screen.findByText('DRDO_Tender.pdf')).toBeInTheDocument()
    expect(screen.getByText('v1.0 · 2 KB')).toBeInTheDocument()
  })

  it('uploads a document through the request / confirm flow', async () => {
    const bid = await makeBid()
    renderTab(bid.id)
    await screen.findByText('No documents uploaded yet.')
    await userEvent.upload(screen.getByLabelText('Upload document'), pdf('new.pdf'))
    expect(await screen.findByText('new.pdf')).toBeInTheDocument()
    expect((await repository.listDocuments('bid', bid.id))[0]).toMatchObject({ filename: 'new.pdf', contentType: 'application/pdf' })
  })

  it('rejects a disallowed file type and an oversized file before any upload starts', async () => {
    const bid = await makeBid()
    const spy = vi.spyOn(repository, 'requestDocumentUploadUrl')
    renderTab(bid.id)
    await screen.findByText('No documents uploaded yet.')
    const input = screen.getByLabelText('Upload document')
    // `accept` would filter a real picker; bypass it like a drag-drop would.
    await userEvent.upload(input, new File(['x'], 'run.exe', { type: 'application/x-msdownload' }), { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only PDF/)
    await userEvent.upload(input, pdf('huge.pdf', 51 * 1024 * 1024))
    expect(await screen.findByRole('alert')).toHaveTextContent(/50 MB/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows a failed upload inline', async () => {
    const bid = await makeBid()
    vi.spyOn(repository, 'requestDocumentUploadUrl').mockRejectedValueOnce(new Error('Storage is unavailable.'))
    renderTab(bid.id)
    await screen.findByText('No documents uploaded yet.')
    await userEvent.upload(screen.getByLabelText('Upload document'), pdf())
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is unavailable.')
  })

  it('deletes a document after confirmation', async () => {
    const bid = await makeBid()
    const { uploadId } = await repository.requestDocumentUploadUrl({
      entityType: 'bid', entityId: bid.id, filename: 'old.pdf', contentType: 'application/pdf', sizeBytes: 10,
    })
    await repository.confirmDocumentUpload(uploadId)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderTab(bid.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete old.pdf' }))
    await waitFor(() => expect(screen.queryByText('old.pdf')).not.toBeInTheDocument())
  })
})
