// DoubaoAdapter — the real-model slot.
//
// Deliberately a stub: no transport, no network calls. The system prompt the
// real adapter must send lives here so the contract is settled; wire the
// endpoint + key, parse the JSON, and swap in via `setAIAdapter`.

import type { AIAdapter, Formula } from './types.ts'

export const FORMULA_SYSTEM_PROMPT = [
  '你是一名数学老师，负责出题。',
  '根据用户的描述出一道数学题，只输出一个 JSON 对象，',
  '不要输出 markdown 代码块，不要输出任何解释或多余文本。',
  '',
  'JSON 结构：',
  '{ "title": "题目的简短标题", "latex": "题目的 LaTeX 源码" }',
  '',
  '要求：',
  '1. latex 必须是合法的 LaTeX，可以编译渲染；不要输出图片或 HTML。',
  '2. 题目类型、难度与用户描述一致。',
].join('\n')

export interface DoubaoConfig {
  /** Full chat-completions URL, e.g. https://ark.cn-beijing.volces.com/api/v3/chat/completions */
  endpoint: string
  apiKey: string
  /** ARK model id / ep id. */
  model: string
}

/**
 * Real adapter. Unimplemented until a model endpoint is wired: calling it
 * fails loudly rather than pretending to work.
 */
export class DoubaoAdapter implements AIAdapter {
  constructor(private readonly cfg: DoubaoConfig) {}

  async generateFormula(_prompt: string): Promise<Formula> {
    void this.cfg
    void FORMULA_SYSTEM_PROMPT
    throw new Error('DoubaoAdapter 未接入：请先使用 MockAIAdapter（默认）。')
  }
}
