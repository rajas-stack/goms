import type { ReactNode } from 'react'
import { ProfileImagesContext } from './ProfileImagesContext'
import { useProfileImages } from './profileImagesClient'

/** One shared index for every employee, roster and contact avatar. Never queries Drive per person. */
export function ProfileImagesProvider({ children }: { children: ReactNode }) {
  const profiles = useProfileImages()
  return <ProfileImagesContext.Provider value={profiles.data ? { configured: profiles.data.configured, versions: profiles.isError ? {} : profiles.data.versions, names: profiles.isError ? {} : profiles.data.names } : undefined}>{children}</ProfileImagesContext.Provider>
}
