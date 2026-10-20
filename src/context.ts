import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import { countColumn } from "@codemirror/state"
import type { EditorState } from "@codemirror/state"
import type { SyntaxNode, Tree } from "@lezer/common"

const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText", "CodeInfo"])

const LITERAL = new Set([
  ...CODE, "URL", "Autolink", "HTMLTag", "HTMLBlock", "Comment", "CommentBlock",
  "ProcessingInstruction", "ProcessingInstructionBlock", "ColorMark", "UnderlineMark",
])

// Typing at node.to still extends these nodes
function openEnded(node: SyntaxNode): boolean {
  if (node.name === "CodeBlock" || node.name === "URL") return true
  if (node.name !== "FencedCode") return false
  const first = node.firstChild, last = node.lastChild
  return !(last && first && last.name === "CodeMark" && last.from !== first.from)
}

// Only an indent of 4+ before pos, below indented code: typing here continues that CodeBlock
function indentedCodeContinues(state: EditorState, tree: Tree, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  const indent = state.sliceDoc(line.from, pos)
  if (/\S/.test(indent) || countColumn(indent, 4) < 4) return false
  for (let n = line.number - 1; n >= 1; n--) {
    const prev = state.doc.line(n)
    if (!prev.text.trim()) continue
    for (let node: SyntaxNode | null = tree.resolveInner(prev.to, -1); node; node = node.parent) if (node.name === "CodeBlock") return true
    return false
  }
  return false
}

function inside(state: EditorState, pos: number, names: ReadonlySet<string>): boolean {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 50) ?? syntaxTree(state)
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (!names.has(node.name)) continue
    if ((node.from < pos && pos < node.to) || (pos === node.to && node.from < pos && openEnded(node))) return true
  }
  return names.has("CodeBlock") && indentedCodeContinues(state, tree, pos)
}

export function isCodeContext(state: EditorState, pos: number): boolean {
  return inside(state, pos, CODE)
}

export function isLiteralContext(state: EditorState, pos: number): boolean {
  return inside(state, pos, LITERAL)
}
