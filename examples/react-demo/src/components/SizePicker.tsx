// Page size chooser: unbounded, a stock format, or a custom rectangle.
//
// Presets and orientation always produce a usable size, so they report through
// `onChange` immediately. Custom dimensions are committed on blur/Enter and
// only reported when they are actually usable — anything else goes to
// `onInvalid`, and the parent decides how loudly to complain. Typing "7" on
// the way to "794" must not raise a warning.

import { useEffect, useRef, useState } from 'react'
import type { PageSize, PageSizePreset } from '../lib/api.ts'
import {
  MAX_PAGE_PX,
  MIN_PAGE_PX,
  SIZE_PRESETS,
  orientationOf,
  pageSizeOf,
  presetSize,
  validateCustomSize,
  type Orientation,
  type SizeProblem,
} from '../lib/pageSize.ts'

export interface SizePickerProps {
  value: PageSize | undefined
  onChange: (size: PageSize) => void
  /**
   * Fires whenever the custom fields' text is not a usable size, and with
   * null once it becomes usable again. `committed` is true only on blur/Enter,
   * so a parent can gate its submit button on the continuous signal while a
   * popover stays quiet until the user actually finishes typing.
   */
  onProblem?: (problem: SizeProblem | null, committed: boolean) => void
  disabled?: boolean
}

export function SizePicker({ value, onChange, onProblem, disabled }: SizePickerProps) {
  const preset = value?.preset ?? 'default'
  const [orientation, setOrientation] = useState<Orientation>(() => orientationOf(value))
  const dims = pageSizeOf(value)

  // The custom fields are text, not numbers: "79" is a perfectly good
  // intermediate state and must not be coerced to 79px mid-keystroke.
  const [wText, setWText] = useState(() => (preset === 'custom' ? String(dims?.w ?? '') : ''))
  const [hText, setHText] = useState(() => (preset === 'custom' ? String(dims?.h ?? '') : ''))
  const [badField, setBadField] = useState<SizeProblem['field'] | null>(null)
  // Refs so the commit handlers read the current text without re-binding.
  const wRef = useRef(wText)
  const hRef = useRef(hText)
  wRef.current = wText
  hRef.current = hText

  // Switching to custom from a stock format seeds the fields with that
  // format's numbers — typing from a blank box is a worse first step.
  useEffect(() => {
    if (preset !== 'custom') return
    if (wText || hText) return
    const seed = presetSize('a4', orientation)
    if (seed) {
      setWText(String(seed.w))
      setHText(String(seed.h))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const pick = (next: PageSizePreset) => {
    setBadField(null)
    onProblem?.(null, false)
    if (next === 'default') {
      onChange({ preset: 'default' })
      return
    }
    if (next === 'custom') {
      // Adopt whatever is currently on screen so switching back is lossless.
      const d = dims ?? presetSize('a4', orientation)
      onChange({ preset: 'custom', w: d?.w, h: d?.h })
      return
    }
    const d = presetSize(next, orientation)
    if (d) onChange({ preset: next, w: d.w, h: d.h })
  }

  const turn = (o: Orientation) => {
    setOrientation(o)
    setBadField(null)
    onProblem?.(null, false)
    if (preset === 'custom') {
      // For a custom sheet, flipping means swapping the two numbers.
      const d = dims
      if (d) onChange({ preset: 'custom', w: d.h, h: d.w })
      setWText(hText)
      setHText(wText)
      return
    }
    if (preset === 'default') return
    const d = presetSize(preset, o)
    if (d) onChange({ preset, w: d.w, h: d.h })
  }

  /** Validate the fields as they stand and report the outcome. */
  const assess = (committed: boolean): SizeProblem | null => {
    const result = validateCustomSize(wRef.current, hRef.current)
    if ('message' in result) {
      setBadField(result.field)
      onProblem?.(result, committed)
      return result
    }
    setBadField(null)
    onProblem?.(null, committed)
    return null
  }

  const commitCustom = () => {
    if (assess(true)) return
    const result = validateCustomSize(wRef.current, hRef.current) as { w: number; h: number }
    setWText(String(result.w))
    setHText(String(result.h))
    onChange({ preset: 'custom', w: result.w, h: result.h })
  }

  const fieldKey = (which: 'w' | 'h', e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commitCustom()
      e.currentTarget.blur()
    }
    if (e.key === 'Escape') {
      setWText(String(dims?.w ?? ''))
      setHText(String(dims?.h ?? ''))
      setBadField(null)
      e.currentTarget.blur()
    }
    void which
  }

  const showDims =
    preset === 'default'
      ? '不限尺寸'
      : preset === 'custom'
        ? dims
          ? `${dims.w} × ${dims.h} px`
          : `宽高各 ${MIN_PAGE_PX} – ${MAX_PAGE_PX} px`
        : (() => {
            const d = presetSize(preset, orientation)
            return d ? `${d.w} × ${d.h} px` : ''
          })()

  return (
    <>
      <div className="field">
        <span className="field-label">纸张大小</span>
        <div className="size-row" role="radiogroup" aria-label="纸张大小">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={preset === s.id}
              className={`size-chip${preset === s.id ? ' is-active' : ''}`}
              title={s.hint}
              disabled={disabled}
              onClick={() => pick(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="size-note">{showDims}</span>
      </div>

      {preset !== 'default' && (
        <div className="field field-row">
          <span className="field-label">方向</span>
          <div className="seg" role="radiogroup" aria-label="方向">
            {(['portrait', 'landscape'] as const).map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={orientation === o}
                className={`seg-btn${orientation === o ? ' is-active' : ''}`}
                disabled={disabled}
                onClick={() => turn(o)}
              >
                {o === 'portrait' ? '竖版' : '横版'}
              </button>
            ))}
          </div>
        </div>
      )}

      {preset === 'custom' && (
        <div className="field">
          <span className="field-label">自定义尺寸（px）</span>
          <div className="size-inputs">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_PAGE_PX}
              max={MAX_PAGE_PX}
              aria-label="宽度（px）"
              placeholder="宽"
              value={wText}
              disabled={disabled}
              className={badField === 'w' || badField === 'both' ? 'is-bad' : ''}
              onChange={(e) => {
                setWText(e.target.value)
                wRef.current = e.target.value
                assess(false)
              }}
              onBlur={commitCustom}
              onKeyDown={(e) => fieldKey('w', e)}
            />
            <span className="size-x" aria-hidden="true">×</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_PAGE_PX}
              max={MAX_PAGE_PX}
              aria-label="高度（px）"
              placeholder="高"
              value={hText}
              disabled={disabled}
              className={badField === 'h' || badField === 'both' ? 'is-bad' : ''}
              onChange={(e) => {
                setHText(e.target.value)
                hRef.current = e.target.value
                assess(false)
              }}
              onBlur={commitCustom}
              onKeyDown={(e) => fieldKey('h', e)}
            />
          </div>
          <span className="size-note">
            最小 {MIN_PAGE_PX} × {MIN_PAGE_PX} px，最大 {MAX_PAGE_PX} × {MAX_PAGE_PX} px
          </span>
        </div>
      )}
    </>
  )
}
