import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository, resetLocalData } from '@/data/repository'
import type { TenderWebsiteKind } from '@goms/domain'
import { WebsitesField } from '@/modules/bid-tracker/synopsis/WebsitesField'
import { TenderWebsitesSection } from './TenderWebsitesSection'
import { lockCredentials } from './credentialLock'

const locked = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
vi.mock('./credentialLock', () => ({
  lockCredentials: vi.fn(async () => ({ version: 1, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })),
  unlockCredentials: vi.fn(async (_lock: unknown, passphrase: string) => {
    if (passphrase !== 'portal-lock') throw new Error('Could not unlock credentials. Check the passphrase.')
    return { userId: 'portal-user', password: 'portal-secret' }
  }),
}))

function renderSection(kind?: TenderWebsiteKind) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><TenderWebsitesSection kind={kind} /></QueryClientProvider>)
}

async function openCreate() {
  await userEvent.click(await screen.findByRole('button', { name: 'Create new' }))
}

describe('TenderWebsitesSection', () => {
  beforeEach(async () => { vi.clearAllMocks(); await resetLocalData() })

  it('adds a website and shows it as a named link opening in a new tab', async () => {
    renderSection()
    expect(screen.queryByLabelText('Website name')).not.toBeInTheDocument()
    await openCreate()
    await userEvent.type(await screen.findByLabelText('Website name'), 'E-Proc')
    await userEvent.type(screen.getByLabelText('Website link'), 'https://eproc.example.gov.in')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    const link = await screen.findByRole('link', { name: /E-Proc/ })
    expect(link).toHaveAttribute('href', 'https://eproc.example.gov.in')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(await repository.listTenderWebsites()).toHaveLength(1)
    expect(screen.queryByLabelText('Website name')).not.toBeInTheDocument()
  })

  it('creates a document verification site that stays off the tender list and the General tab dropdown', async () => {
    await repository.createTenderWebsite({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })
    const { unmount } = renderSection('verification')
    expect(await screen.findByText(/No verification sites yet/)).toBeInTheDocument()
    await openCreate()
    const dialog = screen.getByRole('dialog', { name: 'Create document verification site' })
    const form = within(dialog).getByRole('form', { name: 'Add document verification site' })
    await userEvent.type(within(form).getByLabelText('Website name'), 'GST')
    await userEvent.type(within(form).getByLabelText('Website link'), 'https://services.gst.gov.in')
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))
    const list = await screen.findByRole('list', { name: 'Saved document verification sites' })
    expect(within(list).getByRole('link', { name: /GST/ })).toHaveAttribute('href', 'https://services.gst.gov.in')
    expect(within(list).queryByRole('link', { name: /E-Proc/ })).not.toBeInTheDocument()
    expect((await repository.listTenderWebsites('verification'))[0]).toMatchObject({ name: 'GST', kind: 'verification' })
    unmount()

    renderSection('tender')
    const tenders = await screen.findByRole('list', { name: 'Saved tender websites' })
    expect(within(tenders).getByRole('link', { name: /E-Proc/ })).toBeInTheDocument()
    expect(within(tenders).queryByRole('link', { name: /GST/ })).not.toBeInTheDocument()
  })

  it('offers only tender websites in the General tab dropdown', async () => {
    await repository.createTenderWebsite({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })
    await repository.createTenderWebsite({ kind: 'verification', name: 'Udyam', url: 'https://udyamregistration.gov.in' })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><WebsitesField id="w" label="Websites" value="" onChange={() => undefined} /></QueryClientProvider>)
    await userEvent.click(await screen.findByRole('button', { name: /Choose websites/ }))
    expect(await screen.findByRole('checkbox', { name: 'E-Proc' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Udyam' })).not.toBeInTheDocument()
  })

  it('allows the same name on the verification page as a tender website, but not twice on one page', async () => {
    await repository.createTenderWebsite({ name: 'MCA', url: 'https://www.mca.gov.in' })
    await repository.createTenderWebsite({ kind: 'verification', name: 'ISO check', url: 'https://iso.example' })
    renderSection('verification')
    await openCreate()
    await userEvent.type(await screen.findByLabelText('Website name'), 'iso check')
    await userEvent.type(screen.getByLabelText('Website link'), 'https://iso.example/2')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/)
    await userEvent.clear(screen.getByLabelText('Website name'))
    await userEvent.type(screen.getByLabelText('Website name'), 'MCA')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('link', { name: /MCA/ })).toBeInTheDocument()
    expect((await repository.listTenderWebsites('verification')).map(site => site.name)).toEqual(['ISO check', 'MCA'])
  })

  it('uses the compact editing lock switch on each row', async () => {
    await repository.createTenderWebsite({ kind: 'verification', name: 'GST', url: 'https://services.gst.gov.in' })
    renderSection('verification')
    const toggle = await screen.findByRole('button', { name: 'Lock editing for GST' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('title', 'Lock editing for GST')
    expect(toggle).toHaveClass('lock-switch--compact')
    expect(toggle).not.toHaveTextContent(/Unlocked|Locked/)
    await userEvent.click(toggle)
    const locked = await screen.findByRole('button', { name: 'Unlock editing for GST' })
    expect(locked).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Edit GST' })).toBeDisabled()
  })

  it('refuses a link that is not http(s)', async () => {
    renderSection()
    await openCreate()
    await userEvent.type(await screen.findByLabelText('Website name'), 'Bad')
    await userEvent.type(screen.getByLabelText('Website link'), 'javascript:alert(1)')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/http/)
    expect(await repository.listTenderWebsites()).toHaveLength(0)
  })

  it('edits and deletes a saved website', async () => {
    await repository.createTenderWebsite({ name: 'GeM', url: 'https://gem.gov.in' })
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit GeM' }))
    const form = screen.getByRole('form', { name: 'Edit GeM' })
    const name = within(form).getByLabelText('Website name')
    await userEvent.clear(name)
    await userEvent.type(name, 'GeM portal')
    await userEvent.click(within(form).getByRole('button', { name: /Save/ }))
    expect(await screen.findByRole('link', { name: /GeM portal/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete GeM portal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /GeM portal/ })).not.toBeInTheDocument())
    expect(await repository.listTenderWebsites()).toHaveLength(0)
  })

  it('offers only active L0, L1 and L2 employees for DSC', async () => {
    const people = await repository.listOrgPeople()
    const inactive = people.find(person => person.level === 2)!
    await repository.updateOrgPerson(inactive.id, { status: 'inactive' })
    renderSection()
    await openCreate()
    const select = await screen.findByLabelText('DSC employee')
    await waitFor(() => expect(select).not.toBeDisabled())
    const options = within(select).getAllByRole('option').map(option => option.textContent)
    expect(options).toContain('Aditya Shah (L0)')
    expect(options).toContain('Utpal Gandhi (L1)')
    expect(options).toContain('Nirav Shah (L2)')
    expect(options.some(option => option?.includes(inactive.name))).toBe(false)
    expect(options.some(option => /\(L[3-7]\)/.test(option ?? ''))).toBe(false)
  })

  it('encrypts both credentials when adding a portal, and requires its passphrase to unlock them', async () => {
    renderSection()
    await openCreate()
    await userEvent.type(await screen.findByLabelText('Website name'), 'Secure portal')
    await userEvent.type(screen.getByLabelText('Website link'), 'https://portal.example')
    await userEvent.type(screen.getByLabelText('User ID'), 'portal-user')
    await userEvent.type(screen.getByLabelText('Password'), 'portal-secret')
    await waitFor(() => expect(screen.getByLabelText('DSC employee')).not.toBeDisabled())
    const employee = (await repository.listTenderDscEmployees())[0]
    await userEvent.selectOptions(screen.getByLabelText('DSC employee'), employee.id)
    await userEvent.type(screen.getByLabelText('Create passphrase'), 'portal-lock')
    await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'portal-lock')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('link', { name: /Secure portal/ })
    expect(lockCredentials).toHaveBeenCalledWith({ userId: 'portal-user', password: 'portal-secret' }, 'portal-lock')
    const [site] = await repository.listTenderWebsites()
    expect(site).toMatchObject({ credentials: locked, dscEmployeeId: employee.id })
    expect(JSON.stringify(site)).not.toContain('portal-secret')
    await waitFor(() => expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Edit Secure portal' }))
    const form = screen.getByRole('form', { name: 'Edit Secure portal' })
    expect(within(form).getByLabelText('User ID')).toHaveAttribute('readonly')
    expect(within(form).getByLabelText('Password')).not.toHaveValue('portal-secret')
    await userEvent.click(within(form).getByRole('button', { name: 'Unlock Password' }))
    const unlockDialog = screen.getByRole('dialog', { name: 'Unlock credentials' })
    await userEvent.type(within(unlockDialog).getByLabelText('Credential passphrase'), 'incorrect')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Check the passphrase/)
    await userEvent.clear(within(unlockDialog).getByLabelText('Credential passphrase'))
    await userEvent.type(within(unlockDialog).getByLabelText('Credential passphrase'), 'portal-lock')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(within(form).getByLabelText('User ID')).toHaveValue('portal-user'))
    expect(within(form).getByLabelText('Password')).toHaveValue('portal-secret')
    await userEvent.click(within(form).getByRole('button', { name: 'Lock credentials' }))
    expect(within(form).getByLabelText('User ID')).toHaveAttribute('readonly')
    await userEvent.click(within(form).getByRole('button', { name: /Save/ }))
    await screen.findByRole('button', { name: 'Edit Secure portal' })
    expect((await repository.listTenderWebsites())[0].credentials).toEqual(locked)
  })

  it('cancels creation without saving and rejects unmatched passphrases', async () => {
    renderSection()
    await openCreate()
    await userEvent.type(screen.getByLabelText('Website name'), 'Portal')
    await userEvent.type(screen.getByLabelText('Website link'), 'https://portal.example')
    await userEvent.type(screen.getByLabelText('Password'), 'portal-secret')
    await userEvent.type(screen.getByLabelText('Create passphrase'), 'portal-lock')
    await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'different-lock')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The passphrases do not match.')
    expect(lockCredentials).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Website name')).not.toBeInTheDocument()
    expect(await repository.listTenderWebsites()).toHaveLength(0)
  })

  it('locks editing while credential viewing always asks for the passphrase', async () => {
    await repository.createTenderWebsite({ name: 'Portal', url: 'https://portal.example', credentials: locked })
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Lock editing for Portal' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Portal' })).toBeDisabled())
    expect((await repository.listTenderWebsites())[0].editingLocked).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'View credentials for Portal' }))
    const viewer = screen.getByRole('dialog', { name: 'Credentials: Portal' })
    expect(within(viewer).queryByLabelText('Password')).not.toBeInTheDocument()
    await userEvent.type(within(viewer).getByLabelText('Credential passphrase'), 'incorrect')
    await userEvent.click(within(viewer).getByRole('button', { name: 'Unlock credentials' }))
    expect(await within(viewer).findByRole('alert')).toHaveTextContent('Check the passphrase')
    expect(within(viewer).queryByLabelText('Password')).not.toBeInTheDocument()
    await userEvent.clear(within(viewer).getByLabelText('Credential passphrase'))
    await userEvent.type(within(viewer).getByLabelText('Credential passphrase'), 'portal-lock')
    await userEvent.click(within(viewer).getByRole('button', { name: 'Unlock credentials' }))
    expect(await within(viewer).findByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(within(viewer).getByLabelText('User ID')).toHaveValue('portal-user')
    await userEvent.click(within(viewer).getByRole('button', { name: 'Show Password' }))
    expect(within(viewer).getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(within(viewer).getByLabelText('Password')).toHaveValue('portal-secret')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Unlock editing for Portal' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Portal' })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'View credentials for Portal' }))
    const reopened = screen.getByRole('dialog', { name: 'Credentials: Portal' })
    expect(within(reopened).getByLabelText('Credential passphrase')).toHaveValue('')
    expect(within(reopened).queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('requires the current passphrase before saving a replacement passphrase', async () => {
    await repository.createTenderWebsite({ name: 'Portal', url: 'https://portal.example', credentials: locked })
    renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Portal' }))
    const form = screen.getByRole('form', { name: 'Edit Portal' })
    await userEvent.click(within(form).getByRole('button', { name: 'Change passphrase' }))
    expect(within(form).queryByLabelText('New passphrase')).not.toBeInTheDocument()
    const unlockDialog = screen.getByRole('dialog', { name: 'Unlock credentials' })
    await userEvent.type(within(unlockDialog).getByLabelText('Credential passphrase'), 'portal-lock')
    await userEvent.click(within(unlockDialog).getByRole('button', { name: 'Unlock' }))
    await userEvent.type(await within(form).findByLabelText('New passphrase'), 'replacement-lock')
    await userEvent.type(within(form).getByLabelText('Confirm passphrase'), 'replacement-lock')
    const rotated = { ...locked, ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }
    vi.mocked(lockCredentials).mockResolvedValueOnce(rotated)
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Portal' })).not.toBeInTheDocument())
    expect(lockCredentials).toHaveBeenCalledWith({ userId: 'portal-user', password: 'portal-secret' }, 'replacement-lock')
    expect((await repository.listTenderWebsites())[0].credentials).toEqual(rotated)
    expect(JSON.stringify((await repository.listTenderWebsites())[0])).not.toContain('replacement-lock')
  })
})
