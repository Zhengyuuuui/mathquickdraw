// What is about to be uploaded, shown before it is sent.
//
// This is a diagnostic surface, not a confirmation nag. The whole point of
// freezing the board is that the agent grades exactly this image — so a crop
// that cut the last line, a blank render or unreadable strokes should be
// visible here, to the student, before an agent wastes a pass on it.

import { useEffect } from 'react'

export interface GradePreviewProps {
  open: boolean
  /** Object URL of the rendered PNG. */
  url: string | null
  /** Actual pixel size of the render, for "is this resolution sane". */
  width: number
  height: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function GradePreview({ open, url, width, height, busy, onConfirm, onCancel }: GradePreviewProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Escape cancels; Enter confirms only when not already submitting.
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!busy) onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div className="dialog-scrim" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="dialog grade-preview"
        role="dialog"
        aria-modal="true"
        aria-label="提交预览"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>提交这份答题纸？</h2>
          <button
            type="button"
            className="dialog-x"
            aria-label="取消"
            disabled={busy}
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <p className="grade-preview-meta">
          {width} × {height} px · 提交后画布冻结，agent 将批改这张图
        </p>

        {/* onContextMenu because CSS cannot suppress iOS's long-press sheet
            on an <img>; pointer-events is off on the image itself, so the
            container has to eat the event. */}
        <div
          className="grade-preview-frame"
          onContextMenu={(e) => e.preventDefault()}
        >
          {url && (
            <img
              src={url}
              alt="即将提交的答题纸快照"
              data-testid="grade-preview-image"
            />
          )}
        </div>

        <div className="dialog-foot">
          <button
            type="button"
            className="btn"
            data-testid="grade-preview-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="grade-preview-confirm"
            disabled={busy || !url}
            onClick={onConfirm}
          >
            {busy ? '提交中…' : '确认提交'}
          </button>
        </div>
      </div>
    </div>
  )
}
