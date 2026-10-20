import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete"
import { isLiteralContext } from "../context.ts"
import type { EmojiEntry } from "../options.ts"

type EmojiLoader = () => Promise<readonly EmojiEntry[]>

export const defaultEmojiLoader: EmojiLoader = () => import("./emojiData.ts").then((m) => m.EMOJI)

const cache = new WeakMap<EmojiLoader, Promise<readonly EmojiEntry[]>>()

function loadOnce(load: EmojiLoader): Promise<readonly EmojiEntry[]> {
  let p = cache.get(load)
  if (!p) {
    p = Promise.resolve().then(load)
    cache.set(load, p)
    // A failed chunk load is retried on the next query
    p.catch(() => cache.delete(load))
  }
  return p
}

// Lower is better, -1 = no match
function score(name: string, q: string): number {
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.split("_").some((w) => w.startsWith(q))) return 2
  return name.includes(q) ? 3 : -1
}

export function emojiSource(load: EmojiLoader): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const m = context.matchBefore(/:[a-z0-9_+-]{2,}$/i)
    if (!m) return null
    const { state } = context
    if (m.from > state.doc.lineAt(m.from).from && !/\s/.test(state.sliceDoc(m.from - 1, m.from))) return null
    if (isLiteralContext(state, m.from) || isLiteralContext(state, m.from + 1)) return null
    let entries: readonly EmojiEntry[]
    try {
      entries = await loadOnce(load)
    } catch {
      return null
    }
    if (context.aborted) return null
    const q = m.text.slice(1).toLowerCase()
    const best = new Map<string, { glyph: string; name: string; s: number }>()
    for (const [glyph, ...names] of entries) {
      for (const name of names) {
        const s = score(name, q)
        if (s < 0) continue
        const cur = best.get(glyph)
        // Ties keep the earlier name, so the canonical one wins
        if (!cur || s < cur.s) best.set(glyph, { glyph, name, s })
      }
    }
    const options: Completion[] = [...best.values()]
      .sort((a, b) => a.s - b.s || a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, 50)
      .map(({ glyph, name }) => ({ label: ":" + name, displayLabel: glyph + " " + name, apply: glyph, type: "md-emoji" }))
    return options.length ? { from: m.from, options, filter: false } : null
  }
}
