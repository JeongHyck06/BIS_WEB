import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '../lib/types'

// ---------- Toast ----------
type ToastKind = 'info' | 'success' | 'error'
interface ToastItem { id: number; kind: ToastKind; message: string }
interface ToastApi { show: (message: string, kind?: ToastKind) => void }
const ToastCtx = createContext<ToastApi>({ show: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = ++seq.current
    setItems((prev) => [...prev, { id, kind, message }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.message}</span>
            <button type="button" onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}>닫기</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-plain" onClick={onClose}>닫기</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------- Session text ----------
export const sessionText = (s: Session) => s.name

/** 세션 목록을 "(보컬, 기타)" 형태의 텍스트로 */
export function SessionText({ sessions, className }: { sessions: Session[]; className?: string }) {
  if (sessions.length === 0) return null
  return <span className={className ?? 'sessions'}>({sessions.map(sessionText).join(', ')})</span>
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>
}
