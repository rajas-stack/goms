import { createHash, randomBytes } from 'node:crypto'

/** Cryptographically random, URL-safe. 32 bytes -> 43 chars (also a valid RFC 7636 verifier length). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

/** Only this hash of a refresh token / exchange code / state is ever stored. */
export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

/** RFC 7636 S256. Used ONLY between the API and Google. */
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')
