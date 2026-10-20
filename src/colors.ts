import type { MdColor } from "./options.ts"

export const MD_COLORS: Readonly<Record<MdColor, string>> = { red: "#e06c75", blue: "#61afef", green: "#98c379" }

export const COLOR_OPEN_RE = /^<span\s+style\s*=\s*(["'])\s*color\s*:\s*([^"';<>]+?)\s*;?\s*\1\s*>/i
export const COLOR_CLOSE_TAG = "</span>"

const NAMES = Object.keys(MD_COLORS) as MdColor[]

export function colorFromValue(value: string): MdColor | null {
  const v = value.trim().toLowerCase()
  return NAMES.find((c) => c === v || MD_COLORS[c] === v) ?? null
}

export function colorOfOpenTag(tag: string): MdColor | null {
  const m = COLOR_OPEN_RE.exec(tag)
  return m ? colorFromValue(m[2]) : null
}

export function colorOpenTag(color: MdColor): string {
  return `<span style="color:${MD_COLORS[color]}">`
}
