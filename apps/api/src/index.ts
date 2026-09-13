// quickdraw-api — page CRUD, submission snapshots and per-page agent tokens.
// No framework: a `fetch` handler, CORS, two parallel auth paths and one
// error boundary.
//
// Auth model: this app has no user accounts. There is a global APP_TOKEN (the
// app itself) and per-page tokens handed to an external grading agent. They
// are parallel paths — the global token keeps every permission it always had;
// a page token is a narrow capability for exactly one page.

import type { Env } from './env'
import {
  clearPageTokenJti,
  createPage,
  deletePage,
  getPage,
  getPageTokenJti,
  getSubmissionImage,
  listPages,
  patchPage,
  saveSubmission,
  setPageTokenJti,
} from './pages'
import { signPageToken, verifyPageToken } from './pageToken'
import { HttpError, MAX_SUBMISSION_BYTES } from './validate'

const MAX_BODY_BYTES = 8 * 1024 * 1024
const PAGES = '/api/pages'

/** App token = everything. Page token = read one page, write its grading. */
type Auth = { kind: 'app' } | { kind: 'page'; pageId: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env)
    try {
      const { pathname } = new URL(request.url)

      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

      if (pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true }, 200, cors)
      }

      const { pageId, sub } = parsePagePath(pathname)

      const auth = await authenticate(request, env, pageId)
      if (!auth.ok) return error(401, auth.code, auth.message, cors)

      // A page token is a key for one door. Anything outside its allowlist is
      // a 403, not a 401 — the caller authenticated fine, it just may not.
      if (auth.auth.kind === 'page' && !pageTokenAllowed(request.method, pageId, auth.auth.pageId, sub)) {
        return error(403, 'FORBIDDEN', '每页 token 无权执行此操作', cors)
      }

      if (pathname === PAGES) {
        if (request.method === 'GET') return json(await listPages(env.DB), 200, cors)
        if (request.method === 'POST') {
          const page = await createPage(env.DB, await readJson(request))
          return json(page, 201, cors)
        }
      }

      if (pageId) {
        if (sub === 'token') {
          if (request.method === 'POST') return await issueToken(env, pageId, cors)
          if (request.method === 'DELETE') {
            await clearPageTokenJti(env.DB, pageId)
            return new Response(null, { status: 204, headers: cors })
          }
        }

        if (sub === 'submission') {
          if (request.method === 'POST') {
            const image = await readSubmission(request)
            const submittedAt = await saveSubmission(env.DB, pageId, image)
            if (submittedAt === null) return error(404, 'NOT_FOUND', '页面不存在', cors)
            return json({ submittedAt }, 200, cors)
          }
        }

        if (sub === 'submission.png') {
          if (request.method === 'GET') {
            const image = await getSubmissionImage(env.DB, pageId)
            if (!image) return error(404, 'NOT_FOUND', '该页还没有提交快照', cors)
            return png(image, cors)
          }
        }

        if (!sub) {
          if (request.method === 'GET') {
            const page = await getPage(env.DB, pageId)
            if (!page) return error(404, 'NOT_FOUND', '页面不存在', cors)
            return json(page, 200, cors)
          }
          if (request.method === 'PATCH') {
            const body = await readJson(request)
            // The whole point of a scoped token: it cannot rename a page,
            // rewrite its formula or replace the student's work.
            if (auth.auth.kind === 'page') stripToGrading(body)
            const page = await patchPage(env.DB, pageId, body)
            if (!page) return error(404, 'NOT_FOUND', '页面不存在', cors)
            return json(page, 200, cors)
          }
          if (request.method === 'DELETE') {
            await deletePage(env.DB, pageId)
            return new Response(null, { status: 204, headers: cors })
          }
        }
      }

      return error(404, 'NOT_FOUND', '未知路径', cors)
    } catch (err) {
      if (err instanceof HttpError) return error(err.status, err.code, err.message, cors)
      // Full stack goes to the Workers log; the client gets nothing useful.
      console.error('quickdraw-api unhandled error', err)
      return error(500, 'INTERNAL', '服务器内部错误', cors)
    }
  },
} satisfies ExportedHandler<Env>

// ---- routing ---------------------------------------------------------------

/** `/api/pages/<id>[/<sub>]` → { pageId, sub }. Anything else → both null. */
function parsePagePath(pathname: string): { pageId: string | null; sub: string | null } {
  if (!pathname.startsWith(`${PAGES}/`)) return { pageId: null, sub: null }
  const segs = pathname.slice(PAGES.length + 1).split('/')
  if (segs.length > 2) return { pageId: null, sub: null }
  let pageId: string
  try {
    pageId = decodeURIComponent(segs[0])
  } catch {
    return { pageId: null, sub: null }
  }
  if (!pageId) return { pageId: null, sub: null }
  return { pageId, sub: segs[1] ?? null }
}

/**
 * The entire permission surface of a per-page token. Kept as one function so
 * it can be read as a list — adding a route without thinking about this list
 * is how a scoped token silently becomes a global one.
 */
function pageTokenAllowed(method: string, pageId: string | null, tokenPageId: string, sub: string | null): boolean {
  // A token for page A is meaningless on page B.
  if (!pageId || pageId !== tokenPageId) return false
  if (!sub) return method === 'GET' || method === 'PATCH'
  if (sub === 'submission.png') return method === 'GET'
  return false
}

