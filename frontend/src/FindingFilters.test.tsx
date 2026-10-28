import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from './App'
import { server } from './test/server'

const text = '🙂 Ana Ana X Y Z Q'
const baseSpan = { tier: 2, boosted: false }
// Deliberately unsorted, with duplicate fragments and all four evidence classes.
const spans = [
  { ...baseSpan, start: 6, end: 9, entity_type: 'PERSON', recognizer: 'catalog:person', confidence: 0.95 },
  { ...baseSpan, start: 2, end: 5, entity_type: 'PERSON', recognizer: 'ner:gliner', confidence: 0.91 },
  { ...baseSpan, start: 10, end: 11, entity_type: '__proto__', recognizer: 'catalog:synthetic', confidence: 1 },
  { ...baseSpan, start: 12, end: 13, entity_type: '', recognizer: 'custom:test', confidence: 0.5 },
  { ...baseSpan, start: 14, end: 15, entity_type: 'all', recognizer: 'ner:gliner', confidence: 0.8 },
  { ...baseSpan, start: 16, end: 17, entity_type: '<b>東京</b>', recognizer: 'ner:gliner', confidence: 0.8 },
]
const response = { spans, layers_run: ['deterministic', 'ner'], version: 'test-version' }
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const typeFilter = () => screen.getByLabelText('Filter by entity type')
const methodFilter = () => screen.getByLabelText('Detection method')

async function analyze(submittedText = text) {
  const user = userEvent.setup()
  render(<App />)
  await user.type(screen.getByLabelText('Text to inspect'), submittedText)
  await user.click(screen.getByRole('button', { name: 'Analyze text' }))
  await screen.findByRole('table')
  return user
}

function typeOption(label: string) {
  return within(typeFilter()).getByRole('option', { name: label })
}

