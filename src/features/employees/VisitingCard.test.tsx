import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '@/lib/api'
import { ToastProvider } from '@/components/ui/Toast'
import { VisitingCard } from './VisitingCard'
import type { Employee } from '@/lib/types'

vi.mock('./contact-ocr', () => ({
  extractContact: vi.fn(),
}))

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1', code: 'C1', name: 'Existing Person', designation: 'Officer',
    email: 'existing@gov.in', phone: '+91 9876543210', company: '', address: '', website: '',
    photoUrl: null, orgNodeId: 'node-1', managerId: null, vacant: false, connected: true,
    relationshipStatus: 'new', relationshipQuality: 'neutral', relationshipType: '', introducedBy: '',
    importantContact: false, preferredComm: [], lastInteractionAt: null, followUpDate: null, notes: '',
    charges: [], visitingCards: [
      { id: 'card-1', frontUrl: 'data:image/png;base64,front', frontName: 'front.png', backUrl: null, backName: null },
    ], metadata: {}, status: 'active',
    ...overrides,
  }
}

const updateMutateAsync = vi.fn()

function stub(employee: Employee) {
  vi.spyOn(api, 'useEmployee').mockReturnValue({ data: employee } as unknown as ReturnType<typeof api.useEmployee>)
  vi.spyOn(api, 'useEmployeeMutations').mockReturnValue({
    update: { mutateAsync: updateMutateAsync, isPending: false },
  } as unknown as ReturnType<typeof api.useEmployeeMutations>)
}

function renderCard() {
  return render(
    <ToastProvider>
      <VisitingCard employeeId="emp-1" />
    </ToastProvider>,
  )
}

describe('VisitingCard — "Pick up contact" OCR (item 4: address/website belong to the department)', () => {
  it('does not write address or website onto the employee record, even when OCR finds them', async () => {
    updateMutateAsync.mockClear()
    stub(makeEmployee())
    const { extractContact } = await import('./contact-ocr')
    vi.mocked(extractContact).mockResolvedValue({
      name: '', designation: '', email: 'scanned@gov.in', phone: '9998887770', company: '',
      address: 'Scanned Address, Some City', website: 'https://scanned.example.com',
    })
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('button', { name: /pick up contact/i }))

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled())
    const { patch } = updateMutateAsync.mock.calls[0][0]
    expect(patch).not.toHaveProperty('address')
    expect(patch).not.toHaveProperty('website')
    expect(patch).toMatchObject({ email: 'scanned@gov.in', phone: '9998887770' })
  })
})
