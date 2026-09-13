// Bindings declared in wrangler.jsonc + secrets from .dev.vars / `wrangler secret put`.
export interface Env {
  /** D1 database holding the `page` table. */
  DB: D1Database
  /** Shared secret every non-health request must echo in `X-App-Token`. */
  APP_TOKEN: string
  /** Sole origin allowed by CORS. Defaults to the Vite dev server. */
  ALLOWED_ORIGIN?: string
}
