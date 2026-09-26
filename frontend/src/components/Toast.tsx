import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type Notify = (message: string, kind?: 'ok' | 'error') => void

const ToastContext = createContext<Notify>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const notify = useCallback<Notify>((message, kind = 'ok') => {
    setToast({ message, kind })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2500)
  }, [])
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          {toast.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
