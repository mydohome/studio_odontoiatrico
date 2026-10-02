import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// Link di conferma degli appuntamenti (/c/<codice>): pagina pubblica, senza il resto dell'app.
const confirmToken = window.location.pathname.match(/^\/c\/([A-Za-z0-9_-]{24})\/?$/)?.[1]
const App = lazy(() => import('./App.tsx'))
const Conferma = lazy(() => import('./pages/Conferma.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{confirmToken ? <Conferma token={confirmToken} /> : <App />}</Suspense>
  </StrictMode>,
)
