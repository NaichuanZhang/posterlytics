import { useI18n } from '../i18n/I18nProvider'
import type { PosterSizeSlug } from '../lib/posterSize'
import { FormatSample } from './FormatSample'

const FORMAT_STUDY_ORDER = [
  'a4_2x3',
  'yt_thumb_16x9',
  'luma_1x1',
  'rednote_3x4',
  'rednote_cover_3x4',
] as const satisfies readonly PosterSizeSlug[]

export function FormatStudy() {
  const { t } = useI18n()

  return (
    <section
      id="formats"
      className="public-section format-study"
      aria-labelledby="formats-heading"
    >
      <header className="format-study-intro">
        <span>{t('Fictional house brand / format study')}</span>
        <h2 id="formats-heading">{t('One brand. Every format.')}</h2>
        <p>
          {t('The same Posterlytics House campaign, adapted for every supported output.')}
        </p>
      </header>
      <div className="format-study-grid">
        {FORMAT_STUDY_ORDER.map((format) => (
          <FormatSample key={format} format={format} />
        ))}
      </div>
    </section>
  )
}
