// Input cleaning + the shared error type. Everything that crosses the wire
// goes through here before it reaches SQL.

export const ALLOWED_THEME = ['light', 'dark'] as const
export const ALLOWED_GRID = ['none', 'lines', 'ruled', 'dots', 'crosses', 'iso'] as const
export const ALLOWED_SIZE_PRESET = ['default', 'a4', 'a5', 'letter', 'custom'] as const

export type PageTheme = (typeof ALLOWED_THEME)[number]
export type PageGrid = (typeof ALLOWED_GRID)[number]
export type PageSizePreset = (typeof ALLOWED_SIZE_PRESET)[number]

/**
 * Logical page rectangle in Quickdraw page px. Quickdraw itself is an infinite
 * canvas — this is a boundary the app draws and frames to, not an engine
 * concept. `preset: 'default'` means no boundary at all, and omits w/h.
 */
export interface PageSize {
  preset: PageSizePreset
  w?: number
  h?: number
}

/**
 * Per-page presentation. Kept as a JSON column rather than typed SQL columns
 * because the set of knobs is still growing — add the key to the whitelist
 * below and the schema doesn't move.
 */
export interface PageStyle {
  theme?: PageTheme
  grid?: PageGrid
  size?: PageSize
}

/**
 * Bounds on a custom page size. Below MIN the paper is unusable for
 * handwriting; above MAX the export canvas and the drawn frame both get silly.
 */
export const MIN_PAGE_PX = 200
export const MAX_PAGE_PX = 8000

export interface Camera {
  x: number
  y: number
  z: number
}

/** The four verdicts an agent can return. Kept small so the UI can map each to its own colour. */
export type GradingOverall = 'correct' | 'incorrect' | 'partial' | 'unreadable'

export const ALLOWED_OVERALL: readonly GradingOverall[] = ['correct', 'incorrect', 'partial', 'unreadable']

/**
 * The grading agent's result. Written by an external party, so every field is
 * normalised on the way in (see sanitizeGrading) rather than trusted.
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

/**
 * Ceiling on the free-text grading fields. Same order of magnitude as
 * MAX_FORMULA_CHARS: long enough for a full worked solution, short enough
 * that a runaway agent cannot bloat the row.
 */
export const MAX_GRADING_CHARS = 8000

/** Ceiling on an uploaded submission snapshot. PNG, raw bytes. */
export const MAX_SUBMISSION_BYTES = 6 * 1024 * 1024


export const BLANK_SNAPSHOT: Record<string, unknown> = { document: { store: {} } }
export const DEFAULT_STYLE: PageStyle = { theme: 'light', grid: 'ruled' }

/**
 * Ceiling on a page's LaTeX source. Generous enough for a multi-line
 * derivation, small enough that the column never carries anything else.
 */
export const MAX_FORMULA_CHARS = 8000

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const badRequest = (message: string) => new HttpError(400, 'BAD_REQUEST', message)

/**
 * Whitelist a size. A non-default preset must carry usable dimensions — a
 * page that claims to be A4 but has no width would render as no page at all.
 */
