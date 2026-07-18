export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  dedupeKey?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export interface ToastOptions {
  dedupeKey?: string
  durationMs?: number
  action?: ToastItem['action']
}

export function appendToast(
  current: ToastItem[],
  next: ToastItem,
): ToastItem[] {
  if (
    next.dedupeKey
    && current.some((toast) => toast.dedupeKey === next.dedupeKey)
  ) {
    return current
  }
  return [...current, next]
}
