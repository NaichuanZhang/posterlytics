import { useI18n } from '../i18n/I18nProvider'

interface SocialCoverQrSettingsProps {
  idPrefix: string
  enabled: boolean
  destinationUrl: string
  disabled?: boolean
  onEnabledChange: (enabled: boolean) => void
  onDestinationUrlChange: (destinationUrl: string) => void
}

export function SocialCoverQrSettings({
  idPrefix,
  enabled,
  destinationUrl,
  disabled = false,
  onEnabledChange,
  onDestinationUrlChange,
}: SocialCoverQrSettingsProps) {
  const { t } = useI18n()
  const switchId = `${idPrefix}-enabled`
  const destinationId = `${idPrefix}-destination`
  const descriptionId = `${idPrefix}-description`

  return (
    <div className="social-cover-qr-settings field-wide">
      <label className="switch-control" htmlFor={switchId}>
        <span className="switch-copy">
          <strong>{t('Add a tracked QR footer')}</strong>
          <span id={descriptionId}>
            {t('Add a scannable QR footer and track visits to a destination.')}
          </span>
        </span>
        <span className="switch-input">
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={disabled}
            aria-describedby={descriptionId}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span aria-hidden="true" />
        </span>
      </label>
      {enabled && (
        <div className="field social-cover-qr-destination">
          <label htmlFor={destinationId}>
            {t('Destination URL')}{' '}
            <span className="required-label">{t('Required')}</span>
          </label>
          <input
            id={destinationId}
            className="input"
            type="url"
            inputMode="url"
            required
            aria-required={true}
            pattern="https?://.+"
            disabled={disabled}
            placeholder={t('https://yourproduct.com')}
            value={destinationUrl}
            onChange={(event) => onDestinationUrlChange(event.target.value)}
          />
          <p className="hint">
            {t('Use a complete HTTP or HTTPS destination URL.')}
          </p>
        </div>
      )}
    </div>
  )
}

export function isValidSocialCoverDestination(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname.length > 0
    )
  } catch {
    return false
  }
}
