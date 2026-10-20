import type { MailParticipant } from './communications.js'

/** Gmail's per-message attachment limit; larger files are shared as links in the body. */
export const EMAIL_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024

export const EMAIL_ACTIONS = ['view', 'link', 'unlink', 'send', 'download', 'share', 'team', 'supervisor', 'manageAccess', 'manageMailbox'] as const
export const EMAIL_CENTER_PROCEDURES = ['status', 'connect', 'mailboxes', 'disconnect', 'labels', 'createLabel', 'list', 'read', 'draft', 'identities', 'attachment', 'saveDraft', 'send', 'discardDraft', 'modify', 'context', 'link', 'unlink', 'setCategory', 'entities', 'suggestions', 'stakeholders', 'suggestStakeholder', 'grants', 'requestGrant', 'approveGrant', 'revokeGrant', 'history'] as const
export type EmailAction = typeof EMAIL_ACTIONS[number]
export const EMAIL_ACTION_LABELS: Record<EmailAction, string> = { view: 'View mail', link: 'Link records', unlink: 'Unlink records', send: 'Send / reply', download: 'Download attachments', share: 'Share associations with recipients', team: 'Team view', supervisor: 'Supervisory view', manageAccess: 'Manage mailbox access', manageMailbox: 'Manage Gmail labels and read status' }
export interface EmailEntityRef { type: string; id: string }
export interface EmailEntity extends EmailEntityRef { title: string; path: string }
export type EmailItemKind = 'message' | 'thread'
export interface EmailItemRef { mailboxId: string; kind: EmailItemKind; id: string }
export interface EmailMailbox { id: string; email: string; ownerEmail: string; status: 'connected' | 'reconnect' | 'disconnected'; own: boolean; supervisor: boolean; lastSyncAt: string | null; lastError: string | null; capabilities: EmailAction[] }
export interface EmailAttachment { id: string; partId: string; messageId: string; name: string; mimeType: string; size: number }
export interface EmailMessage {
  id: string; threadId: string; subject: string; date: string; from: MailParticipant[]; to: MailParticipant[]; cc: MailParticipant[]; bcc: MailParticipant[];
  text: string; snippet: string; labels: string[]; attachments: EmailAttachment[]; internetId: string; references: string; replyTo: MailParticipant[]
}
export interface EmailConversation { id: string; messages: EmailMessage[]; subject: string; unavailable?: boolean }
export interface EmailSummary { id: string; threadId: string; subject: string; date: string; from: MailParticipant[]; participants: MailParticipant[]; snippet: string; labels: string[]; messageCount: number; draftId?: string }
export interface EmailLink { id: string; item: EmailItemRef; entity: EmailEntity; participantVisible: boolean; createdAt: string; own: boolean; availability: string; category: string | null; copy?: boolean }
export interface EmailUpload { name: string; mimeType: string; data: string }
export interface EmailCompose {
  mailboxId: string; from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; attachments: EmailUpload[];
  draftId?: string; reply?: { item: EmailItemRef; messageId: string; entity?: EmailEntityRef; mode: 'reply' | 'replyAll' | 'forward' }; requestId: string
}
export interface EmailGrant {
  id: string; mailboxId: string; mailboxEmail: string; ownerEmail: string; grantee: string; kind: 'hod' | 'superadmin'; entity: EmailEntityRef | null; scopeUnavailable?: boolean;
  includeUnlinked: boolean; allowDownload: boolean; expiresAt: string; status: 'pending' | 'approved' | 'revoked'; approvalReference: string; approvedBy: string | null; createdAt: string
}
export function emailSourceUrl(mailboxEmail: string, kind: EmailItemKind, id: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailboxEmail)}#all/${encodeURIComponent(id)}`
}
/** Subject/body mentions never establish recipient identity. Bcc is not disclosed to other recipients. */
export function replyRecipients(message: EmailMessage, identities: readonly string[], all: boolean) {
  const mine = new Set(identities.map(value => value.toLowerCase()))
  const from = message.replyTo.length ? message.replyTo : message.from
  const unique = (people: MailParticipant[], exclude: Set<string>) => [...new Set(people.map(person => person.email.toLowerCase()).filter(email => email && !exclude.has(email)))]
  const to = unique(all ? [...from, ...message.to] : from, mine)
  return { to, cc: all ? unique(message.cc, new Set([...mine, ...to])) : [], bcc: [] as string[] }
}
export const EMAIL_EXTENSION_POINTS = ['classification', 'summary', 'documentBinding', 'actions', 'followUps'] as const
