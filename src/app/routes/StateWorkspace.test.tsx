import { describe, expect, it } from 'vitest'
import { workspaceTabs } from './StateWorkspace'

// Central Ministries (stateCode 0, see CENTRAL_STATE_CODE in
// src/data/gov-hierarchy.ts) isn't a real jurisdiction, so it has no
// geography of its own — the Geography tab must not be offered for it, while
// a normal state's tab set is untouched. `workspaceTabs` is the single
// source both WorkspaceHeader's <Tabs> and the render guard for
// `<GeographyExplorer>` derive from (see StateWorkspace.tsx), so covering it
// here exercises the actual gating rule the UI uses, not a duplicate of it.
describe('workspaceTabs', () => {
  it('omits Geography for Central Ministries (isCentral: true)', () => {
    const values = workspaceTabs(true).map((t) => t.value)
    expect(values).toEqual(['org', 'people'])
    expect(values).not.toContain('geo')
  })

  it('includes Geography for a normal state (isCentral: false)', () => {
    const values = workspaceTabs(false).map((t) => t.value)
    expect(values).toEqual(['org', 'geo', 'people'])
  })
})
