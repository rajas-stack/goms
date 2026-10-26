import { documentToGeneral as readGeneral, type SynopsisNode } from '@goms/domain'
import { parseFriendlyValue } from '@/lib/friendlyDate'

export { GENERAL_FIELDS, GENERAL_GROUPS, generalToDocument, type GeneralField, type GeneralGroup, type GeneralValues } from '@goms/domain'

export function documentToGeneral(document: SynopsisNode | null | undefined): Record<string, string> {
  const values = readGeneral(document)
  if (values.preBidMeeting) values.preBidMeeting = parseFriendlyValue(values.preBidMeeting, 'optional-time') || values.preBidMeeting
  return values
}
