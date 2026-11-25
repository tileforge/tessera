import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { TextAnalyzer } from './components/TextAnalyzer'
import { LocaleProvider } from './i18n/LocaleProvider'
import { server } from './test/server'

const fullHealth = { status: 'ok', ner: true, ner_off_reason: null }
const empty = { spans: [], layers_run: ['deterministic', 'ner'], version: 'test' }
const findings = {
  ...empty,
  spans: [
    { entity_type: 'PERSON', start: 2, end: 5, confidence: 0.91, recognizer: 'ner:gliner', tier: 2, boosted: false },
    { entity_type: 'EMAIL', start: 7, end: 13, confidence: 0.95, recognizer: 'catalog:email', tier: 2, boosted: false },
  ],
}
const modeName = 'Use NER when available'
let bodies: unknown[]

describe('next analysis detection mode', () => {
  beforeEach(() => {
    bodies = []
    server.use(
      http.get('/api/health', () => HttpResponse.json(fullHealth)),
      http.post('/api/detect', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(empty)
      }),
    )
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('sends exact default, deterministic-only and re-enabled bodies without changing Unicode or whitespace', async () => {
    const user = userEvent.setup()
    render(<App />)
    const mode = screen.getByRole('checkbox', { name: modeName })
    expect(mode).toBeChecked()
    expect(screen.getByRole('group', { name: 'Detection mode' })).toContainElement(mode)
    expect(mode).toHaveAccessibleDescription('Catalog rules always run. NER can also detect names, places, organizations and sensitive categories when available.')
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: '  🙂 東京\nAna\t  ' } })
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await screen.findByText('Full scan: deterministic + NER')
    expect(bodies).toEqual([{ text: '  🙂 東京\nAna\t  ' }])
    await user.click(mode)
    expect(mode).not.toBeChecked()
    expect(mode).toHaveAccessibleDescription(/Next analysis uses catalog rules only; NER will not run\./)
    expect(bodies).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await waitFor(() => expect(mode).toBeEnabled())
    expect(bodies).toEqual([
      { text: '  🙂 東京\nAna\t  ' },
      { text: '  🙂 東京\nAna\t  ', layers: ['deterministic'] },
    ])
    // The server response, rather than the requested mode, remains result truth.
    expect(screen.getByText('Full scan: deterministic + NER')).toBeVisible()
    await user.click(mode)
    expect(screen.queryByText('Next analysis uses catalog rules only; NER will not run.')).not.toBeInTheDocument()
    expect(bodies).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await waitFor(() => expect(bodies).toHaveLength(3))
    expect(bodies).toEqual([
      { text: '  🙂 東京\nAna\t  ' },
      { text: '  🙂 東京\nAna\t  ', layers: ['deterministic'] },
      { text: '  🙂 東京\nAna\t  ' },
    ])
    await waitFor(() => expect(mode).toBeEnabled())
  })

  it('locks and guards the pending preference while preserving its request snapshot through locale and health changes', async () => {
    let startTransport!: () => void
    server.use(http.post('/api/detect', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({ ...empty, layers_run: ['deterministic'] })
    }))
    const queryClient = new QueryClient({ defaultOptions: {
      queries: { retry: false },
      mutations: { onMutate: () => new Promise<void>(resolve => { startTransport = resolve }) },
    } })
    const user = userEvent.setup()
    render(<App queryClient={queryClient} />)
    const mode = screen.getByRole('checkbox', { name: modeName })
    await user.click(mode)
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: '  🙂 pending\t' } })
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await waitFor(() => expect(startTransport).toBeTypeOf('function'))
    expect(mode).toBeDisabled()
    // Bypass native disabling to exercise the pending guard before transport starts.
    const group = screen.getByRole<HTMLFieldSetElement>('group', { name: 'Detection mode' })
    group.disabled = false
    fireEvent.click(mode)
    group.disabled = true
    await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
    act(() => { queryClient.setQueryData(['detector-health'], { ...fullHealth, ner: false }) })
    fireEvent.change(screen.getByLabelText('Текст для проверки'), { target: { value: 'edited' } })
    expect(mode).not.toBeChecked()
    expect(bodies).toEqual([])
    await act(async () => startTransport())
    await screen.findByText('Ограниченная проверка: только детерминированный слой — NER не запускался.')
    expect(bodies).toEqual([{ text: '  🙂 pending\t', layers: ['deterministic'] }])
    expect(document.querySelector('.preview-text')?.textContent).toBe('  🙂 pending\t')
    expect(mode).toBeEnabled()
    expect(mode).not.toBeChecked()
  })

  it.each(['pending', 'failed', 'no NER'])('allows default analysis independently of %s health', async (health) => {
    let finishHealth: (() => void) | undefined
    server.use(http.get('/api/health', async () => {
      if (health === 'pending') await new Promise<void>(resolve => { finishHealth = resolve })
      return health === 'failed'
        ? HttpResponse.json({ detail: 'Unavailable' }, { status: 503 })
        : HttpResponse.json({ ...fullHealth, ner: false })
    }))
    const user = userEvent.setup()
    render(<App />)
    const mode = screen.getByRole('checkbox', { name: modeName })
    if (health === 'failed') await screen.findByText('Detector unavailable.')
    if (health === 'no NER') await screen.findByText('Detector available: catalog rules.')
    expect(mode).toBeChecked()
    expect(mode).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: 'Ana' } })
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await screen.findByText('Full scan: deterministic + NER')
    expect(bodies).toEqual([{ text: 'Ana' }])
    if (finishHealth) await act(async () => finishHealth?.())
    expect(mode).toBeChecked()
  })

  it('preserves the preference across Clear, edits, locale, TXT import and health refetch without posting', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    render(<App queryClient={queryClient} />)
    await user.click(screen.getByRole('checkbox', { name: modeName }))
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: 'draft' } })
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    const imported = '  🙂 Ana\r\n東京\t '
    fireEvent.change(screen.getByLabelText('Open TXT file'), {
      target: { files: [new File([new TextEncoder().encode(imported)], 'synthetic.txt')] },
    })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
    await screen.findByText('TXT загружен. Проверьте текст и запустите проверку.')
    server.use(http.get('/api/health', () => HttpResponse.json({ ...fullHealth, ner: false })))
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['detector-health'] }) })
    expect(screen.getByRole('checkbox', { name: 'Использовать NER, если доступен' })).not.toBeChecked()
    expect(await screen.findByText('Детектор доступен: правила каталога.')).toBeVisible()
    expect(bodies).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
    await screen.findByRole('region', { name: 'Отправленный текст' })
    expect(bodies).toEqual([{ text: '  🙂 Ana\r\n東京\t ', layers: ['deterministic'] }])
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('keeps accepted badge, filters, selection, disclosure, complete preview and action feedback when toggled', async () => {
    server.use(http.post('/api/detect', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json(findings)
    }))
    const user = userEvent.setup()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL() { return 'blob:synthetic' }
      static revokeObjectURL() {}
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<App />)
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: '🙂 Ana  a@b.de\n' } })
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    const preview = await screen.findByRole('region', { name: 'Pseudonymized preview' })
    await user.selectOptions(screen.getByLabelText('Filter by entity type'), 'type-0')
    await user.selectOptions(screen.getByLabelText('Detection method'), 'ner')
    await user.click(screen.getByRole('button', { name: 'Show details for Ana — Model detected' }))
    const row = screen.getByRole('table').querySelector('tr[aria-current="true"]')
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    await user.click(screen.getByRole('button', { name: 'Copy preview' }))
    await user.click(screen.getByRole('button', { name: 'Download TXT' }))
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: 'new draft' } })
    await user.click(screen.getByRole('checkbox', { name: modeName }))
    expect(screen.getByText('Full scan: deterministic + NER')).toBeVisible()
    expect(screen.getByLabelText('Filter by entity type')).toHaveValue('type-0')
    expect(screen.getByLabelText('Detection method')).toHaveValue('ner')
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Show details for Ana — Model detected' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.highlighted-result')?.textContent).toBe('🙂 Ana  a@b.de\n')
    expect(preview.querySelector('.preview-text')?.textContent).toBe('🙂 [PERSON_1]  [EMAIL_1]\n')
    expect(within(preview).getByText('Preview copied.')).toBeVisible()
    expect(within(preview).getByText('Download started.')).toBeVisible()
    expect(await navigator.clipboard.readText()).toBe('🙂 [PERSON_1]  [EMAIL_1]\n')
    expect(bodies).toEqual([{ text: '🙂 Ana  a@b.de\n' }])
  })

  it('ignores a stale completion after Clear and accepts the new mode and result', async () => {
    let finishOld!: () => void
    let oldResponseReady!: () => void
    const oldResponse = new Promise<void>(resolve => { oldResponseReady = resolve })
    server.use(http.post('/api/detect', async ({ request }) => {
      const body = await request.json()
      bodies.push(body)
      if (bodies.length === 1) {
        await new Promise<void>(resolve => { finishOld = resolve })
        oldResponseReady()
        return HttpResponse.json(findings)
      }
      return HttpResponse.json({ ...empty, layers_run: ['deterministic'] })
    }))
    const user = userEvent.setup()
    render(<App />)
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: '🙂 Ana  a@b.de\n' } })
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await waitFor(() => expect(finishOld).toBeTypeOf('function'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    const mode = screen.getByRole('checkbox', { name: modeName })
    await waitFor(() => expect(mode).toBeEnabled())
    await user.click(mode)
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: 'new 🙂 text' } })
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await screen.findByText('Limited scan: deterministic only — NER did not run.')
    await act(async () => { finishOld(); await oldResponse })
    expect(document.querySelector('.preview-text')?.textContent).toBe('new 🙂 text')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(mode).not.toBeChecked()
    expect(bodies).toEqual([
      { text: '🙂 Ana  a@b.de\n' },
      { text: 'new 🙂 text', layers: ['deterministic'] },
    ])
  })

  it('keeps standalone TextAnalyzer callers without the optional setting compatible', () => {
    render(<LocaleProvider><TextAnalyzer text="Ana" pending={false}
      onTextChange={() => {}} onAnalyze={() => {}} onClear={() => {}} /></LocaleProvider>)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyze text' })).toBeEnabled()
  })
})
