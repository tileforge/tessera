import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { server } from './test/server'

const fullHealth = { status: 'ok' as const, ner: true, ner_off_reason: null }
const personResponse = {
  spans: [{
    entity_type: 'PERSON', start: 0, end: 13, confidence: 0.91,
    recognizer: 'ner:gliner', tier: 2, boosted: false,
  }],
  layers_run: ['deterministic', 'ner'],
  version: 'test-version',
}
const emptyResponse = {
  spans: [],
  layers_run: ['deterministic', 'ner'],
  version: 'test-version',
}
const deterministicOnlyResponse = {
  spans: [],
  layers_run: ['deterministic'],
  version: 'test-version',
}

function renderApp(queryClient?: QueryClient) {
  return render(<App queryClient={queryClient} />)
}

describe('local detector playground', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/health', () => HttpResponse.json(fullHealth)),
      http.post('/api/detect', () => HttpResponse.json(emptyResponse)),
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('counts occurrences by arbitrary type without interpreting labels as markup', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json({
      ...emptyResponse,
      // Code points: emoji 0, spaces 1/5/9/11, Ana 2–5 and 6–9, X 10–11, Y 12–13.
      spans: [
        { ...personResponse.spans[0], start: 6, end: 9 },
        { ...personResponse.spans[0], start: 2, end: 5 },
        { ...personResponse.spans[0], start: 10, end: 11, entity_type: '__proto__' },
        { ...personResponse.spans[0], start: 12, end: 13, entity_type: '<img src=x>' },
      ],
    })))
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), '🙂 Ana Ana X Y')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    const summary = await screen.findByRole('region', { name: 'Finding summary' })
    expect(within(summary).getByRole('heading')).toHaveTextContent('4 findings')
    expect(within(summary).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['PERSON: 2', '__proto__: 1', '<img src=x>: 1'])
    expect(within(summary).queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows zero findings while preserving the unchanged snapshot and caveat', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), '🙂 unchanged')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    const summary = await screen.findByRole('region', { name: 'Finding summary' })
    expect(within(summary).getByRole('heading')).toHaveTextContent('0 findings')
    expect(within(summary).queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText(/No entities were detected/)).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Pseudonymized preview' })).getByText('🙂 unchanged')).toBeVisible()
  })

  it('focuses the correct occurrence for unordered duplicate fragments by mouse and keyboard', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json({
      ...personResponse,
      spans: [
        { ...personResponse.spans[0], start: 6, end: 9, confidence: 0.82 },
        { ...personResponse.spans[0], start: 2, end: 5 },
      ],
    })))
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), '🙂 Ana Ana')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    const actions = await screen.findAllByRole('button', { name: /Show details for Ana/ })
    const rows = within(screen.getByRole('table', { name: 'Detection details' })).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByLabelText('Confidence 0.82')).toBeVisible()
    expect(within(rows[1]).getByLabelText('Confidence 0.91')).toBeVisible()
    await user.click(actions[0])
    expect(document.activeElement).toBe(rows[1])
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(actions[0]).toHaveAttribute('aria-pressed', 'true')
    actions[1].focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(rows[0])
    expect(rows[1]).not.toHaveAttribute('aria-current')
    expect(actions[0]).toHaveAttribute('aria-pressed', 'false')
    actions[0].focus()
    await user.keyboard(' ')
    expect(document.activeElement).toBe(rows[1])
    // Re-activating the selected finding must still transfer focus.
    actions[0].focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(rows[1])
  })

  it('keeps only primary detail columns until technical disclosure is expanded', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json(personResponse)))
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    const toggle = await screen.findByRole('button', { name: 'Show technical details' })
    const table = screen.getByRole('table', { name: 'Detection details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.getAttribute('aria-controls')).toBe(table.id)
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['Fragment', 'Entity type', 'Layer', 'Confidence'])
    expect(within(table).queryByText('ner:gliner')).not.toBeInTheDocument()
    expect(within(table).getAllByRole('cell')).toHaveLength(4)
    await user.click(toggle)
    expect(toggle).toHaveAccessibleName('Hide technical details')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['Fragment', 'Entity type', 'Layer', 'Confidence', 'Tier', 'Recognizer', 'Context'])
    expect(within(table).getByText('ner:gliner')).toBeVisible()
    await user.click(toggle)
    expect(within(table).getAllByRole('cell')).toHaveLength(4)
  })

  it('retains selection and disclosure on edits and resets both for analysis, invalid results and Clear', async () => {
    let calls = 0
    server.use(http.post('/api/detect', async () => {
      calls += 1
      if (calls === 2) await delay(50)
      return HttpResponse.json(calls === 3 ? {
        ...personResponse, spans: [{ ...personResponse.spans[0], end: 99 }],
      } : personResponse)
    }))
    const user = userEvent.setup()
    renderApp()
    const input = screen.getByLabelText(/Text to inspect/i)
    const analyze = screen.getByRole('button', { name: /Analyze text/i })
    await user.type(input, 'Martina Weber')
    await user.click(analyze)
    await user.click(await screen.findByRole('button', { name: /Show details for Martina Weber/ }))
    const selectedRow = document.activeElement
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    await user.type(input, ' edited')
    expect(selectedRow).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('region', { name: 'Submitted text' })).getByRole('mark')).toHaveTextContent('Martina Weber')
    await user.click(analyze)
    expect(screen.queryByRole('region', { name: 'Finding summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Show technical details' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('row').every((row) => !row.hasAttribute('aria-current'))).toBe(true)
    await user.click(screen.getByRole('button', { name: /Show details for Martina Weber/ }))
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    await user.click(analyze)
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid span offsets')
    expect(screen.queryByRole('region', { name: 'Finding summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await user.click(analyze)
    await user.click(await screen.findByRole('button', { name: /Show details for Martina Weber/ }))
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('region', { name: 'Finding summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await user.type(input, 'Martina Weber')
    await user.click(analyze)
    expect(await screen.findByRole('button', { name: 'Show technical details' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('row').every((row) => !row.hasAttribute('aria-current'))).toBe(true)
  })

  it('announces analysis status without wrapping interactive findings in the atomic live region', async () => {
    server.use(http.post('/api/detect', async () => {
      await delay(100)
      return HttpResponse.json(personResponse)
    }))
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    const liveStatus = (await screen.findByText('Analyzing text…')).closest('[aria-live]')!
    expect(liveStatus).toHaveAttribute('aria-live', 'polite')
    expect(liveStatus).toHaveAttribute('aria-atomic', 'true')
    const toggle = await screen.findByRole('button', { name: 'Show technical details' })
    expect(liveStatus).toHaveTextContent('Full scan: deterministic + NER')
    expect(liveStatus).not.toContainElement(toggle)
    expect(liveStatus).not.toContainElement(screen.getByRole('region', { name: 'Finding summary' }))
    expect(liveStatus).not.toContainElement(screen.getByRole('table'))
    const highlight = screen.getByRole('button', { name: /Show details for Martina Weber/ })
    expect(highlight.closest('[aria-live]')).toBeNull()
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAccessibleName('Hide technical details')
    expect(screen.getByRole('columnheader', { name: 'Recognizer' })).toBeVisible()
    expect(liveStatus).toHaveTextContent('Full scan: deterministic + NER')
    highlight.focus()
    await user.keyboard(' ')
    expect(document.activeElement).toBe(screen.getAllByRole('row')[1])
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(liveStatus).toHaveTextContent('Detections will appear here after you analyze text.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /technical details/ })).not.toBeInTheDocument()
  })

  it('analyzes a non-empty snapshot while omitting layers', async () => {
    let received: unknown
    server.use(
      http.post('/api/detect', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json(personResponse)
      }),
    )
    const user = userEvent.setup()

    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByRole('cell', { name: 'Model detected' })).toBeVisible()
    expect(received).toEqual({ text: 'Martina Weber' })
  })

  it('keeps coverage visible before analysis and after Clear', async () => {
    const user = userEvent.setup()
    renderApp()
    const coverage = screen.getByRole('note', { name: 'Detection coverage' })
    expect(coverage).toHaveTextContent(/emails.*financial.*tax/i)
    expect(coverage).toHaveTextContent(/NER.*names.*locations.*organizations.*sensitive/i)
    expect(coverage).toHaveTextContent(/capabilities.*guarantees/i)
    expect(coverage).toHaveTextContent(/Phone numbers are not currently supported/i)
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    expect(coverage).toBeVisible()
  })

  it('retains the submitted preview while editing and removes it immediately for a new analysis', async () => {
    let calls = 0
    server.use(http.post('/api/detect', async () => {
      calls += 1
      if (calls > 1) await delay(100)
      return HttpResponse.json(calls === 1 ? personResponse : emptyResponse)
    }))
    const user = userEvent.setup()
    renderApp()
    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    const preview = await screen.findByRole('region', { name: 'Pseudonymized preview' })
    expect(within(preview).getByText('[PERSON_1]')).toBeVisible()
    await user.clear(input)
    await user.type(input, 'Edited input')
    expect(within(preview).getByText('[PERSON_1]')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    expect(screen.queryByRole('region', { name: 'Pseudonymized preview' })).not.toBeInTheDocument()
    expect(await screen.findByText(/No replacements were made/i)).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Pseudonymized preview' })).getByText('Edited input')).toBeVisible()
  })

  it.each(['resolve', 'reject'])('does not restore late clipboard %s after Clear', async (outcome) => {
    server.use(http.post('/api/detect', () => HttpResponse.json(personResponse)))
    const user = userEvent.setup()
    let finish!: () => void
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => new Promise<void>((resolve, reject) => {
        finish = () => outcome === 'resolve' ? resolve() : reject(new Error('private detail'))
      }) },
    })
    renderApp()
    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await user.click(await screen.findByRole('button', { name: 'Copy preview' }))
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    await act(async () => finish())
    expect(screen.queryByRole('region', { name: 'Pseudonymized preview' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Preview copied|Could not copy|private detail/)).not.toBeInTheDocument()
  })

  it('keeps Analyze disabled for whitespace-only text', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(/Text to inspect/i), '   ')

    expect(screen.getByRole('button', { name: /Analyze text/i })).toBeDisabled()
  })

  it('allows analysis when the health check is unavailable', async () => {
    server.use(http.get('/api/health', () => HttpResponse.json(
      { detail: 'The health check is unavailable.' }, { status: 503 },
    )))
    const user = userEvent.setup()
    renderApp()

    await screen.findByText('Detector unavailable.')
    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina')

    expect(screen.getByRole('button', { name: /Analyze text/i })).toBeEnabled()
  })

  it('disables only duplicate analysis while a request is pending', async () => {
    server.use(http.post('/api/detect', async () => {
      await delay(100)
      return HttpResponse.json(emptyResponse)
    }))
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(screen.getByRole('button', { name: /Analyze text/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Clear/i })).toBeEnabled()
    expect(screen.getByLabelText(/Text to inspect/i)).toBeEnabled()
  })

  it('renders the submitted snapshot when input changes during a response', async () => {
    server.use(http.post('/api/detect', async () => {
      await delay(100)
      return HttpResponse.json(personResponse)
    }))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await user.clear(input)
    await user.type(input, 'Changed input')

    expect(await screen.findByRole('mark', { name: /Martina Weber.*Model detected/i })).toBeVisible()
    expect(input).toHaveValue('Changed input')
  })

  it('clears stale output when another analysis begins', async () => {
    let calls = 0
    server.use(http.post('/api/detect', async () => {
      calls += 1
      if (calls === 1) {
        return HttpResponse.json(personResponse)
      }
      await delay(100)
      return HttpResponse.json(emptyResponse)
    }))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByRole('cell', { name: 'Model detected' })
    await user.clear(input)
    await user.type(input, 'No entities')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(screen.queryByText('Model detected')).not.toBeInTheDocument()
  })

  it('clears input and result when Clear is pressed', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json(personResponse)))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByRole('cell', { name: 'Model detected' })
    await user.click(screen.getByRole('button', { name: /Clear/i }))

    expect(input).toHaveValue('')
    expect(screen.queryByText('Model detected')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not retain cleared or previous submitted text in the query client', async () => {
    let calls = 0
    server.use(http.post('/api/detect', () => {
      calls += 1
      return HttpResponse.json(calls === 1 ? personResponse : emptyResponse)
    }))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const user = userEvent.setup()
    renderApp(queryClient)

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'First private submission')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByRole('cell', { name: 'Model detected' })
    expect(JSON.stringify({
      queries: queryClient.getQueryCache().getAll(),
      mutations: queryClient.getMutationCache().getAll(),
    })).not.toContain('First private submission')
    await user.click(screen.getByRole('button', { name: /Clear/i }))

    await waitFor(() => expect(JSON.stringify({
      queries: queryClient.getQueryCache().getAll(),
      mutations: queryClient.getMutationCache().getAll(),
    })).not.toContain('First private submission'))

    await user.type(input, 'Second private submission')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByText(/No entities were detected/i)

    expect(JSON.stringify({
      queries: queryClient.getQueryCache().getAll(),
      mutations: queryClient.getMutationCache().getAll(),
    })).not.toContain('First private submission')
  })

  it('keeps all result presentation hidden when detector offsets are invalid', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json({
      ...personResponse,
      spans: [{ ...personResponse.spans[0], end: 99 }],
    })))
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Detector returned invalid span offsets.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Model detected')).not.toBeInTheDocument()
  })

  it('explains the idle result state before an analysis', () => {
    renderApp()

    expect(screen.getByText('Detections will appear here after you analyze text.')).toBeVisible()
  })

  it('preserves a zero-span submitted snapshot in both regions after editing input without detection details', async () => {
    const user = userEvent.setup()
    renderApp()

    const text = '🙂 東京\n  unchanged\ttext  '
    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, text)
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByText(/No entities were detected/i)).toBeVisible()
    await user.clear(input)
    await user.type(input, 'Edited after submission')
    for (const name of ['Submitted text', 'Pseudonymized preview']) {
      const region = screen.getByRole('region', { name })
      expect(within(region).getByText('🙂 東京 unchanged text').textContent).toBe(text)
      expect(within(region).queryByRole('mark')).not.toBeInTheDocument()
    }
    expect(input).toHaveValue('Edited after submission')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the result-specific limited scan when health still reports full detection', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json(deterministicOnlyResponse)))
    const user = userEvent.setup()
    renderApp()

    await screen.findByText('Full detection active.')
    await user.type(screen.getByLabelText(/Text to inspect/i), 'No detected entities')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByText('Limited scan: deterministic only — NER did not run.')).toBeVisible()
    expect(screen.getByText('Full detection active.')).toBeVisible()
  })

  it('shows the result-specific full scan when deterministic and NER layers ran', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(/Text to inspect/i), 'No detected entities')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByText('Full scan: deterministic + NER')).toBeVisible()
  })

  it('clears an analysis error when Clear is pressed', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json(
      { detail: 'The detector rejected this text.' }, { status: 422 },
    )))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: /Clear/i }))

    expect(input).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not restore a delayed success after Clear', async () => {
    server.use(http.post('/api/detect', async () => {
      await delay(100)
      return HttpResponse.json(personResponse)
    }))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    await delay(150)

    expect(input).toHaveValue('')
    expect(screen.queryByText('Model detected')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not restore a delayed error after Clear', async () => {
    server.use(http.post('/api/detect', async () => {
      await delay(100)
      return HttpResponse.json({ detail: 'The detector rejected this text.' }, { status: 422 })
    }))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    await delay(150)

    expect(input).toHaveValue('')
    expect(screen.queryByText('Model detected')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cancels the cleared request before accepting a new analysis', async () => {
    let requests = 0
    let activeRequests = 0
    let maximumActiveRequests = 0
    server.use(http.post('/api/detect', async ({ request }) => {
      requests += 1
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)

      if (requests === 1) {
        await Promise.race([
          delay(200),
          new Promise<void>((resolve) => {
            if (request.signal.aborted) {
              resolve()
              return
            }
            request.signal.addEventListener('abort', () => resolve(), { once: true })
          }),
        ])
        activeRequests -= 1
        return HttpResponse.json(personResponse)
      }

      activeRequests -= 1
      return HttpResponse.json(emptyResponse)
    }))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    await user.type(input, 'New text')
    await waitFor(() => expect(screen.getByRole('button', { name: /Analyze text/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByText(/No entities were detected/i)
    await delay(250)

    expect(maximumActiveRequests).toBe(1)
    expect(screen.getByText(/No entities were detected/i)).toBeVisible()
    expect(screen.queryByText('Model detected')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows structured error detail without clearing input', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json(
      { detail: 'The detector rejected this text.' }, { status: 422 },
    )))
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByLabelText(/Text to inspect/i)
    await user.type(input, 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The detector rejected this text.')
    expect(input).toHaveValue('Martina Weber')
  })

  it('shows fixed safe copy for malformed error JSON', async () => {
    server.use(http.post('/api/detect', () => new HttpResponse('not json', { status: 500 })))
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Detector request failed.')
  })

  it('does not write text to the console during analysis errors', async () => {
    const log = vi.spyOn(console, 'log')
    const error = vi.spyOn(console, 'error')
    server.use(http.post('/api/detect', () => HttpResponse.json(
      { detail: 'The detector rejected this text.' }, { status: 422 },
    )))
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText(/Text to inspect/i), 'Martina Weber')
    await user.click(screen.getByRole('button', { name: /Analyze text/i }))
    await screen.findByRole('alert')
    await waitFor(() => expect(log).not.toHaveBeenCalled())

    expect(error).not.toHaveBeenCalled()
  })
})
