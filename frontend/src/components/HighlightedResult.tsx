import { errorMessage } from '../i18n/errors'
import { useI18n } from '../i18n/context'
import type { DetectorSpan } from '../api/detector'
import {
  buildHighlightedSegments,
  InvalidDetectionResponseError,
} from '../domain/detections'

type HighlightedResultProps = {
  text: string
  spans: DetectorSpan[]
  selectedSpan?: Pick<DetectorSpan, 'start' | 'end'> | null
  onSelectSpan?: (span: DetectorSpan) => void
}

export function HighlightedResult({ text, spans, selectedSpan, onSelectSpan }: HighlightedResultProps) {
  const { locale, messages } = useI18n()
  let segments

  try {
    segments = buildHighlightedSegments(text, spans)
  } catch (error) {
    if (error instanceof InvalidDetectionResponseError) {
      return <p role="alert">{errorMessage(error, locale, messages)}</p>
    }
    throw error
  }

  if (spans.length === 0) {
    return (
      <>
        <p className="highlighted-result">{text}</p>
        <p>{messages.noFindings}</p>
      </>
    )
  }

  return (
    <p className="highlighted-result">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return <span key={index}>{segment.text}</span>
        }

        const label = messages.layers[segment.layer]
        return (
          <mark
            key={index}
            className={onSelectSpan ? 'finding-highlight' : undefined}
            data-layer={segment.layer}
            aria-label={`${segment.text} — ${label}`}
          >
            {onSelectSpan ? (
              <button
                type="button"
                className="finding-action"
                aria-label={messages.showDetails(segment.text, label)}
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
