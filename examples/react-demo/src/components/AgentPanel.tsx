// The prompt clipboard for the external grading agent.
//
// The agent runs in someone else's browser (a cloud PC). It cannot be given a
// button here, so the contract is: this panel produces a self-contained
// instruction, the human pastes it in, and the agent works from the page URL
// + the X-Page-Token it is handed separately. The token is deliberately NOT
// in the prompt text or in agent-context — a prompt gets screenshotted.

import { useState } from 'react'
import type { PagePhase } from '../hooks/usePage.ts'
import { API_BASE } from '../lib/api.ts'

export interface AgentPanelProps {
  phase: PagePhase
  pageId: string
  formula: string | null
}

/** Where the agent can read the page in a browser. */
function pageUrl(pageId: string): string {
  return `${window.location.origin}/${pageId}`
}

function issuePrompt(pageId: string): string {
  return `你是一名数学老师，任务是出一道数学题。

打开这个页面：
${pageUrl(pageId)}

页面左侧是公式栏。请把题目以 LaTeX 源码的形式给出。

硬性要求：
1. 只输出 LaTeX 源码本身，不要输出解释、不要 markdown 代码块、不要包裹 $$
2. 公式要能在 KaTeX 下正确渲染
3. 难度和范围按用户的要求来；没说就出一道中等难度的常规题

把结果写进页面：
PATCH ${API_BASE}/api/pages/${pageId}
请求头：X-Page-Token: {由用户另行提供}
请求体：{ "formula": "<你的 LaTeX>" }`
}

function gradePrompt(pageId: string, formula: string | null, regrade: boolean): string {
  const again = regrade
    ? '这是重新批改。学生已经修改过答题纸，请以当前快照为准，不要参考任何先前的批改结论。\n\n'
    : ''
  return `${again}你是一名数学老师，负责批改学生的手写答题纸。

## 页面
${pageUrl(pageId)}

## 题目（LaTeX 源码）
${formula ?? '（这页没有题目）'}

## 你要做什么
1. 打开上面的页面。右侧是学生手写答题纸的快照图（已冻结，不会再变）
2. 分析学生的完整解题过程
3. 按下面的格式把批改结果 PATCH 回去

## 硬性要求（逐条遵守，不可变通）

1. **看不清就说看不清。** 任何一步的字迹如果你无法辨认，必须在对应字段明确写出
   「该步骤无法辨认」。绝对不要根据上下文猜测或脑补学生写了什么。
2. **不要因为字迹潦草就判错。** 潦草但能认出来的，照常批改。只有真认不出才按第 1 条处理。
3. **不要只看最终答案。** 要检查每一个主要步骤。
4. **第一个错误才是重点。** 指出第一个出错的地方，说明错在哪、为什么、应该怎么做。
   不要罗列一堆次要问题。
5. **看不清和做错了是两回事。** overall 必须区分，不要把「看不清」当成「答错」。
6. 只输出 JSON，不要解释文字、不要 markdown 代码块。

## 输出

PATCH ${API_BASE}/api/pages/${pageId}
请求头：X-Page-Token: {由用户另行提供}
请求体：

{
  "grading": {
    "readable": true,
    "overall": "correct | incorrect | partial | unreadable",
    "transcription": "把你在图里看到的手写内容转写出来，LaTeX 或文本。读不出的部分写 [无法辨认]，不要跳过",
    "firstError": { "description": "第一个错误在哪一步、是什么", "correction": "应该怎么改" } | null,
    "correctSolution": "完整的正确解法，可用 LaTeX",
    "teacherComment": "给学生的讲解，说人话，不要复述定义"
  }
}

## 字段语义
- readable：整张答题纸是否可辨认。完全读不出时设 false，此时 overall 必须是 "unreadable"
- overall：correct 全对 / incorrect 有错 / partial 方向对但不完整或有小错 / unreadable 读不出
- firstError：没有错误时**必须是 null**。不要为了填满字段而编造错误
- transcription：这一步的价值在于——学生能发现你是不是认错了他的字
- correctSolution：参考解法，不是评分依据

## 如果页面左侧没有题目
不要批改。在 teacherComment 写明「这页没有题目，无法判断解题是否对题」，
overall 设 "unreadable"。

## 交付
PATCH 成功后在页面上确认看到了批改结果，然后结束。
失败则重试一次；仍失败就在页面上说明无法提交批改结果。`
}

/** The prompt for whatever the page needs right now, or null when it needs nothing. */
export function agentPromptFor(phase: PagePhase, pageId: string, formula: string | null): string | null {
  if (phase === 'empty') return issuePrompt(pageId)
  if (phase === 'submitted') return gradePrompt(pageId, formula, false)
  if (phase === 'graded') return gradePrompt(pageId, formula, true)
  return null
}

export function AgentPanel({ phase, pageId, formula }: AgentPanelProps) {
  const [copied, setCopied] = useState(false)
  const prompt = agentPromptFor(phase, pageId, formula)

  const copy = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      // Clipboard API needs a secure context; fall back to a selection the
      // user can copy by hand rather than failing silently.
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (!prompt) {
    return (
      <p className="agent-idle" data-testid="agent-panel-idle">
        学生作答中，无需 agent 介入。
      </p>
    )
  }

  return (
    <div className="agent-panel">
      <div className="agent-panel-head">
        <span className="agent-phase">
          {phase === 'empty' ? '出题指令' : phase === 'graded' ? '重新批改指令' : '批改指令'}
        </span>
        <button type="button" className="btn btn-primary" data-testid="agent-copy" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <p className="agent-note">
        粘进豆包云电脑。Token 不在其中 —— 在设置里生成后单独交给 agent。
      </p>
      <pre className="agent-prompt" data-testid="agent-prompt">{prompt}</pre>
    </div>
  )
}
