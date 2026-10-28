import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { App } from './App'
import { server } from './test/server'

const example = 'Die fiktive Kundin Martina Weber lebt in Berlin. Kontakt: martina.weber@example.com.'
const empty = { spans: [], layers_run: ['deterministic', 'ner'], version: 'test' }
const person = { entity_type: 'PERSON', start: 2, end: 5, confidence: 0.91, recognizer: 'ner:gliner', tier: 2, boosted: false }

beforeEach(() => {
  server.use(http.get('/api/health', () => HttpResponse.json({ status: 'ok', ner: true, ner_off_reason: null })),
    http.post('/api/detect', () => HttpResponse.json(empty)))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function russian() {
  const user = userEvent.setup()
  render(<App />)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
  return user
}

it('fills only empty input with the exact fictional German example without a request or automatic overwrite', async () => {
  let calls = 0
  server.use(http.post('/api/detect', () => { calls++; return HttpResponse.json(empty) }))
  const user = await russian()
  expect(document.documentElement).toHaveAttribute('lang', 'ru')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Проверка текста')
  expect(screen.getByRole('note', { name: 'Возможности обнаружения' })).toHaveTextContent('Номера телефонов пока не поддерживаются.')
  expect(screen.getByText(/Пример вымышленный и написан на немецком/)).toBeVisible()
  const input = screen.getByLabelText('Текст для проверки')
  const fill = screen.getByRole('button', { name: 'Вставить пример' })
  await user.type(input, '  ')
  expect(fill).toBeEnabled()
  await user.click(fill)
  expect(input).toHaveValue(example)
  expect(fill).toBeDisabled()
  expect(calls).toBe(0)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
  expect(input).toHaveValue(example)
  expect(document.documentElement).toHaveAttribute('lang', 'en')
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  await user.type(input, 'Existing text')
  await user.click(screen.getByRole('button', { name: 'Use example' }))
  expect(input).toHaveValue('Existing text')
  expect(calls).toBe(0)
})

it('preserves duplicate selection, disclosure, raw values and input across locale switches with one request', async () => {
  let calls = 0
  server.use(http.post('/api/detect', () => {
    calls++
    return HttpResponse.json({ ...empty, spans: [{ ...person, start: 6, end: 9, confidence: 0.82 }, person] })
  }))
  const user = await russian()
  await user.type(screen.getByLabelText('Текст для проверки'), '🙂 Ana Ana')
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  expect(await screen.findByRole('heading', { name: 'Найдено: 2' })).toBeVisible()
  const actions = screen.getAllByRole('button', { name: 'Показать сведения: Ana — Найдено моделью' })
  await user.click(actions[1])
  const row = document.activeElement
  const table = screen.getByRole('table', { name: 'Сведения о находках' })
  await user.click(screen.getByRole('button', { name: 'Показать технические сведения' }))
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
    .toEqual(['Фрагмент', 'Тип сущности', 'Слой', 'Уверенность', 'Уровень', 'Распознаватель', 'Контекст'])
  expect(within(table).getAllByText('Оценка усилена контекстом: нет')).toHaveLength(2)
  expect(within(table).getAllByText('ner:gliner')).toHaveLength(2)
  expect(within(table).getAllByText('PERSON')).toHaveLength(2)
  expect(table.querySelector('[data-label="Уверенность"]')).toBeTruthy()
  expect(screen.getByText('Полная проверка: детерминированный слой + NER')).toBeVisible()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
  expect(screen.getByRole('table', { name: 'Detection details' })).toBe(table)
  expect(row).toHaveAttribute('aria-current', 'true')
  expect(actions[1]).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByLabelText('Text to inspect')).toHaveValue('🙂 Ana Ana')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
  expect(row).toHaveAttribute('aria-current', 'true')
  expect(calls).toBe(1)
})

it('keeps a result snapshot when the example is inserted through ordinary editing', async () => {
  const user = await russian()
  const input = screen.getByLabelText('Текст для проверки')
  await user.type(input, '🙂 unchanged')
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  const submitted = await screen.findByRole('region', { name: 'Отправленный текст' })
  await user.clear(input)
  await user.click(screen.getByRole('button', { name: 'Вставить пример' }))
  expect(input).toHaveValue(example)
  expect(submitted).toHaveTextContent('🙂 unchanged')
  expect(screen.getByText('Замены не выполнены.')).toBeVisible()
  expect(screen.getByText('Сущности не найдены. Это не доказывает отсутствие персональных данных в тексте.')).toBeVisible()
  expect(screen.getByText('Заменены только найденные значения; необнаруженные персональные данные могут остаться.')).toBeVisible()
})

it('switches a pending request without resubmitting and renders its response in the current language', async () => {
  let release!: () => void
  let calls = 0
  const pending = new Promise<void>(resolve => { release = resolve })
  server.use(http.post('/api/detect', async () => { calls++; await pending; return HttpResponse.json(empty) }))
  const user = await russian()
  const input = screen.getByLabelText('Текст для проверки')
  await user.type(input, '🙂 pending')
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  expect(screen.getByText('Проверяем текст…')).toBeVisible()
  await user.clear(input)
  expect(screen.getByRole('button', { name: 'Вставить пример' })).toBeDisabled()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
  expect(screen.getByText('Analyzing text…')).toBeVisible()
  await act(async () => { release() })
  expect(await screen.findByRole('heading', { name: '0 findings' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Submitted text' })).toHaveTextContent('🙂 pending')
  expect(input).toHaveValue('')
  expect(calls).toBe(1)
})

it.each([
  ['malformed error', () => new HttpResponse('bad', { status: 500 }), 'Запрос к детектору не выполнен.', 'Detector request failed.'],
  ['invalid response', () => HttpResponse.json({}), 'Детектор вернул некорректный ответ.', 'Detector returned an invalid response.'],
  ['invalid offsets', () => HttpResponse.json({ ...empty, spans: [{ ...person, end: 99 }] }), 'Детектор вернул некорректные границы фрагментов.', 'Detector returned invalid span offsets.'],
  ['network failure', () => HttpResponse.error(), 'Не удалось связаться с детектором.', 'Failed to fetch'],
  ['server detail', () => HttpResponse.json({ detail: '<raw diagnostic Ω>' }, { status: 503 }), '<raw diagnostic Ω>', '<raw diagnostic Ω>'],
])('translates %s at presentation time while retaining documented server details', async (_name, response, ru, en) => {
  let calls = 0
  server.use(http.post('/api/detect', () => { calls++; return response() }))
  const user = await russian()
  await user.type(screen.getByLabelText('Текст для проверки'), '🙂 invalid')
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(ru)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
  expect(alert).toHaveTextContent(en)
  expect(calls).toBe(1)
})

it('renders a failure arriving after a language switch in that language', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  server.use(http.post('/api/detect', async () => { await pending; return new HttpResponse('bad', { status: 500 }) }))
  const user = userEvent.setup()
  render(<App />)
  await user.type(screen.getByLabelText('Text to inspect'), 'pending failure')
  await user.click(screen.getByRole('button', { name: 'Analyze text' }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
  await act(async () => { release() })
  expect(await screen.findByRole('alert')).toHaveTextContent('Запрос к детектору не выполнен.')
})

it.each([true, false])('translates pending clipboard feedback in the active language (success=%s)', async success => {
  let finish!: () => void
  const copying = new Promise<void>((resolve, reject) => { finish = () => success ? resolve() : reject(new Error('private clipboard error')) })
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockReturnValue(copying)
  render(<App />)
  await user.type(screen.getByLabelText('Text to inspect'), 'unchanged')
  await user.click(screen.getByRole('button', { name: 'Analyze text' }))
  await user.click(await screen.findByRole('button', { name: 'Copy preview' }))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'ru')
  expect(screen.getByRole('button', { name: 'Копировать результат' })).toBeDisabled()
  await act(async () => { finish() })
  const feedback = success ? 'Результат скопирован.' : 'Не удалось скопировать результат. Выделите текст результата и скопируйте его вручную.'
  expect(await screen.findByText(feedback)).toBeVisible()
  expect(screen.queryByText('private clipboard error')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
  expect(screen.getByText(success ? 'Preview copied.' : 'Could not copy preview. Select the preview text to copy it manually.')).toBeVisible()
})

it.each([
  [['deterministic'], 'Ограниченная проверка: только детерминированный слой — NER не запускался.'],
  [['ner'], 'Ограниченная проверка: только NER — детерминированный слой не запускался.'],
  [[], 'Ограниченная проверка: ни один слой детектора не запускался.'],
])('explains limited scan layers %s in Russian', async (layers, message) => {
  server.use(http.post('/api/detect', () => HttpResponse.json({ ...empty, layers_run: layers })))
  const user = await russian()
  await user.click(screen.getByRole('button', { name: 'Вставить пример' }))
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  expect(await screen.findByText(message)).toBeVisible()
})

it('localizes all evidence categories while preserving unknown entity/recognizer values as escaped text', async () => {
  server.use(http.post('/api/detect', () => HttpResponse.json({ ...empty, spans: [
    { ...person, start: 0, end: 1, recognizer: 'catalog:test', confidence: 1 },
    { ...person, start: 2, end: 3, recognizer: 'catalog:email', confidence: 0.95, boosted: true },
    { ...person, start: 4, end: 5 },
    { ...person, start: 6, end: 7, entity_type: '<img src=x>', recognizer: '<unknown Ω>' },
  ] })))
  const user = await russian()
  await user.type(screen.getByLabelText('Текст для проверки'), 'A B C D')
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  for (const label of ['Контрольная сумма проверена', 'Детерминированный шаблон', 'Найдено моделью', 'Другой распознаватель']) {
    expect(await screen.findByRole('cell', { name: label })).toBeVisible()
  }
  await user.click(screen.getByRole('button', { name: 'Показать технические сведения' }))
  expect(screen.getByText('<unknown Ω>')).toBeVisible()
  expect(screen.getByText('Оценка усилена контекстом: да')).toBeVisible()
  expect(screen.getByRole('table').querySelector('img')).toBeNull()
})

it('localizes health fallback but leaves server diagnostic text unchanged', async () => {
  server.use(http.get('/api/health', () => HttpResponse.json({ status: 'ok', ner: false, ner_off_reason: '<raw health Ω>' })))
  const user = await russian()
  expect(await screen.findByText('Детерминированное обнаружение активно.')).toBeVisible()
  expect(screen.getByText('<raw health Ω>')).toBeVisible()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Язык / Language' }), 'en')
  expect(screen.getByText('<raw health Ω>')).toBeVisible()
  expect(screen.getByText('Deterministic detection active.')).toBeVisible()
})

it('localizes health unavailability and resets the analyzer in Russian', async () => {
  server.use(http.get('/api/health', () => new HttpResponse(null, { status: 500 })))
  const user = await russian()
  expect(await screen.findByText('Детектор недоступен.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Вставить пример' }))
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  await screen.findByRole('heading', { name: 'Найдено: 0' })
  await user.click(screen.getByRole('button', { name: 'Очистить' }))
  expect(screen.getByLabelText('Текст для проверки')).toHaveValue('')
  expect(screen.getByText('Находки появятся здесь после проверки текста.')).toBeVisible()
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Результат псевдонимизации' })).not.toBeInTheDocument())
})

it.each([
  'Detector request failed.',
  'Detector returned an invalid response.',
  'Detector returned invalid span offsets.',
])('preserves a documented server diagnostic even when it matches app copy: %s', async detail => {
  server.use(http.post('/api/detect', () => HttpResponse.json({ detail }, { status: 503 })))
  const user = await russian()
  await user.click(screen.getByRole('button', { name: 'Вставить пример' }))
  await user.click(screen.getByRole('button', { name: 'Проверить текст' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(detail)
})
