import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { pollTerminal, resizeTerminal, writeTerminal } from './api.js'
import { Button, IconButton, IconRefresh, IconTrash } from './ui.jsx'
import { t, useLocale } from './i18n.js'

function formatRate(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let rate = Math.max(0, value)
  let index = 0
  while (rate >= 1024 && index < units.length - 1) {
    rate /= 1024
    index += 1
  }
  return `${rate >= 100 || index === 0 ? rate.toFixed(0) : rate.toFixed(1)} ${units[index]}`
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value)}%`
}

function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, value)
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 100 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function connectionLabel(status) {
  if (status === 'connected') return t('Connected', '已连接')
  if (status === 'connecting') return t('Connecting…', '连接中…')
  if (status === 'error') return t('Error', '错误')
  return t('Disconnected', '未连接')
}

function TerminalStats({ status, metrics }) {
  const connected = status === 'connected'
  const memory = metrics?.memory
  const network = metrics?.network
  return (
    <div
      className={`dsh-ssh-term-stats${connected ? '' : ' is-offline'}`}
      title={metrics?.error || (connected ? '' : connectionLabel(status))}
    >
      <span className={`dsh-ssh-term-conn is-${status}`}>{connectionLabel(status)}</span>
      {connected ? (
        <>
          <span className="dsh-ssh-metric" title={`${t('Download', '下行')} · ${formatBytes(network?.rxBytes)}`}>
            <span className="dsh-ssh-metric-arrow" aria-hidden="true">↓</span>{formatRate(network?.rxRate)}
          </span>
          <span className="dsh-ssh-metric" title={`${t('Upload', '上行')} · ${formatBytes(network?.txBytes)}`}>
            <span className="dsh-ssh-metric-arrow" aria-hidden="true">↑</span>{formatRate(network?.txRate)}
          </span>
          <span className="dsh-ssh-metric" title={t('CPU usage', 'CPU 占用')}>{t('CPU', 'CPU')} {formatPercent(metrics?.cpu)}</span>
          <span className="dsh-ssh-metric" title={`${t('Memory usage', '内存占用')} · ${formatBytes(memory?.used)} / ${formatBytes(memory?.total)}`}>
            {t('MEM', '内存')} {formatPercent(memory?.percent)}
          </span>
        </>
      ) : null}
      <span className="dsh-ssh-term-stats-spacer" />
    </div>
  )
}

function readTheme(element) {
  const style = getComputedStyle(element ?? document.body)
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback
  return {
    background: pick('--dsw-alias-bg-layer-1', '#101418'),
    foreground: pick('--dsw-alias-label-primary', '#e6e6e6'),
    cursor: pick('--dsw-alias-brand-primary', '#4c9aff'),
    cursorAccent: pick('--dsw-alias-bg-layer-1', '#101418'),
    selectionBackground: pick('--dsw-alias-bg-multi-select', 'rgba(76, 154, 255, 0.3)'),
    black: '#1c2128',
    red: '#f47067',
    green: '#7ee787',
    yellow: '#e3b341',
    blue: '#6cb6ff',
    magenta: '#d2a8ff',
    cyan: '#76e3ea',
    white: '#d0d7de',
  }
}

export function TerminalView({ session, active, onExit, onReconnect, connectionStatus, metrics }) {
  useLocale()
  const containerRef = useRef(null)
  const terminalRef = useRef(null)
  const fitRef = useRef(null)
  const cursorRef = useRef(0)
  const queueRef = useRef([])
  const flushTimerRef = useRef(null)
  const resizeTimerRef = useRef(null)
  const [status, setStatus] = useState({ exited: false, code: null, reason: '' })
  const [error, setError] = useState('')
  const [size, setSize] = useState({ cols: session.cols ?? 100, rows: session.rows ?? 30 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const terminal = new Terminal({
      theme: readTheme(element),
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      convertEol: false,
      allowTransparency: true,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    terminalRef.current = terminal
    fitRef.current = fit

    const safeFit = () => {
      if (!containerRef.current) return
      if (containerRef.current.clientWidth < 40 || containerRef.current.clientHeight < 20) return
      try {
        fit.fit()
      } catch {}
    }
    safeFit()

    const observer = new ResizeObserver(() => {
      if (!activeRef.current) return
      safeFit()
    })
    observer.observe(element)

    const offData = terminal.onData((data) => {
      queueRef.current.push(data)
      if (flushTimerRef.current !== null) return
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null
        const payload = queueRef.current.join('')
        queueRef.current = []
        if (!payload) return
        writeTerminal(session.id, payload).catch((cause) => setError(cause.message))
      }, 16)
    })

    const offResize = terminal.onResize(({ cols, rows }) => {
      setSize({ cols, rows })
      if (!activeRef.current) return
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null
        resizeTerminal(session.id, cols, rows).catch(() => {})
      }, 120)
    })

    return () => {
      observer.disconnect()
      offData.dispose()
      offResize.dispose()
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
      if (resizeTimerRef.current !== null) clearTimeout(resizeTimerRef.current)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [session.id])

  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
    if (!active) return
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit()
      } catch {}
    }, 60)
    return () => clearTimeout(timer)
  }, [active])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let controller
    setError('')

    const loop = async () => {
      while (!cancelled) {
        controller = new AbortController()
        try {
          const frame = await pollTerminal(session.id, cursorRef.current, 8000, controller.signal)
          if (cancelled) return
          const terminal = terminalRef.current
          if (!terminal) return
          if (frame.reset) {
            terminal.reset()
          }
          if (frame.data) terminal.write(frame.data)
          cursorRef.current = frame.cursor
          if (frame.exited) {
            setStatus({ exited: true, code: frame.exitCode, reason: frame.reason || '' })
            onExit?.(session.id, frame)
            return
          }
        } catch (cause) {
          if (cancelled) return
          const message = cause instanceof Error ? cause.message : String(cause)
          if (/no longer exists|has exited|cancelled/i.test(message)) {
            setStatus((current) => ({ ...current, exited: true, reason: message }))
            onExit?.(session.id, { exited: true, reason: message, exitCode: null })
            return
          }
          setError(message)
          await new Promise((resolve) => setTimeout(resolve, 1200))
        }
      }
    }
    loop()
    return () => {
      cancelled = true
      controller?.abort()
    }
  }, [active, session.id])

  const linkStatus = connectionStatus ?? 'connected'
  return (
    <div className="dsh-ssh-term">
      <TerminalStats status={linkStatus} metrics={metrics} />
      <div className="dsh-ssh-term-surface">
        <div ref={containerRef} className="dsh-ssh-term-host" />
        {status.exited ? (
          <div className="dsh-ssh-term-ended">
            <div className="dsh-ssh-term-ended-card">
              <div className="dsh-ssh-term-ended-title">{t('Remote shell exited', '远程终端已退出')}</div>
              <div className="dsh-ssh-term-ended-desc">
                {status.reason || (status.code === null ? t('The connection closed.', '连接已关闭。') : t(`Exit code ${status.code}`, `退出码 ${status.code}`))}
              </div>
              <Button variant="primary" onClick={() => onReconnect?.(session)}>{t('Open a new terminal', '新建终端')}</Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="dsh-ssh-term-foot">
        <span className={`dsh-ssh-term-state${status.exited ? ' is-ended' : linkStatus !== 'connected' ? ' is-offline' : ''}`}>
          {status.exited ? t('Exited', '已退出') : connectionLabel(linkStatus)}
        </span>
        <span className="dsh-ssh-term-meta">{size.cols}×{size.rows}</span>
        {error ? <span className="dsh-ssh-term-error" title={error}>{error}</span> : <span className="dsh-ssh-term-meta">{t('SSH PTY', 'SSH 伪终端')}</span>}
        <span className="dsh-ssh-term-spacer" />
        <IconButton label={t('Clear screen', '清屏')} onClick={() => terminalRef.current?.clear()}><IconTrash /></IconButton>
        <IconButton
          label={t('Refit terminal', '重新适配尺寸')}
          onClick={() => {
            try {
              fitRef.current?.fit()
            } catch {}
          }}
        ><IconRefresh /></IconButton>
      </div>
    </div>
  )
}
