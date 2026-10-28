import { useI18n } from '../i18n/context'

const exampleText = 'Die fiktive Kundin Martina Weber lebt in Berlin. Kontakt: martina.weber@example.com.'

type TextAnalyzerProps = {
  text: string
  pending: boolean
  onTextChange(text: string): void
  onAnalyze(): void
  onClear(): void
}

export function TextAnalyzer({
  text,
  pending,
  onTextChange,
  onAnalyze,
  onClear,
}: TextAnalyzerProps) {
  const { messages } = useI18n()
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
      </div>
      <p className="preview-note">{messages.exampleNote}</p>
    </section>
  )
}
