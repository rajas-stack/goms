import { normalizeTenderWebsiteInput, type TenderCredentialLock } from './tenderWebsites.js'

export const MAX_CREDENTIAL_PASSPHRASES = 5
/** Only an encrypted empty verification envelope is saved, never the passphrase. */
export interface CredentialPassphrase { id: string; name: string; proof: TenderCredentialLock; updatedAt: string }
export interface CredentialPassphraseInput { name: string; proof: TenderCredentialLock }
export interface CredentialReplacement { id: string; previousCiphertext: string; credentials: TenderCredentialLock }
export interface CredentialPassphraseUpdate extends CredentialPassphraseInput {
  id: string; expectedUpdatedAt: string; replacements: CredentialReplacement[]
}
export function normalizeCredentialPassphrase(input: CredentialPassphraseInput): CredentialPassphraseInput {
  const name = input.name.trim()
  if (!name || name.length > 100) throw new Error('Enter a passphrase name of 1–100 characters.')
  const proof = normalizeTenderWebsiteInput({ name, url: 'https://credentials.invalid', credentials: input.proof }).credentials!
  if (proof.passphraseId) throw new Error('Invalid passphrase verification envelope.')
  return { name, proof }
}
