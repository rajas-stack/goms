import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OrgPerson } from '@/data/org-structure'
import type { SalesPerson } from '@/lib/types'
import { OrgEmployeeRow } from '@/features/org/OrgEmployeeRow'
import { OtherEmployeeRow } from '@/features/org/OtherEmployeeRow'
import { buildMasterEmployees } from '@/features/org/masterEmployees'
import { SalesOrgChartCard } from '@/features/sales/SalesOrgChartCard'
import { salesPersonOption } from '@/features/sales/salesPersonOption'
import { ProfileImagesContext } from './ProfileImagesContext'
import { Avatar } from '@/components/ui/Avatar'
import { profileNameKey } from '@/lib/profileNameKey'
import { nameKey as serverNameKey } from '../../../apps/api/src/profileImages/mapping'

vi.mock('@/lib/useProfileImage', () => ({ useProfileImage: (image: any) => ({ ref: { current: null }, url: image ? `blob:${image.userId}:${image.version}` : null }) }))
const org: OrgPerson = { id: 'org-one', name: 'Org Person', email: 'org@amnex.com', designation: 'Director', level: 1, departments: ['Leadership'], managerId: null, status: 'active', createdAt: '' }
const sales: SalesPerson = { id: 'sales-one', name: 'Sales Person', officialEmail: 'sales@amnex.com', employeeCode: '', personalEmail: '', mobile: '', altMobile: '', joinedOn: null, leftOn: null, status: 'active', photoUrl: 'data:image/png;base64,legacy', notes: '', metadata: {}, createdAt: '', createdBy: null }
const other = buildMasterEmployees([], [], [sales])[0]
const actions = { changeEmail: vi.fn(), changeLevel: vi.fn(), changeManager: vi.fn(), changeDesignation: vi.fn(), changeDepartments: vi.fn(), toggleStatus: vi.fn(), remove: vi.fn() }
const card = { person: sales, posting: undefined, flagged: false, selected: false, expanded: false, canExpand: false, directReportCount: 0, onSelect: vi.fn(), onToggle: vi.fn() }

describe('Drive binding in Employees and Sales', () => {
  const view = (versions: Record<string, string>) => <ProfileImagesContext.Provider value={{ configured: true, versions }}>
    <table><tbody>
      <OrgEmployeeRow person={org} people={[org]} sources={['org']} departmentOptions={['Leadership']} emailEditable={false} emailResetKey={0} canEdit={false} actions={actions} />
      <OtherEmployeeRow employee={other} canEdit={false} pending={false} onAdd={vi.fn()} />
    </tbody></table>
    <SalesOrgChartCard {...card} />
  </ProfileImagesContext.Provider>
  it('shows Drive photos on the employee row, Sales employee row and Sales chart', () => {
    render(view({ 'org-one': 'v1', 'sales-one': 'v2' }))
    expect(screen.getByRole('img', { name: 'Org Person' })).toHaveAttribute('src', 'blob:org-one:v1')
    expect(screen.getAllByRole('img', { name: 'Sales Person' })).toHaveLength(2)
    expect(salesPersonOption(sales).person?.id).toBe(sales.id)
  })
  it('switches versions immediately and keeps all people visible after removal or failed matching', () => {
    const result = render(view({ 'org-one': 'v1', 'sales-one': 'v1' }))
    result.rerender(view({ 'sales-one': 'v2' }))
    expect(screen.getAllByRole('img', { name: 'Sales Person' })[0]).toHaveAttribute('src', 'blob:sales-one:v2')
    expect(screen.queryByRole('img', { name: 'Org Person' })).not.toBeInTheDocument()
    result.rerender(view({}))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Org Person')).toBeVisible()
    expect(screen.getAllByText('Sales Person')).toHaveLength(2)
  })
})

describe('name-only avatars (screens that pass no person id)', () => {
  const named = (names: Record<string, string>) => <ProfileImagesContext.Provider value={{ configured: true, versions: { 'sales-one': 'v3' }, names }}>
    <Avatar person={{ name: 'Mr. Sales Person' }} /><Avatar person={{ name: 'Nobody Here' }} />
  </ProfileImagesContext.Provider>
  it('resolves the photo by normalized full name and keeps initials for unknown names', () => {
    render(named({ salesperson: 'sales-one' }))
    expect(screen.getByRole('img', { name: 'Mr. Sales Person' })).toHaveAttribute('src', 'blob:sales-one:v3')
    expect(screen.getByText('NH')).toBeVisible()
  })
  it('uses the same name key as the server matcher', () => {
    for (const name of ['José A. Mehra', 'Mr. Rohit Tiku', 'ketan  THAKKAR', 'Jane-Doe']) expect(profileNameKey(name)).toBe(serverNameKey(name))
  })
})
