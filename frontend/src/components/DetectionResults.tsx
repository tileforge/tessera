import { useState } from 'react'

import { useI18n } from '../i18n/context'
import type { DetectorSpan } from '../api/detector'
import { DetectionDetails } from './DetectionDetails'
import { HighlightedResult } from './HighlightedResult'
import { PseudonymizedPreview } from './PseudonymizedPreview'

type DetectionResultsProps = {
  text: string
  spans: DetectorSpan[]
}

/** Mounted only for the current accepted result; input edits keep its state. */
export function DetectionResults({ text, spans }: DetectionResultsProps) {
  const { locale, messages } = useI18n()
  const [selectedSpan, setSelectedSpan] = useState<Pick<DetectorSpan, 'start' | 'end'> | null>(null)
  const counts = new Map<string, number>()
  for (const span of spans) {
    counts.set(span.entity_type, (counts.get(span.entity_type) ?? 0) + 1)
  }

  return (
    <>
      <section className="finding-summary" aria-label={messages.summary}>
        <h2>{messages.findingCount(spans.length)}</h2>
        {counts.size > 0 && (
          <ul>
            {Array.from(counts, ([type, count]) => <li key={type}>{type}: {count.toLocaleString(locale)}</li>)}
          </ul>
        )}
      </section>
      <div className="result-previews">
        <section className="submitted-panel" aria-label={messages.submitted}>
          <h2>{messages.submitted}</h2>
          <HighlightedResult
            text={text}
            spans={spans}
            selectedSpan={selectedSpan}
            onSelectSpan={(span) => setSelectedSpan({ start: span.start, end: span.end })}
          />
        </section>
        <PseudonymizedPreview text={text} spans={spans} />
      </div>
      {spans.length > 0 && <DetectionDetails text={text} spans={spans} selectedSpan={selectedSpan} />}
    </>
  )
}
