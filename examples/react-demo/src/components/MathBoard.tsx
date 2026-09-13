// The board area: formula column on the left, Quickdraw paper on the right.
// Quickdraw runs with hideUi — its stock dock is replaced by BoardToolbar so
// the pen/eraser/select/undo controls match the app chrome. Nothing here
// touches the drawing engine's internals.
//
// While a page is submitted the paper is frozen: the canvas goes readonly and
// is covered by the exact PNG that was uploaded, so what the student sees is
// what the agent grades — independent of the student's zoom, pan or DPR.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Quickdraw } from '@quickdrawjs/react'
import type { Editor, QuickdrawRef, Store } from '@quickdrawjs/react'
import type { GradingResult, PageMeta, PageGrid, PageSize, PageTheme } from '../lib/api.ts'
import { pagesApi } from '../lib/api.ts'
import type { PagePhase } from '../hooks/usePage.ts'
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
  phase: PagePhase
  grading: GradingResult | null
  submittedAt: number | null
  onFormula: (latex: string | null) => Promise<void>
  onSubmit: () => void
  onContinue: () => void
  onSolution: (latex: string | null) => Promise<void>
  /** Dev-only: inject a grading without an agent. */
  onMockGrade?: (grading: GradingResult) => void
  onEditor: (editor: Editor | null) => void
  onClear: () => void
}

/** Canned reports for the dev-only "simulate agent" button, one per look. */
const MOCKS: GradingResult[] = [
  {
    readable: true,
    overall: 'correct',
    transcription: String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`,
    firstError: null,
    correctSolution: String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`,
    teacherComment: '步骤完整，极限的夹逼用得干净利落。',
    gradedAt: 0,
  },
  {
    readable: true,
    overall: 'incorrect',
    transcription: String.raw`\lim_{x\to 0}\frac{\sin x}{x}=0`,
    firstError: {
      description: '最后一步把极限当成了 0，实际上这个极限是 1。',
      correction: '用夹逼准则：cos x ≤ sin x / x ≤ 1，两边极限都是 1。',
    },
    correctSolution: String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`,
    teacherComment: '思路对，但标准极限记错了，回去把这一个记牢。',
    gradedAt: 0,
  },
  {
    readable: false,
    overall: 'unreadable',
    transcription: '第一步 [无法辨认]，第三步 [无法辨认]',
    firstError: null,
    correctSolution: '',
    teacherComment: '中间两步的字迹我认不出来，麻烦重写一遍再交。',
    gradedAt: 0,
  },
]

export function MathBoard({
  store,
  theme,
  grid,
  size,
  page,
  phase,
  grading,
  submittedAt,
  onFormula,
  onSubmit,
  onContinue,
  onSolution,
  onMockGrade,
  onEditor,
  onClear,
}: MathBoardProps) {
  const boardRef = useRef<QuickdrawRef>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [offSheet, setOffSheet] = useState(false)
  const [snapUrl, setSnapUrl] = useState<string | null>(null)
  const hintTimer = useRef(0)

  const dims = pageSizeOf(size)
  // Frozen while an agent is (or may be) looking at it. An empty page stays
  // writable — there is nothing to grade yet, and locking the pen out before
  // the first formula would be hostile.
  const frozen = phase === 'submitted' || phase === 'graded'

  // Turns the dashed outline into an actual edge: ink cannot begin outside it.
  usePageBoundary(editor, store, {
    size: dims,
    onBlocked: () => {
      setOffSheet(true)
      window.clearTimeout(hintTimer.current)
      hintTimer.current = window.setTimeout(() => setOffSheet(false), 1800)
    },
  })

  // The frozen sheet. Fetched with auth, so it cannot be a plain <img src> —
  // the blob becomes an object URL instead. `v` busts the immutable cache
  // because re-submitting changes the bytes under the same path.
  useEffect(() => {
    if (!page?.id || !submittedAt || !frozen) {
      setSnapUrl(null)
      return
    }
    let cancelled = false
    let url: string | null = null
    void pagesApi
      .submissionPng(page.id, submittedAt)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSnapUrl(url)
      })
      .catch(() => {
        // No overlay is better than a broken one — the readonly canvas still
        // shows the student's own work.
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [page?.id, submittedAt, frozen])

  const handleMount = useCallback(
    (mounted: Editor) => {
      setEditor(mounted)
      onEditor(mounted)
      // handy for devtools poking, same as the original demo
      ;(window as unknown as { editor?: Editor }).editor = mounted
    },
    [onEditor],
  )

  // Only in `vite dev` — a production build must not contain this at all.
  const [mockIdx, setMockIdx] = useState(0)
  const mockGrade = () => {
    if (!onMockGrade) return
    onMockGrade({ ...MOCKS[mockIdx % MOCKS.length], gradedAt: Date.now() })
    setMockIdx((i) => i + 1)
  }

  return (
    <main className="board-split">
      <FormulaPanel
        page={page}
        phase={phase}
        grading={grading}
        onFormula={onFormula}
        onSubmit={onSubmit}
        onContinue={onContinue}
        onSolution={onSolution}
      />

      <div className="board-col">
        {/* Quickdraw's host: the canvas it creates fills this div. The engine
            component accepts no testid, so the wrapper carries the marker. */}
        <div className="board-frame" data-testid="board-canvas">
          <Quickdraw
            ref={boardRef}
            store={store}
            theme={theme}
            grid={grid}
            readonly={frozen}
            hideUi
            themeToggle={false}
            gridControl={false}
            onMount={handleMount}
          />
          {/* Sits above the canvas, ignores all pointer input. */}
          <PageFrame editor={editor} size={dims} theme={theme} />
          {frozen && snapUrl && (
            <img
              className="board-frozen"
              src={snapUrl}
              alt="已提交的答题纸快照"
              data-testid="board-snapshot"
            />
          )}
          {frozen && !snapUrl && (
            <div className="board-frozen-note" data-testid="board-frozen-note">
              已冻结 · 快照加载中
            </div>
          )}
          {offSheet && (
            <div className="board-hint" role="status">
              已经超出纸张范围
            </div>
          )}
        </div>

        <div className="board-footer">
          <BoardToolbar editor={editor} size={size} onClear={onClear} />
          {import.meta.env.DEV && onMockGrade && (
            <button
              type="button"
              className="btn btn-dev"
              data-testid="dev-mock-grade"
              title="开发用：不经 agent 直接写入一份批改结果"
              onClick={mockGrade}
            >
              模拟 agent 批改
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
