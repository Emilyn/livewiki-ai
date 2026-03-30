import { useState, useCallback, useEffect } from 'react'
import FilePanel from './components/FilePanel'
import MDFViewer from './components/MDFViewer'
import Toast from './components/Toast'
import AuthPage from './components/AuthPage'
import { authMe } from './api'

const TABS = [
  {
    id: 'local',
    label: 'Local Files',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    ),
  },
  {
    id: 'viewer',
    label: 'Viewer',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
]

export default function App() {
  const [tab, setTab] = useState('local')
  const [selectedFile, setSelectedFile] = useState(null)
  const [toasts, setToasts] = useState([])
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  const addToast = useCallback((msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  useEffect(() => {
    // Handle Google SSO redirect: ?auth_token=<token>
    const params = new URLSearchParams(window.location.search)
    const ssoToken = params.get('auth_token')
    if (ssoToken) {
      localStorage.setItem('mdf_token', ssoToken)
      window.history.replaceState({}, '', '/')
    }
    // Validate token
    if (localStorage.getItem('mdf_token')) {
      authMe()
        .then(u => { setUser(u); setAuthChecked(true) })
        .catch(() => {
          localStorage.removeItem('mdf_token')
          setAuthChecked(true)
        })
    } else {
      setAuthChecked(true)
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('mdf_token')
    setUser(null)
    setSelectedFile(null)
    setTab('local')
  }

  const handleSelect = file => {
    setSelectedFile(file)
    setTab('viewer')
  }

  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    return <AuthPage onAuth={u => { setUser(u); setAuthChecked(true) }} />
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-icon">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M9 17H7A5 5 0 0 1 7 7h2"/>
            <path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <div>
          <h1>MDF Viewer</h1>
          <p>Upload and explore MDF4 measurement data files</p>
        </div>

        <nav className="tab-bar">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
              {t.id === 'viewer' && selectedFile && (
                <span className="tab-file-name">{selectedFile.name}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="header-user">
          {user.avatar_url
            ? <img className="user-avatar" src={user.avatar_url} alt={user.name} referrerPolicy="no-referrer" />
            : <div className="user-avatar user-avatar-initials">{user.name?.[0]?.toUpperCase() ?? '?'}</div>
          }
          <span className="user-name">{user.name}</span>
          <button className="btn-icon" title="Sign out" onClick={handleLogout}>
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      <div className="tab-content">
        {tab === 'local' && (
          <FilePanel selectedFile={selectedFile} onSelect={handleSelect} onToast={addToast} />
        )}
        {tab === 'viewer' && (
          <MDFViewer file={selectedFile} onToast={addToast} />
        )}
      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
