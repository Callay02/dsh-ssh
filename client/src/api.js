async function handle(response) {
  const type = response.headers.get('content-type') ?? ''
  let body
  if (type.includes('application/json')) {
    body = await response.json()
  } else {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status}`)
  }
  return body
}

export function apiGet(path) {
  return fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' }).then(handle)
}

export function apiPost(payload) {
  return fetch('/api/ssh', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  }).then(handle)
}

export const listConnections = () => apiGet('/api/ssh?op=list')
export const saveConnection = (connection) => apiPost({ op: 'save', connection })
export const deleteConnection = (id) => apiPost({ op: 'delete', id })
export const connectConnection = (id) => apiPost({ op: 'connect', id })
export const disconnectConnection = (id) => apiPost({ op: 'disconnect', id })
export const testConnection = (connection) => apiPost({ op: 'test', connection })
export const openTerminal = (id, cols, rows, name) => apiPost({ op: 'terminal.open', id, cols, rows, name })
export const closeTerminal = (terminalId) => apiPost({ op: 'terminal.close', terminalId })
export const writeTerminal = (terminalId, data) => apiPost({ op: 'terminal.input', terminalId, data })
export const resizeTerminal = (terminalId, cols, rows) => apiPost({ op: 'terminal.resize', terminalId, cols, rows })
export const listTerminals = (id) => apiPost({ op: 'terminal.list', id })

export function pollTerminal(terminalId, cursor, wait, signal) {
  const params = new URLSearchParams({ op: 'poll', terminal: terminalId, cursor: String(cursor), wait: String(wait) })
  return fetch(`/api/ssh/terminal?${params}`, { signal, cache: 'no-store' }).then(handle)
}

export function getMetrics(connection, signal) {
  const params = new URLSearchParams({ connection })
  return fetch(`/api/ssh/metrics?${params}`, { signal, cache: 'no-store' }).then(handle)
}

export function listFiles(connection, path, signal) {
  const params = new URLSearchParams({ connection, path: path ?? '' })
  return fetch(`/api/ssh/files?${params}`, { signal, cache: 'no-store' }).then(handle)
}

export const mkdirRemote = (id, path) => apiPost({ op: 'mkdir', id, path })
export const removeRemote = (id, path) => apiPost({ op: 'remove', id, path })
export const renameRemote = (id, path, to) => apiPost({ op: 'rename', id, path, to })

export function downloadUrl(connection, path) {
  const params = new URLSearchParams({ connection, path })
  return `/api/ssh/download?${params}`
}

export function uploadUrl(connection, path) {
  const params = new URLSearchParams({ connection, path })
  return `/api/ssh/upload?${params}`
}

export function archiveUrl(connection, path) {
  const params = new URLSearchParams({ connection, path })
  return `/api/ssh/archive?${params}`
}

function abortError() {
  const error = new Error('Transfer cancelled.')
  error.name = 'AbortError'
  return error
}

function filenameFromDisposition(value) {
  if (!value) return ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {}
  }
  const plain = /filename="?([^";]+)"?/i.exec(value)
  return plain ? plain[1] : ''
}

/** Upload one file with XHR so the browser reports byte-level progress. */
export function uploadFile(connection, path, file, options = {}) {
  const { onProgress, signal } = options
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', uploadUrl(connection, path))
    xhr.responseType = 'json'
    xhr.withCredentials = true
    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.upload.onprogress = (event) => {
      onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : file.size,
      })
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort)
      const body = xhr.response
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok !== false) resolve(body)
      else reject(new Error(body?.error || `Upload failed with HTTP ${xhr.status}`))
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('Upload failed: network error.'))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    xhr.send(file)
  })
}

/** Download a response into a Blob, reporting progress and the server filename. */
export function downloadRemote(url, options = {}) {
  const { onProgress, signal } = options
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.responseType = 'blob'
    xhr.withCredentials = true
    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.onprogress = (event) => {
      onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
      })
    }
    xhr.onload = async () => {
      signal?.removeEventListener('abort', onAbort)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          blob: xhr.response,
          filename: filenameFromDisposition(xhr.getResponseHeader('content-disposition')),
        })
        return
      }
      let message = `Download failed with HTTP ${xhr.status}`
      try {
        const text = await xhr.response.text()
        const body = JSON.parse(text)
        if (body?.error) message = body.error
      } catch {}
      reject(new Error(message))
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('Download failed: network error.'))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    xhr.send()
  })
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'download'
  anchor.rel = 'noopener'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
