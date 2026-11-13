import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { isAccessDeniedError } from '@/lib/supabase'
import { ToastProvider } from '@/components/ui'
import App from './App'
import './index.css'

function reportAccessDenied(error: unknown) {
  if (isAccessDeniedError(error)) window.dispatchEvent(new CustomEvent('jurisflow:access-denied'))
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportAccessDenied }),
  mutationCache: new MutationCache({ onError: reportAccessDenied }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
