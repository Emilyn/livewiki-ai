import { useState, useCallback, useEffect } from 'react'
import FilePanel from './components/FilePanel'
import MDFViewer from './components/MDFViewer'
import Toast from './components/Toast'
import AuthPage from './components/AuthPage'
import SettingsPage from './components/SettingsPage'
import WikiPage from './components/WikiPage'
import { authMe, saveGitHubToken } from './api'

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
  {
    id: 'wiki',
    label: 'Wiki',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
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
    const params = new URLSearchParams(window.location.search)

    // Handle Google SSO redirect
    const ssoToken = params.get('auth_token')
    if (ssoToken) {
      localStorage.setItem('mdf_token', ssoToken)
      window.history.replaceState({}, '', '/')
    }

    // Handle GitHub OAuth redirect — save token server-side then switch to wiki tab
    const ghToken = params.get('github_token')
    if (ghToken) {
      window.history.replaceState({}, '', '/')
      if (localStorage.getItem('mdf_token')) {
        saveGitHubToken(ghToken)
          .then(() => setTab('wiki'))
          .catch(() => {})
      }
    }

    // Validate auth token
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
        {tab === 'wiki' && (
          <WikiPage onToast={addToast} onFileCreated={handleSelect} />
        )}
        {tab === 'settings' && (
          <SettingsPage onToast={addToast} />
        )}
      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
