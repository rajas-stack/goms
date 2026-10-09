// Strict parser for the "FINAL 3D RBAC" sheet of the GOMS RBAC workbook.
// The FINAL sheet is the only policy source; every other sheet is ignored.
// Nothing is defaulted or guessed: anything the contract does not define is reported as an error.
const XLSX = require('xlsx')
const { amLevelAllowed } = require('./engine.cjs')

const SHEET = 'FINAL 3D RBAC'
const HEADER = ['Area', 'Section/Page', 'Field / Data Element', 'Category', 'Sensitivity']
const TEAMS = ['Sales', 'Pre-sales', 'Bid', 'Legal', 'Delivery', 'Finance', 'CXO', 'IT']
const LEVELS = 6
const SENSITIVITIES = ['Low', 'Medium', 'High', 'Very High']
// Contract rule 5. OWN and ASG stay separate internal values; the sheet's "OWN/ASG" is both of them.
const SCOPES = ['C', 'BU', 'DEP', 'MGR', 'ASG', 'OWN', 'APPROVED', 'META']
const PAGES = ['Opportunity', 'Accounts Mapping', 'Commercial Calculator']
// Sections that belong to the Opportunity page as subsections (they are never top-level pages).
const OPPORTUNITY_TEAM_SUBSECTIONS = ['Org Structure', 'Employees', 'Sales Roster', 'Sales Ownership']

const ENC = { C: 'C', BU: 'B', DEP: 'D', MGR: 'M', ASG: 'A', OWN: 'O', APPROVED: 'P', META: 'X' }
const encodeCell = (c) => String(c.state) + c.scopes.map((s) => ENC[s]).join('')

function parseCell(text, ctx, errors) {
  const parts = String(text == null ? '' : text).split('|').map((s) => s.trim())
  if (parts.length !== LEVELS) {
    errors.push({ code: 'invalid-level-token', ctx, msg: `expected ${LEVELS} level tokens, found ${parts.length}: "${text}"` })
    return null
  }
  const cells = []
  parts.forEach((p, l) => {
    const m = p.match(/^L(\d):(H|RW|R)(?:@(.+))?$/)
    if (!m) {
      const code = /^L\d:W/.test(p) ? 'edit-without-read' : 'invalid-level-token'
      errors.push({ code, ctx, msg: `bad token "${p}"` })
      cells.push({ state: 0, scopes: [] })
      return
    }
    if (+m[1] !== l) errors.push({ code: 'invalid-level-token', ctx, msg: `expected L${l} at position ${l}, found "${p}"` })
    if (m[2] === 'H') {
      if (m[3] !== undefined) errors.push({ code: 'hidden-with-scope', ctx, msg: `Denied level L${l} carries a scope: "${p}"` })
      cells.push({ state: 0, scopes: [] })
      return
    }
    if (m[3] === undefined) {
      errors.push({ code: 'missing-scope', ctx, msg: `L${l} grants ${m[2]} without a scope: "${p}"` })
      cells.push({ state: m[2] === 'RW' ? 2 : 1, scopes: [] })
      return
    }
    const scopes = []
    for (const s of m[3].split('/').map((x) => x.trim())) {
      if (!SCOPES.includes(s)) errors.push({ code: 'undefined-scope', ctx, msg: `undefined scope "${s}" in "${p}"` })
      else if (!scopes.includes(s)) scopes.push(s)
    }
    cells.push({ state: m[2] === 'RW' ? 2 : 1, scopes })
  })
  return cells
}

