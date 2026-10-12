import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AccessMatrix } from './AccessMatrix'
import { POLICY } from './generated/policy.generated'
import { HIDDEN_SECTIONS } from './matrixModel'

const pageRow = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** A field group's header button, found by its policy section name (its label is "<name> — N Read · N Edit · N Denied"). */
const groupRe = (name: string) => new RegExp(`^${esc(name)} — \\d+ Read`)
const group = (name: string) => screen.getByRole('button', { name: groupRe(name) })
const groups = () => [...document.querySelectorAll<HTMLButtonElement>('button.am-group')]
const groupNames = () => groups().map((g) => g.getAttribute('aria-label')!.split(' — ').slice(0, -1).join(' — '))
const shown = (page: string) => POLICY.pages.find((p) => p.name === page)!.fields.filter((f) => !(HIDDEN_SECTIONS[page] ?? []).includes(f.s))
const sections = (page: string) => [...new Set(shown(page).map((f) => f.s))]

describe('AccessMatrix', () => {
  it('opens on Delivery L5 with the three pages and the Denied / Read / Edit wording', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    expect(screen.getByRole('heading', { name: 'Role & Access Management' })).toBeInTheDocument()
    expect(screen.getByText('Delivery L5 Associate')).toBeInTheDocument()
    for (const p of ['Opportunity', 'Accounts Mapping', 'Commercial Calculator']) expect(pageRow(p)).toBeInTheDocument()
    expect(screen.queryByText(/Hidden|Restricted/)).toBeNull()
    await user.click(group('Org Structure'))
    expect(screen.getAllByRole('button', { name: 'Denied' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Read' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
  })

  it('a fully Denied page shows the Denied badge and a Denied field shows why', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    // IT has no grants on Opportunity at L0, so every Opportunity field is Denied there
    await user.click(screen.getByRole('button', { name: /^IT$/ }))
    await user.click(screen.getByRole('button', { name: /^L0/ }))
    expect(within(pageRow('Opportunity')).getByText('Denied')).toBeInTheDocument()
    await user.click(group('Action Queue'))
    expect(screen.getAllByText(/^Denied for IT/).length).toBeGreaterThan(0)
  })

  it('a team that can read Opportunity shows it as accessible', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    // Delivery L5 opens on Opportunity and can read part of it
    expect(within(pageRow('Opportunity')).queryByText('Denied')).toBeNull()
    expect(within(pageRow('Opportunity')).getByText(/ of 69$/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^IT$/ }))
    expect(screen.getByText('IT L5 Associate')).toBeInTheDocument()
  })

  it('switching team and level re-evaluates from the policy', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    await user.click(screen.getByRole('button', { name: /^Bid$/ }))
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    expect(screen.getByText('Bid L3 Dept Leader')).toBeInTheDocument()
    // Bid L3 can read part of Accounts Mapping, and the page shows the default scope the policy gives it
    expect(within(pageRow('Accounts Mapping')).queryByText('Denied')).toBeNull()
    expect(within(pageRow('Accounts Mapping')).getByText(/^(Own|Assigned|Own \/ Assigned|Managed Team|Department|BU|Company)/)).toBeInTheDocument()
  })

  it('editing a field raises the preview-changes bar; Discard clears it and Apply to preview keeps it', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    await user.click(screen.getByRole('button', { name: /^Bid$/ }))
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    await user.click(group('Action Queue'))
    expect(screen.getByText('0 preview changes')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Denied' })[0])
    expect(screen.getByText('1 preview change')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'edited · undo' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText('0 preview changes')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Read' })[0])
    await user.click(screen.getByRole('button', { name: 'Apply to preview' }))
    expect(screen.getByText('0 preview changes')).toBeInTheDocument()
  })

  it('Preview as user lists only the fields the person can read', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    await user.click(screen.getByRole('button', { name: /^Bid$/ }))
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    await user.click(pageRow('Accounts Mapping'))
    await user.click(screen.getAllByRole('button', { name: 'Preview as user' })[1])
    expect(screen.getByText(/Viewing Accounts Mapping as Bid L3 Dept Leader/)).toBeInTheDocument()
    expect(screen.getAllByText('Sample value').length).toBeGreaterThan(0)
    expect(screen.getByText(/fields are Denied for Bid L3 and are hidden\./)).toBeInTheDocument()
  })

  it('Preview as user says it is a local policy preview that is not saved or enforced', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    expect(screen.queryByText(/Policy preview/)).toBeNull()
    await user.click(screen.getAllByRole('button', { name: 'Preview as user' })[0])
    expect(screen.getByText('Policy preview — changes here affect this preview only and are not saved or enforced.')).toBeInTheDocument()
    // the old wording that implied real saving is gone
    expect(screen.queryByText(/unsaved change/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('describes per-field scope differences as field scopes, not admin overrides', () => {
    render(<AccessMatrix />)
    // Delivery L5 Accounts Mapping has fields whose scope differs from the page default
    const row = pageRow('Accounts Mapping')
    expect(within(row).getByText(/^· \d+ field scopes?$/)).toBeInTheDocument()
    expect(within(row).getByText(/default$/)).toBeInTheDocument()
    expect(screen.queryByText(/overrides?$/)).toBeNull()
  })
})

describe('AccessMatrix field groups', () => {
  it('shows one collapsed group per policy section instead of the field rows', () => {
    render(<AccessMatrix />)
    // Opportunity is the open page and shows these 11 sections (Master is hidden for now), in the policy's own order and wording
    expect(groupNames()).toEqual(sections('Opportunity'))
    expect(groups()).toHaveLength(11)
    for (const g of groups()) expect(g).toHaveAttribute('aria-expanded', 'false')
    // no individual field controls until a group is opened
    expect(screen.queryAllByRole('button', { name: 'Denied' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Read' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Edit' })).toHaveLength(0)
  })

  it('uses the existing section names verbatim and invents none', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    expect(groups().some((g) => /^Core Opportunity/.test(g.getAttribute('aria-label')!))).toBe(false)
    expect(group('Sales Ownership — Departments')).toBeInTheDocument()
    await user.click(pageRow('Accounts Mapping'))
    expect(groupNames()).toEqual(sections('Accounts Mapping'))
    expect(group('Directory — Person Detail')).toBeInTheDocument()
    expect(group('Directory')).toBeInTheDocument()
    expect(group('Meetings — Create/Edit')).toBeInTheDocument()
    expect(group('Import / Export')).toBeInTheDocument()
    await user.click(pageRow('Commercial Calculator'))
    expect(groupNames()).toEqual(sections('Commercial Calculator'))
    expect(groups()).toHaveLength(26)
  })

  it('summarises each group as Read · Edit · Denied counts', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    // Delivery L5: only a few org-directory fields are readable
    expect(group('Org Structure')).toHaveAccessibleName('Org Structure — 3 Read · 0 Edit · 4 Denied')
    expect(group('Employees')).toHaveAccessibleName('Employees — 2 Read · 0 Edit · 5 Denied')
    expect(group('Pipeline')).toHaveAccessibleName('Pipeline — 0 Read · 0 Edit · 7 Denied')
    // the visible text carries the same numbers
    expect(group('Org Structure')).toHaveTextContent('3 Read · 0 Edit · 4 Denied')
    // Delivery L3: the approved handoff fields are Read, nothing is editable
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    expect(group('Pipeline')).toHaveAccessibleName('Pipeline — 7 Read · 0 Edit · 0 Denied')
    expect(group('Action Queue')).toHaveAccessibleName('Action Queue — 2 Read · 0 Edit · 5 Denied')
    expect(group('Activity History')).toHaveAccessibleName('Activity History — 0 Read · 0 Edit · 11 Denied')
    // Bid L3 can edit three Action Queue fields
    await user.click(screen.getByRole('button', { name: /^Bid$/ }))
    expect(group('Action Queue')).toHaveAccessibleName('Action Queue — 4 Read · 3 Edit · 0 Denied')
  })

  it('expands to the existing field rows and collapses again', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    const g = group('Pipeline')
    expect(g).toHaveAttribute('aria-expanded', 'false')
    await user.click(g)
    expect(g).toHaveAttribute('aria-expanded', 'true')
    // the 7 Pipeline fields, each with the Denied | Read | Edit control, a scope and a sensitivity
    for (const name of ['Opportunity ID', 'Opportunity Type', 'Tender ID', 'Tender Link', 'Department / Client']) expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Denied' })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: 'Read' })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(7)
    expect(screen.getAllByDisplayValue('Approved Handoff')).toHaveLength(7)
    expect(screen.getAllByText(/^(Low|Medium|High|Very High)$/).length).toBeGreaterThanOrEqual(7)
    // other groups stay collapsed
    expect(group('Campaign')).toHaveAttribute('aria-expanded', 'false')
    await user.click(g)
    expect(g).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByRole('button', { name: 'Denied' })).toHaveLength(0)
  })

  it('every group of every page expands to its fields, with none lost and none duplicated', () => {
    render(<AccessMatrix />)
    // cheap DOM queries: this renders all 317 field rows, which is slow through accessibility-role lookups
    const denied = () => document.querySelectorAll('button[title^="Denied:"]').length
    let total = 0
    for (const page of POLICY.pages.map((p) => ({ name: p.name, fields: shown(p.name) }))) {
      if (page.name !== 'Opportunity') fireEvent.click(pageRow(page.name)) // Opportunity is already the open page
      const names = sections(page.name)
      expect(groupNames()).toEqual(names)
      for (const g of groups()) fireEvent.click(g)
      for (const g of groups()) expect(g).toHaveAttribute('aria-expanded', 'true')
      // one Denied | Read | Edit control per policy field of the page, in total
      expect(denied()).toBe(page.fields.length)
      // and each group's counts add up to exactly its own section's fields
      for (const s of names) {
        const g = groups().find((x) => groupRe(s).test(x.getAttribute('aria-label')!))!
        const m = g.getAttribute('aria-label')!.match(/(\d+) Read · (\d+) Edit · (\d+) Denied$/)!
        expect(+m[1] + +m[2] + +m[3]).toBe(page.fields.filter((f) => f.s === s).length)
      }
      total += denied()
    }
    expect(total).toBe(309)
  })

  it('does not show the Master section for now, and says so in the page counts', () => {
    render(<AccessMatrix />)
    expect(groups().some((g) => /^Master — /.test(g.getAttribute('aria-label')!))).toBe(false)
    expect(groupNames()).not.toContain('Master')
    expect(within(pageRow('Opportunity')).getByText(/ of 69$/)).toBeInTheDocument()
  })

  it('keeps a group open across Team and Level changes and updates its counts', async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    await user.click(screen.getByRole('button', { name: /^Bid$/ }))
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    await user.click(group('Action Queue'))
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(7)
    await user.click(screen.getByRole('button', { name: /^Delivery$/ }))
    expect(group('Action Queue')).toHaveAttribute('aria-expanded', 'true')
    expect(group('Action Queue')).toHaveAccessibleName('Action Queue — 2 Read · 0 Edit · 5 Denied')
    // the rows beneath follow the new Team: 5 fields are now Denied
    expect(screen.getAllByText(/^Denied for Delivery/)).toHaveLength(5)
  })

  it("changing a field inside a group updates that group's counts and nothing else", async () => {
    const user = userEvent.setup()
    render(<AccessMatrix />)
    await user.click(screen.getByRole('button', { name: /^Bid$/ }))
    await user.click(screen.getByRole('button', { name: /^L3/ }))
    await user.click(group('Action Queue'))
    const before = groups().map((g) => g.getAttribute('aria-label'))
    await user.click(screen.getAllByRole('button', { name: 'Denied' })[0])
    const after = groups().map((g) => g.getAttribute('aria-label'))
    expect(after.filter((a, i) => a !== before[i])).toEqual(['Action Queue — 4 Read · 2 Edit · 1 Denied'])
    expect(screen.getByText('1 preview change')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(groups().map((g) => g.getAttribute('aria-label'))).toEqual(before)
  })
  describe('CXO level restriction', () => {
    const levelButton = (n: number) => screen.getByRole('button', { name: new RegExp(`^L${n}( |$)`) })
    const NOTE = 'CXO access is restricted to L0 and L1.'

    it('disables the CXO L2-L5 selectors, keeps L0 and L1 enabled, and explains why', async () => {
      const user = userEvent.setup()
      render(<AccessMatrix />)
      expect(screen.queryByText(NOTE)).toBeNull()
      await user.click(screen.getByRole('button', { name: /^CXO$/ }))
      for (const n of [2, 3, 4, 5]) expect(levelButton(n), `L${n}`).toBeDisabled()
      for (const n of [0, 1]) expect(levelButton(n), `L${n}`).toBeEnabled()
      expect(screen.getByText(NOTE)).toBeInTheDocument()
    })

    it('moves the selection to L1 when switching to CXO from L2, L3, L4 or L5', async () => {
      for (const n of [2, 3, 4, 5]) {
        const user = userEvent.setup()
        const { unmount } = render(<AccessMatrix />)
        await user.click(levelButton(n))
        await user.click(screen.getByRole('button', { name: /^CXO$/ }))
        expect(screen.getByText('CXO L1 CXO'), `from L${n}`).toBeInTheDocument()
        unmount()
      }
    })

    it('keeps L0 when switching to CXO from L0, and restores every level when leaving CXO', async () => {
      const user = userEvent.setup()
      render(<AccessMatrix />)
      await user.click(levelButton(0))
      await user.click(screen.getByRole('button', { name: /^CXO$/ }))
      expect(screen.getByText('CXO L0 Management')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^Bid$/ }))
      expect(screen.getByText('Bid L0 Management')).toBeInTheDocument()
      expect(screen.queryByText(NOTE)).toBeNull()
      for (const n of [0, 1, 2, 3, 4, 5]) expect(levelButton(n), `L${n}`).toBeEnabled()
    })

    it('a mouse click or a dispatched click on a disabled CXO level changes nothing', async () => {
      const user = userEvent.setup()
      render(<AccessMatrix />)
      await user.click(screen.getByRole('button', { name: /^CXO$/ }))
      for (const n of [2, 3, 4, 5]) {
        await user.click(levelButton(n))
        fireEvent.click(levelButton(n))
        expect(screen.getByText('CXO L1 CXO'), `after clicking L${n}`).toBeInTheDocument()
      }
    })

    it('the keyboard cannot reach or activate a disabled CXO level, but still works on L0 and L1', async () => {
      const user = userEvent.setup()
      render(<AccessMatrix />)
      await user.click(screen.getByRole('button', { name: /^CXO$/ }))
      levelButton(0).focus()
      await user.keyboard('{Enter}')
      expect(screen.getByText('CXO L0 Management')).toBeInTheDocument()
      await user.tab() // L0 -> L1
      expect(levelButton(1)).toHaveFocus()
      await user.keyboard(' ')
      expect(screen.getByText('CXO L1 CXO')).toBeInTheDocument()
      await user.tab() // L1 -> past the level row: never onto a disabled L2-L5 selector
      for (const n of [2, 3, 4, 5]) expect(levelButton(n), `L${n}`).not.toHaveFocus()
      for (const n of [2, 3, 4, 5]) { levelButton(n).focus(); expect(levelButton(n), `L${n} cannot take focus`).not.toHaveFocus() }
      await user.keyboard('{Enter}')
      expect(screen.getByText('CXO L1 CXO')).toBeInTheDocument()
    })

    it('shows only L0/L1 access for CXO, and Denied for CXO on every page the policy withholds', async () => {
      const user = userEvent.setup()
      render(<AccessMatrix />)
      await user.click(screen.getByRole('button', { name: /^CXO$/ }))
      expect(screen.getByText('CXO L1 CXO')).toBeInTheDocument()
      // CXO L1 still reads Opportunity: the restriction removes L2-L5, not L1
      expect(within(pageRow('Opportunity')).queryByText('Denied')).toBeNull()
    })
  })
})
