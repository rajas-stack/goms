import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import { AmnexDepartmentsSection } from './AmnexDepartmentsSection'

// Local mode: the real in-memory repository, seeded with the company org (permissions are open without an API).
const renderSection = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AmnexDepartmentsSection /></QueryClientProvider>,
)
const row = (name: string) => screen.getByText(name, { selector: 'span' }).closest('li')!

describe('Settings > Masters > Employee Master > Amnex Departments', () => {
  it('lists the seeded departments with employee counts and locks the system ones', async () => {
    renderSection()
    await screen.findByText('Business Units')
    const presales = row('Pre-Sales')
    expect(within(presales).getByText(/System · drives roles/)).toBeInTheDocument()
    expect(within(presales).queryByRole('button', { name: 'Delete Pre-Sales' })).not.toBeInTheDocument()
    expect(within(presales).queryByRole('button', { name: 'Rename Pre-Sales' })).not.toBeInTheDocument()
    expect(within(row('Business Units')).getByText(/^\d+ employees?$/)).toBeInTheDocument()
  })

  it('adds, renames (also on employees) and deletes a custom department, confirming with its employee count', async () => {
    renderSection()
    await screen.findByText('Business Units')
    await userEvent.type(screen.getByLabelText('New department name'), 'Data Science')
    await userEvent.click(screen.getByRole('button', { name: /Add department/ }))
    await screen.findByText('Data Science', { selector: 'span' })

    const person = (await repository.listOrgPeople())[0]
    await repository.updateOrgPerson(person.id, { departments: [...person.departments, 'Data Science'] })

    await userEvent.click(within(row('Data Science')).getByRole('button', { name: 'Rename Data Science' }))
    const input = screen.getByLabelText('Rename Data Science')
    await userEvent.clear(input)
    await userEvent.type(input, 'Data & AI{Enter}')
    await screen.findByText('Data & AI', { selector: 'span' })
    expect((await repository.listOrgPeople()).find((p) => p.id === person.id)?.departments).toContain('Data & AI')

    await userEvent.click(within(row('Data & AI')).getByRole('button', { name: 'Delete Data & AI' }))
    expect(await screen.findByText(/1 employee/, { selector: 'strong' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete department' }))
    await screen.findByText('Business Units')
    expect(screen.queryByText('Data & AI', { selector: 'span' })).not.toBeInTheDocument()
    expect((await repository.listOrgPeople()).find((p) => p.id === person.id)?.departments).not.toContain('Data & AI')
  })

  it('refuses a duplicate name', async () => {
    renderSection()
    await screen.findByText('Business Units')
    await userEvent.type(screen.getByLabelText('New department name'), 'legal')
    await userEvent.click(screen.getByRole('button', { name: /Add department/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('"legal" is already a department.')
  })
})
