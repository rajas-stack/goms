import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

function readSecretJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { console.error('Cannot read mounted Docker secret JSON. Check the secret file format.'); process.exit(1) }
}

const secretsPath = '/run/secrets/api_config'
if (existsSync(secretsPath)) {
  const config = readSecretJson(secretsPath)
  for (const [key, value] of Object.entries(config)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && typeof value === 'string' && value) process.env[key] = value
  }
}
if (existsSync('/run/secrets/postgres_password')) {
  const password = readFileSync('/run/secrets/postgres_password', 'utf8').trim()
  const url = new URL(`postgresql://${process.env.POSTGRES_USER ?? 'goms'}@${process.env.POSTGRES_HOST ?? 'db'}:5432/${process.env.POSTGRES_DB ?? 'goms'}`)
  url.password = password
  process.env.DATABASE_URL = url.href
}
if (existsSync('/run/secrets/google_credentials')) {
  const credentials = readSecretJson('/run/secrets/google_credentials')
  if (credentials.type) process.env.GOOGLE_APPLICATION_CREDENTIALS = '/run/secrets/google_credentials'
}
if (existsSync('/run/secrets/onlyoffice_jwt')) process.env.ONLYOFFICE_JWT_SECRET = readFileSync('/run/secrets/onlyoffice_jwt', 'utf8').trim()
const args = process.argv[2] === 'migrate'
  // The API image keeps the npm workspace layout (apps/api/...); node-pg-migrate names migrations by file basename,
  // so the directory itself is not recorded in the pgmigrations table.
  ? ['node_modules/node-pg-migrate/bin/node-pg-migrate.js', 'up', '--migrations-dir', 'apps/api/migrations/**/*.sql', '--use-glob', '--no-verbose']
  : process.argv[2] === 'seed' ? ['node_modules/tsx/dist/cli.mjs', 'scripts/seed-import.ts'] : ['apps/api/dist/server.js']
const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
child.on('error', () => process.exit(1))
child.on('exit', code => process.exit(code ?? 1))
