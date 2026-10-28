import type { DetectorSpan } from '../api/detector'
import {
  buildHighlightedSegments,
  type DetectionLayer,
  InvalidDetectionResponseError,
} from '../domain/detections'

type HighlightedResultProps = {
  text: string
  spans: DetectorSpan[]
  selectedSpan?: Pick<DetectorSpan, 'start' | 'end'> | null
  onSelectSpan?: (span: DetectorSpan) => void
}

function layerLabel(layer: DetectionLayer): string {
  switch (layer) {
    case 'checksum':
      return 'Checksum verified'
    case 'pattern':
      // A catalog rule with no checksum to verify: an e-mail has none, and the
      // Steuernummer's validator is structural. Both say so in the catalog.
      return 'Deterministic pattern'
    case 'ner':
      return 'Model detected'
    case 'other':
      return 'Other recognizer'
  }
}

export function HighlightedResult({ text, spans, selectedSpan, onSelectSpan }: HighlightedResultProps) {
  let segments

  try {
    segments = buildHighlightedSegments(text, spans)
  } catch (error) {
    if (error instanceof InvalidDetectionResponseError) {
      return <p role="alert">{error.message}</p>
    }
    throw error
  }

  if (spans.length === 0) {
    return (
      <>
        <p className="highlighted-result">{text}</p>
        <p>No entities were detected. This does not prove the text contains no personal data.</p>
      </>
    )
  }

  return (
    <p className="highlighted-result">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <span key={index}>{segment.text}</span>
        }

        const label = layerLabel(segment.layer)
        return (
          <mark key={index} data-layer={segment.layer} aria-label={`${segment.text} — ${label}`}>
            {onSelectSpan ? (
              <button
                type="button"
                className="finding-action"
                aria-label={`Show details for ${segment.text} — ${label}`}
                aria-pressed={selectedSpan?.start === segment.span.start && selectedSpan?.end === segment.span.end}
                onClick={() => onSelectSpan(segment.span)}
              >
                {segment.text}
              </button>
            ) : segment.text}
          </mark>
        )
      })}
    </p>
  )
}
