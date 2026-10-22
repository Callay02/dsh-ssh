import ssh2 from 'ssh2'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import {
  ProfileStore, publicProfile, newProfileId, expandHome, dshHome, errorText,
} from './store.js'
import { METRICS_COMMAND, parseMetricsOutput, deriveMetrics } from './metrics.js'

const { Client } = ssh2

const AUTH_METHODS = new Set(['password', 'key', 'agent'])
const TERMINAL_TAIL_MS = 10 * 60 * 1000
const MAX_TERMINAL_CHUNK = 128 * 1024

/** One bounded UTF-8 text accumulator. */
class TextSink {
  constructor(maxChars) {
    this.maxChars = maxChars
    this.decoder = new StringDecoder('utf8')
    this.parts = []
    this.length = 0
    this.truncated = false
  }

  push(chunk) {
    if (this.truncated) return
    const text = this.decoder.write(chunk)
    if (!text) return
    const room = this.maxChars - this.length
    if (text.length > room) {
      if (room > 0) this.parts.push(text.slice(0, room))
      this.length = this.maxChars
      this.truncated = true
      return
    }
    this.parts.push(text)
    this.length += text.length
  }

  finish() {
    if (!this.truncated) {
      const rest = this.decoder.end()
      if (rest) {
        const room = this.maxChars - this.length
        if (rest.length > room) {
          if (room > 0) this.parts.push(rest.slice(0, room))
          this.truncated = true
        } else {
          this.parts.push(rest)
        }
      }
    }
    return this.parts.join('')
  }
}

/** Bounded terminal scrollback: decoded text chunks with absolute offsets. */
class TerminalBuffer {
  constructor(maxChars) {
    this.maxChars = maxChars
    this.chunks = []
    this.start = 0
    this.end = 0
    this.decoder = new StringDecoder('utf8')
  }

  push(chunk) {
    const text = this.decoder.write(chunk)
    if (text) this.pushText(text)
  }

  pushText(text) {
    if (!text) return
    this.chunks.push(text)
    this.end += text.length
    let excess = this.end - this.start - this.maxChars
    while (excess > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]
      if (first.length <= excess) {
        this.chunks.shift()
        this.start += first.length
        excess -= first.length
      } else {
        this.chunks[0] = first.slice(excess)
        this.start += excess
        excess = 0
      }
    }
  }

  finish() {
    this.pushText(this.decoder.end())
  }

  slice(from, to) {
    let offset = this.start
    let out = ''
    for (const chunk of this.chunks) {
      const chunkEnd = offset + chunk.length
      if (chunkEnd <= from) {
        offset = chunkEnd
        continue
      }
      if (offset >= to) break
      const begin = Math.max(0, from - offset)
      const end = Math.min(chunk.length, to - offset)
      if (end > begin) out += chunk.slice(begin, end)
      offset = chunkEnd
    }
    return out
  }
}

/** SSH connection profiles, clients, exec, SFTP and interactive shells. */
export class SshManager {
  constructor(config = {}) {
    this.config = {
      dataDir: config.dataDir || join(dshHome(), 'ssh'),
      connectTimeoutMs: Number(config.connectTimeoutMs) || 20000,
      execTimeoutMs: Number(config.execTimeoutMs) || 120000,
      maxOutputChars: Number(config.maxOutputChars) || 131072,
      maxTerminalChars: Number(config.maxTerminalChars) || 524288,
      maxTerminals: Number(config.maxTerminals) || 8,
      keepaliveIntervalMs: Number(config.keepaliveIntervalMs) || 15000,
    }
    this.store = new ProfileStore(this.config.dataDir)
    this.states = new Map()
    this.terminals = new Map()
    this.disposed = false
  }

  // ---------------------------------------------------------------- profiles

  resolveProfile(reference) {
    this.store.reload()
    const profile = this.store.get(reference) ?? this.store.findByName(reference)
    if (!profile) {
      throw new Error(`Unknown SSH connection "${reference}". Configure it in the SSH panel first.`)
    }
    return profile
  }

  list() {
    this.store.reload()
    return this.store.list().map((profile) => this.decorate(profile))
  }

