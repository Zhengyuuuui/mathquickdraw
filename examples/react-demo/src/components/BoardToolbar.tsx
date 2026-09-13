// Custom board chrome. Quickdraw's stock dock is hidden (hideUi) so the
// toolbar can match the math-answer app and sit where the layout needs it.
// Everything here is a thin call into the existing Editor/Store API.

import type { Editor, ToolId } from '@quickdrawjs/react'
import type { PageSize } from '../lib/api.ts'
import { framePageCamera, pageSizeOf } from '../lib/pageSize.ts'
import { useEditorState } from '../hooks/useEditorState.ts'

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const ICONS: Record<string, React.ReactNode> = {
  select: <Svg><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" /></Svg>,
  draw: <Svg><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></Svg>,
  eraser: <Svg><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" /></Svg>,
  hand: <Svg><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></Svg>,
  undo: <Svg><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" /></Svg>,
  redo: <Svg><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" /></Svg>,
  zoomOut: <Svg><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /></Svg>,
  zoomIn: <Svg><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /><path d="M11 8v6" /></Svg>,
  fit: <Svg><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>,
  trash: <Svg><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Svg>,
}

const TOOLS: Array<{ id: ToolId; tip: string; key: string }> = [
  { id: 'select', tip: '选择 / 套索', key: 'V' },
  { id: 'draw', tip: '画笔', key: 'D' },
  { id: 'eraser', tip: '橡皮擦', key: 'E' },
  { id: 'hand', tip: '平移', key: 'H' },
]

// A writing-focused subset of Quickdraw's palette.
const COLORS: Array<{ id: 'black' | 'blue' | 'red' | 'green' | 'violet'; hex: string; label: string }> = [
  { id: 'black', hex: '#1f2937', label: '黑' },
  { id: 'blue', hex: '#2f6fed', label: '蓝' },
  { id: 'red', hex: '#e5484d', label: '红' },
  { id: 'green', hex: '#30a46c', label: '绿' },
  { id: 'violet', hex: '#8e4ec6', label: '紫' },
]

const SIZES: Array<{ id: 's' | 'm' | 'l' | 'xl'; px: number; label: string }> = [
  { id: 's', px: 6, label: '细' },
  { id: 'm', px: 9, label: '中' },
  { id: 'l', px: 13, label: '粗' },
  { id: 'xl', px: 17, label: '特粗' },
]

export interface BoardToolbarProps {
  editor: Editor | null
  /** Page size, so "fit" means "show the sheet" rather than "show the ink". */
  size?: PageSize
  onClear: () => void
}

export function BoardToolbar({ editor, size, onClear }: BoardToolbarProps) {
  const st = useEditorState(editor)

  const zoomBy = (mult: number) => {
    if (!editor) return
    const { w, h } = editor.viewSize()
    editor.zoomAt(w / 2, h / 2, mult)
  }

  // On a sized sheet this is the way back after panning into the (now hidden)
  // off-sheet area; on an unbounded board it frames whatever was drawn.
  const fit = () => {
    if (!editor) return
    const page = pageSizeOf(size)
    if (!page) {
      editor.fitContent({ animate: 180 })
      return
    }
    const { w, h } = editor.viewSize()
    const cam = framePageCamera(w, h, page)
    if (cam) editor.setCamera(cam, { animate: 180 })
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="白板工具">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tb-btn${st.tool === t.id ? ' is-active' : ''}`}
            title={`${t.tip}（${t.key}）`}
            aria-pressed={st.tool === t.id}
            disabled={!editor}
            onClick={() => editor?.setTool(t.id)}
          >
            {ICONS[t.id]}
          </button>
        ))}
      </div>

      <div className="tb-sep" />

      <div className="toolbar-group">
        <button type="button" className="tb-btn" data-testid="toolbar-undo" title="撤销（⌘Z）" disabled={!editor || !st.canUndo}
          onClick={() => editor?.store.undo()}>{ICONS.undo}</button>
        <button type="button" className="tb-btn" data-testid="toolbar-redo" title="重做（⇧⌘Z）" disabled={!editor || !st.canRedo}
          onClick={() => editor?.store.redo()}>{ICONS.redo}</button>
      </div>

      <div className="tb-sep" />

      <div className="toolbar-group">
        <button type="button" className="tb-btn" title="缩小" disabled={!editor} onClick={() => zoomBy(1 / 1.25)}>
          {ICONS.zoomOut}
        </button>
        <span className="tb-zoom" title="当前缩放">{Math.round(st.zoom * 100)}%</span>
        <button type="button" className="tb-btn" title="放大" disabled={!editor} onClick={() => zoomBy(1.25)}>
          {ICONS.zoomIn}
        </button>
        <button
          type="button"
          className="tb-btn"
          title={pageSizeOf(size) ? '回到纸面' : '适应内容'}
          disabled={!editor || (!pageSizeOf(size) && !st.hasContent)}
          onClick={fit}
        >
          {ICONS.fit}
        </button>
      </div>

      <div className="tb-sep" />

      <div className="toolbar-group tb-colors" role="group" aria-label="笔迹颜色">
        {COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`tb-swatch${st.color === c.id ? ' is-active' : ''}`}
            style={{ background: c.hex }}
            title={`颜色：${c.label}`}
            aria-label={`颜色：${c.label}`}
            aria-pressed={st.color === c.id}
            disabled={!editor}
            onClick={() => editor?.setStyle('color', c.id)}
          />
        ))}
      </div>

      <div className="toolbar-group" role="group" aria-label="笔迹粗细">
        {SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`tb-size${st.size === s.id ? ' is-active' : ''}`}
            title={`粗细：${s.label}`}
            aria-pressed={st.size === s.id}
            disabled={!editor}
            onClick={() => editor?.setStyle('size', s.id)}
          >
            <span style={{ width: s.px, height: s.px }} />
          </button>
        ))}
      </div>

      <div className="tb-spacer" />

      <button type="button" className="tb-btn tb-danger" data-testid="toolbar-clear" title="清空画布" disabled={!editor || !st.hasContent}
        onClick={onClear}>{ICONS.trash}</button>
    </div>
  )
}
