import { useCallback, useEffect, useRef, useState } from 'react'

import { decodeTxt, validateTxtFile, type TxtStatus } from './txt'

export function useTxtImport(eligible: boolean, commitText: (text: string) => void) {
  const [status, setStatus] = useState<TxtStatus>('idle')
  const generation = useRef(0)
  const activeReader = useRef<FileReader | null>(null)

  const releaseReader = useCallback(() => {
    const reader = activeReader.current
    activeReader.current = null
    if (reader) {
      reader.onload = null
      reader.onerror = null
      reader.onabort = null
      if (reader.readyState === 1) reader.abort()
    }
  }, [])

  const invalidate = useCallback(() => {
    generation.current += 1
    releaseReader()
    setStatus('idle')
  }, [releaseReader])

  useEffect(() => () => {
    generation.current += 1
    releaseReader()
  }, [releaseReader])

  function selectFile(file: File) {
    // A native picker can return after eligibility has changed.
    if (!eligible || activeReader.current) return
    const validationError = validateTxtFile(file)
    if (validationError) {
      setStatus(validationError)
      return
    }

    const readGeneration = ++generation.current
    setStatus('reading')
    const reader = new FileReader()
    activeReader.current = reader
    const isCurrent = () => generation.current === readGeneration && activeReader.current === reader
    const fail = () => {
      if (!isCurrent()) return
      releaseReader()
      setStatus('read')
    }
    reader.onload = () => {
      if (!isCurrent()) return
      const bytes = reader.result
      releaseReader()
      if (!bytes || typeof bytes === 'string') {
        setStatus('read')
        return
      }
      const decoded = decodeTxt(bytes)
      if ('error' in decoded) {
        setStatus(decoded.error)
        return
      }
      commitText(decoded.text)
      setStatus('loaded')
    }
    reader.onerror = fail
    reader.onabort = fail
    try {
      reader.readAsArrayBuffer(file)
    } catch {
      fail()
    }
  }

  return { status, selectFile, invalidate }
}
