/** Mirrors `nameKey` in apps/api/src/profileImages/mapping.ts so a name-only avatar
 *  resolves the same photo the server matched: case, titles, accents and punctuation are ignored. */
export const profileNameKey = (value: string): string =>
  value.normalize('NFKC').trim().toLowerCase()
    .replace(/^(mr|mrs|ms|dr)\.?\s+/i, '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
