// Per-page settings: the agent token, and the prompt panel.
//
// The token exists to *narrow* what an outside agent can do, not to protect
// the page. This app has no login — anyone with the URL can open the page.
// Saying so plainly matters more than a lock icon would.
//
// The token is re-displayable on purpose. Signing is a pure function of the
// server secret plus the page's stored jti, so nothing sensitive is kept and
// there is no "we showed it once, hope you copied it" race — a user who comes
// back tomorrow to hand it to a different agent gets the same string.

import { useCallback, useEffect, useState } from 'react'
import { pagesApi } from '../lib/api.ts'
import type { PagePhase } from '../hooks/usePage.ts'
import { AgentPanel } from './AgentPanel.tsx'

export interface PageSettingsProps {
  open: boolean
  pageId: string
  formula: string | null
  phase: PagePhase
  onIssueToken: () => Promise<string>
  onRevokeToken: () => Promise<void>
  onClose: () => void
}

interface LiveToken {
  token: string
  jti: string
}

export function PageSettings({
  open,
  pageId,
  formula,
  phase,
  onIssueToken,
  onRevokeToken,
  onClose,
}: PageSettingsProps) {
  const [live, setLive] = useState<LiveToken | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'token' | 'agent'>('token')

  // Load whatever is live whenever the dialog opens. The server is the only
  // source of truth — no jti cached in localStorage to go stale.
  useEffect(() => {
    if (!open || !pageId) return
    let cancelled = false
    setLoaded(false)
    setError(null)
    setCopied(false)
    void pagesApi
      .currentToken(pageId)
      .then((t) => {
        if (!cancelled) setLive(t)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, pageId])

  // Escape dismisses, matching every other dialog in the app. Without it the
  // scrim eats pointer events and the board underneath looks dead.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const issue = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await onIssueToken()
      setLive({ token, jti: '' })
      setCopied(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [onIssueToken])

  const revoke = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await onRevokeToken()
      setLive(null)
      setCopied(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [onRevokeToken])

  const copyToken = useCallback(async () => {
    if (!live) return
    try {
      await navigator.clipboard.writeText(live.token)
      setCopied(true)
    } catch {
      setError('复制失败，请手动选中下方文本复制')
    }
  }, [live])

  if (!open) return null

  return (
    <div className="dialog-scrim" role="presentation" onClick={onClose}>
      <div
        className="dialog page-settings"
        role="dialog"
        aria-modal="true"
        aria-label="页面设置"
        data-testid="page-settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>页面设置</h2>
          <button type="button" className="dialog-x" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'token'}
            className={`settings-tab${tab === 'token' ? ' is-on' : ''}`}
            onClick={() => setTab('token')}
          >
            Agent Token
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'agent'}
            className={`settings-tab${tab === 'agent' ? ' is-on' : ''}`}
            onClick={() => setTab('agent')}
          >
            Agent 指令
          </button>
        </div>

        {tab === 'token' ? (
          <div className="settings-body">
            {!loaded ? (
              <p className="token-none">读取中…</p>
            ) : live ? (
              <>
                <div className="token-row">
                  <code className="token-value" data-testid="token-value">
                    {live.token}
                  </code>
                  <button type="button" className="btn btn-primary" onClick={copyToken}>
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <p className="token-none">这个 token 长期有效，随时可以回来查看和复制。</p>
                <button
                  type="button"
                  className="btn"
                  data-testid="token-revoke"
                  disabled={busy}
                  onClick={revoke}
                >
                  {busy ? '处理中…' : '作废（立即失效）'}
                </button>
              </>
            ) : (
              <>
                <p className="token-none">这一页还没有 agent token。</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="token-generate"
                  disabled={busy}
                  onClick={issue}
                >
                  {busy ? '生成中…' : '生成 Token'}
                </button>
              </>
            )}

            {error && <p className="dialog-error" role="alert">{error}</p>}

            <p className="token-scope">
              这个 token <strong>只能读本页、只能写本页的批改结果</strong>：不能删页、不能改公式、
              不能改名字、不能看别的页。它限制的是 agent 的权限，<strong>不是页面的访问控制</strong> ——
              本应用目前没有用户登录，拿到 URL 就能打开这一页。不需要了就点「作废」，立即失效。
            </p>
          </div>
        ) : (
          <div className="settings-body">
            <AgentPanel phase={phase} pageId={pageId} formula={formula} />
          </div>
        )}
      </div>
    </div>
  )
}
