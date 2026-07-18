export type SamplePosterVariant = 'field' | 'routes' | 'signal'

const POSTERS: Record<SamplePosterVariant, {
  image: string
  qr: string
  alt: string
  index: string
  kicker: string
  title: string
  note: string
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
  const poster = POSTERS[variant]

  return (
    <article
      className={[
        'sample-poster',
        `sample-poster-${variant}`,
        compact ? 'sample-poster-compact' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={`${poster.kicker}: ${poster.title}`}
    >
      <div className="sample-poster-index">
        <span>{poster.kicker}</span>
        <strong>{poster.index}</strong>
      </div>
      <div className="sample-poster-image">
        <img
          src={poster.image}
          alt={poster.alt}
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
          <strong className="sample-poster-title">{poster.title}</strong>
          {!compact && <p>{poster.note}</p>}
        </div>
        <div className="sample-poster-qr">
          <img
            src={poster.qr}
            width={compact ? 34 : 46}
            height={compact ? 34 : 46}
            alt={`QR code for the ${poster.placement} sample placement`}
            loading={priority ? 'eager' : 'lazy'}
            decoding={priority ? 'sync' : 'async'}
          />
        </div>
      </div>
    </article>
  )
}