export function sanitizeSize(raw: unknown, path = 'style.size'): PageSize {
  if (raw === undefined) return { preset: 'default' }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest(`${path} 必须是对象`)
  }
  const src = raw as Record<string, unknown>
  const preset = src.preset
  if (!ALLOWED_SIZE_PRESET.includes(preset as PageSizePreset)) {
    throw badRequest(`${path}.preset 非法`)
  }
  const p = preset as PageSizePreset
  if (p === 'default') return { preset: 'default' }

  const dim = (v: unknown, k: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${path}.${k} 必须是有限数字`)
    const n = Math.round(v)
    if (n < MIN_PAGE_PX) throw badRequest(`${path}.${k} 不能小于 ${MIN_PAGE_PX}px（当前 ${n}）`)
    if (n > MAX_PAGE_PX) throw badRequest(`${path}.${k} 不能大于 ${MAX_PAGE_PX}px（当前 ${n}）`)
    return n
  }
  return { preset: p, w: dim(src.w, 'w'), h: dim(src.h, 'h') }
}

/**
 * Whitelist a style object. Unknown keys are dropped (the frontend may be
 * ahead of us), illegal enum values are a hard 400.
 */
export function sanitizeStyle(raw: unknown, path = 'style'): PageStyle {
  if (raw === undefined) return {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest(`${path} 必须是对象`)
  }
  const src = raw as Record<string, unknown>
  const out: PageStyle = {}
  if ('theme' in src) {
    if (!ALLOWED_THEME.includes(src.theme as PageTheme)) throw badRequest(`${path}.theme 非法`)
    out.theme = src.theme as PageTheme
  }
  if ('grid' in src) {
    if (!ALLOWED_GRID.includes(src.grid as PageGrid)) throw badRequest(`${path}.grid 非法`)
    out.grid = src.grid as PageGrid
  }
  if ('size' in src) out.size = sanitizeSize(src.size)
  return out
}

export function sanitizeCamera(raw: unknown): Camera | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('camera 必须是对象')
  const { x, y, z } = raw as Record<string, unknown>
  for (const [k, v] of Object.entries({ x, y, z })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`camera.${k} 必须是有限数字`)
  }
  return { x: x as number, y: y as number, z: z as number }
}

/** Accept any plain object; the engine owns the snapshot's inner shape. */
export function sanitizeSnapshot(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return BLANK_SNAPSHOT
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('snapshot 必须是对象')
  return raw as Record<string, unknown>
}

export function sanitizeName(raw: unknown): string {
  if (raw === undefined) return '未命名'
  if (typeof raw !== 'string') throw badRequest('name 必须是字符串')
  return raw.trim() || '未命名'
}

/**
 * Whitelist a formula. The content is LaTeX source for KaTeX and is stored
 * verbatim — never escaped, never rewritten: the client owns how it renders,
 * and escaping here would corrupt the source on the way back out. The only
 * normalisation is that whitespace-only collapses to null (no formula).
 */
export function sanitizeFormula(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw badRequest('formula 必须是字符串或 null')
  const text = raw.trim()
  if (!text) return null
  if (raw.length > MAX_FORMULA_CHARS) {
    throw badRequest(`formula 过长：上限 ${MAX_FORMULA_CHARS} 字符（当前 ${raw.length}）`)
  }
  return raw
}

/**
 * Normalise an agent-supplied grading result. The agent is an untrusted
 * producer running in someone else's browser: every field is coerced to a
 * sane value rather than rejected, because a half-usable report is still
 * worth showing and a 400 would just make the agent retry blindly.
 *
 * `gradedAt` is always the server clock — the agent's clock means nothing here.
 */
export function sanitizeGrading(raw: unknown): GradingResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('grading 必须是对象或 null')
  }
  const src = raw as Record<string, unknown>

  const readable = typeof src.readable === 'boolean' ? src.readable : true

  let overall: GradingOverall
  if (ALLOWED_OVERALL.includes(src.overall as GradingOverall)) {
    overall = src.overall as GradingOverall
  } else {
    overall = readable ? 'incorrect' : 'unreadable'
  }

  const text = (v: unknown): string => {
    const s = typeof v === 'string' ? v : ''
    return s.length > MAX_GRADING_CHARS ? s.slice(0, MAX_GRADING_CHARS) : s
  }

  let firstError: GradingResult['firstError'] = null
  const fe = src.firstError
  if (fe && typeof fe === 'object' && !Array.isArray(fe)) {
    const f = fe as Record<string, unknown>
    // Both halves must be present — a description with no correction is not
    // actionable, and vice versa.
    if (typeof f.description === 'string' && typeof f.correction === 'string') {
      firstError = {
        description: f.description.slice(0, MAX_GRADING_CHARS),
        correction: f.correction.slice(0, MAX_GRADING_CHARS),
      }
    }
  }

  return {
    readable,
    overall,
    transcription: text(src.transcription),
    firstError,
    correctSolution: text(src.correctSolution),
    teacherComment: text(src.teacherComment),
    gradedAt: Date.now(),
  }
}

// ---- reading back out of D1 (never throws: bad rows degrade, not 500) ------

export function coerceStyle(text: string | null): PageStyle {
  if (!text) return {}
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: PageStyle = {}
    if (ALLOWED_THEME.includes(raw.theme as PageTheme)) out.theme = raw.theme as PageTheme
    if (ALLOWED_GRID.includes(raw.grid as PageGrid)) out.grid = raw.grid as PageGrid
    // Never throws: a row with a stale/oversized size degrades to "no page
    // boundary" rather than taking the whole page down with it.
    if (raw.size && typeof raw.size === 'object' && !Array.isArray(raw.size)) {
      const s = raw.size as Record<string, unknown>
      if (ALLOWED_SIZE_PRESET.includes(s.preset as PageSizePreset)) {
        const preset = s.preset as PageSizePreset
        if (preset === 'default') {
          out.size = { preset }
        } else {
          const w = Math.round(Number(s.w))
          const h = Math.round(Number(s.h))
          if (
            Number.isFinite(w) && Number.isFinite(h) &&
            w >= MIN_PAGE_PX && w <= MAX_PAGE_PX &&
            h >= MIN_PAGE_PX && h <= MAX_PAGE_PX
          ) {
            out.size = { preset, w, h }
          }
        }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function coerceCamera(text: string | null): Camera | null {
  if (!text) return null
  try {
    const raw = JSON.parse(text)
    if (!raw || typeof raw !== 'object') return null
    const { x, y, z } = raw as Record<string, unknown>
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
    return { x, y, z }
  } catch {
    return null
  }
}

/** A snapshot that isn't `{ document: { store: {...} } }` opens blank. */
export function coerceSnapshot(text: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(text)
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as { document?: unknown }).document &&
      typeof (raw as { document: unknown }).document === 'object' &&
      ((raw as { document: { store?: unknown } }).document.store as unknown) &&
      typeof (raw as { document: { store: unknown } }).document.store === 'object'
    ) {
      return raw as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return BLANK_SNAPSHOT
}

/**
 * Read a stored grading back out. Never throws and never 500s: a row whose
 * grading JSON was corrupted by hand, by an older deploy or by a bad agent
 * degrades to "no grading" so the page still opens. This repo has already
 * been taken down once by a single dirty shape — the same mistake in a
 * column an external party writes would be indefensible.
 */
export function coerceGrading(text: string | null): GradingResult | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>

  if (!ALLOWED_OVERALL.includes(src.overall as GradingOverall)) return null
  if (typeof src.readable !== 'boolean') return null

  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  let firstError: GradingResult['firstError'] = null
  const fe = src.firstError
  if (fe && typeof fe === 'object' && !Array.isArray(fe)) {
    const f = fe as Record<string, unknown>
    if (typeof f.description === 'string' && typeof f.correction === 'string') {
      firstError = { description: f.description, correction: f.correction }
    }
  }

  return {
    readable: src.readable,
    overall: src.overall as GradingOverall,
    transcription: str(src.transcription),
    firstError,
    correctSolution: str(src.correctSolution),
    teacherComment: str(src.teacherComment),
    gradedAt: typeof src.gradedAt === 'number' && Number.isFinite(src.gradedAt) ? src.gradedAt : 0,
  }
}
