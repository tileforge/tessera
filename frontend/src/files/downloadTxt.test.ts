import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadPseudonymizedTxt } from './downloadTxt'

const text = '  🙂 [PERSON_1]\r\n東京\n [EMAIL_1]  '

function browserDownload() {
  vi.useFakeTimers()
  const blobs: Blob[] = []
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return `blob:download-${blobs.length}`
  })
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true)
    expect(this.download).toBe('tessera-pseudonymized.txt')
    expect(this.href).toBe(`blob:download-${blobs.length}`)
  })
  return { blobs, createObjectURL, revokeObjectURL, click }
}

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downloadPseudonymizedTxt', () => {
  it('exports exact UTF-8 bytes with transparent endings and no metadata or BOM', async () => {
    const { blobs } = browserDownload()
    downloadPseudonymizedTxt(text)
    expect(blobs[0].type).toBe('text/plain;charset=utf-8')
    const reading = new Promise<ArrayBuffer>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(blobs[0])
    })
    await vi.runAllTimersAsync()
    expect(Array.from(new Uint8Array(await reading))).toEqual(Array.from(new TextEncoder().encode(text)))
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('removes anchors immediately and releases independent URLs exactly 1,000 ms after each click', () => {
    const { revokeObjectURL } = browserDownload()
    downloadPseudonymizedTxt(text)
    vi.advanceTimersByTime(500)
    downloadPseudonymizedTxt('second')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(499)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL.mock.calls).toEqual([['blob:download-1']])
    vi.advanceTimersByTime(499)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(revokeObjectURL.mock.calls).toEqual([['blob:download-1'], ['blob:download-2']])
  })

  it.each(['create', 'append', 'click', 'schedule'])('releases all acquired resources and propagates %s failures', kind => {
    const { createObjectURL, revokeObjectURL, click } = browserDownload()
    const fail = () => { throw new Error('synthetic failure') }
    if (kind === 'create') createObjectURL.mockImplementationOnce(fail)
    if (kind === 'append') vi.spyOn(document.body, 'appendChild').mockImplementationOnce(fail)
    if (kind === 'click') click.mockImplementationOnce(fail)
    if (kind === 'schedule') vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(fail)
    expect(() => downloadPseudonymizedTxt(text)).toThrow('synthetic failure')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL.mock.calls).toEqual(kind === 'create' ? [] : [['blob:download-1']])
    expect(vi.getTimerCount()).toBe(0)
  })
})
