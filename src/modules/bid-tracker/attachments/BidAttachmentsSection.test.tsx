import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import { BidAttachmentsSection } from './BidAttachmentsSection'

async function makeBid() {
  const opp = await repository.createOpportunity({ departmentId: 'dept-1', opportunityName: 'Smart Parking' })
  return repository.createBid(opp.id)
}
function renderSection(bidId: string) {
  try { localStorage.removeItem('goms:bid-attachments-open') } catch { /* storage unavailable: section defaults to open */ }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={qc}><BidAttachmentsSection bidId={bidId} /></QueryClientProvider>)
}
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' })

describe('BidAttachmentsSection', () => {
  beforeEach(() => resetLocalData())

  it('uploads into the chosen batch and category, and lists corrigendum documents as C1 under Batch 2', async () => {
    const bid = await makeBid()
    const { uploadId } = await repository.requestDocumentUploadUrl({ entityType: 'bid', entityId: bid.id, filename: 'Corr-1.pdf', contentType: 'application/pdf', sizeBytes: 10 })
    const corrDoc = await repository.confirmDocumentUpload(uploadId)
    await repository.createBidCorrigendum({ bidId: bid.id, corrigendumNumber: 1, sourceDocumentId: corrDoc.id, changes: [{ fieldKey: 'pq.x', currentValue: 'a', proposedValue: 'b', kind: 'clause' }] })
    renderSection(bid.id)

    const batch2 = await screen.findByTestId('attachment-batch-post_publication')
    await waitFor(() => expect(within(batch2).getByText('Corr-1.pdf')).toBeInTheDocument())
    expect(within(batch2).getByText('C1')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Upload to batch'), 'post_publication')
    await userEvent.selectOptions(screen.getByLabelText('Upload as category'), 'prebid_response')
    await userEvent.upload(screen.getByLabelText('Upload attachment'), pdf('Prebid-replies.pdf'))
    await waitFor(() => expect(within(batch2).getByText('Prebid-replies.pdf')).toBeInTheDocument())
    expect((await repository.listDocuments('bid', bid.id)).find((d) => d.filename === 'Prebid-replies.pdf')).toMatchObject({ batch: 'post_publication', category: 'prebid_response' })
    expect(within(screen.getByTestId('attachment-batch-tender')).getAllByText('None yet')).toHaveLength(4)
  })

  it('rejects unsupported files and deletes after confirmation; collapses', async () => {
    const bid = await makeBid()
    const { uploadId } = await repository.requestDocumentUploadUrl({ entityType: 'bid', entityId: bid.id, filename: 'RFP.pdf', contentType: 'application/pdf', sizeBytes: 10, batch: 'tender', category: 'rfp' })
    await repository.confirmDocumentUpload(uploadId)
    renderSection(bid.id)
    await screen.findByText('RFP.pdf')
    await userEvent.upload(screen.getByLabelText('Upload attachment'), new File(['x'], 'a.zip', { type: 'application/zip' }), { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only PDF/)

    await userEvent.click(screen.getByRole('button', { name: 'Delete RFP.pdf' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(screen.queryByText('RFP.pdf')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Attachments/ }))
    expect(screen.queryByTestId('attachment-batch-tender')).not.toBeInTheDocument()
  })
})
