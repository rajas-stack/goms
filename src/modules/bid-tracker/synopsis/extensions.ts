import { Extension, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { CellSelection } from '@tiptap/pm/tables'

const CellFormatting = Extension.create({
  name: 'synopsisCellFormatting',
  addGlobalAttributes() {
    return [{ types: ['tableCell', 'tableHeader'], attributes: {
      backgroundColor: {
        default: null, parseHTML: element => element.style.backgroundColor || null,
        renderHTML: attrs => /^#[0-9a-f]{6}$/i.test(attrs.backgroundColor ?? '')
          ? { style: `background-color: ${attrs.backgroundColor}; color: #1a2332` } : {},
      },
      wrap: {
        default: true, parseHTML: element => element.getAttribute('data-wrap') !== 'false',
        renderHTML: attrs => ({ 'data-wrap': String(attrs.wrap), style: `white-space: ${attrs.wrap ? 'normal' : 'nowrap'}` }),
      },
      cellFormat: {
        default: 'text', parseHTML: element => element.getAttribute('data-cell-format') ?? 'text',
        renderHTML: attrs => ({ 'data-cell-format': attrs.cellFormat }),
      },
    } }]
  },
})

export function synopsisExtensions() {
  return [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 80 } }), CellFormatting,
    TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyle, Color, FontSize, FontFamily,
    Highlight.configure({ multicolor: true }),
  ]
}

export function selectCells(editor: Editor, axis: 'row' | 'column' | 'cell') {
  const { selection, doc } = editor.state
  let cell = selection instanceof CellSelection ? selection.$anchorCell : null
  if (!cell) {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const role = selection.$from.node(depth).type.spec.tableRole
      if (role === 'cell' || role === 'header_cell') { cell = doc.resolve(selection.$from.before(depth)); break }
    }
  }
  if (!cell) return false
  const next = axis === 'row' ? CellSelection.rowSelection(cell) : axis === 'column' ? CellSelection.colSelection(cell) : new CellSelection(cell)
  editor.view.dispatch(editor.state.tr.setSelection(next))
  return true
}

export function formatNumericCells(editor: Editor, format: string) {
  const { selection } = editor.state
  const cells: { pos: number; text: string; type: string }[] = []
  if (selection instanceof CellSelection) selection.forEachCell((node, pos) => cells.push({ pos, text: node.textContent, type: node.type.name }))
  else {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth)
      if (['tableCell', 'tableHeader'].includes(node.type.name)) {
        cells.push({ pos: selection.$from.before(depth), text: node.textContent, type: node.type.name }); break
      }
    }
  }
  if (!cells.length) return false
  if (format !== 'text' && cells.some(cell => cell.text.trim() && !/^[-+]?\d*\.?\d+$/.test(cell.text.replace(/[,\s\u20b9%]/g, '')))) {
    throw new Error('Select numeric or empty cells to apply a number format.')
  }
  let tr = editor.state.tr
  for (const cell of cells.slice().sort((a, b) => b.pos - a.pos)) {
    const node = tr.doc.nodeAt(cell.pos)!
    tr = tr.setNodeMarkup(cell.pos, undefined, { ...node.attrs, cellFormat: format })
    if (format === 'text' || !cell.text.trim()) continue
    const number = Number(cell.text.replace(/[,\s\u20b9%]/g, ''))
    const formatted = format === 'currency'
      ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(number)
      : `${number.toLocaleString('en-IN', { maximumFractionDigits: 6 })}${format === 'percent' ? '%' : ''}`
    tr = tr.replaceWith(cell.pos + 1, cell.pos + node.nodeSize - 1, editor.schema.nodes.paragraph.create(null, editor.schema.text(formatted)))
  }
  editor.view.dispatch(tr)
  return true
}
