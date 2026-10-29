import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { authApi, useAuthUser } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { formatPhone, LOCAL_SESSION, sessionName, whatsappAvailable, whatsappApi } from './api'

const RUNNING = new Set(['initializing', 'qr_ready', 'authenticating', 'ready'])
/** Asked once per sign-in and browser tab: "Skip" holds until the next sign-in or a new tab. */
const ASKED = 'goms.whatsappLinkAsked'
const asked = (key: string) => { try { return sessionStorage.getItem(ASKED) === key } catch { return false } }
const remember = (key: string) => { try { sessionStorage.setItem(ASKED, key) } catch { /* private window: asks again next load */ } }

/** After sign-in: when this person's WhatsApp is not linked to GOMS, asks for the QR scan so it is ready before they need it.
 *  Linked already: nothing is shown, and a dropped connection is restarted quietly. A gateway that is down never interrupts. */
export function WhatsAppLinkPrompt() {
  const { user } = useAuthUser()
  const { pathname } = useLocation()
  const email = user?.email?.toLowerCase()
  // The same session the WhatsApp page links: per person with server sign-in, one per computer in local mode.
  const name = authApi.configured ? (email ? sessionName(email) : null) : (email ? LOCAL_SESSION : null)
  const [closed, setClosed] = useState(false)
  if (!name || !email || !whatsappAvailable() || closed || asked(email) || pathname.startsWith('/whatsapp')) return null
  return <LinkOnSignIn name={name} onDone={() => { remember(email); setClosed(true) }} />
}

export function LinkOnSignIn({ name, onDone }: { name: string; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  // Same query keys as the WhatsApp page, so it opens on what was loaded here.
  const session = useQuery({ queryKey: ['whatsapp', name, 'session'], queryFn: () => whatsappApi.find(name), retry: false, refetchInterval: 2_000 })
  const current = session.data
  const status = current?.status
  const [asking, setAsking] = useState(false)
  const connect = useMutation({ mutationFn: () => whatsappApi.connect(name, current ?? null), onSettled: () => qc.invalidateQueries({ queryKey: ['whatsapp', name] }) })
  const qr = useQuery({ queryKey: ['whatsapp', current?.id, 'qr'], queryFn: () => whatsappApi.qr(current!.id), enabled: status === 'qr_ready', refetchInterval: 5_000, retry: false })

  useEffect(() => {
    if (session.isPending) return
    if (session.isError) return onDone()
    if (!RUNNING.has(status ?? '') && connect.isIdle) connect.mutate()
    if (status === 'ready' && current) {
      void qc.prefetchQuery({ queryKey: ['whatsapp', current.id, 'chats'], queryFn: () => whatsappApi.chats(current.id), staleTime: Infinity })
      if (asking) toast(`WhatsApp linked${current.phone ? ` (${formatPhone(current.phone)})` : ''}: ready to send and receive messages`)
      return onDone()
    }
    // Linked before (a phone is on record) and WhatsApp did not ask for a new scan: it reconnects without the person.
    if (current?.phone && status !== 'qr_ready') return onDone()
    setAsking(true)
  }, [session.isPending, session.isError, status, current, connect, qc, onDone, asking, toast])

  if (!asking) return null
  return (
    <Dialog open onClose={onDone} title="Link your WhatsApp to GOMS"
      description="On your phone open WhatsApp › Settings › Linked devices › Link a device, and scan this code."
      footer={<Button onClick={onDone}>Skip for now</Button>}>
      <div className="flex flex-col items-center gap-3 text-center">
        {status === 'qr_ready' && qr.data
          ? <img src={qr.data.qrCode} alt="WhatsApp link code" className="h-56 w-56 rounded-xl border border-line bg-white p-2" />
          : <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-line"><Icon name="Loader" className="animate-spin text-muted" /></div>}
        <p className="text-sm text-muted">{status === 'authenticating' ? 'Linking your phone… keep WhatsApp open for a few seconds.' : 'You are asked only while WhatsApp is not linked.'}</p>
        {(connect.error ?? qr.error) && <p role="alert" className="text-xs text-crimson">{(connect.error ?? qr.error)!.message}</p>}
      </div>
    </Dialog>
  )
}
