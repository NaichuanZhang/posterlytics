import { ImageOff, ImagePlus, Link2, LoaderCircle, Plus, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import {
  MAX_REFERENCE_CONTEXT_LENGTH,
  MAX_REFERENCE_IMAGES,
  createPendingFileReference,
  createPendingUrlReference,
  parseDroppedReferenceUrls,
  partitionReferenceFiles,
  partitionReferenceUrls,
  type PendingReference,
  type PendingUrlReference,
  type ReferenceFileRejection,
  type ReferenceUrlRejection,
} from '../lib/references'
import type { ReferenceImage } from '../lib/types'

interface Props {
  context: string
  onContextChange: (value: string) => void
  existingImages: ReferenceImage[]
  onRemoveExisting: (image: ReferenceImage) => void
  pendingReferences: PendingReference[]
  onPendingReferencesChange: Dispatch<SetStateAction<PendingReference[]>>
  disabled?: boolean
  contextLabel?: string
  contextPlaceholder?: string
  contextHint?: string
}

type ReferenceRejection =
  | { kind: 'file'; rejection: ReferenceFileRejection }
  | { kind: 'url'; rejection: ReferenceUrlRejection }

export function GenerationReferences({
  context,
  onContextChange,
  existingImages,
  onRemoveExisting,
  pendingReferences,
  onPendingReferencesChange,
  disabled = false,
  contextLabel = 'Creative context',
  contextPlaceholder = 'Audience, campaign goals, visual direction, required details, or anything the generator should preserve.',
  contextHint,
}: Props) {
  const [rejections, setRejections] = useState<ReferenceRejection[]>([])
  const [urlInput, setUrlInput] = useState('')
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
  const urlInputId = `${id}-image-url`
  const totalImages = existingImages.length + pendingReferences.length
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
    setRejections(result.rejected.map((rejection) => ({ kind: 'file', rejection })))
    if (result.accepted.length > 0) {
      const accepted = result.accepted.map(createPendingFileReference)
      onPendingReferencesChange((current) => [...current, ...accepted])
    }
  }

  function ingestUrls(additions: readonly string[]): boolean {
    if (additions.length === 0) return false

    const currentUrls = [
      ...existingImages.map((image) => image.url),
      ...pendingReferences.flatMap((reference) =>
        reference.kind === 'url' ? [reference.url] : []
      ),
    ]
    const result = partitionReferenceUrls(totalImages, currentUrls, additions)
    setRejections(result.rejected.map((rejection) => ({ kind: 'url', rejection })))
    if (result.accepted.length > 0) {
      const accepted = result.accepted.map(createPendingUrlReference)
      onPendingReferencesChange((current) => [...current, ...accepted])
      return true
    }
    return false
  }

  function submitUrl() {
    if (isUnavailable) return
    if (ingestUrls([urlInput])) setUrlInput('')
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    ingestFiles(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ''
  }

  function isSupportedDrag(event: ReactDragEvent<HTMLElement>) {
    const types = Array.from(event.dataTransfer.types)
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')
  }

  function handleDragEnter(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (isUnavailable || !isSupportedDrag(event)) return
    dragDepth.current += 1
    setIsDragging(true)
  }

  function handleDragOver(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = isUnavailable || !isSupportedDrag(event) ? 'none' : 'copy'
  }

  function handleDragLeave(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!isSupportedDrag(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  function handleDrop(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (isUnavailable) return

    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      ingestFiles(files)
      return
    }

    const droppedText =
      event.dataTransfer.getData('text/uri-list')
      || event.dataTransfer.getData('text/plain')
    ingestUrls(parseDroppedReferenceUrls(droppedText))
  }

  function handleUrlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submitUrl()
  }

  function clearRejections() {
    setRejections([])
  }

  function updateUrlReference(
    reference: PendingUrlReference,
    previewStatus: PendingUrlReference['previewStatus'],
  ) {
    if (reference.previewStatus === previewStatus) return
    onPendingReferencesChange((current) =>
      current.map((item) =>
        item.id === reference.id && item.kind === 'url'
          ? { ...item, previewStatus }
          : item
      ),
    )
  }

  return (
    <div className="generation-references">
      <div className="field">
        <label htmlFor={contextId}>{contextLabel} <span className="hint">(optional)</span></label>
        <textarea
          id={contextId}
          className="textarea"
          value={context}
          maxLength={MAX_REFERENCE_CONTEXT_LENGTH}
          disabled={disabled}
          placeholder={contextPlaceholder}
          onChange={(event) => onContextChange(event.target.value)}
        />
        <div className="hint">
          {contextHint ? `${contextHint} ` : ''}
          {context.length.toLocaleString()} / {MAX_REFERENCE_CONTEXT_LENGTH.toLocaleString()} characters
        </div>
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
        <div className="reference-source-grid">
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
                      ? 'Drop image to add'
                      : 'Drop image or browse'}
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

          <div className={`reference-url-panel${isUnavailable ? ' is-disabled' : ''}`}>
            <label htmlFor={urlInputId}>Image URL</label>
            <div className="reference-url-content">
              <span className="reference-dropzone-icon" aria-hidden="true">
                <Link2 size={20} strokeWidth={2} />
              </span>
              <div className="reference-url-control">
                <input
                  id={urlInputId}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://…/pic.jpg"
                  value={urlInput}
                  disabled={isUnavailable}
                  aria-describedby={[
                    imageHintId,
                    rejections.length > 0 ? imageErrorId : '',
                  ].filter(Boolean).join(' ')}
                  onChange={(event) => setUrlInput(event.target.value)}
                  onKeyDown={handleUrlKeyDown}
                />
                <button
                  type="button"
                  disabled={isUnavailable || !urlInput.trim()}
                  aria-label="Add image URL"
                  title="Add image URL"
                  onClick={submitUrl}
                >
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="hint" id={imageHintId}>
          Up to {MAX_REFERENCE_IMAGES} public HTTPS JPEG, PNG, or WebP images, 10 MB each.
        </div>
        {rejections.length > 0 && (
          <div className="reference-errors" id={imageErrorId} role="alert">
            <ul>
              {rejections.map((rejection, index) => (
                <li key={`${rejection.kind}-${rejectionKey(rejection)}-${index}`}>
                  {referenceRejectionMessage(rejection)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(existingImages.length > 0 || pendingReferences.length > 0) && (
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
            {pendingReferences.map((reference) => (
              reference.kind === 'file' ? (
                <PendingFileTile
                  key={reference.id}
                  file={reference.file}
                  disabled={disabled}
                  onRemove={() => {
                    clearRejections()
                    onPendingReferencesChange((current) =>
                      current.filter((item) => item.id !== reference.id)
                    )
                  }}
                />
              ) : (
                <ReferenceTile
                  key={reference.id}
                  name={reference.name}
                  src={reference.url}
                  sourceTitle={reference.url}
                  status={reference.previewStatus}
                  disabled={disabled}
                  onLoad={() => updateUrlReference(reference, 'ready')}
                  onError={() => updateUrlReference(reference, 'error')}
                  onRemove={() => {
                    clearRejections()
                    onPendingReferencesChange((current) =>
                      current.filter((item) => item.id !== reference.id)
                    )
                  }}
                />
              )
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
  sourceTitle = name,
  status = 'ready',
  disabled,
  onLoad,
  onError,
  onRemove,
}: {
  name: string
  src: string
  sourceTitle?: string
  status?: PendingUrlReference['previewStatus']
  disabled: boolean
  onLoad?: () => void
  onError?: () => void
  onRemove: () => void
}) {
  return (
    <div className={`reference-tile is-${status}`}>
      <div className="reference-preview">
        {status === 'error' ? (
          <span className="reference-preview-status">
            <ImageOff size={18} aria-hidden="true" />
            Preview unavailable
          </span>
        ) : (
          <img
            src={src}
            alt={name}
            referrerPolicy="no-referrer"
            onLoad={onLoad}
            onError={onError}
          />
        )}
        {status === 'loading' && (
          <span className="reference-preview-loading" aria-label="Loading image preview">
            <LoaderCircle size={17} aria-hidden="true" />
          </span>
        )}
      </div>
      <span className="reference-name" title={sourceTitle}>{name}</span>
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

function PendingFileTile({
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

function rejectionKey(rejection: ReferenceRejection): string {
  return rejection.kind === 'file' ? rejection.rejection.filename : rejection.rejection.value
}

function referenceRejectionMessage(rejection: ReferenceRejection): string {
  if (rejection.kind === 'file') {
    switch (rejection.rejection.reason) {
      case 'type':
        return `${rejection.rejection.filename} must be a JPEG, PNG, or WebP image.`
      case 'size':
        return `${rejection.rejection.filename} must be larger than 0 bytes and no more than 10 MB.`
      case 'capacity':
        return `${rejection.rejection.filename} was not added because the ${MAX_REFERENCE_IMAGES}-image limit was reached.`
    }
  }

  const value = rejection.rejection.value.trim() || 'The URL'
  switch (rejection.rejection.reason) {
    case 'invalid':
      return `${value} is not a valid image URL.`
    case 'protocol':
      return `${value} must use HTTPS.`
    case 'credentials':
      return `${value} cannot include a username or password.`
    case 'duplicate':
      return `${value} has already been added.`
    case 'capacity':
      return `${value} was not added because the ${MAX_REFERENCE_IMAGES}-image limit was reached.`
  }
}
