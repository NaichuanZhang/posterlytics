import { useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import type { Translate } from '../lib/i18n'
import type { PosterLayout } from '../lib/types'
import { DEFAULT_POSTER_SIZE, type PosterSize } from '../lib/posterSize'
import { LayoutPreview } from './LayoutPreview'

// One prompt shown in the loading UI. `image` is the single text-to-image prompt
// (hero); `system`/`user` are the chat messages (analyze / designer).
export interface AgentPrompt {
  system?: string
  user?: string
  image?: string
}

export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export type AgentStepKey = 'analyze' | 'designer' | 'hero'

export interface AgentStep {
  key: AgentStepKey
  label: string
  blurb: string
  status: StepStatus
  prompt?: AgentPrompt
  error?: string // set when status === 'error' — the invoke error message
}

interface Props {
  headline: string
  screenshotUrl: string | null
  steps: AgentStep[]
  // Designer style only: the bespoke layout, shown as a wireframe preview once the
  // Designer step finishes (while hero paints). Null/absent → no preview panel.
  layout?: PosterLayout | null
  posterSize?: PosterSize
}

// The poster-generation loading screen: shows the captured site style board and a
// live step list (analyze → designer → hero), revealing each agent's
// real prompt as it finishes. Purely presentational — the wizard owns the state.
export function GenerationProgress({
  headline,
  screenshotUrl,
  steps,
  layout,
  posterSize = DEFAULT_POSTER_SIZE,
}: Props) {
  const { t } = useI18n()
  return (
    <section className="generation-workspace genprog" aria-live="polite">
      <div className="genprog-head">
        <Spinner />
        <div>
          <p className="genprog-title">{headline}</p>
          <p className="muted genprog-sub">
            {t('The style board and poster update as each stage completes.')}
          </p>
        </div>
      </div>

      <div className="genprog-grid">
        <div className="genprog-shot">
          {screenshotUrl ? (
            <img src={screenshotUrl} alt={t('Website style board')} />
          ) : (
            <div className="genprog-shot-empty muted">{t('Capturing your site…')}</div>
          )}
        </div>

        <ol className="genprog-steps">
          {steps.map((s) => (
            <StepRow key={s.key} step={s} />
          ))}
        </ol>
      </div>

      {layout && (
        <div className="genprog-layout">
          <p className="muted genprog-sub" style={{ marginBottom: 12 }}>
            {t('Layout complete. Painting the poster now.')}
          </p>
          <LayoutPreview layout={layout} width={300} posterSize={posterSize} />
        </div>
      )}
    </section>
  )
}

function StepRow({ step }: { step: AgentStep }) {
  const { t } = useI18n()
  // Auto-expand the running step; let the user toggle any step that has a prompt.
  const [open, setOpen] = useState(false)
  const text = step.prompt ? promptText(step.prompt, t) : ''
  const showPrompt = !!text && (open || step.status === 'running')

  return (
    <li className={`genprog-step is-${step.status}`}>
      <div className="genprog-step-head">
        <StatusGlyph status={step.status} />
        <div className="genprog-step-meta">
          <span className="genprog-step-label">{step.label}</span>
          <span className="muted genprog-step-blurb">{step.blurb}</span>
        </div>
        {text && (
          <button type="button" className="genprog-toggle" onClick={() => setOpen((v) => !v)}>
            {showPrompt ? t('Hide prompt') : t('View prompt')} {showPrompt ? '▴' : '▾'}
          </button>
        )}
      </div>
      {step.status === 'error' && step.error && (
        <p className="genprog-error" style={{ color: 'var(--bad)', fontSize: '0.8rem', margin: '8px 0 0' }}>
          {step.error}
        </p>
      )}
      {showPrompt && <pre className="genprog-pre">{text}</pre>}
    </li>
  )
}

function StatusGlyph({ status }: { status: StepStatus }) {
  if (status === 'running') return <span className="genprog-dot is-running"><Spinner small /></span>
  const glyph = status === 'done' ? '✓' : status === 'error' ? '!' : '·'
  return <span className={`genprog-dot is-${status}`}>{glyph}</span>
}

// Flatten a prompt into displayable text (system + user, or the single image prompt).
function promptText(p: AgentPrompt, t: Translate): string {
  if (p.image) return p.image
  const parts: string[] = []
  if (p.system) parts.push(`${t('SYSTEM')}\n${p.system}`)
  if (p.user) parts.push(`${t('USER')}\n${p.user}`)
  return parts.join('\n\n')
}

// Local spinner so this component doesn't depend on the layout-level <Spinner>.
function Spinner({ small = false }: { small?: boolean }) {
  return <span className="spinner" style={small ? { width: 14, height: 14, borderWidth: 2 } : undefined} />
}
