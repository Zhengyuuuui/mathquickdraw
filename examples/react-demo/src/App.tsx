// App shell: a home screen of saved pages, and the board behind its own URL.
//
// Owns the Quickdraw Store (so usePage can load/save snapshots) and the
// route. It never imports a concrete AI adapter and never reaches into
// Quickdraw's internals; the only editor surface it touches is `clearBoard`.

import { useCallback, useEffect, useRef } from 'react'
import { useQuickdrawStore } from '@quickdrawjs/react'
import type { Editor } from '@quickdrawjs/react'
import { CommandBar } from './components/CommandBar.tsx'
import { HomeView } from './components/HomeView.tsx'
import { MathBoard } from './components/MathBoard.tsx'
import { usePage } from './hooks/usePage.ts'
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
          onFormula={(latex) => pageState.setFormula(latex)}
          onEditor={handleEditor}
          onClear={handleClear}
        />
      </div>
    </div>
  )
}
