// DEV-ONLY, TARGETED cleanup of the Bid Tracker verification test data.
//
// Roots (the ONLY things this ever selects by name):
//   opportunities  WHERE opportunity_name LIKE 'ZBT-SMOKE%'
//   custom columns WHERE name LIKE 'ZBT %'
//   saved views    WHERE name LIKE 'ZBT %'
// Everything else deleted is reachable ONLY from those roots by id (their bids, milestones, corrigenda,
// documents, citations, protected values, follow-ups, ownership, stage changes, audit rows about them).
//
// Safety:
//   * Refuses to run unless the Cloud Run job's project (metadata server) is exactly `goms-dev`.
//   * DRY RUN by default: runs the real deletes inside a transaction and ROLLS BACK, printing exact row counts.
//     Pass --execute to COMMIT. Nothing is ever committed without it.
//   * Aborts (rollback) if the matched sets exceed sanity caps, if any matched opportunity/field/view lacks the
//     prefix, or if the NON-ZBT row counts of opportunities/bids/custom fields change by even one row.
//   * Prints ids/names/counts only. Documents' GCS object paths are printed so the exact objects can be removed
//     with `gcloud storage rm` (this script does not touch GCS).
//
// Run (dev ONLY) through the goms-migrate Cloud Run job's per-execution args, never by changing the job.
const { Client } = require('pg')
const http = require('http')

const EXECUTE = process.argv.includes('--execute')
const CAP = { opps: 300, fields: 60, views: 60 }
const tag = (s) => console.log('ZBTCLEAN ' + s)

function metadataProject() {
  return new Promise((resolve) => {
    const req = http.get({ host: 'metadata.google.internal', path: '/computeMetadata/v1/project/project-id', headers: { 'Metadata-Flavor': 'Google' }, timeout: 4000 }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve(d.trim()))
    })
    req.on('error', () => resolve('')); req.on('timeout', () => { req.destroy(); resolve('') })
  })
}

