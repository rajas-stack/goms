import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const secrets = resolve(root, '.docker/secrets')
mkdirSync(secrets, { recursive: true, mode: 0o700 })
if (process.platform !== 'win32') chmodSync(secrets, 0o700)
// The private directory protects host access; readable secret mounts support the non-root API user.
const create = (name, value) => { const path = resolve(secrets, name); if (!existsSync(path)) writeFileSync(path, value, { mode: 0o644, flag: 'wx' }) }
create('postgres_password', randomBytes(32).toString('hex'))
create('api.json', JSON.stringify({ AUTH_SESSION_SECRET: randomBytes(48).toString('base64'), GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', JEV_API_KEY: '' }, null, 2) + '\n')
create('google_credentials.json', '{}\n')
console.log('Docker secret files are ready in .docker/secrets. Existing secrets were preserved.')
