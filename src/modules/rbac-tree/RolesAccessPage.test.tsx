import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import { RolesAccessPage } from './RolesAccessPage'

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><MemoryRouter><RolesAccessPage /></MemoryRouter></ToastProvider>
  </QueryClientProvider>,
)

describe('Settings > Roles & Access (local mode: editable, stored in the local repository)', () => {
  it('cycles a cell inherit → allow → deny, saves it for the role, and shows the subtree inheriting it', async () => {
    renderPage()
    const view = await screen.findByRole('button', { name: /^Opportunity · View: inherit/ })
    await userEvent.click(view)
    await userEvent.click(screen.getByRole('button', { name: /^Opportunity · View: allow/ }))
    expect(screen.getByRole('button', { name: /^Opportunity · View: deny/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 unsaved change')

    await userEvent.click(screen.getByRole('button', { name: 'Expand Opportunity' }))
    expect(screen.getByRole('button', { name: /^Individual Opportunity · View: inherit \(denied\)/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => expect((await repository.getRbacConfig({ type: 'role', id: 'sales' })).grants)
      .toEqual([{ nodeId: 'opportunity', action: 'view', effect: 'deny' }]))
  })

  it('lists functional roles, and the Templates tab offers a new template', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /Pre-sales/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Templates' }))
    expect(screen.getByRole('button', { name: /New template/ })).toBeInTheDocument()
  })
})
