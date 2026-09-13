// Create-page dialog: name + backdrop + size + theme.
//
// The six backdrops and the size presets are drawn by StylePicker/SizePicker
// so the choice is visual rather than a dropdown of identifiers. An unusable
// custom size raises AlertDialog instead of silently creating a page nobody
// can write on.

import { useEffect, useRef, useState } from 'react'
import type { PageGrid, PageSize, PageStyle, PageTheme } from '../lib/api.ts'
import type { SizeProblem } from '../lib/pageSize.ts'
import { AlertDialog } from './AlertDialog.tsx'
import { StylePicker } from './StylePicker.tsx'

export interface NewPageDialogProps {
  open: boolean
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onCreate: (init: { name: string; style: PageStyle }) => void | Promise<void>
}

export function NewPageDialog({ open, busy, error, onCancel, onCreate }: NewPageDialogProps) {
  const [name, setName] = useState('')
  const [grid, setGrid] = useState<PageGrid>('ruled')
  const [theme, setTheme] = useState<PageTheme>('light')
  const [size, setSize] = useState<PageSize>({ preset: 'default' })
  const [sizeProblem, setSizeProblem] = useState<SizeProblem | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setGrid('ruled')
    setTheme('light')
    setSize({ preset: 'default' })
    setSizeProblem(null)
    setAlert(null)
    // focus after paint so the dialog is in the layout tree first
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !alert) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel, alert])

  if (!open) return null

  const submit = () => {
    if (busy) return
    // The custom fields can be mid-word ("79" on the way to "794"); refuse to
    // create a page the student cannot write on, and say why.
    if (sizeProblem) {
      setAlert(sizeProblem.message)
      return
    }
    void onCreate({ name: name.trim() || '未命名', style: { theme, grid, size } })
  }

  return (
    <div
      className="dialog-scrim"
      onPointerDown={(e) => {
        // click outside the panel dismisses; clicks inside must not
        if (!panelRef.current?.contains(e.target as Node)) onCancel()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label="新建页面" ref={panelRef}>
        <header className="dialog-head">
          <h2>新建页面</h2>
          <button type="button" className="dialog-x" aria-label="关闭" onClick={onCancel}>
            ×
          </button>
        </header>

        <label className="field">
          <span className="field-label">页面名称</span>
          <input
            ref={inputRef}
            value={name}
            placeholder="未命名"
            maxLength={60}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </label>

        <StylePicker
          grid={grid}
          theme={theme}
          size={size}
          onGrid={setGrid}
          onTheme={setTheme}
          onSize={setSize}
          onSizeProblem={(p) => setSizeProblem(p)}
          disabled={busy}
        />

        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}

        <footer className="dialog-foot">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? '创建中…' : '创建并打开'}
          </button>
        </footer>
      </div>

      <AlertDialog open={!!alert} message={alert ?? ''} onConfirm={() => setAlert(null)} />
    </div>
  )
}
