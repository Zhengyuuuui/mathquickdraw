// Per-page agent tokens.
//
// These are NOT user sessions — there is no user login in this app. They are
// a capability handed to an external grading agent so it can read exactly one
// page and write exactly one field, without holding the global APP_TOKEN that
// would let it delete pages or read everyone else's.
//
// Format: `qd1.<pageId>.<jti>.<sig>`, sig = base64url(HMAC-SHA256("qd1.pageId.jti")).
//
// Deliberately not a JWT. A JWT's one real advantage is verifying without a
// database lookup, and that buys nothing here: revocation is "does this page
// still name this jti", which needs the row either way. What a JWT would cost
// is ~160 characters of base64 header+payload on every token a human has to
// copy and paste.
//
// Also deliberately not expiring. The signature covers only pageId and jti,
// so the same pair always re-derives the same string — which is what lets the
// settings dialog show a live token again instead of "we showed it once,
// hope you copied it". Lifetime is controlled by revocation, not a clock.

const encoder = new TextEncoder()

/** Bumped only if the format itself changes; part of the signed message. */
const VERSION = 'qd1'

/** Revocation handle. 16 hex chars = 64 bits — far past collision risk. */
export function newJti(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await importKey(secret)
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return b64urlEncode(new Uint8Array(mac))
}

/** Constant-time compare — a plain `===` on a signature leaks by timing. */
function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  if (x.byteLength !== y.byteLength) return false
  return crypto.subtle.timingSafeEqual(x, y)
}

/**
 * Derive the token for one page + jti. Deterministic: calling it twice with
 * the same inputs returns the same string, so the client can re-display a
 * live token without us ever having stored it.
 */
export async function signPageToken(secret: string, pageId: string, jti: string): Promise<string> {
  return `${VERSION}.${pageId}.${jti}.${await sign(secret, `${VERSION}.${pageId}.${jti}`)}`
}

export interface VerifiedPageToken {
  pageId: string
  jti: string
}

/**
 * Check shape + signature. Whether that jti is still the page's live one is
 * the caller's job — it needs the database.
 */
export async function verifyPageToken(token: string, secret: string): Promise<VerifiedPageToken | null> {
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [version, pageId, jti, sig] = parts
  if (version !== VERSION) return null
  // Page ids are [a-z0-9] (or legacy `p_<uuid>`); jtis are hex. Anything else
  // is either a typo or someone probing, and both should fail the same way.
  if (!/^[a-z0-9_-]{1,64}$/.test(pageId)) return null
  if (!/^[0-9a-f]{8,32}$/.test(jti)) return null
  if (!safeEqual(sig, await sign(secret, `${VERSION}.${pageId}.${jti}`))) return null
  return { pageId, jti }
}
