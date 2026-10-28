import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { Playground } from './Playground'
import { LocaleProvider } from './i18n/LocaleProvider'
import type { Locale } from './i18n/messages'

type AppProps = {
  queryClient?: QueryClient
  initialLocale?: Locale
}

export function App({ queryClient: providedQueryClient, initialLocale }: AppProps) {
  const [queryClient] = useState(() => providedQueryClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, gcTime: 0 },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale={initialLocale}>
        <Playground />
      </LocaleProvider>
    </QueryClientProvider>
  )
}
