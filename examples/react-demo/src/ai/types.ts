// Domain types for the AI layer: one job — turn a natural-language prompt
// into a LaTeX formula. Nothing here knows about Quickdraw or React, and the
// adapter contract is plain data in, plain data out.

export interface Formula {
  /** Raw LaTeX source for KaTeX. Stored on the page as-is. */
  latex: string
  /** Optional short title for the new page. */
  title?: string
}

/**
 * The only thing the UI depends on. Swap the implementation (mock → doubao)
 * via `setAIAdapter` without touching a component.
 */
export interface AIAdapter {
  generateFormula(prompt: string): Promise<Formula>
}
