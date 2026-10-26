import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Source-level guards for two mistakes that took the whole page down or spammed the console in production. They are cheap to
 *  make and invisible in a code review, so they are checked mechanically: this test fails, naming the file and line, if either
 *  is written again. */

const ROOT = join(__dirname, '..')
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length
const scan = (pattern: RegExp) => sourceFiles(ROOT).flatMap((file) => {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  return [...text.matchAll(pattern)].map((m) => `${file.slice(ROOT.length + 1).split(String.fromCharCode(92)).join('/')}:${lineOf(text, m.index!)}  ${m[0].trim().slice(0, 90)}`)
})

describe('React pitfalls that crashed or spammed production', () => {
  // A functional state update runs LATER (at the next render), not where it is written. Reading a ref inside it sees whatever the
  // ref holds by then: `dragRef.current!.originX` threw "Cannot read properties of null (reading 'originX')" once the pointer had
  // been released, and the page fell into the error boundary ("This page hit a snag"). Read the ref first, outside the updater.
  it('never reads a ref inside a functional setState updater', () => {
    expect(scan(/\bset[A-Z]\w*\(\s*\(?\s*\w+\s*\)?\s*=>[^;\n]{0,240}?\b\w*Ref\.current\b/g)).toEqual([])
  })

  // React's `onWheel` prop is a passive listener: preventDefault() is refused with a console error on every wheel event and the
  // page scrolls under the pan/zoom surface. Use `useNonPassiveWheel` (src/lib/useNonPassiveWheel.ts).
  it('never uses the React onWheel prop (it is passive; use useNonPassiveWheel)', () => {
    expect(scan(/\bonWheel=\{/g)).toEqual([])
  })
})
