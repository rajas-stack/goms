import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RBAC_NODE_MANIFEST } from '@goms/domain'
import { collectManifest, renderManifest, sourceFiles } from './collect'

/**
 * The guarantee that UI changes keep the permission tree in sync (docs/superpowers/specs/2026-10-14-dynamic-rbac-design.md §3).
 * `npm run rbac:manifest` runs this file with RBAC_MANIFEST_WRITE=1 to regenerate the manifest instead of asserting.
 */
const MANIFEST_FILE = resolve(process.cwd(), 'packages/domain/src/rbac/tree/manifest.generated.ts')

/** Tab / section arrays not yet passed through definePermissionNodes. Shrink this list; never grow it. */
const PENDING_DECLARATION_SITES = [
  '/src/app/routes/Insights.tsx', '/src/app/routes/SalesWorkspace.tsx', '/src/app/routes/TeamsWorkspace.tsx',
  '/src/modules/commercial-calculator/pages/SkuCatalog.tsx', '/src/modules/commercial-calculator/components/BoqWorkspaceHeader.tsx',
  // Legacy, unrouted Role & Access screen (replaced by Settings > Roles & Access).
  '/src/modules/admin-access/AccessManagement.tsx', '/src/modules/admin-access/access-matrix/matrixModel.ts',
]

describe('permission-tree manifest', () => {
  it('is up to date with every declaration (run `npm run rbac:manifest` after changing tabs, sections or routes)', async () => {
    const { nodes } = await collectManifest()
    if (process.env.RBAC_MANIFEST_WRITE === '1') {
      writeFileSync(MANIFEST_FILE, renderManifest(nodes))
      return
    }
    expect(nodes).toEqual(RBAC_NODE_MANIFEST)
  }, 120_000)

  it('gives every routed page a node that exists', async () => {
    const { nodes, routes } = await collectManifest()
    const ids = new Set(nodes.map((n) => n.id))
    const pages = routes.filter((r) => !r.redirect && r.path !== '*' && r.path !== '/login')
    expect(pages.filter((r) => !r.nodeId).map((r) => r.path)).toEqual([])
    expect(pages.filter((r) => r.nodeId && !ids.has(r.nodeId)).map((r) => `${r.path} -> ${r.nodeId}`)).toEqual([])
  }, 120_000)

  it('has no tab / section array that skips definePermissionNodes', () => {
    const offending = Object.entries(sourceFiles())
      .filter(([path]) => !path.includes('.test.') && !PENDING_DECLARATION_SITES.includes(path))
      .filter(([, text]) => /^\s*(export\s+)?const\s+\w*(TABS|SECTIONS)\b[^=\n]*=\s*(?!\s)(?!definePermissionNodes\()/m.test(text))
      .map(([path]) => path)
    expect(offending).toEqual([])
  })

  it('declares well-formed, unique ids whose parents exist', () => {
    const ids = RBAC_NODE_MANIFEST.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const n of RBAC_NODE_MANIFEST) {
      if (n.parentId) expect(ids, n.id).toContain(n.parentId)
      expect(n.id.startsWith(n.parentId ? `${n.parentId}.` : '')).toBe(true)
    }
  })
})
