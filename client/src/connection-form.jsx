import React, { useMemo, useState } from 'react'
import { saveConnection, testConnection } from './api.js'
import {
  Button, Checkbox, Field, Modal, Select, TextInput,
} from './ui.jsx'
import { t, useLocale } from './i18n.js'

function initialForm(connection) {
  return {
    id: connection?.id ?? '',
    name: connection?.name ?? '',
    host: connection?.host ?? '',
    port: connection?.port ?? 22,
    username: connection?.username ?? '',
    auth: connection?.auth ?? 'key',
    password: '',
    privateKeyPath: connection?.privateKeyPath ?? '~/.ssh/id_ed25519',
    passphrase: '',
    defaultDir: connection?.defaultDir ?? '',
    clearPassword: false,
    clearPassphrase: false,
    resetHostKey: false,
  }
}

export function ConnectionForm({ connection, onClose, onSaved, onError }) {
  useLocale()
  const [form, setForm] = useState(() => initialForm(connection))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState(null)

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const passwordReady = form.auth !== 'password' || Boolean(form.password) || connection?.hasPassword
  const keyReady = form.auth !== 'key' || Boolean(form.privateKeyPath.trim())
  const canSave = useMemo(
    () => Boolean(form.host.trim() && form.username.trim()) && passwordReady && keyReady && !saving,
    [form.host, form.username, passwordReady, keyReady, saving],
  )

  const payload = () => ({
    ...form,
    id: form.id || undefined,
    port: Number(form.port) || 22,
    name: form.name.trim(),
    host: form.host.trim(),
    username: form.username.trim(),
    privateKeyPath: form.privateKeyPath.trim(),
    defaultDir: form.defaultDir.trim(),
  })

  const submit = async (event) => {
    event?.preventDefault?.()
    if (!canSave) return
    setSaving(true)
    setTest(null)
    try {
      const result = await saveConnection(payload())
      onSaved?.(result.connection)
    } catch (cause) {
      onError?.(cause.message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      const result = await testConnection(payload())
      setTest({ ok: true, ...result })
    } catch (cause) {
      setTest({ ok: false, message: cause.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      title={connection ? t('Edit SSH connection', '编辑 SSH 连接') : t('New SSH connection', '新建 SSH 连接')}
      width={540}
      onClose={saving ? () => {} : onClose}
      footer={(
        <>
          <Button onClick={runTest} busy={testing} disabled={saving || !form.host.trim() || !form.username.trim()}>
            {t('Test connection', '测试连接')}
          </Button>
          <span className="dsh-ssh-modal-spacer" />
          <Button onClick={onClose} disabled={saving}>{t('Cancel', '取消')}</Button>
          <Button variant="primary" busy={saving} disabled={!canSave} onClick={submit}>{t('Save', '保存')}</Button>
        </>
      )}
    >
      <form className="dsh-ssh-form" onSubmit={submit}>
        <div className="dsh-ssh-form-grid">
          <Field label={t('Name', '名称')} hint={t('Used by the Agent in ssh_exec and the connection list.', 'Agent 在 ssh_exec 中使用的连接名。')}>
            <TextInput
              name="ssh-name"
              autoComplete="off"
              value={form.name}
              placeholder={form.username && form.host ? `${form.username}@${form.host}` : t('Production web server', '生产服务器')}
              onChange={(event) => update('name', event.target.value)}
            />
          </Field>
        </div>
        <div className="dsh-ssh-form-grid is-split">
          <Field label={t('Host', '主机')}>
            <TextInput
              name="ssh-host"
              autoComplete="off"
              value={form.host}
              placeholder="10.0.0.12 or ssh.example.com"
              onChange={(event) => update('host', event.target.value)}
              required
            />
          </Field>
          <Field label={t('Port', '端口')}>
            <TextInput
              name="ssh-port"
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(event) => update('port', event.target.value)}
            />
          </Field>
        </div>
        <div className="dsh-ssh-form-grid">
          <Field label={t('Username', '用户名')}>
            <TextInput
              name="ssh-username"
              autoComplete="username"
              value={form.username}
              placeholder="root"
              onChange={(event) => update('username', event.target.value)}
              required
            />
          </Field>
        </div>
        <div className="dsh-ssh-form-grid">
          <Field label={t('Authentication', '认证方式')}>
            <Select name="ssh-auth" value={form.auth} onChange={(event) => update('auth', event.target.value)}>
              <option value="key">{t('Private key', '私钥')}</option>
              <option value="password">{t('Password', '密码')}</option>
              <option value="agent">{t('SSH agent', 'SSH Agent')}</option>
            </Select>
          </Field>
        </div>

        {form.auth === 'key' ? (
          <>
            <Field label={t('Private key path', '私钥路径')} hint={t('Read by the Host process. Supports ~/ paths.', '由 Host 进程读取，支持 ~/ 路径。')}>
              <TextInput
                name="ssh-key"
                autoComplete="off"
                value={form.privateKeyPath}
                placeholder="~/.ssh/id_ed25519"
                onChange={(event) => update('privateKeyPath', event.target.value)}
              />
            </Field>
            <Field label={t('Key passphrase', '私钥口令')} hint={connection?.hasPassphrase ? t('A passphrase is saved. Leave empty to keep it.', '已保存口令，留空保持不变。') : undefined}>
              <TextInput
                name="ssh-passphrase"
                autoComplete="off"
                type="password"
                value={form.passphrase}
                placeholder={connection?.hasPassphrase ? '••••••••' : t('Optional', '可选')}
                onChange={(event) => update('passphrase', event.target.value)}
              />
            </Field>
            {connection?.hasPassphrase ? (
              <Checkbox checked={form.clearPassphrase} onChange={(value) => update('clearPassphrase', value)} label={t('Clear the saved passphrase', '清除已保存的私钥口令')} />
            ) : null}
          </>
        ) : null}

        {form.auth === 'password' ? (
          <>
            <Field label={t('Password', '密码')} hint={connection?.hasPassword ? t('A password is saved. Leave empty to keep it.', '已保存密码，留空保持不变。') : t('Stored locally with file mode 600. Agent tools can use it without prompting.', '保存在本地 600 权限文件中，Agent 工具可直接使用。')}>
              <TextInput
                name="ssh-password"
                autoComplete="off"
                type="password"
                value={form.password}
                placeholder={connection?.hasPassword ? '••••••••' : ''}
                onChange={(event) => update('password', event.target.value)}
              />
            </Field>
            {connection?.hasPassword ? (
              <Checkbox checked={form.clearPassword} onChange={(value) => update('clearPassword', value)} label={t('Clear the saved password', '清除已保存的密码')} />
            ) : null}
          </>
        ) : null}

        {form.auth === 'agent' ? (
          <p className="dsh-ssh-note">
            {t('Uses SSH_AUTH_SOCK (or Pageant on Windows). The agent must already hold a key the server accepts.', '使用 SSH_AUTH_SOCK（Windows 上为 Pageant）。Agent 中需要已有服务器接受的密钥。')}
          </p>
        ) : null}

        <Field label={t('Default remote directory', '默认远程目录')} hint={t('Opened by the file browser; relative paths still resolve from the remote home.', '文件浏览器默认打开的目录；相对路径仍以远程主目录为基准。')}>
          <TextInput
            name="ssh-default-dir"
            autoComplete="off"
            value={form.defaultDir}
            placeholder="/var/www"
            onChange={(event) => update('defaultDir', event.target.value)}
          />
        </Field>

        {connection?.hostFingerprint ? (
          <div className="dsh-ssh-fingerprint">
            <div className="dsh-ssh-fingerprint-label">{t('Pinned host key (SHA256)', '已固定的主机密钥（SHA256）')}</div>
            <code>{connection.hostFingerprint}</code>
            <Checkbox checked={form.resetHostKey} onChange={(value) => update('resetHostKey', value)} label={t('Forget this key and trust the next connection', '忘记该密钥并在下次连接时重新信任')} />
          </div>
        ) : (
          <p className="dsh-ssh-note">
            {t('The host key is pinned on the first successful connection (trust on first use).', '首次成功连接后会固定主机密钥（首次使用即信任）。')}
          </p>
        )}

        {test ? (
          <div className={`dsh-ssh-test ${test.ok ? 'is-ok' : 'is-error'}`}>
            {test.ok
              ? t(`Connection succeeded. Host key: ${test.fingerprint || '(none reported)'}`, `连接成功。主机密钥：${test.fingerprint || '（未返回）'}`)
              : test.message}
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