  decorate(profile) {
    const state = this.states.get(profile.id)
    return {
      ...publicProfile(profile),
      status: state?.status ?? 'disconnected',
      error: state?.error ?? '',
      connectedAt: state?.connectedAt ?? 0,
      terminalCount: state?.terminals?.size ?? 0,
      home: state?.home ?? '',
    }
  }

  get(id) {
    return this.store.get(id)
  }

  upsert(input = {}) {
    this.store.reload()
    const id = typeof input.id === 'string' && input.id ? input.id : newProfileId()
    const existing = this.store.get(id)
    if (input.id && !existing) throw new Error('That connection no longer exists.')

    const host = cleanHost(input.host ?? existing?.host ?? '')
    const port = Number(input.port ?? existing?.port ?? 22)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer between 1 and 65535.')
    const username = String(input.username ?? existing?.username ?? '').trim()
    if (!username) throw new Error('Username is required.')
    if (/[\s\u0000-\u001f]/.test(username)) throw new Error('Username cannot contain whitespace or control characters.')

    const auth = String(input.auth ?? existing?.auth ?? 'password')
    if (!AUTH_METHODS.has(auth)) throw new Error('Authentication must be one of password, key, or agent.')

    let privateKeyPath = String(input.privateKeyPath ?? existing?.privateKeyPath ?? '').trim()
    if (auth === 'key') {
      if (!privateKeyPath) privateKeyPath = '~/.ssh/id_ed25519'
      if (!privateKeyPath.startsWith('/') && !privateKeyPath.startsWith('~')) {
        throw new Error('Private key path must be absolute or start with ~/.')
      }
    }

    const name = String(input.name ?? existing?.name ?? '').trim() || `${username}@${host}`
    if (name.length > 120) throw new Error('Connection name is too long (120 characters maximum).')
    const duplicate = this.store.list().find((profile) => profile.id !== id && profile.name.toLowerCase() === name.toLowerCase())
    if (duplicate) throw new Error(`A connection named "${name}" already exists.`)

    const now = Date.now()
    let password = existing?.password
    let passphrase = existing?.passphrase
    if (typeof input.password === 'string' && input.password.length > 0) password = input.password
    if (typeof input.passphrase === 'string' && input.passphrase.length > 0) passphrase = input.passphrase
    if (input.clearPassword === true) password = undefined
    if (input.clearPassphrase === true) passphrase = undefined

    const profile = {
      id,
      name,
      host,
      port,
      username,
      auth,
      ...privateKeyPath && auth === 'key' ? { privateKeyPath } : {},
      ...typeof password === 'string' && password ? { password } : {},
      ...typeof passphrase === 'string' && passphrase ? { passphrase } : {},
      ...typeof input.defaultDir === 'string' && input.defaultDir.trim() ? { defaultDir: input.defaultDir.trim() } : {},
      ...existing?.hostFingerprint && input.resetHostKey !== true ? { hostFingerprint: existing.hostFingerprint } : {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (input.resetHostKey === true && existing?.hostFingerprint) {
      // Forget the pinned key so the next connection learns the new one.
      delete profile.hostFingerprint
    }

    if (existing && this.states.has(id)) this.disconnect(id, { reason: 'Connection settings changed.' })
    this.store.upsert(profile)
    return this.decorate(profile)
  }

  remove(id) {
    this.store.reload()
    const profile = this.store.get(id)
    if (!profile) throw new Error('That connection no longer exists.')
    this.disconnect(id, { reason: 'Connection removed.' })
    this.store.remove(id)
    return { ok: true }
  }

  // -------------------------------------------------------------- connection

  async connect(reference) {
    const profile = this.resolveProfile(reference)
    const current = this.states.get(profile.id)
    if (current?.status === 'connected' && current.client) return this.decorate(profile)
    if (current?.connecting) {
      await current.connecting.catch(() => {})
      return this.decorate(profile)
    }

    const state = {
      id: profile.id,
      status: 'connecting',
      error: '',
      client: null,
      connectedAt: 0,
      sftpClient: null,
      sftpPromise: null,
      home: '',
      terminals: new Set(),
      fingerprint: '',
      connecting: null,
      manualClose: false,
      metrics: { prev: null, cache: null, pending: null },
    }
    this.states.set(profile.id, state)

    const attempt = (async () => {
      try {
        const auth = await this.authConfig(profile, state)
        const client = new Client()
        state.client = client
        let fingerprint = ''

        const ready = new Promise((resolve, reject) => {
          client.once('ready', resolve)
          client.once('error', reject)
          client.once('close', () => reject(new Error('Connection closed before the SSH handshake completed.')))
        })

        client.on('error', (error) => {
          state.error = state.mismatch
            ? `Host key mismatch for ${profile.host}. The server presented ${state.fingerprint || 'a new key'}, but the saved fingerprint is different. Edit the connection and reset the host key only if you trust this change.`
            : errorText(error)
          state.status = 'error'
          this.failTerminalsOf(profile.id, state.error)
        })
        client.on('close', () => {
          if (this.states.get(profile.id) !== state) return
          state.sftpClient = null
          state.sftpPromise = null
          state.home = ''
          state.metrics = { prev: null, cache: null, pending: null }
          if (state.status === 'error') return
          state.status = state.manualClose ? 'disconnected' : 'error'
          if (!state.manualClose && !state.error) state.error = 'Connection closed by the server.'
          this.failTerminalsOf(profile.id, state.error || 'Connection closed.')
        })

        client.connect(auth)

        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timed out after ${this.config.connectTimeoutMs} ms while connecting.`)), this.config.connectTimeoutMs + 2000)
          ready.then(() => {
            clearTimeout(timer)
            resolve()
          }, (error) => {
            clearTimeout(timer)
            reject(error)
          })
        })

        if (state.manualClose || this.states.get(profile.id) !== state) {
          try {
            client.end()
          } catch {}
          throw new Error('The connection was closed before it finished opening.')
        }

        state.status = 'connected'
        state.error = ''
        state.connectedAt = Date.now()
        state.home = ''
        if (state.fingerprint && !profile.hostFingerprint) {
          profile.hostFingerprint = state.fingerprint
          profile.updatedAt = Date.now()
          this.store.upsert(profile)
        }
        return this.decorate(profile)
      } catch (error) {
        if (state.manualClose) {
          state.status = 'disconnected'
          state.error = ''
          throw new Error('The connection was closed before it finished opening.')
        }
        state.status = 'error'
        state.error = state.mismatch
          ? `Host key mismatch for ${profile.host}. Saved fingerprint: ${profile.hostFingerprint}. Presented: ${state.fingerprint}.`
          : errorText(error)
        state.manualClose = true
        try {
          state.client?.end()
        } catch {}
        throw new Error(state.error)
      } finally {
        state.connecting = null
      }
    })()

    state.connecting = attempt
    return attempt
  }

  async authConfig(profile, state) {
    const base = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: this.config.connectTimeoutMs,
      keepaliveInterval: this.config.keepaliveIntervalMs,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: (hash) => {
        state.fingerprint = hash
        state.mismatch = Boolean(profile.hostFingerprint) && profile.hostFingerprint !== hash
        return !state.mismatch
      },
    }
    if (profile.auth === 'password') {
      if (!profile.password) throw new Error(`No password is saved for "${profile.name}". Edit the connection to add one.`)
      return { ...base, password: profile.password, tryKeyboard: false }
    }
    if (profile.auth === 'key') {
      const keyPath = expandHome(profile.privateKeyPath || '~/.ssh/id_ed25519')
      let privateKey
      try {
        privateKey = await fsp.readFile(keyPath)
      } catch (error) {
        throw new Error(`Cannot read private key ${keyPath}: ${errorText(error)}`)
      }
      return { ...base, privateKey, ...profile.passphrase ? { passphrase: profile.passphrase } : {} }
    }
    const agent = process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK
    if (!agent) throw new Error('No SSH agent is available. Start ssh-agent and add your key, or use key/password authentication.')
    return { ...base, agent }
  }

  async ensureState(reference) {
    const profile = this.resolveProfile(reference)
    const state = this.states.get(profile.id)
    if (state?.status === 'connected' && state.client) return state
    if (state?.connecting) {
      await state.connecting
      const next = this.states.get(profile.id)
      if (next?.status === 'connected') return next
      throw new Error(next?.error || 'Connection failed.')
    }
    await this.connect(profile.id)
    const next = this.states.get(profile.id)
    if (next?.status !== 'connected') throw new Error(next?.error || 'Connection failed.')
    return next
  }

  disconnect(reference, options = {}) {
    const profile = this.resolveProfile(reference)
    const state = this.states.get(profile.id)
    if (!state) return { ok: true, status: 'disconnected' }
    state.manualClose = true
    state.status = 'disconnected'
    state.error = ''
    state.sftpClient = null
    state.sftpPromise = null
    state.home = ''
    state.metrics = { prev: null, cache: null, pending: null }
    this.failTerminalsOf(profile.id, options.reason || 'Disconnected.')
    try {
      state.client?.end()
    } catch {}
    return { ok: true, status: 'disconnected' }
  }

  failTerminalsOf(connectionId, reason) {
    for (const terminal of this.terminals.values()) {
      if (terminal.connectionId === connectionId && !terminal.exited) {
        this.exitTerminal(terminal, null, null, reason)
      }
    }
  }

  // ------------------------------------------------------------------- exec

  async exec(reference, command, options = {}) {
    const text = String(command ?? '')
    if (!text.trim()) throw new Error('Command cannot be empty.')
    const state = await this.ensureState(reference)
    const profile = this.resolveProfile(reference)
    const timeoutMs = clampNumber(options.timeoutMs, 1000, 3600000, this.config.execTimeoutMs)
    const maxChars = clampNumber(options.maxChars, 1024, 8 * 1024 * 1024, this.config.maxOutputChars)
    const stdout = new TextSink(maxChars)
    const stderr = new TextSink(maxChars)
    const signal = options.signal
    const pty = options.pty === true

    return await new Promise((resolve, reject) => {
      let settled = false
      let timedOut = false
      let aborted = false
      let stream
      let killTimer

      const finish = (code, exitSignal) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(killTimer)
        signal?.removeEventListener?.('abort', onAbort)
        resolve({
          ok: true,
          connection: profile.name,
          stdout: stdout.finish(),
          stderr: stderr.finish(),
          code: typeof code === 'number' ? code : null,
          signal: exitSignal ?? null,
          timedOut,
          aborted,
          truncated: stdout.truncated || stderr.truncated,
        })
      }

      const terminate = () => {
        try {
          stream?.signal('TERM')
        } catch {}
        killTimer = setTimeout(() => {
          try {
            stream?.close()
          } catch {}
          finish(null, 'TERM')
        }, 2000)
      }

      const onAbort = () => {
        aborted = true
        terminate()
      }

      const timer = setTimeout(() => {
        timedOut = true
        terminate()
      }, timeoutMs)

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new Error('SSH command cancelled.'))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      state.client.exec(text, pty ? { pty: { term: 'xterm-256color', cols: 120, rows: 40 } } : {}, (error, channel) => {
        if (error) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          clearTimeout(killTimer)
          signal?.removeEventListener?.('abort', onAbort)
          reject(new Error(`Remote command could not start: ${errorText(error)}`))
          return
        }
        stream = channel
        channel.on('data', (chunk) => stdout.push(chunk))
        channel.stderr.on('data', (chunk) => stderr.push(chunk))
        channel.on('close', (code, exitSignal) => finish(code, exitSignal))
        channel.on('error', (error) => {
          stderr.push(Buffer.from(`\n[channel error: ${errorText(error)}]`))
          finish(null, null)
        })
      })
    })
  }

  // ------------------------------------------------------------------- sftp

  async sftpClient(state) {
    if (state.sftpClient) return state.sftpClient
    if (!state.sftpPromise) {
      state.sftpPromise = new Promise((resolve, reject) => {
        state.client.sftp((error, sftp) => {
          if (error) {
            state.sftpPromise = null
            reject(new Error(`SFTP is unavailable: ${errorText(error)}`))
            return
          }
          state.sftpClient = sftp
          resolve(sftp)
        })
      })
    }
    return await state.sftpPromise
  }

  async sftpHome(state) {
    if (state.home) return state.home
    const sftp = await this.sftpClient(state)
    state.home = await new Promise((resolve) => {
      sftp.realpath('.', (error, path) => resolve(error ? '/' : path))
    })
    return state.home
  }

  async resolveRemotePath(state, input, options = {}) {
    const raw = String(input ?? '').trim()
    const home = await this.sftpHome(state)
    if (!raw || raw === '~') return options.directory ? home : home
    if (raw.startsWith('~/')) return posix.normalize(posix.join(home, raw.slice(2)))
    if (isAbsolute(raw)) return posix.normalize(raw)
    return posix.normalize(posix.join(home, raw))
  }

  async listRemote(reference, path) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, path, { directory: true })
    const entries = await new Promise((resolve, reject) => {
      sftp.readdir(target, (error, list) => error ? reject(new Error(`Cannot list ${target}: ${errorText(error)}`)) : resolve(list))
    })
    const rows = entries
      .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
      .map((entry) => ({
        name: entry.filename,
        path: posix.join(target, entry.filename),
        type: entryType(entry.attrs),
        size: entry.attrs.size ?? 0,
        mtime: (entry.attrs.mtime ?? 0) * 1000,
        mode: entry.attrs.mode ?? 0,
      }))
      .sort((a, b) => {
        if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return { path: target, home: state.home || await this.sftpHome(state), entries: rows }
  }

  async statRemote(reference, path) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, path)
    const attrs = await new Promise((resolve, reject) => {
      sftp.stat(target, (error, value) => error ? reject(new Error(`Cannot stat ${target}: ${errorText(error)}`)) : resolve(value))
    })
    return { path: target, type: entryType(attrs), size: attrs.size ?? 0, mtime: (attrs.mtime ?? 0) * 1000, mode: attrs.mode ?? 0 }
  }

  async downloadStream(reference, path) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, path)
    const info = await this.statRemote(reference, target)
    if (info.type === 'dir') throw new Error('Directories cannot be downloaded as a single file.')
    return {
      path: target,
      name: posix.basename(target) || 'download',
      size: info.size,
      stream: sftp.createReadStream(target),
    }
  }

  async uploadStream(reference, path, webStream) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, path)
    if (!posix.basename(target)) throw new Error('A remote file path is required.')
    await pipeline(Readable.fromWeb(webStream), sftp.createWriteStream(target))
    const info = await this.statRemote(reference, target)
    return { path: target, size: info.size, type: info.type }
  }

  async uploadFile(reference, localPath, remotePath) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, remotePath)
    await pipeline(fs.createReadStream(localPath), sftp.createWriteStream(target))
    const info = await this.statRemote(reference, target)
    return { path: target, size: info.size }
  }

  async archiveStream(reference, path) {
    const state = await this.ensureState(reference)
    const target = await this.resolveRemotePath(state, path)
    const info = await this.statRemote(reference, target)
    if (info.type !== 'dir') throw new Error('Only directories can be downloaded as an archive.')
    const parent = posix.dirname(target)
    const base = posix.basename(target)
    if (!base) throw new Error('The remote root cannot be archived.')
    const available = await this.exec(reference, 'command -v tar >/dev/null 2>&1', { timeoutMs: 4000, maxChars: 1024 })
    if (available.code !== 0) throw new Error('The remote host has no tar command; folder download is unavailable.')
    const command = `COPYFILE_DISABLE=1 tar -czf - -C ${shellQuote(parent)} -- ${shellQuote(base)}`
    const stream = await new Promise((resolve, reject) => {
      state.client.exec(command, (error, channel) => {
        if (error) reject(new Error(`Cannot archive ${target}: ${errorText(error)}`))
        else resolve(channel)
      })
    })
    return { path: target, name: `${base}.tar.gz`, stream }
  }

  async mkdirRemote(reference, path) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, path)
    await new Promise((resolve, reject) => {
      sftp.mkdir(target, { mode: 0o755 }, (error) => error ? reject(new Error(`Cannot create ${target}: ${errorText(error)}`)) : resolve())
    })
    return { ok: true, path: target }
  }

  async removeRemote(reference, path) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const target = await this.resolveRemotePath(state, path)
    const info = await this.statRemote(reference, target)
    if (info.type === 'dir') {
      await new Promise((resolve, reject) => {
        sftp.rmdir(target, (error) => error ? reject(new Error(`Cannot remove directory ${target}: ${errorText(error)} (only empty directories can be removed)`)) : resolve())
      })
    } else {
      await new Promise((resolve, reject) => {
        sftp.unlink(target, (error) => error ? reject(new Error(`Cannot remove ${target}: ${errorText(error)}`)) : resolve())
      })
    }
    return { ok: true, path: target }
  }

  async renameRemote(reference, from, to) {
    const state = await this.ensureState(reference)
    const sftp = await this.sftpClient(state)
    const source = await this.resolveRemotePath(state, from)
    const target = await this.resolveRemotePath(state, to)
    await new Promise((resolve, reject) => {
      sftp.rename(source, target, (error) => error ? reject(new Error(`Cannot rename ${source}: ${errorText(error)}`)) : resolve())
    })
    return { ok: true, path: target }
  }

  // --------------------------------------------------------------- terminals

  async openTerminal(reference, options = {}) {
    const profile = this.resolveProfile(reference)
    const state = await this.ensureState(reference)
    if (state.terminals.size >= this.config.maxTerminals) {
      throw new Error(`This connection already has ${this.config.maxTerminals} terminal sessions. Close one first.`)
    }
    const cols = clampNumber(options.cols, 20, 300, 100)
    const rows = clampNumber(options.rows, 5, 120, 30)
    const name = String(options.name ?? '').trim() || `${profile.name}`
    return await new Promise((resolve, reject) => {
      state.client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
        if (error) {
          reject(new Error(`Cannot open a remote shell: ${errorText(error)}`))
          return
        }
        const terminal = {
          id: newProfileId(),
          connectionId: profile.id,
          name,
          stream,
          buffer: new TerminalBuffer(this.config.maxTerminalChars),
          cols,
          rows,
          createdAt: Date.now(),
          exited: false,
          exitCode: null,
          signal: null,
          reason: '',
          waiters: [],
          tailTimer: null,
          lastInputAt: 0,
        }
        stream.on('data', (chunk) => {
          terminal.buffer.push(chunk)
          this.wake(terminal)
        })
        stream.stderr?.on?.('data', (chunk) => {
          terminal.buffer.push(chunk)
          this.wake(terminal)
        })
        stream.on('close', (code, signal) => this.exitTerminal(terminal, code, signal, ''))
        stream.on('error', (err) => this.exitTerminal(terminal, null, null, errorText(err)))
        this.terminals.set(terminal.id, terminal)
        state.terminals.add(terminal.id)
        resolve({ ok: true, terminal: this.terminalInfo(terminal) })
      })
    })
  }

  terminalInfo(terminal) {
    return {
      id: terminal.id,
      connectionId: terminal.connectionId,
      name: terminal.name,
      cols: terminal.cols,
      rows: terminal.rows,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      reason: terminal.reason,
      createdAt: terminal.createdAt,
      startOffset: terminal.buffer.start,
      endOffset: terminal.buffer.end,
    }
  }

  listTerminals(reference) {
    const profile = reference ? this.resolveProfile(reference) : undefined
    return Array.from(this.terminals.values())
      .filter((terminal) => profile === undefined || terminal.connectionId === profile.id)
      .map((terminal) => this.terminalInfo(terminal))
  }

  wake(terminal) {
    if (terminal.waiters.length === 0) return
    const waiters = terminal.waiters.splice(0)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(this.readTerminal(terminal, waiter.cursor, false))
    }
  }

  readTerminal(terminal, cursor, resetHint) {
    const raw = Number(cursor)
    let from = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : terminal.buffer.start
    let reset = Boolean(resetHint)
    if (from < terminal.buffer.start) {
      from = terminal.buffer.start
      reset = true
    }
    if (from > terminal.buffer.end) {
      from = terminal.buffer.start
      reset = true
    }
    const to = Math.min(terminal.buffer.end, from + MAX_TERMINAL_CHUNK)
    return {
      ok: true,
      data: terminal.buffer.slice(from, to),
      cursor: to,
      startOffset: terminal.buffer.start,
      endOffset: terminal.buffer.end,
      reset,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
      reason: terminal.reason,
      cols: terminal.cols,
      rows: terminal.rows,
    }
  }

  pollTerminal(terminalId, cursor, waitMs = 0) {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) throw new Error('That terminal session no longer exists.')
    const from = Number(cursor)
    const ready = !Number.isFinite(from)
      || from < terminal.buffer.start
      || from < terminal.buffer.end
      || terminal.exited
    if (ready || waitMs <= 0) return this.readTerminal(terminal, cursor, false)
    const wait = clampNumber(waitMs, 0, 15000, 0)
    if (wait === 0) return this.readTerminal(terminal, cursor, false)
    return new Promise((resolve) => {
      const waiter = {
        cursor,
        resolve,
        timer: setTimeout(() => {
          const at = terminal.waiters.indexOf(waiter)
          if (at !== -1) terminal.waiters.splice(at, 1)
          resolve(this.readTerminal(terminal, cursor, false))
        }, wait),
      }
      terminal.waiters.push(waiter)
    })
  }

  writeTerminal(terminalId, data) {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) throw new Error('That terminal session no longer exists.')
    if (terminal.exited) throw new Error('The remote shell has exited.')
    const text = String(data ?? '')
    if (text.length === 0) return { ok: true }
    if (text.length > 65536) throw new Error('Terminal input is too large for one write.')
    terminal.lastInputAt = Date.now()
    terminal.stream.write(text)
    return { ok: true }
  }

  resizeTerminal(terminalId, cols, rows) {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) throw new Error('That terminal session no longer exists.')
    if (terminal.exited) return { ok: true }
    const nextCols = clampNumber(cols, 20, 300, terminal.cols)
    const nextRows = clampNumber(rows, 5, 120, terminal.rows)
    terminal.cols = nextCols
    terminal.rows = nextRows
    terminal.stream.setWindow(nextRows, nextCols, 0, 0)
    return { ok: true }
  }

  closeTerminal(terminalId) {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return { ok: true }
    if (!terminal.exited) {
      try {
        terminal.stream.close()
      } catch {}
      setTimeout(() => {
        if (!terminal.exited) this.exitTerminal(terminal, null, 'CLOSED', 'Closed by the user.')
      }, 1500).unref?.()
    }
    return { ok: true }
  }

  exitTerminal(terminal, code, signal, reason) {
    if (terminal.exited) return
    terminal.exited = true
    terminal.exitCode = typeof code === 'number' ? code : null
    terminal.signal = signal ?? null
    terminal.reason = reason || ''
    terminal.buffer.finish()
    this.wake(terminal)
    const state = this.states.get(terminal.connectionId)
    state?.terminals.delete(terminal.id)
    try {
      terminal.stream.destroy()
    } catch {}
    terminal.tailTimer = setTimeout(() => {
      this.terminals.delete(terminal.id)
    }, TERMINAL_TAIL_MS)
    terminal.tailTimer.unref?.()
  }

  // ------------------------------------------------------------------- misc

  // ---------------------------------------------------------------- metrics

  /**
   * Sample remote CPU, memory and interface counters. The probe runs over the
   * existing SSH session; values are cached briefly so several terminals share
   * one sample. A disconnected connection is reported without reconnecting.
   */
  async getMetrics(reference) {
    const profile = this.resolveProfile(reference)
    const state = this.states.get(profile.id)
    const connected = state?.status === 'connected'
    const empty = {
      connected,
      sampledAt: Date.now(),
      platform: '',
      cpu: null,
      memory: null,
      network: null,
      ...state?.metrics?.cache?.value?.error ? { error: state.metrics.cache.value.error } : {},
    }
    if (!connected) return empty
    state.metrics ??= { prev: null, cache: null, pending: null }
    if (state.metrics.cache !== null && Date.now() - state.metrics.cache.at < 900) {
      return state.metrics.cache.value
    }
    if (state.metrics.pending !== null) return state.metrics.pending

    const pending = (async () => {
      try {
        const result = await this.exec(profile.id, METRICS_COMMAND, { timeoutMs: 5000, maxChars: 8192 })
        if (this.states.get(profile.id) !== state || state.status !== 'connected') {
          return { ...empty, connected: false, sampledAt: Date.now() }
        }
        if (!result.stdout.trim()) {
          throw new Error(result.stderr.trim() || 'The remote metrics probe returned no output.')
        }
        const parsed = parseMetricsOutput(result.stdout)
        const derived = deriveMetrics(parsed, state.metrics.prev, Date.now())
        state.metrics.prev = derived.previous
        state.metrics.cache = { at: Date.now(), value: derived.metrics }
        return derived.metrics
      } catch (error) {
        const value = {
          connected: true,
          sampledAt: Date.now(),
          platform: '',
          cpu: null,
          memory: null,
          network: null,
          error: errorText(error),
        }
        state.metrics.cache = { at: Date.now(), value }
        return value
      }
    })().finally(() => {
      if (state.metrics) state.metrics.pending = null
    })
    state.metrics.pending = pending
    return pending
  }

  async testProfile(input = {}) {
    const existing = typeof input.id === 'string' ? this.store.get(input.id) : undefined
    const merged = this.mergeForTest(input, existing)
    const state = {
      fingerprint: '',
      mismatch: false,
    }
    const auth = await this.authConfig(merged, state)
    const client = new Client()
    try {
      await new Promise((resolve, reject) => {
        let settled = false
        const finish = (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => finish(new Error(`Timed out after ${this.config.connectTimeoutMs} ms.`)), this.config.connectTimeoutMs + 2000)
        client.once('ready', () => finish())
        client.once('error', (error) => finish(state.mismatch
          ? new Error(`Host key mismatch. Saved ${existing?.hostFingerprint ?? ''}, presented ${state.fingerprint}.`)
          : error))
        client.connect(auth)
      })
      await new Promise((resolve, reject) => {
        client.exec('true', (error, stream) => {
          if (error) return reject(new Error(`Authenticated, but a session could not start: ${errorText(error)}`))
          stream.on('close', resolve)
          stream.resume()
        })
      })
      return { ok: true, fingerprint: state.fingerprint, host: merged.host, port: merged.port, username: merged.username }
    } finally {
      try {
        client.end()
      } catch {}
    }
  }

  mergeForTest(input, existing) {
    const merged = { ...existing, ...input }
    if (!input.password && existing?.password) merged.password = existing.password
    if (!input.passphrase && existing?.passphrase) merged.passphrase = existing.passphrase
    if (!merged.host || !merged.username) throw new Error('Host and username are required.')
    merged.port = Number(merged.port ?? 22)
    merged.auth = merged.auth ?? 'password'
    merged.name = merged.name || `${merged.username}@${merged.host}`
    merged.hostFingerprint = existing?.hostFingerprint
    return merged
  }

  dispose() {
    this.disposed = true
    for (const terminal of this.terminals.values()) {
      try {
        terminal.stream.destroy()
      } catch {}
      clearTimeout(terminal.tailTimer)
      for (const waiter of terminal.waiters.splice(0)) {
        clearTimeout(waiter.timer)
        waiter.resolve(this.readTerminal(terminal, waiter.cursor, false))
      }
    }
    this.terminals.clear()
    for (const state of this.states.values()) {
      state.manualClose = true
      try {
        state.client?.end()
      } catch {}
    }
    this.states.clear()
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function cleanHost(value) {
  const host = String(value ?? '').trim()
  if (!host) throw new Error('Host is required.')
  if (host.length > 255) throw new Error('Host is too long.')
  if (/[\s\u0000-\u001f]/.test(host)) throw new Error('Host cannot contain whitespace or control characters.')
  if (host.startsWith('-')) throw new Error('Host cannot start with a dash.')
  return host
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function entryType(attrs) {
  const mode = attrs?.mode ?? 0
  const kind = mode & 0o170000
  if (kind === 0o040000) return 'dir'
  if (kind === 0o120000) return 'symlink'
  if (kind === 0o100000) return 'file'
  return attrs?.isDirectory?.() ? 'dir' : 'other'
}
