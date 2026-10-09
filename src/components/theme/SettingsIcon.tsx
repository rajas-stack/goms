import { Cloud, FileCheck2, FolderOpen, Gavel, Globe2, ShieldCheck } from 'lucide-react'

export type SettingsIconKind = 'storage' | 'tender' | 'verification'

const ICONS = {
  storage: { primary: FolderOpen, badge: Cloud },
  tender: { primary: Gavel, badge: Globe2 },
  verification: { primary: FileCheck2, badge: ShieldCheck },
}

/** Raised, theme-colored symbols for each workspace configuration area. */
export function SettingsIcon({ kind }: { kind: SettingsIconKind }) {
  const { primary: Primary, badge: Badge } = ICONS[kind]
  return (
    <span aria-hidden="true" className={`settings-icon settings-icon--${kind}`}>
      <Primary size={27} strokeWidth={1.7} className="settings-icon__primary" />
      <span className="settings-icon__badge"><Badge size={14} strokeWidth={1.8} /></span>
    </span>
  )
}
