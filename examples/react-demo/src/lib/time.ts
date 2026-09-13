// Human-friendly timestamps, shared by the home cards and the grading report.

/** Creation is a fixed fact — print it as a date. */
export function absTime(ts: number, now: number): string {
  const d = new Date(ts)
  const n = new Date(now)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === n.toDateString()) return `今天 ${hm}`
  if (d.toDateString() === new Date(now - 86400000).toDateString()) return `昨天 ${hm}`
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** Last edit is a moving target — relative, falling back to a date when old. */
export function relTime(ts: number, now: number): string {
  const sec = Math.floor(Math.max(0, now - ts) / 1000)
  if (sec < 45) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return absTime(ts, now)
}
