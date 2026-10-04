export function normalizeEmail(value: string, inferMissingAt = false): string {
  let normalized = value
    .replace(/\[\s*(at|dot)\s*\]|\(\s*(at|dot)\s*\)|\{\s*(at|dot)\s*\}|\s+(at|dot)\s+/gi, (token) => {
      const word = token.replace(/[\[\](){}\s]/g, '').toLowerCase()
      return word === 'at' ? '@' : '.'
    })
    .replace(/\s*@\s*/g, '@')
    .replace(/\s*\.\s*/g, '.')
    .replace(/[\[\]{}()]/g, '')
    .trim()
    .replace(/[\],;]+$/g, '')

  if (inferMissingAt && !normalized.includes('@')) {
    const domainOnly = normalized.match(/^([^.]+)\.(.+\.[^.]+)$/)
    if (domainOnly) normalized = `${domainOnly[1]}@${domainOnly[2]}`
  }
  return normalized
}