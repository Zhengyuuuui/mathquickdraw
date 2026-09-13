// The formula column, left of the paper.
//
// Scheme B: the formula lives entirely outside the sheet — its own column in
// the app chrome, never a Quickdraw shape — so the paper stays 100% writable
// and PageFrame / usePageBoundary are untouched. KaTeX typesets the source;
// a broken formula shows the raw source plus a notice instead of crashing.

import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import type { GradingResult, PageMeta } from '../lib/api.ts'
import type { PagePhase } from '../hooks/usePage.ts'
import { GradingOverallBadge, GradingReport, GradingSolution } from './GradingReport.tsx'

export interface FormulaPanelProps {
  page: PageMeta | null
  phase: PagePhase
  grading: GradingResult | null
  onFormula: (latex: string | null) => Promise<void>
  onSubmit: () => void
  onContinue: () => void
  onSolution: (latex: string | null) => Promise<void>
}

/** Which side of the panel the tabs are showing. */
type PanelTab = 'question' | 'answer'

/** horizontal: the whole source as one math line; vertical: stacked blocks. */
type Layout = 'horizontal' | 'vertical'

const LAYOUT_KEY = 'quickdraw.formulaLayout'
function loadLayout(): Layout {
  try {
    // Vertical is the default: multi-formula content (AI dumps, pasted .tex)
    // is unreadable as one sideways line, and a first-time visitor with such
    // a page open would otherwise see a single clipped row.
    return localStorage.getItem(LAYOUT_KEY) === 'horizontal' ? 'horizontal' : 'vertical'
  } catch {
    return 'vertical'
  }
}

/** Panel width clamps: 200px floor, half the screen ceiling. */
const PANEL_MIN_PX = 200
const PANEL_KEY = 'quickdraw.formulaPanelWidth'

/** Widest the panel may get: half the viewport, and the paper keeps ≥320px. */
function maxPanelWidth(): number {
  return Math.max(PANEL_MIN_PX, Math.min(window.innerWidth / 2, window.innerWidth - 320))
}

function loadPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(PANEL_KEY))
    if (Number.isFinite(saved) && saved >= PANEL_MIN_PX && saved <= maxPanelWidth()) return saved
  } catch {
    // private mode — fall through to the default
  }
  return 300
}

/**
 * Strip document-level math delimiters. Real-world input (AI output, text
 * copied out of a .tex file) routinely wraps formulas in `\[ ... \]` or
 * `$$ ... $$`, but KaTeX only typesets the formula *body* — a leading `\[`
 * is an "Undefined control sequence" and the whole thing lands in the
 * broken-state bin. The lookbehind keeps `\\[6pt]` (a row-spacing break
 * inside cases/array) intact: that `\[` is preceded by another backslash
 * and is real LaTeX, not a delimiter.
 */
function stripMathDelimiters(src: string): string {
  let text = src.replace(/(?<!\\)\\\[|(?<!\\)\\\]/g, '')
  // $$...$$ pairs → newlines (the formulas between them still render).
  if ((text.match(/\$\$/g) ?? []).length >= 2) {
    text = text.replace(/\$\$/g, '\n')
  }
  return text
}

/**
 * Typeset one LaTeX string. Returns the HTML, or null when KaTeX cannot
 * parse it (the panel then falls back to the raw source). `throwOnError:
 * true` is deliberate: KaTeX with `false` swallows parse errors into red
 * text, but the requirement is raw source + a "cannot parse" notice.
 */
function typeset(latex: string): string | null {
  try {
    return katex.renderToString(stripMathDelimiters(latex), {
      displayMode: true,
      throwOnError: true,
      // keep the MathML twin for screen readers
      output: 'htmlAndMathml',
      strict: false,
    })
  } catch {
    return null
  }
}

/**
 * Split the source into blocks for vertical layout: blank lines separate
 * formulas (a document dump like `\f(a)\] \n\n 设 \n\n \[f(x)=…` becomes
 * one card per formula). A blank line inside an environment (\begin{cases}
 * … \end{cases}) is illegal LaTeX anyway, so this split never cuts one.
 */
function splitBlocks(src: string): string[] {
  return src
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
}

