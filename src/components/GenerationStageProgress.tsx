import { Check, LoaderCircle, Minus, X } from 'lucide-react'
import type {
  GenerationStageItem,
  GenerationStageStatus,
} from '../lib/generationActivity'

export type {
  GenerationStageItem,
  GenerationStageStatus,
} from '../lib/generationActivity'

export function GenerationStageProgress({
  stages,
}: {
  stages: GenerationStageItem[]
}) {
  return (
    <div className="generation-stage-progress" aria-live="polite">
      {stages.map((stage) => (
        <div
          key={stage.key}
          className={`generation-stage is-${stage.status}`}
          aria-label={`${stage.label}: ${stage.status}`}
        >
          <StageIcon status={stage.status} />
          <span>{stage.label}</span>
        </div>
      ))}
    </div>
  )
}

function StageIcon({ status }: { status: GenerationStageStatus }) {
  if (status === 'running') {
    return <LoaderCircle size={15} className="generation-stage-spinner" aria-hidden="true" />
  }
  if (status === 'done') return <Check size={15} aria-hidden="true" />
  if (status === 'error') return <X size={15} aria-hidden="true" />
  return <Minus size={15} aria-hidden="true" />
}
