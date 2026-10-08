/** A tender portal (e.g. "E-Proc") saved in Settings, offered in a bid's
 *  General tab as the place to download bidding documents and corrigenda. */
export interface TenderWebsite {
  id: string
  name: string
  url: string
  createdAt: string
  updatedAt: string
  /** Encrypted together; the unlock passphrase is never stored. */
  credentials?: TenderCredentialLock | null
  dscEmployeeId?: string | null
}

export interface TenderCredentialLock {
  version: 1
  salt: string
  iv: string
  ciphertext: string
}

export interface TenderDscEmployee { id: string; name: string; level: number }

export interface TenderWebsiteInput {
  name: string
  url: string
  credentials?: TenderCredentialLock | null
  dscEmployeeId?: string | null
}

export const TENDER_WEBSITE_NAME_MAX = 100
export const TENDER_WEBSITE_URL_MAX = 2000

/** True only for an absolute http(s) URL — never javascript:, data:, etc. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname
  } catch {
    return false
  }
}

/** Trims and validates a website; throws with a user-facing message. */
export function normalizeTenderWebsiteInput(input: TenderWebsiteInput): TenderWebsiteInput {
  const name = (input.name ?? '').trim()
  const url = (input.url ?? '').trim()
  if (!name) throw new Error('Enter a name for the website.')
  if (name.length > TENDER_WEBSITE_NAME_MAX) throw new Error(`Keep the name under ${TENDER_WEBSITE_NAME_MAX} characters.`)
  if (url.length > TENDER_WEBSITE_URL_MAX) throw new Error('That link is too long.')
  if (!isHttpUrl(url)) throw new Error('Enter a full link starting with http:// or https://.')
  const result: TenderWebsiteInput = { name, url }
  if (input.credentials !== undefined) {
    const lock = input.credentials
    if (lock && (lock.version !== 1 || !/^[A-Za-z0-9+/]{22}==$/.test(lock.salt)
      || !/^[A-Za-z0-9+/]{16}$/.test(lock.iv) || lock.ciphertext.length > 32768
      || lock.ciphertext.length < 24 || !/^[A-Za-z0-9+/]+={0,2}$/.test(lock.ciphertext))) {
      throw new Error('Invalid credential lock. Unlock and save the credentials again.')
    }
    result.credentials = lock ? { version: 1, salt: lock.salt, iv: lock.iv, ciphertext: lock.ciphertext } : null
  }
  if (input.dscEmployeeId !== undefined) result.dscEmployeeId = input.dscEmployeeId?.trim() || null
  return result
}

/** Names are unique, ignoring case, so the General dropdown is unambiguous. */
export function assertUniqueTenderWebsiteName(existing: readonly Pick<TenderWebsite, 'id' | 'name'>[], name: string, ownId?: string): void {
  const clash = existing.some(site => site.id !== ownId && site.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (clash) throw new Error(`A website named "${name}" already exists.`)
}
