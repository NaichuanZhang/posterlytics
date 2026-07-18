import { useI18n } from '../i18n/I18nProvider'
import type { TranslationKey } from '../i18n/messages'

export type SamplePosterVariant = 'field' | 'routes' | 'signal'

const POSTERS: Record<SamplePosterVariant, {
  image: string
  qr: string
  alt: TranslationKey
  index: string
  kicker: TranslationKey
  title: TranslationKey
  note: TranslationKey
  placement: string
}> = {
  field: {
    image: '/marketing/photos/picsum-35.webp',
    qr: '/marketing/qr/field.png',
    alt: 'Sunlit close-up of a cactus',
    index: '01',
    kicker: 'Field note',
    title: 'Cut through.',
    note: 'A launch message made for the physical world.',
    placement: 'product-wall',
  },
  routes: {
    image: '/marketing/photos/picsum-88.webp',
    qr: '/marketing/qr/routes.png',
    alt: 'Black and white aerial view of a Barcelona street',
    index: '02',
    kicker: 'Route study',
    title: 'Every route counts.',
    note: 'One campaign with a signal for every placement.',
    placement: 'city-window',
  },
  signal: {
    image: '/marketing/photos/picsum-95.webp',
    qr: '/marketing/qr/signal.png',
    alt: 'Bare trees fading into a foggy field',
    index: '03',
    kicker: 'After launch',
    title: 'See what moved.',
    note: 'Visits, visitors, devices, systems, and countries.',
    placement: 'launch-lobby',
  },
}

export function SamplePoster({
  variant,
  priority = false,
  compact = false,
  className = '',
}: {
  variant: SamplePosterVariant
  priority?: boolean
  compact?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const poster = POSTERS[variant]
  const kicker = t(poster.kicker)
  const title = t(poster.title)

  return (
    <article
      className={[
        'sample-poster',
        `sample-poster-${variant}`,
        compact ? 'sample-poster-compact' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={t('{kicker}: {title}', { kicker, title })}
    >
      <div className="sample-poster-index">
        <span>{kicker}</span>
        <strong>{poster.index}</strong>
      </div>
      <div className="sample-poster-image">
        <img
          src={poster.image}
          alt={t(poster.alt)}
          width="800"
          height="1067"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'low'}
          decoding={priority ? 'sync' : 'async'}
        />
        <span aria-hidden="true">POSTERLYTICS / {poster.index}</span>
      </div>
      <div className="sample-poster-copy">
        <div>
          <strong className="sample-poster-title">{title}</strong>
          {!compact && <p>{t(poster.note)}</p>}
        </div>
        <div className="sample-poster-qr">
          <img
            src={poster.qr}
            width={compact ? 34 : 46}
            height={compact ? 34 : 46}
            alt={t('QR code for the {placement} sample placement', {
              placement: poster.placement,
            })}
            loading={priority ? 'eager' : 'lazy'}
            decoding={priority ? 'sync' : 'async'}
          />
        </div>
      </div>
    </article>
  )
}
