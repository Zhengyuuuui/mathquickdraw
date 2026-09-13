// Bindings declared in wrangler.jsonc + secrets from .dev.vars / `wrangler secret put`.
export interface Env {
  /** D1 database holding the `page` table. */
  DB: D1Database
  /** Shared secret every non-health request must echo in `X-App-Token`. */
  APP_TOKEN: string
  /**
   * HMAC secret for per-page agent tokens. Absent = every X-Page-Token fails
   * (logged, never silently allowed) — the tokens are useless without it.
   */
  JWT_SECRET?: string
  /** Sole origin allowed by CORS. Defaults to the Vite dev server. */
  ALLOWED_ORIGIN?: string
}
