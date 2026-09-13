// The board's top bar: leave-to-home, the page's name, its paper style, and
// the autosave indicator. (The AI instruction line used to live here; with
// grading gone the AI entry point is the home screen's AI section.)

import { useEffect, useRef, useState } from 'react'
import type { PageGrid, PageMeta, PageSize, PageTheme } from '../lib/api.ts'
import { formatSize } from '../lib/pageSize.ts'
import { gridLabel } from './GridPreview.tsx'
import { StylePicker } from './StylePicker.tsx'
import { AlertDialog } from './AlertDialog.tsx'

export interface CommandBarProps {
  page: PageMeta | null
  saving: boolean
  onHome: () => void
  onRename: (name: string) => void
  onStyle: (patch: { grid?: PageGrid; theme?: PageTheme; size?: PageSize }) => void
  onSettings: () => void
}

export function CommandBar({ page, saving, onHome, onRename, onStyle, onSettings }: CommandBarProps) {
  const [name, setName] = useState(page?.name ?? '')
  const [styleOpen, setStyleOpen] = useState(false)
  const [sizeAlert, setSizeAlert] = useState<string | null>(null)
  const styleWrap = useRef<HTMLDivElement>(null)

  // follow the page when it changes underneath us (open / patch response)
  useEffect(() => {
    setName(page?.name ?? '')
  }, [page?.id, page?.name])

  useEffect(() => {
    if (!styleOpen) return
    const onDown = (e: PointerEvent) => {
      if (!styleWrap.current?.contains(e.target as Node)) setStyleOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStyleOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [styleOpen])

  const commitName = () => {
    const next = name.trim()
    if (!next || next === page?.name) {
      setName(page?.name ?? '')
      return
    }
    onRename(next)
  }

  const grid = page?.style.grid ?? 'none'
  const theme = page?.style.theme ?? 'light'

  return (
    <header className="cmdbar">
      <div className="cmdbar-row">
        <button
          type="button"
          className="cmd-home"
          data-testid="page-back-home"
          onClick={onHome}
          title="返回所有页面"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span>页面</span>
        </button>

        <input
          className="cmd-pagename"
          data-testid="page-name-input"
          value={name}
          aria-label="页面名称"
          maxLength={60}
          placeholder="未命名"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              commitName()
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'Escape') {
              setName(page?.name ?? '')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />

        <div className="cmd-style" ref={styleWrap}>
          <button
            type="button"
            className="cmd-style-btn"
            data-testid="page-style-trigger"
            aria-haspopup="dialog"
            aria-expanded={styleOpen}
            onClick={() => setStyleOpen((v) => !v)}
          >
            {gridLabel(grid)}
            <span className="cmd-style-sub">
              {formatSize(page?.style.size) ?? (theme === 'dark' ? '深色' : '浅色')}
            </span>
          </button>

          {styleOpen && (
            <div className="style-pop" role="dialog" aria-label="纸张样式">
              <StylePicker
                grid={grid}
                theme={theme}
                size={page?.style.size}
                onGrid={(g) => onStyle({ grid: g })}
                onTheme={(t) => onStyle({ theme: t })}
                onSize={(s) => onStyle({ size: s })}
                // A popover has no submit button, so complain the moment the
                // user commits unusable numbers rather than silently keeping
                // the old sheet.
                onSizeProblem={(p, committed) => {
                  if (p && committed) setSizeAlert(p.message)
                }}
                shotWidth={124}
                shotHeight={78}
                cell={13}
              />
            </div>
          )}
        </div>

        {saving && <span className="cmd-saving">保存中…</span>}

        <button
          type="button"
          className="cmd-settings"
          data-testid="page-settings-trigger"
          aria-haspopup="dialog"
          title="页面设置（Agent Token 与指令）"
          onClick={onSettings}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="sr-only">页面设置</span>
        </button>
      </div>

      <AlertDialog open={!!sizeAlert} message={sizeAlert ?? ''} onConfirm={() => setSizeAlert(null)} />
    </header>
  )
}
