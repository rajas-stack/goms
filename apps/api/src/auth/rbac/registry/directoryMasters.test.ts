import { describe, expect, it } from 'vitest'
import { commercialPolicy } from './commercial.js'
import type { Requirement } from './types.js'

const requirement = (path: string, raw: unknown) => commercialPolicy[path].requirements[0](raw, {} as Parameters<Requirement>[1]) // these rules ignore who asks

describe('Directory company masters', () => {
  it('are kept by contact maintainers (am.contacts); every other master stays with the commercial team', () => {
    for (const key of ['oemCompanies', 'consortiumPartners']) {
      expect(requirement('commercial.masters.create', { key })).toEqual({ module: 'am.contacts', action: 'create' })
      expect(requirement('commercial.masters.update', { key })).toEqual({ module: 'am.contacts', action: 'update' })
      expect(requirement('commercial.masters.delete', { key })).toEqual({ module: 'am.contacts', action: 'delete' })
      expect(requirement('commercial.masters.list', { key })).toEqual({ module: 'am.contacts', action: 'read' })
    }
    expect(requirement('commercial.masters.create', { key: 'verticals' })).toEqual({ module: 'com.masters', action: 'create' })
    expect(requirement('commercial.masters.update', { key: 'verticals' })).toMatchObject({ module: 'com.masters', action: 'update' })
  })
})
