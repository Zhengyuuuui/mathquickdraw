// The page boundary drawn over the board.
//
// Quickdraw is an infinite canvas and knows nothing about page sizes, so this
// is a plain div positioned from the editor's camera. It mutates its own style
// on the engine's 'camera' event rather than setting React state, so panning
// at 60fps costs one style write and zero re-renders. The engine is untouched.

import { useEffect, useRef } from 'react'
import type { Editor } from '@quickdrawjs/react'

export interface PageFrameProps {
  editor: Editor | null
  /** Logical page size in page px, or null for an unbounded sheet. */
  size: { w: number; h: number } | null
  theme?: 'light' | 'dark'
}

export function PageFrame({ editor, size, theme = 'light' }: PageFrameProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor || !size) return
    const el = ref.current
    if (!el) return

    const apply = () => {
      const c = editor.camera
      // page origin → screen, and the extent scales with zoom
      const o = editor.pageToScreen(0, 0)
      el.style.transform = `translate(${o.x}px, ${o.y}px)`
      el.style.width = `${Math.max(0, size.w * c.z)}px`
      el.style.height = `${Math.max(0, size.h * c.z)}px`
      // hide once the sheet is a speck — a hairline box at 5% zoom is noise
      el.style.opacity = size.w * c.z < 24 || size.h * c.z < 24 ? '0' : '1'
    }

    apply()
    // 'camera' fires on every pan/zoom frame, including animated ones
    return editor.on('camera', apply)
  }, [editor, size])

  if (!size) return null

  return (
    <div
      ref={ref}
      className={`page-frame is-${theme}`}
      aria-hidden="true"
      data-w={size.w}
      data-h={size.h}
    />
  )
}
