import {
  ArrowRight,
  BarChart3,
  Globe2,
  ImagePlus,
  Layers3,
  MapPin,
  RefreshCw,
  ScanLine,
} from 'lucide-react'
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react'
import { useRef, type ReactNode } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useI18n } from '../i18n/I18nProvider'
import { signInPath } from '../lib/authRouting'
import { FormatStudy } from '../marketing/FormatStudy'
import {
  SamplePoster,
  type SamplePosterVariant,
} from '../marketing/SamplePoster'

const CREATE_ACCOUNT_PATH = signInPath('/campaigns/new', 'signup')

export default function LandingPage() {
  return (
    <>
      <WorkflowStory />
      <FormatStudy />
      <VersionsSection />
      <PlacementsSection />
      <AnalyticsSection />
      <FinalCallToAction />
      <PublicFooter />
    </>
  )
}

function WorkflowStory() {
  const { t } = useI18n()
  const sectionRef = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  })
  const sourceOpacity = useTransform(scrollYProgress, [0, 0.22, 0.36], [1, 1, 0])
  const sourceY = useTransform(scrollYProgress, [0, 0.36], [0, -30])
  const structureOpacity = useTransform(
    scrollYProgress,
    [0.2, 0.34, 0.58, 0.72],
    [0, 1, 1, 0],
  )
  const structureY = useTransform(scrollYProgress, [0.2, 0.72], [36, -24])
  const outputOpacity = useTransform(scrollYProgress, [0.62, 0.78], [0, 1])
  const outputY = useTransform(scrollYProgress, [0.62, 0.82], [36, 0])
  const step = useTransform(scrollYProgress, [0, 0.48, 1], [1, 2, 3])

  const layers = [
    <StorySource key="source" />,
    <StoryStructure key="structure" />,
    <ProductCapture
      key="output"
      src="/marketing/product/editor.webp"
      alt={t('Posterlytics poster editor showing a generated poster and version controls')}
      label={t('Generated poster')}
    />,
  ]

  return (
    <section
      ref={sectionRef}
      id="workflow"
      className={`public-section public-story${reducedMotion ? ' public-story-reduced' : ''}`}
      aria-labelledby="workflow-heading"
    >
      <div className="public-story-sticky">
        <SectionIntro
          index="01"
          icon={<Globe2 size={19} />}
          heading={t('From website to wall.')}
          id="workflow-heading"
        >
          {t('Posterlytics reads the product website, carries in your references, turns the findings into a structured layout, and generates a poster ready for a real placement.')}
        </SectionIntro>

        <div className="public-story-stage">
          <motion.div className="public-story-counter" aria-hidden="true">
            <motion.span>{step}</motion.span>
            <span>/ 03</span>
          </motion.div>
          {isMobile ? (
            <div className="public-story-mobile">
              {layers.map((layer, index) => (
                <motion.div
                  key={index}
                  initial={reducedMotion ? false : { opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.22 }}
                  transition={{ duration: 0.45 }}
                >
                  {layer}
                </motion.div>
              ))}
            </div>
          ) : reducedMotion ? (
            <div className="public-story-layer public-story-layer-static">{layers[2]}</div>
          ) : (
            <>
              <motion.div
                className="public-story-layer"
                style={{ opacity: sourceOpacity, y: sourceY }}
              >
                {layers[0]}
              </motion.div>
              <motion.div
                className="public-story-layer"
                style={{ opacity: structureOpacity, y: structureY }}
              >
                {layers[1]}
              </motion.div>
              <motion.div
                className="public-story-layer"
                style={{ opacity: outputOpacity, y: outputY }}
              >
                {layers[2]}
              </motion.div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function StorySource() {
  const { t } = useI18n()
  return (
    <figure className="story-source">
      <img
        src="/marketing/photos/picsum-35.webp"
        alt={t('Sunlit cactus used as source imagery for a poster')}
        width="800"
        height="1067"
        loading="lazy"
        decoding="async"
      />
      <figcaption>
        <span>01 / SOURCE</span>
        <strong>product.example</strong>
        <p>{t('Website structure, copy, palette, type, and imagery.')}</p>
      </figcaption>
    </figure>
  )
}

function StoryStructure() {
  const { t } = useI18n()
  return (
    <div className="story-structure" aria-label={t('Structured poster layout')}>
      <div className="story-structure-head">
        <span>02 / STRUCTURE</span>
        <strong>{t('Poster brief')}</strong>
      </div>
      <div className="story-layout-board">
        <div className="story-layout-copy">
          <span>HOOK</span>
          <strong>CUT THROUGH.</strong>
        </div>
        <div className="story-layout-image">
          <img
            src="/marketing/photos/picsum-35.webp"
            alt={t('Cactus source image placed into a poster layout')}
            width="800"
            height="1067"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="story-layout-notes">
          <span>REFERENCE / PRODUCT</span>
          <span>PALETTE / SOURCE</span>
          <span>FORMAT / A4</span>
        </div>
      </div>
    </div>
  )
}

function VersionsSection() {
  const { t } = useI18n()
  return (
    <section id="versions" className="public-section versions-section" aria-labelledby="versions-heading">
      <Reveal>
        <SectionIntro
          index="02"
          icon={<Layers3 size={19} />}
          heading={t('Refine without starting over.')}
          id="versions-heading"
        >
          {t('Every pass becomes a version. Ask Posterlytics to re-read the source, add supporting images, or generate a new background while the campaign and its earlier work stay intact.')}
        </SectionIntro>
      </Reveal>
      <VersionStack />
      <div className="feature-rail" aria-label={t('Version controls')}>
        <FeatureNote icon={<RefreshCw size={17} />} title={t('Re-read source')}>
          {t('Pull current product copy and visual signals into the next pass.')}
        </FeatureNote>
        <FeatureNote icon={<ImagePlus size={17} />} title={t('Add references')}>
          {t('Bring supporting images and direction into one focused iteration.')}
        </FeatureNote>
        <FeatureNote icon={<Layers3 size={17} />} title={t('Keep the history')}>
          {t('Compare, restore, and publish without replacing prior versions.')}
        </FeatureNote>
      </div>
    </section>
  )
}

function VersionStack() {
  const { t } = useI18n()
  const reducedMotion = useReducedMotion()
  const variants: SamplePosterVariant[] = ['routes', 'signal', 'field']

  return (
    <div className="version-stack" aria-label={t('Three poster versions')}>
      {variants.map((variant, index) => (
        <motion.div
          key={variant}
          className={`version-stack-item version-stack-item-${index + 1}`}
          initial={reducedMotion ? false : { opacity: 0, y: 80, rotate: 0 }}
          whileInView={{
            opacity: 1,
            y: 0,
            rotate: [-7, 3, 8][index],
          }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{
            type: 'spring',
            stiffness: 80,
            damping: 17,
            delay: index * 0.12,
          }}
        >
          <span className="version-stamp">
            {t('VERSION / 0{number}', { number: index + 1 })}
          </span>
          <SamplePoster variant={variant} compact />
        </motion.div>
      ))}
    </div>
  )
}

function PlacementsSection() {
  const { t } = useI18n()
  return (
    <section
      id="attribution"
      className="public-section placements-section"
      aria-labelledby="placements-heading"
    >
      <Reveal>
        <SectionIntro
          index="03"
          icon={<MapPin size={19} />}
          heading={t('One campaign. Every placement.')}
          id="placements-heading"
        >
          {t('Mint a distinct QR code for the lobby, launch event, partner mailer, or any other placement. Publish once, then export the right poster for each physical channel.')}
        </SectionIntro>
      </Reveal>
      <PlacementFan />
      <ProductCapture
        src="/marketing/product/placements.webp"
        alt={t('Posterlytics placements page with distinct tracked links and QR exports')}
        label={t('Placement-specific exports')}
      />
    </section>
  )
}

function PlacementFan() {
  const { t } = useI18n()
  const sectionRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  })
  const leftX = useTransform(scrollYProgress, [0.15, 0.55], [90, 0])
  const rightX = useTransform(scrollYProgress, [0.15, 0.55], [-90, 0])

  const placements: Array<{
    variant: SamplePosterVariant
    label: string
    className: string
  }> = [
    { variant: 'routes', label: t('Partner mailer'), className: 'placement-fan-left' },
    { variant: 'field', label: t('Launch lobby'), className: 'placement-fan-center' },
    { variant: 'signal', label: t('Conference wall'), className: 'placement-fan-right' },
  ]

  return (
    <div ref={sectionRef} className="placement-fan" aria-label={t('Placement poster exports')}>
      {placements.map((placement, index) => (
        <motion.div
          key={placement.label}
          className={`placement-fan-item ${placement.className}`}
          style={
            reducedMotion || isMobile || index === 1
              ? undefined
              : { x: index === 0 ? leftX : rightX }
          }
          initial={reducedMotion ? false : { opacity: 0, y: 45 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.5, delay: index * 0.1 }}
        >
          <SamplePoster variant={placement.variant} compact />
          <span className="placement-label">
            <ScanLine size={14} aria-hidden="true" />
            {placement.label}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

function AnalyticsSection() {
  const { t } = useI18n()
  return (
    <section className="public-section analytics-section" aria-labelledby="analytics-heading">
      <Reveal>
        <SectionIntro
          index="04"
          icon={<BarChart3 size={19} />}
          heading={t('Know what got scanned.')}
          id="analytics-heading"
        >
          {t('Compare visits and unique visitors by placement, then read the device, operating system, and country breakdown behind the response.')}
        </SectionIntro>
      </Reveal>
      <div className="analytics-layout">
        <ProductCapture
          src="/marketing/product/analytics.webp"
          alt={t('Posterlytics analytics page showing sample placement traffic and audience breakdowns')}
          label={t('Campaign analytics')}
          sample
        />
        <div className="analytics-key" aria-label={t('Available analytics')}>
          {[
            ['01', t('Visits')],
            ['02', t('Unique visitors')],
            ['03', t('Devices')],
            ['04', t('Operating systems')],
            ['05', t('Countries')],
          ].map(([index, label]) => (
            <div key={label}>
              <span>{index}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCallToAction() {
  const { t } = useI18n()
  return (
    <section className="public-final-cta" aria-labelledby="final-cta-heading">
      <div>
        <span className="public-overline">{t('Your next physical channel')}</span>
        <h2 id="final-cta-heading">{t('Put the next launch on the wall.')}</h2>
      </div>
      <a className="public-button public-button-inverse" href={CREATE_ACCOUNT_PATH}>
        {t('Create account')}
        <ArrowRight size={18} aria-hidden="true" />
      </a>
    </section>
  )
}

function PublicFooter() {
  const { t } = useI18n()
  return (
    <footer className="public-footer">
      <a href="/" className="public-brand" aria-label={t('Posterlytics home')}>
        <span className="public-brand-mark" aria-hidden="true">P</span>
        <strong>Posterlytics</strong>
      </a>
      <p>{t('Website to poster. Placement to signal.')}</p>
      <div>
        <span>{t('Photography:')}</span>
        <a href="https://unsplash.com/photos/znM0ujn2RUA">{t('Shane Colella')}</a>
        <a href="https://unsplash.com/photos/muC_6gTMLR4">{t('Barcelona')}</a>
        <a href="https://unsplash.com/photos/87TJNWkepvI">{t('Kundan Ramisetti')}</a>
      </div>
    </footer>
  )
}

function SectionIntro({
  index,
  icon,
  heading,
  id,
  children,
}: {
  index: string
  icon: ReactNode
  heading: string
  id: string
  children: ReactNode
}) {
  return (
    <header className="public-section-intro">
      <div className="public-section-marker">
        <span>{index}</span>
        {icon}
      </div>
      <div>
        <h2 id={id}>{heading}</h2>
        <p>{children}</p>
      </div>
    </header>
  )
}

function ProductCapture({
  src,
  alt,
  label,
  sample = false,
}: {
  src: string
  alt: string
  label: string
  sample?: boolean
}) {
  const { t } = useI18n()
  return (
    <figure className="product-capture">
      <figcaption>
        <span>{label}</span>
        {sample && <strong>{t('Sample data')}</strong>}
      </figcaption>
      <img
        src={src}
        alt={alt}
        width="1440"
        height="960"
        loading="lazy"
        decoding="async"
      />
    </figure>
  )
}

function FeatureNote({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="feature-note">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}

function Reveal({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}
