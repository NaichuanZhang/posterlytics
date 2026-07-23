import { useEffect, useRef, type RefObject } from 'react'

interface ViewFocusOptions {
  onlyWhenFocusLost?: boolean
}

interface FocusOnChangeOptions extends ViewFocusOptions {
  enabled?: boolean
  focusOnMount?: boolean
}

const UNHANDLED_CHANGE = Symbol('unhandled-view-focus-change')

function focusIsLost(): boolean {
  const activeElement = document.activeElement
  return (
    !activeElement
    || activeElement === document.body
    || activeElement === document.documentElement
    || activeElement.id === 'main-content'
    || !activeElement.isConnected
  )
}

function scheduleViewFocus(
  target: HTMLElement | null,
  { onlyWhenFocusLost = false }: ViewFocusOptions = {},
  onAttempt?: () => void,
): () => void {
  const frame = window.requestAnimationFrame(() => {
    onAttempt?.()
    if (
      !target?.isConnected
      || document.querySelector('[aria-modal="true"]')
      || (onlyWhenFocusLost && !focusIsLost())
      || target.matches(':disabled, [aria-disabled="true"]')
    ) {
      return
    }

    if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) {
      target.tabIndex = -1
    }
    target.focus()
  })

  return () => window.cancelAnimationFrame(frame)
}

export function moveFocusToView(
  target: HTMLElement | null,
  options?: ViewFocusOptions,
): () => void {
  return scheduleViewFocus(target, options)
}

export function useFocusOnChange<T extends HTMLElement>(
  ref: RefObject<T>,
  changeKey: unknown,
  {
    enabled = true,
    focusOnMount = false,
    onlyWhenFocusLost = false,
  }: FocusOnChangeOptions = {},
) {
  const mountedRef = useRef(false)
  const lastHandledChangeRef = useRef<unknown>(UNHANDLED_CHANGE)

  useEffect(() => {
    const firstEffect = !mountedRef.current
    mountedRef.current = true

    if (!enabled || (firstEffect && !focusOnMount)) {
      lastHandledChangeRef.current = changeKey
      return
    }
    if (Object.is(lastHandledChangeRef.current, changeKey)) return

    return scheduleViewFocus(
      ref.current,
      { onlyWhenFocusLost },
      () => {
        lastHandledChangeRef.current = changeKey
      },
    )
  }, [
    changeKey,
    enabled,
    focusOnMount,
    onlyWhenFocusLost,
    ref,
  ])
}
