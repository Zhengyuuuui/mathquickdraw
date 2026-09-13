// The landing screen: every saved page, an AI formula card, and a way to
// start a new one.
//
// Owns its own list (fetched fresh on mount and after every mutation) rather
// than sharing state with usePage — usePage is board-scoped, this is not.
// Cards show a live backdrop preview only: the list endpoint deliberately
// returns metadata without snapshots, so there is no ink to thumbnail.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAIAdapter } from '../ai/adapter.ts'
import { pagesApi } from '../lib/api.ts'
import type { PageMeta, PageStyle } from '../lib/api.ts'
import { formatSize } from '../lib/pageSize.ts'
import { absTime, relTime } from '../lib/time.ts'
import { GridPreview, gridLabel } from './GridPreview.tsx'
import { NewPageDialog } from './NewPageDialog.tsx'

export interface HomeViewProps {
  /** Opens a page on the board. Resolves once the snapshot is loaded. */
  onOpen: (id: string) => Promise<void> | void
}

export function HomeView({ onOpen }: HomeViewProps) {
  const [pages, setPages] = useState<PageMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  // AI section state: the prompt, the in-flight flag, and its own error.
  const [prompt, setPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // Relative times are rendered against this clock, not Date.now(), so a tab
  // left open still ages "刚刚" into "3 分钟前" on its own.
  const [now, setNow] = useState(() => Date.now())
  /** Serialised so a double-click can't fire two loads into one store. */
  const busyRef = useRef(false)

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setPages(await pagesApi.list())
      setError(null)
    } catch (err) {
      setPages(null)
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleOpen = useCallback(
    async (id: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setOpeningId(id)
      try {
        await onOpen(id)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        busyRef.current = false
        setOpeningId(null)
      }
    },
    [onOpen, busyRef],
  )

  const handleCreate = useCallback(
    async (init: { name: string; style: PageStyle }) => {
      setCreating(true)
      setCreateError(null)
      try {
        const meta = await pagesApi.create(init)
        setDialogOpen(false)
        await onOpen(meta.id)
      } catch (err) {
        setCreateError((err as Error).message)
      } finally {
        setCreating(false)
      }
    },
    [onOpen],
  )

  const handleDelete = useCallback(
    async (page: PageMeta) => {
      if (!window.confirm(`删除「${page.name}」？此操作不可撤销。`)) return
      try {
        await pagesApi.remove(page.id)
        await refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [refresh],
  )

  // AI formula → create page → open it. A failed generation must not leave
  // an empty page behind, so create() only runs after the adapter resolves.
  const handleGenerate = useCallback(async () => {
    const text = prompt.trim()
    if (!text || aiBusy || busyRef.current) return
    setAiBusy(true)
    setAiError(null)
    try {
      const { latex, title } = await getAIAdapter().generateFormula(text)
      const meta = await pagesApi.create({
        name: title?.trim() || 'AI 出题',
        style: { theme: 'light', grid: 'ruled' },
        formula: latex,
      })
      setPrompt('')
      await onOpen(meta.id)
    } catch (err) {
      setAiError((err as Error).message)
    } finally {
      setAiBusy(false)
    }
  }, [prompt, aiBusy, onOpen])

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>数学手写答题</h1>
          <p>选一张纸开始，或新建一张。</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="home-new-page"
          onClick={() => {
            setCreateError(null)
            setDialogOpen(true)
          }}
        >
          新建页面
        </button>
      </header>

      {error && (
        <div className="home-error" role="alert">
          <p>{error}</p>
          <p className="home-error-hint">
            页面服务没有响应。确认后端已启动：<code>npm run dev:api</code>，
            并检查 <code>examples/react-demo/.env.local</code> 里的
            <code> VITE_API_BASE_URL</code> 与 <code>VITE_APP_TOKEN</code> 是否与
            <code> apps/api/.dev.vars</code> 一致。
          </p>
          <button type="button" className="btn" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}

      {!error && pages === null && <p className="home-muted">正在加载页面…</p>}

      {!error && pages?.length === 0 && (
        <div className="home-empty">
          <p>还没有任何页面。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCreateError(null)
              setDialogOpen(true)
            }}
          >
            新建第一张
          </button>
        </div>
      )}

      {!error && pages && pages.length > 0 && (
        <ul className="page-grid">
          {pages.map((p) => {
            const theme = p.style.theme ?? 'light'
            const grid = p.style.grid ?? 'none'
            return (
              <li
                key={p.id}
                className={`page-card${openingId === p.id ? ' is-opening' : ''}`}
                data-testid="page-card"
                data-page-id={p.id}
              >
                {/* Delete is a sibling, not a child: nesting one button inside
                    another is invalid HTML and makes the click order ambiguous. */}
                <button
                  type="button"
                  className="page-open"
                  data-testid="page-card-open"
                  disabled={openingId !== null}
                  aria-label={`打开 ${p.name}`}
                  onClick={() => void handleOpen(p.id)}
                >
                  <span className="page-shot">
                    <GridPreview grid={grid} theme={theme} width={248} height={156} cell={16} />
                  </span>
                  <span className="page-meta">
                    <span className="page-name" title={p.name}>
                      {p.name}
                    </span>
                    <span className="page-sub">
                      {gridLabel(grid)} · {theme === 'dark' ? '深色' : '浅色'}
                      {formatSize(p.style.size) ? ` · ${formatSize(p.style.size)}` : ''}
                    </span>
                    <span className="page-times">
                      <time dateTime={new Date(p.createdAt).toISOString()} title={new Date(p.createdAt).toLocaleString('zh-CN')}>
                        创建 {absTime(p.createdAt, now)}
                      </time>
                      <span className="page-times-dot" aria-hidden="true">·</span>
                      <time dateTime={new Date(p.updatedAt).toISOString()} title={new Date(p.updatedAt).toLocaleString('zh-CN')}>
                        {relTime(p.updatedAt, now)}修改
                      </time>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="page-del"
                  data-testid="page-card-delete"
                  aria-label={`删除 ${p.name}`}
                  title="删除页面"
                  disabled={openingId !== null}
                  onClick={() => void handleDelete(p)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <section className="ai-card" aria-label="AI 出题">
        <header className="ai-card-head">
          <h2>AI 出题</h2>
          <p>描述一道题，AI 生成公式并新建一页。</p>
        </header>
        <div className="ai-card-row">
          <input
            className="ai-prompt"
            data-testid="ai-prompt-input"
            value={prompt}
            placeholder="出一道高等数学极限题"
            maxLength={500}
            disabled={aiBusy}
            aria-label="AI 出题指令"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleGenerate()
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-testid="ai-generate"
            disabled={aiBusy || !prompt.trim()}
            onClick={() => void handleGenerate()}
          >
            {aiBusy ? '生成中…' : 'AI 出题并新建'}
          </button>
        </div>
        {aiError && (
          <p className="ai-error" role="alert">
            出题失败：{aiError}
          </p>
        )}
      </section>

      <NewPageDialog
        open={dialogOpen}
        busy={creating}
        error={createError}
        onCancel={() => {
          if (!creating) setDialogOpen(false)
        }}
        onCreate={handleCreate}
      />
    </div>
  )
}
