import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { matrixFixture, MATRIX_ROLE_COLUMNS } from './testFixtures'

vi.mock('@/data/repository', () => ({ repository: { getPermissionMatrix: vi.fn(), getMyAccess: vi.fn() } }))
import { repository } from '@/data/repository'
import { PermissionMatrix } from './PermissionMatrix'

const renderMatrix = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PermissionMatrix /></QueryClientProvider>,
)
const moduleRow = (label: string) => screen.getByRole('rowheader', { name: new RegExp(label) }).closest('tr')!
/** The cell of `role` in a module row (cells follow the role columns, after the module name). */
const cellOf = (row: HTMLElement, role: string) => within(row).getAllByRole('cell')[MATRIX_ROLE_COLUMNS.indexOf(role)]

describe('PermissionMatrix', () => {
  it('renders one row per policy module (25) and one column per functional role (8), read-only, from the server data', async () => {
    vi.mocked(repository.getPermissionMatrix).mockResolvedValue(matrixFixture())
    renderMatrix()
    const table = await screen.findByRole('table', { name: /permission matrix/i })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Module', ...MATRIX_ROLE_COLUMNS])
    const moduleRows = within(table).getAllByRole('row').filter((r) => within(r).queryAllByRole('cell').length === 8)
    expect(moduleRows).toHaveLength(25)
    expect(screen.getByText('Pipeline rows')).toBeInTheDocument()
    expect(screen.getByText('Commercial')).toBeInTheDocument() // module groups
    expect(within(table).queryByRole('button')).not.toBeInTheDocument() // nothing here edits anything
    expect(within(table).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('words each cell like the generated matrix: level, scope, field sets, and Create / Delete chips', async () => {
    vi.mocked(repository.getPermissionMatrix).mockResolvedValue(matrixFixture())
    renderMatrix()
    await screen.findByRole('table', { name: /permission matrix/i })
    expect(cellOf(moduleRow('Pipeline rows'), 'Sales')).toHaveTextContent('Read + edit all · own rows only')
    expect(cellOf(moduleRow('Pipeline rows'), 'Sales')).toHaveTextContent('Create')
    expect(cellOf(moduleRow('Pipeline rows'), 'Sales')).not.toHaveTextContent('Delete')
    expect(cellOf(moduleRow('Pipeline rows'), 'Bid')).toHaveTextContent('Read only')
    expect(cellOf(moduleRow('Bid Tracker rows'), 'Pre-sales')).toHaveTextContent('Read + edit some fields (P1) · assigned rows only')
    expect(cellOf(moduleRow('Bid Tracker rows'), 'Bid')).toHaveTextContent('Read + edit all')
    expect(cellOf(moduleRow('Bid Tracker rows'), 'Bid')).toHaveTextContent('Create')
    expect(cellOf(moduleRow('Bid Tracker rows'), 'Bid')).toHaveTextContent('Delete')
    expect(cellOf(moduleRow('SKU catalog & BOM'), 'Sales')).toHaveTextContent('No access')
  })

  it('lists the System Admin only restrictions with their reasons, and says System Admin is unrestricted', async () => {
    vi.mocked(repository.getPermissionMatrix).mockResolvedValue(matrixFixture())
    renderMatrix()
    const section = await screen.findByRole('region', { name: /system admin only/i })
    expect(within(section).getByText('access.setOverride')).toBeInTheDocument()
    expect(within(section).getByText(/only a System Admin can create or change them/)).toBeInTheDocument()
    expect(within(section).getByText('orgPeople.update#email')).toBeInTheDocument()
    expect(screen.getByText(/System Admin is unrestricted/i)).toBeInTheDocument()
    // IT holds W on Role & Access in the matrix, and the module row says part of it is System Admin only
    expect(cellOf(moduleRow('Role & Access Management'), 'IT')).toHaveTextContent('Read + edit all')
    expect(within(moduleRow('Role & Access Management')).getByText(/some actions system admin only/i)).toBeInTheDocument()
    expect(within(moduleRow('Pipeline rows')).queryByText(/system admin only/i)).not.toBeInTheDocument()
  })

  it('shows a dash for a cell the payload does not carry, instead of crashing the screen', async () => {
    const data = matrixFixture()
    delete (data.grants['opp.pipeline'] as Record<string, unknown>).bid // one missing cell
    delete (data.grants as Record<string, unknown>)['com.skus'] // a whole module row missing
    vi.mocked(repository.getPermissionMatrix).mockResolvedValue(data)
    renderMatrix()
    await screen.findByRole('table', { name: /permission matrix/i })
    expect(cellOf(moduleRow('Pipeline rows'), 'Bid')).toHaveTextContent('—')
    expect(cellOf(moduleRow('Pipeline rows'), 'Sales')).toHaveTextContent('Read + edit all · own rows only') // the rest still renders
    expect(cellOf(moduleRow('SKU catalog & BOM'), 'Sales')).toHaveTextContent('—')
  })

  it('lists the named field sets so a cell like "(F1)" can be read', async () => {
    vi.mocked(repository.getPermissionMatrix).mockResolvedValue(matrixFixture())
    renderMatrix()
    await screen.findByRole('table', { name: /permission matrix/i })
    expect(screen.getByText('sku.costs, sku.floor, sku.tax')).toBeInTheDocument()
  })

  it('shows a loading state and then an explicit error when the server refuses', async () => {
    vi.mocked(repository.getPermissionMatrix).mockRejectedValue(Object.assign(new Error('Your role cannot read this.'), { data: { code: 'FORBIDDEN' } }))
    renderMatrix()
    expect(screen.getByText(/loading permission matrix/i)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your role cannot read this.')
    expect(screen.queryByRole('table', { name: /permission matrix/i })).not.toBeInTheDocument()
  })

  it('has an explicit empty state when the matrix has no modules', async () => {
    vi.mocked(repository.getPermissionMatrix).mockResolvedValue({ roles: [], modules: [], grants: {}, fieldSets: {}, restrictions: [] } as never)
    renderMatrix()
    expect(await screen.findByText(/no permission data/i)).toBeInTheDocument()
  })
})
