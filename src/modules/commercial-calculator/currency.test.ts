import { describe, expect, it } from 'vitest'
import { buildDefaultCommercialCalculatorData } from './seed-defaults'
import { conversionFactor, currencyByCode, currencyById } from './currency'

describe('currencyByCode / currencyById', () => {
  it('finds a currency by its code', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(currencyByCode(masters.currencies, 'USD').id).toBe('cur_usd')
  })

  it('throws for an unknown code', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(() => currencyByCode(masters.currencies, 'XYZ')).toThrow(/no such currency/i)
  })

  it('finds a currency by its id', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(currencyById(masters.currencies, 'cur_eur').code).toBe('EUR')
  })

  it('throws for an unknown id', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    expect(() => currencyById(masters.currencies, 'nope')).toThrow(/no such currency/i)
  })
})

describe('conversionFactor', () => {
  it('is 1 when converting a currency to itself', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    const inr = currencyByCode(masters.currencies, 'INR')
    expect(conversionFactor(inr, inr)).toBe(1)
  })

  it('converts from a non-base currency to the base currency using exchangeRate', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    const usd = currencyByCode(masters.currencies, 'USD') // exchangeRate 83, base INR = 1
    const inr = currencyByCode(masters.currencies, 'INR')
    expect(conversionFactor(usd, inr)).toBe(83)
  })

  it('converts from the base currency to a non-base currency', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    const usd = currencyByCode(masters.currencies, 'USD')
    const inr = currencyByCode(masters.currencies, 'INR')
    expect(conversionFactor(inr, usd)).toBeCloseTo(1 / 83, 10)
  })

  it('converts between two non-base currencies via their shared base rate', () => {
    const { masters } = buildDefaultCommercialCalculatorData()
    const usd = currencyByCode(masters.currencies, 'USD') // 83
    const eur = currencyByCode(masters.currencies, 'EUR') // 90
    expect(conversionFactor(usd, eur)).toBeCloseTo(83 / 90, 10)
  })
})
