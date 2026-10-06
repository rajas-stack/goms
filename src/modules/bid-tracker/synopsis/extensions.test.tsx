import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { SynopsisNode } from '@goms/domain'
import { createTable, paragraph } from './documents'
import { formatNumericCells, selectCells, synopsisExtensions } from './extensions'

const editors: Editor[] = []
function documentOf(editor: Editor): SynopsisNode { return editor.getJSON() as SynopsisNode }
function makeEditor() {
  const editor = new Editor({ extensions: synopsisExtensions(), content: { type: 'doc', content: [createTable(['Column 1', 'Column 2'], 2), paragraph()] } })
  editors.push(editor)
  return editor
}
function firstCell(editor: Editor) {
  let position = -1
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell' && position === -1) position = pos })
  editor.commands.setTextSelection(position + 2)
  return position
}

afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()) })

describe('table designer commands', () => {
  it('highlights an entire selected row and merges and splits without changing row count', () => {
    const editor = makeEditor()
    firstCell(editor)
    expect(selectCells(editor, 'row')).toBe(true)
    expect(editor.commands.setCellAttribute('backgroundColor', '#fff2cc')).toBe(true)
    let row = documentOf(editor).content![0].content![1]
    expect(row.content!.every(cell => cell.attrs?.backgroundColor === '#fff2cc')).toBe(true)
    expect(editor.commands.mergeCells()).toBe(true)
    row = documentOf(editor).content![0].content![1]
    expect(row.content).toHaveLength(1)
    expect(row.content![0].attrs?.colspan).toBe(2)
    expect(editor.commands.splitCell()).toBe(true)
    expect(documentOf(editor).content![0].content![1].content).toHaveLength(2)
    expect(documentOf(editor).content![0].content).toHaveLength(3)
  })

  it('formats a numeric cell without converting text cells or silently accepting invalid data', () => {
    const editor = makeEditor()
    const pos = firstCell(editor)
    editor.commands.insertContent('1234.5')
    formatNumericCells(editor, 'currency')
    expect(editor.state.doc.nodeAt(pos)?.textContent).toContain('1,234.50')
    expect(editor.state.doc.nodeAt(pos)?.attrs.cellFormat).toBe('currency')
    editor.commands.setTextSelection(pos + 2)
    formatNumericCells(editor, 'number')
    expect(editor.state.doc.nodeAt(pos)?.textContent).toBe('1,234.5')
    editor.commands.setTextSelection(pos + 2)
    editor.commands.insertContent('not a number')
    expect(() => formatNumericCells(editor, 'number')).toThrow(/numeric/)
  })

  it('retains wrapping, cell fill and rich-text formatting after a document round trip', () => {
    const editor = makeEditor()
    firstCell(editor)
    editor.commands.setCellAttribute('wrap', false)
    editor.commands.setCellAttribute('backgroundColor', '#cfe2f3')
    editor.chain().toggleBold().toggleItalic().setFontSize('18px').insertContent('User text').run()
    const document = editor.getJSON()
    const restored = makeEditor()
    restored.commands.setContent(document)
    expect(restored.getJSON()).toEqual(document)
    expect(restored.getHTML()).toContain('data-wrap="false"')
    expect(restored.getHTML()).toContain('background-color: rgb(207, 226, 243)')
    expect(restored.getHTML()).toContain('<strong>')
    expect(restored.getHTML()).toContain('font-size: 18px')
  })

  it('adds and deletes rows and columns in any section table', () => {
    const editor = makeEditor()
    firstCell(editor)
    editor.commands.addRowBefore()
    editor.commands.addColumnBefore()
    expect(documentOf(editor).content![0].content).toHaveLength(4)
    expect(documentOf(editor).content![0].content![0].content).toHaveLength(3)
    editor.commands.deleteRow()
    editor.commands.deleteColumn()
    expect(documentOf(editor).content![0].content).toHaveLength(3)
    expect(documentOf(editor).content![0].content![0].content).toHaveLength(2)
  })
})
