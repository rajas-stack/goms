/** Tells this browser's other GOMS tabs that data changed, so they refresh instead of
 *  showing (and, in browser-only mode, later saving over) a stale copy. Same-origin tabs
 *  of one browser only: other people's browsers would need a server push channel.
 *
 *  Browser-only mode posts from persist.ts once a snapshot is on disk; server mode posts
 *  from the QueryClient's MutationCache (main.tsx). BroadcastChannel is in every browser
 *  this app targets, so there's no storage-event fallback. */

const CHANNEL_NAME = 'gorms:data-changed'

let channel: BroadcastChannel | null | undefined

// Opened on first use, not at import: every importer (Node test workers included)
// would otherwise hold a live channel.
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  return channel
}

export function notifyOtherTabs(): void {
  getChannel()?.postMessage('changed')
}

/** `listener` runs when ANOTHER tab calls `notifyOtherTabs` — a channel never receives
 *  its own posts, so a tab can't echo itself into a loop. */
export function onOtherTabChange(listener: () => void): void {
  getChannel()?.addEventListener('message', () => listener())
}
