import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { EmployeeFormDialog } from './EmployeeFormDialog'
import { ToastProvider } from '@/components/ui/Toast'
import type { Employee, HierNode, SalesPerson } from '@/lib/types'

// Both pickers are unrelated to what Task 1.2 is testing (the submit()
// wiring, not their own popover/typeahead mechanics) and are otherwise hard
// to drive headlessly (PopoverPanel positioning). Replaced with a bare
// controlled <input> so a test can set `form.relationshipOwner` /
// `form.selectedPersonId` directly via the Field's wrapping <label>.
vi.mock('./SalesTeamPicker', () => ({
  SalesTeamPicker: ({ value, onChange }: { value: string; onChange: (email: string) => void }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('./ManagerPicker', () => ({
  ManagerPicker: ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const ALICE: SalesPerson = {
  id: 'sp-alice', employeeCode: 'E1', name: 'Alice', officialEmail: 'alice@amnex.com',
  personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null,
  status: 'active', notes: '', metadata: {}, createdAt: '', createdBy: null,
}
const BOB: SalesPerson = { ...ALICE, id: 'sp-bob', name: 'Bob', officialEmail: 'bob@amnex.com' }

const ORG_NODE: HierNode = {
  id: 'node-1', domain: 'org', typeKey: 'office', parentId: null, stateCode: 5,
  name: 'Test Office', code: null, sortOrder: 0, metadata: {}, status: 'active',
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Existing Person', designation: 'Officer',
    email: 'existing@gov.in', phone: '+91 9876543210', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'node-1', managerId: null, vacant: false, connected: true,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [], metadata: { relationshipOwner: 'alice@amnex.com' }, status: 'active',
    ...overrides,
  }
}

const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()
const addTimelineMutateAsync = vi.fn()
const followUpCreateMutateAsync = vi.fn()
const assignMutateAsync = vi.fn()

function stubApiHooks(opts: {
  resolvedOwners?: Record<string, { salesPersonId: string; source: 'direct' | 'inherited' }>
  breadcrumbTrail?: HierNode[]
  employeeOrgNode?: HierNode | null
} = {}) {
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    create: { mutateAsync: createMutateAsync, isPending: false },
    update: { mutateAsync: updateMutateAsync, isPending: false },
    addTimelineEvent: { mutateAsync: addTimelineMutateAsync, isPending: false },
    remove: {},
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
  vi.spyOn(api, 'useEmployeesByState').mockReturnValue({ data: [] } as unknown as ReturnType<typeof api.useEmployeesByState>)
  vi.spyOn(api, 'useFollowUpMutations').mockReturnValue({
    create: { mutateAsync: followUpCreateMutateAsync },
    setStatus: {},
    remove: {},
  } as unknown as ReturnType<typeof api.useFollowUpMutations>)
  vi.spyOn(api, 'useNode').mockReturnValue({ data: opts.employeeOrgNode ?? null } as unknown as ReturnType<typeof api.useNode>)
  vi.spyOn(api, 'useSalesPersons').mockReturnValue({ data: [ALICE, BOB] } as unknown as ReturnType<typeof api.useSalesPersons>)
  vi.spyOn(api, 'useOwnershipMutations').mockReturnValue({
    assign: { mutateAsync: assignMutateAsync, isPending: false },
    end: {},
    transferBookOfBusiness: {},
  } as unknown as ReturnType<typeof api.useOwnershipMutations>)
  vi.spyOn(api, 'useResolvedOwners').mockReturnValue(
    { data: opts.resolvedOwners ?? {} } as unknown as ReturnType<typeof api.useResolvedOwners>,
  )
  vi.spyOn(api, 'useBreadcrumb').mockReturnValue(
    { data: opts.breadcrumbTrail ?? [] } as unknown as ReturnType<typeof api.useBreadcrumb>,
  )
}

function renderDialog(props: {
  orgNode?: HierNode | null
  employee?: Employee | null
  reporteeMode?: 'manager' | 'junior' | null
} = {}) {
  const qc = new QueryClient()
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <EmployeeFormDialog
          open
          orgNode={props.orgNode ?? null}
          employee={props.employee ?? null}
          reporteeMode={props.reporteeMode ?? null}
          onClose={onClose}
          onSaved={onSaved}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { onSaved, onClose }
}

beforeEach(() => {
  createMutateAsync.mockReset()
  updateMutateAsync.mockReset()
  addTimelineMutateAsync.mockReset()
  followUpCreateMutateAsync.mockReset()
  assignMutateAsync.mockReset()
  updateMutateAsync.mockResolvedValue(undefined)
  addTimelineMutateAsync.mockResolvedValue(undefined)
  followUpCreateMutateAsync.mockResolvedValue(undefined)
  assignMutateAsync.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EmployeeFormDialog — auto-reflecting the Relationship Owner pick into AMNEX ownership (item 6)', () => {
  it('creating a new employee with a Relationship Owner picked calls assign with the created id', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'new-emp-id' })
    const user = userEvent.setup()
    const { onSaved } = renderDialog({ orgNode: ORG_NODE, employee: null })

    await user.type(screen.getByLabelText(/full name/i), 'New Person')
    await user.type(screen.getByLabelText(/^designation$/i), 'Deputy Director')
    // `getByRole('textbox', ...)` rather than `getByLabelText` — a Preferred
    // Communication checkbox is ALSO labeled "Email" (a `COMMS` option), so a
    // plain label match is ambiguous; scoping to the textbox role picks only
    // the actual email `<input>`.
    await user.type(screen.getByRole('textbox', { name: /^email$/i }), 'new.person@gov.in')
    await user.type(screen.getByLabelText(/phone number/i), '9876500000')
    await user.type(screen.getByLabelText(/relationship owner/i), 'alice@amnex.com')

    await user.click(screen.getByRole('button', { name: /add employee/i }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(assignMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'contact', entityId: 'new-emp-id', salesPersonId: 'sp-alice', role: 'owner', reason: 'reassignment',
    })))
    expect(onSaved).toHaveBeenCalledWith('new-emp-id')
  })

  it('editing and changing the Relationship Owner calls assign again with the new pick', async () => {
    stubApiHooks({ resolvedOwners: { 'emp-1': { salesPersonId: 'sp-alice', source: 'direct' } } })
    const employee = makeEmployee()
    const user = userEvent.setup()
    renderDialog({ employee })

    const ownerField = screen.getByLabelText(/relationship owner/i)
    await user.clear(ownerField)
    await user.type(ownerField, 'bob@amnex.com')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(assignMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'contact', entityId: 'emp-1', salesPersonId: 'sp-bob',
    })))
  })

  it('editing WITHOUT changing the Relationship Owner does not call assign (no-op, per Task 1.1)', async () => {
    stubApiHooks({ resolvedOwners: { 'emp-1': { salesPersonId: 'sp-alice', source: 'direct' } } })
    const employee = makeEmployee()
    const user = userEvent.setup()
    renderDialog({ employee })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    expect(assignMutateAsync).not.toHaveBeenCalled()
  })

  it('treats an inherited-only current owner as no direct owner, so an unchanged pick still creates a direct assignment', async () => {
    // The employee's resolved owner today is only `inherited` (e.g. from the
    // department) — this is the whole point of item 6: the explicit pick
    // must still create a real direct record, not be swallowed as a no-op
    // against the inherited match.
    stubApiHooks({ resolvedOwners: { 'emp-1': { salesPersonId: 'sp-alice', source: 'inherited' } } })
    const employee = makeEmployee() // metadata.relationshipOwner is already 'alice@amnex.com'
    const user = userEvent.setup()
    renderDialog({ employee })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(assignMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'contact', entityId: 'emp-1', salesPersonId: 'sp-alice',
    })))
  })

  it('the reportee (non-vacant) update path also triggers the ownership reflection', async () => {
    stubApiHooks()
    const user = userEvent.setup()
    const { onSaved } = renderDialog({ orgNode: ORG_NODE, employee: null, reporteeMode: 'junior' })

    await user.type(screen.getByLabelText(/junior name/i), 'peer-1')
    await user.type(screen.getByLabelText(/designation/i), 'Deputy')
    await user.type(screen.getByLabelText(/relationship owner/i), 'alice@amnex.com')

    await user.click(screen.getByRole('button', { name: /add junior/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'peer-1' })))
    await waitFor(() => expect(assignMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'contact', entityId: 'peer-1', salesPersonId: 'sp-alice',
    })))
    expect(onSaved).toHaveBeenCalledWith('peer-1')
  })

  it('the reportee VACANT-position create path does NOT trigger ownership reflection', async () => {
    stubApiHooks()
    createMutateAsync.mockResolvedValue({ id: 'vacant-1' })
    const user = userEvent.setup()
    const { onSaved } = renderDialog({ orgNode: ORG_NODE, employee: null, reporteeMode: 'junior' })

    await user.click(screen.getByLabelText(/vacant position/i))
    await user.type(screen.getByLabelText(/position title/i), 'Deputy Director')

    await user.click(screen.getByRole('button', { name: /add junior/i }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled())
    expect(assignMutateAsync).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith('vacant-1')
  })

  it('pasting an image/png clipboard item into the photo area sets form.photoUrl to a data URL', async () => {
    stubApiHooks()
    const employee = makeEmployee()
    renderDialog({ employee })

    const dataUrl = 'data:image/png;base64,PASTED=='
    class FakeFileReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      readAsDataURL() {
        this.result = dataUrl
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader as unknown as typeof FileReader)

    const file = new File(['(binary)'], 'pasted.png', { type: 'image/png' })
    const clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
    }

    const dropZone = screen.getByText('Profile Picture').closest('label')!.querySelector('div')!
    act(() => {
      dropZone.dispatchEvent(
        Object.assign(new Event('paste', { bubbles: true }), { clipboardData }),
      )
    })

    await waitFor(() => expect(screen.getByAltText('')).toHaveAttribute('src', dataUrl))
  })

  it('pasting a clipboard item with no image (e.g. plain text) is a no-op', async () => {
    stubApiHooks()
    const employee = makeEmployee({ photoUrl: 'data:image/png;base64,EXISTING==' })
    renderDialog({ employee })

    const clipboardData = {
      items: [{ type: 'text/plain', getAsFile: () => null }],
    }

    const dropZone = screen.getByText('Profile Picture').closest('label')!.querySelector('div')!
    act(() => {
      dropZone.dispatchEvent(
        Object.assign(new Event('paste', { bubbles: true }), { clipboardData }),
      )
    })

    expect(screen.getByAltText('')).toHaveAttribute('src', 'data:image/png;base64,EXISTING==')
  })

  it('the employee save still succeeds even when assign swallows a same-day-collision internally', async () => {
    stubApiHooks({ resolvedOwners: { 'emp-1': { salesPersonId: 'sp-alice', source: 'direct' } } })
    // The exact substring `assignOwnerFromEmail` matches on (Task 1.1) — a
    // real rejection this helper is documented to swallow rather than
    // rethrow. This proves the wiring's `await` doesn't turn that swallowed
    // error into a failed employee save.
    assignMutateAsync.mockRejectedValue(new Error('a replacement must start after that owner ends'))
    // `assignOwnerFromEmail` deliberately `console.warn`s this expected,
    // swallowed case (Task 1.1) — silenced here so the test's own pass/fail
    // signal isn't buried under intentional, already-covered-elsewhere noise.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const employee = makeEmployee()
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDialog({ employee })

    const ownerField = screen.getByLabelText(/relationship owner/i)
    await user.clear(ownerField)
    await user.type(ownerField, 'bob@amnex.com')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(assignMutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('emp-1'))
    expect(onClose).toHaveBeenCalled()
  })
})

