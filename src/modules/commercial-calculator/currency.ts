import type { Currency } from './types'

/** Resolves a `CommercialBoq.currency` code (e.g. "INR") back to its master
 *  row — needed to read that currency's `exchangeRate`. */
export function currencyByCode(currencies: Currency[], code: string): Currency {
  const currency = currencies.find((c) => c.code === code)
  if (!currency) throw new Error(`No such currency code: ${code}`)
  return currency
}

/** Resolves a `CommercialSku.currencyId` FK back to its master row. */
export function currencyById(currencies: Currency[], id: string): Currency {
  const currency = currencies.find((c) => c.id === id)
  if (!currency) throw new Error(`No such currency: ${id}`)
  return currency
}

/** `Currency.exchangeRate` is each currency's value relative to whichever
 *  currency has `isBaseCurrency: true` (spec — see types.ts). Converting
 *  between any two currencies goes via that shared base, so the factor is
 *  just the ratio of their rates: multiply an amount in `from` by this to
 *  get the equivalent amount in `to`. */
export function conversionFactor(from: Currency, to: Currency): number {
  return from.exchangeRate / to.exchangeRate
}
