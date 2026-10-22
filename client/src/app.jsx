import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  closeTerminal, connectConnection, deleteConnection, disconnectConnection, getMetrics, listConnections,
  listTerminals, openTerminal,
} from './api.js'
import { FilesView } from './files.jsx'
import { ConnectionForm } from './connection-form.jsx'
import { TerminalView } from './terminal.jsx'
import {
  Button, ConfirmDialog, EmptyState, IconButton, IconEdit, IconFolder,
  IconPlug, IconPlus, IconRefresh, IconServer, IconTerminal, IconTrash, StatusDot, Toast,
} from './ui.jsx'
import { t, useLocale } from './i18n.js'

export const TAB_ID = 'dsh-ssh-plugin/ssh-tab'
export const TAB_KIND = 'ssh'

const STORAGE_KEY = 'dsh.ssh.activeConnection'

const tabPresenceListeners = new Set()
let sshTabMounted = false

function setSshTabMounted(value) {
  sshTabMounted = value
  for (const listener of tabPresenceListeners) listener()
}

function useSshTabMounted() {
  return useSyncExternalStore(
    (listener) => {
      tabPresenceListeners.add(listener)
      return () => tabPresenceListeners.delete(listener)
    },
    () => sshTabMounted,
    () => false,
  )
}

/** Bottom-right entry point: opens or focuses the SSH tab in the right sidebar. */
export function Launcher({ mounted, open }) {
  const sessionId = useSyncExternalStore(
    (listener) => mounted.subscribe(listener),
    () => mounted.getSnapshot(),
    () => undefined,
  )
  const tabMounted = useSshTabMounted()
  useLocale()
  if (sessionId === undefined || tabMounted) return null
  return (
    <button
      type="button"
      className="dsh-ssh-launcher"
      title={t('Open SSH in the right sidebar — the chat stays beside it', '在右侧栏打开 SSH——对话窗口保持在旁边')}
      onClick={open}
    >
      <IconServer />
      <span>SSH</span>
    </button>
  )
}

