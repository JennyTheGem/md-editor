export const TIMESTAMP_RE = /^@\[(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\]/

const TIME_RE = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/

const pad2 = (n: number) => String(n).padStart(2, "0")

export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`
}

export function formatTimestamp(seconds: number): string {
  return `@[${formatTime(seconds)}]`
}

export function parseTimestamp(text: string): number | null {
  let t = text.trim()
  if (t.startsWith("@[") && t.endsWith("]")) t = t.slice(2, -1)
  const m = TIME_RE.exec(t)
  if (!m) return null
  const [, a, b, c] = m
  return c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c)
}
