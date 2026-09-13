// Render the frozen answer sheet that gets uploaded and graded.
//
// Not `editor.exportImage()`: that bakes in the grid, and grid lines are pure
// noise to a handwriting reader — they look like stray strokes. This renders
// the ink alone over the theme's paper colour.

import type { Editor } from '@quickdrawjs/react'

/** Longest edge of the uploaded PNG. Big enough to read a pencil stroke. */
const MAX_EDGE = 2200
/** Whitespace around the ink so the first/last stroke is not clipped. */
const PAD = 32
/** Never upscale past this — a one-line answer does not need 2200px. */
const MAX_SCALE = 3

export interface RenderedSubmission {
  blob: Blob
  width: number
  height: number
}

/**
 * PNG of everything drawn on the page, plus its pixel size, or null when the
 * page is empty. The null is the caller's cue to block the submit: an empty
 * sheet graded is an agent inventing feedback about nothing.
 *
 * Dimensions come back with the blob so the caller never has to decode it
 * through a throwaway <img> — that decode is a race against a cancel.
 */
export async function renderSubmission(editor: Editor): Promise<RenderedSubmission | null> {
  const b = editor.contentBounds()
  if (!b) return null

  const rect = { x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 }
  const scale = Math.min(MAX_SCALE, MAX_EDGE / Math.max(rect.w, rect.h))

  const w = Math.max(1, Math.round(rect.w * scale))
  const h = Math.max(1, Math.round(rect.h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Camera maps page point p to (p + cam) * z, so -rect.x puts the padded
  // origin at pixel 0. background:false is required to keep the grid off the
  // sheet — but that branch also clearRects the canvas, so the paper colour
  // has to go back *behind* the ink rather than under it beforehand.
  editor.renderScene(ctx, { x: -rect.x, y: -rect.y, z: scale }, w, h, {
    dpr: 1,
    background: false,
  })

  // destination-over paints only where nothing is drawn yet: the theme's
  // paper colour, never white — in dark mode the ink is light, and
  // light-on-white reads as an apparently blank image.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = editor.theme.background
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  return blob ? { blob, width: w, height: h } : null
}
