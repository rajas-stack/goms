import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { MEDIA_TYPES, whatsappApi, type WhatsAppMedia, type WhatsAppMessage } from './api'
import { SheetPreview, TextPreview, WordPreview } from './DocPreviews'

/** A message's file: what it is, and its bytes when the gateway could provide them. */
export interface ChatFile { mimetype: string; filename: string; sizeBytes: number; blob?: Blob }

const MB = 1024 * 1024
/** The gateway's download cap (MEDIA_DOWNLOAD_MAX_BYTES in ../OpenWA/.env). */
const MAX_FILE_BYTES = 100 * MB
const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv)$/i

export const formatSize = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'application/pdf': 'pdf',
}
/** WhatsApp sends no name with photos, videos and voice notes; downloads still get a readable one. */
export function fileName(message: Pick<WhatsAppMessage, 'type' | 'timestamp'>, media: Pick<WhatsAppMedia, 'mimetype' | 'filename'>): string {
  if (media.filename) return media.filename
  const type = media.mimetype.split(';')[0].trim()
  const ext = EXTENSION[type] ?? type.split('/')[1] ?? 'bin'
  return `WhatsApp ${message.type} ${new Date(message.timestamp * 1000).toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`
}

export type Preview = 'pdf' | 'sheet' | 'word' | 'text' | 'convert' | 'image' | 'video' | 'audio' | null
/** How a document can be shown in the page, or null when it can only be downloaded. Spreadsheets and Word documents open in their
 *  own format; only what the browser cannot draw (PowerPoint, legacy .doc/.ppt, RTF, OpenDocument text/slides) becomes a PDF. */
export function previewOf(file: Pick<ChatFile, 'mimetype' | 'filename'>): Preview {
  if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.filename)) return 'pdf'
  if (/\.(xlsx|xlsm|xls|ods|csv)$/i.test(file.filename) || /spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(file.mimetype)) return 'sheet'
  if (/\.docx$/i.test(file.filename) || /wordprocessingml/.test(file.mimetype)) return 'word'
  if (/\.txt$/i.test(file.filename) || file.mimetype.startsWith('text/plain')) return 'text'
  if (OFFICE.test(file.filename) || /msword|ms-powerpoint|presentationml|opendocument|rtf/.test(file.mimetype)) return 'convert'
  for (const kind of ['image', 'video', 'audio'] as const) if (file.mimetype.startsWith(`${kind}/`)) return kind
  return null
}

export interface ContactCard { name: string; phones: string[]; org?: string; vcard: string }
/** The contact cards in a shared-contact message (one or more vCards). */
export function parseVCards(text: string): ContactCard[] {
  return (text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? []).map((vcard) => {
    const lines = vcard.replace(/\r?\n[ \t]/g, '').split(/\r?\n/) // unfold continuation lines first
    const value = (line: string) => line.slice(line.indexOf(':') + 1).trim()
    const name = lines.find((line) => /^FN[:;]/i.test(line))
    const org = lines.find((line) => /^ORG[:;]/i.test(line))
    return {
      name: name ? value(name) : 'Contact',
      phones: lines.filter((line) => /^(item\d+\.)?TEL[:;]/i.test(line)).map(value).filter(Boolean),
      ...(org && value(org) ? { org: value(org).replace(/;+$/, '') } : {}),
      vcard,
    }
  })
}

function toBlob(base64: string, mimetype: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimetype })
}

/** An object URL for a blob, released when the component unmounts or the blob changes. */
export function useObjectUrl(blob?: Blob): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) { setUrl(undefined); return }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

/** The files of a chat's messages. The recent ones load with the chat (WhatsApp Web has no per-message download, so the gateway
 *  fetches the last 50 messages' files together, one by one); a message that arrived later comes from the gateway's saved copy. */