function parseWorkbook(file) {
  const errors = []
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`sheet "${SHEET}" not found in ${file}`)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const head = rows[0] || []
  HEADER.forEach((h, i) => { if (head[i] !== h) errors.push({ code: 'invalid-header', ctx: 'header', msg: `column ${i} should be "${h}", found "${head[i]}"` }) })
  TEAMS.forEach((t, i) => { if (head[5 + i] !== t) errors.push({ code: 'invalid-team-token', ctx: 'header', msg: `column ${5 + i} should be team "${t}", found "${head[5 + i]}"` }) })
  const fields = []
  const seen = new Set()
  rows.slice(1).forEach((r, i) => {
    if (r.slice(0, 13).every((c) => c === '')) return
    const ctx = `row ${i + 2} ${r[0]} / ${r[1]} / ${r[2]}`
    if (!r[2]) { errors.push({ code: 'missing-field-name', ctx, msg: 'field name is empty' }); return }
    if (!SENSITIVITIES.includes(r[4])) errors.push({ code: 'invalid-sensitivity', ctx, msg: `sensitivity "${r[4]}"` })
    const key = `${r[0]}|${r[1]}|${r[2]}`
    if (seen.has(key)) errors.push({ code: 'duplicate-field', ctx, msg: 'duplicate Area/Section/Field' })
    seen.add(key)
    const cells = TEAMS.map((t, ti) => parseCell(r[5 + ti], `${ctx} [${t}]`, errors) || [])
    cells.forEach((cs, ti) => cs.forEach((c, l) => {
      if (c.state === 2 && c.scopes.length === 0) errors.push({ code: 'edit-without-read', ctx: `${ctx} [${TEAMS[ti]} L${l}]`, msg: 'Edit cell has no Read scope' })
      if (c.state === 0 && c.scopes.length) errors.push({ code: 'hidden-with-scope', ctx: `${ctx} [${TEAMS[ti]} L${l}]`, msg: 'Denied cell has a scope' })
      // CXO may only hold L0 and L1 (engine AM_ALLOWED_LEVELS). A grant above L1 is rejected, never moved to another level.
      if (c.state > 0 && !amLevelAllowed(TEAMS[ti], l)) errors.push({ code: 'cxo-level-restricted', ctx: `${ctx} [${TEAMS[ti]} L${l}]`, msg: `${TEAMS[ti]} may only hold L0 and L1, so L${l} must be Denied (H)` })
    }))
    fields.push({ area: String(r[0]), section: String(r[1]), name: String(r[2]), sensitivity: r[4], cells })
  })
  const areas = [...new Set(fields.map((f) => f.area))]
  for (const a of areas) if (!PAGES.includes(a)) errors.push({ code: 'unexpected-page', ctx: 'pages', msg: `top-level page "${a}" is not one of ${PAGES.join(', ')}` })
  for (const p of PAGES) if (!areas.includes(p)) errors.push({ code: 'missing-page', ctx: 'pages', msg: `top-level page "${p}" has no fields` })
  for (const s of OPPORTUNITY_TEAM_SUBSECTIONS) {
    const where = [...new Set(fields.filter((f) => f.section === s || f.section.startsWith(s + ' —')).map((f) => f.area))]
    if (where.length !== 1 || where[0] !== 'Opportunity') errors.push({ code: 'subsection-placement', ctx: s, msg: `"${s}" must be a subsection of Opportunity only, found in: ${where.join(', ') || 'nowhere'}` })
  }
  return { fields, errors }
}

// Compact embedded form: per page, per field { n, s, k, p } where p = 8 team strings of 6 comma-separated cells.
function toPolicy(fields, sourceName) {
  const pages = PAGES.map((name) => ({
    name,
    fields: fields.filter((f) => f.area === name).map((f) => ({ n: f.name, s: f.section, k: f.sensitivity, p: f.cells.map((cs) => cs.map(encodeCell).join(',')) })),
  }))
  return { source: sourceName, sheet: SHEET, teams: TEAMS, pages }
}

// Action grants follow the same level rules as field cells. A grant is { Team, Level, Action } (Level 0-5 or "L0"-"L5";
// lower-case keys are accepted too). There is no action source in the repo yet; this is the check that source must pass.
function parseGrantLevel(level) {
  if (typeof level === 'number') return Number.isInteger(level) && level >= 0 && level < LEVELS ? level : null
  const m = typeof level === 'string' ? level.match(/^L([0-5])$/) : null
  return m ? +m[1] : null
}

function validateActionGrants(grants) {
  if (!Array.isArray(grants)) throw new TypeError('validateActionGrants expects an array of grants')
  const errors = []
  grants.forEach((g, i) => {
    const team = g && (g.Team !== undefined ? g.Team : g.team)
    const level = g && (g.Level !== undefined ? g.Level : g.level)
    const ctx = `action grant ${i + 1} "${(g && (g.Action || g.action)) || '?'}" [${team} ${level}]`
    const teamOk = TEAMS.includes(team)
    if (!teamOk) errors.push({ code: 'invalid-team-token', ctx, msg: `unknown team "${team}"` })
    const l = parseGrantLevel(level)
    if (l === null) errors.push({ code: 'invalid-level-token', ctx, msg: `"${level}" is not a level L0-L5` })
    else if (teamOk && !amLevelAllowed(team, l)) errors.push({ code: 'cxo-level-restricted', ctx, msg: `${team} may only hold L0 and L1; an action at L${l} is rejected` })
  })
  return errors
}

module.exports = { SHEET, TEAMS, LEVELS, SCOPES, PAGES, OPPORTUNITY_TEAM_SUBSECTIONS, ENC, parseWorkbook, parseCell, toPolicy, encodeCell, validateActionGrants }
