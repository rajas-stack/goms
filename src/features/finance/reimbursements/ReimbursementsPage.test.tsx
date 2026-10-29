import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { ReimbursementsPage } from './ReimbursementsPage'

const renderPage = () => render(
  <MemoryRouter initialEntries={['/finance/reimbursements?month=2026-09']}><ToastProvider><ReimbursementsPage /></ToastProvider></MemoryRouter>,
)

describe('Reimbursements page', () => {
  beforeEach(() => localStorage.clear())

  it('adds an expense, shows it in the month with its total, and locks the month once submitted', async () => {
    const user = userEvent.setup()
    renderPage()
    const form = screen.getByRole('form', { name: 'Add expense' })
    await user.click(within(form).getByRole('button', { name: 'Add option' }))
    await user.type(screen.getByRole('dialog').querySelector('input')!, '0-000104 (Sales Internal Cost Project){Enter}')
    expect(within(form).getByRole('combobox', { name: /network \/ wbs \/ project/i })).toHaveValue('0-000104 (Sales Internal Cost Project)')
    await user.type(within(form).getByRole('combobox', { name: 'From' }), 'Hotel')
    await user.type(within(form).getByRole('combobox', { name: 'To' }), 'Janpath Office')
    expect(within(form).getByLabelText('Particulars')).toHaveValue('Hotel to Janpath Office')
    await user.type(within(form).getByLabelText('Kms'), '11')
    await user.type(within(form).getByLabelText('Amount (₹)'), '338.34')
    await user.click(within(form).getByRole('button', { name: /add expense/i }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('Hotel to Janpath Office')).toBeInTheDocument()
    expect(within(table).getByText('₹30.76')).toBeInTheDocument() // rate = amount / kms
    const key = Object.keys({ ...localStorage }).find((k) => k.startsWith('goms.finance.reimbursements'))!
    expect(JSON.parse(localStorage.getItem(key)!)['2026-09'].expenses[0].project).toBe('0-000104 (Sales Internal Cost Project)')

    await user.click(screen.getByRole('button', { name: /mark as submitted/i }))
    expect(screen.queryByRole('form', { name: 'Add expense' })).not.toBeInTheDocument()
    expect(screen.getByText(/rows are locked after submission/i)).toBeInTheDocument()
  })

  it('refuses an expense without an amount', async () => {
    const user = userEvent.setup()
    renderPage()
    const form = screen.getByRole('form', { name: 'Add expense' })
    await user.type(within(form).getByLabelText('Particulars'), 'Printouts')
    await user.click(within(form).getByRole('button', { name: /add expense/i }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('clears every field with Clear and pays own vehicle at 8 per km', async () => {
    const user = userEvent.setup()
    renderPage()
    const form = screen.getByRole('form', { name: 'Add expense' })
    await user.click(within(form).getByRole('radio', { name: 'Own vehicle' }))
    await user.type(within(form).getByLabelText('Kms'), '37.41')
    expect(within(form).getByLabelText('Amount (₹)')).toHaveValue(299.28)
    await user.type(within(form).getByLabelText('Remarks'), 'Meeting')
    await user.click(within(form).getByRole('button', { name: 'Clear' }))
    expect(within(form).getByLabelText('Kms')).toHaveValue(null)
    expect(within(form).getByLabelText('Remarks')).toHaveValue('')
    expect(within(form).getByRole('radio', { name: 'Cab' })).toHaveAttribute('aria-checked', 'true')
  })

  it('stars a place under a short name and offers it again, filling Particulars with the short name', async () => {
    const user = userEvent.setup()
    renderPage()
    const form = screen.getByRole('form', { name: 'Add expense' })
    await user.type(within(form).getByRole('combobox', { name: 'From' }), 'Orchid Greenfield Applewood')
    await user.click(within(form).getByRole('button', { name: 'Star From place' }))
    const shortName = within(form).getByRole('textbox', { name: 'Short name for this place' })
    await user.clear(shortName)
    await user.type(shortName, 'Home{Enter}')
    expect(within(form).getByRole('combobox', { name: 'From' })).toHaveValue('Home')
    expect(within(form).getByRole('button', { name: 'Edit starred place Home' })).toBeInTheDocument()

    await user.type(within(form).getByRole('combobox', { name: 'To' }), 'hom')
    await user.click(within(screen.getByRole('listbox')).getByText('Home'))
    expect(within(form).getByRole('combobox', { name: 'To' })).toHaveValue('Home')
    expect(within(form).getByLabelText('Particulars')).toHaveValue('Home to Home')
  })

  it('deletes a row after one confirmation, and asks separately (with a typed code) before deleting its Drive bills', async () => {
    const row = (id: string, particulars: string, attachments: unknown[] = []) => ({
      id, trip: 1, date: '2026-09-07', project: 'P', particulars, mode: 'Cab', kms: null, amount: 100, remarks: '', attachments, createdAt: `2026-09-01T00:00:0${id}Z`,
    })
    const bill = { id: 'a1', code: 'RB-202609-T01-R02-A1', originalName: 'bill.pdf', mimeType: 'application/pdf', size: 1, state: 'saved', driveId: 'drive-1' }
    localStorage.setItem('goms.finance.reimbursements.v1:local', JSON.stringify({
      '2026-09': { month: '2026-09', status: 'collecting', statusDates: {}, expenses: [row('1', 'Printouts'), row('2', 'Hotel to Office', [bill])] },
    }))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Delete row RB-202609-T01-R01' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(screen.queryByText('Printouts')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete row RB-202609-T01-R01' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    const drive = await screen.findByRole('dialog', { name: /delete this bill from google drive/i })
    await new Promise((r) => setTimeout(r, 600)) // past any close animation: the Drive step must stay open
    expect(screen.getByRole('dialog', { name: /delete this bill from google drive/i })).toBeVisible()
    expect(within(drive).getByText('RB-202609-T01-R01-A1')).toBeInTheDocument()
    await user.type(within(drive).getByRole('textbox', { name: 'Type the code' }), 'wrong1')
    expect(within(drive).getByRole('button', { name: 'Delete from Drive' })).toBeDisabled()
    await user.click(within(drive).getByRole('button', { name: 'Keep in Drive' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
