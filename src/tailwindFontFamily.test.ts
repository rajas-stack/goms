import { describe, expect, it } from 'vitest'
import tailwindConfig from '../tailwind.config'

// Locks in the global font-family swap away from Bricolage Grotesque: every
// `font-display`/`font-sans` Tailwind class site (headings, body text — see
// tailwind.config.ts's comment) must resolve to IBM Plex Sans. Weight is a
// separate concern (`font-bold` etc. — see Home.test.tsx/Landing.test.tsx),
// this only checks the face itself.
describe('tailwind font-family', () => {
  it('uses IBM Plex Sans for both the display (heading) and sans (body) faces', () => {
    const fontFamily = tailwindConfig.theme?.extend?.fontFamily as Record<string, string[]> | undefined
    expect(fontFamily?.display?.[0]).toBe('"IBM Plex Sans"')
    expect(fontFamily?.sans?.[0]).toBe('"IBM Plex Sans"')
  })

  it('no longer references Bricolage Grotesque anywhere in the font stack', () => {
    const fontFamily = tailwindConfig.theme?.extend?.fontFamily as Record<string, string[]> | undefined
    const allFaces = Object.values(fontFamily ?? {}).flat()
    expect(allFaces.some((f) => f.includes('Bricolage'))).toBe(false)
  })
})
