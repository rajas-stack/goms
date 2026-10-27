import type { MakerDocument } from '@goms/domain'
import type { AvatarPerson } from '@/components/ui/Avatar'
import { authApi, useAuthUser } from '@/lib/auth'
import { LOCAL_OWNER, type MakerOwner } from '@/data/in-memory/makerDocuments'

/** Who new local files belong to: the signed-in user when there is one. */
export function useCurrentOwner(): MakerOwner {
  const { user } = useAuthUser()
  // Local data has one owner; the optional local sign-in must not hide the files made before it.
  if (!user?.email || !authApi.configured) return LOCAL_OWNER
  return { email: user.email.toLowerCase(), name: user.displayName || user.email.split('@')[0] }
}

/** The owner as a PersonName person: the signed-in user's own name and photo for their files. */
export function useOwnerPerson(): (doc: MakerDocument) => AvatarPerson {
  const { user } = useAuthUser()
  const me = user?.email?.toLowerCase()
  return (doc) => (me && doc.ownerEmail === me
    ? { name: user?.displayName || doc.ownerName || doc.ownerEmail, photoUrl: user?.photoUrl }
    : { name: doc.ownerName || doc.ownerEmail })
}
