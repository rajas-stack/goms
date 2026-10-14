import { useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { CompetitorLogo } from './CompetitorLogo'
import { LOGO_ACCEPT, readLogoFile } from './readLogoFile'

interface Props {
  name: string
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  onError: (message: string | null) => void
}

/** Logo picker: upload a small image (kept as a data: URL) or paste an https link. */
export function LogoField({ name, value, onChange, disabled, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const isUpload = !!value?.startsWith('data:')

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setReading(true)
    try {
      onChange(await readLogoFile(file))
      onError(null)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Could not read that image.')
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="flex items-start gap-3">
      <CompetitorLogo name={name || '?'} logo={value} size="lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={disabled || reading} onClick={() => fileRef.current?.click()}>
            <Icon name="Upload" size={14} /> {reading ? 'Reading…' : value ? 'Replace logo' : 'Upload logo'}
          </Button>
          {value && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { onChange(null); onError(null) }}>Remove</Button>}
          <span className="text-xs text-muted">PNG, JPG, SVG or WebP · any size — trimmed and resized for you</span>
        </div>
        <input ref={fileRef} type="file" accept={LOGO_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Logo file" onChange={event => void onFile(event)} />
        <Input aria-label="Logo link" type="url" inputMode="url" placeholder="…or paste an https:// image link" disabled={disabled}
          value={isUpload ? '' : value ?? ''} onChange={event => onChange(event.target.value || null)} />
      </div>
    </div>
  )
}
