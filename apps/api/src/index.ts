// quickdraw-api — page CRUD for the math answer board.
// Two route shapes, six verbs, no framework: a `fetch` handler, CORS, a
// constant-time token check, and one error boundary.

import type { Env } from './env'
import { createPage, deletePage, getPage, listPages, patchPage } from './pages'
import { HttpError } from './validate'

const MAX_BODY_BYTES = 8 * 1024 * 1024
const PAGES = '/api/pages'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env)
    try {
      const { pathname } = new URL(request.url)

      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

      if (pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true }, 200, cors)
      }

      if (!(await authorized(request, env))) {
        return error(401, 'UNAUTHORIZED', '缺少或错误的 X-App-Token', cors)
      }

      if (pathname === PAGES) {
        if (request.method === 'GET') return json(await listPages(env.DB), 200, cors)
        if (request.method === 'POST') {
          const page = await createPage(env.DB, await readJson(request))
          return json(page, 201, cors)
        }
      }

      if (pathname.startsWith(`${PAGES}/`)) {
        const id = decodeURIComponent(pathname.slice(PAGES.length + 1))
        if (!id || id.includes('/')) return error(404, 'NOT_FOUND', '页面不存在', cors)

        if (request.method === 'GET') {
          const page = await getPage(env.DB, id)
          if (!page) return error(404, 'NOT_FOUND', '页面不存在', cors)
          return json(page, 200, cors)
        }
        if (request.method === 'PATCH') {
          const page = await patchPage(env.DB, id, await readJson(request))
          if (!page) return error(404, 'NOT_FOUND', '页面不存在', cors)
          return json(page, 200, cors)
        }
        if (request.method === 'DELETE') {
          await deletePage(env.DB, id)
          return new Response(null, { status: 204, headers: cors })
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

// ---- helpers ---------------------------------------------------------------

function corsHeaders(env: Env): Headers {
  const headers = new Headers()
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || 'http://localhost:5173')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-App-Token')
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

/** Constant-time token compare — a plain `===` leaks the secret by timing. */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.APP_TOKEN
  const got = request.headers.get('X-App-Token')
  if (!expected || !got) return false
  const enc = new TextEncoder()
  const a = enc.encode(got)
  const b = enc.encode(expected)
  if (a.byteLength !== b.byteLength) return false
  return crypto.subtle.timingSafeEqual(a, b)
}

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
