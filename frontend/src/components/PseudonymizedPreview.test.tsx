import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DetectorSpan } from '../api/detector'
import { LocaleContext } from '../i18n/context'
import { messages } from '../i18n/messages'
import { PseudonymizedPreview } from './PseudonymizedPreview'

const spans: DetectorSpan[] = [{
  entity_type: 'PERSON', start: 2, end: 5, confidence: 0.91,
  recognizer: 'ner:gliner', tier: 2, boosted: false,
}]

afterEach(() => {
  cleanup()
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PseudonymizedPreview', () => {
  it('downloads the exact accepted preview only on click and keeps clipboard feedback independent', async () => {
    vi.useFakeTimers()
    let payload: Blob | undefined
    const createObjectURL = vi.fn((blob: Blob) => { payload = blob; return 'blob:preview' })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = render(<PseudonymizedPreview text={'🙂 Ada\r\n  '} spans={spans} />)
    expect(createObjectURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Download TXT' }))
    const reading = new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(payload!)
    })
    await vi.runAllTimersAsync()
    expect(await reading).toBe('🙂 [PERSON_1]\r\n  ')
    expect(screen.getByText('Download started.')).toBeVisible()
    expect(writeText).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy preview' })) })
    expect(screen.getByText('Preview copied.')).toBeVisible()
    expect(screen.getByText('Download started.')).toBeVisible()
    view.rerender(<PseudonymizedPreview text="Next result" spans={[]} />)
    expect(screen.queryByText('Download started.')).not.toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('releases a started download after the accepted preview unmounts', () => {
    vi.useFakeTimers()
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:unmounted', revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = render(<PseudonymizedPreview text="unchanged" spans={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download TXT' }))
    view.unmount()
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:unmounted')
  })

  it('translates fixed download failure, retries unchanged no-findings text, and translates success', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn().mockImplementationOnce(() => { throw new Error('sensitive detail') }).mockReturnValue('blob:retry')
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const content = <PseudonymizedPreview text="東京 unchanged" spans={[]} />
    const view = render(<LocaleContext value={{ locale: 'en', messages: messages.en, setLocale: () => {} }}>{content}</LocaleContext>)
    fireEvent.click(screen.getByRole('button', { name: 'Download TXT' }))
    expect(screen.getByText('Could not start the download. Try again or copy the preview.')).toBeVisible()
    expect(screen.queryByText(/sensitive detail/)).not.toBeInTheDocument()
    view.rerender(<LocaleContext value={{ locale: 'ru', messages: messages.ru, setLocale: () => {} }}>{content}</LocaleContext>)
    expect(screen.getByText('Не удалось начать скачивание. Попробуйте снова или скопируйте результат.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Скачать TXT' }))
    expect(screen.getByText('Скачивание началось.')).toBeVisible()
    expect(screen.getByText('Замены не выполнены.')).toBeVisible()
    view.rerender(<LocaleContext value={{ locale: 'en', messages: messages.en, setLocale: () => {} }}>{content}</LocaleContext>)
    expect(screen.getByText('Download started.')).toBeVisible()
  })

  it('copies exactly the transformed snapshot only after an explicit click', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<PseudonymizedPreview text={'🙂 Ada\n  '} spans={spans} />)

    const preview = screen.getByRole('region', { name: 'Pseudonymized preview' })
    expect(within(preview).getByText('🙂 [PERSON_1]')).toBeVisible()
    expect(within(preview).getByText(/undetected personal data can remain/i)).toBeVisible()
    expect(writeText).not.toHaveBeenCalled()
    await user.click(within(preview).getByRole('button', { name: 'Copy preview' }))
    expect(writeText).toHaveBeenCalledExactlyOnceWith('🙂 [PERSON_1]\n  ')
    expect(await screen.findByRole('status')).toHaveTextContent('Preview copied.')
  })

  it.each(['missing', 'denied'])(
    'keeps selectable preview text with a fixed error when clipboard is %s', async (kind) => {
      const user = userEvent.setup()
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: kind === 'missing' ? undefined : {
          writeText: () => Promise.reject(new Error('sensitive exception detail')),
        },
      })
      render(<PseudonymizedPreview text="🙂 Ada" spans={spans} />)
      await user.click(screen.getByRole('button', { name: 'Copy preview' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Could not copy preview. Select the preview text to copy it manually.')
      expect(screen.getByText('🙂 [PERSON_1]')).toBeVisible()
      expect(screen.queryByText(/sensitive exception detail/)).not.toBeInTheDocument()
    },
  )

  it.each(['resolve', 'reject'])('ignores late clipboard %s after result changes', async (outcome) => {
    const user = userEvent.setup()
    let finish!: () => void
    const writeText = () => new Promise<void>((resolve, reject) => {
      finish = () => outcome === 'resolve' ? resolve() : reject(new Error('old result'))
    })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = render(<PseudonymizedPreview text="🙂 Ada" spans={spans} />)
    await user.click(screen.getByRole('button', { name: 'Copy preview' }))
    view.rerender(<PseudonymizedPreview text="New text" spans={[]} />)
    await act(async () => finish())

    expect(screen.getByText('New text')).toBeVisible()
    expect(screen.queryByText(/Preview copied|Could not copy/)).not.toBeInTheDocument()
  })

  it('resets completed copy feedback for a changed result', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.resolve() },
    })
    const view = render(<PseudonymizedPreview text="🙂 Ada" spans={spans} />)
    await user.click(screen.getByRole('button', { name: 'Copy preview' }))
    await screen.findByText('Preview copied.')
    view.rerender(<PseudonymizedPreview text="Next result" spans={[]} />)
    expect(screen.queryByText('Preview copied.')).not.toBeInTheDocument()
  })

  it('shows unchanged zero-span text and explains no replacements were made', () => {
    render(<PseudonymizedPreview text={'unchanged\n  text'} spans={[]} />)
    expect(screen.getByText('unchanged text')).toHaveTextContent('unchanged text')
    expect(screen.getByText(/No replacements were made/)).toBeVisible()
  })

  it('does not offer a partial preview or copy when offsets are invalid', () => {
    render(<PseudonymizedPreview text="Ada" spans={spans} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Detector returned invalid span offsets.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
  })
})
