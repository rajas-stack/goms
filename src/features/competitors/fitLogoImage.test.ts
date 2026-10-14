import { describe, expect, it } from 'vitest'
import { contentBox } from './fitLogoImage'

/** A width×height RGBA image filled with `bg`, with `ink` painted over the given rectangle. */
function image(width: number, height: number, bg: number[], ink?: { x: number; y: number; w: number; h: number; colour: number[] }) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = ink && x >= ink.x && x < ink.x + ink.w && y >= ink.y && y < ink.y + ink.h
      data.set(inside ? ink.colour : bg, (y * width + x) * 4)
    }
  }
  return data
}

describe('contentBox', () => {
  it('trims a transparent margin down to the mark', () => {
    const data = image(20, 10, [0, 0, 0, 0], { x: 5, y: 2, w: 8, h: 4, colour: [10, 20, 200, 255] })
    expect(contentBox(data, 20, 10)).toEqual({ left: 5, top: 2, right: 12, bottom: 5 })
  })

  it('trims a flat white margin, tolerating slight JPEG noise', () => {
    const data = image(30, 12, [252, 253, 250, 255], { x: 3, y: 4, w: 20, h: 3, colour: [200, 0, 0, 255] })
    expect(contentBox(data, 30, 12)).toEqual({ left: 3, top: 4, right: 22, bottom: 6 })
  })

  it('keeps the whole image when the corners disagree (logo fills the frame)', () => {
    const data = image(8, 8, [255, 255, 255, 255], { x: 0, y: 0, w: 4, h: 8, colour: [0, 0, 0, 255] })
    expect(contentBox(data, 8, 8)).toEqual({ left: 0, top: 0, right: 7, bottom: 7 })
  })

  it('returns null for a blank image', () => {
    expect(contentBox(image(6, 6, [255, 255, 255, 255]), 6, 6)).toBeNull()
  })
})
