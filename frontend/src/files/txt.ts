export type TxtError = 'type' | 'size' | 'empty' | 'encoding' | 'read'
export type TxtStatus = 'idle' | 'reading' | 'loaded' | TxtError

export function validateTxtFile(file: File): TxtError | null {
  if (!/\.txt$/i.test(file.name)) return 'type'
  if (file.size > 100000) return 'size'
  if (file.size === 0) return 'empty'
  return null
}

export function decodeTxt(bytes: ArrayBuffer): { text: string } | { error: TxtError } {
  let text: string
  try {
    // Fatal decoding rejects malformed input; the decoder strips a UTF-8 BOM.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { error: 'encoding' }
  }
  if (text.includes('\0')) return { error: 'encoding' }
  if (text.trim().length === 0) return { error: 'empty' }
  return { text }
}