/** Drop every field a page token must not touch. Only `grading` survives. */
function stripToGrading(body: Record<string, unknown>): void {
  const banned = ['name', 'style', 'formula', 'snapshot', 'camera']
  const present = banned.filter((k) => k in body)
  if (present.length) {
    throw new HttpError(403, 'FORBIDDEN', `每页 token 只能修改 grading，不能修改：${present.join(', ')}`)
  }
}

// ---- auth ------------------------------------------------------------------

type AuthResult = { ok: true; auth: Auth } | { ok: false; code: string; message: string }

async function authenticate(request: Request, env: Env, pageId: string | null): Promise<AuthResult> {
  if (await authorizedApp(request, env)) return { ok: true, auth: { kind: 'app' } }

  const token = request.headers.get('X-Page-Token')
  if (!token) return { ok: false, code: 'UNAUTHORIZED', message: '缺少 X-App-Token 或 X-Page-Token' }

  if (!env.JWT_SECRET) {
    // Loud on purpose: silently accepting these would make a revoked-looking
    // token work, and silently rejecting them looks like a signing bug.
    console.warn('[quickdraw-api] 收到 X-Page-Token 但 JWT_SECRET 未设置，一律拒绝')
    return { ok: false, code: 'INVALID_PAGE_TOKEN', message: '服务端未配置 JWT_SECRET，每页 token 不可用' }
  }

  const payload = await verifyPageToken(token, env.JWT_SECRET)
  if (!payload) return { ok: false, code: 'INVALID_PAGE_TOKEN', message: '每页 token 无效或已过期' }
  if (pageId && payload.pageId !== pageId) {
    return { ok: false, code: 'INVALID_PAGE_TOKEN', message: '每页 token 与请求的页面不匹配' }
  }

  // Revocation: the JWT still verifies, but the page no longer names this jti.
  const live = await getPageTokenJti(env.DB, payload.pageId)
  if (!live || live !== payload.jti) {
    return { ok: false, code: 'INVALID_PAGE_TOKEN', message: '每页 token 已作废' }
  }

  return { ok: true, auth: { kind: 'page', pageId: payload.pageId } }
}

/** Constant-time token compare — a plain `===` leaks the secret by timing. */
async function authorizedApp(request: Request, env: Env): Promise<boolean> {
  const expected = env.APP_TOKEN
  const got = request.headers.get('X-App-Token')
  if (!expected || !got) return false
  const enc = new TextEncoder()
  const a = enc.encode(got)
  const b = enc.encode(expected)
  if (a.byteLength !== b.byteLength) return false
  return crypto.subtle.timingSafeEqual(a, b)
}

// ---- request bodies --------------------------------------------------------

async function readJson(request: Request): Promise<Record<string, unknown>> {
  // Reject on the declared length before touching the body.
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')
  if (!text.trim()) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', '请求体不是合法 JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'BAD_REQUEST', '请求体必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

/**
 * multipart/form-data with one `image` field. The size is checked twice: on
 * Content-Length before parsing, and on the decoded File before it becomes an
 * ArrayBuffer — the second is the one that actually protects the database.
 */
async function readSubmission(request: Request): Promise<ArrayBuffer> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  // multipart framing (boundary + part headers) sits on top of the file.
  if (declared > MAX_SUBMISSION_BYTES + 64 * 1024) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '快照图片过大')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', '请求体必须是 multipart/form-data')
  }

  const image = form.get('image')
  if (!(image instanceof File)) throw new HttpError(400, 'BAD_REQUEST', '缺少 image 文件字段')
  if (image.size > MAX_SUBMISSION_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '快照图片过大')
  if (image.size === 0) throw new HttpError(400, 'BAD_REQUEST', 'image 为空')
  return image.arrayBuffer()
}

// ---- responses -------------------------------------------------------------

function corsHeaders(env: Env): Headers {
  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || 'http://localhost:5173')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-App-Token, X-Page-Token')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Vary', 'Origin')
  return headers
}

function json(data: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { status, headers })
}

function error(status: number, code: string, message: string, cors: Headers): Response {
  return json({ error: { code, message } }, status, cors)
}

function png(bytes: Uint8Array, cors: Headers): Response {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'image/png')
  // A snapshot is immutable *until the page is re-submitted*, at which point
  // the bytes under this URL change. Callers that must see the newest one
  // should append a cache-buster (?v=<submittedAt>) — the agent gets a fresh
  // browser anyway, and long-caching keeps the student's board instant.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable')
  return new Response(bytes, { status: 200, headers })
}

async function issueToken(env: Env, pageId: string, cors: Headers): Promise<Response> {
  if (!env.JWT_SECRET) {
    console.warn('[quickdraw-api] 无法签发每页 token：JWT_SECRET 未设置')
    return error(500, 'INTERNAL', '服务端未配置 JWT_SECRET', cors)
  }
  const jti = crypto.randomUUID()
  // Persist first: a token that verifies but matches no jti is a confusing
  // failure mode, and there is no window where a signed token is unusable.
  if (!(await setPageTokenJti(env.DB, pageId, jti))) {
    return error(404, 'NOT_FOUND', '页面不存在', cors)
  }
  const { token } = await signPageToken(env.JWT_SECRET, pageId, jti)
  // The token is returned exactly once. It is not recoverable afterwards —
  // only the jti is stored, and that is just the revocation handle.
  return json({ token, jti }, 200, cors)
}