/**
 * Columns where a line may be wrapped, scanning with brace/environment
 * depth. Breaks are only offered at depth 0, and only where LaTeX means a
 * separation: after a depth-0 closing brace (`\text{…}` boundary — strong),
 * after punctuation followed by a space (`f(x)= …` — strong; a bare `,`
 * inside `(0,1)` or `1.5` is NOT a break), and at spaces (weak). Fraction
 * bodies and environment rows are never torn apart. An unbalanced fragment
 * (user mid-edit) simply yields no break columns and the line stays whole.
 */
function collectBreakCols(line: string): Array<{ pos: number; strong: boolean }> {
  const cols: Array<{ pos: number; strong: boolean }> = []
  let depth = 0
  let envDepth = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') {
      if (line.startsWith('\\begin', i)) {
        envDepth += 1
        i = line.indexOf('}', i)
        continue
      }
      if (line.startsWith('\\end', i)) {
        envDepth = Math.max(0, envDepth - 1)
        i = line.indexOf('}', i)
        continue
      }
      i += 1 // skip the command's first char; its braces are still counted
      continue
    }
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1)
      // depth-0 `}` ends an atom like \text{…}: break between atoms, but
      // never before a closing bracket/sub/prime that continues the atom
      if (depth === 0 && envDepth === 0 && i + 1 < line.length && !/[)\]_,^]/.test(line[i + 1])) {
        cols.push({ pos: i + 1, strong: true })
      }
      continue
    }
    if (depth === 0 && envDepth === 0) {
      // `=` breaks BEFORE the sign (math typesetting convention: the right
      // side of an equation starts the next row) regardless of spacing
      if (ch === '=' && i > 0) {
        cols.push({ pos: i, strong: true })
      } else if ((ch === ',' || ch === ';') && line[i + 1] === ' ') {
        // `,`/`;` only break when followed by a space — bare commas live
        // inside intervals like (0,1) and must stay glued
        cols.push({ pos: i + 1, strong: true })
      } else if (ch === ' ') {
        cols.push({ pos: i + 1, strong: false })
      }
    }
  }
  return cols
}

