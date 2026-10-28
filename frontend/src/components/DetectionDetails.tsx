import { useEffect, useId, useRef, useState } from 'react'

import { useI18n } from '../i18n/context'
import type { DetectorSpan } from '../api/detector'
import { classifyRecognizer } from '../domain/detections'

type DetectionDetailsProps = {
  text: string
  spans: DetectorSpan[]
  selectedSpan?: Pick<DetectorSpan, 'start' | 'end'> | null
}

function fragmentFor(codePoints: string[], span: DetectorSpan): string {
  return codePoints.slice(span.start, span.end).join('')
}

export function DetectionDetails({ text, spans, selectedSpan }: DetectionDetailsProps) {
  const { locale, messages } = useI18n()
  const confidenceFormatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const [showTechnical, setShowTechnical] = useState(false)
  const tableId = useId()
  const rows = useRef(new Map<string, HTMLTableRowElement>())

  useEffect(() => {
    if (!selectedSpan) return
    const row = rows.current.get(`${selectedSpan.start}:${selectedSpan.end}`)
    row?.focus()
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' })
  }, [selectedSpan])
  // Split once, not once per row. The detector reports character offsets, so
  // the text has to be read as code points — and doing that inside the loop
  // re-walked the whole document for every span it found.
  const codePoints = Array.from(text)

  return (
    <div className="detection-details-panel">
      <button
        type="button"
        className="technical-toggle"
        aria-expanded={showTechnical}
        aria-controls={tableId}
        onClick={() => setShowTechnical(!showTechnical)}
      >
        {showTechnical ? messages.hideTechnical : messages.showTechnical}
      </button>
      <table id={tableId} className="detection-details">
        <caption>{messages.details}</caption>
        <thead>
          <tr>
            <th scope="col">{messages.fragment}</th>
            <th scope="col">{messages.entityType}</th>
            <th scope="col">{messages.layer}</th>
            <th scope="col">{messages.confidence}</th>
            {showTechnical && <>
              <th scope="col">{messages.tier}</th>
              <th scope="col">{messages.recognizer}</th>
              <th scope="col">{messages.context}</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {spans.map((span, index) => (
            <tr
              key={`${span.start}-${span.end}-${span.recognizer}-${index}`}
              ref={(row) => {
                const key = `${span.start}:${span.end}`
                if (row) rows.current.set(key, row)
                else rows.current.delete(key)
              }}
              tabIndex={-1}
              aria-current={selectedSpan?.start === span.start && selectedSpan?.end === span.end ? 'true' : undefined}
            >
              <td data-label={messages.fragment}>{fragmentFor(codePoints, span)}</td>
              <td data-label={messages.entityType}>{span.entity_type}</td>
              <td data-label={messages.layer}>{messages.layers[classifyRecognizer(span.recognizer, span.confidence)]}</td>
              <td data-label={messages.confidence}>
                <span aria-label={`${messages.confidence} ${span.confidence}`}>
                  {confidenceFormatter.format(span.confidence)}
                </span>
              </td>
              {showTechnical && <>
                <td data-label={messages.tier}>{span.tier}</td>
                <td data-label={messages.recognizer}>{span.recognizer}</td>
                <td data-label={messages.context}>{messages.contextBoosted} {span.boosted ? messages.yes : messages.no}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
