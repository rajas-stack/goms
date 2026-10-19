import { describe, expect, it } from 'vitest'
import { driveFolderId, matchPhoto } from './salesPhotoMatch'

const files = [{ id: '1', name: 'Ashish Desai.jpg' }, { id: '2', name: 'desai_pawan.png' }, { id: '3', name: 'Sanjay K Sharma.jpeg' }, { id: '4', name: 'Ravi.jpg' }, { id: '5', name: 'Ravi (1).jpg' }]

describe('matchPhoto', () => {
  it('matches all name words in any order and separator', () => {
    expect(matchPhoto('Ashish Desai', files)?.id).toBe('1')
    expect(matchPhoto('Pawan Desai', files)?.id).toBe('2')
  })
  it('falls back to first + last name', () => expect(matchPhoto('Sanjay Sharma', files)?.id).toBe('3'))
  it('leaves ambiguous or unknown people unmatched', () => {
    expect(matchPhoto('Nobody Here', files)).toBeUndefined()
  })
})

describe('driveFolderId', () => {
  it('reads a folder link', () => expect(driveFolderId('https://drive.google.com/drive/folders/19nqxKqXXBI1tgaZekdkvRougTDAmAAll?usp=drive_link')).toBe('19nqxKqXXBI1tgaZekdkvRougTDAmAAll'))
})
