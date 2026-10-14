// Regenerates packages/domain/src/rbac/tree/manifest.generated.ts from the permission-tree declarations in src/
// (see src/lib/rbacTree/manifest.test.tsx), then rebuilds @goms/domain so the API and the web app see it.
import { spawnSync } from 'node:child_process'

const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.component.config.ts', 'src/lib/rbacTree/manifest.test.tsx', '-t', 'is up to date'], { RBAC_MANIFEST_WRITE: '1' })
run(['node_modules/typescript/bin/tsc', '-p', 'packages/domain/tsconfig.json'])
