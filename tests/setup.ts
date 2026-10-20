import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// jsdom has no layout, CodeMirror measures ranges
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()
if (!document.elementFromPoint) document.elementFromPoint = () => null

// no vitest globals, so RTL cannot register its own cleanup
afterEach(cleanup)
