import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ members: [] as unknown[], org: [] as unknown[] }))
vi.mock('@/lib/api', () => ({
  useDeliveryTeamMembers: () => ({ data: mocks.members, isLoading: false }),
  useOrgPeople: () => ({ data: mocks.org }),
}))
import { DeliveryOrgChart } from './DeliveryOrgChart'

const PHOTO = 'data:image/jpeg;base64,AAAA'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  mocks.members = [
    { id: 'm1', team: 'preSales', name: 'Asha Rao', email: '', designation: 'Lead', status: 'active', managerId: null, orgPersonId: 'o1' },
    { id: 'm2', team: 'preSales', name: 'Hand Added', email: '', designation: 'Analyst', status: 'active', managerId: null, orgPersonId: null },
  ]
  mocks.org = [{ id: 'o1', name: 'Asha Rao', photoUrl: PHOTO }, { id: 'o2', name: 'Someone Else', photoUrl: null }]
})

describe('DeliveryOrgChart photos', () => {
  it("shows an org-linked member's profile photo from the Org Structure, and initials for a hand-added member", () => {
    render(<DeliveryOrgChart team="preSales" />)
    const cards = document.querySelectorAll('[data-canvas-card]')
    const card = (name: string) => [...cards].find((c) => c.textContent?.includes(name)) as HTMLElement
    expect(within(card('Asha Rao')).getByRole('img')).toHaveAttribute('src', PHOTO)
    expect(within(card('Hand Added')).queryByRole('img')).not.toBeInTheDocument()
    expect(within(card('Hand Added')).getByText('HA')).toBeInTheDocument()
    expect(screen.queryByText(/No one on this team yet/)).not.toBeInTheDocument()
  })
})
