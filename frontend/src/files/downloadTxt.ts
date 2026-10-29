export function downloadPseudonymizedTxt(text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8', endings: 'transparent' })
  const url = URL.createObjectURL(blob)
  let anchor: HTMLAnchorElement | undefined
  try {
    anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'tessera-pseudonymized.txt'
    document.body.appendChild(anchor)
    anchor.click()
    // Give the browser time to consume the URL, independently of the preview's lifetime.
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  } finally {
    anchor?.remove()
  }
}
