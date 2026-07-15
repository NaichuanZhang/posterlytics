import { useEffect, useState, type ChangeEvent } from 'react'
import {
  MAX_REFERENCE_CONTEXT_LENGTH,
  MAX_REFERENCE_IMAGES,
  validateReferenceFiles,
} from '../lib/references'
import type { ReferenceImage } from '../lib/types'

interface Props {
  context: string
  onContextChange: (value: string) => void
  existingImages: ReferenceImage[]
  onRemoveExisting: (image: ReferenceImage) => void
  pendingFiles: File[]
  onPendingFilesChange: (files: File[]) => void
  disabled?: boolean
}

export function GenerationReferences({
  context,
  onContextChange,
  existingImages,
  onRemoveExisting,
  pendingFiles,
  onPendingFilesChange,
  disabled = false,
}: Props) {
  const [error, setError] = useState<string | null>(null)

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const additions = Array.from(event.target.files ?? [])
    const validation = validateReferenceFiles(existingImages.length + pendingFiles.length, additions)
    if (validation) {
      setError(validation)
    } else {
      setError(null)
      onPendingFilesChange([...pendingFiles, ...additions])
    }
    event.target.value = ''
  }

  return (
    <div className="generation-references">
      <div className="field">
        <label htmlFor="reference-context">Creative context <span className="hint">(optional)</span></label>
        <textarea
          id="reference-context"
          className="textarea"
          value={context}
          maxLength={MAX_REFERENCE_CONTEXT_LENGTH}
          disabled={disabled}
          placeholder="Audience, campaign goals, visual direction, required details, or anything the generator should preserve."
          onChange={(event) => onContextChange(event.target.value)}
        />
        <div className="hint">{context.length.toLocaleString()} / {MAX_REFERENCE_CONTEXT_LENGTH.toLocaleString()} characters</div>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="reference-images">Supporting images <span className="hint">(optional)</span></label>
        <input
          id="reference-images"
          className="reference-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled || existingImages.length + pendingFiles.length >= MAX_REFERENCE_IMAGES}
          onChange={addFiles}
        />
        <div className="hint">Up to {MAX_REFERENCE_IMAGES} JPEG, PNG, or WebP images, 10 MB each.</div>
        {error && <p className="error-text" role="alert">{error}</p>}

        {(existingImages.length > 0 || pendingFiles.length > 0) && (
          <div className="reference-grid">
            {existingImages.map((image) => (
              <ReferenceTile
                key={image.key}
                name={image.name}
                src={image.url}
                disabled={disabled}
                onRemove={() => onRemoveExisting(image)}
              />
            ))}
            {pendingFiles.map((file, index) => (
              <PendingReferenceTile
                key={`${file.name}-${file.size}-${file.lastModified}`}
                file={file}
                disabled={disabled}
                onRemove={() => onPendingFilesChange(pendingFiles.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReferenceTile({
  name,
  src,
  disabled,
  onRemove,
}: {
  name: string
  src: string
  disabled: boolean
  onRemove: () => void
}) {
  return (
    <div className="reference-tile">
      <img src={src} alt="" />
      <span title={name}>{name}</span>
      <button
        type="button"
        className="reference-remove"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  )
}

function PendingReferenceTile({
  file,
  disabled,
  onRemove,
}: {
  file: File
  disabled: boolean
  onRemove: () => void
}) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return <ReferenceTile name={file.name} src={src} disabled={disabled} onRemove={onRemove} />
}
