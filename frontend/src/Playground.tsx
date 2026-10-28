import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { detectText, getHealth, type DetectResponse } from './api/detector'
import { DetectionResults } from './components/DetectionResults'
import { HealthStatus } from './components/HealthStatus'
import { TextAnalyzer } from './components/TextAnalyzer'
import { useI18n } from './i18n/context'
import { errorMessage } from './i18n/errors'
import type { Messages } from './i18n/messages'
import { buildHighlightedSegments, InvalidDetectionResponseError } from './domain/detections'

type AnalysisResult = {
  text: string
  response: DetectResponse
}

type ActiveRequest = {
  controller: AbortController
  generation: number
}

type PendingAnalysis = ActiveRequest & {
  text: string
}

function resultScanStatus(layersRun: DetectResponse['layers_run'], messages: Messages) {
  const ranDeterministic = layersRun.includes('deterministic')
  const ranNer = layersRun.includes('ner')

  if (ranDeterministic && ranNer) {
    return { state: 'full', message: messages.fullScan }
  }
  if (ranDeterministic) {
    return { state: 'limited', message: messages.deterministicScan }
  }
  if (ranNer) {
    return { state: 'limited', message: messages.nerScan }
  }
  return { state: 'limited', message: messages.noScan }
}

export function Playground() {
  const { locale, messages, setLocale } = useI18n()
  const [text, setText] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [inFlight, setInFlight] = useState(false)
  const generation = useRef(0)
  const activeRequest = useRef<ActiveRequest | null>(null)
  const pendingAnalyses = useRef(new Map<number, PendingAnalysis>())
  const healthQuery = useQuery({
    queryKey: ['detector-health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 10_000,
  })
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: (requestGeneration: number) => {
      const request = pendingAnalyses.current.get(requestGeneration)
      if (!request) {
        return Promise.reject(new DOMException('Analysis cancelled.', 'AbortError'))
      }
      return detectText({ text: request.text }, request.controller.signal)
    },
    onSuccess: (response, requestGeneration) => {
      const request = pendingAnalyses.current.get(requestGeneration)
      if (!request || requestGeneration !== generation.current) {
        return
      }
      try {
        buildHighlightedSegments(request.text, response.spans)
        setResult({ text: request.text, response })
      } catch (renderError) {
        if (renderError instanceof InvalidDetectionResponseError) {
          setError(renderError)
          return
        }
        throw renderError
      }
    },
    onError: (requestError, requestGeneration) => {
      if (!pendingAnalyses.current.has(requestGeneration) || requestGeneration !== generation.current) {
        return
      }
      setError(requestError)
    },
    onSettled: (_response, _requestError, requestGeneration) => {
      pendingAnalyses.current.delete(requestGeneration)
      if (activeRequest.current?.generation === requestGeneration) {
        activeRequest.current = null
        setInFlight(false)
      }
    },
  })

  function analyze() {
    if (inFlight || text.trim().length === 0) {
      return
    }

    const request: PendingAnalysis = {
      controller: new AbortController(),
      generation: generation.current + 1,
      text,
    }
    generation.current = request.generation
    activeRequest.current = { controller: request.controller, generation: request.generation }
    pendingAnalyses.current.set(request.generation, request)
    mutation.reset()
    setResult(null)
    setError(null)
    setInFlight(true)
    mutation.mutate(request.generation)
  }

  function clear() {
    generation.current += 1
    setText('')
    setResult(null)
    setError(null)
    mutation.reset()
    const request = activeRequest.current
    if (request) {
      pendingAnalyses.current.delete(request.generation)
      request.controller.abort()
    }
  }

  const scanStatus = result && resultScanStatus(result.response.layers_run, messages)

  return (
    <main className="playground">
      <header className="playground__header">
        <div className="playground__brand">
          <p className="playground__wordmark">Tessera</p>
          <h1>{messages.title}</h1>
        </div>
        <div className="playground__controls">
          <label className="language-control">
            Язык / Language
            <select value={locale} onChange={(event) => setLocale(event.target.value === 'ru' ? 'ru' : 'en')}>
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <HealthStatus
            health={healthQuery.data}
            pending={healthQuery.isPending}
            unavailable={healthQuery.isError}
          />
        </div>
      </header>
      <p className="playground__intro">
        {messages.introduction}
      </p>
      <p className="coverage-note" role="note" aria-label={messages.coverageLabel}>
        {messages.coverage}
      </p>
      <TextAnalyzer
        text={text}
        pending={inFlight}
        onTextChange={setText}
        onAnalyze={analyze}
        onClear={clear}
      />
      <section className="analysis-output">
        <div className="analysis-status" role="status" aria-live="polite" aria-atomic="true">
          {inFlight && <p>{messages.analyzing}</p>}
          {!inFlight && !result && !error && <p>{messages.waiting}</p>}
          {result && (
            <p className="result-scan-status" data-state={scanStatus?.state}>{scanStatus?.message}</p>
          )}
        </div>
        {result && <DetectionResults text={result.text} spans={result.response.spans} />}
      </section>
      {error && <p role="alert">{errorMessage(error, locale, messages)}</p>}
    </main>
  )
}
