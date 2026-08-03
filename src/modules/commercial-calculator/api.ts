import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import type { CreateMasterInput, MasterEntityKey, MasterRowMap } from './types'

export const qk = {
  masters: (key: MasterEntityKey) => ['commercialCalculator', 'masters', key] as const,
  master: (key: MasterEntityKey, id: string) => ['commercialCalculator', 'master', key, id] as const,
}

export const useMasters = <K extends MasterEntityKey>(key: K) =>
  useQuery({ queryKey: qk.masters(key), queryFn: () => repository.listMaster(key) })

export const useMaster = <K extends MasterEntityKey>(key: K, id: string | null) =>
  useQuery({
    queryKey: qk.master(key, id ?? ''),
    queryFn: () => repository.getMaster(key, id!),
    enabled: !!id,
  })

export function useMasterMutations<K extends MasterEntityKey>(key: K) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.masters(key) })
    qc.invalidateQueries({ queryKey: ['commercialCalculator', 'master', key] })
  }
  const create = useMutation({
    mutationFn: (input: CreateMasterInput<K>) => repository.createMaster(key, input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (a: { id: string; patch: Partial<MasterRowMap[K]> }) => repository.updateMaster(key, a.id, a.patch),
    onSuccess: invalidate,
  })
  const setActive = useMutation({
    mutationFn: (a: { id: string; active: boolean }) => repository.setMasterActive(key, a.id, a.active),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => repository.deleteMaster(key, id),
    onSuccess: invalidate,
  })
  return { create, update, setActive, remove }
}
