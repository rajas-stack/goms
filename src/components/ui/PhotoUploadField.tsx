import { useRef } from 'react'
import { Field } from './Field'
import { Button } from './Button'
import { Icon } from './Icon'

function readImageFileAsDataUrl(file: File, cb: (dataUrl: string) => void) {
  const reader = new FileReader()
  reader.onload = () => cb(String(reader.result))
  reader.readAsDataURL(file)
}

/** Shared upload-or-paste profile-picture control — originally
 *  `EmployeeFormDialog`-only, extracted so `SalesPersonFormDialog` gets the
 *  identical control instead of a second copy. Persists as a data URL (no
 *  separate asset store), same convention as `visitingCards`. */
export function PhotoUploadField({ photoUrl, onChange, label = 'Profile Picture', hint = 'Upload, or click here and press Ctrl+V to paste an image.' }: {
  photoUrl: string | null
  onChange: (dataUrl: string | null) => void
  label?: string
  hint?: string
}) {
  const photoRef = useRef<HTMLInputElement>(null)

  function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    readImageFileAsDataUrl(file, onChange)
  }

  function onPhotoPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) readImageFileAsDataUrl(file, onChange)
        return
      }
    }
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3" tabIndex={0} onPaste={onPhotoPaste} data-testid="profile-photo-dropzone">
        {photoUrl ? (
          <span className="relative">
            <img src={photoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Remove profile picture"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-white text-muted shadow-sm hover:text-crimson"
            >
              <Icon name="X" size={11} />
            </button>
          </span>
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-panel text-muted">
            <Icon name="User" size={18} />
          </span>
        )}
        <Button size="sm" onClick={() => photoRef.current?.click()}>
          <Icon name="Upload" size={13} /> Upload
        </Button>
        <input ref={photoRef} type="file" accept="image/*" onChange={onPhotoFile} className="hidden" />
      </div>
    </Field>
  )
}
