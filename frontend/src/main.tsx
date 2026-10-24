import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// Link di conferma degli appuntamenti (/c/<codice>): pagina pubblica, senza il resto dell'app.
const confirmToken = window.location.pathname.match(/^\/c\/([A-Za-z0-9_-]{24})\/?$/)?.[1]
// Fidelity card (/f/<token>): pagina pubblica sul dominio dedicato alle carte.
const cardToken = window.location.pathname.match(/^\/f\/([A-Za-z0-9_-]{32})\/?$/)?.[1]
const App = lazy(() => import('./App.tsx'))
const Carta = lazy(() => import('./pages/Carta.tsx'))
const Conferma = lazy(() => import('./pages/Conferma.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{confirmToken ? <Conferma token={confirmToken} /> : cardToken ? <Carta token={cardToken} /> : <App />}</Suspense>
  </StrictMode>,
)
