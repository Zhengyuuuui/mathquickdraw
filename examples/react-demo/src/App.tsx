// App shell: a home screen of saved pages, and the board behind its own URL.
//
// Owns the Quickdraw Store (so usePage can load/save snapshots) and the
// route. It never imports a concrete AI adapter and never reaches into
// Quickdraw's internals; the only editor surface it touches is `clearBoard`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuickdrawStore } from '@quickdrawjs/react'
import type { Editor } from '@quickdrawjs/react'
import { CommandBar } from './components/CommandBar.tsx'
import { GradePreview } from './components/GradePreview.tsx'
import { HomeView } from './components/HomeView.tsx'
import { MathBoard } from './components/MathBoard.tsx'
import { PageSettings } from './components/PageSettings.tsx'
import { agentPromptFor } from './components/AgentPanel.tsx'
import { usePage } from './hooks/usePage.ts'
import { API_BASE } from './lib/api.ts'
import { renderSubmission } from './lib/submissionImage.ts'
import { navigate, useRoute } from './lib/router.ts'

export default function App() {
  const route = useRoute()

  const editorRef = useRef<Editor | null>(null)
  // <Quickdraw> remounts when the store identity changes — keep it stable.
  const store = useQuickdrawStore()
  const pageState = usePage(store, editorRef)
  // latest hook result, readable from the one-shot onMount and from devtools
  const pageStateRef = useRef(pageState)
  pageStateRef.current = pageState

  const [settingsOpen, setSettingsOpen] = useState(false)
  // The sheet about to be uploaded: its bytes plus the object URL the preview
  // shows. Held between render and confirm — never between render and a
  // throwaway <img> decode, which used to race a cancel and re-open the dialog.
  const [preview, setPreview] = useState<{ url: string; blob: Blob; w: number; h: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleEditor = useCallback(
    (editor: Editor | null) => {
      editorRef.current = editor
      // A page may have loaded before the editor mounted — frame it now.
      if (editor) pageState.syncCamera()
    },
    [pageState],
  )

  // devtools poking, same convention as `window.editor`:
  //   page.setStyle({ grid: 'dots' }) / page.rename('新名字')
  useEffect(() => {
    const w = window as unknown as { page?: typeof pageState }
    Object.defineProperty(w, 'page', { get: () => pageStateRef.current, configurable: true })
    return () => {
      delete w.page
    }
  }, [])

  // Deep links: '/xxas23sadhj' must open that page on a hard reload, and
  // back/forward must switch correctly. `open()` itself flushes the previous
  // page's ink + camera first, so switching pages never loses a stroke.
  useEffect(() => {
    if (route.name === 'page' && pageState.page?.id !== route.id) {
      void pageState.open(route.id)
    }
  }, [route, pageState])

  const handleClear = useCallback(() => {
    editorRef.current?.clearBoard()
  }, [])

  /**
   * Render the sheet and show it before anything is sent. The preview is the
   * last chance to catch a bad crop or an unreadable scan while it is still
   * free to fix.
   */
  const beginSubmit = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const rendered = await renderSubmission(editor)
    if (!rendered) {
      window.alert('答题纸还是空的，先写下你的解题过程。')
      return
    }
    setPreview({
      url: URL.createObjectURL(rendered.blob),
      blob: rendered.blob,
      w: rendered.width,
      h: rendered.height,
    })
  }, [])

  const cancelPreview = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }, [preview])

  const confirmSubmit = useCallback(async () => {
    if (!preview || submitting) return
    setSubmitting(true)
    try {
      await pageStateRef.current.submit(preview.blob)
      URL.revokeObjectURL(preview.url)
      setPreview(null)
    } catch {
      // usePage already put the reason in `error`; keep the preview open so
      // the student can retry without re-rendering.
    } finally {
      setSubmitting(false)
    }
  }, [preview, submitting])

  /**
   * Everything an external agent needs, as one JSON island in the DOM. No
   * token here: prompts get screenshotted, and the token is handed over
   * separately from the settings dialog.
   */
  const page = pageState.page
  useEffect(() => {
    const el = document.getElementById('agent-context')
    if (!el) return
    if (!page) {
      el.textContent = ''
      return
    }
    const phase = pageState.phase
    el.textContent = JSON.stringify({
      phase,
      pageId: page.id,
      pageUrl: `${window.location.origin}/${page.id}`,
      latex: page.formula ?? '',
      apiBase: API_BASE,
      submissionPng: page.submittedAt
        ? `${API_BASE}/api/pages/${page.id}/submission.png?v=${page.submittedAt}`
        : null,
      systemPrompt: agentPromptFor(phase, page.id, page.formula) ?? '',
    })
  }, [page, pageState.phase])

  const goHome = useCallback(() => {
    // Leaving the board: write ink + camera now so the home card's
    // "modified" time is honest and a reopen lands where you left off.
    pageState.persist()
    navigate({ name: 'home' })
  }, [pageState])

  const onBoard = route.name === 'page'
  const loadFailed = onBoard && !pageState.loading && !pageState.page && pageState.error !== null

  if (!onBoard || loadFailed) {
    // A route that exists but has no page behind it is a bad deep link —
    // keep the chrome, say so, and offer the way out. Never a blank screen.
    return (
      <div className="app">
        {loadFailed && (
          <div className="not-found" role="alert" data-testid="page-not-found">
            <h1>页面不存在</h1>
            <p>
              没有找到 <code>{route.name === 'page' ? route.id : ''}</code> 对应的页面。
              它可能已被删除，或链接不完整。
            </p>
            <button type="button" className="btn btn-primary" data-testid="page-not-found-home" onClick={goHome}>
              返回首页
            </button>
          </div>
        )}
        <HomeView
          onOpen={async (id) => {
            await pageState.open(id)
            navigate({ name: 'page', id })
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <CommandBar
        page={pageState.page}
        saving={pageState.saving}
        onHome={goHome}
        onRename={(name) => void pageState.rename(name)}
        onStyle={(patch) => void pageState.setStyle(patch)}
        onSettings={() => setSettingsOpen(true)}
      />

      {pageState.error && (
        <div className="persist-error" role="alert">
          {pageState.error}
        </div>
      )}

      <div className="app-body">
        <MathBoard
          store={store}
          theme={pageState.page?.style.theme ?? 'light'}
          grid={pageState.page?.style.grid ?? 'ruled'}
          size={pageState.page?.style.size}
          page={pageState.page}
          phase={pageState.phase}
          grading={pageState.page?.grading ?? null}
          submittedAt={pageState.page?.submittedAt ?? null}
          onFormula={(latex) => pageState.setFormula(latex)}
          onSubmit={() => void beginSubmit()}
          onContinue={pageState.continueWriting}
          onMockGrade={pageState.setGradingLocal}
          onEditor={handleEditor}
          onClear={handleClear}
        />
      </div>

      <GradePreview
        open={!!preview}
        url={preview?.url ?? null}
        width={preview?.w ?? 0}
        height={preview?.h ?? 0}
        busy={submitting}
        onConfirm={() => void confirmSubmit()}
        onCancel={cancelPreview}
      />

      <PageSettings
        open={settingsOpen}
        pageId={pageState.page?.id ?? ''}
        formula={pageState.page?.formula ?? null}
        phase={pageState.phase}
        tokenJti={pageState.tokenJti}
        onIssueToken={pageState.issueToken}
        onRevokeToken={pageState.revokeToken}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
