import type { UseCaseFieldRequirement } from './useCases'

export interface GenerationReferenceInput {
  requirement: UseCaseFieldRequirement
  minimumCount: number
  firstVersion: boolean
  allowPersistedReuse: boolean
  persistedCount: number
  pendingCount: number
}

export interface GenerationReferenceInputDecision {
  requiredCount: number
  effectiveCount: number
  reusePersisted: boolean
  minimumMet: boolean
}

export function resolveGenerationReferenceInput({
  requirement,
  minimumCount,
  firstVersion,
  allowPersistedReuse,
  persistedCount,
  pendingCount,
}: GenerationReferenceInput): GenerationReferenceInputDecision {
  const requiredCount = Math.max(
    minimumCount,
    requirement === 'required' ? 1 : 0,
  )
  const reusePersisted = (
    allowPersistedReuse
    && !firstVersion
    && pendingCount === 0
    && persistedCount > 0
  )
  const effectiveCount = pendingCount > 0
    ? pendingCount
    : reusePersisted
      ? persistedCount
      : 0

  return {
    requiredCount,
    effectiveCount,
    reusePersisted,
    minimumMet: effectiveCount >= requiredCount,
  }
}