export function useChatFiles(sessionId: string, chatId: string, messages: WhatsAppMessage[]) {
  const withMedia = messages.filter((message) => MEDIA_TYPES.has(message.type))
  const recent = useQuery({
    queryKey: ['whatsapp', sessionId, 'attachments', chatId], enabled: withMedia.length > 0, staleTime: Infinity, retry: 1,
    queryFn: async () => new Map([...(await whatsappApi.attachments(sessionId, chatId))].map(([id, media]) => [id, {
      mimetype: media.mimetype, filename: media.filename ?? '', sizeBytes: media.sizeBytes ?? Math.floor(((media.data?.length ?? 0) * 3) / 4),
      blob: media.data ? toBlob(media.data, media.mimetype) : undefined,
    }] as const)),
  })
  const later = recent.isSuccess ? withMedia.filter((message) => !recent.data.has(message.id)) : []
  const saved = useQueries({
    queries: later.map((message) => ({
      queryKey: ['whatsapp', sessionId, 'file', chatId, message.id], staleTime: Infinity,
      // The gateway saves the file just after the message event; give it a moment.
      retry: 3, retryDelay: 1500,
      queryFn: () => whatsappApi.storedFile(sessionId, chatId, message.id),
    })),
  })
  const files = new Map<string, ChatFile>()
  for (const message of withMedia) {
    const loaded = recent.data?.get(message.id)
    const savedIndex = later.indexOf(message)
    const blob = loaded?.blob ?? (savedIndex >= 0 ? saved[savedIndex]?.data : undefined)
    const mimetype = loaded?.mimetype || blob?.type || message.media?.mimetype || ''
    if (!loaded && !blob && !message.media) continue
    files.set(message.id, {
      mimetype, blob,
      filename: fileName(message, { mimetype, filename: loaded?.filename || message.media?.filename }),
      sizeBytes: blob?.size ?? loaded?.sizeBytes ?? message.media?.sizeBytes ?? 0,
    })
  }
  const pendingIds = new Set([...(recent.isPending && withMedia.length ? withMedia : []), ...later.filter((_, index) => saved[index]?.isPending)].map((message) => message.id))
  return { files, pendingIds, error: recent.error?.message, retry: () => void recent.refetch() }
}

const DOC_ICON = (file: ChatFile) =>
  /sheet|excel|csv/.test(file.mimetype) || /\.(xlsx?|csv|ods)$/i.test(file.filename) ? 'FileSpreadsheet'
    : /presentation|powerpoint/.test(file.mimetype) || /\.(pptx?|odp)$/i.test(file.filename) ? 'Presentation'
      : file.mimetype.startsWith('image/') ? 'FileImage' : /zip|rar|7z/.test(file.mimetype) ? 'FileArchive' : 'FileText'

const LABEL: Record<string, string> = { image: 'photo', video: 'video', audio: 'audio', voice: 'voice message', document: 'document', sticker: 'sticker' }

/** What sits inside a message bubble for anything that is not plain text. */
export function MessageContent({ message, file, pending, error, onRetry, onOpen }: {
  message: WhatsAppMessage; file?: ChatFile; pending: boolean; error?: string; onRetry: () => void
  onOpen: (target: { kind: 'image' | 'document'; id: string }) => void
}) {
  const caption = message.body && message.type !== 'document' ? <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p> : null
  if (message.type === 'location' && message.location) return <LocationCard location={message.location} />
  if (message.type === 'contact' || message.body.startsWith('BEGIN:VCARD')) {
    const cards = parseVCards(message.body)
    return cards.length ? <div className="space-y-2">{cards.map((card, index) => <ContactView key={index} card={card} />)}</div> : <p>Shared contact</p>
  }
  if (message.type === 'revoked') return <p className="italic opacity-70"><Icon name="CircleAlert" size={12} className="mr-1 inline" />This message was deleted</p>
  if (message.type === 'call') return <p className="flex items-center gap-1.5"><Icon name="PhoneCall" size={13} />{message.fromMe ? 'Outgoing call' : 'Call'}</p>
  if (message.type === 'poll') return <p className="flex items-center gap-1.5"><Icon name="List" size={13} />Poll: {message.body}</p>
  if (!MEDIA_TYPES.has(message.type)) return <p className="whitespace-pre-wrap break-words">{message.body || `[${message.type}]`}</p>

  const label = LABEL[message.type] ?? 'file'
  if (!file?.blob) {
    return (
      <div className="w-64 max-w-full">
        <Unavailable label={label} file={file} pending={pending} error={error} onRetry={onRetry} />
        {caption}
      </div>
    )
  }
  if (message.type === 'image' || message.type === 'sticker') {
    return (
      <div>
        <Thumb blob={file.blob} alt={message.body || label} sticker={message.type === 'sticker'} onClick={message.type === 'image' ? () => onOpen({ kind: 'image', id: message.id }) : undefined} />
        {caption}
      </div>
    )
  }
  if (message.type === 'video') return <div className="w-72 max-w-full"><Player kind="video" file={file} />{caption}</div>
  if (message.type === 'audio' || message.type === 'voice') return <div className="w-72 max-w-full"><Player kind="audio" file={file} />{caption}</div>
  return <DocumentCard file={file} onPreview={previewOf(file) ? () => onOpen({ kind: 'document', id: message.id }) : undefined} caption={message.body && message.body !== file.filename ? message.body : undefined} />
}

