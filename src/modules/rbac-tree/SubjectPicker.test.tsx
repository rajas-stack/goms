import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RbacSubjects } from '@goms/domain'
import type { MasterEmployee } from '@/features/org/masterEmployees'
import { SubjectPicker } from './SubjectPicker'

const emp = (name: string, email: string, departments: string[]): MasterEmployee =>
  ({ key: name, name, email, designation: 'Manager', level: 3, departments, sources: ['org'], orgPersonId: name, status: 'active' })
const EMPLOYEES = [emp('Asha Rao', 'Asha@amnex.com', ['Pre-Sales']), emp('Bala Iyer', '', ['Legal']), emp('Chitra Nair', 'chitra@amnex.com', ['Finance'])]
const SUBJECTS = { users: ['outsider@partner.com'], links: {}, templates: [], customRoles: [] } as unknown as RbacSubjects

const renderPicker = (onSelect = vi.fn()) => {
  render(<SubjectPicker subjects={SUBJECTS} employees={EMPLOYEES} selected={null} canEdit onSelect={onSelect} onNewRole={vi.fn()} onNewTemplate={vi.fn()} />)
  return onSelect
}

describe('Roles & Access > Users tab', () => {
  it('lists every employee (plus configured non-employees) and configures one on click by lower-cased email', async () => {
    const onSelect = renderPicker()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    expect(screen.getByRole('button', { name: /Chitra Nair/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /outsider@partner\.com/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Asha Rao/ }))
    expect(onSelect).toHaveBeenCalledWith({ type: 'user', id: 'asha@amnex.com' })
  })

  it('shows people without an email disabled with the hint', async () => {
    renderPicker()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    const bala = screen.getByRole('button', { name: /Bala Iyer/ })
    expect(bala).toBeDisabled()
    expect(bala).toHaveTextContent('Add an email in Teams → Employees to configure access')
  })

  it('searches by department, and still offers "Configure" for a typed email not in the list', async () => {
    const onSelect = renderPicker()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    await userEvent.type(screen.getByLabelText('Search users'), 'finance')
    expect(screen.getByRole('button', { name: /Chitra Nair/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asha Rao/ })).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search users'))
    await userEvent.type(screen.getByLabelText('Search users'), 'new.person@amnex.com')
    await userEvent.click(screen.getByRole('button', { name: 'Configure new.person@amnex.com' }))
    expect(onSelect).toHaveBeenCalledWith({ type: 'user', id: 'new.person@amnex.com' })
  })
})
