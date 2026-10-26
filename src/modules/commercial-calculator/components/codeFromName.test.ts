import { expect, test } from 'vitest'
import { codeFromName } from './MasterFormDialog'

test('makes a readable code from the name and keeps it unique among existing codes', () => {
  expect(codeFromName('Data Fabric', [])).toBe('data-fabric')
  expect(codeFromName('  Data   Fabric!! ', ['DATA-FABRIC'])).toBe('data-fabric-2')
  expect(codeFromName('Data Fabric', ['data-fabric', 'data-fabric-2'])).toBe('data-fabric-3')
  expect(codeFromName('Café Ops', [])).toBe('cafe-ops')
  expect(codeFromName('???', [])).toBe('item')
})
