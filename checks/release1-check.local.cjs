// goms prod RELEASE 1 schema/state check (v2)  --  STRICTLY READ ONLY (BEGIN READ ONLY + read-only session default; every statement below is SELECT / SHOW / SET LOCAL / BEGIN READ ONLY / ROLLBACK).
// CHECK_MODE=pre  (default): immediately BEFORE the migration: the 59 release-8 migrations, in execution order, last = 1791764800000_amnex-departments;
//                            google_integration_settings has exactly user_uid,email,settings,updated_at and NO google_sub column / index.
// CHECK_MODE=post          : AFTER the migration: those 59 + the link IN THAT ORDER, last = 1791764900000_google-integration-sub-link;
//                            google_sub column present and the partial unique index defined exactly as the migration creates it.
// FAIL CLOSED. The verdict is MATCHES_EXPECTED_STATE only if EVERY condition holds; any other outcome (including an error) prints DEVIATION_STOP with
// fixed reason strings and exits with status 2, so the Cloud Run job execution itself fails. Nothing after a failed identity/session guard is read.
// Prints ONLY: identity, counts, migration names (a diff), column names, booleans, fixed reasons. Never row contents, emails, uids, subjects or the connection string.
const { Client } = require('pg')
const BASE = ["1787561719008_customers","1787631449862_hierarchy-nodes","1787635740835_employees","1787639705341_sales","1787645325426_commercial-masters","1787647096930_commercial-skus-bom","1787650774037_commercial-boq","1787654497473_opportunities-ownership-followups","1787660000000_ownership-one-open-owner","1787741760367_admin-import-runs","1787750000000_admin-import-hardening","1788000000000_admin-import-actor-email","1788100000000_timeline-events-agenda-outcome-nextsteps","1788200000000_sales-postings-gm-override","1788300000000_sales-persons-photo","1788400000000_bid-number-sequences-and-bids","1788500000000_bid-milestones","1788600000000_documents","1788700000000_bid-corrigenda","1788800000000_protected-values","1788900000000_bid-saved-views","1789000000000_commercial-boqs-opportunity-id","1789100000000_ownership-one-open-solution-lead","1789200000000_bid-custom-fields","1789300000000_bid-custom-field-values","1789400000000_opportunities-city","1789500000000_bid-custom-fields-has-held-value","1789600000000_opportunities-department-optional","1789700000000_bid-custom-field-types","1789800000000_bid-saved-view-sheet","1789900000000_bid-custom-field-sheet","1790000000000_opportunities-reference-assignment","1790100000000_delivery-teams-opportunity-assignments","1790200000000_delivery-team-members-manager","1790300000000_pre-sales-roster","1790400000000_opportunity-code","1790500000000_bid-sheet","1790600000000_legal-roster","1790700000000_org-people","1790800000000_rbac-role-overrides","1790900000000_rbac-created-by-and-email-indexes","1791000000000_rbac-seen-users","1791100000000_oauth-sessions","1791244800000_bid-synopsis","1791331200000_bid-synopsis-general","1791417600000_tender-websites","1791504000000_bid-corrigendum-register","1791590400000_tender-website-credentials","1791676800000_tender-website-edit-lock","1791763200000_website-kind","1791763500000_credential-passphrases","1791763800000_google-integrations","1791763900000_bid-document-batches","1791764000000_security-events","1791764300000_maker-documents","1791764400000_bid-synopsis-competition","1791764500000_competitors","1791764700000_rbac-tree","1791764800000_amnex-departments"] // the expected release-8 ledger: 59 names in the order node-pg-migrate applies them (ascending by name)
const LINK = '1791764900000_google-integration-sub-link'
const MODE = (process.env.CHECK_MODE || 'pre').toLowerCase()
const EXPECTED = MODE === 'post' ? [...BASE, LINK] : BASE
const EXPECTED_LAST = EXPECTED[EXPECTED.length - 1]
const COLS = MODE === 'post' ? ['user_uid', 'email', 'settings', 'updated_at', 'google_sub'] : ['user_uid', 'email', 'settings', 'updated_at']
const INDEX_DEF = 'CREATE UNIQUE INDEX google_integration_settings_google_sub_key ON public.google_integration_settings USING btree (google_sub) WHERE (google_sub IS NOT NULL)'
// Production identity (read directly on 2026-10-14: database goms, role goms_app, PG 16.14, not a replica).
// The expectation can be overridden ONLY to name a disposable database (goms_tmp_*), which is how the tests run; production can never match that name,
// so an override on production fails closed.
let EXPECT_DB = 'goms'
let EXPECT_ROLE = 'goms_app'
let overrideRejected = false
if (process.env.CHECK_EXPECT_DB !== undefined || process.env.CHECK_EXPECT_ROLE !== undefined) {
  if (/^goms_tmp_[a-z0-9_]+$/.test(process.env.CHECK_EXPECT_DB || '')) {
    EXPECT_DB = process.env.CHECK_EXPECT_DB
    if (process.env.CHECK_EXPECT_ROLE) EXPECT_ROLE = process.env.CHECK_EXPECT_ROLE
  } else overrideRejected = true
}
const out = (o) => console.log('REL1CHECK ' + JSON.stringify(o))
const stop = (reasons) => { out({ verdict: 'DEVIATION_STOP', reasons }); process.exitCode = 2 }
;(async () => {
  if (MODE !== 'pre' && MODE !== 'post') return stop(['CHECK_MODE must be pre or post'])
  if (overrideRejected) return stop(['expectation override rejected: only a goms_tmp_* database may be named'])
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 8000, application_name: 'goms-release1-check', options: '-c default_transaction_read_only=on' })
  await c.connect()
  try {
    await c.query('BEGIN READ ONLY')
    await c.query("SET LOCAL statement_timeout = '5s'"); await c.query("SET LOCAL lock_timeout = '2s'")
    const ro = (await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only
    const dro = (await c.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only
    const id = (await c.query('SELECT current_database() AS db, current_user AS role, current_setting($$server_version_num$$)::int AS ver, pg_is_in_recovery() AS replica')).rows[0]
    out({ mode: MODE, expected: { database: EXPECT_DB, role: EXPECT_ROLE }, identity: { database: id.db, role: id.role, serverVersionNum: id.ver, isReplica: id.replica, readOnlyTx: ro, defaultReadOnly: dro } })
    const guard = []
    if (id.db !== EXPECT_DB) guard.push('database is not the expected one')
    if (id.role !== EXPECT_ROLE) guard.push('role is not the expected one')
    if (id.replica !== false) guard.push('connection is a replica (or recovery state is not false)')
    if (ro !== 'on') guard.push('transaction is not read-only')
    if (dro !== 'on') guard.push('session default is not read-only')
    if (guard.length > 0) return stop(guard) // nothing further is read

    const reasons = []
    // ---- migration ledger, in ACTUAL EXECUTION ORDER (ledger id), exact sequence
    const names = (await c.query('SELECT name FROM pgmigrations ORDER BY id')).rows.map((r) => r.name)
    const seen = new Map()
    for (const n of names) seen.set(n, (seen.get(n) || 0) + 1)
    const duplicates = [...seen].filter(([, k]) => k > 1).map(([n]) => n)
    const wanted = new Set(EXPECTED)
    const unexpected = [...new Set(names.filter((n) => !wanted.has(n)))]
    const missing = EXPECTED.filter((n) => !seen.has(n))
    let firstMismatch = -1
    for (let i = 0; i < Math.max(names.length, EXPECTED.length); i++) if (names[i] !== EXPECTED[i]) { firstMismatch = i; break }
    const sequenceExact = firstMismatch === -1
    const lastApplied = names[names.length - 1]
    const linkIdx = names.indexOf(LINK)
    const orderOk = names.filter((n) => n !== LINK).every((n) => n < LINK) && (MODE === 'post' ? linkIdx === names.length - 1 && names.lastIndexOf(LINK) === linkIdx : linkIdx === -1)
    out({ migrations: { applied: names.length, expected: EXPECTED.length, duplicates, unexpected, missing, sequenceExact,
      firstMismatchIndex: firstMismatch, firstMismatchExpected: firstMismatch === -1 ? null : (EXPECTED[firstMismatch] ?? null), firstMismatchActual: firstMismatch === -1 ? null : (names[firstMismatch] ?? null),
      lastApplied, expectedLast: EXPECTED_LAST, lastOk: lastApplied === EXPECTED_LAST, linkApplied: linkIdx !== -1, orderOk } })
    if (names.length !== EXPECTED.length) reasons.push('migration count differs from expected')
    if (duplicates.length > 0) reasons.push('duplicate migration names in the ledger')
    if (unexpected.length > 0) reasons.push('unexpected migration names in the ledger')
    if (missing.length > 0) reasons.push('expected migrations missing from the ledger')
    if (!sequenceExact) reasons.push('ledger execution order differs from the expected sequence')
    if (lastApplied !== EXPECTED_LAST) reasons.push('last applied migration is not the expected one')
    if (!orderOk) reasons.push('migration-order condition failed (link position / names above the link)')

    // ---- schema
    const cols = (await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='google_integration_settings' ORDER BY ordinal_position")).rows.map((r) => r.column_name)
    const idxRows = (await c.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='google_integration_settings_google_sub_key'")).rows
    const idxCount = idxRows.length
    const idxDefOk = idxCount === 1 && idxRows[0].indexdef === INDEX_DEF
    const rows = (await c.query('SELECT count(*)::int n FROM google_integration_settings')).rows[0].n
    const columnsExact = cols.join() === COLS.join()
    out({ googleIntegrationSettings: { columnsExact, missingColumns: COLS.filter((x) => !cols.includes(x)), unexpectedColumns: cols.filter((x) => !COLS.includes(x)), subIndexPresent: idxCount === 1, subIndexDefinitionExact: idxDefOk, rows } })
    if (!columnsExact) reasons.push('google_integration_settings columns differ from expected')
    if (MODE === 'post' ? !idxDefOk : idxCount !== 0) reasons.push(MODE === 'post' ? 'google_sub index missing or not defined exactly as the migration creates it' : 'google_sub index present before the migration')

    // ---- locks
    const waiting = (await c.query("SELECT count(*)::int n FROM pg_locks l JOIN pg_class k ON k.oid = l.relation WHERE k.relname = 'google_integration_settings' AND NOT l.granted")).rows[0].n
    const longTx = (await c.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid() AND xact_start < now() - interval '1 minute'")).rows[0].n
    out({ locks: { waitingOnSettingsTable: waiting, transactionsOlderThan1min: longTx } })
    if (waiting > 0) reasons.push('sessions are waiting on a lock on google_integration_settings')

    if (reasons.length > 0) stop(reasons)
    else out({ verdict: 'MATCHES_EXPECTED_STATE' })
  } finally { await c.query('ROLLBACK').catch(() => {}); await c.end().catch(() => {}) }
  out({ done: true })
})().catch((e) => { out({ failed: true, name: String((e && e.name) || 'Error').slice(0, 40), code: String((e && e.code) || '').slice(0, 20) }); stop(['the check could not complete']) })
