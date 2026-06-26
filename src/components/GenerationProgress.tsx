import { useState } from 'react'

// One prompt shown in the loading UI. `image` is the single text-to-image prompt
// (hero); `system`/`user` are the chat messages (analyze / designer / landing).
export interface AgentPrompt {
  system?: string
  user?: string
  image?: string
}

export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export type AgentStepKey = 'analyze' | 'designer' | 'hero' | 'landing'

export interface AgentStep {
  key: AgentStepKey
  label: string
  blurb: string
  status: StepStatus
  prompt?: AgentPrompt
}

interface Props {
  headline: string
  screenshotUrl: string | null
  steps: AgentStep[]
}

// The poster-generation loading screen: shows the captured site screenshot and a
// live step list (analyze → designer → hero → landing), revealing each agent's
// real prompt as it finishes. Purely presentational — the wizard owns the state.
export function GenerationProgress({ headline, screenshotUrl, steps }: Props) {
  return (
    <div className="card genprog">
      <div className="genprog-head">
        <Spinner />
        <div>
          <p className="genprog-title">{headline}</p>
          <p className="muted genprog-sub">Watch each agent work — this takes ~10–25 seconds.</p>
        </div>
      </div>

      <div className="genprog-grid">
        <div className="genprog-shot">
          {screenshotUrl ? (
            <img src={screenshotUrl} alt="Your website" />
          ) : (
            <div className="genprog-shot-empty muted">Capturing your site…</div>
          )}
        </div>

        <ol className="genprog-steps">
          {steps.map((s) => (
            <StepRow key={s.key} step={s} />
          ))}
        </ol>
      </div>
    </div>
  )
}

function StepRow({ step }: { step: AgentStep }) {
  // Auto-expand the running step; let the user toggle any step that has a prompt.
  const [open, setOpen] = useState(false)
  const text = step.prompt ? promptText(step.prompt) : ''
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
            {showPrompt ? 'Hide prompt ▴' : 'View prompt ▾'}
          </button>
        )}
      </div>
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
function promptText(p: AgentPrompt): string {
  if (p.image) return p.image
  const parts: string[] = []
  if (p.system) parts.push(`SYSTEM\n${p.system}`)
  if (p.user) parts.push(`USER\n${p.user}`)
  return parts.join('\n\n')
}

// Local spinner so this component doesn't depend on the layout-level <Spinner>.
function Spinner({ small = false }: { small?: boolean }) {
  return <span className="spinner" style={small ? { width: 14, height: 14, borderWidth: 2 } : undefined} />
}
