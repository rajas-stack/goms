/** User-facing percentage text — rounds away binary floating-point noise
 *  (e.g. `((1000 - 930) / 1000) * 100` evaluating to `7.000000000000001`)
 *  and drops a trailing `.0` rather than always padding to `maxDecimals`, so
 *  a clean whole number reads as `7%` while a genuinely fractional value
 *  keeps its precision (`21.3%`). Only ever touches display text — never
 *  the stored/calculated value itself, which callers must keep using at
 *  full precision for pricing, approval, tax, and margin math. */
export function formatPercent(value: number, maxDecimals = 1): string {
  const rounded = Number(value.toFixed(maxDecimals))
  return `${rounded}%`
}

/** True when a margin is below cost — the shared check behind every
 *  "Below Cost — Negative Margin" warning treatment (spec: negative margin
 *  is a display concern only, never a blocked state). */
export function isNegativeMargin(marginPct: number): boolean {
  return marginPct < 0
}

/** User-facing money value — rounds away binary floating-point noise from a
 *  back-solved price (e.g. `85000 * 0.7` evaluating to
 *  `59499.999999999993`) the same way `formatPercent` does for percentages,
 *  to the nearest currency sub-unit (2 decimals) by default. Only ever
 *  touches display text — never the stored/calculated value itself, which
 *  callers must keep using at full precision for pricing, approval, tax, and
 *  margin math. */
export function roundMoney(value: number, maxDecimals = 2): number {
  return Number(value.toFixed(maxDecimals))
}
