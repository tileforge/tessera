import { useEffect, useId, useRef, useState } from 'react'

import type { DetectorSpan } from '../api/detector'
import { classifyRecognizer, type DetectionLayer } from '../domain/detections'

type DetectionDetailsProps = {
  text: string
  spans: DetectorSpan[]
  selectedSpan?: Pick<DetectorSpan, 'start' | 'end'> | null
}

const confidenceFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})

function layerLabel(layer: DetectionLayer): string {
  switch (layer) {
    case 'checksum':
      return 'Checksum verified'
    case 'pattern':
      // An e-mail has no checksum to verify and the Steuernummer's validator is
      // structural, so both are catalog rules that carry no arithmetic proof.
      // Saying otherwise overstates the evidence, which is the one thing this
      // column exists to get right.
      return 'Deterministic pattern'
    case 'ner':
      return 'Model detected'
    case 'other':
      return 'Other recognizer'
  }
}

function fragmentFor(codePoints: string[], span: DetectorSpan): string {
  return codePoints.slice(span.start, span.end).join('')
}

export function DetectionDetails({ text, spans, selectedSpan }: DetectionDetailsProps) {
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
        {showTechnical ? 'Hide technical details' : 'Show technical details'}
      </button>
      <table id={tableId} className="detection-details">
        <caption>Detection details</caption>
        <thead>
          <tr>
            <th scope="col">Fragment</th>
            <th scope="col">Entity type</th>
            <th scope="col">Layer</th>
            <th scope="col">Confidence</th>
            {showTechnical && <>
              <th scope="col">Tier</th>
              <th scope="col">Recognizer</th>
              <th scope="col">Context</th>
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
              <td data-label="Fragment">{fragmentFor(codePoints, span)}</td>
              <td data-label="Entity type">{span.entity_type}</td>
              <td data-label="Layer">{layerLabel(classifyRecognizer(span.recognizer, span.confidence))}</td>
              <td data-label="Confidence">
                <span aria-label={`Confidence ${span.confidence}`}>
                  {confidenceFormatter.format(span.confidence)}
                </span>
              </td>
              {showTechnical && <>
                <td data-label="Tier">{span.tier}</td>
                <td data-label="Recognizer">{span.recognizer}</td>
                <td data-label="Context">Context boosted: {span.boosted ? 'yes' : 'no'}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
