import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test, type Download, type Page } from '@playwright/test'

const source = '  🙂 Ada\r\n東京\n a@b.de  '
const expected = '  🙂 [PERSON_1]\r\n東京\n [EMAIL_1]  '
const spans = [
  { entity_type: 'PERSON', start: 4, end: 7, confidence: 0.91, recognizer: 'ner:gliner', tier: 2, boosted: false },
  { entity_type: 'EMAIL', start: 13, end: 19, confidence: 0.95, recognizer: 'catalog:email', tier: 2, boosted: false },
]
const screenshots = fileURLToPath(new URL('../../.superpowers/sdd/2026-10-29-txt-export/screenshots/', import.meta.url))

async function mockHealth(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', ner: true, ner_off_reason: null } }))
}

async function assertDownloadBytes(download: Download, text: string) {
  expect(download.suggestedFilename()).toBe('tessera-pseudonymized.txt')
  expect(await download.failure()).toBeNull()
  expect(await readFile((await download.path())!)).toEqual(Buffer.from(text, 'utf8'))
}

for (const scheme of ['light', 'dark'] as const) {
  test(`downloads exact accepted preview bytes despite filters and draft edits in EN/RU ${scheme}`, async ({ page, context }, testInfo) => {
    const errors: string[] = []
    const posts: string[] = []
    const downloads: Download[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()) })
    page.on('download', download => downloads.push(download))
    await page.emulateMedia({ colorScheme: scheme })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockHealth(page)
    await page.route('**/api/detect', route => {
      expect(route.request().postDataJSON()).toEqual({ text: source })
      return route.fulfill({ json: { spans, layers_run: ['deterministic', 'ner'], version: 'test' } })
    })
    await page.goto('/')
    await page.evaluate(() => navigator.clipboard.writeText('untouched clipboard'))
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })))
      .toEqual({ local: {}, session: {} })
    await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-source.txt', mimeType: 'text/plain', buffer: Buffer.from(source) })
    await expect(page.getByText('TXT loaded. Review the text, then analyze when ready.')).toBeVisible()
    expect(posts).toHaveLength(0)
    expect(downloads).toHaveLength(0)
    await page.getByRole('button', { name: 'Analyze text' }).click()
    const preview = page.getByRole('region', { name: /^(Pseudonymized preview|Результат псевдонимизации)$/ })
    await expect(preview).toBeVisible()
    expect(await preview.locator('.preview-text').textContent()).toBe(expected)
    await page.getByLabel('Filter by entity type').selectOption({ label: 'PERSON' })
    await page.getByLabel('Detection method').selectOption('pattern')
    await expect(page.getByText('Showing 0 of 2 findings.')).toBeVisible()
    await page.getByLabel('Text to inspect').fill('Synthetic draft must never be exported')
    expect(downloads).toHaveLength(0)
    await mkdir(screenshots, { recursive: true })
    await page.screenshot({ path: `${screenshots}${testInfo.project.name}-${scheme}-en.png`, fullPage: true })
    await preview.getByRole('button', { name: 'Copy preview' }).focus()
    await page.keyboard.press('Tab')
    const downloadButton = preview.getByRole('button', { name: 'Download TXT' })
    await expect(downloadButton).toBeFocused()
    const firstDownload = page.waitForEvent('download')
    await downloadButton.press('Enter')
    await assertDownloadBytes(await firstDownload, expected)
    await expect(preview.getByText('Download started.', { exact: true })).toBeVisible()
    await page.getByLabel('Язык / Language').selectOption('ru')
    await expect(preview.getByText('Скачивание началось.', { exact: true })).toBeVisible()
    expect(downloads).toHaveLength(1)
    const secondDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Скачать TXT' }).press('Space')
    await assertDownloadBytes(await secondDownload, expected)
    expect(downloads).toHaveLength(2)
    expect(posts).toHaveLength(1)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('untouched clipboard')
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })))
      .toEqual({ local: {}, session: {} })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: `${screenshots}${testInfo.project.name}-${scheme}-ru.png`, fullPage: true })
    await page.getByRole('button', { name: 'Очистить', exact: true }).click()
    await expect(preview).toHaveCount(0)
    expect(downloads).toHaveLength(2)
    expect(errors).toEqual([])
  })
}

test('downloads unchanged no-findings results, safely retries a failure and resets on new result and Clear', async ({ page }) => {
  await mockHealth(page)
  let calls = 0
  const downloads: Download[] = []
  page.on('download', download => downloads.push(download))
  await page.route('**/api/detect', route => {
    calls++
    return route.fulfill({ json: { spans: [], layers_run: ['deterministic', 'ner'], version: 'test' } })
  })
  await page.goto('/')
  const input = page.getByLabel('Text to inspect')
  await input.fill('  🙂 東京\n unchanged  ')
  await page.getByRole('button', { name: 'Analyze text' }).click()
  await expect(page.getByText('No replacements were made.')).toBeVisible()
  expect(downloads).toHaveLength(0)
  await page.evaluate(() => {
    const original = URL.createObjectURL
    URL.createObjectURL = () => {
      URL.createObjectURL = original
      throw new Error('synthetic sensitive exception')
    }
  })
  await page.getByRole('button', { name: 'Download TXT' }).click()
  await expect(page.getByText('Could not start the download. Try again or copy the preview.')).toBeVisible()
  await expect(page.getByText('synthetic sensitive exception')).toHaveCount(0)
  expect(downloads).toHaveLength(0)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download TXT' }).click()
  await assertDownloadBytes(await download, '  🙂 東京\n unchanged  ')
  await input.fill('New accepted text')
  await page.getByRole('button', { name: 'Analyze text' }).click()
  await expect(page.locator('.preview-text')).toHaveText('New accepted text')
  await expect(page.getByText('Download started.', { exact: true })).toHaveCount(0)
  expect(downloads).toHaveLength(1)
  const nextDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download TXT' }).click()
  await assertDownloadBytes(await nextDownload, 'New accepted text')
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download TXT' })).toHaveCount(0)
  expect(calls).toBe(2)
  expect(downloads).toHaveLength(2)
})
