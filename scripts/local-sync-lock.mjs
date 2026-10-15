import { openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from 'node:fs'

function create(lockFile, owner) {
  let handle
  try { handle = openSync(lockFile, 'wx') }
  catch (error) { if (error.code === 'EEXIST') return false; throw error }
  try { writeFileSync(handle, JSON.stringify(owner)) }
  finally { closeSync(handle) }
  return true
}

function stale(lockFile) {
  let owner
  // A new owner's file can be temporarily empty; unreadable ownership is not stale.
  try { owner = JSON.parse(readFileSync(lockFile, 'utf8')) } catch { return false }
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) return false
  try { process.kill(owner.pid, 0); return false }
  catch (error) { if (error.code === 'ESRCH') return true; throw error }
}

export function acquireFileLock(lockFile, owner) {
  if (create(lockFile, owner)) return true
  if (!stale(lockFile)) return false
  const recovery = `${lockFile}.reclaim`
  if (!create(recovery, owner)) return false
  try {
    // Serialize recovery and recheck, so two reclaimers cannot unlink a new owner.
    if (!stale(lockFile)) return false
    try { unlinkSync(lockFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
    return create(lockFile, owner)
  } finally {
    unlinkSync(recovery)
  }
}
