import { expect, test, type Page } from '@playwright/test'

// The e-mail is here for the layer that carries no checksum: appended, so the
// offsets of everything before it are untouched. `catalog:email` at 0.95 is
// what the detector really sends for an address — there is no checksum to
// verify, and the evidence label and colour have to say so.
const inspectedText = '🙂 Martina in Bern • 4111 a@b.de'
const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`)
    }
  })
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

async function mockDetector(page: Page) {
  await page.route('**/api/health', (route) => route.fulfill({
    json: { status: 'ok', ner: true, ner_off_reason: null },
  }))
  await page.route('**/api/detect', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ text: inspectedText })
    await route.fulfill({
      json: {
        spans: [
          {
            entity_type: 'PERSON', start: 2, end: 9, confidence: 0.91,
            recognizer: 'ner:gliner', tier: 2, boosted: false,
          },
          {
            entity_type: 'LOCATION', start: 13, end: 17, confidence: 0.88,
            recognizer: 'ner:gliner', tier: 2, boosted: false,
          },
          {
            entity_type: 'CREDIT_CARD', start: 20, end: 24, confidence: 1,
            recognizer: 'catalog:credit_card', tier: 1, boosted: false,
          },
          {
            entity_type: 'EMAIL', start: 25, end: 31, confidence: 0.95,
            recognizer: 'catalog:email', tier: 2, boosted: false,
          },
        ],
        layers_run: ['deterministic', 'ner'],
        version: 'test-version',
      },
    })
  })
}

test('analyzes and clears text without persisting it', async ({ page }, testInfo) => {
  await mockDetector(page)
  await page.goto('/')
  await page.getByLabel('Text to inspect').fill(inspectedText)
  await page.getByRole('button', { name: 'Analyze text' }).click()
  await expect(page.getByText('Model detected').first()).toBeVisible()
  expect(page.url()).not.toContain('Martina')
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({})
  expect(await page.evaluate(() => ({ ...sessionStorage }))).toEqual({})
  await expect(page.getByRole('region', { name: 'Pseudonymized preview' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('preview.png'), fullPage: true })
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText('Martina', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pseudonymized preview' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy preview' })).toHaveCount(0)
})

test('explains coverage and copies the local preview through the real clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockDetector(page)
  await page.goto('/')
  const coverage = page.getByRole('note', { name: 'Detection coverage' })
  await expect(coverage).toContainText('Phone numbers are not currently supported.')
  await page.evaluate(() => navigator.clipboard.writeText('clipboard unchanged'))
  await page.getByLabel('Text to inspect').fill(inspectedText)
  await page.getByRole('button', { name: 'Analyze text' }).click()
  const preview = page.getByRole('region', { name: 'Pseudonymized preview' })
  await expect(preview).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('clipboard unchanged')
  await expect(preview).toContainText('Only detected values are replaced; undetected personal data can remain.')
  await page.getByRole('button', { name: 'Copy preview' }).click()
  await expect(preview.getByRole('status')).toHaveText('Preview copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toBe('🙂 [PERSON_1] in [LOCATION_1] • [CREDIT_CARD_1] [EMAIL_1]')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(coverage).toBeVisible()
  await expect(preview).toHaveCount(0)
})

test('uses the approved layer presentation and preserves visible mobile detail labels', async ({ page }) => {
  await mockDetector(page)
  await page.goto('/')
  await page.getByLabel('Text to inspect').fill(inspectedText)
  await page.getByRole('button', { name: 'Analyze text' }).click()

  const martina = page.locator('mark[aria-label="Martina — Model detected"]')
  await expect(martina).toBeVisible()
  await expect(martina).toHaveCSS('background-color', 'rgb(219, 234, 254)')

  const card = page.locator('mark[aria-label="4111 — Checksum verified"]')
  await expect(card).toBeVisible()
  await expect(card).toHaveCSS('background-color', 'rgb(220, 252, 231)')
  await expect(page.getByText('Checksum verified').first()).toBeVisible()

  if (page.viewportSize()?.width === 320) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const label of ['Fragment', 'Entity type', 'Layer', 'Confidence', 'Tier', 'Recognizer', 'Context']) {
      const labelPresentation = await page.locator(`td[data-label="${label}"]`).first().evaluate((cell) => {
        const labelStyle = getComputedStyle(cell, '::before')
        const cellBox = cell.getBoundingClientRect()
        return {
          content: labelStyle.content,
          display: labelStyle.display,
          fontSize: Number.parseFloat(labelStyle.fontSize),
          opacity: Number.parseFloat(labelStyle.opacity),
          position: labelStyle.position,
          visibility: labelStyle.visibility,
          width: cellBox.width,
          height: cellBox.height,
        }
      })
      expect(labelPresentation.content).toContain(label)
      expect(labelPresentation.display).not.toBe('none')
      expect(labelPresentation.visibility).toBe('visible')
      expect(labelPresentation.opacity).toBeGreaterThan(0)
      expect(labelPresentation.fontSize).toBeGreaterThan(0)
      expect(labelPresentation.position).toBe('static')
      expect(labelPresentation.width).toBeGreaterThan(0)
      expect(labelPresentation.height).toBeGreaterThan(0)
    }
  }
})

test('uses approved accessible evidence foreground and background pairs in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await mockDetector(page)
  await page.goto('/')
  await page.getByLabel('Text to inspect').fill(inspectedText)
  await page.getByRole('button', { name: 'Analyze text' }).click()

  const martina = page.locator('mark[aria-label="Martina — Model detected"]')
  await expect(martina).toHaveCSS('background-color', 'rgb(30, 58, 138)')
  await expect(martina).toHaveCSS('color', 'rgb(219, 234, 254)')

  const card = page.locator('mark[aria-label="4111 — Checksum verified"]')
  await expect(card).toHaveCSS('background-color', 'rgb(20, 83, 45)')
  await expect(card).toHaveCSS('color', 'rgb(220, 252, 231)')

  // The catalog layer that carries no checksum. Its colours were added without
  // this assertion and were the only evidence pair in the page nothing checked.
  const email = page.locator('mark[aria-label="a@b.de — Deterministic pattern"]')
  await expect(email).toHaveCSS('background-color', 'rgb(5, 46, 22)')
  await expect(email).toHaveCSS('color', 'rgb(220, 252, 231)')
})

test('preserves submitted whitespace and wraps an unbroken value at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.route('**/api/health', (route) => route.fulfill({
    json: { status: 'ok', ner: true, ner_off_reason: null },
  }))
  await page.route('**/api/detect', (route) => route.fulfill({
    json: {
      spans: [{
        entity_type: 'TEXT', start: 0, end: 8, confidence: 0.91,
        recognizer: 'ner:gliner', tier: 2, boosted: false,
      }],
      layers_run: ['deterministic', 'ner'],
      version: 'test-version',
    },
  }))
  await page.goto('/')
  const text = `Line one\nLine two  ${'x'.repeat(400)}`
  await page.getByLabel('Text to inspect').fill(text)
  await page.getByRole('button', { name: 'Analyze text' }).click()

  const result = page.locator('.highlighted-result')
  await expect(result).toContainText(text)
  await expect(result).toHaveCSS('white-space', 'pre-wrap')
  await expect(result).toHaveCSS('overflow-wrap', 'anywhere')
  const preview = page.locator('.preview-text')
  await expect(preview).toHaveText(`[ENTITY_1]\nLine two  ${'x'.repeat(400)}`, { useInnerText: false })
  await expect(preview).toHaveCSS('white-space', 'pre-wrap')
  await expect(preview).toHaveCSS('overflow-wrap', 'anywhere')
  await expect(preview).toHaveCSS('user-select', 'text')
  const submittedBox = await page.getByRole('region', { name: 'Submitted text' }).boundingBox()
  const previewBox = await page.getByRole('region', { name: 'Pseudonymized preview' }).boundingBox()
  expect(previewBox!.y).toBeGreaterThanOrEqual(submittedBox!.y + submittedBox!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
