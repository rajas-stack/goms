import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

// Print locations only; never echo a matching credential into build logs.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const signatures = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/,
  /["']private_key["']\s*:\s*["']-----BEGIN/,
]
let failures = 0
for (const file of files) {
  if (!/\.(?:[cm]?js|[cm]?tsx?|json|ya?ml|tf|md|pem|key)$/.test(file) && !file.includes('.env')) continue
  if (/^(?:src\/assets|public\/(?:village-shapes|geo|villages))\//.test(file)) continue
  try {
    if (statSync(file).size > 1024 * 1024) continue
    const contents = readFileSync(file, 'utf8')
    if (contents.includes('\0')) continue
    contents.split('\n').forEach((line, index) => {
      if (signatures.some(pattern => pattern.test(line))) { console.error(`Possible private credential: ${file}:${index + 1}`); failures++ }
    })
  } catch { /* Deleted tracked files are handled by Git. */ }
}
const hosting = JSON.parse(readFileSync('firebase.json', 'utf8'))
const csp = hosting.hosting.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy')?.value ?? ''
for (const directive of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
  if (!csp.includes(directive)) { console.error(`Missing CSP directive: ${directive}`); failures++ }
}
if (/script-src[^;]*'unsafe-inline'/.test(csp)) { console.error('Inline scripts must not be allowed by CSP.'); failures++ }
if (failures) process.exitCode = 1
else console.log('Tracked-source credential patterns and hosting policy checks passed.')
