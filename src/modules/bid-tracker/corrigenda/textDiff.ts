/** Word-level diff for corrigendum clause comparison. Pure — no React, no I/O.
 *
 *  `diffText(before, after)` returns:
 *  - `original` / `modified`: render-ready segments for each column, where only
 *    the deleted (resp. added) words are marked — unchanged text stays plain;
 *  - `hunks`: one entry per contiguous change, widened to a whole value where
 *    that reads better (a full date, a number with its unit) for the
 *    "WHAT CHANGED" line, e.g. `₹100 Crore → ₹75 Crore`. */

export type SegmentType = 'same' | 'added' | 'removed'
export interface DiffSegment { type: SegmentType; text: string }
export type ValueKind = 'number' | 'date' | 'text'
export type HunkKind = 'modified' | 'added' | 'removed'
export interface ChangeHunk { kind: HunkKind; before: string; after: string; valueKind: ValueKind }
export interface TextDiff { original: DiffSegment[]; modified: DiffSegment[]; hunks: ChangeHunk[]; identical: boolean }

interface Token { word: string; sep: string }
type Op = { op: 'eq'; a: number; b: number } | { op: 'del'; a: number } | { op: 'ins'; b: number }

/** Beyond this many token pairs the LCS table is skipped and the clause is
 *  treated as fully replaced — keeps a pasted 50-page annexure from freezing the tab. */
const MAX_LCS_CELLS = 400_000
const MAX_CONTEXT = 4

const TOKEN_RE = /[₹$€£]?\d+(?:,\d+)*(?:\.\d+)?%?|[\p{L}\p{M}]+(?:['’][\p{L}]+)?|\S/gu
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const DATE_RES = [
  new RegExp(`^\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}$`, 'i'),
  new RegExp(`^${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}$`, 'i'),
  /^\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}$/,
  /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/,
]
const UNITS = new Set([
  'crore', 'crores', 'cr', 'lakh', 'lakhs', 'lac', 'lacs', 'million', 'billion', 'thousand', 'nos', 'no', 'numbers',
  'units', 'unit', 'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year', 'hours', 'hrs', 'hour', 'km', 'mw', 'kw', 'gb', 'tb',
])
const CURRENCY_PREFIX = new Set(['₹', 'INR', 'Rs', 'USD', '$'])

export function tokenize(text: string): Token[] {
  const matches = [...text.matchAll(TOKEN_RE)]
  return matches.map((m, i) => {
    const end = (m.index ?? 0) + m[0].length
    const next = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length
    return { word: m[0], sep: text.slice(end, next) }
  })
}

function lcsOps(a: Token[], b: Token[]): Op[] {
  const n = a.length, m = b.length
  if (n * m > MAX_LCS_CELLS) {
    return [...a.map((_, i): Op => ({ op: 'del', a: i })), ...b.map((_, j): Op => ({ op: 'ins', b: j }))]
  }
  // dp[i][j] = LCS length of a[i..] and b[j..], flattened.
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i].word === b[j].word ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i].word === b[j].word) { ops.push({ op: 'eq', a: i++, b: j++ }) }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ op: 'del', a: i++ }) }
    else { ops.push({ op: 'ins', b: j++ }) }
  }
  while (i < n) ops.push({ op: 'del', a: i++ })
  while (j < m) ops.push({ op: 'ins', b: j++ })
  return ops
}

/** Merges neighbours of the same type and keeps trailing whitespace of a
 *  changed run out of its highlight. */
function merge(segments: DiffSegment[]): DiffSegment[] {
  return segments.reduce<DiffSegment[]>((out, s) => {
    if (!s.text) return out
    const last = out[out.length - 1]
    return last && last.type === s.type ? [...out.slice(0, -1), { type: s.type, text: last.text + s.text }] : [...out, s]
  }, [])
}

function compact(segments: DiffSegment[]): DiffSegment[] {
  const split = merge(segments).flatMap((s): DiffSegment[] => {
    if (s.type === 'same') return [s]
    const trail = s.text.match(/\s+$/)?.[0] ?? ''
    return trail ? [{ type: s.type, text: s.text.slice(0, -trail.length) }, { type: 'same', text: trail }] : [s]
  })
  return merge(split)
}

const join = (tokens: Token[]) => tokens.map((t, i) => t.word + (i < tokens.length - 1 ? t.sep : '')).join('')
const isDate = (s: string) => DATE_RES.some((re) => re.test(s.trim()))
const hasDigit = (s: string) => /\d/.test(s)

interface RawHunk { start: number; end: number } // [start, end) indexes into ops

function rawHunks(ops: Op[]): RawHunk[] {
  const out: RawHunk[] = []
  let k = 0
  while (k < ops.length) {
    if (ops[k].op === 'eq') { k++; continue }
    const start = k
    while (k < ops.length && ops[k].op !== 'eq') k++
    out.push({ start, end: k })
  }
  return out
}

function sides(ops: Op[], from: number, to: number, a: Token[], b: Token[]) {
  const slice = ops.slice(from, to)
  const before = slice.flatMap((o) => (o.op === 'ins' ? [] : [a[o.a]]))
  const after = slice.flatMap((o) => (o.op === 'del' ? [] : [b[o.b]]))
  return { before: join(before), after: join(after) }
}

/** Widens a hunk over unchanged neighbours so a whole date or a number with
 *  its unit is shown, never past another hunk. */
function describeHunk(h: RawHunk, ops: Op[], a: Token[], b: Token[], lo: number, hi: number): ChangeHunk {
  const core = sides(ops, h.start, h.end, a, b)
  const kind: HunkKind = core.before && core.after ? 'modified' : core.after ? 'added' : 'removed'
  if (kind === 'modified' && hasDigit(core.before + core.after)) {
    for (let size = 0; size <= MAX_CONTEXT * 2; size++) {
      for (let left = 0; left <= Math.min(size, MAX_CONTEXT); left++) {
        const right = size - left
        if (right > MAX_CONTEXT || h.start - left < lo || h.end + right > hi) continue
        const wide = sides(ops, h.start - left, h.end + right, a, b)
        if (isDate(wide.before) && isDate(wide.after)) return { kind, ...wide, valueKind: 'date' }
      }
    }
    let from = h.start, to = h.end
    const prev = ops[from - 1], next = ops[to]
    if (prev?.op === 'eq' && from - 1 >= lo && CURRENCY_PREFIX.has(a[prev.a].word)) from--
    if (next?.op === 'eq' && to < hi && (UNITS.has(a[next.a].word.toLowerCase()) || a[next.a].word === '%')) to++
    return { kind, ...sides(ops, from, to, a, b), valueKind: 'number' }
  }
  return { kind, ...core, valueKind: hasDigit(core.before + core.after) ? 'number' : 'text' }
}

export function diffText(before: string, after: string): TextDiff {
  const a = tokenize(before), b = tokenize(after)
  const ops = lcsOps(a, b)
  const original = compact(ops.flatMap((o): DiffSegment[] =>
    o.op === 'ins' ? [] : [{ type: o.op === 'eq' ? 'same' : 'removed', text: a[o.a].word + a[o.a].sep }]))
  const modified = compact(ops.flatMap((o): DiffSegment[] =>
    o.op === 'del' ? [] : [{ type: o.op === 'eq' ? 'same' : 'added', text: b[o.b].word + b[o.b].sep }]))
  const raw = rawHunks(ops)
  const hunks = raw.map((h, i) => describeHunk(h, ops, a, b, i > 0 ? raw[i - 1].end : 0, i + 1 < raw.length ? raw[i + 1].start : ops.length))
  return { original, modified, hunks, identical: hunks.length === 0 }
}
