import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react"
import type { JSX, RefObject } from "react"
import { EditorView } from "@codemirror/view"
import { mdCommands } from "./commands/index.ts"
import { revealLine } from "./flash.ts"
import { openFind } from "./search.ts"
import { createMdState, setDoc as setEditorDoc, updateMdEditor } from "./editor.ts"
import type { MarkdownEditorProps, MdEditorOptions, MdPhrases, MdRuntimeOptions } from "./options.ts"

// Callbacks go through `latest`, so new props never need a remount
function optionsFrom(latest: RefObject<MarkdownEditorProps>): MdEditorOptions {
  const p = latest.current
  return {
    livePreview: p.livePreview,
    placeholder: p.placeholder,
    phrases: p.phrases,
    slashCommands: p.slashCommands,
    slash: p.slash,
    emoji: p.emoji,
    icons: p.icons,
    codeLanguages: p.codeLanguages,
    revealDelay: p.revealDelay,
    timestamps: p.timestamps
      ? {
          trigger: p.timestamps.trigger,
          now: () => latest.current.timestamps?.now() ?? null,
          seek: (s) => latest.current.timestamps?.seek(s),
        }
      : undefined,
    onChange: (d, s) => latest.current.onChange?.(d, s),
  }
}

function runtimeOf(p: MdRuntimeOptions): MdRuntimeOptions {
  return { livePreview: p.livePreview, placeholder: p.placeholder, phrases: p.phrases, slashCommands: p.slashCommands }
}

function samePhrases(a: MdPhrases | undefined, b: MdPhrases | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
}

export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
  const { ref, className, livePreview, placeholder, phrases, slashCommands } = props
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef(props)
  const applied = useRef<MdRuntimeOptions>({})

  useLayoutEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const view = new EditorView({ parent, state: createMdState(latest.current.defaultValue ?? "", optionsFrom(latest)) })
    viewRef.current = view
    applied.current = runtimeOf(latest.current)
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const prev = applied.current
    const changed: MdRuntimeOptions = {}
    if (livePreview !== prev.livePreview) changed.livePreview = livePreview
    if (placeholder !== prev.placeholder) changed.placeholder = placeholder
    if (!samePhrases(phrases, prev.phrases)) changed.phrases = phrases
    if (slashCommands !== prev.slashCommands) changed.slashCommands = slashCommands
    applied.current = { livePreview, placeholder, phrases, slashCommands }
    if (Object.keys(changed).length) updateMdEditor(view, changed)
  }, [livePreview, placeholder, phrases, slashCommands])

  useImperativeHandle(ref, () => ({
    get view() {
      return viewRef.current
    },
    getDoc: () => viewRef.current?.state.doc.toString() ?? "",
    setDoc(doc) {
      const v = viewRef.current
      if (!v) return
      setEditorDoc(v, doc, optionsFrom(latest))
      applied.current = runtimeOf(latest.current)
    },
    focus: () => viewRef.current?.focus(),
    reveal(pos) {
      if (viewRef.current) revealLine(viewRef.current, pos)
    },
    run(command) {
      const v = viewRef.current
      if (!v) return false
      const cmd = command === "find" ? openFind : typeof command === "string" ? mdCommands[command] : command
      const ok = cmd(v)
      // A panel command (find) keeps the focus it moved into its field
      if (!v.dom.querySelector(".cm-panels")?.contains(document.activeElement)) v.focus()
      return ok
    },
  }), [])

  return <div ref={host} className={className ? `mdEditor ${className}` : "mdEditor"} />
}
