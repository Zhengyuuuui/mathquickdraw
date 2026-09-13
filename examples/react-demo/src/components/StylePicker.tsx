// The backdrop + size + theme chooser. Shared by the create dialog (home) and
// the board's style popover, so a page looks the same whether you're picking
// its paper up front or swapping it mid-answer.

import type { PageSize, PageGrid, PageTheme } from '../lib/api.ts'
import type { SizeProblem } from '../lib/pageSize.ts'
import { GRID_OPTIONS, GridPreview } from './GridPreview.tsx'
import { SizePicker } from './SizePicker.tsx'

export interface StylePickerProps {
  grid: PageGrid
  theme: PageTheme
  size: PageSize | undefined
  onGrid: (grid: PageGrid) => void
  onTheme: (theme: PageTheme) => void
  onSize: (size: PageSize) => void
  /** Custom size text became (un)usable — parent gates submit / warns. */
  onSizeProblem?: (problem: SizeProblem | null, committed: boolean) => void
  disabled?: boolean
  /** Preview box size — the dialog uses a larger one than the popover. */
  shotWidth?: number
  shotHeight?: number
  cell?: number
}

export function StylePicker({
  grid,
  theme,
  size,
  onGrid,
  onTheme,
  onSize,
  onSizeProblem,
  disabled,
  shotWidth = 148,
  shotHeight = 92,
  cell = 15,
}: StylePickerProps) {
  return (
    <>
      <div className="field">
        <span className="field-label">纸张样式</span>
        <div className="style-grid" role="radiogroup" aria-label="纸张样式">
          {GRID_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={grid === opt.id}
              className={`style-card${grid === opt.id ? ' is-active' : ''}`}
              disabled={disabled}
              onClick={() => onGrid(opt.id)}
            >
              <span className="style-shot">
                <GridPreview grid={opt.id} theme={theme} width={shotWidth} height={shotHeight} cell={cell} />
              </span>
              <span className="style-name">{opt.name}</span>
              <span className="style-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <SizePicker value={size} onChange={onSize} onProblem={onSizeProblem} disabled={disabled} />

      <div className="field field-row">
        <span className="field-label">主题</span>
        <div className="seg" role="radiogroup" aria-label="主题">
          {(['light', 'dark'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              className={`seg-btn${theme === t ? ' is-active' : ''}`}
              disabled={disabled}
              onClick={() => onTheme(t)}
            >
              {t === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
