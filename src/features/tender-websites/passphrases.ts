import { useQuery } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import { lockCredentials, unlockCredentials } from './credentialLock'
import type { CredentialPassphrase } from '@goms/domain'

export const PASSPHRASES_KEY = ['credentialPassphrases'] as const
export const useCredentialPassphrases = () => useQuery({ queryKey: PASSPHRASES_KEY, queryFn: () => repository.listCredentialPassphrases() })
export const createPassphraseProof = (value: string) => lockCredentials({ userId: '', password: '' }, value)
export async function verifyPassphrase(record: CredentialPassphrase, value: string) {
  await unlockCredentials(record.proof, value)
}
