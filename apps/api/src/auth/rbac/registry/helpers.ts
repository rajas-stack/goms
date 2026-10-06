import type { PolicyModuleKey } from '@goms/domain'
import type { Requirement } from './types.js'

export const ROW_MODULES: PolicyModuleKey[] = ['opp.bidTracker', 'opp.pipeline', 'opp.campaign']

export const read = (module: PolicyModuleKey): Requirement => () => ({ module, action: 'read' })
export const readAny = (...anyOf: PolicyModuleKey[]): Requirement => () => ({ module: anyOf[0], action: 'read', anyOf })
export const create = (module: PolicyModuleKey): Requirement => () => ({ module, action: 'create' })
export const write = (module: PolicyModuleKey, atoms?: string[]): Requirement => () => ({ module, action: 'update', atoms })
export const remove = (module: PolicyModuleKey): Requirement => () => ({ module, action: 'delete' })

/** Reading any opportunity row = reading at least one of the three sheet modules. */
export const readRows: Requirement = readAny(...ROW_MODULES)
