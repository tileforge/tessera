import { useEffect, useState, type ReactNode } from 'react'

import { LocaleContext } from './context'
import { messages, type Locale } from './messages'

export function LocaleProvider({ children, initialLocale = 'en' }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  return <LocaleContext value={{ locale, messages: messages[locale], setLocale }}>{children}</LocaleContext>
}
