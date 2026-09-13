// The one place that decides which AI the app talks to.
//
// Components import `getAIAdapter()` and never name a concrete class. Going
// live with Doubao is a single call to
// `setAIAdapter(new DoubaoAdapter({...}))` — no UI change.

import type { AIAdapter } from './types.ts'
import { MockAIAdapter } from './mock.ts'

export type { AIAdapter } from './types.ts'

let current: AIAdapter = new MockAIAdapter()

export function getAIAdapter(): AIAdapter {
  return current
}

export function setAIAdapter(next: AIAdapter): void {
  current = next
}
