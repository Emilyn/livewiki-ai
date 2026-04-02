import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// Attach token from localStorage to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('mdf_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Auth ──────────────────────────────────────────────────────────────────────
export const getAuthConfig  = () => api.get('/auth/config').then(r => r.data)
export const authRegister   = (email, name, password) =>
  api.post('/auth/register', { email, name, password }).then(r => r.data)
export const authLogin      = (email, password) =>
  api.post('/auth/login', { email, password }).then(r => r.data)
export const authMe         = () => api.get('/auth/me').then(r => r.data)
export const startGoogleAuth = () => {
  window.location.href = `/api/auth/google?origin=${encodeURIComponent(window.location.origin)}`
}

// ── Local files ───────────────────────────────────────────────────────────────
export const listFiles = () => api.get('/files').then(r => r.data)

export const uploadFile = (file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/files/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data)
}

export const deleteFile      = id => api.delete(`/files/${id}`)
export const getFileInfo     = id => api.get(`/files/${id}/info`).then(r => r.data)
export const getFileContent  = id => api.get(`/files/${id}/content`).then(r => r.data)
export const saveFileContent = (id, text) =>
  api.put(`/files/${id}/content`, text, { headers: { 'Content-Type': 'text/plain' } })
export const getChannelData  = (id, group, name) =>
  api.get(`/files/${id}/channel`, { params: { group, name } }).then(r => r.data)

// ── Google Drive ──────────────────────────────────────────────────────────────
export const getDriveStatus   = () => api.get('/drive/status').then(r => r.data)
export const getDriveFolders  = () => api.get('/drive/folders').then(r => r.data)
export const setDriveFolder   = (id, name) => api.put('/drive/folder', { id, name })
export const driveDisconnect  = () => api.delete('/drive/disconnect')
export const listDriveFiles   = () => api.get('/drive/files').then(r => r.data)

export const uploadDriveFile = (file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/drive/files/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data)
}

export const deleteDriveFile      = id => api.delete(`/drive/files/${id}`)
export const getDriveFileInfo     = id => api.get(`/drive/files/${id}/info`).then(r => r.data)
export const getDriveFileContent  = id => api.get(`/drive/files/${id}/content`).then(r => r.data)
export const saveDriveFileContent = (id, text) =>
  api.put(`/drive/files/${id}/content`, text, { headers: { 'Content-Type': 'text/plain' } })
export const getDriveChannelData  = (id, group, name) =>
  api.get(`/drive/files/${id}/channel`, { params: { group, name } }).then(r => r.data)
export const startDriveAuth = () => {
  window.location.href = `/api/drive/auth?origin=${encodeURIComponent(window.location.origin)}`
}

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => api.get('/settings').then(r => r.data)
export const putSettings = (data) => api.put('/settings', data).then(r => r.data)

// ── GitHub ────────────────────────────────────────────────────────────────────
export const startGitHubAuth  = () => {
  window.location.href = `/api/github/auth?origin=${encodeURIComponent(window.location.origin)}`
}
export const saveGitHubToken  = (token) => api.put('/github/token', { access_token: token })
export const getGitHubStatus  = () => api.get('/github/status').then(r => r.data)
export const disconnectGitHub = (login) => api.delete('/github/disconnect', { params: login ? { login } : {} })
export const listGitHubRepos  = () => api.get('/github/repos').then(r => r.data)
export const getGitHubTree    = (repo, branch) =>
  api.get('/github/tree', { params: { repo, branch } }).then(r => r.data)
export const getGitHubContent = (repo, path, branch) =>
  api.get('/github/content', { params: { repo, path, branch } }).then(r => r.data)
export const generateWiki     = (body) => api.post('/wiki/generate', body).then(r => r.data)

// ── Folders ───────────────────────────────────────────────────────────────────
export const listFolders      = () => api.get('/files/folders').then(r => r.data)
export const createFolder     = (name) => api.post('/files/folders', { name }).then(r => r.data)
export const deleteFolder     = (id) => api.delete(`/files/folders/${id}`)
export const assignFileFolder = (fileId, folderId) =>
  api.put(`/files/${fileId}/folder`, { folder_id: folderId }).then(r => r.data)
