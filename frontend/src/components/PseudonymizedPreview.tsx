import { useEffect, useRef, useState } from 'react'

import { downloadPseudonymizedTxt } from '../files/downloadTxt'
import { useI18n } from '../i18n/context'
import { errorMessage } from '../i18n/errors'
import type { DetectorSpan } from '../api/detector'
import { InvalidDetectionResponseError } from '../domain/detections'
import { buildPseudonymizedText } from '../domain/pseudonymization'

type PreviewProps = { text: string; spans: DetectorSpan[] }

function CopyablePreview({ preview, empty }: { preview: string; empty: boolean }) {
  const { messages } = useI18n()
  const [status, setStatus] = useState<'idle' | 'copied' | 'copyFailed'>('idle')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloadStarted' | 'downloadFailed'>('idle')
  const [copying, setCopying] = useState(false)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function copy() {
    setCopying(true)
    setStatus('idle')
    let status: 'copied' | 'copyFailed' = 'copyFailed'
    try {
      await navigator.clipboard.writeText(preview)
      status = 'copied'
    } catch {
      // Clipboard errors can contain sensitive details. Keep feedback fixed.
    }
    if (active.current) {
      setStatus(status)
      setCopying(false)
    }
  }

  function download() {
    try {
      downloadPseudonymizedTxt(preview)
      setDownloadStatus('downloadStarted')
    } catch {
      // Browser errors can contain sensitive details. Keep feedback fixed.
      setDownloadStatus('downloadFailed')
    }
  }

  return (
    <section className="preview-panel" aria-label={messages.preview}>
      <div className="preview-panel__header">
        <h2>{messages.preview}</h2>
        <div className="preview-panel__actions">
          <button type="button" onClick={copy} disabled={copying}>{messages.copy}</button>
          <button type="button" onClick={download}>{messages.downloadTxt}</button>
        </div>
      </div>
      <p className="preview-text">{preview}</p>
      {empty && <p className="preview-note">{messages.noReplacements}</p>}
      <p className="preview-note">
        {messages.previewCaveat}
      </p>
      <p className="copy-status" role="status">{status === 'idle' ? '' : messages[status]}</p>
      <p className="preview-note" aria-live="polite" aria-atomic="true">
        {downloadStatus === 'idle' ? '' : messages[downloadStatus]}
      </p>
    </section>
  )
}

export function PseudonymizedPreview({ text, spans }: PreviewProps) {
  const { locale, messages } = useI18n()
  let preview: string
  try {
    preview = buildPseudonymizedText(text, spans)
  } catch (error) {
    if (error instanceof InvalidDetectionResponseError) {
      return <p role="alert">{errorMessage(error, locale, messages)}</p>
    }
    throw error
  }

  // Remount action feedback when the submitted snapshot changes, invalidating any
  // outstanding clipboard feedback from that snapshot.
  return <CopyablePreview key={JSON.stringify([text, spans])} preview={preview} empty={spans.length === 0} />
}
