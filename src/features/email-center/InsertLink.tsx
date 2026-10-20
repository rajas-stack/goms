import { useState } from 'react'
import { Input } from '@/components/ui/Field'
import { IconAction } from './IconAction'

/** A readable name for a shared-file link: the last path segment, or the host for Drive/Docs links. */
export function linkName(url: string): string {
  try {
    const u = new URL(url)
    if (/(drive|docs)\.google\.com$/.test(u.hostname)) return 'Google Drive file'
    if (/sharepoint\.com$|onedrive\.live\.com$/.test(u.hostname)) return 'OneDrive file'
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
    return last || u.hostname
  } catch { return '' }
}
/** The line inserted into the mail body (plain text, so it stays clickable in every mail client). */
export const linkLine = (name: string, url: string) => `📎 ${name || linkName(url) || 'Shared file'}: ${url}`

/** Compose helper for files over Gmail's 25 MB limit: paste a share link (Drive, OneDrive, any URL) and an
 *  optional name; it is inserted into the message body at the cursor. */
export function InsertLink({ disabled, onInsert }: { disabled?: boolean; onInsert: (line: string) => void }) {
  const [url, setUrl] = useState(''); const [name, setName] = useState('')
  const valid = /^https?:\/\/\S+$/i.test(url.trim())
  const add = () => { if (!valid) return; onInsert(linkLine(name.trim(), url.trim())); setUrl(''); setName('') }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Link to a large file" placeholder="Paste a link for large files (Drive, OneDrive…)" value={url} disabled={disabled}
        onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} className="min-w-64 flex-[2]" />
      <Input aria-label="Link name (optional)" placeholder={valid ? linkName(url.trim()) || 'Name (optional)' : 'Name (optional)'} value={name} disabled={disabled}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} className="min-w-40 flex-1" />
      <IconAction icon="Link2" label="Insert link into the message" disabled={disabled || !valid} onClick={add} />
    </div>
  )
}
