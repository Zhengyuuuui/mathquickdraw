// Enforce the page rectangle as a real boundary, not a decorative outline.
//
// Quickdraw is an infinite canvas and correctly knows nothing about page
// sizes, so enforcement lives out here, on the public surface only:
//
//  1. A capture-phase `pointerdown` on the board's PARENT stops ink gestures
//     that begin outside the sheet. Capture on the parent runs before
//     Quickdraw's own bubble-phase listeners on `container`, so the engine
//     never sees the event — no core edits, no monkey-patching.
//  2. A stroke that still escapes (a finger in non-pen mode, a graze past the
//     edge) is trimmed to the last point inside the sheet once it completes.
//
// Panning, pinching, selection and the eraser are deliberately unbounded: the
// camera has to be able to travel off the sheet, and blocking a finger's move
// would break two-finger zoom — a far worse bug than an overrun stroke.

import { useEffect, useRef } from 'react'
import type { Editor, ShapeRecord, Store } from '@quickdrawjs/react'

/** Tools that lay ink or place content and therefore belong on the sheet. */
const BOUNDED = new Set(['draw', 'highlight', 'laser', 'arrow', 'line', 'geo', 'text', 'note'])
/** Types whose freehand points are stored relative to the shape origin. */
const INKY = new Set(['draw', 'highlight'])

/** Slack so the very edge of the sheet is not a dead zone. */
const MARGIN = 2
/** Ignore sub-pixel grazes — trimming those costs an undo step for nothing. */
const TRIM_TOLERANCE = 3

export interface PageBoundaryOpts {
  size: { w: number; h: number } | null
  /** Called when a stroke was refused because it began off the sheet. */
  onBlocked?: () => void
}

export function usePageBoundary(
  editor: Editor | null,
  store: Store,
  { size, onBlocked }: PageBoundaryOpts,
): void {
  // Latest callback without rebinding the listeners on every render.
  const cbRef = useRef(onBlocked)
  cbRef.current = onBlocked

  // ---- 1. refuse gestures that start off the sheet -------------------------
  useEffect(() => {
    if (!editor || !size) return
    // The parent, so capture runs before Quickdraw's bubble listeners.
    const host = editor.container.parentElement
    if (!host) return
    const { w, h } = size

    const toPage = (e: PointerEvent) => {
      const r = editor.container.getBoundingClientRect()
      return editor.screenToPage(e.clientX - r.left, e.clientY - r.top)
    }
    const offSheet = (p: { x: number; y: number }) =>
      p.x < -MARGIN || p.y < -MARGIN || p.x > w + MARGIN || p.y > h + MARGIN

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return // middle-click pan and right-click stay free
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.qd-watermark')) return // the corner credit must stay clickable
      if (!BOUNDED.has(editor.tool)) return
      // In pen mode a landing finger is a resting palm or the start of a
      // pinch — never ink, so never something to refuse.
      if (editor.penMode && e.pointerType === 'touch') return
      if (offSheet(toPage(e))) {
        e.preventDefault()
        e.stopPropagation()
        cbRef.current?.()
      }
    }

    host.addEventListener('pointerdown', onDown, { capture: true })
    return () => host.removeEventListener('pointerdown', onDown, { capture: true })
  }, [editor, size])

  // ---- 2. trim strokes that escaped anyway --------------------------------
  useEffect(() => {
    if (!editor || !size) return
    const { w, h } = size
    // Guard: our own update/remove emits another diff; do not re-enter.
    let trimming = false

    const trim = (id: string) => {
      if (trimming) return
      const rec = store.get(id)
      if (!rec || rec.typeName !== 'shape') return
      const shape = rec as ShapeRecord
      if (!INKY.has(shape.type)) return
      const pts = shape.props?.pts
      if (!Array.isArray(pts) || pts.length < 6) return

      // Points are relative to the shape origin.
      let cut = pts.length
      for (let i = 0; i + 1 < pts.length; i += 3) {
        const px = shape.x + pts[i]
        const py = shape.y + pts[i + 1]
        if (px < -TRIM_TOLERANCE || py < -TRIM_TOLERANCE || px > w + TRIM_TOLERANCE || py > h + TRIM_TOLERANCE) {
          cut = i
          break
        }
      }
      if (cut === pts.length) return // entirely on the sheet — leave it alone
      if (cut < 6) {
        // Nothing usable left: a stroke that was almost entirely off-sheet.
        trimming = true
        try {
          store.remove([id])
        } finally {
          trimming = false
        }
        return
      }
      trimming = true
      try {
        store.update(id, { props: { ...shape.props, pts: pts.slice(0, cut) } })
      } finally {
        trimming = false
      }
    }

    // 'user' only: loading a snapshot must not rewrite the page it just read.
    return store.listen(
      (diff) => {
        if (trimming) return
        const done = (r: unknown) =>
          (r as ShapeRecord | undefined)?.typeName === 'shape' &&
          (r as ShapeRecord).props?.done === true
        for (const [id, rec] of Object.entries(diff.added ?? {})) {
          if (done(rec)) trim(id)
        }
        for (const [id, [, to]] of Object.entries(diff.updated ?? {})) {
          if (done(to)) trim(id)
        }
      },
      { source: 'user' },
    )
  }, [editor, store, size])
}
