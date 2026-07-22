import { Copy, FileText } from 'lucide-react'
import { useI18n } from '../i18n/I18nProvider'
import type { PosterTranscript as PosterTranscriptValue } from '../lib/posterTranscript'
import { useToast } from './ui/Toast'

export function PosterTranscript({
  transcript,
}: {
  transcript: PosterTranscriptValue
}) {
  const { t } = useI18n()
  const { notify } = useToast()

  if (transcript.blocks.length === 0) return null

  async function copyPosterText() {
    if (!navigator.clipboard?.writeText) {
      notify(t('Poster text could not be copied.'), 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(transcript.plainText)
      notify(t('Poster text copied.'), 'success')
    } catch {
      notify(t('Poster text could not be copied.'), 'error')
    }
  }

  return (
    <figcaption className="poster-transcript">
      <div className="poster-transcript-heading">
        <span>
          <FileText size={15} aria-hidden="true" />
          <strong>{t('Poster text')}</strong>
        </span>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => void copyPosterText()}
        >
          <Copy size={14} aria-hidden="true" />
          {t('Copy poster text')}
        </button>
      </div>
      <div className="poster-transcript-copy">
        {transcript.blocks.map((block, index) => (
          <p key={`${block.source}:${block.text}:${index}`}>{block.text}</p>
        ))}
      </div>
    </figcaption>
  )
}
