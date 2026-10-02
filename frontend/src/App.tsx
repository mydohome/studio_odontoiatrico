import { BarChart3, CalendarDays, ClipboardPlus, Loader2, Megaphone, Settings } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { ToastProvider } from './components/Toast.tsx'
import { Tooth } from './components/Tooth.tsx'
import { api, setUnauthorizedHandler, type SessionUser, type StudioBrand } from './lib/api.ts'
import { useCustomLogo } from './lib/logo.ts'
import { useAppData } from './lib/useData.ts'
import Appuntamenti from './pages/Appuntamenti.tsx'
import Campagne from './pages/Campagne.tsx'
import Impostazioni from './pages/Impostazioni.tsx'
import Login from './pages/Login.tsx'
import Registra from './pages/Registra.tsx'

// La dashboard include la libreria dei grafici: caricata solo quando serve.
const Dashboard = lazy(() => import('./pages/Dashboard.tsx'))

type TabId = 'appuntamenti' | 'registra' | 'dashboard' | 'campagne' | 'impostazioni'

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'appuntamenti', label: 'Appuntamenti', icon: <CalendarDays size={17} /> },
  { id: 'registra', label: 'Registra', icon: <ClipboardPlus size={17} /> },
  { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={17} /> },
  { id: 'campagne', label: 'Campagne', icon: <Megaphone size={17} /> },
  { id: 'impostazioni', label: 'Impostazioni', icon: <Settings size={17} /> },
]

const tabFromHash = (): TabId => {
  const h = window.location.hash.replace('#', '') as TabId
  return TABS.some((t) => t.id === h) ? h : 'appuntamenti'
}

export default function App() {
  const [auth, setAuth] = useState<{ user: SessionUser | null; hasUsers: boolean; studio?: StudioBrand } | null>(null)

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth((a) => (a ? { ...a, user: null } : a)))
    api
      .me()
      .then((m) => setAuth({ user: m.user, hasUsers: m.hasUsers, studio: m.studio }))
      .catch(() => setAuth({ user: null, hasUsers: true }))
  }, [])

  if (!auth) return <FullLoader />
  if (!auth.user) return <Login hasUsers={auth.hasUsers} studio={auth.studio} onLogin={(user) => setAuth({ ...auth, user })} />
  return (
    <ToastProvider>
      <Shell
        user={auth.user}
        // All'uscita la pagina di accesso mostra nome e logo aggiornati (possono essere cambiati nel frattempo).
        onLogout={() => {
          setAuth({ ...auth, user: null })
          api.me().then((m) => setAuth({ user: null, hasUsers: m.hasUsers, studio: m.studio })).catch(() => {})
        }}
      />
    </ToastProvider>
  )
}

function FullLoader() {
  return (
    <div className="login">
      <Loader2 className="spin" size={28} />
    </div>
  )
}

function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const data = useAppData()
  // Logo caricato dallo studio: se è quello scelto, compare anche nell'intestazione dell'app.
  const headerLogo = useCustomLogo(data.settings.logoType === 'custom' ? data.settings.logoVersion : 0)

  useEffect(() => {
    document.title = `${data.settings.studioName} · Prestazioni e campagne`
  }, [data.settings.studioName])

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id: TabId) => {
    window.location.hash = id
    setTab(id)
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            {headerLogo ? (
              <img className="brand-logo-img" src={headerLogo} alt="" />
            ) : (
              <span className="brand-logo">
                <Tooth size={20} />
              </span>
            )}
            <span className="brand-name">{data.settings.studioName}</span>
          </div>
          <nav className="tabs" role="tablist" aria-label="Sezioni">
            {TABS.map((t) => (
              <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
                {t.icon}
                <span className="tab-label">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {data.loading ? (
          <div className="empty">
            <Loader2 size={24} /> Caricamento…
          </div>
        ) : data.error ? (
          <div className="alert alert-danger">Impossibile contattare il server: {data.error}</div>
        ) : (
          <>
            {tab === 'appuntamenti' && <Appuntamenti data={data} />}
            {tab === 'registra' && <Registra data={data} />}
            {tab === 'dashboard' && (
              <Suspense fallback={<div className="empty">Caricamento…</div>}>
                <Dashboard data={data} onGoRegistra={() => go('registra')} />
              </Suspense>
            )}
            {tab === 'campagne' && <Campagne data={data} />}
            {tab === 'impostazioni' && <Impostazioni data={data} user={user} onLogout={onLogout} />}
          </>
        )}
      </main>
    </>
  )
}
