import { formatPercent } from './format'
import type { CommercialBoq, CommercialBoqLineItem, CommercialSku } from './types'

export interface ProposalPrintInput {
  boq: CommercialBoq
  lines: CommercialBoqLineItem[]
  skuById: Map<string, CommercialSku>
  departmentName: string
  verticalName: string
  salesPersonName: string
}

/** `buildProposalPrintHtml`'s output goes into a fresh window via
 *  `document.write` (see the Preview tab's print button) — every
 *  interpolated free-text field must be escaped so a customer name or
 *  address containing HTML can't inject markup into that document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function row(label: string, value: string): string {
  return `<div class="field"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(value)}</div></div>`
}

/** Builds a self-contained, printable HTML document for a proposal — the
 *  same information as the Preview tab, laid out for a printed page rather
 *  than the app's scrolling viewport. Pure and DOM-free so it's unit
 *  testable; the caller (ProposalDetail.tsx) opens it in a new window and
 *  calls `.print()`, which keeps this feature from touching the app shell's
 *  own fixed-viewport layout at all. */
export function buildProposalPrintHtml(input: ProposalPrintInput): string {
  const { boq, lines, skuById, departmentName, verticalName, salesPersonName } = input

  const rowsHtml = lines.map((line) => {
    const sku = skuById.get(line.skuId)
    return `
      <tr>
        <td><span class="sku-code">${escapeHtml(sku?.skuCode ?? '—')}</span> ${escapeHtml(sku?.name ?? 'Unknown SKU')}</td>
        <td>${line.quantity}</td>
        <td>${line.unitPrice.toLocaleString()}</td>
        <td>${formatPercent(line.discountPct)}</td>
        <td>${line.taxPct}%</td>
        <td class="right">${line.lineTotal.toLocaleString()}</td>
      </tr>`
  }).join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(boq.boqNumber)} — ${escapeHtml(boq.opportunityName)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #1a1a1a; margin: 32px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .subtitle { color: #666; font-size: 13px; margin: 0 0 24px; }
  .fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; margin-bottom: 24px; }
  .field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
  .field-value { font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  td.right, .grand-total { text-align: right; }
  .sku-code { font-family: monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  .grand-total { font-size: 15px; font-weight: 700; margin-top: 16px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <h1>Commercial Proposal — ${escapeHtml(boq.boqNumber)}</h1>
  <p class="subtitle">${escapeHtml(boq.opportunityName)}</p>
  <div class="fields">
    ${row('Customer', boq.customerName)}
    ${row('Organization', boq.customerOrganization)}
    ${row('Department', departmentName)}
    ${row('Vertical', verticalName)}
    ${row('Sales Person', salesPersonName)}
  </div>
  <table>
    <thead>
      <tr><th>SKU</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Tax</th><th class="right">Line Total</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="grand-total">Grand Total: ${escapeHtml(boq.currency)} ${boq.grandTotal.toLocaleString()}</p>
</body>
</html>`
}