function Unavailable({ label, file, pending, error, onRetry }: { label: string; file?: ChatFile; pending: boolean; error?: string; onRetry: () => void }) {
  if (pending) {
    return (
      <div className="flex h-20 items-center gap-3 overflow-hidden rounded-lg bg-ink-900/10 px-3" aria-busy="true">
        <Icon name="Loader" className="animate-spin opacity-70" />
        <span className="text-[13px] opacity-80">Loading {label}…</span>
      </div>
    )
  }
  const tooLarge = (file?.sizeBytes ?? 0) > MAX_FILE_BYTES
  return (
    <div className="rounded-lg bg-ink-900/10 px-3 py-2 text-[13px]">
      <p className="flex items-center gap-1.5 font-medium"><Icon name={tooLarge ? 'FileArchive' : 'CircleAlert'} size={14} />
        {tooLarge ? `Too large to open here (${formatSize(file!.sizeBytes)})` : error ? `Could not load this ${label}` : `This ${label} is not available here`}</p>
      <p className="mt-0.5 opacity-75">
        {tooLarge ? 'Open it on your phone.' : error ?? 'WhatsApp could not provide the file (older files expire from its servers). Open it on your phone.'}
      </p>
      {!tooLarge && <button onClick={onRetry} className="mt-1 font-semibold underline-offset-2 hover:underline">Try again</button>}
    </div>
  )
}

function Thumb({ blob, alt, sticker, onClick }: { blob: Blob; alt: string; sticker?: boolean; onClick?: () => void }) {
  const url = useObjectUrl(blob)
  if (!url) return <div className="h-40 w-56 rounded-lg bg-ink-900/10" />
  const image = <img src={url} alt={alt} className={cn(sticker ? 'h-32 w-32 object-contain' : 'max-h-72 w-full min-w-40 object-cover transition duration-200 hover:scale-[1.02]')} />
  return onClick
    ? <button onClick={onClick} aria-label={`Open ${alt}`} className="block max-w-72 overflow-hidden rounded-lg focus-visible:focus-ring">{image}</button>
    : image
}

function DownloadLink({ file, className, children }: { file: ChatFile; className?: string; children?: ReactNode }) {
  const url = useObjectUrl(file.blob)
  return <a href={url} download={file.filename} className={cn('inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline', className)}><Icon name="Download" size={13} />{children ?? 'Download'}</a>
}

function Player({ kind, file }: { kind: 'video' | 'audio'; file: ChatFile }) {
  const url = useObjectUrl(file.blob)
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <div className="rounded-lg bg-ink-900/10 px-3 py-2 text-[13px]"><p>This {kind} format cannot play in the browser.</p><DownloadLink file={file} className="mt-1" /></div>
  }
  return (
    <div className="space-y-1">
      {kind === 'video'
        ? <video src={url} controls preload="metadata" onError={() => setFailed(true)} className="max-h-72 w-full rounded-lg bg-black" />
        : <audio src={url} controls preload="metadata" onError={() => setFailed(true)} className="h-10 w-full" />}
      <DownloadLink file={file} className="text-[12px] opacity-80" />
    </div>
  )
}

