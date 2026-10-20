import { describe, expect, it } from "vitest"
import { EMOJI } from "../src/complete/emojiData.ts"

const REQUIRED = (
  "+1 thumbsup -1 100 tada fire eyes rocket rose rofl rolling_eyes robot heart star sparkles warning white_check_mark check x " +
  "question exclamation bulb pushpin memo dart trophy medal crown zap boom shrug facepalm rotating_light red_circle " +
  "green_circle hourglass alarm_clock stopwatch video_game joystick soccer basketball crossed_swords shield clapper movie_camera"
).split(" ")

describe("emoji data", () => {
  const names = EMOJI.flatMap(([, ...n]) => n)

  it("is a curated set", () => {
    expect(EMOJI.length).toBeGreaterThanOrEqual(300)
    expect(EMOJI.length).toBeLessThanOrEqual(600)
  })

  it("has one grapheme per glyph and no leading FE0F", () => {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    for (const [glyph, name] of EMOJI) {
      expect([...seg.segment(glyph)], name).toHaveLength(1)
      expect(glyph.startsWith("️"), name).toBe(false)
    }
  })

  it("uses unique gemoji-style names and unique glyphs", () => {
    for (const n of names) expect(n).toMatch(/^[a-z0-9_+-]+$/)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(EMOJI.map(([g]) => g)).size).toBe(EMOJI.length)
  })

  it("has the required names", () => {
    expect(names).toEqual(expect.arrayContaining(REQUIRED))
  })
})
