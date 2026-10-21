import { createContext, useContext } from 'react'

export interface ProfileImagesIndex { configured: boolean; versions: Record<string, string>; names?: Record<string, string> }
export const ProfileImagesContext = createContext<ProfileImagesIndex | undefined>(undefined)
export const useProfileImagesIndex = () => useContext(ProfileImagesContext)
