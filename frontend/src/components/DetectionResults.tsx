import { useState } from 'react'

import { useI18n } from '../i18n/context'
import type { DetectorSpan } from '../api/detector'
import { classifyRecognizer, type DetectionLayer } from '../domain/detections'
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
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<DetectionLayer | null>(null)
  const counts = new Map<string, number>()
  for (const span of spans) {
    counts.set(span.entity_type, (counts.get(span.entity_type) ?? 0) + 1)
  }

  const types = Array.from(counts.keys())
  const typeLabels = types.map((type) => type === '' ? messages.emptyType : type)
  // Native option labels collapse ASCII whitespace. Prefix every type on a
  // collision so raw, fallback and already prefixed labels remain distinguishable.
  const optionLabels = [messages.allTypes, ...typeLabels].map((label) => (
    label.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '')
  ))
  const disambiguateTypes = new Set(optionLabels).size !== optionLabels.length
  const methods: DetectionLayer[] = ['checksum', 'pattern', 'ner', 'other']
  const availableMethods = new Set(spans.map((span) => classifyRecognizer(span.recognizer, span.confidence)))
  const matchesFilters = (span: DetectorSpan) => (
    (selectedType === null || span.entity_type === selectedType)
    && (selectedMethod === null || classifyRecognizer(span.recognizer, span.confidence) === selectedMethod)
  )
  const visibleSpans = spans.filter(matchesFilters)

  function resetFilters() {
    setSelectedType(null)
    setSelectedMethod(null)
    setSelectedSpan(null)
  }

  function selectSpan(span: DetectorSpan) {
    if (!matchesFilters(span)) {
      setSelectedType(null)
      setSelectedMethod(null)
    }
    // A fresh coordinate object also refocuses an already selected finding.
    setSelectedSpan({ start: span.start, end: span.end })
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
            onSelectSpan={selectSpan}
          />
        </section>
        <PseudonymizedPreview text={text} spans={spans} />
      </div>
      {spans.length > 0 && <>
        <fieldset className="finding-filters">
          <legend>{messages.filterDetails}</legend>
          <div className="finding-filters__controls">
            <label>
              {messages.filterType}
              <select
                value={selectedType === null ? 'all' : `type-${types.indexOf(selectedType)}`}
                onChange={(event) => {
                  const value = event.target.value
                  setSelectedType(value === 'all' ? null : types[Number(value.slice(5))])
                  setSelectedSpan(null)
                }}
              >
                <option value="all">{messages.allTypes}</option>
                {typeLabels.map((label, index) => (
                  <option key={index} value={`type-${index}`}>{disambiguateTypes ? `${index + 1}. ${label}` : label}</option>
                ))}
              </select>
            </label>
            <label>
              {messages.filterMethod}
              <select
                value={selectedMethod ?? 'all'}
                onChange={(event) => {
                  setSelectedMethod(methods.find((method) => method === event.target.value) ?? null)
                  setSelectedSpan(null)
                }}
              >
                <option value="all">{messages.allMethods}</option>
                {methods.filter((method) => availableMethods.has(method)).map((method) => (
                  <option key={method} value={method}>{messages.layers[method]}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={resetFilters}>{messages.resetFilters}</button>
          </div>
          <p className="filter-note">{messages.filterScope}</p>
          <p className="filter-count" role="status">{messages.shownFindings(visibleSpans.length, spans.length)}</p>
          {visibleSpans.length === 0 && <p>{messages.noFilterMatches}</p>}
        </fieldset>
        <DetectionDetails text={text} spans={visibleSpans} selectedSpan={selectedSpan} />
      </>}
    </>
  )
}
