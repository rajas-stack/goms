import type { ReactNode } from 'react'
import { ProfileImagesContext } from './ProfileImagesContext'
import { useProfileImages } from './profileImagesClient'
import { useDrivePhotoIndex } from './useDrivePhotoIndex'

/** One shared index for every employee, roster and contact avatar. Never queries Drive per person. */
export function ProfileImagesProvider({ children }: { children: ReactNode }) {
  return import.meta.env.VITE_API_BASE_URL ? <ServerProfileImages>{children}</ServerProfileImages> : <DriveProfileImages>{children}</DriveProfileImages>
}

function ServerProfileImages({ children }: { children: ReactNode }) {
  const profiles = useProfileImages()
  return <ProfileImagesContext.Provider value={profiles.data ? { configured: profiles.data.configured, versions: profiles.isError ? {} : profiles.data.versions, names: profiles.isError ? {} : profiles.data.names } : undefined}>{children}</ProfileImagesContext.Provider>
}

/** No GOMS server: this browser reads the category photo folders from Drive and matches them itself. */
function DriveProfileImages({ children }: { children: ReactNode }) {
  const { index } = useDrivePhotoIndex()
  return <ProfileImagesContext.Provider value={index.configured ? index : undefined}>{children}</ProfileImagesContext.Provider>
}
