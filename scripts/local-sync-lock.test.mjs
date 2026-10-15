import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { acquireFileLock } from './local-sync-lock.mjs'

const owner = { pid: process.pid, runId: 'test' }
const deadPid = spawnSync(process.execPath, ['-e', '']).pid
assert.throws(() => process.kill(deadPid, 0), { code: 'ESRCH' })

function fixture(t) {
  const prefix = join(resolve(tmpdir()), 'goms-sync-lock-')
  const dir = mkdtempSync(prefix)
  t.after(() => {
    assert.ok(resolve(dir).startsWith(prefix))
    rmSync(dir, { recursive: true, force: true })
  })
  return join(dir, 'sync.lock')
}

test('creates an exclusive lock with complete ownership metadata', t => {
  const file = fixture(t)
  assert.equal(acquireFileLock(file, owner), true)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), owner)
  assert.equal(acquireFileLock(file, owner), false)
})

test('recovers a dead owner and removes the recovery guard', t => {
  const file = fixture(t)
  writeFileSync(file, JSON.stringify({ pid: deadPid }))
  assert.equal(acquireFileLock(file, owner), true)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), owner)
  assert.equal(existsSync(`${file}.reclaim`), false)
})

test('another reclaimer cannot delete a lock while recovery is in progress', t => {
  const file = fixture(t)
  const original = JSON.stringify({ pid: deadPid })
  writeFileSync(file, original)
  writeFileSync(`${file}.reclaim`, JSON.stringify(owner))
  assert.equal(acquireFileLock(file, owner), false)
  assert.equal(readFileSync(file, 'utf8'), original)
})

for (const data of ['', '{', '{}', 'null', '{"pid":0}', '{"pid":null}']) {
  test(`does not reclaim incomplete or invalid ownership ${JSON.stringify(data)}`, t => {
    const file = fixture(t)
    writeFileSync(file, data)
    assert.equal(acquireFileLock(file, owner), false)
    assert.equal(readFileSync(file, 'utf8'), data)
  })
}
