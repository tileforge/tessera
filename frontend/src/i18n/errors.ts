import { DetectorApiError, getDetectorFailureKind } from '../api/detector'
import { InvalidDetectionResponseError } from '../domain/detections'
import type { Locale, Messages } from './messages'

/** Translate app-authored errors here; documented detector diagnostics remain raw. */
export function errorMessage(error: Error, locale: Locale, messages: Messages): string {
  if (error instanceof InvalidDetectionResponseError) return messages.invalidOffsets
  if (error instanceof DetectorApiError) {
    const kind = getDetectorFailureKind(error)
    if (kind) return messages[kind]
    return error.message
  }
  // Retain the established English network error presentation for callers.
  return locale === 'en' ? error.message : messages.networkFailed
}
