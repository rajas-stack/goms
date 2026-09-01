import { describe, expect, it, vi } from 'vitest'
import { assignOwnerFromEmail } from './assignOwnerFromEmail'
import { isoToday } from './dates'
import type { SalesPerson } from './types'

const person = (overrides: Partial<SalesPerson> = {}): SalesPerson => ({
  id: 'sp-1',
  employeeCode: 'E001',
  name: 'Asha Rao',
  officialEmail: 'asha@example.com',
  personalEmail: '',
  mobile: '',
  altMobile: '',
  joinedOn: null,
  leftOn: null,
  status: 'active',
  notes: '',
  metadata: {},
  createdAt: '2020-01-01',
  createdBy: null,
  ...overrides,
})

const salesPersons: SalesPerson[] = [
  person({ id: 'sp-1', officialEmail: 'asha@example.com' }),
  person({ id: 'sp-2', officialEmail: 'ravi@example.com' }),
]

const baseArgs = {
  entityType: 'contact' as const,
  entityId: 'contact-1',
  salesPersons,
}

describe('assignOwnerFromEmail', () => {
  it('no-ops when email is empty/undefined', async () => {
    const assignMutateAsync = vi.fn()

    expect(
      await assignOwnerFromEmail({
        ...baseArgs,
        email: undefined,
        currentOwnerSalesPersonId: null,
        assignMutateAsync,
      }),
    ).toBe(false)

    expect(
      await assignOwnerFromEmail({
        ...baseArgs,
        email: null,
        currentOwnerSalesPersonId: null,
        assignMutateAsync,
      }),
    ).toBe(false)

    expect(
      await assignOwnerFromEmail({
        ...baseArgs,
        email: '',
        currentOwnerSalesPersonId: null,
        assignMutateAsync,
      }),
    ).toBe(false)

    expect(assignMutateAsync).not.toHaveBeenCalled()
  })

  it('no-ops when email matches no known SalesPerson', async () => {
    const assignMutateAsync = vi.fn()

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'stale@example.com',
      currentOwnerSalesPersonId: null,
      assignMutateAsync,
    })

    expect(result).toBe(false)
    expect(assignMutateAsync).not.toHaveBeenCalled()
  })

  it('no-ops when resolved salesPersonId equals currentOwnerSalesPersonId (already-current direct owner)', async () => {
    const assignMutateAsync = vi.fn()

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'asha@example.com',
      currentOwnerSalesPersonId: 'sp-1',
      assignMutateAsync,
    })

    expect(result).toBe(false)
    expect(assignMutateAsync).not.toHaveBeenCalled()
  })

  it('calls assignMutateAsync with the right shape when there is no current owner', async () => {
    const assignMutateAsync = vi.fn().mockResolvedValue(undefined)

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'asha@example.com',
      currentOwnerSalesPersonId: null,
      assignMutateAsync,
    })

    expect(result).toBe(true)
    expect(assignMutateAsync).toHaveBeenCalledTimes(1)
    expect(assignMutateAsync).toHaveBeenCalledWith({
      entityType: 'contact',
      entityId: 'contact-1',
      salesPersonId: 'sp-1',
      role: 'owner',
      startDate: isoToday(),
      reason: 'reassignment',
    })
  })

  it('calls assignMutateAsync when the resolved salesPersonId differs from the current (direct) owner', async () => {
    const assignMutateAsync = vi.fn().mockResolvedValue(undefined)

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'asha@example.com',
      currentOwnerSalesPersonId: 'sp-2',
      assignMutateAsync,
    })

    expect(result).toBe(true)
    expect(assignMutateAsync).toHaveBeenCalledTimes(1)
    expect(assignMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ salesPersonId: 'sp-1' }),
    )
  })

  it('proceeds (does not skip) when the caller passes undefined for an inherited-only current owner, even if the salesPersonId happens to match', async () => {
    // Per the task's design decision: the caller is responsible for passing
    // undefined/null as currentOwnerSalesPersonId whenever the existing
    // resolution's source is 'inherited' rather than 'direct'. This helper
    // has no knowledge of OwnerResolution at all — it just does not skip
    // when currentOwnerSalesPersonId is null/undefined, regardless of what
    // the resolved salesPersonId is.
    const assignMutateAsync = vi.fn().mockResolvedValue(undefined)

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'asha@example.com',
      currentOwnerSalesPersonId: undefined,
      assignMutateAsync,
    })

    expect(result).toBe(true)
    expect(assignMutateAsync).toHaveBeenCalledTimes(1)
  })

  it('swallows a same-day-collision error (plain Error, in-memory repository shape) without throwing, and returns false', async () => {
    const assignMutateAsync = vi.fn().mockRejectedValue(
      new Error("The current owner's assignment starts on 2026-09-01; a replacement must start after that."),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'asha@example.com',
      currentOwnerSalesPersonId: 'sp-2',
      assignMutateAsync,
    })

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('swallows a same-day-collision error even when shaped like a TRPCClientError (message-only, no .data)', async () => {
    // Simulates a TRPCClientError: has a .message but no .data.code, since the
    // real backend's TRPCError surfaces client-side with the message intact
    // but this helper must not rely on `.data.code` to detect it.
    class FakeTRPCClientError extends Error {}
    const assignMutateAsync = vi.fn().mockRejectedValue(
      new FakeTRPCClientError(
        "The current owner's assignment starts on 2026-09-01; a replacement must start after that.",
      ),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await assignOwnerFromEmail({
      ...baseArgs,
      email: 'asha@example.com',
      currentOwnerSalesPersonId: 'sp-2',
      assignMutateAsync,
    })

    expect(result).toBe(false)

    warnSpy.mockRestore()
  })

  it('rethrows any other error (e.g. network failure) rather than swallowing it', async () => {
    const assignMutateAsync = vi.fn().mockRejectedValue(new Error('Network request failed'))

    await expect(
      assignOwnerFromEmail({
        ...baseArgs,
        email: 'asha@example.com',
        currentOwnerSalesPersonId: 'sp-2',
        assignMutateAsync,
      }),
    ).rejects.toThrow('Network request failed')
  })

  it('rethrows a BAD_REQUEST-shaped error whose message is unrelated to the same-day-collision guard', async () => {
    const err = new Error('A delegation must have an end date')
    const assignMutateAsync = vi.fn().mockRejectedValue(err)

    await expect(
      assignOwnerFromEmail({
        ...baseArgs,
        email: 'asha@example.com',
        currentOwnerSalesPersonId: 'sp-2',
        assignMutateAsync,
      }),
    ).rejects.toThrow('A delegation must have an end date')
  })
})
