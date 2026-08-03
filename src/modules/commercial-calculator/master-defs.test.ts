import { describe, expect, it } from 'vitest'
import { MASTER_DEFS, MASTER_ORDER } from './master-defs'
import type { MasterEntityKey } from './types'

const ALL_KEYS: MasterEntityKey[] = [
  'verticals', 'products', 'modules', 'features', 'skuCategories', 'unitsOfMeasure',
  'productEditions', 'billingTypes', 'taxClasses', 'approvalMatrix', 'currencies', 'preSales',
]

describe('MASTER_DEFS', () => {
  it('has an entry for every MasterEntityKey', () => {
    for (const key of ALL_KEYS) expect(MASTER_DEFS[key], key).toBeDefined()
  })

  it('every parentMasterKey points at a real master', () => {
    for (const key of ALL_KEYS) {
      for (const field of MASTER_DEFS[key].fields) {
        if (field.parentMasterKey) expect(ALL_KEYS).toContain(field.parentMasterKey)
      }
    }
  })

  it('every select field has either static options or a parentMasterKey', () => {
    for (const key of ALL_KEYS) {
      for (const field of MASTER_DEFS[key].fields) {
        if (field.type === 'select') {
          expect(Boolean(field.options) || Boolean(field.parentMasterKey), `${key}.${field.key}`).toBe(true)
        }
      }
    }
  })
})

describe('MASTER_ORDER', () => {
  it('lists every master exactly once', () => {
    expect(new Set(MASTER_ORDER).size).toBe(ALL_KEYS.length)
    for (const key of ALL_KEYS) expect(MASTER_ORDER).toContain(key)
  })
})
