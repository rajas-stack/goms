import type { TenderWebsiteKind } from '@goms/domain'

/** Everything that differs between the two Settings website pages. The list,
 *  form, credential lock, DSC and edit lock are shared. */
export interface WebsiteKindCopy {
  route: string
  /** Name from the shared Icon registry. */
  icon: string
  title: string
  /** One line under the page title. */
  description: string
  /** Shorter line on the Settings card. */
  hint: string
  emptyText: string
  createTitle: string
  formLabel: string
  listLabel: string
  namePlaceholder: string
}

export const WEBSITE_KIND_COPY: Record<TenderWebsiteKind, WebsiteKindCopy> = {
  tender: {
    route: '/settings/tender-websites',
    icon: 'Globe',
    title: 'Tender websites',
    description: "Portals for downloading bidding documents, corrigenda and addenda. They appear as links in a bid's General tab.",
    hint: "Portals for bidding documents and corrigenda, offered in a bid's General tab",
    emptyText: 'No websites yet. Add the portals you download tender documents from, such as E-Proc or GeM.',
    createTitle: 'Create tender website',
    formLabel: 'Add tender website',
    listLabel: 'Saved tender websites',
    namePlaceholder: 'Name, e.g. E-Proc',
  },
  verification: {
    route: '/settings/document-verifications',
    icon: 'ShieldCheck',
    title: 'Document Verifications',
    description: 'Portals to verify certificates and registrations submitted with bids, such as GST, MCA, Udyam or ISO certificates.',
    hint: 'Portals to verify certificates and registrations submitted with bids',
    emptyText: 'No verification sites yet. Add the portals you check bid documents on, such as GST, MCA, Udyam or an ISO certification body.',
    createTitle: 'Create document verification site',
    formLabel: 'Add document verification site',
    listLabel: 'Saved document verification sites',
    namePlaceholder: 'Name, e.g. GST verification',
  },
}
