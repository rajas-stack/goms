export const isRestricted = (value: number | null | undefined): value is null => value === null
export const formatRestricted = (value: number | null | undefined, format: (n: number) => string): string =>
  value === null || value === undefined ? 'Restricted' : format(value)
/** Margin and "Below Cost" are computed from SKU cost fields in the browser; if any involved SKU hides its cost they cannot be. */
export const canComputeMargin = (skus: { maskedFields?: string[] }[]): boolean => skus.every((s) => !s.maskedFields?.length)