;(async () => {
  const project = await metadataProject()
  if (project !== 'goms-dev') { tag(`REFUSING: project is "${project || 'unknown'}", this script only runs in goms-dev`); process.exit(2) }
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  const one = async (sql, p) => (await c.query(sql, p)).rows
  const ids = (rows, k = 'id') => rows.map((r) => r[k])
  tag(`project=${project} db=${(await one('SELECT current_database() d'))[0].d} mode=${EXECUTE ? 'EXECUTE (will COMMIT)' : 'DRY RUN (will ROLL BACK)'}`)

  await c.query('BEGIN')
  try {
    // ---- baseline of NON-ZBT rows, to prove they are untouched ----
    const base = (await one(`SELECT
      (SELECT count(*) FROM opportunities WHERE opportunity_name NOT LIKE 'ZBT-SMOKE%')::int nz_opps,
      (SELECT count(*) FROM bids b JOIN opportunities o ON o.id=b.opportunity_id WHERE o.opportunity_name NOT LIKE 'ZBT-SMOKE%')::int nz_bids,
      (SELECT count(*) FROM bid_custom_fields WHERE name NOT LIKE 'ZBT %')::int nz_fields,
      (SELECT count(*) FROM bid_saved_views WHERE name NOT LIKE 'ZBT %')::int nz_views,
      (SELECT count(*) FROM documents d WHERE d.entity_type='bid' AND d.entity_id NOT IN (SELECT b.id FROM bids b JOIN opportunities o ON o.id=b.opportunity_id WHERE o.opportunity_name LIKE 'ZBT-SMOKE%'))::int nz_docs,
      (SELECT count(*) FROM commercial_audit_logs)::int audit_total`))[0]

    // ---- roots ----
    const opps = await one(`SELECT id, opportunity_name FROM opportunities WHERE opportunity_name LIKE 'ZBT-SMOKE%'`)
    const fields = await one(`SELECT id, name, status FROM bid_custom_fields WHERE name LIKE 'ZBT %'`)
    const views = await one(`SELECT id, name FROM bid_saved_views WHERE name LIKE 'ZBT %'`)
    if (opps.length > CAP.opps || fields.length > CAP.fields || views.length > CAP.views) throw new Error(`matched sets exceed sanity caps: ${opps.length}/${fields.length}/${views.length}`)
    if (opps.some((o) => !o.opportunity_name.startsWith('ZBT-SMOKE')) || fields.some((f) => !f.name.startsWith('ZBT ')) || views.some((v) => !v.name.startsWith('ZBT '))) throw new Error('a root lacks the ZBT prefix')
    const oppIds = ids(opps)
    const bids = oppIds.length ? await one('SELECT id, bid_code FROM bids WHERE opportunity_id = ANY($1)', [oppIds]) : []
    const bidIds = ids(bids)
    const fieldIds = ids(fields), viewIds = ids(views)
    const corr = bidIds.length ? await one('SELECT id FROM bid_corrigenda WHERE bid_id = ANY($1)', [bidIds]) : []
    const corrIds = ids(corr)
    const chg = corrIds.length ? await one('SELECT id FROM bid_corrigendum_changes WHERE corrigendum_id = ANY($1)', [corrIds]) : []
    const docs = bidIds.length ? await one(`SELECT id, storage_path FROM documents WHERE entity_type='bid' AND entity_id = ANY($1)`, [bidIds]) : []
    const docIds = ids(docs)

    tag(`ROOTS: ${opps.length} opportunities, ${fields.length} custom columns, ${views.length} saved views`)
    opps.forEach((o) => tag(`  opp   ${o.id}  ${o.opportunity_name}`))
    bids.forEach((b) => tag(`  bid   ${b.id}  ${b.bid_code}`))
    fields.forEach((f) => tag(`  field ${f.id}  ${f.name} (${f.status})`))
    views.forEach((v) => tag(`  view  ${v.id}  ${v.name}`))
    docs.forEach((d) => tag(`  GCS object to remove afterwards: ${d.storage_path}`))

    // ---- deletes, children before parents (FK order) ----
    const allIds = [...oppIds, ...bidIds, ...corrIds, ...ids(chg), ...docIds, ...fieldIds, ...viewIds].map(String)
    const counts = {}
    const del = async (label, sql, p) => { const r = await c.query(sql, p); counts[label] = r.rowCount }
    await del('commercial_audit_logs (about these ids only)', 'DELETE FROM commercial_audit_logs WHERE entity_id = ANY($1::text[])', [allIds])
    await del('document_citations', 'DELETE FROM document_citations WHERE document_id = ANY($1)', [docIds])
    await del('documents', 'DELETE FROM documents WHERE id = ANY($1)', [docIds])
    await del('protected_values', `DELETE FROM protected_values WHERE entity_type='bid' AND entity_id = ANY($1)`, [bidIds])
    await del('follow_ups (bid + opportunity)', `DELETE FROM follow_ups WHERE (entity_type='bid' AND entity_id = ANY($1)) OR (entity_type='opportunity' AND entity_id = ANY($2))`, [bidIds, oppIds])
    await del('ownership_assignments (bid + opportunity)', `DELETE FROM ownership_assignments WHERE (entity_type='bid' AND entity_id = ANY($1)) OR (entity_type='opportunity' AND entity_id = ANY($2))`, [bidIds, oppIds])
    await del('bid_corrigendum_changes', 'DELETE FROM bid_corrigendum_changes WHERE corrigendum_id = ANY($1)', [corrIds])
    await del('bid_corrigenda', 'DELETE FROM bid_corrigenda WHERE id = ANY($1)', [corrIds])
    await del('bid_milestones', 'DELETE FROM bid_milestones WHERE bid_id = ANY($1)', [bidIds])
    await del('bid_custom_field_values (of ZBT bids)', 'DELETE FROM bid_custom_field_values WHERE bid_id = ANY($1)', [bidIds])
    await del('bids', 'DELETE FROM bids WHERE id = ANY($1)', [bidIds])
    await del('opportunity_stage_changes', 'DELETE FROM opportunity_stage_changes WHERE opportunity_id = ANY($1)', [oppIds])
    await del('opportunities', 'DELETE FROM opportunities WHERE id = ANY($1)', [oppIds])
    const strayValues = fieldIds.length ? (await one('SELECT count(*)::int n FROM bid_custom_field_values WHERE field_id = ANY($1)', [fieldIds]))[0].n : 0
    if (strayValues) throw new Error(`${strayValues} values of ZBT columns belong to NON-ZBT bids — refusing to delete those columns`)
    await del('bid_custom_fields', 'DELETE FROM bid_custom_fields WHERE id = ANY($1)', [fieldIds])
    await del('bid_saved_views', 'DELETE FROM bid_saved_views WHERE id = ANY($1)', [viewIds])

    // ---- verify: non-ZBT rows untouched; no ZBT remnants ----
    const after = (await one(`SELECT
      (SELECT count(*) FROM opportunities WHERE opportunity_name NOT LIKE 'ZBT-SMOKE%')::int nz_opps,
      (SELECT count(*) FROM bids b JOIN opportunities o ON o.id=b.opportunity_id WHERE o.opportunity_name NOT LIKE 'ZBT-SMOKE%')::int nz_bids,
      (SELECT count(*) FROM bid_custom_fields WHERE name NOT LIKE 'ZBT %')::int nz_fields,
      (SELECT count(*) FROM bid_saved_views WHERE name NOT LIKE 'ZBT %')::int nz_views,
      (SELECT count(*) FROM opportunities WHERE opportunity_name LIKE 'ZBT-SMOKE%')::int z_opps,
      (SELECT count(*) FROM bid_custom_fields WHERE name LIKE 'ZBT %')::int z_fields,
      (SELECT count(*) FROM bid_saved_views WHERE name LIKE 'ZBT %')::int z_views`))[0]
    for (const k of ['nz_opps', 'nz_bids', 'nz_fields', 'nz_views']) if (after[k] !== base[k]) throw new Error(`NON-ZBT ${k} changed: ${base[k]} -> ${after[k]}`)
    if (after.z_opps || after.z_fields || after.z_views) throw new Error('ZBT rows remain after delete')
    Object.entries(counts).forEach(([k, v]) => tag(`  would delete ${String(v).padStart(4)}  ${k}`))
    tag(`VERIFIED: non-ZBT rows unchanged (opps ${base.nz_opps}, bids ${base.nz_bids}, columns ${base.nz_fields}, views ${base.nz_views}); no ZBT remnants`)
    if (EXECUTE) { await c.query('COMMIT'); tag('COMMITTED') } else { await c.query('ROLLBACK'); tag('DRY RUN: rolled back — nothing changed') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {}); tag('ABORTED + ROLLED BACK: ' + e.message); process.exitCode = 1
  } finally { await c.end() }
})()
