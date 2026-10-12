import { describe, expect, it } from 'vitest'
import { amCell, amDecodeCell, amEffective, amLevelAllowed } from './generated/engine.generated'
import { POLICY } from './generated/policy.generated'
import { amScopeLabel } from './generated/engine.generated'
import { HIDDEN_SECTIONS, LEVELS, PAGES, SCOPE_OPTIONS, TEAMS, eff, groupKey, initialState, levelAllowed, levelRestrictionNote, pageScope, selectLevel, selectTeam, summarize, type MatrixField, type MatrixState } from './matrixModel'

const field = (page: string, section: string, name: string) => PAGES.find((p) => p.id === page)!.fields.find((f) => f.s === section && f.n === name)!
const at = (team: string, lvl: number, page = 'Opportunity'): MatrixState => ({ ...initialState(), team, lvl, open: page })

describe('generated policy', () => {
  it('has the three top-level pages and the eight teams in canonical order', () => {
    expect(POLICY.pages.map((p) => p.name)).toEqual(['Opportunity', 'Accounts Mapping', 'Commercial Calculator'])
    expect(TEAMS).toEqual(['Sales', 'Pre-sales', 'Bid', 'Legal', 'Delivery', 'Finance', 'CXO', 'IT'])
  })

  it('keeps the Teams sections as subsections of Opportunity, not pages', () => {
    const sections = new Set(POLICY.pages[0].fields.map((f) => f.s))
    for (const s of ['Org Structure', 'Employees', 'Sales Roster']) expect(sections.has(s)).toBe(true)
    expect([...sections].some((s) => s.startsWith('Sales Ownership'))).toBe(true)
    expect(POLICY.pages.some((p) => /team/i.test(p.name))).toBe(false)
  })

  it('every field has 8 team strings of 6 cells; a Denied cell never carries a scope and a grant always does', () => {
    for (const p of POLICY.pages) {
      for (const f of p.fields) {
        expect(f.p).toHaveLength(8)
        for (const t of f.p) {
          const cells = t.split(',')
          expect(cells).toHaveLength(6)
          for (const c of cells) {
            if (c[0] === '0') expect(c).toBe('0')
            else expect(amDecodeCell(c).scopes.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('keeps Own and Assigned as separate internal scopes', () => {
    const cells = POLICY.pages.flatMap((p) => p.fields).flatMap((f) => f.p.flatMap((t) => t.split(',')))
    const both = cells.filter((c) => c.length > 1 && c.includes('O') && c.includes('A'))
    expect(both.length).toBeGreaterThan(0)
    for (const c of both) expect(amDecodeCell(c).scopes).toEqual(expect.arrayContaining(['OWN', 'ASG']))
    expect(cells.some((c) => c === '1O')).toBe(true)
    expect(cells.some((c) => c === '1A')).toBe(true)
  })

  it('the Finance Directory search field uses the standard Directory level-scope pattern (no business-scope)', () => {
    const f = field('Accounts Mapping', 'Directory', 'Search by name/designation/phone/email/manager')
    expect(f.p[TEAMS.indexOf('Finance')]).toBe('1C,1C,1B,1D,1M,1OA')
  })
})

describe('Opportunity: Delivery handoff guardrail and the three Action Queue fields', () => {
  const opp = POLICY.pages.find((p) => p.name === 'Opportunity')! // the full policy, including sections the screen hides
  const DELIVERY = TEAMS.indexOf('Delivery')
  const delivery = (f: (typeof opp.fields)[number]) => [0, 1, 2, 3, 4, 5].map((l) => amCell(f, DELIVERY, l))

  it('has the three previously missing Action Queue fields, read-only for every team', () => {
    for (const name of ['Opportunity / Mission', 'Bid ID', 'Stage']) {
      const f = field('Opportunity', 'Action Queue', name)
      expect(f).toBeDefined()
      for (let t = 0; t < TEAMS.length; t++) for (let l = 0; l < 6; l++) expect(amCell(f, t, l).state).toBeLessThan(2)
    }
    // exact archived visibility for the non-Delivery teams, IT hidden
    expect(field('Opportunity', 'Action Queue', 'Stage').p[TEAMS.indexOf('Sales')]).toBe('1C,1C,1B,1D,1M,1OA')
    expect(field('Opportunity', 'Action Queue', 'Stage').p[TEAMS.indexOf('Finance')]).toBe('0,0,1B,1D,1M,0')
    expect(field('Opportunity', 'Action Queue', 'Bid ID').p[TEAMS.indexOf('CXO')]).toBe('1C,1C,0,0,0,0') // CXO holds L0/L1 only
    expect(field('Opportunity', 'Action Queue', 'Stage').p[TEAMS.indexOf('IT')]).toBe('0,0,0,0,0,0')
  })

  it('Delivery only ever reads Opportunity fields through the org directory scopes or APPROVED, and never edits', () => {
    for (const f of opp.fields) {
      for (const c of delivery(f)) {
        expect(c.state).toBeLessThan(2)
        if (c.state === 1) expect(c.scopes.length).toBeGreaterThan(0)
      }
      const approved = delivery(f).some((c) => c.scopes.includes('APPROVED'))
      if (approved) for (const c of delivery(f)) if (c.state > 0) expect(c.scopes).toEqual(['APPROVED'])
    }
  })

  it('Delivery gets approved handoff identity at L2-L4 only, with nothing at L0, L1 or L5', () => {
    const approved = opp.fields.filter((f) => delivery(f).some((c) => c.scopes.includes('APPROVED')))
    expect(approved).toHaveLength(16)
    for (const f of approved) expect(delivery(f).map((c) => c.state)).toEqual([0, 0, 1, 1, 1, 0])
    expect(approved.map((f) => f.s).sort()).toEqual([...Array(2).fill('Action Queue'), ...Array(7).fill('Master'), ...Array(7).fill('Pipeline')].sort())
  })

  it('Delivery is denied the sensitive bid, commercial and internal Opportunity data at every level', () => {
    const mustBeDenied: [string, string][] = [
      ['Action Queue', 'Stage'], ['Action Queue', 'Next Action'], ['Action Queue', 'Action Owner'], ['Action Queue', 'Action Due'], ['Action Queue', 'Attention'],
      ['Activity History', 'Event detail / changed value'], ['Activity History', 'Actor / user'], ['Master', 'Sheet'],
      ['Dashboard', 'Live Bids count'], ['Dashboard', 'Pipeline Funnel / Backup / Commits counts'], ['Sales Roster', 'Open opportunities'], ['Sales Ownership', 'Opportunity owner'],
    ]
    for (const [s, n] of mustBeDenied) {
      const f = opp.fields.find((x) => x.s.startsWith(s) && x.n.startsWith(n))
      expect(f, `${s} / ${n}`).toBeDefined()
      expect(delivery(f!).every((c) => c.state === 0), `${s} / ${n}`).toBe(true)
    }
    for (const s of ['Activity History', 'Campaign', 'Dashboard', 'Sales Roster', 'Sales Ownership']) {
      for (const f of opp.fields.filter((x) => x.s.startsWith(s))) expect(delivery(f).every((c) => c.state === 0), `${s} / ${f.n}`).toBe(true)
    }
  })

  it('a higher level never unlocks a sensitive field by itself', () => {
    for (const f of opp.fields.filter((x) => x.k === 'Very High')) expect(amCell(f, TEAMS.indexOf('Sales'), 5).state).toBe(0)
    for (const f of opp.fields.filter((x) => x.s === 'Activity History')) for (const t of TEAMS.keys()) expect(amCell(f, t, 5).state).toBe(0)
  })
})

describe('matrix model', () => {
  it('reads Denied / Read / Edit from the engine and never grants from a higher level alone', () => {
    const page = PAGES.find((p) => p.fields.some((x) => amCell(x, 0, 5).state === 0 && amCell(x, 0, 0).state > 0))!
    const f = page.fields.find((x) => amCell(x, 0, 5).state === 0 && amCell(x, 0, 0).state > 0)!
    expect(eff(at('Sales', 5, page.id), 'Sales', 5, f, page.id).view).toBe(false)
  })

  it('a Denied field has a note and no scope; a granted field shows its scope label', () => {
    const rows = summarize(at('Delivery', 5)).pages.flatMap((p) => p.cats.flatMap((c) => c.xs))
    const denied = rows.find((r) => !r.x.view)!
    expect(denied.x.note).toMatch(/^Denied for Delivery/)
    const granted = rows.find((r) => r.x.view)!
    expect(granted.x.note).toBe('')
    expect(granted.x.scope).toBeTruthy()
  })

  it('shows Own / Assigned for OWN+ASG grants', () => {
    const s = summarize(at('Finance', 5, 'Accounts Mapping'))
    const labels = new Set(s.pages.flatMap((p) => p.cats.flatMap((c) => c.xs)).filter((r) => r.x.view).map((r) => r.x.scope))
    expect(labels.has('Own / Assigned')).toBe(true)
  })

  it('page default scope is a selectable option and overrides win', () => {
    const state = at('Bid', 3)
    expect(SCOPE_OPTIONS).toContain(pageScope(state, 'Bid', 3, 'Opportunity'))
    const o = { ...state, ov: { 'Bid|3|Opportunity|scope': { scope: 'BU' } } }
    expect(pageScope(o, 'Bid', 3, 'Opportunity')).toBe('BU')
  })

  it('counts unsaved changes as keys that differ from the saved overrides', () => {
    const state = at('Bid', 3)
    expect(summarize(state).changes).toBe(0)
    const f = PAGES[0].fields[0]
    const changed = { ...state, ov: { [`Bid|3|${f.id}`]: { view: false, edit: false } } }
    expect(summarize(changed).changes).toBe(1)
    expect(summarize({ ...changed, saved: changed.ov }).changes).toBe(0)
  })

  it('the engine unions several teams while the editor shows one', () => {
    const f = PAGES.flatMap((p) => p.fields).find((x) => TEAMS.some((_, ti) => amCell(x, ti, 5).state === 2))!
    const teams = TEAMS.filter((_, ti) => amCell(f, ti, 5).state > 0)
    expect(amEffective(f, teams, 5, TEAMS).state).toBe(2)
    expect(LEVELS).toHaveLength(6)
  })
})

describe('field groups', () => {
  const shownFields = (page: string) => POLICY.pages.find((p) => p.name === page)!.fields.filter((f) => !(HIDDEN_SECTIONS[page] ?? []).includes(f.s))
  const policySections = (page: string) => [...new Set(shownFields(page).map((f) => f.s))]
  const SHOWN = POLICY.pages.reduce((n, p) => n + shownFields(p.name).length, 0)
  const everyCombo = () => TEAMS.flatMap((t) => LEVELS.map((_, l) => [t, l] as const))

  it('groups each page by the policy sections, in the policy order, with the policy names', () => {
    const summary = summarize(initialState())
    for (const ps of summary.pages) {
      expect(ps.cats.map((c) => c.name)).toEqual(policySections(ps.page.id))
      expect(ps.cats.map((c) => c.key)).toEqual(policySections(ps.page.id).map((s) => groupKey(ps.page.id, s)))
    }
    expect(summary.pages.map((p) => p.cats.length)).toEqual([11, 11, 26])
    const all = summary.pages.flatMap((p) => p.cats.map((c) => c.name))
    expect(all).not.toContain('Core Opportunity') // the policy has no such section, so none is invented
    expect(all).toEqual(expect.arrayContaining(['Directory', 'Directory — Person Detail', 'Meetings — Create/Edit', 'Import / Export', 'Sales Ownership — Departments']))
  })

  it('puts every policy field in exactly one group: none lost, none duplicated, order preserved', () => {
    const summary = summarize(initialState())
    const seen: string[] = []
    for (const ps of summary.pages) {
      const inGroups = ps.cats.flatMap((c) => c.xs.map((o) => o.f))
      expect(inGroups.map((f) => f.id)).toEqual(ps.page.fields.map((f) => f.id)) // same fields, same order
      for (const c of ps.cats) for (const o of c.xs) expect(o.f.s).toBe(c.name)
      seen.push(...inGroups.map((f) => f.id))
    }
    expect(seen).toHaveLength(SHOWN)
    expect(new Set(seen).size).toBe(SHOWN)
    expect(SHOWN).toBe(309) // 317 policy fields minus the 8 hidden Opportunity > Master fields
  })

  it('group Read / Edit / Denied counts add up to the group, and to the page summary, for every Team and Level', () => {
    for (const [team, lvl] of everyCombo()) {
      const summary = summarize({ ...initialState(), team, lvl })
      for (const ps of summary.pages) {
        for (const c of ps.cats) expect(c.read + c.edit + c.denied).toBe(c.xs.length)
        expect(ps.cats.reduce((n, c) => n + c.read, 0)).toBe(ps.v - ps.e)
        expect(ps.cats.reduce((n, c) => n + c.edit, 0)).toBe(ps.e)
        expect(ps.cats.reduce((n, c) => n + c.denied, 0)).toBe(ps.n - ps.v)
      }
    }
  })

  it('group counts equal a direct count from the generated policy cells', () => {
    for (const [team, lvl] of everyCombo()) {
      const ti = TEAMS.indexOf(team)
      for (const ps of summarize({ ...initialState(), team, lvl }).pages) {
        for (const c of ps.cats) {
          const states = c.xs.map((o) => amCell(o.f, ti, lvl).state)
          expect(c.read).toBe(states.filter((x) => x === 1).length)
          expect(c.edit).toBe(states.filter((x) => x === 2).length)
          expect(c.denied).toBe(states.filter((x) => x === 0).length)
        }
      }
    }
  })

  it('leaves every permission value identical to the policy: state and scope for every shown cell', () => {
    let cells = 0
    for (const [team, lvl] of everyCombo()) {
      const ti = TEAMS.indexOf(team)
      const state = { ...initialState(), team, lvl }
      for (const ps of summarize(state).pages) {
        for (const c of ps.cats) for (const { f, x } of c.xs) {
          const cell = amCell(f, ti, lvl)
          expect(x.view).toBe(cell.state > 0)
          expect(x.edit).toBe(cell.state === 2)
          if (cell.state > 0) expect(x.scope).toBe(amScopeLabel(cell.scopes))
          expect(x.over).toBe(false)
          cells++
        }
      }
    }
    expect(cells).toBe(SHOWN * 8 * 6)
  })

  it('hides Opportunity > Master on the screen only: the policy still holds it, unchanged', () => {
    expect(HIDDEN_SECTIONS).toEqual({ Opportunity: ['Master'] })
    const policyOpp = POLICY.pages.find((p) => p.name === 'Opportunity')!
    expect(policyOpp.fields.filter((f) => f.s === 'Master')).toHaveLength(8)
    expect(POLICY.pages.reduce((n, p) => n + p.fields.length, 0)).toBe(317)
    const opp = PAGES.find((p) => p.id === 'Opportunity')!
    expect(opp.fields.some((f) => f.s === 'Master')).toBe(false)
    expect(opp.fields).toHaveLength(69)
    const summary = summarize(initialState())
    expect(summary.pages[0].n).toBe(69)
    expect(summary.pages[0].cats.map((c) => c.name)).not.toContain('Master')
    // the other pages are untouched
    expect(summary.pages.map((p) => p.n)).toEqual([69, 119, 121])
  })

  it('opening a group changes only its isOpen flag, never a permission or a count', () => {
    const closed = summarize(initialState())
    const key = groupKey('Opportunity', 'Pipeline')
    const open = summarize({ ...initialState(), groups: { [key]: true } })
    for (let p = 0; p < closed.pages.length; p++) {
      closed.pages[p].cats.forEach((c, i) => {
        const o = open.pages[p].cats[i]
        expect(o.isOpen).toBe(o.key === key)
        expect({ ...o, isOpen: false }).toEqual({ ...c, isOpen: false })
      })
    }
  })

  it('counts reflect a local preview change and return to the policy when it is discarded', () => {
    const state = { ...initialState(), team: 'Bid', lvl: 3 }
    const base = summarize(state).pages[0].cats.find((c) => c.name === 'Action Queue')!
    const f = base.xs[0].f
    const edited = summarize({ ...state, ov: { [`Bid|3|${f.id}`]: { view: false, edit: false } } }).pages[0].cats.find((c) => c.name === 'Action Queue')!
    expect([base.read, base.edit, base.denied]).toEqual([4, 3, 0])
    expect([edited.read, edited.edit, edited.denied]).toEqual([4, 2, 1])
    expect(summarize(state).pages[0].cats.find((c) => c.name === 'Action Queue')).toEqual(base)
  })
})

describe('CXO level restriction (CXO may only hold L0 and L1)', () => {
  const cxo = TEAMS.indexOf('CXO')
  const allFields = POLICY.pages.flatMap((p) => p.fields)

  it('the generated policy gives CXO nothing at L2, L3, L4 or L5, on every field', () => {
    for (const f of allFields) for (const l of [2, 3, 4, 5]) expect(amDecodeCell(f.p[cxo].split(',')[l]).state, `${f.s} / ${f.n} CXO L${l}`).toBe(0)
  })

  it('keeps CXO L0 and L1 exactly: 267 Read at L0, 261 Read and 6 Edit at L1', () => {
    const count = (l: number, state: number) => allFields.filter((f) => amDecodeCell(f.p[cxo].split(',')[l]).state === state).length
    expect([count(0, 1), count(0, 2)]).toEqual([267, 0])
    expect([count(1, 1), count(1, 2)]).toEqual([261, 6])
  })

  it('the whole generated policy has the verified counts: 7,716 Denied, 6,962 Read, 538 Edit', () => {
    const n = [0, 0, 0]
    for (const f of allFields) for (const t of f.p) t.split(',').forEach((c) => { n[amDecodeCell(c).state]++ })
    expect(n).toEqual([7716, 6962, 538])
    expect(n[0] + n[1] + n[2]).toBe(allFields.length * TEAMS.length * 6)
  })

  it('levelAllowed: CXO has L0 and L1 only; every other team has all six levels', () => {
    expect([0, 1, 2, 3, 4, 5].map((l) => levelAllowed('CXO', l))).toEqual([true, true, false, false, false, false])
    for (const t of TEAMS.filter((x) => x !== 'CXO')) for (let l = 0; l < 6; l++) expect(levelAllowed(t, l)).toBe(true)
    expect(amLevelAllowed('CXO', 3)).toBe(false) // the same rule, straight from the generated engine
  })

  it('switching to CXO from L2, L3, L4 or L5 moves the selection to L1; from L0 or L1 it stays', () => {
    for (const l of [2, 3, 4, 5]) expect(selectTeam({ ...initialState(), team: 'Bid', lvl: l }, 'CXO')).toMatchObject({ team: 'CXO', lvl: 1 })
    expect(selectTeam({ ...initialState(), team: 'Bid', lvl: 0 }, 'CXO')).toMatchObject({ team: 'CXO', lvl: 0 })
    expect(selectTeam({ ...initialState(), team: 'Bid', lvl: 1 }, 'CXO')).toMatchObject({ team: 'CXO', lvl: 1 })
    // moving away from CXO keeps the level; moving between other teams never changes it
    expect(selectTeam({ ...initialState(), team: 'CXO', lvl: 1 }, 'Sales')).toMatchObject({ team: 'Sales', lvl: 1 })
    expect(selectTeam({ ...initialState(), team: 'Bid', lvl: 4 }, 'Sales')).toMatchObject({ team: 'Sales', lvl: 4 })
  })

  it('selectLevel ignores L2-L5 for CXO (same state back) and accepts every level for other teams', () => {
    const cxoState: MatrixState = { ...initialState(), team: 'CXO', lvl: 1 }
    for (const l of [2, 3, 4, 5]) expect(selectLevel(cxoState, l)).toBe(cxoState)
    expect(selectLevel(cxoState, 0)).toMatchObject({ team: 'CXO', lvl: 0 })
    expect(selectLevel(cxoState, 1)).toMatchObject({ team: 'CXO', lvl: 1 })
    for (let l = 0; l < 6; l++) expect(selectLevel({ ...initialState(), team: 'Bid', lvl: 5 }, l)).toMatchObject({ team: 'Bid', lvl: l })
  })

  it('the explanatory note is "CXO access is restricted to L0 and L1." for CXO and absent for every other team', () => {
    expect(levelRestrictionNote('CXO')).toBe('CXO access is restricted to L0 and L1.')
    for (const t of TEAMS.filter((x) => x !== 'CXO')) expect(levelRestrictionNote(t)).toBeNull()
  })

  it('a forced CXO L2-L5 state is Denied by the engine even when a policy cell would grant Edit (default-deny)', () => {
    const tampered: MatrixField = { id: 'x', n: 'Tampered', s: 'S', k: 'Low', p: TEAMS.map((t) => (t === 'CXO' ? '2C,2C,2B,2D,2M,2OA' : '0,0,0,0,0,0')) }
    for (const l of [2, 3, 4, 5]) {
      const x = eff({ ...initialState(), team: 'CXO', lvl: l }, 'CXO', l, tampered, 'Opportunity')
      expect([x.view, x.edit, x.acc], `L${l}`).toEqual([false, false, 0])
    }
    for (const l of [0, 1]) expect(eff({ ...initialState(), team: 'CXO', lvl: l }, 'CXO', l, tampered, 'Opportunity').acc).toBe(2)
    // and a state forced onto the real policy shows every page Denied
    for (const l of [2, 3, 4, 5]) expect(summarize({ ...initialState(), team: 'CXO', lvl: l }).nOk, `CXO L${l}`).toBe(0)
  })
})
