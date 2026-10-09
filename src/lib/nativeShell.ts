import { Capacitor } from '@capacitor/core'

/** The ONE place the web app decides whether it runs inside the GOMS Android shell and what that shell can do (thin-shell design
 *  §4.3). Other code must not call `Capacitor.isNativePlatform()` to decide native availability. If the thin-shell web phase already
 *  created this file, keep its API and add only what is missing. */
export const KNOWN_SHELL_SCHEMES = ['com.gorms.app', 'com.gorms.app.dev'] as const
export type ShellCapability = 'secureStorage' | 'browser' | 'appLinks'

/** `since` = the first shell versionCode that contains the native pieces; `plugin` = the Capacitor plugin that must also be present. */
const CAPABILITIES: Record<ShellCapability, { since: number; plugin: string }> = {
  secureStorage: { since: 2, plugin: 'SecureStorage' },
  browser: { since: 2, plugin: 'Browser' },
  appLinks: { since: 2, plugin: 'App' },
}
const currentUa = (): string => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

export function shellVersion(ua: string = currentUa()): number | null {
  const m = /(?:^|\s)GOMSShell\/(\d+)(?:\s|$)/.exec(ua)
  return m ? Number(m[1]) : null
}
export function shellScheme(ua: string = currentUa()): (typeof KNOWN_SHELL_SCHEMES)[number] | null {
  const m = /(?:^|\s)GOMSScheme\/([a-z0-9.]+)(?:\s|$)/.exec(ua)
  return m && (KNOWN_SHELL_SCHEMES as readonly string[]).includes(m[1]) ? (m[1] as (typeof KNOWN_SHELL_SCHEMES)[number]) : null
}
export const isGomsShell = (ua?: string): boolean => shellVersion(ua) !== null

export function hasCapability(
  name: ShellCapability, ua: string = currentUa(), isPluginAvailable: (plugin: string) => boolean = (p) => Capacitor.isPluginAvailable(p),
): boolean {
  const version = shellVersion(ua)
  const c = CAPABILITIES[name]
  return version !== null && version >= c.since && isPluginAvailable(c.plugin)
}
