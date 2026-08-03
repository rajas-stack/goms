import { uid } from '@/lib/utils'
import { enforceSingleBaseCurrency, findMasterChildren, validateMasterCode, validateParentExists } from './master-rules'
import type { CommercialCalculatorData, CreateMasterInput, Currency, MasterEntityKey, MasterRowMap } from './types'

export function listMasterLogic<K extends MasterEntityKey>(data: CommercialCalculatorData, key: K): MasterRowMap[K][] {
  return [...data.masters[key]].sort((a, b) => a.displayOrder - b.displayOrder) as MasterRowMap[K][]
}

export function getMasterLogic<K extends MasterEntityKey>(data: CommercialCalculatorData, key: K, id: string): MasterRowMap[K] | null {
  return (data.masters[key].find((r) => r.id === id) ?? null) as MasterRowMap[K] | null
}

export function createMasterLogic<K extends MasterEntityKey>(
  data: CommercialCalculatorData, key: K, input: CreateMasterInput<K>,
): MasterRowMap[K] {
  const rows = data.masters[key]
  const codeError = validateMasterCode(data.masters, key, (input as unknown as { code: string }).code, null)
  if (codeError) throw new Error(codeError)
  const parentError = validateParentExists(data.masters, key, input as unknown as Record<string, unknown>)
  if (parentError) throw new Error(parentError)

  const row = {
    ...input,
    id: uid('mst'),
    active: input.active ?? true,
    displayOrder: input.displayOrder ?? rows.length,
  } as MasterRowMap[K]
  rows.push(row)

  if (key === 'currencies' && (row as unknown as Currency).isBaseCurrency) {
    enforceSingleBaseCurrency(data.masters.currencies, row.id)
  }
  return row
}

export function updateMasterLogic<K extends MasterEntityKey>(
  data: CommercialCalculatorData, key: K, id: string, patch: Partial<MasterRowMap[K]>,
): MasterRowMap[K] {
  const rows = data.masters[key]
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`No such ${key} row: ${id}`)

  if (patch.code !== undefined) {
    const codeError = validateMasterCode(data.masters, key, patch.code as string, id)
    if (codeError) throw new Error(codeError)
  }
  const merged = { ...row, ...patch }
  const parentError = validateParentExists(data.masters, key, merged as unknown as Record<string, unknown>)
  if (parentError) throw new Error(parentError)

  Object.assign(row, patch)
  if (key === 'currencies' && (patch as Partial<Currency>).isBaseCurrency) {
    enforceSingleBaseCurrency(data.masters.currencies, id)
  }
  return row
}

export function setMasterActiveLogic(data: CommercialCalculatorData, key: MasterEntityKey, id: string, active: boolean): void {
  const row = data.masters[key].find((r) => r.id === id)
  if (row) row.active = active
}

export function deleteMasterLogic(data: CommercialCalculatorData, key: MasterEntityKey, id: string): void {
  const children = findMasterChildren(data.masters, key, id)
  if (children.length > 0) {
    throw new Error(`Cannot delete this ${key} row — ${children.length} row(s) still reference it.`)
  }
  const masters = data.masters as unknown as Record<MasterEntityKey, { id: string }[]>
  masters[key] = masters[key].filter((r) => r.id !== id)
}
