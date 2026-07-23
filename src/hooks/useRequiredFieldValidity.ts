import { useCallback, useEffect, useState } from 'react'

interface RequiredFieldValidityOptions {
  required: boolean
  valid: boolean
  validationAttempt: number
  resetKey?: unknown
}

interface ValidityGate {
  invalid: boolean
  resetKey: unknown
  validationAttempt: number
}

export function useRequiredFieldValidity({
  required,
  valid,
  validationAttempt,
  resetKey,
}: RequiredFieldValidityOptions) {
  const [gate, setGate] = useState<ValidityGate>(() => ({
    invalid: false,
    resetKey,
    validationAttempt,
  }))
  const reset = !Object.is(gate.resetKey, resetKey)
  const newValidationAttempt = gate.validationAttempt !== validationAttempt
  const invalid = (
    required
    && !valid
    && !reset
    && (gate.invalid || newValidationAttempt)
  )

  useEffect(() => {
    setGate((current) => {
      if (!Object.is(current.resetKey, resetKey)) {
        return {
          invalid: false,
          resetKey,
          validationAttempt,
        }
      }

      const nextInvalid = required
        && !valid
        && (
          current.invalid
          || current.validationAttempt !== validationAttempt
        )
      if (
        current.invalid === nextInvalid
        && current.validationAttempt === validationAttempt
      ) {
        return current
      }
      return {
        invalid: nextInvalid,
        resetKey,
        validationAttempt,
      }
    })
  }, [required, resetKey, valid, validationAttempt])

  const onBlur = useCallback(() => {
    setGate({
      invalid: required && !valid,
      resetKey,
      validationAttempt,
    })
  }, [required, resetKey, valid, validationAttempt])

  return { invalid, onBlur }
}
