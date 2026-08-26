import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '../../db.js'
import { validateCurrencyRows, commitCurrencyRows } from './currencies.js'

describe('currencies importer', () => {
  beforeEach(async () => {
    await pool.query(`DELETE FROM commercial_masters WHERE master_key='currencies'`)
  })

  /** Seeds an existing base-currency row directly, bypassing the importer,
   *  so tests can set up a pre-existing DB state (mirrors how taxClasses.test.ts
   *  seeds via direct query rather than through the importer under test). */
  async function seedBaseCurrency(code: string, name: string) {
    await pool.query(
      `INSERT INTO commercial_masters (master_key, code, name, active, display_order, extra)
       VALUES ('currencies', $1, $2, true, 0, $3)`,
      [code, name, JSON.stringify({ symbol: '', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true })],
    )
  }

  it('rejects the whole batch when two rows both claim Is Base Currency = Y', async () => {
    const rows = [
      { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalPlaces: 2, exchangeRate: 1, isBaseCurrency: true, active: true, displayOrder: 0 },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: true, active: true, displayOrder: 1 },
    ]
    const preview = await validateCurrencyRows(pool, rows)
    expect(preview.every((r) => r.action === 'reject')).toBe(true)
    expect(preview[0].errors[0]).toMatch(/more than one row is marked Is Base Currency/i)
  })

  it('creates a new currency with Is Base Currency = false', async () => {
    // An existing base currency must already stand (else the batch would
    // leave zero base currencies, a different rejection covered below), so
    // this seeds one directly and asserts the *new* row's own classification.
    await seedBaseCurrency('INR', 'Indian Rupee')
    const rows = [
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: false, active: true, displayOrder: 1 },
    ]
    const preview = await validateCurrencyRows(pool, rows)
    expect(preview[0].action).toBe('create')
  })

  it('setting a new base currency in the batch reports an implicit update on the previously-base row', async () => {
    await seedBaseCurrency('INR', 'Indian Rupee')
    const rows = [
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: true, active: true, displayOrder: 1 },
    ]
    const preview = await validateCurrencyRows(pool, rows)

    const usdRow = preview.find((r) => r.businessKey === 'USD')
    expect(usdRow?.action).toBe('create')

    // INR was never in the uploaded file, but flipping USD to the new base
    // currency implicitly unsets INR's flag too — the admin must see that
    // side effect in the preview before committing, not discover it after.
    const inrRow = preview.find((r) => r.businessKey === 'INR')
    expect(inrRow?.action).toBe('update')
    expect(inrRow?.diff).toEqual([{ field: 'isBaseCurrency', oldValue: true, newValue: false }])
  })

  it('rejects when the batch would leave zero base currencies', async () => {
    // No existing base currency (beforeEach leaves the table empty) and no
    // uploaded row claims Is Base Currency = Y either.
    const rows = [
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: false, active: true, displayOrder: 0 },
    ]
    const preview = await validateCurrencyRows(pool, rows)
    expect(preview.every((r) => r.action === 'reject')).toBe(true)
    expect(preview[0].errors[0]).toMatch(/at least one currency must be marked Is Base Currency/i)
  })

  it("commit correctly unsets the old base currency's flag in the same transaction as setting the new one", async () => {
    await seedBaseCurrency('INR', 'Indian Rupee')
    const rows = [
      { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, exchangeRate: 83, isBaseCurrency: true, active: true, displayOrder: 1 },
    ]
    const preview = await validateCurrencyRows(pool, rows)
    await commitCurrencyRows(pool, rows, preview)

    const result = await pool.query(`SELECT code, extra FROM commercial_masters WHERE master_key='currencies' ORDER BY code`)
    const inr = result.rows.find((r) => r.code === 'INR')
    const usd = result.rows.find((r) => r.code === 'USD')
    expect(inr.extra.isBaseCurrency).toBe(false)
    expect(usd.extra.isBaseCurrency).toBe(true)
  })
})
