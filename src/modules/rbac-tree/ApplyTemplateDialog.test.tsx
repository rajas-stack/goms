import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MasterEmployee } from '@/features/org/masterEmployees'
import { ApplyTemplateDialog } from './ApplyTemplateDialog'
import { applyTargets, departmentRoles, filterEmployees } from './applyTemplateModel'

const emp = (name: string, email: string, level: number | null, departments: string[]): MasterEmployee =>
  ({ key: name, name, email, designation: 'Analyst', level, departments, sources: ['org'], orgPersonId: name, status: 'active' })
const EMPLOYEES = [
  emp('Asha Rao', 'asha@amnex.com', 3, ['Pre-Sales']),
  emp('Bala Iyer', 'bala@amnex.com', 4, ['Pre-Sales', 'Bid Management']),
  emp('Chitra Nair', 'chitra@amnex.com', 4, ['Legal']),
  emp('Dev Patel', '', 4, ['Pre-Sales']),
  emp('Esha Kapoor', 'esha@amnex.com', 2, ['Technology']),
]
const DEPARTMENTS = ['Leadership', 'Pre-Sales', 'Bid Management', 'Legal', 'Technology']

describe('applyTemplateModel', () => {
  it('filters by any selected department AND any selected level; nothing selected keeps everyone', () => {
    expect(filterEmployees(EMPLOYEES, [], [])).toHaveLength(5)
    expect(filterEmployees(EMPLOYEES, ['pre-sales'], [4]).map((e) => e.name)).toEqual(['Bala Iyer', 'Dev Patel'])
    expect(filterEmployees(EMPLOYEES, ['Legal', 'Technology'], []).map((e) => e.name)).toEqual(['Chitra Nair', 'Esha Kapoor'])
  })
  it('maps departments to roles and reports the ones without a role', () => {
    expect(departmentRoles(['Pre-Sales', 'Leadership', 'Technology'])).toEqual({ roles: ['presales', 'cxo'], unmapped: ['Technology'] })
    expect(applyTargets(['A@amnex.com', 'a@amnex.com'], ['Legal'], true)).toEqual([{ type: 'user', id: 'a@amnex.com' }, { type: 'role', id: 'legal' }])
    expect(applyTargets(['a@amnex.com'], ['Legal'], false)).toEqual([{ type: 'user', id: 'a@amnex.com' }])
  })
})

const renderDialog = (onApply = vi.fn().mockResolvedValue(undefined)) => {
  render(<ApplyTemplateDialog open templateName="Analyst" departments={DEPARTMENTS} employees={EMPLOYEES} linked={[]} onClose={vi.fn()} onApply={onApply} />)
  return onApply
}

describe('ApplyTemplateDialog', () => {
  it('filters the employee list by department and level, and Select all picks only the shown people with an email', async () => {
    const onApply = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Pre-Sales' }))
    await userEvent.click(screen.getByRole('button', { name: 'L4' }))
    await userEvent.click(screen.getByLabelText('Search employees'))
    const list = await screen.findByRole('listbox', { name: 'Employees' })
    expect(within(list).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Bala Iyer', 'Dev Patel'])
    expect(within(list).getByRole('checkbox', { name: 'Dev Patel' })).toBeDisabled()
    expect(within(list).getByText('needs an email')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Select all (1 shown)' }))
    expect(within(screen.getByRole('list', { name: 'Selected users' })).getByText('Bala Iyer')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 1' }))
    expect(onApply).toHaveBeenCalledWith([{ type: 'user', id: 'bala@amnex.com' }], 'keep')
  })

  it('also applies to the roles of the selected departments when "whole department" is ticked, and hints at unmapped ones', async () => {
    const onApply = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Legal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Technology' }))
    await userEvent.click(screen.getByLabelText('Also apply to the whole department (future members too)'))
    expect(screen.getByText(/Technology has no role/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Add by email'), 'Guest@Partner.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply to 2' }))
    expect(onApply).toHaveBeenCalledWith([{ type: 'user', id: 'guest@partner.com' }, { type: 'role', id: 'legal' }], 'keep')
  })

  it('removes a selected person with the chip ×, and Clear empties the selection', async () => {
    renderDialog()
    await userEvent.click(screen.getByLabelText('Search employees'))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Asha Rao' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chitra Nair' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Asha Rao' }))
    expect(screen.getByRole('button', { name: 'Apply to 1' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Search employees'))
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Apply to …' })).toBeInTheDocument()
  })
})
