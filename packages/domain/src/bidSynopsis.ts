export const BID_SYNOPSIS_SECTIONS = ['scope', 'pq', 'tq', 'manpower', 'milestone', 'payment', 'boq', 'queries'] as const
export type BidSynopsisSection = (typeof BID_SYNOPSIS_SECTIONS)[number]

export interface SynopsisNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: SynopsisNode[]
}

export interface BidSynopsis {
  bidId: string
  section: BidSynopsisSection
  document: SynopsisNode
  revision: number
  updatedAt: string
  updatedBy: string | null
}

export interface SaveBidSynopsisInput {
  bidId: string
  section: BidSynopsisSection
  document: SynopsisNode
  expectedRevision: number
}

const NODE_TYPES = new Set(['doc', 'paragraph', 'text', 'hardBreak', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader', 'codeBlock'])
const MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'textStyle', 'highlight', 'link', 'code'])

export function validateSynopsisDocument(value: unknown): asserts value is SynopsisNode {
  const encoded = JSON.stringify(value)
  if (!encoded || encoded.length > 1_000_000) throw new Error('The section must be smaller than 1 MB.')
  let count = 0
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 24 || ++count > 20_000) throw new Error('Invalid section document.')
    const node = value as SynopsisNode
    if (!NODE_TYPES.has(node.type) || (node.text !== undefined && typeof node.text !== 'string')) throw new Error('Invalid section content.')
    if (node.type === 'text' && !node.text) throw new Error('Text cannot be empty.')
    if (node.attrs !== undefined && (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs))) throw new Error('Invalid formatting.')
    for (const key of ['colspan', 'rowspan']) {
      const span = node.attrs?.[key]
      if (span !== undefined && (!Number.isInteger(span) || Number(span) < 1 || Number(span) > 500)) throw new Error('Invalid merged cell.')
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) throw new Error('Invalid text formatting.')
      for (const mark of node.marks) {
        if (!mark || !MARK_TYPES.has(mark.type)) throw new Error('Invalid text formatting.')
        if (mark.type === 'link' && typeof mark.attrs?.href === 'string' && !/^(https?:|mailto:|tel:|\/|#)/i.test(mark.attrs.href)) throw new Error('Invalid link.')
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error('Invalid section content.')
      node.content.forEach(child => visit(child, depth + 1))
    }
  }
  visit(value, 0)
  if ((value as SynopsisNode).type !== 'doc' || !(value as SynopsisNode).content?.length) throw new Error('A section must contain a document.')
}
