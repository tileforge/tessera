import { expect, test, type Page } from '@playwright/test'

const source = '  🙂 Ana\r\n東京\n a@b.de  '
const preview = '  🙂 [PERSON_1]\r\n東京\n [EMAIL_1]  '
const privateName = 'synthetic-private-document.TXT'

async function choose(page: Page, name: string, buffer: Buffer, label = 'Open TXT file') {
  const chooser = page.waitForEvent('filechooser')
  const button = page.getByRole('button', { name: label, exact: true })
  await button.focus()
  await button.press('Enter')
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer })
}

for (const scheme of ['light', 'dark'] as const) {
  test(`imports TXT locally and preserves exact manual payload and accepted controls in ${scheme}`, async ({ page, context }, testInfo) => {
    const errors: string[] = []
    const bodies: unknown[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', ner: true, ner_off_reason: null } }))
    await page.route('**/api/detect', route => {
      bodies.push(route.request().postDataJSON())
      return route.fulfill({ json: {
        spans: [
          { entity_type: 'PERSON', start: 4, end: 7, confidence: 0.9, recognizer: 'ner:test', tier: 2, boosted: false },
          { entity_type: 'EMAIL', start: 13, end: 19, confidence: 0.9, recognizer: 'catalog:email', tier: 2, boosted: false },
        ], layers_run: ['deterministic', 'ner'], version: 'test',
      } })
    })
    await page.goto('/')
    await page.evaluate(() => navigator.clipboard.writeText('unchanged clipboard'))
    await choose(page, privateName, Buffer.from('\uFEFF' + source))
    await expect(page.getByText('TXT loaded. Review the text, then analyze when ready.')).toBeVisible()
    await expect(page.getByLabel('Text to inspect')).toHaveValue(source.replace(/\r\n/g, '\n'))
    await expect(page.getByRole('button', { name: 'Open TXT file' })).toBeDisabled()
    expect(bodies).toEqual([])
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('unchanged clipboard')
    expect(await page.locator('input[type="file"]').inputValue()).toBe('')
    await expect(page.locator('.analysis-status')).not.toContainText('TXT')
    await expect(page.locator('body')).not.toContainText(privateName)
    await page.getByRole('button', { name: 'Analyze text' }).click()
    const submitted = page.locator('.highlighted-result')
    const transformed = page.locator('.preview-text')
    await expect(transformed).toBeVisible()
    expect(bodies).toEqual([{ text: source }])
    expect(await submitted.textContent()).toBe(source)
    expect(await transformed.textContent()).toBe(preview)
    await expect(submitted.getByRole('mark')).toHaveCount(2)
    await page.getByRole('combobox', { name: 'Filter by entity type' }).selectOption({ label: 'PERSON' })
    await page.getByRole('button', { name: 'Show details for Ana — Model detected' }).click()
    await page.getByRole('button', { name: 'Show technical details' }).click()
    await page.getByRole('button', { name: 'Copy preview' }).click()
    await expect(page.getByText('Preview copied.')).toBeVisible()
    await page.getByLabel('Text to inspect').fill('')
    await choose(page, privateName, Buffer.from('new local draft'))
    await expect(page.getByLabel('Text to inspect')).toHaveValue('new local draft')
    expect(bodies).toHaveLength(1)
    expect(await submitted.textContent()).toBe(source)
    expect(await transformed.textContent()).toBe(preview)
    await expect(page.getByRole('combobox', { name: 'Filter by entity type' }).locator('option:checked')).toHaveText('PERSON')
    await expect(page.locator('tr[aria-current="true"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('combobox', { name: 'Язык / Language' }).selectOption('ru')
    await expect(page.getByText('TXT загружен. Проверьте текст и запустите проверку.')).toBeVisible()
    await expect(page.getByText('Результат скопирован.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Скрыть технические сведения' })).toHaveAttribute('aria-expanded', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`txt-ru-${scheme}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Очистить' }).click()
    await choose(page, privateName, Buffer.from('\uFEFF' + source), 'Открыть TXT')
    await expect(page.getByLabel('Текст для проверки')).toHaveValue(source.replace(/\r\n/g, '\n'))
    await expect(page.getByRole('table')).toHaveCount(0)
    expect(bodies).toHaveLength(1)
    await page.getByRole('combobox', { name: 'Язык / Language' }).selectOption('en')
    await page.screenshot({ path: testInfo.outputPath(`txt-en-${scheme}.png`), fullPage: true })
    expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({})
    expect(await page.evaluate(() => ({ ...sessionStorage }))).toEqual({})
    expect(new URL(page.url()).search).toBe('')
    expect(new URL(page.url()).hash).toBe('')
    expect(errors).toEqual([])
  })

  test(`rejects unsafe TXT with localized feedback and retries through the chooser in ${scheme}`, async ({ page }, testInfo) => {
    let calls = 0
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', ner: true, ner_off_reason: null } }))
    await page.route('**/api/detect', route => { calls++; return route.fulfill({ json: { spans: [], layers_run: [], version: 'test' } }) })
    await page.goto('/')
    await choose(page, 'private.csv', Buffer.from('never display'))
    await expect(page.getByRole('alert')).toHaveText('Choose a .txt file.')
    await page.getByRole('combobox', { name: 'Язык / Language' }).selectOption('ru')
    await expect(page.getByRole('alert')).toHaveText('Выберите файл .txt.')
    await choose(page, privateName, Buffer.from([0xc3, 0x28]), 'Открыть TXT')
    await expect(page.getByRole('alert')).toHaveText('Сохраните файл как обычный текст в UTF-8 и попробуйте снова.')
    await expect(page.getByLabel('Текст для проверки')).toHaveValue('')
    await expect(page.locator('body')).not.toContainText(privateName)
    await expect(page.locator('body')).not.toContainText('private.csv')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`txt-error-ru-${scheme}.png`), fullPage: true })
    await choose(page, privateName, Buffer.from('точный 🙂 текст'), 'Открыть TXT')
    await expect(page.getByLabel('Текст для проверки')).toHaveValue('точный 🙂 текст')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Очистить' }).click()
    await expect(page.getByLabel('Текст для проверки')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Открыть TXT' })).toBeEnabled()
    expect(calls).toBe(0)
    expect(errors).toEqual([])
    expect(await page.evaluate(() => ({ ...localStorage, ...sessionStorage }))).toEqual({})
    expect(new URL(page.url()).search).toBe('')
  })
}
