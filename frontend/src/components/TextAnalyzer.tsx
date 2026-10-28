import { useRef } from 'react'

import type { TxtStatus } from '../files/txt'
import { useI18n } from '../i18n/context'

const exampleText = 'Die fiktive Kundin Martina Weber lebt in Berlin. Kontakt: martina.weber@example.com.'

type TextAnalyzerProps = {
  text: string
  pending: boolean
  onTextChange(text: string): void
  onAnalyze(): void
  onClear(): void
  txtImport?: { status: TxtStatus; selectFile(file: File): void }
}

export function TextAnalyzer({
  text,
  pending,
  onTextChange,
  onAnalyze,
  onClear,
  txtImport,
}: TextAnalyzerProps) {
  const { messages } = useI18n()
  const fileInput = useRef<HTMLInputElement>(null)
  const fileDisabled = pending || text.trim().length !== 0 || txtImport?.status === 'reading'
  const importError = txtImport && !['idle', 'reading', 'loaded'].includes(txtImport.status)
  return (
    <section className="analyzer-panel">
      <label htmlFor="detector-text">{messages.input}</label>
      <textarea
        id="detector-text"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <div className="analyzer-panel__actions">
        <button type="button" disabled={pending || text.trim().length === 0} onClick={onAnalyze}>
          {messages.analyze}
        </button>
        <button type="button" onClick={onClear}>{messages.clear}</button>
        <button
          type="button"
          disabled={pending || text.trim().length !== 0}
          onClick={() => { if (!pending && text.trim().length === 0) onTextChange(exampleText) }}
        >
          {messages.example}
        </button>
        {txtImport && (
          <button type="button" disabled={fileDisabled} onClick={() => fileInput.current?.click()}>
            {messages.openTxt}
          </button>
        )}
      </div>
      {txtImport && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept=".txt"
            aria-label={messages.openTxt}
            disabled={fileDisabled}
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) txtImport.selectFile(file)
            }}
          />
          <p className="preview-note">{messages.txtHint}</p>
          {txtImport.status !== 'idle' && (
            <p className="preview-note" role={importError ? 'alert' : 'status'}>
              {messages.txtFeedback[txtImport.status]}
            </p>
          )}
        </>
      )}
      <p className="preview-note">{messages.exampleNote}</p>
    </section>
  )
}
