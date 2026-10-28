import { useEffect, useRef, useState } from 'react'

import type { DetectorSpan } from '../api/detector'
import { InvalidDetectionResponseError } from '../domain/detections'
import { buildPseudonymizedText } from '../domain/pseudonymization'

type PreviewProps = { text: string; spans: DetectorSpan[] }

function CopyablePreview({ preview, empty }: { preview: string; empty: boolean }) {
  const [status, setStatus] = useState('')
  const [copying, setCopying] = useState(false)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function copy() {
    setCopying(true)
    setStatus('')
    let message = 'Could not copy preview. Select the preview text to copy it manually.'
    try {
      await navigator.clipboard.writeText(preview)
      message = 'Preview copied.'
    } catch {
      // Clipboard errors can contain sensitive details. Keep feedback fixed.
    }
    if (active.current) {
      setStatus(message)
      setCopying(false)
    }
  }

  return (
    <section className="preview-panel" aria-label="Pseudonymized preview">
      <div className="preview-panel__header">
        <h2>Pseudonymized preview</h2>
        <button type="button" onClick={copy} disabled={copying}>Copy preview</button>
      </div>
      <p className="preview-text">{preview}</p>
      {empty && <p className="preview-note">No replacements were made.</p>}
      <p className="preview-note">
        Only detected values are replaced; undetected personal data can remain.
      </p>
      <p className="copy-status" role="status">{status}</p>
    </section>
  )
}

export function PseudonymizedPreview({ text, spans }: PreviewProps) {
  let preview: string
  try {
    preview = buildPseudonymizedText(text, spans)
  } catch (error) {
    if (error instanceof InvalidDetectionResponseError) {
      return <p role="alert">{error.message}</p>
    }
    throw error
  }

  // Remount copy state when the submitted snapshot changes, invalidating any
  // outstanding clipboard feedback from that snapshot.
  return <CopyablePreview key={JSON.stringify([text, spans])} preview={preview} empty={spans.length === 0} />
}
