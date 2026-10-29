import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { server } from './test/server'

const response = { spans: [], layers_run: ['deterministic'], version: 'test' }
const source = '  🙂 Ana\r\n東京\n\t '
let submissions: string[]

function input() { return screen.getByLabelText('Open TXT file') as HTMLInputElement }
function select(file?: File) { fireEvent.change(input(), { target: { files: file ? [file] : [] } }) }
function file(bytes: BlobPart, name = 'private-fixture.txt', type = '') {
  return new File([bytes], name, { type })
}

// Native FileReader is used for every valid/invalid content case. This double
// only controls events that cannot be scheduled reliably with a local file.
class DelayedReader {
  static instances: DelayedReader[] = []
  readyState = 0
  result: ArrayBuffer | null = null
  error = new DOMException('private-fixture.txt: secret diagnostic', 'NotReadableError')
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  readAsArrayBuffer() { this.readyState = 1; DelayedReader.instances.push(this) }
  abort() { this.readyState = 2; this.onabort?.() }
  complete(text: string) { this.result = new TextEncoder().encode(text).buffer; this.onload?.() }
}

describe('local TXT import', () => {
  beforeEach(() => {
    submissions = []
    DelayedReader.instances = []
    server.use(
      http.get('/api/health', () => HttpResponse.json({ status: 'ok', ner: false, ner_off_reason: null })),
      http.post('/api/detect', async ({ request }) => {
        submissions.push((await request.json() as { text: string }).text)
        return HttpResponse.json(response)
      }),
    )
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('reads .TXT with empty MIME locally, strips BOM and submits exact Unicode/CRLF only on Analyze', async () => {
    const user = userEvent.setup()
    render(<App />)
    select(file(new TextEncoder().encode('\uFEFF' + source), 'private-fixture.TXT'))
    await screen.findByText('TXT loaded. Review the text, then analyze when ready.')
    // textarea normalizes CRLF visually; the accepted API source must not.
    expect(screen.getByLabelText('Text to inspect')).toHaveValue(source.replace(/\r\n/g, '\n'))
    expect(submissions).toEqual([])
    expect(input().value).toBe('')
    expect(screen.getByRole('button', { name: 'Open TXT file' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await screen.findByRole('region', { name: 'Submitted text' })
    expect(submissions).toEqual([source])
    expect(document.querySelector('.highlighted-result')?.textContent).toBe(source)
    expect(document.querySelector('.preview-text')?.textContent).toBe(source)
    expect(screen.queryByText(/TXT loaded/)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('private-fixture')
  })

  it.each([
    ['100000 bytes', file('a'.repeat(100000))],
    ['multibyte 100000 bytes', file('é'.repeat(50000), 'value.txt', 'application/octet-stream')],
    ['BOM counted in 100000 bytes', file(new TextEncoder().encode('\uFEFF' + 'a'.repeat(99997)))],
  ])('accepts %s inclusively', async (_label, selected) => {
    render(<App />)
    select(selected)
    await screen.findByText(/TXT loaded/)
    expect(screen.getByLabelText('Text to inspect')).not.toHaveValue('')
    expect(submissions).toEqual([])
  })

  it.each([
    ['wrong suffix', file('text', 'secret.csv'), 'Choose a .txt file.'],
    ['100001 bytes', file('a'.repeat(100001)), 'TXT must be 100 KB (100,000 bytes) or smaller.'],
    ['multibyte over limit', file('é'.repeat(50001)), 'TXT must be 100 KB (100,000 bytes) or smaller.'],
    ['zero bytes', file(''), 'TXT must contain non-whitespace text.'],
    ['whitespace', file(' \r\n\t '), 'TXT must contain non-whitespace text.'],
    ['BOM only', file(new Uint8Array([0xef, 0xbb, 0xbf])), 'TXT must contain non-whitespace text.'],
    ['invalid UTF-8', file(new Uint8Array([0xc3, 0x28])), 'Save the file as UTF-8 plain text and try again.'],
    ['truncated UTF-8', file(new Uint8Array([0xf0, 0x9f, 0x99])), 'Save the file as UTF-8 plain text and try again.'],
    ['overlong UTF-8', file(new Uint8Array([0xc0, 0xaf])), 'Save the file as UTF-8 plain text and try again.'],
    ['NUL within text', file('valid\0text'), 'Save the file as UTF-8 plain text and try again.'],
    ['UTF-16 BOM', file(new Uint8Array([0xff, 0xfe, 0x41, 0])), 'Save the file as UTF-8 plain text and try again.'],
    ['UTF-16 without BOM', file(new Uint8Array([0x41, 0])), 'Save the file as UTF-8 plain text and try again.'],
  ])('rejects %s safely and permits retry', async (_label, selected, feedback) => {
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
    render(<App />)
    select(selected)
    expect(await screen.findByRole('alert')).toHaveTextContent(feedback)
    if (selected.size > 100000 || !selected.name.endsWith('.txt') || selected.size === 0) expect(read).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('')
    expect(document.body).not.toHaveTextContent(selected.name)
    expect(submissions).toEqual([])
    expect(input().value).toBe('')
    select(file('retry', selected.name.replace(/\.csv$/, '.txt')))
    await screen.findByText(/TXT loaded/)
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('retry')
  })

  it('cancels the picker without changing text or feedback and retries the same file after Clear', async () => {
    const user = userEvent.setup()
    render(<App />)
    const selected = file('same text')
    select(selected)
    await screen.findByText(/TXT loaded/)
    select()
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('same text')
    expect(screen.getByText(/TXT loaded/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    select(selected)
    await screen.findByText(/TXT loaded/)
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('same text')
  })

  it('rechecks eligibility when a picker returns to nonempty or detecting input', async () => {
    server.use(http.post('/api/detect', () => new Promise(() => {})))
    const user = userEvent.setup()
    render(<App />)
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: 'keep me' } })
    select(file('must not overwrite'))
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('keep me')
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: '' } })
    select(file('must not start'))
    expect(screen.getByRole('button', { name: 'Open TXT file' })).toBeDisabled()
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('')
    expect(screen.queryByText(/Reading TXT/)).not.toBeInTheDocument()
  })

  it.each(['typing', 'Clear', 'example', 'analysis', 'unmount'] as const)(
    'ignores late success/error/abort after %s invalidates the read', async (action) => {
      vi.stubGlobal('FileReader', DelayedReader)
      const user = userEvent.setup()
      const view = render(<App />)
      select(file('late'))
      expect(screen.getByText('Reading TXT locally…')).toBeVisible()
      expect(screen.getByLabelText('Text to inspect')).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Open TXT file' })).toBeDisabled()
      const reader = DelayedReader.instances[0]
      const load = reader.onload
      const error = reader.onerror
      const abort = reader.onabort
      if (action === 'typing' || action === 'analysis') {
        fireEvent.change(screen.getByLabelText('Text to inspect'), { target: { value: 'typed text' } })
        if (action === 'analysis') {
          await user.click(screen.getByRole('button', { name: 'Analyze text' }))
          await screen.findByRole('region', { name: 'Submitted text' })
        }
      } else if (action === 'Clear') await user.click(screen.getByRole('button', { name: 'Clear' }))
      else if (action === 'example') await user.click(screen.getByRole('button', { name: 'Use example' }))
      else view.unmount()
      expect(reader.readyState).toBe(2)
      act(() => {
        reader.result = new TextEncoder().encode('stale secret').buffer
        load?.(); error?.(); abort?.()
      })
      if (action !== 'unmount') {
        expect(screen.queryByText(/Reading TXT|TXT loaded|Could not read/)).not.toBeInTheDocument()
        expect(screen.getByLabelText('Text to inspect')).not.toHaveValue('stale secret')
        if (action === 'typing' || action === 'analysis') expect(screen.getByLabelText('Text to inspect')).toHaveValue('typed text')
        if (action === 'example') expect(screen.getByLabelText('Text to inspect')).toHaveValue('Die fiktive Kundin Martina Weber lebt in Berlin. Kontakt: martina.weber@example.com.')
      }
    },
  )

  it('keeps a newer read active after stale first-reader events', async () => {
    vi.stubGlobal('FileReader', DelayedReader)
    const user = userEvent.setup()
    render(<App />)
    select(file('first'))
    const first = DelayedReader.instances[0]
    const stale = [first.onload, first.onerror, first.onabort]
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    select(file('second'))
    act(() => {
      first.result = new TextEncoder().encode('old').buffer
      stale.forEach(callback => callback?.())
    })
    expect(screen.getByText('Reading TXT locally…')).toBeVisible()
    act(() => DelayedReader.instances[1].complete('new'))
    expect(screen.getByText(/TXT loaded/)).toBeVisible()
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('new')
  })

  it('localizes an active read and safe failure without restarting or exposing reader diagnostics', async () => {
    vi.stubGlobal('FileReader', DelayedReader)
    const user = userEvent.setup()
    render(<App />)
    select(file('secret'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
    expect(screen.getByText('Читаем TXT локально…')).toBeVisible()
    act(() => DelayedReader.instances[0].complete('точный 🙂 текст'))
    expect(screen.getByText('TXT загружен. Проверьте текст и запустите проверку.')).toBeVisible()
    expect(screen.getByLabelText('Текст для проверки')).toHaveValue('точный 🙂 текст')
    await user.click(screen.getByRole('button', { name: 'Очистить' }))
    fireEvent.change(screen.getByLabelText('Открыть TXT'), { target: { files: [file('private')] } })
    act(() => DelayedReader.instances[1].onerror?.())
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось прочитать TXT. Выберите файл ещё раз.')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read TXT. Choose the file again.')
    expect(submissions).toEqual([])
    expect(document.body).not.toHaveTextContent('private')
    expect(document.body).not.toHaveTextContent('secret diagnostic')
  })

  it.each(['error', 'abort', 'throw'] as const)('handles current %s safely and permits a native retry', async (failure) => {
    class ThrowingReader extends DelayedReader {
      readAsArrayBuffer() { throw this.error }
    }
    vi.stubGlobal('FileReader', failure === 'throw' ? ThrowingReader : DelayedReader)
    render(<App />)
    select(file('secret'))
    if (failure !== 'throw') act(() => {
      const reader = DelayedReader.instances[0]
      if (failure === 'error') reader.onerror?.()
      else reader.onabort?.()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read TXT. Choose the file again.')
    expect(document.body).not.toHaveTextContent('private-fixture.txt')
    expect(document.body).not.toHaveTextContent('secret diagnostic')
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('')
    expect(submissions).toEqual([])
    vi.unstubAllGlobals()
    select(file('retry after failure'))
    await screen.findByText(/TXT loaded/)
    expect(screen.getByLabelText('Text to inspect')).toHaveValue('retry after failure')
  })

  it('preserves the accepted snapshot, filters, selected finding and technical disclosure', async () => {
    server.use(http.post('/api/detect', async ({ request }) => {
      submissions.push((await request.json() as { text: string }).text)
      return HttpResponse.json({ ...response, spans: [
      { entity_type: 'PERSON', start: 0, end: 3, confidence: 0.9, recognizer: 'ner:test', tier: 2, boosted: false },
      ] })
    }))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Text to inspect'), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    await screen.findByRole('table')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by entity type' }), 'PERSON')
    await user.click(screen.getByRole('button', { name: 'Show details for Ana — Model detected' }))
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    await user.clear(screen.getByLabelText('Text to inspect'))
    select(file('ordinary import'))
    await screen.findByText(/TXT loaded/)
    expect(within(screen.getByRole('region', { name: 'Submitted text' })).getByText('Ana')).toBeVisible()
    expect(screen.getByRole('option', { name: 'PERSON' })).toHaveProperty('selected', true)
    expect(screen.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('tr[aria-current="true"]')).not.toBeNull()
    expect(submissions).toEqual(['Ana'])
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(window.location.search).toBe('')
    await waitFor(() => expect(screen.getByLabelText('Text to inspect')).toHaveValue('ordinary import'))
  })
})
