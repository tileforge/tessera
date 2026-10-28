import type { paths } from './generated'

export type HealthResponse = paths['/health']['get']['responses'][200]['content']['application/json']
export type DetectRequest = paths['/detect']['post']['requestBody']['content']['application/json']
export type DetectResponse = paths['/detect']['post']['responses'][200]['content']['application/json']
export type DetectorSpan = DetectResponse['spans'][number]
export type DetectorErrorDetail = paths['/detect']['post']['responses'][503]['content']['application/json']

const applicationMessages = {
  requestFailed: 'Detector request failed.',
  invalidResponse: 'Detector returned an invalid response.',
}
const applicationFailures = new WeakMap<DetectorApiError, keyof typeof applicationMessages>()

export class DetectorApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DetectorApiError'
  }
}

/** App failure provenance without changing the public error constructor or messages. */
export function getDetectorFailureKind(error: DetectorApiError) {
  return applicationFailures.get(error)
}

function applicationError(kind: keyof typeof applicationMessages): DetectorApiError {
  const error = new DetectorApiError(applicationMessages[kind])
  applicationFailures.set(error, kind)
  return error
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isDetectorErrorDetail(value: unknown): value is DetectorErrorDetail {
  return isObject(value) && typeof value.detail === 'string'
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return isObject(value)
    && value.status === 'ok'
    && typeof value.ner === 'boolean'
    && (typeof value.ner_off_reason === 'string' || value.ner_off_reason === null)
}

export function isDetectorSpan(value: unknown): value is DetectorSpan {
  if (!isObject(value)) {
    return false
  }

  return isInteger(value.start)
    && value.start >= 0
    && isInteger(value.end)
    // Exclusive, and the schema gives it a minimum of 1: a span covering no
    // characters is not a detection. `end >= start` alone admitted `0, 0`,
    // which the guard then called a valid span and the renderer rejected
    // later — two places disagreeing about the contract, with the one that
    // says "this is a `DetectorSpan`" being the wrong one to be lenient.
    && value.end >= 1
    && value.end > value.start
    && typeof value.entity_type === 'string'
    && typeof value.recognizer === 'string'
    && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && isInteger(value.tier)
    && value.tier >= 1
    && value.tier <= 3
    && (value.boosted === undefined || typeof value.boosted === 'boolean')
}

export function isDetectResponse(value: unknown): value is DetectResponse {
  return isObject(value)
    && Array.isArray(value.spans)
    && value.spans.every(isDetectorSpan)
    && isStringArray(value.layers_run)
    && value.layers_run.every((layer) => layer === 'deterministic' || layer === 'ner')
    && typeof value.version === 'string'
}

function normalizeDetectResponse(response: DetectResponse): DetectResponse {
  return {
    ...response,
    spans: response.spans.map((span) => ({ ...span, boosted: span.boosted ?? false })),
  }
}

async function requestFailure(response: Response): Promise<DetectorApiError> {
  try {
    const value: unknown = await response.json()
    if (isDetectorErrorDetail(value) && value.detail.trim() !== '') {
      return new DetectorApiError(value.detail)
    }
  } catch {
    // A server failure without the documented JSON detail uses fixed safe copy.
  }

  return applicationError('requestFailed')
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  isExpectedResponse: (value: unknown) => value is T,
): Promise<T> {
  const response = await fetch(url, init)

  if (!response.ok) {
    throw await requestFailure(response)
  }

  try {
    const value: unknown = await response.json()
    if (!isExpectedResponse(value)) {
      throw applicationError('invalidResponse')
    }
    return value
  } catch (error) {
    if (error instanceof DetectorApiError) {
      throw error
    }
    throw applicationError('invalidResponse')
  }
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson('/api/health', { signal }, isHealthResponse)
}

export async function detectText(
  request: DetectRequest,
  signal?: AbortSignal,
): Promise<DetectResponse> {
  const response = await requestJson('/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  }, isDetectResponse)

  return normalizeDetectResponse(response)
}
