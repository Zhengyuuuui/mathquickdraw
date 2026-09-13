// Page size presets and the bounds a custom size has to satisfy.
//
// Quickdraw is an infinite canvas; a "page size" is an app-level boundary we
// draw and frame to. Dimensions live in Quickdraw page px so the frame, the
// camera and the handwriting all share one coordinate space.

import type { PageSize, PageSizePreset } from './api.ts'

/** CSS px per mm at the 96dpi reference Quickdraw's page space implies. */
const MM = 96 / 25.4

export const MIN_PAGE_PX = 200
export const MAX_PAGE_PX = 8000

export type Orientation = 'portrait' | 'landscape'

/** Physical stock, in mm, before orientation is applied. */
const STOCK: Record<Exclude<PageSizePreset, 'default' | 'custom'>, { w: number; h: number; label: string; note: string }> = {
  a4: { w: 210, h: 297, label: 'A4', note: '210 × 297 mm' },
  a5: { w: 148, h: 210, label: 'A5', note: '148 × 210 mm' },
  letter: { w: 216, h: 279, label: 'Letter', note: '8.5 × 11 in' },
}

export const SIZE_PRESETS: ReadonlyArray<{
  id: PageSizePreset
  label: string
  hint: string
}> = [
  { id: 'default', label: '默认', hint: '无限画布，不设边界' },
  { id: 'a4', label: 'A4', hint: '210 × 297 mm' },
  { id: 'a5', label: 'A5', hint: '148 × 210 mm' },
  { id: 'letter', label: 'Letter', hint: '8.5 × 11 in' },
  { id: 'custom', label: '自定义', hint: '自己输入宽高（px）' },
]

/** mm stock → page px, orientation applied. */
export function presetSize(
  preset: PageSizePreset,
  orientation: Orientation = 'portrait',
): { w: number; h: number } | null {
  if (preset === 'default' || preset === 'custom') return null
  const s = STOCK[preset]
  const w = Math.round(s.w * MM)
  const h = Math.round(s.h * MM)
  return orientation === 'landscape' ? { w: h, h: w } : { w, h }
}

/** Size of a page as stored, or null when it is unbounded. */
export function pageSizeOf(size: PageSize | undefined): { w: number; h: number } | null {
  if (!size || size.preset === 'default') return null
  if (typeof size.w === 'number' && typeof size.h === 'number') return { w: size.w, h: size.h }
  return null
}

/** Which way round a stored page is — useful when re-editing it. */
export function orientationOf(size: PageSize | undefined): Orientation {
  const d = pageSizeOf(size)
  return d && d.w > d.h ? 'landscape' : 'portrait'
}

export interface SizeProblem {
  /** Human sentence for a dialog. */
  message: string
  field: 'w' | 'h' | 'both'
}

/**
 * Validate a custom size. Returns the problem (for the warning dialog) or the
 * rounded dimensions. Kept in one place so the picker and the board popover
 * reject exactly the same input.
 */
export function validateCustomSize(w: unknown, h: unknown): SizeProblem | { w: number; h: number } {
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').trim()))
  const W = num(w)
  const H = num(h)

  if (!Number.isFinite(W) || !Number.isFinite(H)) {
    return { message: '宽和高都需要是数字。', field: 'both' }
  }
  const rw = Math.round(W)
  const rh = Math.round(H)

  const small = rw < MIN_PAGE_PX || rh < MIN_PAGE_PX
  const large = rw > MAX_PAGE_PX || rh > MAX_PAGE_PX

  if (small && large) {
    return {
      message: `尺寸超出范围。宽度和高度都必须在 ${MIN_PAGE_PX} – ${MAX_PAGE_PX} px 之间（当前 ${rw} × ${rh}）。`,
      field: 'both',
    }
  }
  if (small) {
    const which = rw < MIN_PAGE_PX && rh < MIN_PAGE_PX ? '宽度和高度都' : rw < MIN_PAGE_PX ? '宽度' : '高度'
    return {
      message:
        `纸张太小了，写不下解题过程。\n\n` +
        `${which}至少需要 ${MIN_PAGE_PX} px，当前为 ${rw} × ${rh} px。\n` +
        `A4 竖版约 794 × 1123 px，可以直接选用。`,
      field: rw < MIN_PAGE_PX ? (rh < MIN_PAGE_PX ? 'both' : 'w') : 'h',
    }
  }
  if (large) {
    return {
      message: `纸张过大。宽度和高度不能超过 ${MAX_PAGE_PX} px（当前 ${rw} × ${rh}）。`,
      field: rw > MAX_PAGE_PX ? 'w' : 'h',
    }
  }
  return { w: rw, h: rh }
}

/** "794 × 1123 px" for cards and chips. */
export function formatSize(size: PageSize | undefined): string | null {
  const d = pageSizeOf(size)
  return d ? `${d.w} × ${d.h}` : null
}

// Mirrors the engine's zoom window (packages/core/src/editor.js) so a framed
// page can't be pushed outside what Quickdraw will render.
const ZOOM_MIN = 0.05
const ZOOM_MAX = 8

/**
 * Camera that shows the whole sheet, centred, with a little breathing room.
 *
 * Deliberately not `Editor.followBounds`: that fits with max(vw/w, vh/h),
 * i.e. it covers the viewport and crops. Showing a page needs contain.
 */
export function framePageCamera(
  viewW: number,
  viewH: number,
  page: { w: number; h: number },
  pad = 48,
): { x: number; y: number; z: number } | null {
  if (!(viewW > 1) || !(viewH > 1)) return null
  const z = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.min(viewW / (page.w + pad * 2), viewH / (page.h + pad * 2))),
  )
  // pageToScreen(p) = (p + cam) * z  →  put the page centre at the view centre
  return { z, x: viewW / 2 / z - page.w / 2, y: viewH / 2 / z - page.h / 2 }
}
