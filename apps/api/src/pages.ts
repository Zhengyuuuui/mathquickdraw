// The five page handlers. Every statement is a prepared D1 query — nothing
// here concatenates SQL.

import {
  BLANK_SNAPSHOT,
  DEFAULT_STYLE,
  coerceCamera,
  coerceGrading,
  coerceSnapshot,
  coerceStyle,
  sanitizeCamera,
  sanitizeFormula,
  sanitizeGrading,
  sanitizeName,
  sanitizeSnapshot,
  sanitizeStyle,
  type Camera,
  type GradingResult,
  type PageStyle,
} from './validate'

export interface PageMeta {
  id: string
  name: string
  style: PageStyle
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

/**
 * Every column except submission_image. The BLOB is only ever read by the
 * .png endpoint — pulling it into every metadata SELECT would drag megabytes
 * across the wire to be thrown away.
 */
const PAGE_COLUMNS =
  'id, name, style, camera, snapshot, formula, created_at, updated_at, deleted_at, submitted_at, grading, token_jti'

interface PageRow {
  id: string
  name: string
  style: string
  camera: string | null
  snapshot: string
  formula: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
  submitted_at: number | null
  grading: string | null
  token_jti: string | null
}

type MetaRow = Pick<PageRow, 'id' | 'name' | 'style' | 'formula' | 'created_at' | 'updated_at'>

function toMeta(row: MetaRow): PageMeta {
  return {
    id: row.id,
    name: row.name,
    style: coerceStyle(row.style),
    // Stored verbatim; no parsing, so a bad formula is just un-renderable.
    formula: row.formula ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRecord(row: PageRow): PageRecord {
  return {
    ...toMeta(row),
    camera: coerceCamera(row.camera),
    snapshot: coerceSnapshot(row.snapshot),
    submittedAt: row.submitted_at ?? null,
    grading: coerceGrading(row.grading),
  }
}

/** Metadata only — the list endpoint must not drag snapshots around. */
export async function listPages(db: D1Database): Promise<PageMeta[]> {
  const { results } = await db
    .prepare(
      'SELECT id, name, style, formula, created_at, updated_at FROM page WHERE deleted_at IS NULL ORDER BY updated_at DESC',
    )
    .all<MetaRow>()
  return results.map(toMeta)
}

/**
 * Short, human-usable page ids: 11 chars from [a-z0-9]. Pages are addressed
 * directly in the URL (`/xxas23sadhj`), so the id has to be typable and
 * un-ambiguous. 36^11 ≈ 3.7e17, so the collision retry below is a formality.
 * Legacy `p_<uuid>` ids are untouched — routing just looks the path segment
 * up in the table, so both shapes resolve.
 */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 11

function shortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

async function newId(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = shortId()
    const clash = await db.prepare('SELECT 1 FROM page WHERE id = ?1').bind(id).first()
    if (!clash) return id
  }
  // Not worth failing a create over: fall back to a UUID-shaped id.
  return `p_${crypto.randomUUID()}`
}

async function readRow(db: D1Database, id: string): Promise<PageRow | null> {
  return db
    .prepare(`SELECT ${PAGE_COLUMNS} FROM page WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(id)
    .first<PageRow>()
}

export async function getPage(db: D1Database, id: string): Promise<PageRecord | null> {
  const row = await readRow(db, id)
  return row ? toRecord(row) : null
}

export async function createPage(db: D1Database, body: Record<string, unknown>): Promise<PageMeta> {
  const id = await newId(db)
  const name = sanitizeName(body.name)
  // Omitted style gets the product default; a provided style is used as-is
  // (whitelisted), so `{}` stays `{}` rather than being back-filled.
  const style = body.style === undefined ? { ...DEFAULT_STYLE } : sanitizeStyle(body.style)
  const camera = sanitizeCamera(body.camera)
  const snapshot = sanitizeSnapshot(body.snapshot)
  const formula = sanitizeFormula(body.formula)
  const now = Date.now()

  await db
    .prepare(
      'INSERT INTO page (id, name, style, camera, snapshot, formula, created_at, updated_at) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
    )
    .bind(
      id,
      name,
      JSON.stringify(style),
      camera ? JSON.stringify(camera) : null,
      JSON.stringify(snapshot === BLANK_SNAPSHOT ? BLANK_SNAPSHOT : snapshot),
      formula,
      now,
      now,
    )
    .run()

  return { id, name, style, formula, createdAt: now, updatedAt: now }
}

/**
 * Partial update: only the keys present in the body move, `updated_at` always
 * does. `style` is a shallow merge so the client can flip `grid` without
 * echoing `theme` back. Response is metadata — never the snapshot.
 */
export async function patchPage(
  db: D1Database,
  id: string,
  body: Record<string, unknown>,
): Promise<PageMeta | null> {
  const row = await readRow(db, id)
  if (!row) return null

  const sets: string[] = []
  const binds: unknown[] = []
  let n = 0
  const push = (clause: string, value: unknown) => {
    n += 1
    sets.push(clause.replace('?', `?${n}`))
    binds.push(value)
  }

  let style = coerceStyle(row.style)
  let name = row.name
  // `formula` is nullable in both directions: an explicit null clears it,
  // which is why presence in the body (not truthiness) drives the write.
  let formula = row.formula ?? null

  if ('name' in body) {
    name = sanitizeName(body.name)
    push('name = ?', name)
  }
  if ('style' in body) {
    style = { ...style, ...sanitizeStyle(body.style) }
    push('style = ?', JSON.stringify(style))
  }
  if ('camera' in body) {
    const camera = sanitizeCamera(body.camera)
    push('camera = ?', camera ? JSON.stringify(camera) : null)
  }
  if ('snapshot' in body) {
    push('snapshot = ?', JSON.stringify(sanitizeSnapshot(body.snapshot)))
  }
  if ('formula' in body) {
    formula = sanitizeFormula(body.formula)
    push('formula = ?', formula)
  }
  if ('grading' in body) {
    // null clears it — that is how "the agent found nothing worth reporting"
    // and "this grading is stale" are both expressed.
    const grading = body.grading === null || body.grading === undefined ? null : sanitizeGrading(body.grading)
    push('grading = ?', grading ? JSON.stringify(grading) : null)
  }

  const updatedAt = Date.now()
  push('updated_at = ?', updatedAt)

  await db
    .prepare(`UPDATE page SET ${sets.join(', ')} WHERE id = ?${n + 1} AND deleted_at IS NULL`)
    .bind(...binds, id)
    .run()

  return { id, name, style, formula, createdAt: row.created_at, updatedAt }
}

/** Soft delete. Deleting an already-deleted row is a no-op 204 (idempotent). */
export async function deletePage(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE page SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL')
    .bind(Date.now(), id)
    .run()
}

// ---- submission snapshot ---------------------------------------------------

/**
 * Store the frozen answer sheet. Re-submitting is the normal flow (student
 * fixes their work and hands it in again), so this deliberately overwrites:
 * one page has at most one live snapshot, and the old one is not worth
 * keeping — the grading that referred to it is being cleared in the same
 * statement, and a snapshot with no grading is dead weight.
 *
 * Returns the new submittedAt, or null when the page is gone.
 */
export async function saveSubmission(
  db: D1Database,
  id: string,
  image: ArrayBuffer,
): Promise<number | null> {
  const now = Date.now()
  const res = await db
    .prepare(
      'UPDATE page SET submitted_at = ?1, submission_image = ?2, grading = NULL, updated_at = ?1 ' +
        'WHERE id = ?3 AND deleted_at IS NULL',
    )
    .bind(now, image, id)
    .run()
  if (!res.meta.changes) return null
  return now
}

/**
 * Raw PNG bytes, or null when the page is missing or has never been submitted.
 *
 * D1 hands BLOB columns back as either an ArrayBuffer or a plain array of
 * byte values depending on the runtime, and `new Response(plainArray)`
 * silently produces an empty body. Normalise once, here.
 */
export async function getSubmissionImage(db: D1Database, id: string): Promise<Uint8Array | null> {
  const row = await db
    .prepare('SELECT submission_image FROM page WHERE id = ?1 AND deleted_at IS NULL')
    .bind(id)
    .first<{ submission_image: unknown }>()
  const value = row?.submission_image
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value as number[])
  return null
}

// ---- per-page agent token --------------------------------------------------

/** The jti of the page's live token, or null when none is issued. */
export async function getPageTokenJti(db: D1Database, id: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT token_jti FROM page WHERE id = ?1 AND deleted_at IS NULL')
    .bind(id)
    .first<{ token_jti: string | null }>()
  return row?.token_jti ?? null
}

/** Issue (or re-issue) a token. False when the page does not exist. */
export async function setPageTokenJti(db: D1Database, id: string, jti: string): Promise<boolean> {
  const res = await db
    .prepare('UPDATE page SET token_jti = ?1 WHERE id = ?2 AND deleted_at IS NULL')
    .bind(jti, id)
    .run()
  return res.meta.changes > 0
}

/**
 * Revoke. Clearing the jti kills the token without touching anything else —
 * the JWT itself stays cryptographically valid, it just matches nothing.
 * Idempotent: revoking twice is the same as once.
 */
export async function clearPageTokenJti(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE page SET token_jti = NULL WHERE id = ?1 AND deleted_at IS NULL')
    .bind(id)
    .run()
}