/** Split one source line into wrap candidates around the given width estimate. */
function breakLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line]
  const cols = collectBreakCols(line)
  if (cols.length === 0) return [line]
  const parts: string[] = []
  let start = 0
  while (line.length - start > maxChars) {
    const limit = start + maxChars
    const cands = cols.filter((c) => c.pos > start && c.pos <= limit)
    const strong = cands.filter((c) => c.strong)
    const pick = strong.length ? strong[strong.length - 1] : (cands.length ? cands[cands.length - 1] : null)
    if (!pick) break // no safe break inside — leave the rest whole
    parts.push(line.slice(start, pick.pos))
    start = pick.pos
  }
  parts.push(line.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * A block's source split into independently-renderable rows, in four passes:
 *
 *  1. keep the author's own non-empty lines;
 *  2. merge any line that fails to typeset into the next (a `\frac{…}`
 *     whose second `{…}` sits on the following line is syntactically
 *     incomplete alone — LaTeX authors split those freely);
 *  3. greedily re-join short rows while they still typeset together and
 *     fit the width budget (a `\lim` belongs with its `\frac`);
 *  4. re-split rows that exceed the budget at safe break columns.
 *
 * Each returned row typesets as its own math line, so a block too wide for
 * the panel grows taller and flows onto the next row instead of scrolling.
 */
function blockLines(src: string, wrapCols: number): string[] {
  const ts = (s: string): boolean => typeset(s) !== null

  const raw = src.split('\n').map((s) => s.trim()).filter(Boolean)
  // pass 2: syntax repair — an unbalanced row swallows the next one
  const repaired: string[] = []
  let buf = ''
  for (const line of raw) {
    buf = buf ? `${buf} ${line}` : line
    if (ts(buf)) {
      repaired.push(buf)
      buf = ''
    }
  }
  if (buf) repaired.push(buf)
  // pass 3: semantic re-join while the pair still typesets and fits
  const joined: string[] = []
  for (const line of repaired) {
    const prev = joined[joined.length - 1]
    if (prev && prev.length + line.length + 1 <= wrapCols && ts(`${prev} ${line}`) && ts(prev) && ts(line)) {
      joined[joined.length - 1] = `${prev} ${line}`
    } else {
      joined.push(line)
    }
  }
  // pass 4: width-driven re-split at safe columns
  return joined.flatMap((line) => breakLine(line, wrapCols))
}

/**
 * Per-layout content. Horizontal = one render call, the whole source as a
 * single math line (scrolls sideways, KaTeX decides breaks). Vertical = one
 * card per blank-line-separated block; each card renders its lines stacked,
 * so a card too wide for the column grows taller instead of scrolling. A
 * card whose source fails KaTeX still shows raw, so one bad line never
 * blanks the whole column.
 */
interface BlockView {
  key: number
  raw: string
  /** Whole-source render (used when the block parses as one piece). */
  html: string | null
  /** Per-line renders for the wrapped flow — filled for vertical layout. */
  lines: Array<{ text: string; html: string | null }>
  /** True when the block is an atomic formula that must not be split. */
  whole: boolean
}

function layoutContent(src: string, layout: Layout, wrapCols: number): BlockView[] {
  if (layout === 'horizontal') {
    return [{ key: 0, raw: src, html: typeset(src), lines: [], whole: true }]
  }
  return splitBlocks(src).map((block, i) => {
    const whole = typeset(block)
    if (whole && /\\begin\{/.test(block)) {
      // environments (cases / matrix / aligned…) are atomic: splitting would
      // shred their `&`-rows and stray \begin\/\end halves. One whole row.
      return { key: i, raw: block, html: whole, lines: [{ text: block, html: whole }], whole: true }
    }
    if (whole) {
      // Plain multi-line source: try the wrapped flow — each line must
      // render on its own, else fall back to the whole block as one row.
      const lines = blockLines(block, wrapCols).map((text) => ({ text, html: typeset(text) }))
      if (lines.length > 1 && lines.every((l) => l.html !== null)) {
        return { key: i, raw: block, html: whole, lines, whole: false }
      }
      return { key: i, raw: block, html: whole, lines: [{ text: block, html: whole }], whole: true }
    }
    // Whole-block parse failed (mid-edit state): try line-by-line so a
    // salvageable flow still shows; total failure lands in the raw view.
    const lines = blockLines(block, wrapCols).map((text) => ({ text, html: typeset(text) }))
    return { key: i, raw: block, html: null, lines, whole: false }
  })
}

/**
 * Offscreen measurer: renders a block's whole-source KaTeX HTML and reports
 * its natural width. The wrap estimate (`wrapCols`) is only a guess at break
 * points — this is the ground truth that undoes a split when the panel is
 * wide enough to show the block as a single row again.
 */
let measurer: HTMLDivElement | null = null

function measureBlockWidth(html: string): number {
  if (!measurer) {
    measurer = document.createElement('div')
    // Same font size as .formula-view so KaTeX scales identically; visually
    // hidden but rendered, so scrollWidth is the real typeset width.
    measurer.setAttribute(
      'style',
      'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;' +
        'width:max-content;font-size:17px;',
    )
    measurer.className = 'formula-view'
    document.body.appendChild(measurer)
  }
  measurer.innerHTML = html
  const w = measurer.scrollWidth
  measurer.innerHTML = ''
  return w
}

export function FormulaPanel({ page, phase, grading, onFormula, onSubmit, onContinue, onSolution }: FormulaPanelProps) {
  // The saved value from the server; `draft` is what the user is typing.
  const saved = page?.formula ?? null
  const [draft, setDraft] = useState(saved ?? '')
  const [busy, setBusy] = useState(false)
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [tab, setTab] = useState<PanelTab>('question')
  // Seed width only; during drag the handle writes inline styles directly on
  // the panel (no re-render per pointermove — dragging stays 60fps).
  const [width, setWidth] = useState<number>(loadPanelWidth)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)

  // The handle writes panel width directly for 60fps dragging; this observer
  // mirrors the settled width back into state so wrapping re-computes when
  // the drag ends (and when the window itself is resized).
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const w = panel.getBoundingClientRect().width
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev))
    })
    ro.observe(panel)
    return () => ro.disconnect()
  }, [])

  // ---- resize handle: one pointer handler covers mouse, finger and pencil --
  // The panel is OUTSIDE the Quickdraw canvas, but the browser turns a finger
  // drag into a scroll/pan gesture unless told otherwise — `touch-action:
  // none` on the handle is the finger-friendly part. Pointer Capture keeps
  // the drag alive when the finger slides off the thin grip. State lives in
  // refs (not React state) so the move handler never goes stale mid-drag;
  // only `dragging` is state, for the cursor/highlight feedback.
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return
    const drag = { active: false, startX: 0, startW: 0, pointerId: -1 }

    const clamp = (w: number) => {
      // never let the panel eat the paper: hard floor keeps ≥320px for canvas
      return Math.min(maxPanelWidth(), Math.max(PANEL_MIN_PX, w))
    }

    const apply = (w: number) => {
      const panel = panelRef.current
      if (panel) {
        panel.style.width = `${w}px`
        panel.style.flexBasis = `${w}px`
      }
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      drag.active = true
      drag.startX = e.clientX
      drag.startW = panelRef.current?.getBoundingClientRect().width ?? width
      drag.pointerId = e.pointerId
      handle.setPointerCapture(e.pointerId)
      setDragging(true)
      e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return
      const next = clamp(drag.startW + (e.clientX - drag.startX))
      apply(next)
    }
    const finish = (e: PointerEvent) => {
      if (!drag.active || e.pointerId !== drag.pointerId) return
      drag.active = false
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      setDragging(false)
      try {
        localStorage.setItem(PANEL_KEY, String(clamp(panelRef.current?.getBoundingClientRect().width ?? width)))
      } catch {
        // private mode — the width just won't persist
      }
    }

    handle.addEventListener('pointerdown', onDown)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    return () => {
      handle.removeEventListener('pointerdown', onDown)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
    }
    // `width` only seeds the fallback when no rect exists yet — reading it
    // would rebind the listeners mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching pages resets the editor to that page's saved formula. A page
  // with no formula focuses the input — writing the question is the next
  // thing you came here to do.
  useEffect(() => {
    setDraft(saved ?? '')
    if (!saved) inputRef.current?.focus()
    // deliberately keyed on the page only: a completed save must not yank
    // the text out from under a user who kept typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id])

  const dirty = draft.trim() !== (saved ?? '').trim()
  // Wrap estimate: panel width minus padding/scrollbar slack, ~11px per
  // glyph at the panel's font size. It only picks break candidates — the
  // post-pass below then measures the real typeset width and collapses any
  // block that fits on one row back into a single line.
  const wrapCols = Math.max(16, Math.round((width - 60) / 11))
  const blocks = useMemo(() => {
    const view = layoutContent(draft.trim(), layout, wrapCols)
    if (layout !== 'vertical') return view
    const avail = Math.max(120, width - 46)
    return view.map((b) => {
      // Undo the split when the whole block genuinely fits one row: the
      // char-count estimate is deliberately conservative, so dragging the
      // panel wider must re-join rows that now fit ("back to one line").
      if (!b.whole && b.lines.length > 1 && b.html && measureBlockWidth(b.html) <= avail) {
        return { ...b, lines: [{ text: b.raw, html: b.html }], whole: true }
      }
      return b
    })
  }, [draft, layout, wrapCols, width])
  // Horizontal keeps its single-piece render; vertical uses per-line flow.
  const singleHtml = layout === 'horizontal' && blocks.every((b) => b.html !== null) ? (blocks[0]?.html ?? null) : null
  const allRaw = blocks.map((b) => b.raw).join('\n\n')

  const toggleLayout = () => {
    const next = layout === 'horizontal' ? 'vertical' : 'horizontal'
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // private mode — the toggle just won't persist
    }
  }

  const commit = async () => {
    if (busy || !dirty) return
    setBusy(true)
    try {
      // Whitespace-only is "cleared", same as null on the wire.
      await onFormula(draft.trim() ? draft : null)
    } finally {
      setBusy(false)
    }
  }

  const escape = () => setDraft(saved ?? '')

  const empty = !draft.trim()
  // The question is part of what was graded. Letting it be edited afterwards
  // would leave a grade attached to a formula it never saw — so it locks with
  // the board and unlocks on the same 「继续作答」.
  const frozen = phase === 'submitted' || phase === 'graded'

  // ---- the reference solution ----------------------------------------------
  // Unlike the question this stays editable once graded: the solution is what
  // the agent produced, and being able to correct it afterwards is the whole
  // reason there is an editor here rather than just rendered text.
  const savedSolution = grading?.correctSolution ?? ''
  const [solDraft, setSolDraft] = useState(savedSolution)
  const [solBusy, setSolBusy] = useState(false)
  const solDirty = solDraft.trim() !== savedSolution.trim()
  const solRef = useRef<HTMLTextAreaElement>(null)

  // Keyed on gradedAt, not on the grading object: a local save rebuilds that
  // object, and re-seeding from it would yank the text out from under a user
  // who kept typing. A genuinely new grade has a new timestamp.
  useEffect(() => {
    setSolDraft(grading?.correctSolution ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, grading?.gradedAt])

  const commitSolution = async () => {
    if (solBusy || !solDirty) return
    setSolBusy(true)
    try {
      await onSolution(solDraft.trim() ? solDraft : null)
    } finally {
      setSolBusy(false)
    }
  }

  // Landing on a submitted page should show the report, not an empty tab.
  useEffect(() => {
    if (phase === 'submitted' || phase === 'graded') setTab('question')
  }, [phase])

  return (
    <aside
      ref={panelRef}
      className={`formula-panel${dragging ? ' is-dragging' : ''}`}
      style={{ width, flexBasis: width }}
      aria-label="公式栏"
    >
      <div className="formula-inner">
      <header className="formula-head">
        <div className="formula-tabs" role="tablist" aria-label="题目与答案">
          <button
            type="button"
            role="tab"
            id="tab-question"
            aria-selected={tab === 'question'}
            className={`formula-tab${tab === 'question' ? ' is-on' : ''}`}
            data-testid="tab-question"
            onClick={() => setTab('question')}
          >
            题目
            {grading && <GradingOverallBadge grading={grading} marked={false} />}
          </button>
          <button
            type="button"
            role="tab"
            id="tab-answer"
            aria-selected={tab === 'answer'}
            className={`formula-tab${tab === 'answer' ? ' is-on' : ''}`}
            data-testid="tab-answer"
            // Before there is a grade there is no solution — leaving this
            // enabled would just be a way to ask for the answer.
            disabled={phase === 'empty' || phase === 'ready'}
            onClick={() => setTab('answer')}
          >
            答案
          </button>
        </div>
        {tab === 'question' && (
          <button
            type="button"
            className="formula-layout-btn"
            data-testid="formula-layout-toggle"
            onClick={toggleLayout}
            aria-pressed={layout === 'vertical'}
            title={layout === 'horizontal' ? '切换为竖向排列（按空行分段）' : '切换为横向排列（单行滚动）'}
          >
            {layout === 'horizontal' ? '⇉ 横排' : '⇊ 竖排'}
          </button>
        )}
      </header>

      {tab === 'answer' ? (
        /* The answer is its own view, not a section appended under the
           question. Mixing the two is how a reference solution ends up
           sitting next to the thing it is supposed to be withheld from. */
        <>
          <section className="formula-answer" role="tabpanel" aria-labelledby="tab-answer">
            {grading ? (
              grading.correctSolution ? (
                <GradingSolution grading={grading} />
              ) : (
                <p className="grade-empty">这次批改没有给出参考解法，可以在下方直接补写。</p>
              )
            ) : (
              <p className="grade-empty">批改完成后这里会显示参考解法。</p>
            )}
          </section>

          {/* Pinned below the scroll area, exactly like the question's editor.
               Inside it a long solution would push the box off-screen and the
               editor would look like it had never been added. */}
          {grading && (
            <div className="solution-editor">
              <textarea
                ref={solRef}
                className="formula-input"
                data-testid="solution-input"
                value={solDraft}
                placeholder={'参考解法（LaTeX），如 \\displaystyle\\lim_{x\\to 0}\\frac{\\sin x}{x}=1'}
                rows={5}
                spellCheck={false}
                aria-label="参考解法 LaTeX 源码"
                onChange={(e) => setSolDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Same contract as the question editor: Enter commits,
                  // Shift+Enter is a newline, Esc reverts.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void commitSolution()
                    solRef.current?.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setSolDraft(savedSolution)
                  }
                }}
                onBlur={() => void commitSolution()}
              />
              <div className="formula-foot">
                {solDirty ? <span className="formula-dirty">未保存</span> : null}
                {solBusy ? <span className="formula-saving">保存中…</span> : null}
                <span className="formula-hint">Enter 提交 · Shift+Enter 换行 · Esc 还原</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
      <div className="formula-view" role="tabpanel" aria-labelledby="tab-question" data-testid="page-formula-display">
        {empty ? (
          <p className="formula-empty">
            还没有公式。在下方输入 LaTeX，例如{' '}
            <code>\frac{'{'}a{'}'}{'{'}b{'}'}</code>，失焦或回车后渲染在这里。
          </p>
        ) : layout === 'vertical' ? (
          // Vertical: one card per block. Each card renders its safe-break
          // lines stacked — a card too wide for the column wraps onto the
          // next row (grows taller) instead of scrolling sideways. A card
          // whose source fails KaTeX entirely shows raw, so one bad line
          // never blanks the whole column.
          <div className="formula-stack">
            {blocks.map((b) => (
              <div key={b.key} className="formula-block">
                {b.lines.length > 0 && b.lines.every((l) => l.html !== null) ? (
                  b.lines.length === 1 && b.whole ? (
                    // Atomic block (cases / matrix / one tight formula): a
                    // single row that scrolls sideways if genuinely too wide.
                    <div className="formula-line" dangerouslySetInnerHTML={{ __html: b.lines[0].html! }} />
                  ) : (
                    <div className="formula-lines">
                      {b.lines.map((l, li) =>
                        l.html ? (
                          // KaTeX output is locally generated — safe to inject.
                          <div key={li} className="formula-line" dangerouslySetInnerHTML={{ __html: l.html }} />
                        ) : null,
                      )}
                    </div>
                  )
                ) : (
                  <div className="formula-broken">
                    <pre className="formula-raw">{b.raw}</pre>
                    <p className="formula-error" role="status">LaTeX 无法解析</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : singleHtml ? (
          // KaTeX output is locally generated from the user's own source and
          // escapes its input — safe to inject.
          <div className="formula-rendered is-horizontal" dangerouslySetInnerHTML={{ __html: singleHtml }} />
        ) : (
          <div className="formula-broken">
            <pre className="formula-raw">{allRaw}</pre>
            <p className="formula-error" role="status">LaTeX 无法解析</p>
          </div>
        )}
      </div>

      <section className="formula-report">
        {grading ? (
          <GradingReport grading={grading} />
        ) : (
          <p className="grade-empty">
            {phase === 'submitted' ? '已提交，等待批改。' : '还没有批改结果。'}
          </p>
        )}
      </section>

      <div className="formula-actions">
        {phase === 'ready' || phase === 'empty' ? (
          <button
            type="button"
            className="btn btn-primary btn-block"
            data-testid="grade-submit"
            disabled={phase === 'empty'}
            title={phase === 'empty' ? '先填写题目' : '冻结答题纸并交给 agent 批改'}
            onClick={onSubmit}
          >
            提交批改
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-block"
            data-testid="grade-continue"
            title="解锁画布继续作答。注意：这只是本次会话内解锁，刷新后仍显示为已提交；想真正开始新一轮，再次提交即可（会生成新快照并清掉旧批改）。"
            onClick={onContinue}
          >
            继续作答
          </button>
        )}
      </div>

      <div className="formula-editor">
        <textarea
          ref={inputRef}
          className="formula-input"
          data-testid="page-formula-input"
          value={draft}
          readOnly={frozen}
          placeholder={frozen ? '已提交，题目已锁定' : 'LaTeX，如 \\displaystyle\\lim_{x\\to 0}\\frac{\\sin x}{x}'}
          rows={4}
          spellCheck={false}
          aria-label="公式 LaTeX 源码"
          aria-readonly={frozen}
          onChange={(e) => {
            if (frozen) return
            setDraft(e.target.value)
          }}
          onKeyDown={(e) => {
            if (frozen) return
            // Enter commits; Shift+Enter is a newline — `{` and friends are
            // legal mid-typing states, so nothing is sent per keystroke.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void commit()
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              escape()
            }
          }}
          onBlur={() => {
            if (frozen) return
            void commit()
          }}
        />
        <div className="formula-foot">
          {frozen ? (
            <span className="formula-locked">题目已锁定 · 「继续作答」后可修改</span>
          ) : (
            <>
              {dirty ? <span className="formula-dirty">未保存</span> : null}
              {busy ? <span className="formula-saving">保存中…</span> : null}
              <span className="formula-hint">Enter 提交 · Shift+Enter 换行 · Esc 还原</span>
            </>
          )}
        </div>
      </div>
        </>
      )}
      </div>

      {/* Grip sits on the panel's RIGHT edge — the seam with the paper, where
          "drag the panel wider" is the natural gesture. */}
      <div
        ref={handleRef}
        className={`formula-resize${dragging ? ' is-active' : ''}`}
        data-testid="formula-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整公式栏宽度"
        title="拖动调整宽度"
      />
    </aside>
  )
}
