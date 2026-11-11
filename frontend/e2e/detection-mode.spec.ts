import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const text = '🙂 Ana  a@b.de\n  東京\t '
const previewText = '🙂 [PERSON_1]  [EMAIL_1]\n  東京\t '
const fullHealth = { status: 'ok', ner: true, ner_off_reason: null }
const fullResult = {
  spans: [
    { entity_type: 'PERSON', start: 2, end: 5, confidence: 0.91, recognizer: 'ner:gliner', tier: 2, boosted: false },
    { entity_type: 'EMAIL', start: 7, end: 13, confidence: 0.95, recognizer: 'catalog:email', tier: 2, boosted: false },
  ],
  layers_run: ['deterministic', 'ner'], version: 'test',
}

for (const scheme of ['light', 'dark'] as const) {
  test(`preserves accepted results and settings with exact layer requests in ${scheme} mode`, async ({ page, context }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const bodies: unknown[] = []
    let downloads = 0
    page.on('download', () => { downloads++ })
    await page.route('**/api/health', route => route.fulfill({ json: fullHealth }))
    await page.route('**/api/detect', route => {
      const body = route.request().postDataJSON()
      bodies.push(body)
      return route.fulfill({ json: body.layers
        ? { spans: [], layers_run: ['deterministic'], version: 'test' }
        : fullResult })
    })
    await page.goto('/')
    const mode = page.getByRole('checkbox', { name: /^(Use NER when available|Использовать NER, если доступен)$/ })
    await expect(mode).toBeChecked()
    await expect(mode).toHaveAccessibleDescription('Catalog rules always run. NER can also detect names, places, organizations and sensitive categories when available.')
    await page.getByLabel('Text to inspect').fill(text)
    await page.getByRole('button', { name: 'Analyze text' }).click()
    await expect(page.getByText('Full scan: deterministic + NER', { exact: true })).toBeVisible()
    expect(bodies).toEqual([{ text: '🙂 Ana  a@b.de\n  東京\t ' }])
    await page.getByLabel('Filter by entity type').selectOption('type-0')
    await page.getByLabel('Detection method').selectOption('ner')
    await page.getByRole('button', { name: 'Show details for Ana — Model detected' }).click()
    await page.getByRole('button', { name: 'Show technical details' }).click()
    await page.getByRole('button', { name: 'Copy preview' }).click()
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download TXT' }).click()
    const download = await downloaded
    expect((await readFile((await download.path())!)).toString('utf8')).toBe(previewText)
    await page.getByLabel('Text to inspect').fill('edited draft')
    await mode.focus()
    await mode.press('Space')
    await expect(mode).not.toBeChecked()
    await expect(page.getByText('Next analysis uses catalog rules only; NER will not run.', { exact: true })).toBeVisible()
    await expect(page.getByText('Full scan: deterministic + NER', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Filter by entity type')).toHaveValue('type-0')
    await expect(page.getByLabel('Detection method')).toHaveValue('ner')
    await expect(page.locator('tr[aria-current="true"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Show details for Ana — Model detected' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true')
    expect(await page.locator('.highlighted-result').textContent()).toBe(text)
    expect(await page.locator('.preview-text').textContent()).toBe(previewText)
    await expect(page.getByText('Preview copied.', { exact: true })).toBeVisible()
    await expect(page.getByText('Download started.', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(previewText)
    expect(bodies).toHaveLength(1)
    expect(downloads).toBe(1)
    const language = page.getByRole('combobox', { name: 'Язык / Language' })
    for (const locale of ['en', 'ru']) {
      await language.selectOption(locale)
      await expect(mode).not.toBeChecked()
      await expect(page.locator('tr[aria-current="true"]')).toHaveCount(1)
      await expect(page.locator('.technical-toggle')).toHaveAttribute('aria-expanded', 'true')
      expect(await page.locator('.preview-text').textContent()).toBe(previewText)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({
        path: testInfo.outputPath(`${testInfo.project.name}-${locale}-${scheme}.png`),
        fullPage: true,
      })
    }
    await expect(page.getByRole('group', { name: 'Режим проверки', exact: true })).toBeVisible()
    await expect(page.getByText('Следующая проверка использует только правила каталога; NER не запустится.', { exact: true })).toBeVisible()
    await expect(page.getByText('Результат скопирован.', { exact: true })).toBeVisible()
    await expect(page.getByText('Скачивание началось.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Очистить', exact: true }).click()
    await expect(mode).not.toBeChecked()
    await expect(page.getByRole('table')).toHaveCount(0)
    expect(bodies).toHaveLength(1)
    await page.getByLabel('Открыть TXT', { exact: true }).setInputFiles({
      name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from(text),
    })
    await expect(page.getByText('TXT загружен. Проверьте текст и запустите проверку.', { exact: true })).toBeVisible()
    await expect(mode).not.toBeChecked()
    expect(bodies).toHaveLength(1)
    await page.getByRole('button', { name: 'Проверить текст', exact: true }).click()
    await expect(page.getByText('Ограниченная проверка: только детерминированный слой — NER не запускался.', { exact: true })).toBeVisible()
    expect(bodies).toEqual([
      { text: '🙂 Ana  a@b.de\n  東京\t ' },
      { text: '🙂 Ana  a@b.de\n  東京\t ', layers: ['deterministic'] },
    ])
    await language.selectOption('en')
    await mode.focus()
    await mode.press('Space')
    await expect(mode).toBeChecked()
    // The previous deterministic-only badge stays true until another result is accepted.
    await expect(page.getByText('Limited scan: deterministic only — NER did not run.', { exact: true })).toBeVisible()
    expect(bodies).toHaveLength(2)
    await page.getByRole('button', { name: 'Analyze text' }).click()
    await expect(page.getByText('Full scan: deterministic + NER', { exact: true })).toBeVisible()
    expect(bodies).toEqual([
      { text: '🙂 Ana  a@b.de\n  東京\t ' },
      { text: '🙂 Ana  a@b.de\n  東京\t ', layers: ['deterministic'] },
      { text: '🙂 Ana  a@b.de\n  東京\t ' },
    ])
    expect(downloads).toBe(1)
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({})
    expect(await page.evaluate(() => ({ ...sessionStorage }))).toEqual({})
  })
}

for (const health of ['pending', 'failed', 'no NER']) {
  test(`allows default analysis with ${health} health`, async ({ page }) => {
    const bodies: unknown[] = []
    let finishHealth: (() => void) | undefined
    await page.route('**/api/health', async route => {
      if (health === 'pending') await new Promise<void>(resolve => { finishHealth = resolve })
      await route.fulfill(health === 'failed'
        ? { status: 503, json: { detail: 'Unavailable' } }
        : { json: { ...fullHealth, ner: false } })
    })
    await page.route('**/api/detect', route => {
      bodies.push(route.request().postDataJSON())
      return route.fulfill({ json: { spans: [], layers_run: ['deterministic'], version: 'test' } })
    })
    await page.goto('/')
    if (health === 'failed') await expect(page.getByText('Detector unavailable.', { exact: true })).toBeVisible()
    if (health === 'no NER') await expect(page.getByText('Detector available: catalog rules.', { exact: true })).toBeVisible()
    const mode = page.getByRole('checkbox', { name: 'Use NER when available', exact: true })
    await expect(mode).toBeChecked()
    await expect(mode).toBeEnabled()
    await page.getByLabel('Text to inspect').fill('🙂 Ana')
    await page.getByRole('button', { name: 'Analyze text' }).click()
    await expect(page.getByText('Limited scan: deterministic only — NER did not run.', { exact: true })).toBeVisible()
    expect(bodies).toEqual([{ text: '🙂 Ana' }])
    finishHealth?.()
    await expect(mode).toBeChecked()
  })
}

test('locks the pending choice and ignores a delayed cleared result after a new mode analysis', async ({ page }) => {
  let finishOld!: () => void
  let oldResponseFulfilled!: () => void
  const oldResponse = new Promise<void>(resolve => { oldResponseFulfilled = resolve })
  const bodies: unknown[] = []
  await page.route('**/api/health', route => route.fulfill({ json: fullHealth }))
  await page.route('**/api/detect', async route => {
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 1) {
      await new Promise<void>(resolve => { finishOld = resolve })
      await route.fulfill({ json: fullResult })
      oldResponseFulfilled()
    } else {
      await route.fulfill({ json: { spans: [], layers_run: ['deterministic'], version: 'test' } })
    }
  })
  await page.goto('/')
  const mode = page.getByRole('checkbox', { name: /^(Use NER when available|Использовать NER, если доступен)$/ })
  await page.getByLabel('Text to inspect').fill(text)
  await page.getByRole('button', { name: 'Analyze text' }).click()
  await expect(mode).toBeDisabled()
  await expect.poll(() => bodies.length).toBe(1)
  await page.getByRole('combobox', { name: 'Язык / Language' }).selectOption('ru')
  await expect(mode).toBeChecked()
  await page.getByRole('button', { name: 'Очистить', exact: true }).click()
  await expect(mode).toBeEnabled()
  await mode.focus()
  await mode.press('Space')
  await page.getByLabel('Текст для проверки').fill('new 🙂 text')
  await page.getByRole('button', { name: 'Проверить текст', exact: true }).click()
  await expect(page.getByText('Ограниченная проверка: только детерминированный слой — NER не запускался.', { exact: true })).toBeVisible()
  finishOld()
  await oldResponse
  await expect(mode).not.toBeChecked()
  await expect(page.locator('.preview-text')).toHaveText('new 🙂 text')
  await expect(page.getByRole('table')).toHaveCount(0)
  expect(bodies).toEqual([
    { text: '🙂 Ana  a@b.de\n  東京\t ' },
    { text: 'new 🙂 text', layers: ['deterministic'] },
  ])
})
