import { useCurrentPostings, useEmployee, useSalesPersons } from '@/lib/api'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'
import { useWorkspace } from '@/features/workspace/context'
import { HangingIdCard, type IdCardPerson } from './HangingIdCard'

/** Badge details for whoever is selected in the Directory; null for kinds that have no badge. */
function useSelectedIdCardPerson(): IdCardPerson | null {
  const { selection } = useWorkspace()
  const { employees, orgPeople } = useMasterEmployees()
  const { data: sales = [] } = useSalesPersons()
  const { data: postings = {} } = useCurrentPostings()
  const { data: contact } = useEmployee(selection?.kind === 'employee' ? selection.id : null)
  if (!selection) return null
  if (selection.kind === 'orgPerson') {
    const p = orgPeople.find((o) => o.id === selection.id)
    const master = employees.find((e) => e.orgPersonId === selection.id)
    return p ? { name: p.name, photoUrl: p.photoUrl, designation: p.designation, email: p.email, code: master?.employeeNumber, base: p.departments[0] } : null
  }
  if (selection.kind === 'salesPerson') {
    const p = sales.find((s) => s.id === selection.id), posting = p ? postings[p.id] : undefined
    return p ? { name: p.name, photoUrl: p.photoUrl, designation: posting?.designation, email: p.officialEmail, code: p.employeeCode, base: p.metadata?.baseLocation || posting?.office } : null
  }
  if (selection.kind === 'employee' && contact) {
    return { name: contact.name, photoUrl: contact.photoUrl, designation: contact.designation, email: contact.email, code: contact.directoryNumber != null ? String(contact.directoryNumber) : null, base: contact.company }
  }
  return null
}

/** The selected person's hanging badge, for the empty left side of the full-screen profile. */
export function SelectedIdCard() {
  const person = useSelectedIdCardPerson()
  const { selection } = useWorkspace()
  return person ? <HangingIdCard key={`${selection?.kind}:${selection?.id}`} person={person} /> : null
}
