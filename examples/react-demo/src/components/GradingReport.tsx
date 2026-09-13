// Renders a grading agent's report.
//
// The four verdicts must not look alike. "看不清" in particular is not a
// failed answer — it is the agent saying it could not read the sheet, and
// dressing that up in the same red as "wrong" teaches the student the wrong
// thing about their own handwriting.

import katex from 'katex'
import type { GradingOverall, GradingResult } from '../lib/api.ts'
import { relTime } from '../lib/time.ts'

const OVERALL: Record<GradingOverall, { label: string; className: string }> = {
  correct: { label: '答对了', className: 'is-correct' },
  incorrect: { label: '有错误', className: 'is-incorrect' },
  partial: { label: '部分正确', className: 'is-partial' },
  unreadable: { label: '老师看不清你写的内容', className: 'is-unreadable' },
}

/** KaTeX when it parses, raw source when it does not — never a blank box. */
function RichText({ source, className }: { source: string; className?: string }) {
  const blocks = source
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        try {
          const html = katex.renderToString(block, {
            displayMode: true,
            throwOnError: true,
            output: 'htmlAndMathml',
            strict: false,
          })
          // KaTeX output is locally generated and escapes its input.
          return <div key={i} className="rich-line" dangerouslySetInnerHTML={{ __html: html }} />
        } catch {
          return (
            <pre key={i} className="rich-raw">
              {block}
            </pre>
          )
        }
      })}
    </div>
  )
}

/**
 * Transcription in a monospace scroll box. `[无法辨认]` is the agent's
 * explicit admission, so it is highlighted — that is exactly the part a
 * student should look at to decide whether the grade is even based on their
 * work.
 */
function Transcription({ text }: { text: string }) {
  const parts = text.split(/(\[无法辨认\])/g)
  return (
    <pre className="grade-transcription" data-testid="grade-transcription">
      {parts.map((p, i) =>
        p === '[无法辨认]' ? (
          <mark key={i} className="grade-unread">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </pre>
  )
}

export interface GradingReportProps {
  grading: GradingResult
}

/**
 * The verdict chip. `marked` adds the report's `grade-overall` testid — the
 * same badge also decorates the 批改 tab, and a duplicated testid is an
 * ambiguous selector for anyone driving this page.
 */
export function GradingOverallBadge({ grading, marked = true }: GradingReportProps & { marked?: boolean }) {
  const meta = OVERALL[grading.overall] ?? OVERALL.unreadable
  return (
    <span className={`grade-badge ${meta.className}`} {...(marked ? { 'data-testid': 'grade-overall' } : {})}>
      {meta.label}
    </span>
  )
}

export function GradingReport({ grading }: GradingReportProps) {
  const now = Date.now()

  return (
    <div className="grade-report" data-testid="grade-result">
      <div className="grade-report-head">
        <GradingOverallBadge grading={grading} />
        <span className="grade-time" title={new Date(grading.gradedAt).toLocaleString()}>
          {relTime(grading.gradedAt, now)}
        </span>
      </div>

      {grading.teacherComment && (
        <p className="grade-comment">{grading.teacherComment}</p>
      )}

      {grading.firstError && (
        <div className="grade-error" data-testid="grade-first-error">
          <h4>第一个错误</h4>
          <p className="grade-error-desc">{grading.firstError.description}</p>
          <h4>应该怎么改</h4>
          <p className="grade-error-fix">{grading.firstError.correction}</p>
        </div>
      )}

      {grading.transcription && (
        <details className="grade-trans-wrap">
          <summary>老师看到的字迹</summary>
          <Transcription text={grading.transcription} />
        </details>
      )}
    </div>
  )
}

export function GradingSolution({ grading }: GradingReportProps) {
  if (!grading.correctSolution) {
    return <p className="grade-empty">这次批改没有给出参考解法。</p>
  }
  return <RichText source={grading.correctSolution} className="grade-solution" />
}
