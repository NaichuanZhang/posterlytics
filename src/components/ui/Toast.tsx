import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import {
  appendToast,
  type ToastItem,
  type ToastOptions,
  type ToastTone,
} from '../../lib/toast'

export type {
  ToastItem,
  ToastOptions,
  ToastTone,
} from '../../lib/toast'

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback((
    message: string,
    tone: ToastTone = 'info',
    options: ToastOptions = {},
  ) => {
    const id = Date.now() + Math.random()
    setToasts((current) => appendToast(current, {
      id,
      message,
      tone,
      dedupeKey: options.dedupeKey,
      action: options.action,
    }))
    window.setTimeout(() => dismiss(id), options.durationMs ?? (options.action ? 7000 : 3600))
  }, [dismiss])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <ToastIcon tone={toast.tone} />
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CheckCircle2 size={17} aria-hidden="true" />
  if (tone === 'error') return <AlertCircle size={17} aria-hidden="true" />
  return <Info size={17} aria-hidden="true" />
}
