import { describe, expect, it } from "vitest"
import { formatTime, formatTimestamp, parseTimestamp } from "../src/timestamps/format.ts"
import { createPillDom } from "../src/timestamps/pillDom.ts"

describe("timestamp format", () => {
  it("formats times", () => {
    const cases: [number, string][] = [
      [0, "0:00"], [5.9, "0:05"], [83.9, "1:23"], [754, "12:34"], [3599, "59:59"],
      [3600, "1:00:00"], [3723, "1:02:03"], [36000, "10:00:00"], [-5, "0:00"], [NaN, "0:00"],
    ]
    for (const [s, text] of cases) expect(formatTime(s)).toBe(text)
    expect(formatTimestamp(83)).toBe("@[1:23]")
  })

  it("parses times", () => {
    expect(parseTimestamp("@[1:23]")).toBe(83)
    expect(parseTimestamp("1:23")).toBe(83)
    expect(parseTimestamp("@[1:02:03]")).toBe(3723)
    for (const bad of ["1:75", "0:5", "0:99:99", "abc", "@[1:2]"]) expect(parseTimestamp(bad)).toBe(null)
  })

  it("round trips", () => {
    for (let s = 0; s <= 40000; s += 37) expect(parseTimestamp(formatTimestamp(s))).toBe(s)
  })
})

describe("pill dom", () => {
  it("builds a pill with an icon", () => {
    const pill = createPillDom("1:23", "Jump to 1:23", "i.svg")
    expect(pill.className).toBe("md-ts")
    expect(pill.getAttribute("role")).toBe("button")
    expect(pill.dataset.seconds).toBe("83")
    expect(pill.getAttribute("aria-label")).toBe("Jump to 1:23")
    expect(pill.textContent).toBe("1:23")
    expect(pill.querySelectorAll(".md-icon").length).toBe(1)
  })

  it("builds a pill without an icon", () => {
    const pill = createPillDom("1:23", "Jump to 1:23")
    expect(pill.querySelector("span")).toBe(null)
    expect(pill.textContent).toBe("1:23")
  })
})
