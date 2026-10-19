import { useMutation, useQueryClient } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import type { BidImportTable } from '@goms/domain'

export function useBidTransferMutation() {
  const query = useQueryClient()
  const importBids = useMutation({
    mutationFn: (input: { table: BidImportTable }) => repository.importBids(input),
    retry: false,
    onSuccess: result => {
      if (result.status !== 'imported') return
      for (const key of ['bidsForGrid', 'opportunities', 'bidMilestones', 'bidCustomFields']) void query.invalidateQueries({ queryKey: [key] })
    },
  })
  return { importBids }
}