describe('finding filters', () => {
  beforeEach(() => server.use(
    http.get('/api/health', () => HttpResponse.json({ status: 'ok', ner: true, ner_off_reason: null })),
    http.post('/api/detect', () => HttpResponse.json(response)),
  ))
  afterEach(cleanup)

  it('combines type and evidence method while preserving full summary, highlights, preview and copy', async () => {
    const user = await analyze()
    expect(within(methodFilter()).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['All methods', 'Checksum verified', 'Deterministic pattern', 'Model detected', 'Other recognizer'])
    await user.selectOptions(typeFilter(), typeOption('PERSON'))
    expect(rows()).toHaveLength(2)
    await user.selectOptions(methodFilter(), 'pattern')
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]).getByText('Deterministic pattern')).toBeVisible()
    expect(screen.getByText('Showing 1 of 6 findings.')).toBeVisible()
    expect(screen.getByText('Filters apply only to the details table.')).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Finding summary' })).getByRole('heading')).toHaveTextContent('6 findings')
    expect(within(screen.getByRole('region', { name: 'Submitted text' })).getAllByRole('mark')).toHaveLength(6)
    const preview = screen.getByRole('region', { name: 'Pseudonymized preview' })
    expect(within(preview).getByText('🙂 [PERSON_1] [PERSON_1] [ENTITY_1] [ENTITY_2] [ENTITY_3] [ENTITY_4]')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy preview' }))
    expect(await navigator.clipboard.readText()).toBe('🙂 [PERSON_1] [PERSON_1] [ENTITY_1] [ENTITY_2] [ENTITY_3] [ENTITY_4]')
    await user.selectOptions(typeFilter(), typeOption('__proto__'))
    await user.selectOptions(methodFilter(), 'checksum')
    expect(within(rows()[0]).getByText('X')).toBeVisible()
    await user.selectOptions(methodFilter(), 'all')
    expect(rows()).toHaveLength(1)
    await user.selectOptions(typeFilter(), 'all')
    await user.selectOptions(methodFilter(), 'other')
    expect(within(rows()[0]).getByText('Y')).toBeVisible()
  })

  it('keeps arbitrary, empty and all-like types distinct from all and escapes labels', async () => {
    const user = await analyze()
    for (const [label, fragment] of [['__proto__', 'X'], ['(empty type)', 'Y'], ['all', 'Z'], ['<b>東京</b>', 'Q']]) {
      await user.selectOptions(typeFilter(), typeOption(label))
      expect(rows()).toHaveLength(1)
      expect(within(rows()[0]).getByText(fragment)).toBeVisible()
    }
    expect(document.querySelector('option b')).toBeNull()
    await user.selectOptions(typeFilter(), 'all')
    expect(rows()).toHaveLength(6)
  })

  it('distinguishes real all, fallback and token-like labels and offers only methods present', async () => {
    const types = ['', '(empty type)', 'All types', 'all', '__proto__', 'constructor', 'type-0']
    server.use(http.post('/api/detect', () => HttpResponse.json({
      ...response,
      spans: types.map((entity_type, index) => ({
        ...spans[1], entity_type, start: index * 2, end: index * 2 + 1,
      })),
    })))
    const user = await analyze()
    const options = within(typeFilter()).getAllByRole('option') as HTMLOptionElement[]
    expect(new Set(options.map(option => option.value)).size).toBe(types.length + 1)
    expect(within(methodFilter()).getAllByRole('option').map(option => option.textContent))
      .toEqual(['All methods', 'Model detected'])
    for (const [index, type] of types.entries()) {
      await user.selectOptions(typeFilter(), options[index + 1])
      expect(rows()).toHaveLength(1)
      expect(within(rows()[0]).getAllByRole('cell')[1].textContent).toBe(type)
    }
    await user.selectOptions(typeFilter(), options[0])
    expect(rows()).toHaveLength(types.length)
  })

  it.each(['en', 'ru'] as const)('gives colliding type options distinct visible labels in %s and preserves selection across locales', async (locale) => {
    const types = [
      '', '(empty type)', 'All types', '(пустой тип)', 'Все типы',
      '"(empty type)"', '"All types"', '"(пустой тип)"', '"Все типы"',
      '"', '__proto__', '<b>東京</b>', ' All  types ', '\tВсе типы\n', '1. x y', 'x y', 'x  y',
    ]
    const fragments = types.map((_, index) => String.fromCharCode(65 + index))
    let calls = 0
    server.use(http.post('/api/detect', () => {
      calls++
      return HttpResponse.json({
        ...response,
        spans: types.map((entity_type, index) => ({
          ...spans[1], entity_type, start: index * 2, end: index * 2 + 1,
        })),
      })
    }))
    const user = await analyze(fragments.join(' '))
    const select = typeFilter()
    const language = screen.getByLabelText('Язык / Language')
    await user.selectOptions(language, locale)
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    const labels = options.map(option => option.label)
    expect(new Set(labels).size).toBe(types.length + 1)
    for (const [index, type] of types.entries()) {
      // Select by the visible name a user can distinguish, then inspect the row.
      await user.selectOptions(select, options.find(option => option.label === labels[index + 1])!)
      expect(rows()).toHaveLength(1)
      const cells = within(rows()[0]).getAllByRole('cell')
      expect(cells[0]).toHaveTextContent(fragments[index])
      expect(cells[1].textContent).toBe(type)
    }
    const selectedValue = (select as HTMLSelectElement).value
    await user.selectOptions(language, locale === 'en' ? 'ru' : 'en')
    expect(select).toHaveValue(selectedValue)
    expect(within(rows()[0]).getAllByRole('cell')[1].textContent).toBe(types.at(-1))
    expect(new Set((within(select).getAllByRole('option') as HTMLOptionElement[]).map(option => option.label)).size)
      .toBe(types.length + 1)
    await user.selectOptions(language, locale)
    expect(select).toHaveValue(selectedValue)
    await user.selectOptions(select, within(select).getByRole('option', { name: labels[0] }))
    expect(rows()).toHaveLength(types.length)
    expect(calls).toBe(1)
  })

  it('distinguishes native option labels when only whitespace differs between raw types', async () => {
    const types = ['x y', 'x  y', ' x y ', '\tx y\n', 'x\ty', '1. x y', '"x y"', '"x  y"']
    const fragments = types.map((_, index) => String.fromCharCode(65 + index))
    server.use(http.post('/api/detect', () => HttpResponse.json({
      ...response,
      spans: types.map((entity_type, index) => ({
        ...spans[1], entity_type, start: index * 2, end: index * 2 + 1,
      })),
    })))
    const user = await analyze(fragments.join(' '))
    const select = typeFilter()
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    const labels = options.map(option => option.label)
    expect(new Set(labels).size).toBe(types.length + 1)
    for (const [index, type] of types.entries()) {
      await user.selectOptions(select, options.find(option => option.label === labels[index + 1])!)
      expect(rows()).toHaveLength(1)
      const cells = within(rows()[0]).getAllByRole('cell')
      expect(cells[0]).toHaveTextContent(fragments[index])
      expect(cells[1].textContent).toBe(type)
    }
  })

  it('retains disclosure and controls through zero matches, then resets filters and selection with control focus', async () => {
    const user = await analyze()
    await user.click(screen.getAllByRole('button', { name: /Show details for Ana/ })[0])
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    const table = screen.getByRole('table')
    const toggle = screen.getByRole('button', { name: 'Hide technical details' })
    await user.selectOptions(typeFilter(), typeOption('PERSON'))
    expect(typeFilter()).toHaveFocus()
    expect(screen.queryByRole('row', { current: true })).not.toBeInTheDocument()
    await user.selectOptions(methodFilter(), 'checksum')
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('No findings match these filters.')).toBeVisible()
    expect(screen.getByText('Showing 0 of 6 findings.')).toBeVisible()
    expect(screen.queryByText(/No entities were detected|No replacements were made/)).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toBe(table)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByRole('button', { name: 'Reset filters' })).toHaveFocus()
    expect(typeFilter()).toHaveValue('all')
    expect(methodFilter()).toHaveValue('all')
    expect(rows()).toHaveLength(6)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps visible highlight filters and recovers hidden exact coordinates on repeated keyboard activation', async () => {
    const user = await analyze()
    const highlights = screen.getAllByRole('button', { name: /Show details for Ana/ })
    await user.selectOptions(typeFilter(), typeOption('PERSON'))
    await user.selectOptions(methodFilter(), 'ner')
    highlights[0].focus()
    await user.keyboard('{Enter}')
    expect(typeFilter()).not.toHaveValue('all')
    expect(methodFilter()).toHaveValue('ner')
    expect(rows()[0]).toHaveFocus()
    highlights[1].focus()
    await user.keyboard(' ')
    expect(typeFilter()).toHaveValue('all')
    expect(methodFilter()).toHaveValue('all')
    expect(rows()[0]).toHaveFocus()
    expect(within(rows()[0]).getByText('Deterministic pattern')).toBeVisible()
    highlights[1].focus()
    await user.keyboard('{Enter}')
    expect(rows()[0]).toHaveFocus()
    expect(rows()[0]).toHaveAttribute('aria-current', 'true')
  })

  it('preserves semantic filters on input and locale edits without requesting again', async () => {
    let calls = 0
    server.use(http.post('/api/detect', () => { calls++; return HttpResponse.json(response) }))
    const user = await analyze()
    await user.selectOptions(typeFilter(), typeOption('(empty type)'))
    await user.selectOptions(methodFilter(), 'other')
    const value = (typeFilter() as HTMLSelectElement).value
    await user.click(screen.getByRole('button', { name: 'Show technical details' }))
    await user.type(screen.getByLabelText('Text to inspect'), ' edited')
    await user.selectOptions(screen.getByLabelText('Язык / Language'), 'ru')
    expect(screen.getByLabelText('Фильтр по типу сущности')).toHaveValue(value)
    expect(screen.getByLabelText('Способ обнаружения')).toHaveValue('other')
    expect(screen.getByRole('option', { name: '(пустой тип)' })).toBeInTheDocument()
    expect(screen.getByText('Показано: 1 из 6.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Скрыть технические сведения' })).toHaveAttribute('aria-expanded', 'true')
    expect(calls).toBe(1)
    await user.selectOptions(screen.getByLabelText('Язык / Language'), 'en')
    expect(typeFilter()).toHaveValue(value)
    expect(methodFilter()).toHaveValue('other')
  })

  it('resets filters on new analysis, invalid results and Clear', async () => {
    let calls = 0
    server.use(http.post('/api/detect', () => {
      calls++
      return HttpResponse.json(calls === 3 ? { ...response, spans: [{ ...spans[0], end: 999 }] } : response)
    }))
    const user = await analyze()
    const analyzeButton = screen.getByRole('button', { name: 'Analyze text' })
    await user.selectOptions(methodFilter(), 'ner')
    await user.click(analyzeButton)
    expect(await screen.findByLabelText('Detection method')).toHaveValue('all')
    await user.selectOptions(methodFilter(), 'pattern')
    await user.click(analyzeButton)
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid span offsets')
    expect(screen.queryByLabelText('Detection method')).not.toBeInTheDocument()
    await user.click(analyzeButton)
    expect(await screen.findByLabelText('Detection method')).toHaveValue('all')
    await user.selectOptions(methodFilter(), 'other')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByLabelText('Detection method')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Text to inspect'), text)
    await user.click(analyzeButton)
    expect(await screen.findByLabelText('Detection method')).toHaveValue('all')
  })

  it('omits filters for a genuinely empty result', async () => {
    server.use(http.post('/api/detect', () => HttpResponse.json({ ...response, spans: [] })))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Text to inspect'), text)
    await user.click(screen.getByRole('button', { name: 'Analyze text' }))
    expect(await screen.findByText(/No entities were detected/)).toBeVisible()
    expect(screen.queryByLabelText('Detection method')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
