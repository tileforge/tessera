import { createContext, useContext } from 'react'

import { messages, type Locale, type Messages } from './messages'

type I18n = { locale: Locale; messages: Messages; setLocale(locale: Locale): void }

export const LocaleContext = createContext<I18n>({
  locale: 'en', messages: messages.en, setLocale: () => {},
})

export function useI18n() {
  return useContext(LocaleContext)
}
