import { describe, expect, it } from 'vitest'

import type { DetectorSpan } from '../api/detector'
import { InvalidDetectionResponseError } from './detections'
import { buildPseudonymizedText } from './pseudonymization'

function span(start: number, end: number, entity_type = 'PERSON'): DetectorSpan {
  return { start, end, entity_type, confidence: 0.91, recognizer: 'ner:gliner', tier: 2, boosted: false }
}

describe('buildPseudonymizedText', () => {
  // A UTF-16 slice or whitespace normalization would corrupt this output.
  it('replaces Unicode code-point spans while preserving untouched whitespace', () => {
    expect(buildPseudonymizedText('🙂 Zoë\n\t東京  ', [span(2, 5), span(7, 9, 'LOCATION')]))
      .toBe('🙂 [PERSON_1]\n\t[LOCATION_1]  ')
  })

  it('numbers per type in text order and reuses exact values within a result', () => {
    expect(buildPseudonymizedText('Ada Bern Ada ada', [
      span(13, 16), span(9, 12), span(4, 8, 'LOCATION'), span(0, 3),
    ])).toBe('[PERSON_1] [LOCATION_1] [PERSON_1] [PERSON_2]')
    expect(buildPseudonymizedText('Bea', [span(0, 3)])).toBe('[PERSON_1]')
    expect(buildPseudonymizedText('Ada Ada', [span(0, 3), span(4, 7, 'LOCATION')]))
      .toBe('[PERSON_1] [LOCATION_1]')
  })

  it('skips every replacement token literally present in the original text', () => {
    expect(buildPseudonymizedText('Ada Bea Ada [PERSON_1] [PERSON_3]', [
      span(0, 3), span(4, 7), span(8, 11),
    ])).toBe('[PERSON_2] [PERSON_4] [PERSON_2] [PERSON_1] [PERSON_3]')
  })

  it.each(['SECRET_VALUE', 'Ada private metadata', 'PERSON]\n[unsafe', '', 'person'])(
    'uses ENTITY for unsupported or unsafe label %j', (label) => {
      expect(buildPseudonymizedText('Ada', [span(0, 3, label)])).toBe('[ENTITY_1]')
    },
  )

  it('keeps distinct unsupported types separate even when their display label is ENTITY', () => {
    expect(buildPseudonymizedText('Ada Ada Ada', [
      span(0, 3, 'UNKNOWN_A'), span(4, 7, 'UNKNOWN_B'), span(8, 11, 'UNKNOWN_A'),
    ])).toBe('[ENTITY_1] [ENTITY_2] [ENTITY_1]')
  })

  it.each([
    [span(-1, 2)], [span(0, 99)], [span(1, 1)], [span(0.5, 2)],
    [span(0, 2), span(1, 3)],
  ])('fails closed on invalid spans %j', (...spans) => {
    expect(() => buildPseudonymizedText('abc', spans)).toThrow(InvalidDetectionResponseError)
  })

  it('returns unchanged text when no spans were detected', () => {
    expect(buildPseudonymizedText('🙂\n  unchanged', [])).toBe('🙂\n  unchanged')
    expect(buildPseudonymizedText('', [])).toBe('')
  })
})
