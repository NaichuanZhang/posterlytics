import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LanguageSelect } from '../components/LanguageSelect'
import { useDocumentMetadata } from '../hooks/useDocumentMetadata'
import { useI18n } from '../i18n/I18nProvider'
import {
  ISSUE_TRACKER_LABEL,
  ISSUE_TRACKER_URL,
  OPERATOR_NAME,
} from '../lib/publicContact'
import {
  CAPTURE_PREVIEW_LIMIT_PER_10_MINUTES,
  CAPTURE_PREVIEW_LIMIT_PER_DAY,
} from '../lib/publicLimits'
import { MAX_REFERENCE_IMAGES } from '../lib/references'
import '../marketing/public.css'

export type LegalPageKind = 'terms' | 'privacy'

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const { t } = useI18n()
  const isTerms = kind === 'terms'
  const documentTitle = isTerms ? t('Terms of Service') : t('Privacy Policy')
  useDocumentMetadata({
    title: t('{page} | Posterlytics', { page: documentTitle }),
    description: isTerms
      ? t('The terms that apply to using Posterlytics.')
      : t('How Posterlytics handles your account, campaign, and visit data.'),
    canonical: `https://posterlytics.insforge.site/${kind === 'terms' ? 'terms' : 'privacy'}`,
  })

  return (
    <div className="public-surface">
      <a className="public-skip-link" href="#public-main">{t('Skip to content')}</a>
      <header className="public-nav-shell public-legal-header">
        <Link to="/" className="public-legal-back">
          <ArrowLeft size={15} aria-hidden="true" />
          {t('Back to Posterlytics')}
        </Link>
        <LanguageSelect variant="public" />
      </header>

      <main id="public-main" className="public-legal-main">
        <article className="public-legal-document" aria-labelledby="legal-heading">
          <header className="public-legal-heading">
            <h1 id="legal-heading">
              {isTerms ? t('Terms of Service') : t('Privacy Policy')}
            </h1>
            <time dateTime="2026-07-24">
              {t('Last updated July 24, 2026.')}
            </time>
          </header>

          {isTerms ? <TermsSections /> : <PrivacySections />}

          <nav
            className="public-legal-links"
            aria-label={`${t('Terms of Service')} / ${t('Privacy Policy')}`}
          >
            <Link to="/terms" aria-current={isTerms ? 'page' : undefined}>
              {t('Terms of Service')}
            </Link>
            <Link to="/privacy" aria-current={isTerms ? undefined : 'page'}>
              {t('Privacy Policy')}
            </Link>
          </nav>
        </article>
      </main>
    </div>
  )
}

function TermsSections() {
  const { t } = useI18n()

  return (
    <div className="public-legal-sections">
      <section>
        <h2>{t('About these terms')}</h2>
        <p>
          {t('Posterlytics is a personal demo project for creating posters and measuring placement visits. It is provided as-is and without warranties.')}
        </p>
      </section>
      <section>
        <h2>{t('Acceptable use')}</h2>
        <p>
          {t('Use Posterlytics only with websites, images, copy, and destination links you are authorized to use. Do not use it for unlawful, abusive, or misleading content.')}
        </p>
      </section>
      <section>
        <h2>{t('Cost and limits')}</h2>
        {/* Only limits the code actually enforces are stated here. The
            capture-preview quota is asserted by consume_capture_preview_quota,
            and the reference cap by MAX_REFERENCE_IMAGES. No price or plan is
            claimed, because none exists to describe. */}
        <p>{t('Posterlytics does not charge for an account and takes no payment details.')}</p>
        <p>
          {t('Website capture previews are limited to {short} in any ten minutes and {daily} per day per account. A campaign accepts up to {references} reference images.', {
            short: CAPTURE_PREVIEW_LIMIT_PER_10_MINUTES,
            daily: CAPTURE_PREVIEW_LIMIT_PER_DAY,
            references: MAX_REFERENCE_IMAGES,
          })}
        </p>
        <p>{t('Because this is a demo project, poster generation is not guaranteed to be available, and these limits can change without notice.')}</p>
      </section>
      <section>
        <h2>{t('Availability')}</h2>
        <p>{t('Posterlytics may change, suspend, or stop without notice.')}</p>
      </section>
      <OperatorAndContactSection />
    </div>
  )
}

/**
 * Order-153: the public surface asked for an email and password without naming
 * anyone or offering a way to reach them. Both legal pages carry this — a
 * privacy policy that identifies no operator is the same gap as terms that do.
 * Only routes verified to answer are published, and no email address is.
 */
function OperatorAndContactSection() {
  const { t } = useI18n()

  return (
    <section>
      <h2>{t('Operator and contact')}</h2>
      <p>
        {t('Posterlytics is a personal demo project run by {operator}. It is not operated by a company.', {
          operator: OPERATOR_NAME,
        })}
      </p>
      <p>
        {t('Its source code is public, and questions, bug reports, and takedown requests go to the issue tracker:')}{' '}
        <a className="public-legal-inline-link" href={ISSUE_TRACKER_URL}>
          {ISSUE_TRACKER_LABEL}
        </a>
      </p>
    </section>
  )
}

function PrivacySections() {
  const { t } = useI18n()

  return (
    <div className="public-legal-sections">
      <section>
        <h2>{t('Information we collect')}</h2>
        <p>
          {t('Posterlytics uses your email address for account authentication. It stores the campaigns, poster generations, placements, and visit analytics you create.')}
        </p>
        <p>
          {t('Posterlytics processes the product URLs, images, and copy you submit to generate posters.')}
        </p>
      </section>
      <section>
        <h2>{t('Visit analytics')}</h2>
        <p>
          {t('When someone opens a published tracked link, Posterlytics records the visit time, placement, device, operating system, and available country and city data.')}
        </p>
        <p>
          {t('Posterlytics hashes a first-party cookie identifier with a secret salt to estimate unique visitors. It does not store raw IP addresses.')}
        </p>
      </section>
      <section>
        <h2>{t('Access controls')}</h2>
        <p>
          {t('Campaign, poster-generation, placement, and visit records are restricted to their account owner by row-level access controls.')}
        </p>
      </section>
      <section>
        <h2>{t('Public assets and links')}</h2>
        <p>
          {t('Generated and reference images can be viewed by anyone who has their direct URL, and published tracked links can be opened by anyone who has their URL.')}
        </p>
      </section>
      <OperatorAndContactSection />
    </div>
  )
}
