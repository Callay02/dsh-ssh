import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

/** Expand a leading `~` using the host user's home directory. */
export function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return join(os.homedir(), value.slice(2))
  return value
}

/** The profile directory that owns persistent plugin state. */
export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** Coerce unknown thrown values into a stable message. */
export function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Persistent connection profiles, stored in one JSON document with mode 0600.
 * Secrets never leave the Host except through the explicit `publicProfile`
 * projection below.
 */
export class ProfileStore {
  constructor(directory) {
    this.directory = directory
    this.file = join(directory, 'connections.json')
    this.data = { version: 1, connections: [] }
    this.load()
  }

  load() {
    try {
      const text = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed && Array.isArray(parsed.connections)) {
        this.data = { version: 1, connections: parsed.connections.filter(isStoredProfile) }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // Keep an unreadable document rather than overwrite it silently.
        try {
          fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
        } catch {}
      }
    }
  }

  /**
   * Re-read the document before a mutation. The manager may be running beside
   * another edit (another window, a manual restore, or an HMR generation);
   * writing the in-memory list blindly would erase connections it never saw.
   */
  reload() {
    try {
      const text = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed && Array.isArray(parsed.connections)) {
        this.data = { version: 1, connections: parsed.connections.filter(isStoredProfile) }
        return true
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') return false
    }
    return false
  }

  save() {
    fs.mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, this.file)
    try {
      fs.chmodSync(this.file, 0o600)
    } catch {}
  }

  list() {
    return this.data.connections
  }

  get(id) {
    return this.data.connections.find((profile) => profile.id === id)
  }

  findByName(name) {
    const wanted = String(name ?? '').trim().toLowerCase()
    if (!wanted) return undefined
    return this.data.connections.find((profile) => profile.name.toLowerCase() === wanted)
      ?? this.data.connections.find((profile) => profile.id === name)
  }

  upsert(profile) {
    this.reload()
    const at = this.data.connections.findIndex((item) => item.id === profile.id)
    if (at === -1) this.data.connections.push(profile)
    else this.data.connections[at] = profile
    this.save()
    return profile
  }

  remove(id) {
    this.reload()
    const at = this.data.connections.findIndex((item) => item.id === id)
    if (at === -1) return false
    this.data.connections.splice(at, 1)
    this.save()
    return true
  }
}

function isStoredProfile(value) {
  return value && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.host === 'string'
    && typeof value.username === 'string'
}

/** Build a never-leaking projection of one profile. */
export function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    auth: profile.auth,
    privateKeyPath: profile.privateKeyPath ?? '',
    defaultDir: profile.defaultDir ?? '',
    hasPassword: typeof profile.password === 'string' && profile.password.length > 0,
    hasPassphrase: typeof profile.passphrase === 'string' && profile.passphrase.length > 0,
    hostFingerprint: profile.hostFingerprint ?? '',
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export function newProfileId() {
  return randomUUID()
}
