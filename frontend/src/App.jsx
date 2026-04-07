import { useState, useCallback, useEffect } from 'react'
import FilePanel from './components/FilePanel'
import MDFViewer from './components/MDFViewer'
import Toast from './components/Toast'
import AuthPage from './components/AuthPage'
import SettingsPage from './components/SettingsPage'
import WikiPage from './components/WikiPage'
import SharedWikiPage from './components/SharedWikiPage'
import OrgPage from './components/OrgPage'
import SuperAdminPage from './components/SuperAdminPage'
import InviteAcceptPage from './components/InviteAcceptPage'
import { authMe, saveGitHubToken, saveGitLabToken } from './api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// Special routes — bypass auth shell
const shareMatch  = window.location.pathname.match(/^\/share\/([^/]+)/)
const inviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)/)
if (shareMatch)  window.__shareToken  = shareMatch[1]
if (inviteMatch) window.__inviteToken = inviteMatch[1]

// Icons
function IconFiles() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
}
function IconViewer() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
function IconWiki() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
}
function IconSettings() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
}
function IconOrg() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
}
function IconShield() {
  return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
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
function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <rect x="2" y="2" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" opacity="0.9"/>
      <line x1="4.5" y1="7"   x2="11" y2="7"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4.5" y1="10"  x2="11" y2="10"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4.5" y1="13"  x2="8.5" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M17 2 L14 9.5 L17 9.5 L14 19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

const BASE_TABS = [
  { id: 'local',    label: 'Files',         Icon: IconFiles },
  { id: 'viewer',   label: 'Viewer',        Icon: IconViewer },
  { id: 'wiki',     label: 'Wiki',          Icon: IconWiki },
  { id: 'orgs',     label: 'Organizations', Icon: IconOrg },
  { id: 'settings', label: 'Settings',      Icon: IconSettings },
]

const PAGE_TITLES = {
  local:     'Files',
  viewer:    'Viewer',
  wiki:      'Living Wiki',
  orgs:      'Organizations',
  settings:  'Settings',
  superadmin:'Super Admin',
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
  // Special routes — no auth shell needed
  if (window.__shareToken)  return <SharedWikiPage token={window.__shareToken} />
  if (window.__inviteToken) return <InviteAcceptPage token={window.__inviteToken} />

  const [tab, setTab] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('tab') || 'local'
  })
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
    async function init() {
      const params = new URLSearchParams(window.location.search)

      const authCode = params.get('auth_code')
      if (authCode) {
        window.history.replaceState({}, '', '/')
        try {
          const res = await fetch(`/api/auth/exchange?code=${encodeURIComponent(authCode)}`)
          const data = await res.json()
          if (data.token) localStorage.setItem('mdf_token', data.token)
        } catch {}
      }

      const ghCode = params.get('github_code')
      if (ghCode) {
        window.history.replaceState({}, '', '/')
        if (localStorage.getItem('mdf_token')) {
          try {
            const res = await fetch(`/api/github/exchange?code=${encodeURIComponent(ghCode)}`)
            const data = await res.json()
            if (data.token) await saveGitHubToken(data.token).then(() => setTab('wiki')).catch(() => {})
          } catch {}
        }
      }

      const glCode = params.get('gitlab_code')
      if (glCode) {
        window.history.replaceState({}, '', '/')
        if (localStorage.getItem('mdf_token')) {
          try {
            const res = await fetch(`/api/gitlab/exchange?code=${encodeURIComponent(glCode)}`)
            const data = await res.json()
            if (data.token) await saveGitLabToken(data.token).then(() => setTab('wiki')).catch(() => {})
          } catch {}
        }
      }

      if (localStorage.getItem('mdf_token')) {
        authMe().then(u => { setUser(u); setAuthChecked(true) }).catch(() => { localStorage.removeItem('mdf_token'); setAuthChecked(true) })
      } else { setAuthChecked(true) }
    }
    init()
  }, [])

  const handleLogout = () => { localStorage.removeItem('mdf_token'); setUser(null); setSelectedFile(null); setTab('local') }
  const handleSelect = file => { setSelectedFile(file); setTab('viewer') }

  const TABS = user?.is_super_admin
    ? [...BASE_TABS, { id: 'superadmin', label: 'Super Admin', Icon: IconShield }]
    : BASE_TABS

  if (!authChecked) return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-primary" />
    </div>
  )
  if (!user) return <AuthPage onAuth={u => { setUser(u); setAuthChecked(true) }} />

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — hidden on mobile */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-sidebar">
        {/* Logo */}
        <div className="flex items-center gap-2.5 h-14 px-4 border-b border-sidebar-border shrink-0">
          <span className="text-sidebar-primary"><LogoMark /></span>
          <span className="font-semibold text-sm text-sidebar-foreground">LiveWiki</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5 p-2 pt-3 overflow-y-auto">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left',
                tab === id
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon />
              <span className="flex-1">{label}</span>
              {id === 'viewer' && selectedFile && (
                <span className="text-[10px] bg-sky-400/20 text-sky-300 rounded px-1.5 py-0.5 max-w-[80px] truncate">
                  {selectedFile.name}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-2 border-t border-sidebar-border shrink-0">
          <button
            onClick={toggleTheme}
            title={dark ? 'Light mode' : 'Dark mode'}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            {dark ? <IconSun /> : <IconMoon />}
            <span>{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center gap-3 h-14 px-4 border-b border-border bg-background shrink-0">
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm">{PAGE_TITLES[tab]}</span>
            {tab === 'viewer' && selectedFile && (
              <span className="text-xs bg-muted text-muted-foreground rounded px-2 py-0.5 max-w-[160px] truncate hidden sm:block">
                {selectedFile.name}
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={toggleTheme} title={dark ? 'Light mode' : 'Dark mode'}>
            {dark ? <IconSun /> : <IconMoon />}
          </Button>
          <div className="flex items-center gap-2">
            {user.avatar_url
              ? <img className="h-7 w-7 rounded-full object-cover" src={user.avatar_url} alt={user.name} referrerPolicy="no-referrer" />
              : <div className="h-7 w-7 rounded-full bg-sky-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {user.name?.[0]?.toUpperCase() ?? '?'}
                </div>
            }
            <span className="text-sm font-medium hidden sm:block truncate max-w-[120px]">{user.name}</span>
            <Button variant="ghost" size="icon" title="Sign out" onClick={handleLogout}>
              <IconLogout />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 md:p-6 pb-20 md:pb-6">
          {tab === 'local'      && <FilePanel selectedFile={selectedFile} onSelect={handleSelect} onToast={addToast} />}
          {tab === 'viewer'     && <MDFViewer file={selectedFile} onSelect={handleSelect} onToast={addToast} />}
          {tab === 'wiki'       && <WikiPage onToast={addToast} onFileCreated={handleSelect} />}
          {tab === 'orgs'       && <OrgPage user={user} onToast={addToast} />}
          {tab === 'settings'   && <SettingsPage onToast={addToast} />}
          {tab === 'superadmin' && user?.is_super_admin && <SuperAdminPage user={user} onToast={addToast} />}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-background md:hidden z-50">
        <div className="flex">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors',
                tab === id ? 'text-primary' : 'text-muted-foreground'
              )}
            >
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
