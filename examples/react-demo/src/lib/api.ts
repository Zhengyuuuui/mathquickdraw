// Thin fetch client for the pages API (apps/api). Types below mirror the
// Worker contract one-for-one — change them together.

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787'
const TOKEN = import.meta.env.VITE_APP_TOKEN ?? ''

export type PageTheme = 'light' | 'dark'
export type PageGrid = 'none' | 'lines' | 'ruled' | 'dots' | 'crosses' | 'iso'
export type PageSizePreset = 'default' | 'a4' | 'a5' | 'letter' | 'custom'

/**
 * Logical page rectangle in page px. Quickdraw is an infinite canvas; this is
 * a boundary the app draws and frames to. `preset: 'default'` = no boundary,
 * and omits w/h.
 */
export interface PageSize {
  preset: PageSizePreset
  w?: number
  h?: number
}

/** Per-page presentation. Server whitelists keys; unknown ones are dropped. */
export interface PageStyle {
  theme?: PageTheme
  grid?: PageGrid
  size?: PageSize
}

export interface Camera {
  x: number
  y: number
  z: number
}

/** The four verdicts a grading agent can return. */
export type GradingOverall = 'correct' | 'incorrect' | 'partial' | 'unreadable'

/**
 * The grading agent's report. Produced outside this app, so the server
 * normalises it on the way in — treat every field as possibly nonsense and
 * render defensively.
 */
export interface GradingResult {
  readable: boolean
  overall: GradingOverall
  transcription: string
  firstError: { description: string; correction: string } | null
  correctSolution: string
  teacherComment: string
  gradedAt: number
}

export interface PageMeta {
  id: string
  name: string
  style: PageStyle
  /** Raw LaTeX for the side column — null when the page has no formula. */
  formula: string | null
  createdAt: number
  updatedAt: number
}

export interface PageRecord extends PageMeta {
  camera: Camera | null
  snapshot: unknown
  submittedAt: number | null
  grading: GradingResult | null
}

export interface CreatePageInput {
  name: string
  style: PageStyle
  snapshot: unknown
  formula?: string | null
}

/** Partial update — only the keys you send move. `style` is a shallow merge. */
export interface PagePatch {
  name?: string
  style?: PageStyle
  camera?: Camera | null
  snapshot?: unknown
  /** Explicit null clears the formula. */
  formula?: string | null
  /** Explicit null clears the grading — that is how a re-submit retires it. */
  grading?: GradingResult | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // Token travels in the header only — never in a request body.
        'X-App-Token': TOKEN,
        ...init?.headers,
      },
    })
  } catch (err) {
    throw new Error(`无法连接页面服务（${BASE}）：${(err as Error).message}`)
  }

  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const pagesApi = {
  list: (): Promise<PageMeta[]> => request('/api/pages'),

  get: (id: string): Promise<PageRecord> => request(`/api/pages/${encodeURIComponent(id)}`),

  create: (init?: Partial<CreatePageInput>): Promise<PageMeta> =>
    request('/api/pages', { method: 'POST', body: JSON.stringify(init ?? {}) }),

  patch: (id: string, patch: PagePatch, init?: RequestInit): Promise<PageMeta> =>
    request(`/api/pages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      // spread last so a caller can pass `keepalive: true` — the flush that
      // runs as the tab goes away must outlive the page
      ...init,
    }),

  remove: (id: string): Promise<void> =>
    request(`/api/pages/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Upload the frozen answer sheet. multipart, not JSON — the body is PNG
   * bytes and base64 would cost a third more for nothing.
   */
  submit: async (id: string, image: Blob): Promise<{ submittedAt: number }> => {
    const form = new FormData()
    form.append('image', image, 'submission.png')
    let res: Response
    try {
      res = await fetch(`${BASE}/api/pages/${encodeURIComponent(id)}/submission`, {
        method: 'POST',
        // No Content-Type: the browser must set the multipart boundary itself.
        headers: { 'X-App-Token': TOKEN },
        body: form,
      })
    } catch (err) {
      throw new Error(`无法连接页面服务（${BASE}）：${(err as Error).message}`)
    }
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return (await res.json()) as { submittedAt: number }
  },

  /**
   * The snapshot bytes. Authenticated, so this cannot be an <img src> — the
   * caller turns the blob into an object URL. `v` busts the year-long
   * immutable cache the server sets: re-submitting changes the bytes under
   * the same URL, and a stale frozen sheet is worse than a slow one.
   */
  submissionPng: async (id: string, v?: number): Promise<Blob> => {
    const qs = v === undefined ? '' : `?v=${v}`
    let res: Response
    try {
      res = await fetch(`${BASE}/api/pages/${encodeURIComponent(id)}/submission.png${qs}`, {
        headers: { 'X-App-Token': TOKEN },
      })
    } catch (err) {
      throw new Error(`无法连接页面服务（${BASE}）：${(err as Error).message}`)
    }
    if (!res.ok) throw new Error(await readErrorMessage(res))
    return res.blob()
  },

  /** Mint a per-page agent token. Returned once — it is not recoverable. */
  issueToken: (id: string): Promise<{ token: string; jti: string }> =>
    request(`/api/pages/${encodeURIComponent(id)}/token`, { method: 'POST' }),

  revokeToken: (id: string): Promise<void> =>
    request(`/api/pages/${encodeURIComponent(id)}/token`, { method: 'DELETE' }),
}

async function readErrorMessage(res: Response): Promise<string> {
  let message = `请求失败（HTTP ${res.status}）`
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body?.error?.message) message = body.error.message
  } catch {
    // non-JSON error body — keep the generic message
  }
  return message
}

/** Where the API lives, for agent prompts that must name an absolute URL. */
export const API_BASE = BASE
