import { createContext, useContext } from 'react'

/** `people` (browser-only mode) maps a person row id to its photo reference; the server keys `versions` by person id instead. */
export interface ProfileImagesIndex { configured: boolean; versions: Record<string, string>; names?: Record<string, string>; people?: Record<string, string> }
export const ProfileImagesContext = createContext<ProfileImagesIndex | undefined>(undefined)
export const useProfileImagesIndex = () => useContext(ProfileImagesContext)
