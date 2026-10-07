import { afterEach, describe, expect, it } from 'vitest'
import { rbacMode } from './mode.js'

afterEach(() => { delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.RBAC_MODE })

describe('rbacMode', () => {
  it('defaults to off', () => { expect(rbacMode()).toBe('off') })
  it('is off whenever auth is not enforced, whatever RBAC_MODE says', () => {
    process.env.RBAC_MODE = 'enforce'
    expect(rbacMode()).toBe('off')
  })
  it('reads shadow and enforce once auth is enforced', () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.RBAC_MODE = 'shadow'
    expect(rbacMode()).toBe('shadow')
    process.env.RBAC_MODE = 'enforce'
    expect(rbacMode()).toBe('enforce')
  })
  it('treats a typo as off rather than guessing', () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.RBAC_MODE = 'enforced'
    expect(rbacMode()).toBe('off')
  })
})
