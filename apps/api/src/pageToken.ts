// Per-page agent tokens: HS256 JWTs signed with Web Crypto.
//
// These are NOT user sessions — there is no user login in this app. They are
// a capability handed to an external grading agent so it can read exactly one
// page and write exactly one field, without holding the global APP_TOKEN that
// would let it delete pages or read everyone else's.
//
// No jsonwebtoken: it is ~3 statements of HMAC and a base64url, and a runtime
// dependency for that is a bad trade.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 30 days. Long enough that a grading session never expires mid-run. */
const TTL_SECONDS = 30 * 24 * 60 * 60

export interface PageTokenPayload {
  pageId: string
  scope: 'agent'
  jti: string
  iat: number
  exp: number
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Sign a token for one page. The caller persists `jti` — that is the revocation handle. */
export async function signPageToken(
  secret: string,
  pageId: string,
  jti: string,
): Promise<{ token: string; payload: PageTokenPayload }> {
  const iat = Math.floor(Date.now() / 1000)
  const payload: PageTokenPayload = { pageId, scope: 'agent', jti, iat, exp: iat + TTL_SECONDS }
  const head = b64urlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)))
  const key = await importKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${head}.${body}`))
  return { token: `${head}.${body}.${b64urlEncode(new Uint8Array(sig))}`, payload }
}

/**
 * Verify signature + expiry. Revocation (token_jti) and page binding are the
 * caller's job — they need the database and the request path.
 * Returns null on any malformation, bad signature or expiry.
 */
export async function verifyPageToken(
  token: string,
  secret: string,
): Promise<PageTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, sig] = parts

  let parsedHead: unknown
  let parsedBody: unknown
  try {
    parsedHead = JSON.parse(decoder.decode(b64urlDecode(head)))
    parsedBody = JSON.parse(decoder.decode(b64urlDecode(body)))
  } catch {
    return null
  }
  if (
    !parsedHead ||
    (parsedHead as { alg?: unknown }).alg !== 'HS256' ||
    !parsedBody ||
    typeof parsedBody !== 'object'
  ) {
    return null
  }

  const key = await importKey(secret)
  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      encoder.encode(`${head}.${body}`),
    )
  } catch {
    // malformed base64 in the signature segment
    return null
  }
  if (!valid) return null

  const p = parsedBody as Partial<PageTokenPayload>
  if (typeof p.pageId !== 'string' || !p.pageId) return null
  if (p.scope !== 'agent') return null
  if (typeof p.jti !== 'string' || !p.jti) return null
  if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null
  return p as PageTokenPayload
}
