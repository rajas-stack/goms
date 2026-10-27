import { communicationSearch, type PolicyModuleKey } from '@goms/domain'
import { EmailWorkspace } from '@/features/email-center/EmailWorkspace'
import { OpportunityWhatsApp } from '@/features/whatsapp/OpportunityWhatsApp'
import { whatsappAvailable } from '@/features/whatsapp/api'
interface Props { bidId: string; opportunityId: string; opportunityName: string; bidCode: string; tenderId?: string; referenceNo?: string | null; module: PolicyModuleKey }
/** Shared mail implementation, independent of the originating record; WhatsApp messages filed to the opportunity sit above it. */
export function CommunicationTab(props: Props) {
  return (
    <>
      {whatsappAvailable() && <OpportunityWhatsApp opportunityId={props.opportunityId} />}
      <EmailWorkspace entity={{ type: 'opportunity', id: props.opportunityId }} title="Communication" searchHint={communicationSearch([props.tenderId, props.referenceNo, props.bidCode, props.opportunityName])} compact />
    </>
  )
}
