// Mirror the parts of Editor state the custom chrome needs into React.
// Quickdraw owns the truth; this only subscribes to the events it already
// emits ('tool' | 'history' | 'camera' | 'styles' | 'selection').

import { useEffect, useState } from 'react'
import type { Camera, Editor, Styles, ToolId } from '@quickdrawjs/react'

export interface EditorState {
  tool: ToolId
  canUndo: boolean
  canRedo: boolean
  zoom: number
  color: Styles['color']
  size: Styles['size']
  penMode: boolean
  hasContent: boolean
}

export function useEditorState(editor: Editor | null): EditorState {
  const [state, setState] = useState<EditorState>({
    tool: 'draw',
    canUndo: false,
    canRedo: false,
    zoom: 1,
    color: 'blue',
    size: 'm',
    penMode: false,
    hasContent: false,
  })

  useEffect(() => {
    if (!editor) return
    const read = () =>
      setState({
        tool: editor.tool,
        canUndo: editor.store.canUndo,
        canRedo: editor.store.canRedo,
        zoom: editor.camera.z,
        color: editor.styles.color,
        size: editor.styles.size,
        penMode: editor.penMode,
        hasContent: editor.store.size > 0,
      })
    read()
    const offs = [
      editor.on('tool', read),
      editor.on('history', read),
      editor.on('camera', read),
      editor.on('styles', read),
      editor.on('penmode', read),
      editor.store.listen(read),
    ]
    return () => offs.forEach((off) => off())
  }, [editor])

  return state
}

export type { Camera }
