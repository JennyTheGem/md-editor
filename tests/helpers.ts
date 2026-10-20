import { EditorSelection, EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import { createMarkdown } from "../src/syntax.ts"

export function mdState(doc: string, opts: { anchor?: number; head?: number; extensions?: readonly Extension[] } = {}): EditorState {
  return EditorState.create({
    doc,
    selection: opts.anchor === undefined ? undefined : EditorSelection.single(opts.anchor, opts.head ?? opts.anchor),
    extensions: [createMarkdown([]), ...(opts.extensions ?? [])],
  })
}

// `${name}:${text}` for every node except Document
export function nodes(state: EditorState): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state)
  const out: string[] = []
  tree.iterate({
    enter: (n) => {
      if (n.name !== "Document") out.push(`${n.name}:${state.sliceDoc(n.from, n.to)}`)
    },
  })
  return out
}

// The caller destroys the view
export function mdView(doc: string, extensions: readonly Extension[] = [], anchor?: number): EditorView {
  const parent = document.body.appendChild(document.createElement("div"))
  return new EditorView({ parent, state: mdState(doc, { anchor, extensions }) })
}
