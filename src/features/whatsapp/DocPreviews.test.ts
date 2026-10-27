import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { sheetGrid } from './DocPreviews'

describe('sheetGrid', () => {
  it("lays a worksheet out as Excel does: column letters, row numbers, merged cells, column widths, formatted values", () => {
    const sheet = XLSX.utils.aoa_to_sheet([['BOQ', null, null], ['Item', 'Qty', 'Rate'], ['Cable', 12, 1250.5]])
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
    sheet['!cols'] = [{ wch: 20 }]
    sheet.C3.w = XLSX.SSF.format('#,##0.00', 1250.5) // the displayed text a read workbook carries for a formatted number
    const grid = sheetGrid(XLSX, sheet)
    expect(grid.columns).toEqual([{ label: 'A', width: 145 }, { label: 'B', width: 72 }, { label: 'C', width: 72 }])
    expect(grid.rows.map((row) => row.number)).toEqual([1, 2, 3])
    expect(grid.rows[0].cells).toEqual([{ key: '0:0', text: 'BOQ', numeric: false, rowSpan: 1, colSpan: 3 }]) // B1:C1 covered by the merge
    expect(grid.rows[2].cells.map((cell) => [cell.text, cell.numeric])).toEqual([['Cable', false], ['12', true], ['1,250.50', true]])
    expect(grid.truncated).toBe(false)
  })

  it('draws at most 1,000 rows and says the sheet was cut', () => {
    const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 1500 }, (_, index) => [index]))
    const grid = sheetGrid(XLSX, sheet)
    expect(grid.rows).toHaveLength(1000)
    expect(grid.truncated).toBe(true)
  })
})
