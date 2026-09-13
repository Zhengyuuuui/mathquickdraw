// Live SVG preview of a Quickdraw backdrop, for the home page's style picker
// and for the page cards. Mirrors `Editor._drawGrid` (packages/core/src/editor.js
// ~1546) and the palette ramp (packages/core/src/palette.js ~60) closely enough
// to read as "this is the paper you'll get" — it is deliberately NOT a mounted
// Editor, which would cost six live canvases on the landing screen.

import type { PageGrid, PageTheme } from '../lib/api.ts'

const TAN30 = Math.tan(Math.PI / 6)
/** palette.js GRID_MAJOR — every Nth rule is drawn darker. */
const MAJOR_EVERY = 5

interface Ramp {
  bg: string
  lineMinor: string
  lineMajor: string
  dotMinor: string
  dotMajor: string
}

const RAMPS: Record<PageTheme, Ramp> = {
  light: {
    bg: '#fbf9f4',
    lineMinor: 'rgba(60, 50, 30, 0.13)',
    lineMajor: 'rgba(60, 50, 30, 0.26)',
    dotMinor: 'rgba(60, 50, 30, 0.26)',
    dotMajor: 'rgba(60, 50, 30, 0.45)',
  },
  dark: {
    bg: '#191713',
    lineMinor: 'rgba(255, 246, 224, 0.10)',
    lineMajor: 'rgba(255, 246, 224, 0.20)',
    dotMinor: 'rgba(255, 246, 224, 0.20)',
    dotMajor: 'rgba(255, 246, 224, 0.36)',
  },
}

export interface GridPreviewProps {
  grid: PageGrid
  theme?: PageTheme
  width?: number
  height?: number
  /** Lattice pitch in preview px. */
  cell?: number
  className?: string
  /** Decorative unless the host supplies a label. */
  title?: string
}

/** Index sequence whose 0th and every Nth entry counts as "major". */
function series(count: number, cell: number): Array<{ p: number; major: boolean }> {
  return Array.from({ length: count + 1 }, (_, i) => ({
    p: i * cell,
    major: i % MAJOR_EVERY === 0,
  }))
}

export function GridPreview({
  grid,
  theme = 'light',
  width = 160,
  height = 104,
  cell = 16,
  className,
  title,
}: GridPreviewProps) {
  const ramp = RAMPS[theme]
  const cols = series(Math.ceil(width / cell), cell)
  const rows = series(Math.ceil(height / cell), cell)

  const line = (key: string, major: boolean, d: string) => (
    <path key={key} d={d} stroke={major ? ramp.lineMajor : ramp.lineMinor} strokeWidth={1} fill="none" />
  )

  let marks: React.ReactNode = null

  if (grid === 'lines' || grid === 'ruled') {
    const rules: React.ReactNode[] = []
    for (const major of [false, true]) {
      const d: string[] = []
      if (grid === 'lines') {
        for (const c of cols) if (c.major === major) d.push(`M${c.p + 0.5} 0V${height}`)
      }
      for (const r of rows) if (r.major === major) d.push(`M0 ${r.p + 0.5}H${width}`)
      if (d.length) rules.push(line(String(major), major, d.join('')))
    }
    marks = rules
  } else if (grid === 'dots') {
    marks = (
      <>
        {[false, true].map((major) => (
          <g key={String(major)} fill={major ? ramp.dotMajor : ramp.dotMinor}>
            {rows
              .filter((r) => r.major === major)
              .map((r) =>
                cols
                  .filter((c) => c.major === major)
                  .map((c) => <circle key={`${c.p}-${r.p}`} cx={c.p + 0.5} cy={r.p + 0.5} r={1.6} />),
              )}
          </g>
        ))}
      </>
    )
  } else if (grid === 'crosses') {
    marks = (
      <>
        {[false, true].map((major) => {
          const arm = major ? 4.5 : 3
          const d: string[] = []
          for (const r of rows) {
            if (r.major !== major) continue
            for (const c of cols) {
              if (c.major !== major) continue
              const x = c.p + 0.5
              const y = r.p + 0.5
              d.push(`M${x - arm} ${y}H${x + arm}`, `M${x} ${y - arm}V${y + arm}`)
            }
          }
          return d.length ? line(String(major), major, d.join('')) : null
        })}
      </>
    )
  } else if (grid === 'iso') {
    // two 30° families — a diamond weave, one quiet weight like the engine
    const d: string[] = []
    const span = height / TAN30
    for (const c of cols) {
      d.push(`M${c.p} 0L${c.p + span} ${height}`)
      d.push(`M${c.p} 0L${c.p - span} ${height}`)
    }
    marks = line('iso', false, d.join(''))
  }

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      preserveAspectRatio="none"
    >
      <rect width={width} height={height} fill={ramp.bg} />
      {marks}
    </svg>
  )
}

/** Human labels for the six Quickdraw backdrops — used by the style picker. */
export const GRID_OPTIONS: ReadonlyArray<{
  id: PageGrid
  name: string
  hint: string
}> = [
  { id: 'none', name: '空白', hint: '不画任何背景' },
  { id: 'lines', name: '方格纸', hint: '横 + 竖线都画' },
  { id: 'ruled', name: '横线笔记纸', hint: '只画横线' },
  { id: 'dots', name: '点阵', hint: '交叉点上一个实心点' },
  { id: 'crosses', name: '十字标记', hint: '交叉点上一个小 +' },
  { id: 'iso', name: '等距菱形', hint: '两组 30° 斜线交织成菱形格' },
]

export function gridLabel(id: PageGrid | undefined): string {
  return GRID_OPTIONS.find((g) => g.id === id)?.name ?? '空白'
}