function DocumentCard({ file, onPreview, caption }: { file: ChatFile; onPreview?: () => void; caption?: string }) {
  const ext = (file.filename.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? file.mimetype.split('/')[1] ?? 'file').toUpperCase()
  return (
    <div className="w-72 max-w-full">
      <div className="flex items-center gap-3 rounded-lg bg-ink-900/10 p-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/80 text-ink-700"><Icon name={DOC_ICON(file)} size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" title={file.filename}>{file.filename}</span>
          <span className="block text-[11px] opacity-75">{ext} · {formatSize(file.sizeBytes)}</span>
        </span>
      </div>
      <div className="mt-1.5 flex gap-4 text-[12px]">
        {onPreview && <button onClick={onPreview} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"><Icon name="Eye" size={13} />Preview</button>}
        <DownloadLink file={file} />
      </div>
      {caption && <p className="mt-1 whitespace-pre-wrap break-words">{caption}</p>}
    </div>
  )
}

function LocationCard({ location }: { location: NonNullable<WhatsAppMessage['location']> }) {
  const { latitude: lat, longitude: lng } = location
  const box = [lng - 0.004, lat - 0.0025, lng + 0.004, lat + 0.0025].join(',')
  return (
    <div className="w-72 max-w-full">
      <iframe title="Shared location" loading="lazy" className="h-40 w-full rounded-lg border-0 bg-ink-900/10"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${lat},${lng}`} />
      {(location.description || location.address) && <p className="mt-1 font-medium">{location.description || location.address}</p>}
      <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold underline-offset-2 hover:underline"><Icon name="MapPin" size={13} />Open in Google Maps</a>
    </div>
  )
}

function ContactView({ card }: { card: ContactCard }) {
  const file = useMemo<ChatFile>(() => ({ mimetype: 'text/vcard', filename: `${card.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'contact'}.vcf`, sizeBytes: card.vcard.length, blob: new Blob([card.vcard], { type: 'text/vcard' }) }), [card])
  return (
    <div className="w-64 max-w-full rounded-lg bg-ink-900/10 p-2.5">
      <p className="flex items-center gap-2 font-semibold"><Icon name="IdCard" size={16} />{card.name}</p>
      {card.org && <p className="text-[12px] opacity-75">{card.org}</p>}
      {card.phones.map((phone) => <p key={phone} className="text-[13px] tabular-nums">{phone}</p>)}
      <DownloadLink file={file} className="mt-1 text-[12px]">Save contact</DownloadLink>
    </div>
  )
}

export interface ViewerImage { id: string; file: ChatFile; caption?: string; sender: string; timestamp: number }

/** Full-screen photo viewer, as WhatsApp has it: zoom, download, previous/next and a strip of the chat's photos. */
export function ImageViewer({ images, startId, onClose }: { images: ViewerImage[]; startId: string; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((image) => image.id === startId)))
  const [zoom, setZoom] = useState(1)
  const image = images[index]
  const url = useObjectUrl(image?.file.blob)
  const close = useRef<HTMLButtonElement>(null)
  const go = (next: number) => { if (next >= 0 && next < images.length) { setIndex(next); setZoom(1) } }
  useEffect(() => { close.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') go(index - 1)
      else if (event.key === 'ArrowRight') go(index + 1)
      else if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(4, value + 0.5))
      else if (event.key === '-') setZoom((value) => Math.max(1, value - 0.5))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  if (!image) return null
  const tool = 'flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white disabled:opacity-30 focus-visible:focus-ring'
  return createPortal(
    <motion.div role="dialog" aria-modal="true" aria-label="Photo viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white">
      <header className="flex items-center gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{image.sender}</p>
          <p className="text-[12px] text-white/70">{new Date(image.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
        <button className={tool} aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}><Icon name="Minimize2" size={18} /></button>
        <button className={tool} aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}><Icon name="Maximize2" size={18} /></button>
        <a className={tool} href={url} download={image.file.filename} aria-label="Download"><Icon name="Download" size={18} /></a>
        <button ref={close} className={tool} aria-label="Close" onClick={onClose}><Icon name="X" size={20} /></button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto px-16">
        {url && <motion.img key={image.id} src={url} alt={image.caption || 'Photo'} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: zoom }}
          transition={{ duration: 0.18 }} onDoubleClick={() => setZoom((value) => (value > 1 ? 1 : 2))}
          className={cn('max-h-full max-w-full object-contain', zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in')} />}
        {index > 0 && <button className={cn(tool, 'absolute left-4 bg-white/10')} aria-label="Previous photo" onClick={() => go(index - 1)}><Icon name="ChevronLeft" size={22} /></button>}
        {index < images.length - 1 && <button className={cn(tool, 'absolute right-4 bg-white/10')} aria-label="Next photo" onClick={() => go(index + 1)}><Icon name="ChevronRight" size={22} /></button>}
      </div>
      {image.caption && <p className="px-6 pb-2 text-center text-sm text-white/90">{image.caption}</p>}
      <div className="flex justify-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-3">
        {images.map((item, itemIndex) => (
          <button key={item.id} onClick={() => go(itemIndex)} aria-label={`Photo ${itemIndex + 1} of ${images.length}`} aria-current={itemIndex === index ? 'true' : undefined}
            className={cn('h-16 w-16 shrink-0 overflow-hidden rounded-md ring-2 transition', itemIndex === index ? 'ring-emerald-600' : 'opacity-60 ring-transparent hover:opacity-100')}>
            <StripImage blob={item.file.blob} />
          </button>
        ))}
      </div>
    </motion.div>,
    document.body,
  )
}

function StripImage({ blob }: { blob?: Blob }) {
  const url = useObjectUrl(blob)
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null
}

/** Document preview in the file's own format: PDF, spreadsheet, Word or text. Formats a browser cannot draw (PowerPoint, legacy
 *  .doc/.ppt, RTF, OpenDocument) are converted to PDF by the local LibreOffice service. */
export function DocumentViewer({ id, file, onClose }: { id: string; file: ChatFile; onClose: () => void }) {
  const kind = previewOf(file)
  const pdf = useQuery({
    queryKey: ['whatsapp', 'preview', id], staleTime: Infinity, retry: false, enabled: !!file.blob && (kind === 'pdf' || kind === 'convert'),
    queryFn: () => (kind === 'pdf' ? Promise.resolve(file.blob!) : whatsappApi.toPdf(file.blob!, file.filename)),
  })
  const pdfUrl = useObjectUrl(pdf.data)
  const fileUrl = useObjectUrl(kind === 'image' || kind === 'video' || kind === 'audio' ? file.blob : undefined)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => { close.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const tool = 'flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:focus-ring'
  let body: ReactNode
  if (kind === 'image') body = fileUrl && <img src={fileUrl} alt={file.filename} className="max-h-full max-w-full object-contain" />
  else if (kind === 'video') body = fileUrl && <video src={fileUrl} controls className="max-h-full max-w-full" />
  else if (kind === 'audio') body = fileUrl && <audio src={fileUrl} controls className="w-96 max-w-full" />
  else if (kind === 'sheet') body = <SheetPreview id={id} blob={file.blob!} />
  else if (kind === 'word') body = <WordPreview blob={file.blob!} filename={file.filename} />
  else if (kind === 'text') body = <TextPreview blob={file.blob!} />
  else if (pdf.isError) body = <p className="max-w-md text-center text-white/85">Could not prepare a preview: {pdf.error.message} You can still download the file.</p>
  else if (pdfUrl) body = <iframe title={file.filename} src={pdfUrl} className="h-full w-full rounded-lg bg-white" />
  else body = <Preparing converting={kind === 'convert'} />
  return createPortal(
    <motion.div role="dialog" aria-modal="true" aria-label={`Preview of ${file.filename}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white">
      <header className="flex items-center gap-3 px-5 py-3">
        <Icon name={DOC_ICON(file)} size={20} className="shrink-0 text-white/80" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{file.filename}</p>
          <p className="text-[12px] text-white/70">{formatSize(file.sizeBytes)}{kind === 'convert' ? ' · shown as PDF: this format cannot be drawn in a browser' : ''}</p>
        </div>
        <DownloadLink file={file} className={cn(tool, 'no-underline hover:no-underline')} />
        <button ref={close} className={cn(tool, 'w-10 justify-center px-0')} aria-label="Close" onClick={onClose}><Icon name="X" size={20} /></button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">{body}</div>
    </motion.div>,
    document.body,
  )
}

function Preparing({ converting }: { converting: boolean }) {
  return (
    <div className="flex w-72 flex-col items-center gap-3 text-center">
      <Icon name="Loader" size={26} className="animate-spin text-white/80" />
      <p className="text-white/85">{converting ? 'Preparing the preview…' : 'Opening…'}</p>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
        <motion.div className="h-full w-2/5 rounded-full bg-emerald-600" animate={{ x: ['-100%', '250%'] }} transition={{ repeat: Infinity, duration: 1.3, ease: 'easeInOut' }} />
      </div>
    </div>
  )
}
