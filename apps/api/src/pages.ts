// The five page handlers. Every statement is a prepared D1 query — nothing
// here concatenates SQL.

import {
  BLANK_SNAPSHOT,
  DEFAULT_STYLE,
  coerceCamera,
  coerceSnapshot,
  coerceStyle,
  sanitizeCamera,
  sanitizeFormula,
  sanitizeName,
  sanitizeSnapshot,
  sanitizeStyle,
  type Camera,
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
}

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
    .prepare('SELECT * FROM page WHERE id = ?1 AND deleted_at IS NULL')
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