/** The right-sidebar tab body: connections, terminal and SFTP beside the chat. */
export function SshTabBody({ useTabInfo }) {
  useLocale()
  const { tab } = useTabInfo()
  const pageVisible = tab.visible !== false
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })
  const [terminals, setTerminals] = useState([])
  const [activeTerminal, setActiveTerminal] = useState(null)
  const [view, setView] = useState('terminal')
  const [editor, setEditor] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [toast, setToast] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [busyConnection, setBusyConnection] = useState('')
  const restored = useRef(new Set())
  const pendingActive = useRef('')
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals

  const showError = useCallback((message) => setToast({ message, kind: 'error' }), [])

  const refresh = useCallback(async () => {
    try {
      const data = await listConnections()
      setConnections(data.connections)
      setActiveId((current) => {
        if (pendingActive.current) return pendingActive.current
        if (current && data.connections.some((row) => row.id === current)) return current
        return data.connections[0]?.id ?? ''
      })
      setLoading(false)
    } catch (cause) {
      setLoading(false)
      showError(cause.message)
    }
  }, [showError])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 10000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(STORAGE_KEY, activeId)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [activeId])

  // The launcher is only the first way in: while the sidebar tab is mounted,
  // the tab strip and the conversation header's sidebar control take over.
  // Closing the tab releases the shells it owns. A page reload does not run
  // this cleanup, so the Host terminals can be restored by the next mount.
  useEffect(() => {
    setSshTabMounted(true)
    return () => {
      setSshTabMounted(false)
      for (const terminal of terminalsRef.current) {
        closeTerminal(terminal.id).catch(() => {})
      }
    }
  }, [])

  const activeConnection = useMemo(
    () => connections.find((row) => row.id === activeId) ?? null,
    [connections, activeId],
  )

  const activeTerminals = useMemo(
    () => terminals.filter((terminal) => terminal.connectionId === activeId),
    [terminals, activeId],
  )

  useEffect(() => {
    if (!activeId) return
    if (restored.current.has(activeId)) return
    restored.current.add(activeId)
    listTerminals(activeId).then((data) => {
      // Only live shells are worth reattaching; an exited tail is history, not a tab.
      const live = (data.terminals ?? []).filter((terminal) => !terminal.exited)
      if (live.length === 0) return
      setTerminals((current) => {
        const known = new Set(current.map((terminal) => terminal.id))
        return [...current, ...live.filter((terminal) => !known.has(terminal.id))]
      })
      setActiveTerminal((current) => current ?? live[0].id)
    }).catch(() => {})
  }, [activeId])

  useEffect(() => {
    if (!activeConnection || activeConnection.status !== 'connected' || !pageVisible || view !== 'terminal') {
      setMetrics(null)
      return
    }
    let cancelled = false
    let controller = null
    let timer = null
    const tick = async () => {
      controller = new AbortController()
      try {
        const data = await getMetrics(activeConnection.id, controller.signal)
        if (!cancelled) setMetrics(data.metrics)
      } catch (error) {
        if (!cancelled && error?.name !== 'AbortError') setMetrics((current) => current ?? null)
      } finally {
        if (!cancelled) timer = setTimeout(tick, 2000)
      }
    }
    tick()
    return () => {
      cancelled = true
      controller?.abort()
      if (timer !== null) clearTimeout(timer)
    }
  }, [activeConnection?.id, activeConnection?.status, pageVisible, view])

  const selectConnection = (id) => {
    setActiveId(id)
    const first = terminals.find((terminal) => terminal.connectionId === id)
    setActiveTerminal(first?.id ?? null)
  }

  const toggleConnection = async (connection) => {
    setBusyConnection(connection.id)
    try {
      if (connection.status === 'connected') {
        await disconnectConnection(connection.id)
        setToast({ message: t(`Disconnected ${connection.name}.`, `已断开 ${connection.name}。`), kind: 'success' })
      } else {
        await connectConnection(connection.id)
        setToast({ message: t(`Connected to ${connection.name}.`, `已连接 ${connection.name}。`), kind: 'success' })
      }
      await refresh()
    } catch (cause) {
      showError(cause.message)
      await refresh()
    } finally {
      setBusyConnection('')
    }
  }

  const addTerminal = async () => {
    if (!activeConnection) return
    try {
      const count = terminals.filter((terminal) => terminal.connectionId === activeConnection.id).length + 1
      const result = await openTerminal(activeConnection.id, 100, 30, `${activeConnection.name} ${count}`)
      setTerminals((current) => [...current, result.terminal])
      setActiveTerminal(result.terminal.id)
      setView('terminal')
      refresh()
    } catch (cause) {
      showError(cause.message)
      refresh()
    }
  }

  const closeTab = async (terminal) => {
    setTerminals((current) => current.filter((row) => row.id !== terminal.id))
    setActiveTerminal((current) => {
      if (current !== terminal.id) return current
      const remaining = terminals.filter((row) => row.id !== terminal.id && row.connectionId === terminal.connectionId)
      return remaining[0]?.id ?? null
    })
    try {
      await closeTerminal(terminal.id)
    } catch {}
  }

  const reconnect = async (terminal) => {
    await closeTab(terminal)
    addTerminal()
  }

  const removeConnection = async () => {
    if (!removeTarget) return
    const target = removeTarget
    setBusyConnection(target.id)
    try {
      await deleteConnection(target.id)
      setTerminals((current) => current.filter((terminal) => terminal.connectionId !== target.id))
      restored.current.delete(target.id)
      setActiveTerminal(null)
      setRemoveTarget(null)
      setToast({ message: t(`Removed ${target.name}.`, `已删除 ${target.name}。`), kind: 'success' })
      await refresh()
    } catch (cause) {
      showError(cause.message)
    } finally {
      setBusyConnection('')
    }
  }

  const onSaved = async (connection) => {
    setEditor(null)
    pendingActive.current = connection.id
    setActiveId(connection.id)
    restored.current.delete(connection.id)
    try {
      await refresh()
    } finally {
      pendingActive.current = ''
      setActiveId(connection.id)
    }
    setToast({ message: t(`Saved ${connection.name}.`, `已保存 ${connection.name}。`), kind: 'success' })
  }

  const statusLabel = (status) => {
    if (status === 'connected') return t('Connected', '已连接')
    if (status === 'connecting') return t('Connecting…', '连接中…')
    if (status === 'error') return t('Error', '错误')
    return t('Disconnected', '未连接')
  }

  const activeTerminalRow = terminals.find((terminal) => terminal.id === activeTerminal) ?? null

  return (
    <div className="dsh-ssh-sidebar">
      <div className="dsh-ssh-sidebar-bar">
        <span className="dsh-ssh-sidebar-brand" aria-hidden="true"><IconServer /></span>
        {connections.length > 0 ? (
          <select
            className="dsh-ssh-input dsh-ssh-conn-select"
            aria-label={t('SSH connection', 'SSH 连接')}
            value={activeId}
            onChange={(event) => selectConnection(event.target.value)}
          >
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name} — {connection.username}@{connection.host}
              </option>
            ))}
          </select>
        ) : (
          <span className="dsh-ssh-sidebar-brand-title">SSH</span>
        )}
        <IconButton label={t('New connection', '新建连接')} onClick={() => setEditor({ connection: null })}>
          <IconPlus />
        </IconButton>
        <IconButton label={t('Refresh', '刷新')} onClick={refresh}><IconRefresh /></IconButton>
        {activeConnection ? (
          <>
            <IconButton label={t('Edit connection', '编辑连接')} onClick={() => setEditor({ connection: activeConnection })}>
              <IconEdit />
            </IconButton>
            <IconButton label={t('Remove connection', '删除连接')} onClick={() => setRemoveTarget(activeConnection)}>
              <IconTrash />
            </IconButton>
          </>
        ) : null}
      </div>

      {activeConnection ? (
        <>
          <div className="dsh-ssh-sidebar-meta">
            <StatusDot status={activeConnection.status} />
            <span className="dsh-ssh-sidebar-addr" title={activeConnection.error || ''}>
              {activeConnection.username}@{activeConnection.host}:{activeConnection.port}
            </span>
            <span className={`dsh-ssh-pill is-${activeConnection.status}`}>{statusLabel(activeConnection.status)}</span>
            <span className="dsh-ssh-spacer" />
            <Button
              size="sm"
              variant={activeConnection.status === 'connected' ? 'secondary' : 'primary'}
              busy={busyConnection === activeConnection.id}
              onClick={() => toggleConnection(activeConnection)}
            >
              {activeConnection.status === 'connected' ? t('Disconnect', '断开') : t('Connect', '连接')}
            </Button>
            <Button size="sm" onClick={addTerminal}><IconPlus />{t('Terminal', '终端')}</Button>
            <Button
              size="sm"
              className={view === 'files' ? 'is-active' : ''}
              onClick={() => setView('files')}
            ><IconFolder />{t('Files', '文件')}</Button>
          </div>

          <div className="dsh-ssh-tabs dsh-ssh-sidebar-tabs">
            {activeTerminals.map((terminal) => (
              <div
                key={terminal.id}
                className={`dsh-ssh-tab${view === 'terminal' && terminal.id === activeTerminal ? ' is-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => { setActiveTerminal(terminal.id); setView('terminal') }}
                onKeyDown={(event) => { if (event.key === 'Enter') { setActiveTerminal(terminal.id); setView('terminal') } }}
              >
                <IconTerminal />
                <span>{terminal.name}</span>
                <button
                  type="button"
                  className="dsh-ssh-tab-close"
                  aria-label={t('Close terminal', '关闭终端')}
                  onClick={(event) => { event.stopPropagation(); closeTab(terminal) }}
                ><span aria-hidden="true">×</span></button>
              </div>
            ))}
            <button type="button" className="dsh-ssh-tab-add" aria-label={t('New terminal', '新建终端')} onClick={addTerminal}><IconPlus /></button>
          </div>

          <div className="dsh-ssh-stage">
            {activeTerminals.map((terminal) => (
              <div
                key={terminal.id}
                className="dsh-ssh-term-pane"
                style={view === 'terminal' && terminal.id === activeTerminal ? undefined : { display: 'none' }}
              >
                <TerminalView
                  session={terminal}
                  active={view === 'terminal' && terminal.id === activeTerminal && pageVisible}
                  onReconnect={reconnect}
                  connectionStatus={activeConnection.status}
                  metrics={metrics}
                />
              </div>
            ))}
            {view === 'terminal' && !activeTerminalRow ? (
              <EmptyState
                icon={<IconTerminal />}
                title={t('No terminal open', '尚未打开终端')}
                description={t('Open an interactive shell here while you keep chatting beside it.', '在这里打开交互式 Shell，对话窗口会一直显示在旁边。')}
                action={<Button variant="primary" onClick={addTerminal}><IconPlus />{t('Open terminal', '打开终端')}</Button>}
              />
            ) : null}
            <div className="dsh-ssh-files-pane" style={view === 'files' ? undefined : { display: 'none' }}>
              <FilesView connection={activeConnection} active={view === 'files' && pageVisible} onError={showError} compact />
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<IconServer />}
          title={loading ? t('Loading connections…', '正在加载连接…') : t('Choose a server', '选择一个服务器')}
          description={t('Add an SSH connection to run commands, open a terminal and transfer files — the agent chat stays beside this panel.', '添加 SSH 连接后即可执行命令、打开终端并传输文件；Agent 对话始终在本面板旁边。')}
          action={<Button variant="primary" onClick={() => setEditor({ connection: null })}><IconPlus />{t('New connection', '新建连接')}</Button>}
        />
      )}

      {editor ? (
        <ConnectionForm
          connection={editor.connection}
          onClose={() => setEditor(null)}
          onSaved={onSaved}
          onError={showError}
        />
      ) : null}

      {removeTarget ? (
        <ConfirmDialog
          title={t('Remove connection', '删除连接')}
          message={t(`Remove "${removeTarget.name}"? Saved credentials for it are deleted.`, `确定删除“${removeTarget.name}”吗？已保存的凭据会一并删除。`)}
          danger
          busy={busyConnection === removeTarget.id}
          confirmLabel={t('Remove', '删除')}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={removeConnection}
        />
      ) : null}

      <Toast message={toast?.message} kind={toast?.kind} onClose={() => setToast(null)} />
    </div>
  )
}

/** Guide artwork for the right-sidebar add page. */
export function SshGuideIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="7.5" r="1" fill="currentColor" />
      <path d="M7 17l2 1.5L7 20M11 20h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
