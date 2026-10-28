import type { DetectorSpan } from '../api/detector'
import { buildHighlightedSegments } from './detections'

// Bounded to the current catalogs. New or arbitrary detector metadata must not
// become part of the text the user copies.
const supportedTypes = new Set([
  'IBAN', 'CREDIT_CARD', 'CH_AVS', 'FR_NIR', 'DE_STEUER_ID', 'FR_NIF', 'EMAIL',
  'DE_STEUERNUMMER', 'PERSON', 'LOCATION', 'ORG', 'HEALTH', 'BIOMETRIC', 'GENETIC',
  'ETHNICITY', 'POLITICAL_AFFILIATION', 'POLITICAL_OPINION', 'RELIGION', 'TRADE_UNION',
  'SEXUAL_ORIENTATION', 'PHILOSOPHICAL_BELIEF', 'SEX_LIFE',
])

export function buildPseudonymizedText(text: string, spans: DetectorSpan[]): string {
  const replacements = new Map<string, Map<string, string>>()
  const counters = new Map<string, number>()

  return buildHighlightedSegments(text, spans).map((segment) => {
    if (segment.kind === 'text') {
      return segment.text
    }

    const type = segment.span.entity_type
    const label = supportedTypes.has(type) ? type : 'ENTITY'
    let values = replacements.get(type)
    if (!values) {
      values = new Map()
      replacements.set(type, values)
    }
    const existing = values.get(segment.text)
    if (existing) {
      return existing
    }

    let number = counters.get(label) ?? 0
    let token: string
    do {
      number += 1
      token = `[${label}_${number}]`
    } while (text.includes(token))
    counters.set(label, number)
    values.set(segment.text, token)
    return token
  }).join('')
}
