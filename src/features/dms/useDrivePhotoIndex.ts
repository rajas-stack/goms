import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { parseEmployeeNumber, type PhotoPerson } from '@goms/domain'
import { useAllEmployees, useDeliveryTeamMembers, useOrgPeople, useSalesPersons } from '@/lib/api'
import { normalizeEmailKey } from '@/features/org/masterEmployees'
import { PROFILE_IMAGES_QUERY } from './profileImagesClient'
import { buildDrivePhotoIndex, fetchDriveFolderListings, type DrivePhotoIndex } from './driveProfileImages'

export const DRIVE_LISTINGS_QUERY = [...PROFILE_IMAGES_QUERY, 'drive-listings'] as const
const UNCONNECTED: DrivePhotoIndex = { configured: false, versions: {}, people: {}, names: {}, report: {} }

/** Serverless photo index. Folder listings refresh every minute and on tab focus; matching re-runs whenever
 *  people change, so a new or renumbered profile picks up its photo with no manual sync. */
export function useDrivePhotoIndex() {
  const client = useQueryClient()
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: DRIVE_LISTINGS_QUERY }) }
    window.addEventListener('goms:dms-session-changed', refresh)
    return () => window.removeEventListener('goms:dms-session-changed', refresh)
  }, [client])
  const listings = useQuery({ queryKey: DRIVE_LISTINGS_QUERY, queryFn: fetchDriveFolderListings, staleTime: 60_000, refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false })
  const { data: org = [] } = useOrgPeople()
  const { data: sales = [] } = useSalesPersons()
  const { data: members = [] } = useDeliveryTeamMembers()
  const { data: employees = [] } = useAllEmployees()

  const index = useMemo(() => {
    if (!listings.data) return UNCONNECTED
    const orgNumber = new Map(org.map((p) => [p.id, p.employeeNumber ?? null]))
    const numbers = (...values: (string | null | undefined)[]) => values.filter((v): v is string => !!v)
    const people: Record<string, PhotoPerson[]> = {
      internal: org.map((p) => ({ id: p.id, name: p.name, numbers: numbers(p.employeeNumber) })),
      sales: sales.map((p) => ({ id: p.id, name: p.name, numbers: numbers(parseEmployeeNumber(p.employeeCode ?? '')) })),
      delivery: members.map((m) => ({ id: m.id, name: m.name, numbers: numbers(m.orgPersonId ? orgNumber.get(m.orgPersonId) : null) })),
      clientDepartment: employees.filter((e) => !e.vacant).map((e) => ({ id: e.id, name: e.name, numbers: numbers(e.directoryNumber != null ? String(e.directoryNumber) : null) })),
    }
    // One human's rows: the org person, the team members mirroring them, and the Sales row with their email.
    const groups = org.map((p) => [
      p.id, ...members.filter((m) => m.orgPersonId === p.id).map((m) => m.id),
      ...(normalizeEmailKey(p.email) ? sales.filter((s) => normalizeEmailKey(s.officialEmail) === normalizeEmailKey(p.email)).map((s) => s.id) : []),
    ])
    return buildDrivePhotoIndex(listings.data, people, groups)
  }, [listings.data, org, sales, members, employees])

  return { index, isFetching: listings.isFetching, error: listings.error }
}
