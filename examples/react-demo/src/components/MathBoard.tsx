// The board area: formula column on the left, Quickdraw paper on the right.
// Quickdraw runs with hideUi — its stock dock is replaced by BoardToolbar so
// the pen/eraser/select/undo controls match the app chrome. Nothing here
// touches the drawing engine's internals.

import { useCallback, useRef, useState } from 'react'
import { Quickdraw } from '@quickdrawjs/react'
import type { Editor, QuickdrawRef, Store } from '@quickdrawjs/react'
import type { PageMeta, PageGrid, PageSize, PageTheme } from '../lib/api.ts'
import { pageSizeOf } from '../lib/pageSize.ts'
import { usePageBoundary } from '../hooks/usePageBoundary.ts'
import { BoardToolbar } from './BoardToolbar.tsx'
import { PageFrame } from './PageFrame.tsx'
import { FormulaPanel } from './FormulaPanel.tsx'

export interface MathBoardProps {
  /** Owned by App (useQuickdrawStore) so usePage can loadSnapshot into it. */
  store: Store
  /** Page-scoped presentation — comes from the current page's style. */
  theme: PageTheme
  grid: PageGrid
  size: PageSize | undefined
  page: PageMeta | null
  onFormula: (latex: string | null) => Promise<void>
  onEditor: (editor: Editor | null) => void
  onClear: () => void
}

export function MathBoard({ store, theme, grid, size, page, onFormula, onEditor, onClear }: MathBoardProps) {
  const boardRef = useRef<QuickdrawRef>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [offSheet, setOffSheet] = useState(false)
  const hintTimer = useRef(0)

  const dims = pageSizeOf(size)

  // Turns the dashed outline into an actual edge: ink cannot begin outside it.
  usePageBoundary(editor, store, {
    size: dims,
    onBlocked: () => {
      setOffSheet(true)
      window.clearTimeout(hintTimer.current)
      hintTimer.current = window.setTimeout(() => setOffSheet(false), 1800)
    },
  })

  const handleMount = useCallback(
    (mounted: Editor) => {
      setEditor(mounted)
      onEditor(mounted)
      // handy for devtools poking, same as the original demo
      ;(window as unknown as { editor?: Editor }).editor = mounted
    },
    [onEditor],
  )

  return (
    <main className="board-split">
      <FormulaPanel page={page} onFormula={onFormula} />

      <div className="board-col">
        {/* Quickdraw's host: the canvas it creates fills this div. The engine
            component accepts no testid, so the wrapper carries the marker. */}
        <div className="board-frame" data-testid="board-canvas">
          <Quickdraw
            ref={boardRef}
            store={store}
            theme={theme}
            grid={grid}
            hideUi
            themeToggle={false}
            gridControl={false}
            onMount={handleMount}
          />
          {/* Sits above the canvas, ignores all pointer input. */}
          <PageFrame editor={editor} size={dims} theme={theme} />
          {offSheet && (
            <div className="board-hint" role="status">
              已经超出纸张范围
            </div>
          )}
        </div>

        <div className="board-footer">
          <BoardToolbar editor={editor} size={size} onClear={onClear} />
        </div>
      </div>
    </main>
  )
}
