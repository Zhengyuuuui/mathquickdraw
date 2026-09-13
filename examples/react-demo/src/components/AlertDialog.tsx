// A blocking warning. Used for input the user has to fix before continuing —
// a custom page size below the usable minimum, for instance. Separate from
// NewPageDialog so it can sit on top of it and take focus.

import { useEffect, useRef } from 'react'

export interface AlertDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
}

export function AlertDialog({
  open,
  title = '尺寸不合适',
  message,
  confirmLabel = '知道了',
  onConfirm,
}: AlertDialogProps) {
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => btnRef.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onConfirm])

  if (!open) return null

  return (
    <div className="alert-scrim" role="presentation" onPointerDown={onConfirm}>
      <div
        className="alert"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {/* message carries intentional line breaks from the validator */}
        <p className="alert-body">{message}</p>
        <footer className="dialog-foot">
          <button type="button" className="btn btn-primary" ref={btnRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
