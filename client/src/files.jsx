import React, { useEffect, useRef, useState } from 'react'
import {
  archiveUrl, downloadRemote, downloadUrl, listFiles, mkdirRemote, removeRemote, renameRemote,
  saveBlob, uploadFile,
} from './api.js'
import {
  Button, ConfirmDialog, EmptyState, IconArrowUp, IconButton, IconClose, IconDownload, IconEdit, IconFile,
  IconFolder, IconFolderPlus, IconRefresh, IconTrash, IconUpload, PromptDialog, TextInput,
} from './ui.jsx'
import { t, useLocale } from './i18n.js'

function joinRemote(directory, name) {
  const base = String(directory || '/').replace(/\/+$/, '')
  return `${base}/${name}`.replace(/\/{2,}/g, '/')
}

function parentRemote(path) {
  const normalized = String(path || '/').replace(/\/+$/, '')
  const at = normalized.lastIndexOf('/')
  if (at <= 0) return '/'
  return normalized.slice(0, at)
}

function formatSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function formatDate(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString()
  } catch {
    return ''
  }
}

function TransferBar({ transfer, onCancel }) {
  if (!transfer) return null
  const percent = transfer.total && transfer.total > 0
    ? Math.min(100, (transfer.loaded / transfer.total) * 100)
    : null
  const label = transfer.kind === 'upload' ? t('Uploading', '正在上传') : t('Downloading', '正在下载')
  return (
    <div className="dsh-ssh-transfer" role="status">
      <div className="dsh-ssh-transfer-head">
        <span className="dsh-ssh-transfer-name" title={transfer.name}>{label} · {transfer.name}</span>
        <span className="dsh-ssh-transfer-meta">
          {percent === null ? formatSize(transfer.loaded) : `${Math.round(percent)}%`}
        </span>
        <button type="button" className="dsh-ssh-transfer-cancel" aria-label={t('Cancel', '取消')} onClick={onCancel}>
          <IconClose />
        </button>
      </div>
      <div className={`dsh-ssh-progress${percent === null ? ' is-indeterminate' : ''}`}>
        <div className="dsh-ssh-progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function FilesView({ connection, active, onError, compact = false }) {
  useLocale()
  const [path, setPath] = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [dialog, setDialog] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [transfer, setTransfer] = useState(null)
  const inputRef = useRef(null)
  const requestRef = useRef(0)
  const loadedForRef = useRef('')
  const transferAbort = useRef(null)
  const transferTimer = useRef(null)

  const load = async (target) => {
    if (!connection) return
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const data = await listFiles(connection.id, target)
      if (requestId !== requestRef.current) return
      setListing(data)
      setPath(data.path)
      setPathDraft(data.path)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(cause.message)
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!connection) {
      loadedForRef.current = ''
      setListing(null)
      setPath('')
      setPathDraft('')
      return
    }
    if (!active) return
    if (loadedForRef.current === connection.id) return
    loadedForRef.current = connection.id
    setListing(null)
    setPath('')
    setPathDraft('')
    load(connection.defaultDir || '')
  }, [active, connection?.id])

  const run = async (label, operation, reload = true) => {
    setBusy(label)
    try {
      await operation()
      if (reload) await load(path)
    } catch (cause) {
      onError?.(cause.message)
    } finally {
      setBusy('')
    }
  }

  useEffect(() => () => {
    transferAbort.current?.abort()
    if (transferTimer.current !== null) clearTimeout(transferTimer.current)
  }, [])

  const beginTransfer = () => {
    transferAbort.current?.abort()
    const controller = new AbortController()
    transferAbort.current = controller
    return controller.signal
  }

  const finishTransfer = (delay = 0) => {
    if (transferTimer.current !== null) clearTimeout(transferTimer.current)
    if (delay > 0) {
      transferTimer.current = setTimeout(() => {
        transferTimer.current = null
        setTransfer(null)
      }, delay)
    } else {
      setTransfer(null)
    }
  }

  const cancelTransfer = () => {
    transferAbort.current?.abort()
    transferAbort.current = null
    if (transferTimer.current !== null) clearTimeout(transferTimer.current)
    transferTimer.current = null
    setTransfer(null)
    setBusy('')
  }

  const upload = async (files) => {
    const list = Array.from(files ?? [])
    if (list.length === 0 || !connection) return
    const signal = beginTransfer()
    try {
      for (let index = 0; index < list.length; index += 1) {
        if (signal.aborted) break
        const file = list[index]
        setBusy(t(`Uploading ${index + 1}/${list.length}: ${file.name}`, `正在上传 ${index + 1}/${list.length}：${file.name}`))
        setTransfer({ kind: 'upload', name: file.name, loaded: 0, total: file.size, percent: 0 })
        try {
          await uploadFile(connection.id, joinRemote(path || '/', file.name), file, {
            signal,
            onProgress: ({ loaded, total }) => {
              setTransfer({
                kind: 'upload',
                name: file.name,
                loaded,
                total,
                percent: total > 0 ? Math.min(100, (loaded / total) * 100) : null,
              })
            },
          })
        } catch (cause) {
          if (cause?.name === 'AbortError') break
          onError?.(`${file.name}: ${cause.message}`)
        }
      }
    } finally {
      if (!signal.aborted) {
        setTransfer((current) => current === null ? current : { ...current, percent: 100 })
        finishTransfer(450)
      } else {
        setTransfer(null)
      }
      setBusy('')
      await load(path)
    }
  }

  const download = async (entry) => {
    if (!connection) return
    const isDirectory = entry.type === 'dir'
    const name = isDirectory ? `${entry.name}.tar.gz` : entry.name
    const signal = beginTransfer()
    setTransfer({
      kind: 'download',
      name,
      loaded: 0,
      total: isDirectory ? null : entry.size,
      percent: isDirectory ? null : 0,
    })
    try {
      const { blob, filename } = await downloadRemote(
        isDirectory ? archiveUrl(connection.id, entry.path) : downloadUrl(connection.id, entry.path),
        {
          signal,
          onProgress: ({ loaded, total }) => {
            const size = total ?? (isDirectory ? null : entry.size)
            setTransfer({
              kind: 'download',
              name,
              loaded,
              total: size,
              percent: size ? Math.min(100, (loaded / size) * 100) : null,
            })
          },
        },
      )
      saveBlob(blob, filename || name)
      setTransfer((current) => current === null ? current : { ...current, percent: 100 })
      finishTransfer(650)
    } catch (cause) {
      if (cause?.name !== 'AbortError') onError?.(cause.message)
      setTransfer(null)
    }
  }

  const open = (entry) => {
    if (entry.type === 'dir') load(entry.path)
  }

  const submitPath = (event) => {
    event.preventDefault()
    const target = pathDraft.trim()
    if (target) load(target)
  }

  const entries = listing?.entries ?? []

  return (
    <div className={`dsh-ssh-files${compact ? ' is-compact' : ''}`}>
      <div className="dsh-ssh-files-toolbar">
        <IconButton label={t('Up one level', '上一级')} onClick={() => load(parentRemote(path))} disabled={!path || path === '/'}>
          <IconArrowUp />
        </IconButton>
        <form className="dsh-ssh-path-form" onSubmit={submitPath}>
          <TextInput
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            placeholder={t('Remote path', '远程路径')}
            aria-label={t('Remote path', '远程路径')}
          />
        </form>
        <IconButton label={t('Refresh', '刷新')} onClick={() => load(path)} disabled={loading}>
          <IconRefresh />
        </IconButton>
        <IconButton label={t('Upload', '上传')} onClick={() => inputRef.current?.click()} disabled={!connection || Boolean(busy)}>
          <IconUpload />
        </IconButton>
        <IconButton label={t('New folder', '新建文件夹')} onClick={() => setDialog({ type: 'mkdir' })} disabled={!connection || Boolean(busy)}>
          <IconFolderPlus />
        </IconButton>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            upload(files)
          }}
        />
      </div>

      <div
        className={`dsh-ssh-files-body${dragOver ? ' is-drag' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragOver(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragOver(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          upload(event.dataTransfer?.files)
        }}
      >
        <div className="dsh-ssh-files-head">
          <span>{t('Name', '名称')}</span>
          <span>{t('Size', '大小')}</span>
          {compact ? null : <span>{t('Modified', '修改时间')}</span>}
          <span />
        </div>
        <div className="dsh-ssh-files-list">
          {loading ? <div className="dsh-ssh-files-loading"><span className="dsh-ssh-spinner" />{t('Loading…', '加载中…')}</div> : null}
          {!loading && error ? (
            <EmptyState
              title={t('Cannot list this directory', '无法列出该目录')}
              description={error}
              action={<Button onClick={() => load(path)}>{t('Retry', '重试')}</Button>}
            />
          ) : null}
          {!loading && !error && entries.length === 0 ? (
            <EmptyState icon={<IconFolder />} title={t('This directory is empty', '此目录为空')} description={t('Drop files here to upload.', '可将文件拖到这里上传。')} />
          ) : null}
          {!loading && !error ? entries.map((entry) => (
            <div
              key={entry.path}
              className={`dsh-ssh-file-row${entry.type === 'dir' ? ' is-dir' : ''}`}
              onDoubleClick={() => open(entry)}
              title={entry.path}
            >
              <span className="dsh-ssh-file-name">
                {entry.type === 'dir' ? <IconFolder /> : <IconFile />}
                <button type="button" className="dsh-ssh-file-link" onClick={() => open(entry)}>{entry.name}</button>
              </span>
              <span className="dsh-ssh-file-size">{entry.type === 'dir' ? '—' : formatSize(entry.size)}</span>
              {compact ? null : <span className="dsh-ssh-file-date">{formatDate(entry.mtime)}</span>}
              <span className="dsh-ssh-file-actions">
                <IconButton
                  label={entry.type === 'dir' ? t('Download folder as archive', '打包下载文件夹') : t('Download', '下载')}
                  onClick={() => download(entry)}
                ><IconDownload /></IconButton>
                <IconButton label={t('Rename', '重命名')} onClick={() => setDialog({ type: 'rename', entry })}>
                  <IconEdit />
                </IconButton>
                <IconButton label={t('Delete', '删除')} onClick={() => setDialog({ type: 'remove', entry })}><IconTrash /></IconButton>
              </span>
            </div>
          )) : null}
        </div>
        {dragOver ? <div className="dsh-ssh-drop-hint">{t('Drop files to upload', '松开以上传文件')}</div> : null}
      </div>

      <TransferBar transfer={transfer} onCancel={cancelTransfer} />

      <div className="dsh-ssh-files-foot">
        <span>{listing ? t(`${entries.length} item(s)`, `${entries.length} 项`) : ''}</span>
        <span className="dsh-ssh-files-foot-path" title={path}>{path}</span>
        {busy ? <span className="dsh-ssh-files-busy"><span className="dsh-ssh-spinner" />{busy}</span> : null}
      </div>

      {dialog?.type === 'mkdir' ? (
        <PromptDialog
          title={t('New folder', '新建文件夹')}
          label={t('Folder name', '文件夹名称')}
          placeholder="assets"
          confirmLabel={t('Create', '创建')}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null)
            run(t('Creating folder…', '正在创建…'), () => mkdirRemote(connection.id, joinRemote(path, name)))
          }}
        />
      ) : null}
      {dialog?.type === 'rename' ? (
        <PromptDialog
          title={t('Rename', '重命名')}
          label={t('New name', '新名称')}
          initial={dialog.entry.name}
          confirmLabel={t('Rename', '重命名')}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null)
            run(t('Renaming…', '正在重命名…'), () => renameRemote(connection.id, dialog.entry.path, joinRemote(path, name)))
          }}
        />
      ) : null}
      {dialog?.type === 'remove' ? (
        <ConfirmDialog
          title={t('Delete', '删除')}
          message={t(`Delete "${dialog.entry.name}"? This cannot be undone.`, `确定删除“${dialog.entry.name}”吗？此操作不可撤销。`)}
          danger
          confirmLabel={t('Delete', '删除')}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const entry = dialog.entry
            setDialog(null)
            run(t('Deleting…', '正在删除…'), () => removeRemote(connection.id, entry.path))
          }}
        />
      ) : null}
    </div>
  )
}
