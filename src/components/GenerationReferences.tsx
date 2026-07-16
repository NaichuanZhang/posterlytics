import { ImagePlus, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import {
  MAX_REFERENCE_CONTEXT_LENGTH,
  MAX_REFERENCE_IMAGES,
  partitionReferenceFiles,
  type ReferenceFileRejection,
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
  const [rejections, setRejections] = useState<ReferenceFileRejection[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const id = useId()
  const contextId = `${id}-context`
  const imageInputId = `${id}-images`
  const imageLabelId = `${id}-images-label`
  const imageActionId = `${id}-images-action`
  const imageStatusId = `${id}-images-status`
  const imageHintId = `${id}-images-hint`
  const imageErrorId = `${id}-images-errors`
  const totalImages = existingImages.length + pendingFiles.length
  const remainingSlots = Math.max(0, MAX_REFERENCE_IMAGES - totalImages)
  const isFull = remainingSlots === 0
  const isUnavailable = disabled || isFull

  useEffect(() => {
    if (!isUnavailable) return
    dragDepth.current = 0
    setIsDragging(false)
  }, [isUnavailable])

  function ingestFiles(additions: readonly File[]) {
    if (additions.length === 0) return

    const result = partitionReferenceFiles(totalImages, additions)
    setRejections(result.rejected)
    if (result.accepted.length > 0) {
      onPendingFilesChange([...pendingFiles, ...result.accepted])
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    ingestFiles(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ''
  }

  function isFileDrag(event: ReactDragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function handleDragEnter(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (isUnavailable || !isFileDrag(event)) return
    dragDepth.current += 1
    setIsDragging(true)
  }

  function handleDragOver(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = isUnavailable || !isFileDrag(event) ? 'none' : 'copy'
  }

  function handleDragLeave(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!isFileDrag(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  function handleDrop(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (isUnavailable) return
    ingestFiles(Array.from(event.dataTransfer.files))
  }

  function clearRejections() {
    setRejections([])
  }

  return (
    <div className="generation-references">
      <div className="field">
        <label htmlFor={contextId}>Creative context <span className="hint">(optional)</span></label>
        <textarea
          id={contextId}
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
        <div className="field-label" id={imageLabelId}>
          Supporting images <span className="hint">(optional)</span>
        </div>
        <input
          ref={inputRef}
          id={imageInputId}
          className="reference-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          tabIndex={-1}
          disabled={isUnavailable}
          onChange={selectFiles}
        />
        <button
          type="button"
          className={[
            'reference-dropzone',
            isDragging ? 'is-drag-active' : '',
            isFull ? 'is-full' : '',
            disabled ? 'is-disabled' : '',
          ].filter(Boolean).join(' ')}
          aria-labelledby={`${imageLabelId} ${imageActionId}`}
          aria-describedby={[
            imageStatusId,
            imageHintId,
            rejections.length > 0 ? imageErrorId : '',
          ].filter(Boolean).join(' ')}
          aria-disabled={isUnavailable}
          onClick={() => {
            if (!isUnavailable) inputRef.current?.click()
          }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDragEnd={() => {
            dragDepth.current = 0
            setIsDragging(false)
          }}
          onDrop={handleDrop}
        >
          <span className="reference-dropzone-icon" aria-hidden="true">
            <ImagePlus size={22} strokeWidth={2} />
          </span>
          <span className="reference-dropzone-copy">
            <strong id={imageActionId}>
              {disabled
                ? 'Image selection unavailable'
                : isFull
                  ? `${MAX_REFERENCE_IMAGES} images added`
                  : isDragging
                    ? 'Drop images to add them'
                    : 'Drop images here or browse'}
            </strong>
            <span id={imageStatusId}>
              {disabled
                ? 'Wait for the current action to finish.'
                : isFull
                  ? 'Remove an image to add another.'
                  : `${remainingSlots} ${remainingSlots === 1 ? 'slot' : 'slots'} available`}
            </span>
          </span>
        </button>
        <div className="hint" id={imageHintId}>
          Up to {MAX_REFERENCE_IMAGES} JPEG, PNG, or WebP images, 10 MB each.
        </div>
        {rejections.length > 0 && (
          <div className="reference-errors" id={imageErrorId} role="alert">
            <ul>
              {rejections.map((rejection, index) => (
                <li key={`${rejection.filename}-${rejection.reason}-${index}`}>
                  {referenceRejectionMessage(rejection)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(existingImages.length > 0 || pendingFiles.length > 0) && (
          <div className="reference-grid">
            {existingImages.map((image) => (
              <ReferenceTile
                key={image.key}
                name={image.name}
                src={image.url}
                disabled={disabled}
                onRemove={() => {
                  clearRejections()
                  onRemoveExisting(image)
                }}
              />
            ))}
            {pendingFiles.map((file, index) => (
              <PendingReferenceTile
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                file={file}
                disabled={disabled}
                onRemove={() => {
                  clearRejections()
                  onPendingFilesChange(pendingFiles.filter((_, i) => i !== index))
                }}
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
        <X size={15} strokeWidth={2.5} aria-hidden="true" />
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

function referenceRejectionMessage(rejection: ReferenceFileRejection): string {
  switch (rejection.reason) {
    case 'type':
      return `${rejection.filename} must be a JPEG, PNG, or WebP image.`
    case 'size':
      return `${rejection.filename} must be larger than 0 bytes and no more than 10 MB.`
    case 'capacity':
      return `${rejection.filename} was not added because the ${MAX_REFERENCE_IMAGES}-image limit was reached.`
  }
}
