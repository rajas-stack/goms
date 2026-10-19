import { communicationSearch, type PolicyModuleKey } from '@goms/domain'
import { EmailWorkspace } from '@/features/email-center/EmailWorkspace'
interface Props { bidId: string; opportunityId: string; opportunityName: string; bidCode: string; tenderId?: string; referenceNo?: string | null; module: PolicyModuleKey }
/** Shared mail implementation, independent of the originating record. */
export function CommunicationTab(props: Props) {
  return <EmailWorkspace entity={{ type: 'opportunity', id: props.opportunityId }} title="Communication" searchHint={communicationSearch([props.tenderId, props.referenceNo, props.bidCode, props.opportunityName])} compact />
}
