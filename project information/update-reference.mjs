import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const folder = dirname(fileURLToPath(import.meta.url))
const root = resolve(folder, '..')
const read = file => readFileSync(file, 'utf8')
const parse = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
const link = file => relative(folder, file).replaceAll('\\', '/')
function declaration(source, name) {
  let found
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node; ts.forEachChild(node, visit) }
  visit(source)
  return found?.initializer
}
function properties(call) { return call && ts.isCallExpression(call) && ts.isObjectLiteralExpression(call.arguments[0]) ? call.arguments[0].properties.filter(ts.isPropertyAssignment) : [] }
function routes(call, prefix) {
  return properties(call).flatMap(property => {
    const path = `${prefix}.${property.name.text ?? property.name.getText()}`
    const init = property.initializer
    if (!ts.isCallExpression(init)) return []
    if (ts.isPropertyAccessExpression(init.expression) && ['query', 'mutation'].includes(init.expression.name.text)) return [{ path, kind: init.expression.name.text }]
    return routes(init, path)
  })
}
const apiIndex = resolve(root, 'apps/api/src/index.ts')
const apiSource = parse(apiIndex)
const imports = new Map()
for (const statement of apiSource.statements) {
  if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue
  for (const element of statement.importClause.namedBindings.elements) imports.set(element.name.text, resolve(dirname(apiIndex), statement.moduleSpecifier.text.replace(/\.js$/, '.ts')))
}
let api = '# API reference\n\nGenerated from the current working source. The backend uses Fastify and tRPC; the frontend consumes the exported `AppRouter` type.\n\n## Transport and identity\n\nThe tRPC endpoint is `/api/trpc/<namespace.procedure>`. Queries use the tRPC query transport; mutations use POST. Use the application tRPC client for input encoding, batching and authenticated requests rather than inventing REST paths. Identity is sent as a Bearer token and verified through the configured Firebase or GOMS OAuth provider. Procedure-specific authentication and server RBAC still apply. `/api/trpc/health.check` verifies database connectivity.\n\n## Router modules\n\n| Namespace | Source | Procedure count |\n| --- | --- | --- |\n'
const inventory = []
for (const property of properties(declaration(apiSource, 'appRouter'))) {
  const name = property.name.text
  const binding = property.initializer.getText(apiSource)
  const file = imports.get(binding)
  if (!file) continue
  const source = parse(file)
  const endpoints = routes(declaration(source, binding), name)
  inventory.push(...endpoints)
  api += `| \`${name}\` | [${basename(file)}](${link(file)}) | ${endpoints.length} |\n`
}
api += '\n## Procedure inventory\n\n| Procedure | Operation |\n| --- | --- |\n'
for (const endpoint of inventory) api += `| \`${endpoint.path}\` | ${endpoint.kind} |\n`
api += '\n## Additional HTTP routes\n\n'
for (const file of [resolve(root, 'apps/api/src/auth/oauth/routes.ts'), ...readdirSync(resolve(root, 'apps/api/src/routes')).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => resolve(root, 'apps/api/src/routes', file))]) {
  for (const match of read(file).matchAll(/\b(?:app|fastify)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) api += `- \`${match[1].toUpperCase()} ${match[2]}\` — [${basename(file)}](${link(file)})\n`
}
api += '\nRoutes may be registered conditionally, depending on provider/configuration. For full input schemas, return types, pagination and validation rules, read the linked router source and `apps/api/src/trpc.ts`; this inventory does not replace those contracts.\n'
writeFileSync(resolve(folder, 'API.md'), api)

function sqlFiles(folder) { return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sqlFiles(resolve(folder, entry.name)) : entry.name.endsWith('.sql') ? [resolve(folder, entry.name)] : []) }
const migrations = sqlFiles(resolve(root, 'apps/api/migrations')).sort((a, b) => basename(a).localeCompare(basename(b)))
let schema = '# Database schema reference\n\nPostgreSQL stores the server data. The API uses `pg`, parameterized SQL and transactions; `node-pg-migrate` tracks schema changes. This document is generated from migration source, not a live database inspection. Tables can gain columns, constraints and indexes in later migrations; read the ordered SQL reference for those changes.\n\n## Table creation index\n\n| Table | Creation migration |\n| --- | --- |\n'
let sql = '-- GOMS forward migration reference, generated from the current working source.\n-- Use the project migration runner to apply migrations; this reference is not a live database dump.\n\n'
let tableCount = 0
for (const file of migrations) {
  const forward = read(file).split(/--\s*Down Migration/i)[0]
  sql += `-- Source: ${relative(root, file).replaceAll('\\', '/')}\n${forward.trim()}\n\n`
  for (const match of forward.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) { schema += `| \`${match[1].replaceAll('"', '')}\` | [${basename(file)}](${link(file)}) |\n`; tableCount++ }
}
schema += '\n## Principal relationships\n\nHierarchy nodes form a parent/child tree. Employees belong to hierarchy nodes and may report to other employees. Charges, timeline events and transfers link to employees. Sales postings link to sales persons. Opportunities link to department hierarchy nodes, and bids link to opportunities. Milestones, corrigenda, custom field values and synopsis records extend bid/opportunity workflows. Commercial BOQs have line items, SKUs have BOM items, documents have citations, and OAuth session tables support authentication. Polymorphic links such as ownership and entity-based documents must be interpreted using their entity-type fields, not assumed to be conventional foreign keys.\n\n## Complete migration order\n\n'
for (const file of migrations) schema += `- [${basename(file)}](${link(file)})\n`
schema += '\nThe authoritative forward DDL is collected in [Database migrations.sql](<Database migrations.sql>). For the exact schema actually installed on a running server, use PostgreSQL schema inspection or a schema-only `pg_dump` against that database.\n'
writeFileSync(resolve(folder, 'Database schema.md'), schema)
writeFileSync(resolve(folder, 'Database migrations.sql'), sql)
console.log(`Documentation refreshed: ${inventory.length} API procedures, ${tableCount} table declarations, ${migrations.length} migrations.`)