const DEPARTMENT: HierNode = {
  id: 'dept-1', domain: 'org', typeKey: 'department', parentId: null, stateCode: 5,
  name: 'Health Department', code: null, sortOrder: 0, metadata: {}, status: 'active',
}
const BRANCH: HierNode = {
  id: 'branch-1', domain: 'org', typeKey: 'branch', parentId: 'dept-1', stateCode: 5,
  name: 'Test Branch', code: null, sortOrder: 0, metadata: {}, status: 'active',
}

vi.mock('./contact-ocr', () => ({
  extractContact: vi.fn(),
}))

describe('EmployeeFormDialog — Department field (read-only, resolved) and Website/Address removal (items 3 & 4)', () => {
  it('shows a read-only Department field pre-filled from a department node opened directly', async () => {
    stubApiHooks({ breadcrumbTrail: [DEPARTMENT] })
    renderDialog({ orgNode: DEPARTMENT, employee: null })

    const field = await screen.findByLabelText(/^department/i)
    expect(field).toHaveValue('Health Department')
    expect(field).toHaveAttribute('readonly')
  })

  it('resolves the nearest ancestor department when opened from a nested branch/office/unit', async () => {
    stubApiHooks({ breadcrumbTrail: [DEPARTMENT, BRANCH] })
    renderDialog({ orgNode: BRANCH, employee: null })

    const field = await screen.findByLabelText(/^department/i)
    expect(field).toHaveValue('Health Department')
    expect(field).toHaveAttribute('readonly')
  })

  it('falls back to an editable Department field when no department ancestor resolves', async () => {
    const ORPHAN: HierNode = {
      id: 'orphan-1', domain: 'org', typeKey: 'office', parentId: null, stateCode: 5,
      name: 'Orphan Office', code: null, sortOrder: 0, metadata: {}, status: 'active',
    }
    stubApiHooks({ breadcrumbTrail: [ORPHAN] })
    renderDialog({ orgNode: ORPHAN, employee: null })

    const field = await screen.findByLabelText(/^department/i)
    expect(field).not.toHaveAttribute('readonly')
  })

  it('does not render Website or Address fields at all', async () => {
    stubApiHooks({ breadcrumbTrail: [DEPARTMENT] })
    renderDialog({ orgNode: DEPARTMENT, employee: null })

    await screen.findByLabelText(/^department/i)
    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument()
  })

  it('submitting a new employee does not include website/address keys in the create payload', async () => {
    stubApiHooks({ breadcrumbTrail: [DEPARTMENT] })
    createMutateAsync.mockResolvedValue({ id: 'new-emp-id' })
    const user = userEvent.setup()
    renderDialog({ orgNode: DEPARTMENT, employee: null })

    await user.type(screen.getByLabelText(/full name/i), 'New Person')
    await user.type(screen.getByLabelText(/^designation$/i), 'Deputy Director')
    await user.type(screen.getByRole('textbox', { name: /^email$/i }), 'new.person@gov.in')
    await user.type(screen.getByLabelText(/phone number/i), '9876500000')

    await user.click(screen.getByRole('button', { name: /add employee/i }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled())
    const payload = createMutateAsync.mock.calls[0][0]
    expect(payload).not.toHaveProperty('website')
    expect(payload).not.toHaveProperty('address')
  })

  it('editing an employee with existing website/address in the DB does not clear them (patch omits the keys)', async () => {
    stubApiHooks({ resolvedOwners: { 'emp-1': { salesPersonId: 'sp-alice', source: 'direct' } }, employeeOrgNode: DEPARTMENT, breadcrumbTrail: [DEPARTMENT] })
    const employee = makeEmployee({ website: 'https://existing.example.com', address: '123 Existing Rd' })
    const user = userEvent.setup()
    renderDialog({ employee })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    const { patch } = updateMutateAsync.mock.calls[0][0]
    expect(patch).not.toHaveProperty('website')
    expect(patch).not.toHaveProperty('address')
  })

  it('OCR scan still populates name/designation/email/phone/company but not address/website', async () => {
    stubApiHooks({ breadcrumbTrail: [] })
    const { extractContact } = await import('./contact-ocr')
    vi.mocked(extractContact).mockResolvedValue({
      name: 'Scanned Name', designation: 'Scanned Designation', email: 'scanned@gov.in',
      phone: '9998887770', company: 'Scanned Co', address: 'Scanned Address', website: 'scanned.example.com',
    })
    const ORPHAN: HierNode = {
      id: 'orphan-2', domain: 'org', typeKey: 'office', parentId: null, stateCode: 5,
      name: 'Orphan Office 2', code: null, sortOrder: 0, metadata: {}, status: 'active',
    }
    const user = userEvent.setup()
    renderDialog({ orgNode: ORPHAN, employee: null })

    // Upload a front card image to unlock "Pick up contact".
    const file = new File(['(binary)'], 'card.png', { type: 'image/png' })
    class FakeFileReader {
      result: string | ArrayBuffer | null = null
      onload: (() => void) | null = null
      readAsDataURL() {
        this.result = 'data:image/png;base64,CARD=='
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader as unknown as typeof FileReader)
    const fileInput = document.querySelector('input[type="file"][accept="image/*,application/pdf"]') as HTMLInputElement
    await user.upload(fileInput, file)

    // Exact (non-regex) name match: the Field wrapper's <label> spans all
    // three buttons in this row, so a substring/regex name match against
    // "Replace front" also picks up the sibling "Pick up contact" text via
    // the shared label's computed accessible name — exact equality avoids
    // that false match.
    await user.click(screen.getByRole('button', { name: 'Pick up contact' }))

    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toHaveValue('Scanned Name'))
    expect(screen.getByLabelText(/designation/i)).toHaveValue('Scanned Designation')
    expect(screen.getByRole('textbox', { name: /^email$/i })).toHaveValue('scanned@gov.in')
    expect(screen.getByLabelText(/^department/i)).toHaveValue('Scanned Co')
    // No Address/Website fields exist to have been populated in the first place.
    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Address')).not.toBeInTheDocument()
  })
})

describe('EmployeeFormDialog — required designation and save-error surfacing', () => {
  it('disables Add employee until Designation is filled, even with name/email/phone present', async () => {
    stubApiHooks({ breadcrumbTrail: [] })
    const user = userEvent.setup()
    renderDialog({ orgNode: ORG_NODE, employee: null })

    await user.type(screen.getByLabelText(/full name/i), 'New Person')
    await user.type(screen.getByRole('textbox', { name: /^email$/i }), 'new.person@gov.in')
    await user.type(screen.getByLabelText(/phone number/i), '9876500000')

    expect(screen.getByRole('button', { name: /add employee/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/^designation$/i), 'Deputy Director')

    expect(screen.getByRole('button', { name: /add employee/i })).toBeEnabled()
  })

  it('shows a toast and leaves the dialog open when the create mutation rejects, instead of failing silently', async () => {
    stubApiHooks({ breadcrumbTrail: [] })
    createMutateAsync.mockRejectedValue(new Error('String must contain at least 1 character(s)'))
    const user = userEvent.setup()
    const { onSaved, onClose } = renderDialog({ orgNode: ORG_NODE, employee: null })

    await user.type(screen.getByLabelText(/full name/i), 'New Person')
    await user.type(screen.getByLabelText(/^designation$/i), 'Deputy Director')
    await user.type(screen.getByRole('textbox', { name: /^email$/i }), 'new.person@gov.in')
    await user.type(screen.getByLabelText(/phone number/i), '9876500000')

    await user.click(screen.getByRole('button', { name: /add employee/i }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalled())
    await screen.findByText(/Couldn't save/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
