import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LanguageSelect } from '../components/LanguageSelect'
import { useI18n } from '../i18n/I18nProvider'
import '../marketing/public.css'

export type LegalPageKind = 'terms' | 'privacy'

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const { t } = useI18n()
  const isTerms = kind === 'terms'

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
        <h2>{t('Availability')}</h2>
        <p>{t('Posterlytics may change, suspend, or stop without notice.')}</p>
      </section>
    </div>
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
    </div>
  )
}
