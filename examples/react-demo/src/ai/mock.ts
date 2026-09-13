// MockAIAdapter — the offline stand-in for a real model.
//
// Answers a formula prompt from a small canned bank so the product loop
// (prompt → formula → new page → handwriting) runs with zero network.
// Structure matches what DoubaoAdapter will return.

import type { AIAdapter, Formula } from './types.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BANK: Array<{ match: RegExp; formula: Formula }> = [
  {
    match: /极限|limit/i,
    formula: {
      title: '函数极限',
      latex: String.raw`\displaystyle\lim_{x\to 0^{-}}\frac{x^{2}-0}{x-0}`,
    },
  },
  {
    match: /中值定理|拉格朗日|mean\s*value/i,
    formula: {
      title: '拉格朗日中值定理',
      latex: String.raw`f(x)=x^{3}-3x,\quad x\in[0,\sqrt{3}]`,
    },
  },
  {
    match: /导数|derivative|求导/i,
    formula: {
      title: '复合函数求导',
      latex: String.raw`y=\ln\left(x+\sqrt{1+x^{2}}\right)`,
    },
  },
  {
    match: /积分|integral/i,
    formula: {
      title: '不定积分',
      latex: String.raw`\displaystyle\int\frac{x}{1+x^{4}}\,\mathrm{d}x`,
    },
  },
]

const FALLBACK = BANK[0].formula

export class MockAIAdapter implements AIAdapter {
  async generateFormula(prompt: string): Promise<Formula> {
    await wait(800)
    const hit = BANK.find((c) => c.match.test(prompt))
    return { ...(hit?.formula ?? FALLBACK) }
  }
}
