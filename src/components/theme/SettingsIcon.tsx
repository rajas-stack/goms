export type SettingsIconKind = 'storage' | 'tender' | 'verification'

/** A consistent navy, partially filled symbol for each settings area. */
export function SettingsIcon({ kind }: { kind: SettingsIconKind }) {
  return (
    <span aria-hidden="true" className="settings-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
        strokeLinecap="round" strokeLinejoin="round" focusable="false" className="settings-icon__symbol">
        {kind === 'storage' && <>
          <path d="M3 11V6.5A1.5 1.5 0 0 1 4.5 5H9l3 3h7.5A1.5 1.5 0 0 1 21 9.5V11"
            fill="currentColor" fillOpacity={.1} />
          <path d="M2.5 11h19l-2.1 8.2a1.7 1.7 0 0 1-1.6 1.3H6.2a1.7 1.7 0 0 1-1.6-1.3L2.5 11Z"
            fill="currentColor" fillOpacity={.08} />
          <path d="M3.5 15h17l-1.1 4.2a1.7 1.7 0 0 1-1.6 1.3H6.2a1.7 1.7 0 0 1-1.6-1.3L3.5 15Z"
            fill="currentColor" stroke="none" />
          <path d="M9 17.5h6" stroke="#fff" strokeWidth={1.4} />
        </>}
        {kind === 'tender' && <>
          <path d="m3 8 9-4 9 4H3Z" fill="currentColor" />
          <path d="M4.5 9.5h15V18h-15Z" fill="currentColor" fillOpacity={.08} stroke="none" />
          <path d="M6 11v6M10 11v6M14 11v6M18 11v6M4 18.5h16M3 21h18" />
        </>}
        {kind === 'verification' && <>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
            fill="currentColor" fillOpacity={.08} />
          <path d="M14 3v4h4" fill="currentColor" />
          <path d="M9 10h6M9 13h3" />
          <path d="M6 15h12v5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-5Z" fill="currentColor" stroke="none" />
          <path d="m9 17.5 2 2 4-4" stroke="#fff" strokeWidth={1.5} />
        </>}
      </svg>
    </span>
  )
}
