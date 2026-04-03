import { useState, useCallback, useEffect } from 'react'
import FilePanel from './components/FilePanel'
import MDFViewer from './components/MDFViewer'
import Toast from './components/Toast'
import AuthPage from './components/AuthPage'
import SettingsPage from './components/SettingsPage'
import WikiPage from './components/WikiPage'
import SharedWikiPage from './components/SharedWikiPage'
import { authMe, saveGitHubToken } from './api'

// Shared wiki route — no auth required
const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)/)
if (shareMatch) {
  // Render shared wiki immediately, bypass auth shell
  const token = shareMatch[1]
  // Defer to component tree
  window.__shareToken = token
}

// Icons
function IconFiles() {
  return <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
}
function IconViewer() {
  return <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
function IconWiki() {
  return <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
}
function IconSettings() {
  return <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
}
function IconMoon() {
  return <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
}
function IconSun() {
  return <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
}
function IconLogout() {
  return <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
}
function IconLink() {
  return <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
}

const TABS = [
  { id: 'local',    label: 'Files',    Icon: IconFiles },
  { id: 'viewer',   label: 'Viewer',   Icon: IconViewer },
  { id: 'wiki',     label: 'Wiki',     Icon: IconWiki },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
]

const PAGE_TITLES = {
  local: 'Files',
  viewer: 'Viewer',
  wiki: 'Living Wiki',
  settings: 'Settings',
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('mdf_theme')
    if (stored) return stored === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('mdf_theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, () => setDark(d => !d)]
}

export default function App() {
  // Shared wiki shortcut — no auth shell needed
  if (window.__shareToken) {
    return <SharedWikiPage token={window.__shareToken} />
  }

  const [tab, setTab] = useState('local')
  const [selectedFile, setSelectedFile] = useState(null)
  const [toasts, setToasts] = useState([])
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [dark, toggleTheme] = useTheme()

  const addToast = useCallback((msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ssoToken = params.get('auth_token')
    if (ssoToken) { localStorage.setItem('mdf_token', ssoToken); window.history.replaceState({}, '', '/') }
    const ghToken = params.get('github_token')
    if (ghToken) {
      window.history.replaceState({}, '', '/')
      if (localStorage.getItem('mdf_token')) {
        saveGitHubToken(ghToken).then(() => setTab('wiki')).catch(() => {})
      }
    }
    if (localStorage.getItem('mdf_token')) {
      authMe().then(u => { setUser(u); setAuthChecked(true) }).catch(() => { localStorage.removeItem('mdf_token'); setAuthChecked(true) })
    } else { setAuthChecked(true) }
  }, [])

  const handleLogout = () => { localStorage.removeItem('mdf_token'); setUser(null); setSelectedFile(null); setTab('local') }
  const handleSelect = file => { setSelectedFile(file); setTab('viewer') }

  if (!authChecked) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  )
  if (!user) return <AuthPage onAuth={u => { setUser(u); setAuthChecked(true) }} />

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo-wrap">
          <div className="sidebar-logo">
            <IconLink />
          </div>
          <span className="sidebar-logo-title">MDF Viewer</span>
        </div>

        <nav className="sidebar-nav">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`sidebar-item${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon />
              <span className="sidebar-label">{label}</span>
              {id === 'viewer' && selectedFile && (
                <span style={{
                  fontSize: '0.65rem', background: 'rgba(99,102,241,0.2)', color: '#818cf8',
                  borderRadius: 4, padding: '0.1rem 0.35rem', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80,
                }}>{selectedFile.name}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-item" onClick={toggleTheme} title={dark ? 'Light mode' : 'Dark mode'}>
            {dark ? <IconSun /> : <IconMoon />}
            <span className="sidebar-label">{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main-content">
        {/* Top bar */}
        <header className="topbar">
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
            <span className="topbar-title">{PAGE_TITLES[tab]}</span>
            {tab === 'viewer' && selectedFile && (
              <span className="topbar-file-badge">{selectedFile.name}</span>
            )}
          </div>
          <button className="theme-toggle" onClick={toggleTheme} title={dark ? 'Light mode' : 'Dark mode'}>
            {dark ? <IconSun /> : <IconMoon />}
          </button>
          <div className="topbar-user">
            {user.avatar_url
              ? <img className="user-avatar" src={user.avatar_url} alt={user.name} referrerPolicy="no-referrer" />
              : <div className="user-avatar user-avatar-initials">{user.name?.[0]?.toUpperCase() ?? '?'}</div>
            }
            <span className="user-name">{user.name}</span>
            <button className="btn-icon" title="Sign out" onClick={handleLogout}><IconLogout /></button>
          </div>
        </header>

        {/* Page content */}
        <main className="page-content">
          {tab === 'local'    && <FilePanel selectedFile={selectedFile} onSelect={handleSelect} onToast={addToast} />}
          {tab === 'viewer'   && <MDFViewer file={selectedFile} onToast={addToast} />}
          {tab === 'wiki'     && <WikiPage onToast={addToast} onFileCreated={handleSelect} />}
          {tab === 'settings' && <SettingsPage onToast={addToast} />}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        <div className="bottom-nav-items">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={`bottom-nav-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <Toast toasts={toasts} />
    </div>
  )
}
