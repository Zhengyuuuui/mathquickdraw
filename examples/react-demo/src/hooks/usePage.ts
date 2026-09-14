// Current-page state + debounced autosave for the Quickdraw store.
//
// Port of the localStorage prototype in apps/app/src/main.js (openFile /
// saveNow / the 400ms listen-debounce), pointed at apps/api instead. Two
// additions the prototype lacked: per-page style, and a camera restore.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Camera, Editor, Snapshot, Store } from '@quickdrawjs/react'
import { pagesApi } from '../lib/api.ts'
import { framePageCamera } from '../lib/pageSize.ts'
import type { GradingResult, PageMeta, PageRecord, PageStyle } from '../lib/api.ts'

const SAVE_DEBOUNCE_MS = 400
const FORMULA_DEBOUNCE_MS = 400

/**
 * Where the page is in the write → submit → grade loop. Purely derived —
 * storing it would let it drift from the fields it describes.
 *
 *   empty     no formula yet
 *   ready     formula, not submitted — writable
 *   submitted frozen, waiting on the agent
 *   graded    frozen, feedback in
 */
export type PagePhase = 'empty' | 'ready' | 'submitted' | 'graded'

export function phaseOf(page: PageView | null): PagePhase {
  if (!page) return 'empty'
  if (!page.formula) return 'empty'
  if (!page.submittedAt) return 'ready'
  return page.grading ? 'graded' : 'submitted'
}

/**
 * PageMeta plus the two fields only the detail endpoint carries. The list
 * endpoint deliberately omits them (no grading on a card, no megabyte
 * snapshots), so the board keeps its own wider view.
 */
export interface PageView extends PageMeta {
  submittedAt: number | null
  grading: GradingResult | null
}

export interface UsePageResult {
  page: PageView | null
  phase: PagePhase
  loading: boolean
  saving: boolean
  error: string | null
  /** Resolves true when the page is open, false when the load failed. */
  open: (id: string) => Promise<boolean>
  create: (init?: { name?: string; style?: PageStyle; formula?: string | null }) => Promise<PageMeta>
  rename: (name: string) => Promise<void>
  setStyle: (patch: Partial<PageStyle>) => Promise<void>
  /**
   * Commit the page's formula. Optimistic, debounced on its own timer so it
   * can never interleave with a snapshot PATCH mid-flight.
   */
  setFormula: (latex: string | null) => Promise<void>
  /** Upload the frozen sheet. Clears any previous grading. */
  submit: (image: Blob) => Promise<void>
  /**
   * Unlock the board again. Local only — the snapshot stays on the server as
   * the record of what was handed in, and a reload deliberately returns to
   * `submitted`. See the button's title.
   */
  continueWriting: () => void
  /** Dev-only: inject a grading without an agent, to exercise the UI. */
  setGradingLocal: (grading: GradingResult) => void
  /**
   * Rewrite just the reference solution. Grading is one JSON column, so this
   * PATCHes the whole object back with the new solution spliced in — the rest
   * of the agent's report is sent verbatim.
   */
  setSolution: (latex: string | null) => Promise<void>
  issueToken: () => Promise<string>
  revokeToken: () => Promise<void>
  /** Apply a camera deferred while the editor was still mounting. */
  syncCamera: () => void
  /**
   * Write the current page now, pending or not. Call before leaving the board
   * — panning changes the camera without a store diff, so nothing else would.
   * Also flushes an unsent formula commit.
   */
  persist: () => void
}

function toView(rec: PageRecord): PageView {  return {
    id: rec.id,
    name: rec.name,
    style: rec.style,
    formula: rec.formula,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    submittedAt: rec.submittedAt,
    grading: rec.grading,
  }
}

/**
 * How to frame a page that has no saved camera: show the whole sheet when it
 * has one, otherwise frame whatever ink it carries.
 */
function pageDirective(rec: PageRecord): 'fit' | { page: { w: number; h: number } } {
  const s = rec.style?.size
  if (s?.w && s.h) return { page: { w: s.w, h: s.h } }
  return 'fit'
}

