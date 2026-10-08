import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BidSynopsisSection, SaveBidSynopsisInput } from '@goms/domain'
import { repository } from '@/data/repository'

export function useSynopsis(bidId: string, section: BidSynopsisSection) {
  return useQuery({ queryKey: ['bidSynopsis', bidId, section], queryFn: () => repository.getBidSynopsis(bidId, section) })
}

export function useSaveSynopsis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveBidSynopsisInput) => repository.saveBidSynopsis(input),
    onSuccess: record => {
      queryClient.setQueryData(['bidSynopsis', record.bidId, record.section], record)
      queryClient.invalidateQueries({ queryKey: ['bidsForGrid'] })
    },
  })
}
