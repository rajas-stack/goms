import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useDismiss } from '@/components/ui/popover/useDismiss'
import { useToast } from '@/components/ui/Toast'
import { repository } from '@/data/repository'
import type { WhatsAppTag } from '@/lib/types'
import { cn } from '@/lib/utils'
import { whatsappApi, type WhatsAppChat } from './api'

/** Tags on chats, kept in GOMS: a personal WhatsApp refuses list edits from outside the phone. The very first load starts them from
 *  the phone's own lists, so Sales, CXO… arrive already filled. */
export function useTags(sessionId: string | undefined) {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['whatsapp', sessionId, 'tags']
  const query = useQuery({
    queryKey: key, enabled: !!sessionId, staleTime: Infinity,
    queryFn: async () => {
      const saved = await repository.listWhatsAppTags()
      if (saved.length) return saved
      // If the phone can't be asked now, nothing is imported, so the next load tries again.
      const lists = await whatsappApi.lists(sessionId!).catch(() => null)
      if (lists) await repository.importWhatsAppTags(lists)
      return repository.listWhatsAppTags()
    },
  })
  const saved = () => qc.invalidateQueries({ queryKey: key })
  const fail = (what: string) => (error: unknown) => { toast(`Could not ${what}: ${(error as Error).message}`, undefined, 'error'); return null }
  return {
    tags: query.data ?? [],
    create: (name: string) => repository.createWhatsAppTag(name).then(async (tag) => { await saved(); return tag }, fail('create the tag')),
    toggle: (tag: WhatsAppTag, chatId: string) => {
      const tagged = !tag.chatIds.includes(chatId)
      return repository.setWhatsAppTagChat(tag.id, chatId, tagged).then(async () => { await saved(); toast(tagged ? `Tagged ${tag.name}` : `Removed from ${tag.name}`) }, fail('change the tag'))
    },
  }
}
export type Tags = ReturnType<typeof useTags>

/** Chats carrying any of the selected tags; all chats when none is selected. */
export const withTags = (chats: WhatsAppChat[], tags: WhatsAppTag[], selected: string[]) => {
  if (!selected.length) return chats
  const ids = new Set(tags.filter((tag) => selected.includes(tag.id)).flatMap((tag) => tag.chatIds))
  return chats.filter((chat) => ids.has(chat.id))
}

const row = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-ink-900/[0.05] focus-visible:focus-ring'
const card = 'w-56 overflow-y-auto rounded-xl border border-line bg-paper p-1 shadow-pop scrollbar-thin'

/** "+ New tag", turning into a name field in place; Enter saves, Escape cancels. */
function NewTag({ onCreate }: { onCreate: (name: string) => unknown }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  if (!editing) return <button type="button" className={row} onClick={() => setEditing(true)}><Icon name="Plus" size={15} className="text-muted" />New tag</button>
  const save = () => { if (name.trim()) void onCreate(name.trim()); setName(''); setEditing(false) }
  return (
    <input autoFocus aria-label="New tag name" placeholder="Tag name, then Enter" value={name} maxLength={40}
      onChange={(event) => setName(event.target.value)} onBlur={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); save() }
        if (event.key === 'Escape') { event.stopPropagation(); setEditing(false) }
      }}
      className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-emerald-600" />
  )
}

/** Next to the account name: pick tags to show only their chats; also makes new tags and clears the selection. */
export function TagFilter({ tags, selected, onChange }: { tags: Tags; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const active = tags.tags.filter((tag) => selected.includes(tag.id))
  const label = active.length === 0 ? 'Tags' : active.length === 1 ? active[0].name : `${active[0].name} +${active.length - 1}`
  return (
    <div ref={anchor} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        className={cn('flex max-w-48 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:focus-ring',
          active.length ? 'border-emerald-600/50 bg-emerald-600/10 text-emerald-700' : 'border-line text-ink-700 hover:bg-ink-900/[0.05]')}>
        <Icon name="Tag" size={13} /><span className="truncate">{label}</span><Icon name="ChevronDown" size={13} />
      </button>
      <PopoverPanel open={open} anchorRef={anchor} onClose={() => setOpen(false)} maxPanelHeight={380}>
        {({ maxHeight }) => (
          <motion.div role="menu" aria-label="Show chats tagged" style={{ maxHeight }} className={card}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Show chats tagged</p>
            {tags.tags.length === 0 && <p className="px-2.5 py-1.5 text-[13px] text-muted">No tags yet. Right-click a chat to tag it.</p>}
            {tags.tags.map((tag) => {
              const on = selected.includes(tag.id)
              return (
                <button key={tag.id} type="button" role="menuitemcheckbox" aria-checked={on} className={row}
                  onClick={() => onChange(on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])}>
                  <Icon name="Check" size={15} className={cn('shrink-0 text-emerald-600', !on && 'invisible')} />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="text-[11px] tabular-nums text-muted">{tag.chatIds.length}</span>
                </button>
              )
            })}
            <div className="my-1 h-px bg-line" />
            <NewTag onCreate={tags.create} />
            <button type="button" className={cn(row, 'disabled:pointer-events-none disabled:opacity-40')} disabled={!selected.length} onClick={() => onChange([])}>
              <Icon name="X" size={15} className="text-muted" />Clear selection
            </button>
          </motion.div>
        )}
      </PopoverPanel>
    </div>
  )
}

/** Right-click on a chat: "Add tag", which slides open the tags beside it (as WhatsApp's "Change list"). Ticking a tag adds or
 *  removes the chat and keeps the menu open; a new tag is created with this chat in it. */
export function ChatTagMenu({ chat, x, y, tags, onClose }: { chat: WhatsAppChat; x: number; y: number; tags: Tags; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [showTags, setShowTags] = useState(false)
  const [pos, setPos] = useState({ left: x, top: y })
  useDismiss({ open: true, onClose, anchorRef: ref, panelRef: ref })
  // Keep both cards inside the window.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) })
  }, [x, y, showTags])
  return createPortal(
    <div ref={ref} onContextMenu={(event) => event.preventDefault()} style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 80 }} className="flex items-start gap-1">
      <div role="menu" aria-label={`Chat options for ${chat.name || 'this chat'}`} className={card}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={showTags} autoFocus
          className={cn(row, showTags && 'bg-ink-900/[0.05]')} onClick={() => setShowTags(true)} onMouseEnter={() => setShowTags(true)}>
          <Icon name="Tag" size={15} className="text-muted" /><span className="flex-1">Add tag</span><Icon name="ChevronRight" size={14} className="text-muted" />
        </button>
      </div>
      <AnimatePresence>
        {showTags && (
          <motion.div role="menu" aria-label="Tags" className={cn(card, 'max-h-80')}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
            {tags.tags.map((tag) => {
              const on = tag.chatIds.includes(chat.id)
              return (
                <button key={tag.id} type="button" role="menuitemcheckbox" aria-checked={on} className={row} onClick={() => void tags.toggle(tag, chat.id)}>
                  <Icon name="Check" size={15} className={cn('shrink-0 text-emerald-600', !on && 'invisible')} />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                </button>
              )
            })}
            {tags.tags.length > 0 && <div className="my-1 h-px bg-line" />}
            <NewTag onCreate={async (name) => { const tag = await tags.create(name); if (tag && !tag.chatIds.includes(chat.id)) await tags.toggle(tag, chat.id) }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
