import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('main.tsx import order (I2)', () => {
  it('imports the early handoff stripper FIRST, so it runs before ./app/router creates the browser router', () => {
    const source = readFileSync(resolve(__dirname, '../../main.tsx'), 'utf8').replace(/\r\n/g, '\n')
    const imports = [...source.matchAll(/^import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports[0]).toBe('./lib/auth/earlyHandoff')
    expect(imports.indexOf('./lib/auth/earlyHandoff')).toBeLessThan(imports.indexOf('./app/router'))
  })
})
