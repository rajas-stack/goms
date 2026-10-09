import { describe, expect, it } from 'vitest'
import { KNOWN_SHELL_SCHEMES, hasCapability, isGomsShell, shellScheme, shellVersion } from './nativeShell'

const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'
const SHELL2_PROD = `${CHROME} GOMSShell/2 GOMSScheme/com.gorms.app`
const SHELL2_DEV = `${CHROME} GOMSShell/2 GOMSScheme/com.gorms.app.dev`

describe('shell detection (a plain browser and an old APK are not the shell)', () => {
  it('reads the version and scheme the native shell appends to the user agent', () => {
    expect(shellVersion(SHELL2_PROD)).toBe(2); expect(shellScheme(SHELL2_PROD)).toBe('com.gorms.app'); expect(isGomsShell(SHELL2_PROD)).toBe(true)
    expect(shellScheme(SHELL2_DEV)).toBe('com.gorms.app.dev')
  })
  it('is null / false for a browser, the old bundled-app APK (no token) and garbage', () => {
    for (const ua of [CHROME, '', 'GOMSShell/', 'GOMSShell/x', 'XGOMSShell/2']) { expect(shellVersion(ua)).toBeNull(); expect(isGomsShell(ua)).toBe(false) }
  })
  it('only knows the two real schemes', () => {
    expect([...KNOWN_SHELL_SCHEMES]).toEqual(['com.gorms.app', 'com.gorms.app.dev'])
    expect(shellScheme(`${CHROME} GOMSShell/2 GOMSScheme/evil.app`)).toBeNull()
    expect(shellScheme(`${CHROME} GOMSShell/2`)).toBeNull()
  })
})

describe('hasCapability needs BOTH a shell new enough AND the plugin actually present', () => {
  const plugins = (...names: string[]) => (p: string) => names.includes(p)
  it('true only when version >= since and the plugin is available', () => {
    expect(hasCapability('secureStorage', SHELL2_PROD, plugins('SecureStorage'))).toBe(true)
    expect(hasCapability('browser', SHELL2_PROD, plugins('Browser'))).toBe(true)
    expect(hasCapability('appLinks', SHELL2_PROD, plugins('App'))).toBe(true)
  })
  it('false for a missing plugin, an older shell, or no shell at all', () => {
    expect(hasCapability('secureStorage', SHELL2_PROD, plugins())).toBe(false)
    expect(hasCapability('secureStorage', `${CHROME} GOMSShell/1 GOMSScheme/com.gorms.app`, plugins('SecureStorage'))).toBe(false)
    expect(hasCapability('secureStorage', CHROME, plugins('SecureStorage'))).toBe(false)
  })
})