export function usePage(store: Store, editorRef: { current: Editor | null }): UsePageResult {
  const [page, setPage] = useState<PageView | null>(null)
  // False until someone calls open() — nothing is loading on a fresh mount.
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pageRef = useRef<PageView | null>(null)
  pageRef.current = page

  /**
   * Adopt a metadata PATCH response. The list-shaped response carries no
   * submittedAt/grading, so it is merged over the current view rather than
   * replacing it — a rename must not make the page look un-submitted.
   */
  const adoptMeta = useCallback((meta: PageMeta) => {
    setPage((prev) => (prev && prev.id === meta.id ? { ...prev, ...meta } : prev))
  }, [])

  const saveTimer = useRef(0)
  const saveScheduled = useRef(false)
  // Formula commits ride their own timer + inflight promise: an independent
  // field must not share the snapshot's schedule, or a formula PATCH could
  // overwrite (or be overwritten by) an ink PATCH racing the same 400ms.
  const formulaTimer = useRef(0)
  const formulaInflight = useRef<Promise<void>>(Promise.resolve())
  const formulaPending = useRef<string | null | undefined>(undefined)
  const mounted = useRef(true)
  /**
   * Camera to apply to the loaded page: a saved `{x,y,z}`, or a directive —
   * `{ page }` frames that rectangle, 'fit' frames the ink. It is deliberately
   * NOT consumed on first apply — React StrictMode double-mounts the editor
   * in dev, and a one-shot ref would be eaten by the instance that is
   * immediately destroyed.
   */
  const loadedCamera = useRef<Camera | 'fit' | { page: { w: number; h: number } } | null>(null)
  /** Which Editor instance `loadedCamera` has already been applied to. */
  const appliedTo = useRef<Editor | null>(null)

  const syncCamera = useCallback(() => {
    const editor = editorRef.current
    const wanted = loadedCamera.current
    if (!editor || wanted === null) return
    if (appliedTo.current === editor) return // already framed this instance
    if (wanted === 'fit') {
      // Same rule as the prototype: only frame a page that actually has ink.
      if (editor.store.size > 0) editor.fitContent()
    } else if ('page' in wanted) {
      // A sized sheet opens showing the whole sheet, not whatever happens to
      // be drawn on it — an empty A4 page should still look like an A4 page.
      const cam = framePageCamera(editor.viewSize().w, editor.viewSize().h, wanted.page)
      if (cam) editor.setCamera(cam)
    } else {
      editor.setCamera(wanted)
    }
    appliedTo.current = editor
  }, [editorRef])

  // ---- autosave ------------------------------------------------------------

  /** The whole page state that must survive a reload: ink + where you were. */
  const pagePayload = useCallback(() => {
    const editor = editorRef.current
    return {
      snapshot: store.getSnapshot(),
      // Camera rides in the same PATCH as the ink — one request, and a reopen
      // lands exactly where you left off instead of jumping to fitContent.
      ...(editor ? { camera: { ...editor.camera } } : {}),
    }
  }, [store, editorRef])

  const saveSnapshot = useCallback(async () => {
    const id = pageRef.current?.id
    if (!id) return
    if (mounted.current) setSaving(true)
    try {
      await pagesApi.patch(id, pagePayload())
      if (mounted.current) setError(null)
    } catch (err) {
      // A failed save must not silence the listener — the next stroke retries.
      if (mounted.current) setError(`自动保存失败：${(err as Error).message}`)
    } finally {
      if (mounted.current) setSaving(false)
    }
  }, [pagePayload])

  /**
   * Persist the current page right now, pending or not. Panning moves the
   * camera without touching the store, so "something changed" isn't something
   * the diff listener can see — leaving a page has to write unconditionally.
   * `keepalive` because one caller is the tab going away.
   */
  const persistNow = useCallback(() => {
    const id = pageRef.current?.id
    if (!id) return
    window.clearTimeout(saveTimer.current)
    saveScheduled.current = false
    void pagesApi.patch(id, pagePayload(), { keepalive: true }).catch(() => {})
  }, [pagePayload])

  const scheduleSave = useCallback(() => {
    saveScheduled.current = true
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveScheduled.current = false
      void saveSnapshot()
    }, SAVE_DEBOUNCE_MS)
  }, [saveSnapshot])

  /** Cheap path for unmount: only hit the network if a save is outstanding. */
  const flushSave = useCallback(() => {
    if (saveScheduled.current) persistNow()
  }, [persistNow])

  // ---- formula commits -----------------------------------------------------

  /** Send one formula PATCH; resolves once the server has the value. */
  const commitFormula = useCallback(async (id: string, latex: string | null) => {
    const run = async () => {
      try {
        const meta = await pagesApi.patch(id, { formula: latex })
        if (mounted.current) {
          // Only adopt the response when it is still this page's row.
          if (pageRef.current?.id === id) adoptMeta(meta)
          setError(null)
        }
      } catch (err) {
        if (mounted.current) setError(`保存公式失败：${(err as Error).message}`)
      }
    }
    formulaInflight.current = formulaInflight.current.then(run, run)
    await formulaInflight.current
  }, [])

  const setFormula = useCallback(
    async (latex: string | null) => {
      const prev = pageRef.current
      if (!prev) return
      // Optimistic: the rendered formula should move the instant Enter is hit.
      setPage({ ...prev, formula: latex })
      window.clearTimeout(formulaTimer.current)
      formulaPending.current = latex
      const id = prev.id
      const flush = () => {
        const value = formulaPending.current
        formulaPending.current = undefined
        return commitFormula(id, value ?? null)
      }
      // Enter/focus-out commits come with a real wait anyway; the debounce
      // just collapses a commit that lands while another PATCH is inflight.
      await new Promise<void>((resolve) => {
        formulaTimer.current = window.setTimeout(() => {
          void flush().then(resolve)
        }, FORMULA_DEBOUNCE_MS)
      })
    },
    [commitFormula],
  )

  /** Fire any formula commit the debounce never sent (tab hiding, unmount). */
  const flushFormula = useCallback(() => {
    if (formulaPending.current === undefined) return
    const id = pageRef.current?.id
    if (!id) return
    window.clearTimeout(formulaTimer.current)
    const value = formulaPending.current
    formulaPending.current = undefined
    void commitFormula(id, value ?? null)
  }, [commitFormula])

  // 'user' only: a remote loadSnapshot must not write the page back to itself.
  useEffect(() => {
    mounted.current = true
    const off = store.listen(scheduleSave, { source: 'user' })
    return () => {
      off()
      mounted.current = false
      flushSave() // don't lose the last stroke to an unmount
      flushFormula() // nor a committed formula
    }
  }, [store, scheduleSave, flushSave, flushFormula])

  // The 400ms debounce must not outlive the tab. Draw a stroke or commit a
  // formula and hit reload and the timer simply never fires — flush on the
  // way out instead. `pagehide` covers reload/close; `visibilitychange`
  // covers iOS Safari, where pagehide is unreliable when backgrounding.
  useEffect(() => {
    const onHide = () => {
      persistNow()
      flushFormula()
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [persistNow, flushFormula])

  // ---- page ops ------------------------------------------------------------

  const open = useCallback(
    async (id: string): Promise<boolean> => {
      persistNow() // leaving a page — write its ink AND its camera, unconditionally
      flushFormula()
      setLoading(true)
      try {
        const rec = await pagesApi.get(id)
        store.loadSnapshot(rec.snapshot as Snapshot, 'remote')
        // Fresh page, fresh history — undo must not cross pages.
        store.undos.length = 0
        store.redos.length = 0
        loadedCamera.current = rec.camera ?? pageDirective(rec)
        appliedTo.current = null // a different page must re-frame the editor
        syncCamera()
        setPage(toView(rec))
        setError(null)
        return true
      } catch (err) {
        // The caller (App) decides what a failed open looks like; clearing
        // the stale page here keeps the board from showing a previous page's
        // paper under a new URL.
        setPage(null)
        setError(`打开页面失败：${(err as Error).message}`)
        return false
      } finally {
        setLoading(false)
      }
    },
    [store, syncCamera, persistNow, flushFormula],
  )

  const create = useCallback(async (init?: { name?: string; style?: PageStyle; formula?: string | null }) => {
    const meta = await pagesApi.create(init)
    return meta
  }, [])

  const rename = useCallback(async (name: string) => {
    const id = pageRef.current?.id
    if (!id) return
    try {
      adoptMeta(await pagesApi.patch(id, { name }))
      setError(null)
    } catch (err) {
      setError(`重命名失败：${(err as Error).message}`)
    }
  }, [adoptMeta])

  const setStyle = useCallback(async (patch: Partial<PageStyle>) => {
    const prev = pageRef.current
    if (!prev) return
    // Optimistic: the canvas should move the instant the user picks a grid.
    setPage({ ...prev, style: { ...prev.style, ...patch } })
    try {
      adoptMeta(await pagesApi.patch(prev.id, { style: patch }))
      setError(null)
    } catch (err) {
      setPage(prev)
      setError(`保存样式失败：${(err as Error).message}`)
    }
  }, [adoptMeta])

  // ---- submit / grade ------------------------------------------------------

  const submit = useCallback(async (image: Blob) => {
    const prev = pageRef.current
    if (!prev) return
    // Write any outstanding ink first: the PNG was rendered from the canvas a
    // moment ago, and a stroke that landed after it must not be saved on top
    // of a snapshot that never contained it.
    persistNow()
    try {
      const { submittedAt } = await pagesApi.submit(prev.id, image)
      // Local grading is dropped with the old sheet — feedback about work
      // that has since changed is worse than no feedback.
      setPage({ ...prev, submittedAt, grading: null })
      setError(null)
    } catch (err) {
      setError(`提交失败：${(err as Error).message}`)
      throw err
    }
  }, [persistNow])

  const continueWriting = useCallback(() => {
    const prev = pageRef.current
    if (!prev?.submittedAt) return
    // Local only, on purpose: the uploaded snapshot is the record of what was
    // handed in and stays on the server. A reload therefore returns to
    // `submitted` — which is also how "re-submit" gets a fresh sheet.
    setPage({ ...prev, submittedAt: null })
  }, [])

  const setGradingLocal = useCallback((grading: GradingResult) => {
    const prev = pageRef.current
    if (!prev) return
    setPage({ ...prev, grading })
  }, [])

  const setSolution = useCallback(async (latex: string | null) => {
    const prev = pageRef.current
    if (!prev) return
    // No grading yet (page is submitted, agent has not reported): writing the
    // solution creates one. The verdict fields are placeholders — the point of
    // this path is the solution text, and the server requires the enum.
    const next: GradingResult = prev.grading
      ? { ...prev.grading, correctSolution: latex ?? '' }
      : {
          readable: true,
          overall: 'partial',
          transcription: '',
          firstError: null,
          correctSolution: latex ?? '',
          teacherComment: '',
          // Overwritten by the server clock; only here to satisfy the type.
          gradedAt: Date.now(),
        }
    // Optimistic: the rendered solution should move the instant Enter is hit.
    setPage({ ...prev, grading: next })
    try {
      await pagesApi.patch(prev.id, { grading: next })
      setError(null)
    } catch (err) {
      setPage(prev)
      setError(`保存答案失败：${(err as Error).message}`)
    }
  }, [])

  const issueToken = useCallback(async (): Promise<string> => {
    const id = pageRef.current?.id
    if (!id) throw new Error('没有打开的页面')
    const { token } = await pagesApi.issueToken(id)
    return token
  }, [])

  const revokeToken = useCallback(async () => {
    const id = pageRef.current?.id
    if (!id) return
    await pagesApi.revokeToken(id)
  }, [])

  // ---- bootstrap -----------------------------------------------------------
  // Deliberately none. The home screen owns the page list and calls `open()`;
  // auto-opening "the most recent page" here would skip the picker entirely.
  // With no page open, `page` is null and the autosave listener no-ops.

  return {
    page,
    phase: phaseOf(page),
    loading,
    saving,
    error,
    open,
    create,
    rename,
    setStyle,
    setFormula,
    submit,
    continueWriting,
    setGradingLocal,
    setSolution,
    issueToken,
    revokeToken,
    syncCamera,
    persist: persistNow,
  }
}
