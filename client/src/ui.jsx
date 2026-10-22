import React, { useEffect, useRef } from 'react'
import { t } from './i18n.js'

export function Button({ variant = 'secondary', size = 'md', busy = false, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`dsh-ssh-btn dsh-ssh-btn-${variant} dsh-ssh-btn-${size}${busy ? ' is-busy' : ''}${props.className ? ` ${props.className}` : ''}`}
    >
      {busy ? <Spinner size={14} /> : null}
      {children}
    </button>
  )
}

export function IconButton({ label, active = false, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`dsh-ssh-icon-btn${active ? ' is-active' : ''}${props.className ? ` ${props.className}` : ''}`}
    >
      {children}
    </button>
  )
}

export function Spinner({ size = 16 }) {
  return <span className="dsh-ssh-spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

export function StatusDot({ status }) {
  const kind = status === 'connected' ? 'ok' : status === 'connecting' ? 'pending' : status === 'error' ? 'error' : 'idle'
  return <span className={`dsh-ssh-dot is-${kind}`} title={status} aria-hidden="true" />
}

export function Field({ label, hint, children }) {
  return (
    <label className="dsh-ssh-field">
      <span className="dsh-ssh-field-label">{label}</span>
      {children}
      {hint ? <span className="dsh-ssh-field-hint">{hint}</span> : null}
    </label>
  )
}

export function TextInput(props) {
  return <input {...props} className={`dsh-ssh-input${props.className ? ` ${props.className}` : ''}`} spellCheck={false} />
}

export function Select({ children, ...props }) {
  return <select {...props} className={`dsh-ssh-input dsh-ssh-select${props.className ? ` ${props.className}` : ''}`}>{children}</select>
}

export function Checkbox({ checked, onChange, label }) {
  return (
    <label className="dsh-ssh-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Modal({ title, children, footer, onClose, width = 460 }) {
  const panel = useRef(null)
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const timer = setTimeout(() => {
      const focusable = panel.current?.querySelector('input, select, textarea, button')
      focusable?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      clearTimeout(timer)
    }
  }, [onClose])
  return (
    <div className="dsh-ssh-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="dsh-ssh-modal" style={{ width }} ref={panel} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dsh-ssh-modal-head">
          <h3>{title}</h3>
          <IconButton label={t('Close', '关闭')} onClick={onClose}><IconClose /></IconButton>
        </div>
        <div className="dsh-ssh-modal-body">{children}</div>
        {footer ? <div className="dsh-ssh-modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel, danger = false, onConfirm, onCancel, busy = false }) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onCancel}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>{t('Cancel', '取消')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel ?? t('Confirm', '确定')}</Button>
        </>
      )}
    >
      <p className="dsh-ssh-modal-text">{message}</p>
    </Modal>
  )
}

export function PromptDialog({ title, label, initial = '', placeholder = '', confirmLabel, onConfirm, onCancel, busy = false }) {
  const [value, setValue] = React.useState(initial)
  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onCancel}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>{t('Cancel', '取消')}</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >{confirmLabel ?? t('Confirm', '确定')}</Button>
        </>
      )}
    >
      <Field label={label}>
        <TextInput
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && value.trim() && !busy) onConfirm(value.trim()) }}
        />
      </Field>
    </Modal>
  )
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="dsh-ssh-empty">
      {icon ? <div className="dsh-ssh-empty-icon">{icon}</div> : null}
      <div className="dsh-ssh-empty-title">{title}</div>
      {description ? <div className="dsh-ssh-empty-desc">{description}</div> : null}
      {action ? <div className="dsh-ssh-empty-action">{action}</div> : null}
    </div>
  )
}

export function Toast({ message, kind = 'error', onClose }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => closeRef.current(), kind === 'error' ? 7000 : 3000)
    return () => clearTimeout(timer)
  }, [message, kind])
  if (!message) return null
  return (
    <div className={`dsh-ssh-toast is-${kind}`} role="status">
      <span>{message}</span>
      <button type="button" aria-label={t('Dismiss', '关闭')} onClick={onClose}><IconClose /></button>
    </div>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }

export function IconServer() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2" {...stroke} /><rect x="3" y="13" width="18" height="7" rx="2" {...stroke} /><circle cx="7" cy="7.5" r="1" fill="currentColor" /><circle cx="7" cy="16.5" r="1" fill="currentColor" /></svg>
}
export function IconTerminal() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" {...stroke} /><path d="M7 9l3 3-3 3M13 15h4" {...stroke} /></svg>
}
export function IconPlus() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M5 12h14" {...stroke} /></svg>
}
export function IconClose() {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" {...stroke} /></svg>
}
export function IconEdit() {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" {...stroke} /></svg>
}
export function IconTrash() {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" {...stroke} /></svg>
}
export function IconFolder() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 6a2 2 0 012-2h4l2 3h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" {...stroke} /></svg>
}
export function IconFolderPlus() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 6a2 2 0 012-2h4l2 3h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" {...stroke} /><path d="M12 10v6M9 13h6" {...stroke} /></svg>
}
export function IconFile() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" {...stroke} /><path d="M14 3v4h4" {...stroke} /></svg>
}
export function IconDownload() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4v11M8 11l4 4 4-4M5 20h14" {...stroke} /></svg>
}
export function IconUpload() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4M5 20h14" {...stroke} /></svg>
}
export function IconRefresh() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" {...stroke} /></svg>
}
export function IconArrowUp() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" {...stroke} /></svg>
}
export function IconChevronRight() {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" {...stroke} /></svg>
}
export function IconPlug() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0V8zM12 16v5" {...stroke} /></svg>
}
export function IconFileText() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" {...stroke} /><path d="M9 12h6M9 16h6M9 8h2" {...stroke} /></svg>
}
